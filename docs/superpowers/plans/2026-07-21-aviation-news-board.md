# 항공 뉴스 게시판 + 회원 스크랩 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 항공 뉴스 자동 수집 게시판(news.html)과 회원 스크랩(답변 재료함, 활용 메모 포함)을 구축한다.

**Architecture:** GitHub Actions가 3시간마다 구글뉴스 RSS를 긁어 Supabase `news_articles`에 저장(제목 키워드로 항공사·주제 분류, URL+정규화 제목 2중 중복 방어). news.html은 공개 게시판(필터칩 + 북마크), 스크랩은 `news_scraps`(RLS 본인만)에 저장돼 mypage 요약 카드와 news.html '내 스크랩' 탭(항공사별 그룹핑 + 활용 메모)에 나타난다.

**Tech Stack:** 정적 HTML/CSS/JS(빌드 없음) + Supabase(PostgREST/RLS) + GitHub Actions + Node 20(의존성 0 수집 스크립트).

**스펙:** docs/superpowers/specs/2026-07-21-aviation-news-board-design.md

**검증 방침:** 이 리포는 테스트 스위트가 없다(CLAUDE.md). 수집기는 `--dry-run` 실행으로, 페이지는 로컬 프리뷰(375px 우선)로 검증한다. 커밋은 태스크마다.

**슬러그 계약(전 태스크 공통 — 불일치 시 분류·필터가 조용히 깨진다):**
- 항공사: `kal` 대한항공 · `asiana` 아시아나항공 · `jinair` 진에어 · `jejuair` 제주항공 · `twayair` 티웨이항공 · `airbusan` 에어부산 · `airseoul` 에어서울 · `eastarjet` 이스타항공 · `airpremia` 에어프레미아 · `aerok` 에어로케이
- 주제: `recruit` 채용·모집 · `route` 취항·노선 · `biz` 경영·실적 · `service` 서비스·기내 · `policy` 정책·공항·안전

---

### Task 1: 마이그레이션 — news_articles + news_scraps

**Files:**
- Create: `supabase/migrations/20260721120000_news_board.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- =============================================================================
-- 항공 뉴스 게시판 + 회원 스크랩
-- 스펙: docs/superpowers/specs/2026-07-21-aviation-news-board-design.md
--   news_articles — 구글뉴스 RSS 자동수집(GitHub Actions, service role이 씀).
--                   제목+링크만 저장(본문 없음 — 저작권·용량 회피). 읽기는 누구나.
--   news_scraps   — 회원의 '면접 답변 재료함'. note = 활용 메모. 본인만 CRUD.
-- 적용: Supabase SQL Editor에서 이 파일 실행(이 레포는 자동 마이그레이션 없음).
-- 검증(실행 후):
--   1) 시크릿 창: curl -s "https://apzwauiumhmsvrgffjis.supabase.co/rest/v1/news_articles?select=id&limit=1" \
--        -H "apikey: <anon key>"  →  200 [] (읽기 공개)
--   2) 같은 anon key로 POST → 401/403 (쓰기 차단 = service role 전용)
-- =============================================================================

create table if not exists public.news_articles (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  url          text not null unique,     -- 중복 수집 방지의 핵심
  source       text,                      -- 언론사명
  published_at timestamptz,
  airline      text,                      -- 슬러그(kal/asiana/... 스펙 §2), 미분류 null
  topic        text,                      -- 슬러그(recruit/route/biz/service/policy), 미분류 null
  created_at   timestamptz not null default now()
);

comment on table public.news_articles is
  '항공 뉴스(구글뉴스 RSS 자동수집). 제목+링크만 저장. 쓰기는 수집기(service role)만.';

create index if not exists news_articles_published_idx on public.news_articles (published_at desc);
create index if not exists news_articles_airline_idx   on public.news_articles (airline);
create index if not exists news_articles_topic_idx     on public.news_articles (topic);

alter table public.news_articles enable row level security;

drop policy if exists news_articles_select_all on public.news_articles;

-- SELECT: 비회원 포함 공개(게시판은 유입 장치). INSERT/UPDATE/DELETE 정책 없음 = service role만.
create policy news_articles_select_all on public.news_articles
  for select to anon, authenticated using (true);

create table if not exists public.news_scraps (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id) on delete cascade,
  article_id uuid not null references public.news_articles(id) on delete cascade,
  note       text,                        -- 활용 메모("신규 취항 → 지원동기에 연결" 등)
  created_at timestamptz not null default now(),
  unique (member_id, article_id)          -- 같은 기사 중복 스크랩 방지
);

comment on table public.news_scraps is
  '회원 뉴스 스크랩(면접 답변 재료함). note = 활용 메모. RLS로 본인만.';

create index if not exists news_scraps_member_idx on public.news_scraps (member_id);

alter table public.news_scraps enable row level security;

drop policy if exists news_scraps_own on public.news_scraps;

-- 본인 것만 SELECT/INSERT/UPDATE(메모 수정)/DELETE
create policy news_scraps_own on public.news_scraps
  for all to authenticated
  using (member_id = auth.uid())
  with check (member_id = auth.uid());
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/migrations/20260721120000_news_board.sql
git commit -m "feat(뉴스): news_articles·news_scraps 마이그레이션 — 읽기 공개·쓰기 service role, 스크랩은 본인만(활용 메모 포함)"
```

---

### Task 2: 수집 스크립트 — scripts/fetch-news.mjs

**Files:**
- Create: `scripts/fetch-news.mjs`

의존성 0(Node 20 내장 fetch), 정규식 RSS 파싱. 구글뉴스 item의 `<title>`은 `"기사제목 - 언론사"` 형태라 `<source>` 값으로 접미를 벗긴다.

- [ ] **Step 1: 스크립트 작성**

