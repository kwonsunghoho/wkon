// =============================================================================
// 항공 뉴스 수집기 — 구글뉴스 RSS 검색 → Supabase news_articles 저장
// 실행: node scripts/fetch-news.mjs            (env: SUPABASE_SERVICE_ROLE_KEY 필수)
//       node scripts/fetch-news.mjs --dry-run  (DB 없이 파싱·분류 결과만 출력)
// 스케줄: .github/workflows/news.yml (3시간마다)
// 스펙: docs/superpowers/specs/2026-07-21-aviation-news-board-design.md
// ⚠️ 슬러그는 news.html·mypage.html의 라벨 맵과 계약 — 바꾸면 3곳 동기화.
// =============================================================================

const DRY = process.argv.includes('--dry-run');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://apzwauiumhmsvrgffjis.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DRY && !SERVICE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY 가 없습니다.'); process.exit(1); }

// 항공사 슬러그·별칭 — 별칭은 '제목에 등장하는 표기'(짧은 쪽 포함 매칭)
const AIRLINES = [
  { slug: 'kal',       name: '대한항공',     alias: ['대한항공'] },
  { slug: 'asiana',    name: '아시아나항공', alias: ['아시아나'] },
  { slug: 'jinair',    name: '진에어',       alias: ['진에어'] },
  { slug: 'jejuair',   name: '제주항공',     alias: ['제주항공'] },
  { slug: 'twayair',   name: '티웨이항공',   alias: ['티웨이'] },
  { slug: 'airbusan',  name: '에어부산',     alias: ['에어부산'] },
  { slug: 'airseoul',  name: '에어서울',     alias: ['에어서울'] },
  { slug: 'eastarjet', name: '이스타항공',   alias: ['이스타항공', '이스타 항공'] },
  { slug: 'airpremia', name: '에어프레미아', alias: ['에어프레미아'] },
  { slug: 'aerok',     name: '에어로케이',   alias: ['에어로케이'] },
];

// 주제 분류 — 첫 매칭 우선(준비생에게 가장 중요한 채용을 맨 앞에)
const TOPICS = [
  { slug: 'recruit', re: /채용|공채|모집|승무원 선발|채용설명회|신입/ },
  { slug: 'route',   re: /취항|노선|증편|재운항|복항|단항/ },
  { slug: 'biz',     re: /실적|영업이익|매출|인수|합병|유상증자|흑자|적자/ },
  { slug: 'service', re: /기내|서비스|유니폼|라운지|기내식|좌석/ },
  { slug: 'policy',  re: /국토부|공항|안전|사고|규제|지연|결항|항공법/ },
];

// 수집 쿼리 = 항공사 10개 + 산업 일반 2개
const QUERIES = [...AIRLINES.map(a => a.name), '항공사 채용', '국내 항공업계'];

const rssUrl = q =>
  'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=ko&gl=KR&ceid=KR:ko';

const unescapeXml = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");

function parseItems(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const tag = name => {
      const t = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
      return t ? unescapeXml(t[1]).trim() : '';
    };
    let title = tag('title');
    const source = tag('source');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(' - ' + source).length);
    // 실데이터엔 언론사 꼬리가 이중인 경우가 있다("… - 조선비즈 - Chosunbiz", source=Chosunbiz).
    // 남은 꼬리도 벗기되 과잉 제거 방지: 공백 없는 짧은 토큰(≤12자)만, 본문이 10자 이상 남을 때만.
    for (let i = 0; i < 2; i++) {
      const m = title.match(/ - (\S{1,12})$/);
      if (m && title.length - m[0].length >= 10) title = title.slice(0, -m[0].length);
      else break;
    }
    const url = tag('link');
    const pub = tag('pubDate');
    if (!title || !url) continue;
    items.push({ title, url, source: source || null,
                 published_at: pub ? new Date(pub).toISOString() : null });
  }
  return items;
}

function classify(title) {
  let airline = null;
  for (const a of AIRLINES) if (a.alias.some(al => title.includes(al))) { airline = a.slug; break; }
  let topic = null;
  for (const t of TOPICS) if (t.re.test(title)) { topic = t.slug; break; }
  return { airline, topic };
}

// 제목 정규화 — 받아쓰기 기사(제목 동일·언론사만 다름) 스킵용
const normTitle = s => s.replace(/[\s\[\]()"'“”‘’·…‥,.?!\-]/g, '').toLowerCase();

async function sbFetch(path, opts = {}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json', ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(path + ' → HTTP ' + res.status + ' ' + (await res.text()));
  return res;
}

(async () => {
  // 1) RSS 수집 — 쿼리 하나가 죽어도 나머지는 진행(스펙 §9 리스크 완화)
  const collected = new Map();               // url → item (쿼리 간 URL 중복 자동 제거)
  for (const q of QUERIES) {
    try {
      const res = await fetch(rssUrl(q));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      for (const it of parseItems(await res.text())) collected.set(it.url, it);
    } catch (e) { console.warn(`쿼리 실패(스킵): ${q} — ${e.message}`); }
  }
  console.log(`수집 ${collected.size}건 (쿼리 ${QUERIES.length}개)`);

  // 2) 분류 + 이번 배치 안의 제목 중복 제거
  const seen = new Set();
  const rows = [];
  for (const it of collected.values()) {
    const key = normTitle(it.title);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ ...it, ...classify(it.title) });
  }

  if (DRY) {
    for (const r of rows.slice(0, 30))
      console.log(`[${r.airline || '-'}/${r.topic || '-'}] ${r.title} (${r.source || '?'})`);
    console.log(`dry-run: 저장 대상 ${rows.length}건 (상위 30건만 표시)`);
    return;
  }

  // 3) DB 최근 제목과 대조(과거 수집분의 받아쓰기 기사 방어) — 최근 500건이면 충분
  const recent = await (await sbFetch('news_articles?select=title&order=created_at.desc&limit=500')).json();
  const dbTitles = new Set(recent.map(r => normTitle(r.title)));
  const fresh = rows.filter(r => !dbTitles.has(normTitle(r.title)));

  // 4) upsert — url unique 충돌은 무시(재수집 안전)
  let inserted = 0;
  if (fresh.length) {
    const res = await sbFetch('news_articles?on_conflict=url', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(fresh),
    });
    inserted = (await res.json()).length;
  }
  console.log(`신규 ${inserted}건 저장 (제목 중복 ${rows.length - fresh.length}건 스킵)`);

  // 5) 90일 지난 기사 정리 — ⚠️ 스크랩된 기사는 남긴다(cascade로 회원 재료함이 날아가므로)
  const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const olds = await (await sbFetch(
    `news_articles?select=id,news_scraps(id)&published_at=lt.${cutoff}&limit=500`)).json();
  const deletable = olds.filter(a => !(a.news_scraps || []).length).map(a => a.id);
  if (deletable.length)
    await sbFetch(`news_articles?id=in.(${deletable.join(',')})`, { method: 'DELETE' });
  console.log(`정리 ${deletable.length}건 삭제 (90일 경과·스크랩 없음)`);
})().catch(e => { console.error(e); process.exit(1); });