```js
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
```

- [ ] **Step 2: dry-run으로 파싱·분류 검증**

Run: `node scripts/fetch-news.mjs --dry-run`
Expected: `수집 N건`(N > 100 안팎), `[kal/route] …` 형태로 분류된 기사 목록, `dry-run: 저장 대상 N건`. 항공사·주제 슬러그가 찍히는지, 제목에서 언론사 접미가 벗겨졌는지 눈으로 확인.

- [ ] **Step 3: 커밋**

```bash
git add scripts/fetch-news.mjs
git commit -m "feat(뉴스): 구글뉴스 RSS 수집기 — 항공사 10개사·주제 5분류 키워드 분류, URL+정규화 제목 2중 중복 방어, 90일 정리(스크랩 제외)"
```

---

### Task 3: GitHub Actions 워크플로

**Files:**
- Create: `.github/workflows/news.yml`

- [ ] **Step 1: 워크플로 작성**

```yaml
# 항공 뉴스 자동 수집 — 3시간마다 scripts/fetch-news.mjs 실행
# 오너 1회 설정: Settings → Secrets and variables → Actions → SUPABASE_SERVICE_ROLE_KEY 등록
# ⚠️ 공개 리포는 60일간 커밋이 없으면 GitHub가 스케줄을 자동 중지(메일 통지 → 버튼으로 재활성)
name: 항공 뉴스 수집

on:
  schedule:
    - cron: '0 */3 * * *'    # 3시간마다(UTC 기준 — KST로도 3시간 간격은 동일)
  workflow_dispatch: {}       # Actions 탭 'Run workflow' 버튼으로 즉시 수집

permissions:
  contents: read

jobs:
  fetch:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: 뉴스 수집·저장
        env:
          SUPABASE_URL: https://apzwauiumhmsvrgffjis.supabase.co
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: node scripts/fetch-news.mjs
```

- [ ] **Step 2: 커밋**

```bash
git add .github/workflows/news.yml
git commit -m "feat(뉴스): 수집 워크플로 — 3시간 스케줄 + 수동 실행 버튼, 서비스 키는 GitHub Secrets"
```

---

### Task 4: news.html — 공개 게시판 (전체 뉴스 탭)

**Files:**
- Create: `news.html`

reviews.html의 nav·hero·필터칩·스켈레톤 패턴을 그대로 계승(`nw-` 접두). 이 태스크에서는 **전체 뉴스 탭까지**(목록·필터·더 보기·북마크 토글·비로그인 유도·폴백). '내 스크랩' 탭은 Task 5에서 같은 파일에 추가.

- [ ] **Step 1: news.html 작성**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>항공 뉴스 — MONC 몬크 챌린지</title>

  <!-- Microsoft Clarity — 방문자 행동 분석. 프로젝트 xlu6nkv2uh -->
  <script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "xlu6nkv2uh");
  </script>
  <meta name="description" content="항공산업·국내 항공사 최신 뉴스. 스크랩하면 마이페이지에 항공사별로 쌓여 면접 답변 재료가 돼요." />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@600;700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="tokens.css">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body { font-family: 'Pretendard','Apple SD Gothic Neo',-apple-system,sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; -webkit-font-smoothing: antialiased; }
    .container { max-width: 860px; margin: 0 auto; padding: 0 20px; }
    a { color: inherit; }

    /* NAV — reviews.html과 동일 패턴 */
    nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; padding: 14px 0; background: rgba(233,228,216,.92); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); border-bottom: 1px solid var(--border-soft); }
    .nav-inner { display: flex; align-items: center; justify-content: space-between; max-width: 1120px; margin: 0 auto; padding: 0 20px; }
    .logo { display: flex; align-items: center; text-decoration: none; }
    .logo img { height: 22px; width: auto; display: block; }
    .nav-back { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: var(--text); text-decoration: none; opacity: .8; transition: opacity .2s; min-height: 44px; }
    .nav-back:hover { opacity: 1; }

    /* HERO */
    .nw-hero { padding: 104px 0 20px; text-align: center; }
    .nw-eyebrow { font-size: 13px; font-weight: 800; letter-spacing: .24em; color: var(--accent-ink); }
    .nw-title { font-family: var(--serif); font-size: clamp(28px, 5vw, 42px); font-weight: 700; color: var(--accent); letter-spacing: -.6px; margin-top: 10px; }
    .nw-sub { font-size: 15px; color: var(--text); opacity: .72; margin-top: 12px; }
    .nw-sub b { color: var(--action); font-weight: 800; }

    /* 탭 (전체 뉴스 / 내 스크랩) */
    .nw-tabs { display: flex; justify-content: center; gap: 8px; margin-top: 20px; }
    .nw-tab { appearance: none; cursor: pointer; border: 1.5px solid var(--border); background: var(--surface); color: var(--text); font: inherit; font-size: 14px; font-weight: 800; padding: 10px 22px; border-radius: 999px; min-height: 44px; -webkit-tap-highlight-color: transparent; }
    .nw-tab.active { background: var(--action); color: var(--action-ink); border-color: transparent; }
    .nw-tab:focus-visible { outline: 3px solid var(--action); outline-offset: 2px; }

    /* 필터 바 — reviews.html 패턴 */
    .nw-filters { position: sticky; top: 58px; z-index: 50; background: rgba(233,228,216,.92); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); padding: 14px 0 12px; margin-bottom: 8px; border-bottom: 1px solid var(--border-soft); }
    .nw-filter-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .nw-filter-row + .nw-filter-row { margin-top: 8px; }
    .nw-filter-label { font-size: 12px; font-weight: 800; color: var(--text); opacity: .55; margin-right: 4px; min-width: 42px; }
    .nw-chip { appearance: none; cursor: pointer; border: 1.5px solid var(--border); background: var(--surface); color: var(--text); font: inherit; font-size: 13px; font-weight: 700; padding: 8px 15px; border-radius: 999px; min-height: 40px; transition: background .15s, color .15s, border-color .15s; -webkit-tap-highlight-color: transparent; }
    .nw-chip:hover { border-color: var(--accent-dark); }
    .nw-chip.active { background: var(--accent-ink); color: #fff; border-color: var(--accent-ink); }
    .nw-chip:focus-visible { outline: 3px solid var(--action); outline-offset: 2px; }

    /* 기사 리스트 */
    .nw-list { list-style: none; padding: 8px 0 16px; display: flex; flex-direction: column; gap: 12px; }
    .nw-card { position: relative; background: var(--surface); border: 1px solid var(--border-soft); border-radius: var(--radius-sm); box-shadow: 0 2px 10px rgba(38,34,28,.06); transition: box-shadow .2s, transform .2s; }
    .nw-card:hover { box-shadow: 0 10px 30px rgba(38,34,28,.14); transform: translateY(-2px); }
    .nw-link { display: block; padding: 16px 60px 14px 16px; text-decoration: none; }
    .nw-card-title { font-size: 15.5px; font-weight: 700; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .nw-card-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 8px; font-size: 12.5px; color: var(--text-muted); }
    .nw-tag { font-size: 12px; font-weight: 800; padding: 3px 10px; border-radius: 999px; background: rgba(217,83,31,.10); color: var(--accent-ink); }
    .nw-tag-topic { background: rgba(242,121,69,.14); color: var(--action-ink); }
    /* 북마크 버튼 — 우상단 44px 터치 타겟 */
    .nw-bm { position: absolute; top: 8px; right: 8px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border: 0; background: none; cursor: pointer; color: var(--text-muted); border-radius: 50%; -webkit-tap-highlight-color: transparent; }
    .nw-bm:hover { background: var(--surface2); }
    .nw-bm.on { color: var(--action); }
    .nw-bm svg { width: 22px; height: 22px; }
    .nw-bm.on svg path { fill: currentColor; }
    .nw-bm:focus-visible { outline: 3px solid var(--action); outline-offset: 2px; }

    .nw-count { font-size: 13px; font-weight: 700; color: var(--text); opacity: .6; margin: 16px 2px 4px; }
    .nw-empty { text-align: center; padding: 60px 20px; color: var(--text); opacity: .6; font-size: 15px; }
    .nw-skeleton { height: 92px; border-radius: var(--radius-sm); background: var(--surface2); margin-bottom: 12px; }
    .nw-more-wrap { text-align: center; padding: 8px 0 72px; }
    .nw-more { appearance: none; cursor: pointer; border: 1.5px solid var(--border); background: var(--surface); color: var(--text); font: inherit; font-size: 14px; font-weight: 800; padding: 13px 34px; border-radius: 999px; min-height: 48px; }
    .nw-more:hover { border-color: var(--accent-dark); }

    @media (prefers-reduced-motion: reduce) {
      .nw-card { transition: none; }
      html { scroll-behavior: auto; }
    }
  </style>
</head>
<body>
  <nav>
    <div class="nav-inner">
      <a href="index.html" class="logo"><img src="images/몬크 로고/assets/png/MONC-lockup-transparent.png" alt="MONC" /></a>
      <a href="index.html" class="nav-back">← 홈으로</a>
    </div>
  </nav>

  <header class="nw-hero">
    <div class="container">
      <div class="nw-eyebrow">AVIATION NEWS</div>
      <h1 class="nw-title">항공 뉴스</h1>
      <p class="nw-sub">스크랩하면 마이페이지에 <b>항공사별로</b> 쌓여요 — 면접 답변 재료가 됩니다.</p>
      <div class="nw-tabs" role="tablist">
        <button class="nw-tab active" type="button" data-tab="all" role="tab" aria-selected="true">전체 뉴스</button>
        <button class="nw-tab" type="button" data-tab="scraps" id="nwScrapTab" role="tab" aria-selected="false" hidden>내 스크랩</button>
      </div>
    </div>
  </header>

  <div class="nw-filters" id="nwFilters" hidden>
    <div class="container">
      <div class="nw-filter-row" id="nwAirlineRow">
        <span class="nw-filter-label">항공사</span>
      </div>
      <div class="nw-filter-row" id="nwTopicRow">
        <span class="nw-filter-label">주제</span>
      </div>
    </div>
  </div>

  <main class="container">
    <div class="nw-count" id="nwCount"></div>
    <div id="nwSkeleton">
      <div class="nw-skeleton"></div><div class="nw-skeleton"></div><div class="nw-skeleton"></div>
      <div class="nw-skeleton"></div><div class="nw-skeleton"></div>
    </div>
    <ul class="nw-list" id="nwList"></ul>
    <div class="nw-empty" id="nwEmpty" hidden>표시할 뉴스가 없어요.</div>
    <div class="nw-more-wrap"><button class="nw-more" id="nwMore" type="button" hidden>더 보기</button></div>
  </main>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="supabase-config.js"></script>
  <script>
  (function () {
    // ⚠️ 슬러그 계약 — scripts/fetch-news.mjs·mypage.html과 동기화
    const AIRLINE_LABEL = { kal:'대한항공', asiana:'아시아나항공', jinair:'진에어', jejuair:'제주항공', twayair:'티웨이항공', airbusan:'에어부산', airseoul:'에어서울', eastarjet:'이스타항공', airpremia:'에어프레미아', aerok:'에어로케이' };
    const AIRLINE_ORDER = ['kal','asiana','jinair','jejuair','twayair','airbusan','airseoul','eastarjet','airpremia','aerok'];
    const TOPIC_LABEL = { recruit:'채용·모집', route:'취항·노선', biz:'경영·실적', service:'서비스·기내', policy:'정책·공항·안전' };
    const TOPIC_ORDER = ['recruit','route','biz','service','policy'];
    const PAGE = 20;

    const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const BM_SVG = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.3.3 0 0 1-.47.25L12 16.4l-6.03 4.05a.3.3 0 0 1-.47-.25V4a.5.5 0 0 1 .5-.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

    // "3시간 전" 상대시각(하루 넘으면 날짜)
    function relTime(iso) {
      if (!iso) return '';
      const d = new Date(iso), diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 3600) return Math.max(1, Math.floor(diff / 60)) + '분 전';
      if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
      if (diff < 86400 * 7) return Math.floor(diff / 86400) + '일 전';
      return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate();
    }

    const listEl = document.getElementById('nwList');
    const emptyEl = document.getElementById('nwEmpty');
    const countEl = document.getElementById('nwCount');
    const moreBtn = document.getElementById('nwMore');
    const skelEl = document.getElementById('nwSkeleton');
    const filtersEl = document.getElementById('nwFilters');

    let session = null;            // 로그인 세션(스크랩 기능 게이트)
    let scrapByArticle = new Map();// article_id → scrap row(id, note)
    let fAirline = 'all', fTopic = 'all';
    let offset = 0, exhausted = false;

    // ── 폴백: 테이블 미생성(마이그레이션 전) → 준비 중 안내 ──
    function showNotReady() {
      skelEl.hidden = true; filtersEl.hidden = true;
      emptyEl.hidden = false; emptyEl.textContent = '뉴스 게시판을 준비 중이에요. 조금만 기다려주세요!';
    }

    // ── 필터 칩: 데이터에 존재하는 값만 노출(최근 1000건 기준) ──
    async function buildFilters() {
      const { data, error } = await MONC.sb.from('news_articles')
        .select('airline, topic').order('created_at', { ascending: false }).limit(1000);
      if (error || !data) return;                       // 칩 실패는 치명 아님 — 목록은 그대로
      const airSet = new Set(data.map(r => r.airline).filter(Boolean));
      const topSet = new Set(data.map(r => r.topic).filter(Boolean));
      if (!airSet.size && !topSet.size) return;          // 분류 데이터 없으면 필터바 숨김 유지
      filtersEl.hidden = false;

      const mk = (label, val, kind) => {
        const b = document.createElement('button');
        b.className = 'nw-chip' + ((kind === 'air' ? fAirline : fTopic) === val ? ' active' : '');
        b.type = 'button'; b.dataset.kind = kind; b.dataset.val = val;
        b.textContent = label;
        return b;
      };
      const airRow = document.getElementById('nwAirlineRow');
      const topRow = document.getElementById('nwTopicRow');
      airRow.querySelectorAll('.nw-chip').forEach(n => n.remove());
      topRow.querySelectorAll('.nw-chip').forEach(n => n.remove());
      airRow.appendChild(mk('전체', 'all', 'air'));
      AIRLINE_ORDER.filter(a => airSet.has(a)).forEach(a => airRow.appendChild(mk(AIRLINE_LABEL[a], a, 'air')));
      topRow.appendChild(mk('전체', 'all', 'top'));
      TOPIC_ORDER.filter(t => topSet.has(t)).forEach(t => topRow.appendChild(mk(TOPIC_LABEL[t], t, 'top')));

      filtersEl.querySelectorAll('.nw-chip').forEach(chip => chip.addEventListener('click', () => {
        if (chip.dataset.kind === 'air') fAirline = chip.dataset.val; else fTopic = chip.dataset.val;
        filtersEl.querySelectorAll('.nw-chip').forEach(c => {
          const sel = c.dataset.kind === 'air' ? fAirline : fTopic;
          c.classList.toggle('active', c.dataset.val === sel);
        });
        resetAndLoad();
      }));
    }

    // ── 기사 목록(서버 필터 + range 페이지네이션) ──
    async function fetchPage() {
      let q = MONC.sb.from('news_articles')
        .select('id, title, url, source, published_at, airline, topic')
        .order('published_at', { ascending: false, nullsFirst: false })
        .range(offset, offset + PAGE - 1);
      if (fAirline !== 'all') q = q.eq('airline', fAirline);
      if (fTopic !== 'all') q = q.eq('topic', fTopic);
      return q;
    }

    function cardHtml(a) {
      const scrapped = scrapByArticle.has(a.id);
      const chips =
        (a.airline ? `<span class="nw-tag">${esc(AIRLINE_LABEL[a.airline] || a.airline)}</span>` : '') +
        (a.topic ? `<span class="nw-tag nw-tag-topic">${esc(TOPIC_LABEL[a.topic] || a.topic)}</span>` : '');
      return `<li class="nw-card" data-id="${esc(a.id)}">
        <a class="nw-link" href="${esc(a.url)}" target="_blank" rel="noopener">
          <div class="nw-card-title">${esc(a.title)}</div>
          <div class="nw-card-meta">${chips}<span>${esc(a.source || '')}</span><span>${relTime(a.published_at)}</span></div>
        </a>
        <button class="nw-bm${scrapped ? ' on' : ''}" type="button" data-id="${esc(a.id)}"
          aria-label="${scrapped ? '스크랩 해제' : '스크랩'}" aria-pressed="${scrapped}">${BM_SVG}</button>
      </li>`;
    }

    async function loadMore() {
      moreBtn.disabled = true;
      const { data, error } = await fetchPage();
      skelEl.hidden = true;
      if (error) { if (!offset) showNotReady(); moreBtn.disabled = false; return; }
      const rows = data || [];
      if (!offset && !rows.length) { emptyEl.hidden = false; listEl.innerHTML = ''; moreBtn.hidden = true; return; }
      emptyEl.hidden = true;
      listEl.insertAdjacentHTML('beforeend', rows.map(cardHtml).join(''));
      offset += rows.length;
      exhausted = rows.length < PAGE;
      moreBtn.hidden = exhausted;
      moreBtn.disabled = false;
      countEl.textContent = offset ? `${offset}건${exhausted ? '' : '+'}` : '';
    }

    function resetAndLoad() {
      offset = 0; exhausted = false; listEl.innerHTML = ''; countEl.textContent = '';
      moreBtn.hidden = true; emptyEl.hidden = true;
      loadMore();
    }

    // ── 스크랩 토글(낙관적 업데이트, 실패 시 롤백) ──
    async function toggleScrap(btn) {
      if (!session) {
        if (confirm('스크랩은 로그인하면 쓸 수 있어요. 로그인 페이지로 이동할까요?'))
          window.location.href = 'login.html';
        return;
      }
      const id = btn.dataset.id;
      const was = scrapByArticle.has(id);
      btn.classList.toggle('on', !was);
      btn.setAttribute('aria-pressed', String(!was));
      btn.setAttribute('aria-label', was ? '스크랩' : '스크랩 해제');
      if (was) {
        const row = scrapByArticle.get(id);
        scrapByArticle.delete(id);
        const { error } = await MONC.sb.from('news_scraps').delete().eq('id', row.id);
        if (error) { scrapByArticle.set(id, row); btn.classList.add('on'); }
      } else {
        scrapByArticle.set(id, { id: null, note: null });
        const { data, error } = await MONC.sb.from('news_scraps')
          .insert({ member_id: session.user.id, article_id: id }).select('id, note').single();
        if (error) { scrapByArticle.delete(id); btn.classList.remove('on'); }
        else scrapByArticle.set(id, data);
      }
    }

    document.body.addEventListener('click', e => {
      const bm = e.target.closest('.nw-bm');
      if (bm) toggleScrap(bm);
    });
    moreBtn.addEventListener('click', loadMore);

    // ── 내 스크랩 로드(로그인 시) — 북마크 상태 표시용 ──
    async function loadMyScraps() {
      const { data, error } = await MONC.sb.from('news_scraps').select('id, article_id, note');
      if (error) return;                               // 테이블 미생성 → 스크랩 기능만 조용히 비활성
      scrapByArticle = new Map((data || []).map(r => [r.article_id, { id: r.id, note: r.note }]));
      document.getElementById('nwScrapTab').hidden = false;
      // 이미 렌더된 카드에 북마크 상태 반영
      listEl.querySelectorAll('.nw-bm').forEach(b => {
        const on = scrapByArticle.has(b.dataset.id);
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      });
    }

    (async () => {
      session = await MONC.getSession();
      buildFilters();
      resetAndLoad();
      if (session) loadMyScraps();
    })();
  })();
  </script>
</body>
</html>
```

- [ ] **Step 2: 브라우저 검증 (375px)**

로컬 프리뷰(`wkon-static`)에서 `news.html` 열기:
- 마이그레이션 전이므로 "뉴스 게시판을 준비 중이에요" 폴백이 떠야 정상(콘솔에 미처리 예외 없어야 함).
- 375px에서 히어로·탭 레이아웃 확인.

- [ ] **Step 3: 커밋**

```bash
git add news.html
git commit -m "feat(뉴스): news.html 공개 게시판 — 항공사·주제 필터칩, 북마크 토글(비로그인 → 로그인 유도), 20건 페이지네이션, 마이그레이션 전 폴백"
```

---

### Task 5: news.html '내 스크랩' 탭 — 항공사별 그룹핑 + 활용 메모

**Files:**
- Modify: `news.html` (Task 4에서 만든 파일)

- [ ] **Step 1: 스크랩 뷰 마크업·CSS 추가**

`<main class="container">` 안, `.nw-count` 위에 추가:

```html
    <div id="nwScrapView" hidden>
      <p class="nw-scrap-lead">스크랩한 기사에 <b>활용 메모</b>를 남겨보세요 — "이 기사를 어느 답변에 어떻게 쓸지" 한 줄이면 면접 준비가 빨라져요.</p>
      <div id="nwScrapGroups"></div>
      <div class="nw-empty" id="nwScrapEmpty" hidden>아직 스크랩한 기사가 없어요. <br><button class="nw-more" type="button" style="margin-top:14px" onclick="document.querySelector('[data-tab=all]').click()">뉴스 보러 가기</button></div>
    </div>
```

`<style>`에 추가:

```css
    /* 내 스크랩 — 항공사별 그룹 + 활용 메모 */
    .nw-scrap-lead { font-size: 14px; color: var(--text-muted); margin: 16px 2px 6px; }
    .nw-scrap-lead b { color: var(--accent-ink); }
    .nw-group-h { display: flex; align-items: baseline; gap: 8px; margin: 22px 2px 10px; }
    .nw-group-name { font-family: var(--serif); font-size: 19px; font-weight: 700; }
    .nw-group-n { font-size: 13px; font-weight: 700; color: var(--accent-ink); }
    .nw-note { margin: 0 16px 14px; padding: 10px 12px; border-left: 3px solid var(--action); background: var(--surface2); border-radius: 0 var(--radius-xs) var(--radius-xs) 0; font-size: 13.5px; }
    .nw-note-btn { appearance: none; cursor: pointer; border: 0; background: none; font: inherit; font-size: 12.5px; font-weight: 700; color: var(--accent-ink); padding: 0 16px 14px; min-height: 32px; }
    .nw-note-edit { margin: 0 16px 14px; }
    .nw-note-edit textarea { width: 100%; min-height: 64px; padding: 10px 12px; font: inherit; font-size: 14px; border: 1px solid var(--border); border-radius: var(--radius-xs); resize: vertical; }
    .nw-note-edit .row { display: flex; gap: 8px; margin-top: 8px; }
    .nw-note-save { appearance: none; cursor: pointer; border: 0; background: var(--action); color: var(--action-ink); font: inherit; font-size: 13px; font-weight: 800; padding: 9px 18px; border-radius: 999px; min-height: 40px; }
    .nw-note-cancel { appearance: none; cursor: pointer; border: 1px solid var(--border); background: var(--surface); color: var(--text-muted); font: inherit; font-size: 13px; font-weight: 700; padding: 9px 16px; border-radius: 999px; min-height: 40px; }
```

- [ ] **Step 2: 탭 전환 + 스크랩 렌더 JS 추가**

IIFE 안(기존 `(async () => { ... })();` 위)에 추가:

```js
    // ── 탭 전환: 전체 뉴스 ↔ 내 스크랩 ──
    const scrapView = document.getElementById('nwScrapView');
    const allView = [filtersEl, countEl, listEl, emptyEl, moreBtn.parentElement, skelEl];
    let filtersWereHidden = true;   // 필터바는 데이터 유무로 hidden이 결정되므로 상태 보존
    function switchTab(tab) {
      document.querySelectorAll('.nw-tab').forEach(b => {
        const on = b.dataset.tab === tab;
        b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on));
      });
      if (tab === 'scraps') {
        filtersWereHidden = filtersEl.hidden;
        allView.forEach(el => { el.hidden = true; });
        scrapView.hidden = false;
        renderScraps();
      } else {
        scrapView.hidden = true;
        allView.forEach(el => { el.hidden = false; });
        filtersEl.hidden = filtersWereHidden;
        skelEl.hidden = true;
        moreBtn.hidden = exhausted;
        if (!offset) emptyEl.hidden = false; else emptyEl.hidden = true;
      }
    }
    document.querySelectorAll('.nw-tab').forEach(b =>
      b.addEventListener('click', () => switchTab(b.dataset.tab)));

    // ── 내 스크랩 렌더 — 항공사별 그룹핑(스펙 §5: 면접 준비 흐름) ──
    async function renderScraps() {
      const wrap = document.getElementById('nwScrapGroups');
      const empty = document.getElementById('nwScrapEmpty');
      const { data, error } = await MONC.sb.from('news_scraps')
        .select('id, note, created_at, news_articles(id, title, url, source, published_at, airline, topic)')
        .order('created_at', { ascending: false });
      if (error) { wrap.innerHTML = ''; empty.hidden = false; return; }
      const rows = (data || []).filter(r => r.news_articles);
      if (!rows.length) { wrap.innerHTML = ''; empty.hidden = false; return; }
      empty.hidden = true;

      // 항공사별 그룹(고정 순서), 미분류는 '기타'로 맨 뒤
      const groups = new Map();
      for (const r of rows) {
        const key = r.news_articles.airline || '_etc';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
      const order = [...AIRLINE_ORDER.filter(k => groups.has(k)), ...(groups.has('_etc') ? ['_etc'] : [])];

      wrap.innerHTML = order.map(key => {
        const list = groups.get(key);
        const name = key === '_etc' ? '기타' : (AIRLINE_LABEL[key] || key);
        const cards = list.map(r => {
          const a = r.news_articles;
          const chips = a.topic ? `<span class="nw-tag nw-tag-topic">${esc(TOPIC_LABEL[a.topic] || a.topic)}</span>` : '';
          const note = r.note
            ? `<div class="nw-note" data-scrap="${esc(r.id)}">${esc(r.note)}</div>
               <button class="nw-note-btn" type="button" data-scrap="${esc(r.id)}">메모 수정</button>`
            : `<button class="nw-note-btn" type="button" data-scrap="${esc(r.id)}">+ 활용 메모 남기기</button>`;
          return `<li class="nw-card" data-id="${esc(a.id)}">
            <a class="nw-link" href="${esc(a.url)}" target="_blank" rel="noopener">
              <div class="nw-card-title">${esc(a.title)}</div>
              <div class="nw-card-meta">${chips}<span>${esc(a.source || '')}</span><span>${relTime(a.published_at)}</span></div>
            </a>
            ${note}
            <button class="nw-bm on" type="button" data-id="${esc(a.id)}" aria-label="스크랩 해제" aria-pressed="true">${BM_SVG}</button>
          </li>`;
        }).join('');
        return `<div class="nw-group-h"><span class="nw-group-name">${esc(name)}</span><span class="nw-group-n">${list.length}건</span></div>
          <ul class="nw-list">${cards}</ul>`;
      }).join('');
    }

    // ── 활용 메모 인라인 편집 ──
    scrapView.addEventListener('click', async e => {
      const btn = e.target.closest('.nw-note-btn');
      if (btn) {
        const scrapId = btn.dataset.scrap;
        const noteEl = scrapView.querySelector(`.nw-note[data-scrap="${scrapId}"]`);
        const current = noteEl ? noteEl.textContent : '';
        const editor = document.createElement('div');
        editor.className = 'nw-note-edit';
        editor.innerHTML = `<textarea maxlength="500" placeholder="예: 신규 취항 소식 → 지원동기에 연결">${esc(current)}</textarea>
          <div class="row"><button class="nw-note-save" type="button">저장</button><button class="nw-note-cancel" type="button">취소</button></div>`;
        if (noteEl) noteEl.hidden = true;
        btn.hidden = true;
        btn.insertAdjacentElement('afterend', editor);
        const ta = editor.querySelector('textarea'); ta.focus();
        editor.querySelector('.nw-note-cancel').addEventListener('click', () => {
          editor.remove(); btn.hidden = false; if (noteEl) noteEl.hidden = false;
        });
        editor.querySelector('.nw-note-save').addEventListener('click', async () => {
          const val = ta.value.trim() || null;
          const { error } = await MONC.sb.from('news_scraps').update({ note: val }).eq('id', scrapId);
          if (error) { alert('메모 저장에 실패했어요. 잠시 후 다시 시도해주세요.'); return; }
          // 로컬 캐시 갱신 후 다시 렌더(그룹 구조 유지가 단순)
          for (const [aid, row] of scrapByArticle) if (row.id === scrapId) scrapByArticle.set(aid, { ...row, note: val });
          renderScraps();
        });
        return;
      }
      // 스크랩 뷰에서 북마크 해제 → 목록에서 제거(재렌더)
      const bm = e.target.closest('.nw-bm');
      if (bm) { await toggleScrap(bm); renderScraps(); }
    });
```

주의: Task 4의 전역 북마크 위임(`document.body.addEventListener('click', ...)`)이 스크랩 뷰의 북마크에도 반응한다. **이중 처리를 막기 위해** Task 4의 위임을 다음으로 교체:

```js
    document.body.addEventListener('click', e => {
      if (e.target.closest('#nwScrapView')) return;   // 스크랩 뷰는 자체 핸들러가 처리
      const bm = e.target.closest('.nw-bm');
      if (bm) toggleScrap(bm);
    });
```

- [ ] **Step 3: 딥링크(`?tab=scraps`) 처리**

기존 부트스트랩 `(async () => { ... })();`를 다음으로 교체:

```js
    (async () => {
      session = await MONC.getSession();
      buildFilters();
      resetAndLoad();
      if (session) {
        await loadMyScraps();
        // mypage '전체 보기'에서 진입 시 스크랩 탭 바로 열기
        if (new URLSearchParams(location.search).get('tab') === 'scraps'
            && !document.getElementById('nwScrapTab').hidden) switchTab('scraps');
      }
    })();
```

- [ ] **Step 4: 브라우저 검증 (375px)**

- 비로그인: '내 스크랩' 탭이 안 보이고, 북마크 클릭 시 로그인 유도 confirm.
- (마이그레이션 전이라 데이터 검증은 배포 후 — 콘솔 미처리 예외 없음만 확인.)

- [ ] **Step 5: 커밋**

```bash
git add news.html
git commit -m "feat(뉴스): 내 스크랩 탭 — 항공사별 그룹핑 + 활용 메모 인라인 편집(답변 재료함), ?tab=scraps 딥링크"
```

---

### Task 6: mypage 스크랩 요약 카드

**Files:**
- Modify: `mypage.html` — secnav(157행 근처)와 `#sec-apps` 카드(205행 근처) 뒤, 부트스트랩 IIFE(479행 근처)

- [ ] **Step 1: secnav에 칩 추가**

`<a href="#sec-apps" class="secnav-chip">신청 내역</a>` 다음 줄에:

```html
        <a href="#sec-news" class="secnav-chip" id="newsChip" style="display:none;">뉴스 스크랩</a>
```

- [ ] **Step 2: 카드 마크업 추가**

`#sec-apps` 카드 `</div>` 직후(연락처 카드 앞)에:

```html
      <div class="card" id="sec-news" style="display:none;">
        <h2>내 뉴스 스크랩</h2>
        <p class="hint">스크랩한 항공 뉴스가 항공사별로 쌓여요 — 면접 답변 재료로 쓰세요.</p>
        <ul class="news-list" id="newsScraps"></ul>
        <div id="newsSummary" style="font-size:13px;color:var(--text-muted);margin-top:10px;"></div>
        <a id="newsMore" href="news.html?tab=scraps" style="display:inline-flex;align-items:center;gap:6px;margin-top:14px;font-size:14px;font-weight:700;color:var(--accent-ink);text-decoration:none;min-height:44px;">전체 보기 →</a>
      </div>
```

`<style>`(133행 근처, `.note-draft .note-more` 뒤)에 추가:

```css
    /* 내 뉴스 스크랩 */
    .news-list { list-style: none; }
    .news-list li { padding: 10px 0; border-bottom: 1px solid var(--border-soft); }
    .news-list li:last-child { border-bottom: 0; }
    .news-list a { text-decoration: none; display: block; }
    .news-list a:hover .nl-title { color: var(--accent-dark); }
    .nl-title { font-size: 14px; font-weight: 700; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
    .nl-meta { display: flex; gap: 6px; align-items: center; margin-top: 4px; font-size: 12px; color: var(--text-muted); }
    .nl-air { display: inline-block; background: var(--accent-tint); color: var(--accent-ink); font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
```

- [ ] **Step 3: 로드 JS 추가**

`<script>` 안에 함수 추가(예: `loadAnswerNotes` 함수 뒤):

```js
    // ── 내 뉴스 스크랩 카드 — 최근 3건 + 항공사별 개수(스펙 §6) ──
    //    news_scraps 테이블 미생성(마이그레이션 전)이면 카드·칩을 숨긴 채로 둔다.
    async function loadNewsScraps() {
      const AIRLINE_LABEL_MP = { kal:'대한항공', asiana:'아시아나항공', jinair:'진에어', jejuair:'제주항공', twayair:'티웨이항공', airbusan:'에어부산', airseoul:'에어서울', eastarjet:'이스타항공', airpremia:'에어프레미아', aerok:'에어로케이' };
      try {
        const { data, error } = await MONC.sb.from('news_scraps')
          .select('created_at, news_articles(title, url, airline)')
          .order('created_at', { ascending: false });
        if (error) return;                                   // 테이블 미생성 → 카드 숨김 유지
        document.getElementById('sec-news').style.display = '';
        document.getElementById('newsChip').style.display = '';
        const rows = (data || []).filter(r => r.news_articles);
        const listEl = document.getElementById('newsScraps');
        if (!rows.length) {
          listEl.innerHTML = '<li style="color:var(--text-muted);border:0;">항공 뉴스를 스크랩하면 여기에 쌓여요.</li>';
          document.getElementById('newsMore').innerHTML = '뉴스 보러 가기 →';
          document.getElementById('newsMore').href = 'news.html';
          return;
        }
        listEl.innerHTML = rows.slice(0, 3).map(r => {
          const a = r.news_articles;
          const air = a.airline ? `<span class="nl-air">${esc(AIRLINE_LABEL_MP[a.airline] || a.airline)}</span>` : '';
          return `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">
            <div class="nl-title">${esc(a.title)}</div><div class="nl-meta">${air}</div></a></li>`;
        }).join('');
        // 항공사별 개수 요약("대한항공 4 · 아시아나항공 2 · …")
        const counts = {};
        rows.forEach(r => { const k = r.news_articles.airline; if (k) counts[k] = (counts[k] || 0) + 1; });
        const summary = Object.entries(counts).sort((x, y) => y[1] - x[1])
          .map(([k, n]) => `${AIRLINE_LABEL_MP[k] || k} ${n}`).join(' · ');
        document.getElementById('newsSummary').textContent =
          `총 ${rows.length}건` + (summary ? ` — ${summary}` : '');
      } catch (_) { /* 카드 숨김 유지 */ }
    }
```

부트스트랩 IIFE의 `loadAnswerNotes(me);` 다음 줄에 호출 추가:

```js
      loadNewsScraps();
```

- [ ] **Step 4: 브라우저 검증**

로그인 상태 확인이 로컬에선 어려우므로: mypage.html을 열어 콘솔 미처리 예외가 없는지, 카드가 기본 숨김(`display:none`)인지 확인. (마이그레이션 적용 후 실계정으로 재검증 — Task 8.)

- [ ] **Step 5: 커밋**

```bash
git add mypage.html
git commit -m "feat(뉴스): mypage 스크랩 요약 카드 — 최근 3건·항공사별 개수, 테이블 미생성 시 숨김 폴백"
```

---

### Task 7: 내비게이션에 '뉴스' 링크

**Files:**
- Modify: `index.html:74` (데스크톱 nav), `index.html:93` (모바일 메뉴)
- Modify: `researchers.html:292` (데스크톱 nav) — 모바일 메뉴는 실행 시 `Grep pattern:"mobile-menu" path:researchers.html`로 확인해 있으면 같이 추가

- [ ] **Step 1: index.html 링크 추가**

데스크톱 `.nav-links`(74행) `후기` 다음에:

```html
      <li><a href="news.html">뉴스</a></li>
```

모바일 메뉴 ul(93행) `후기` 다음에:

```html
    <li><a href="news.html">뉴스</a></li>
```

- [ ] **Step 2: researchers.html 링크 추가**

`.nav-links`(292행) `후기` 다음에 동일하게. 모바일 메뉴가 있으면(grep) 거기도.

- [ ] **Step 3: 375px에서 nav 확인**

index를 375px 프리뷰로 열어 모바일 메뉴에 '뉴스'가 뜨는지, 줄바꿈·정렬 깨짐 없는지 확인. (index 히어로가 무거워 스크린샷이 얼면 DOM 쿼리로 링크 존재만 확인 — 메모리 `wkon-preview-heavy-hero` 참조.)

- [ ] **Step 4: 커밋**

```bash
git add index.html researchers.html
git commit -m "feat(뉴스): nav·모바일 메뉴에 뉴스 링크 추가"
```

---

### Task 8: 배포 + 오너 안내 + 실데이터 검증

- [ ] **Step 1: push 배포**

```bash
git push origin main
```

- [ ] **Step 2: 오너 안내 메시지 출력**

대화에서 오너에게 두 가지 1회 작업 안내:
1. Supabase SQL Editor에서 `supabase/migrations/20260721120000_news_board.sql` 실행.
2. GitHub 리포 → Settings → Secrets and variables → Actions → New repository secret → 이름 `SUPABASE_SERVICE_ROLE_KEY`, 값은 Supabase 대시보드 → Settings → API → `service_role` 키.
3. (선택) Actions 탭 → '항공 뉴스 수집' → Run workflow로 즉시 1회 수집.

- [ ] **Step 3: 실데이터 검증 (오너 작업 완료 후)**

- Actions 실행 로그에서 `수집 N건 / 신규 N건 저장` 확인.
- 배포된 news.html에서: 기사 목록 렌더, 필터칩(데이터 존재값만), 상대시각, 원문 새탭.
- 로그인 계정으로: 북마크 토글 → 내 스크랩 탭 항공사별 그룹 확인 → 메모 저장 → mypage 카드 반영.
- 시크릿 창(비로그인): 목록은 보이고 '내 스크랩' 탭은 안 보이며, 북마크 클릭 시 로그인 유도.

---

## 자체 검토 결과

- 스펙 커버리지: §2 슬러그·분류(Task 2)·§3 테이블·RLS·폴백(Task 1·4·6)·§4 수집기·워크플로(Task 2·3)·§5 게시판·탭·메모(Task 4·5)·§6 mypage(Task 6)·§7 nav(Task 7) — 전부 태스크에 매핑.
- 타입 일관성: 슬러그 3곳(fetch-news.mjs `AIRLINES`/news.html `AIRLINE_LABEL`/mypage `AIRLINE_LABEL_MP`) 동일 문자열 확인. `news_scraps` 컬럼(id, member_id, article_id, note, created_at)과 클라이언트 select 일치.
- 미해결 없음(placeholder 없음). researchers.html 모바일 메뉴만 실행 시 grep으로 확인(파일 미열람 구간).
