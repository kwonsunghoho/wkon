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
  // '이스타'는 제목에서 줄여 쓰는 표기("이스타-관광공사, 중화권 방한객 유치").
  // 없으면 그 기사가 항공 관련성 게이트에서 '항공무관'으로 잘린다(실측 오탐).
  { slug: 'eastarjet', name: '이스타항공',   alias: ['이스타항공', '이스타 항공', '이스타'] },
  { slug: 'airpremia', name: '에어프레미아', alias: ['에어프레미아'] },
  { slug: 'aerok',     name: '에어로케이',   alias: ['에어로케이'] },
];

// 참사 보도 제외(2026-07-22 오너 결정) — 승무원 지망생이 보는 화면이라 수집 단계에서 뺀다.
// ⚠️ RESCUE 예외를 지우지 말 것: "승무원 신속 대응으로 참사 막았다"류는 참사 보도가 아니라
//    승무원 대응 미담이고, 준비생에겐 오히려 최상급 면접 소재다(실데이터에서 실제로 오탐된 자리).
const EXCLUDE = /참사|유가족|희생자|분향소|추모|위령|유해\s*수습|재수색|사고 조사|여객기 추락|기체 추락/;
const RESCUE  = /막았|막아|막은|예방|모면|방지|무사히/;
const isExcluded = t => EXCLUDE.test(t) && !RESCUE.test(t);

// ── 취업과 무관한 보도 제외(2026-07-30 오너 지시) ─────────────────────────────
// 항공사 이름으로 검색하면 같은 이름을 쓰는 스포츠단·주식 종목이 함께 딸려 온다.
// 실측(2026-07-30 뉴스판 상단): "대한항공 방출 선수, 한국전력 이적을 운명이라…"(프로배구),
// "대한항공우 투자분석"(우선주 시황), "현대차, 수소·SMR 기술 협력"(항공 무관),
// "아시아나 주가·합병 전환가치 하락 : 네이버 블로그"(개인 블로그).
// 승준생이 면접 재료로 쓸 수 없는 것들이라 수집 단계에서 뺀다.
//
// ⚠️ 세 갈래를 각각 다른 방법으로 막는다 — 하나로 묶으려 하지 말 것:
//   ① 스포츠·시황은 '있으면 버리는' 낱말로 (블랙리스트)
//   ② 항공 무관 기업 기사는 낱말을 셀 수 없으니 '항공 낱말이 하나도 없으면 버린다' (화이트리스트)
//   ③ 블로그·카페는 제목이 아니라 출처로 판단
// ⚠️ 경영·실적·합병·유가·화물은 빼지 않는다 — 기업분석 면접 답변의 핵심 재료다.
//    거르는 건 '투자 판단용 시황'(목표주가·투자의견)뿐이다.

// ① 스포츠단 — 대한항공 점보스(프로배구) 등.
// ⚠️ '방출'을 단독으로 넣지 말 것: "탄소 방출"류 환경 규제 기사가 같이 날아간다.
// ⚠️ '선수'도 단독 금지: 항공권 "선수금"이 걸린다. '감독'도 단독 금지: "금융감독원".
// ⚠️ '골프'를 넣지 말 것: "에어서울, 항공·숙박·골프 묶은 원스톱 여행"처럼 항공사가 파는
//    여행 상품 기사가 같이 날아간다(실측 오탐). 골프단 협찬 기사만 좁게 잡는다.
// ⚠️ '배구' 앞의 (?<!지) 를 지우지 말 것: 없으면 '지배구조'가 걸려
//    "계열사 지배구조 정비·마일리지 통합…대한항공의 숙제" 같은 경영 기사가 스포츠로 잘린다(실측 오탐).
const SPORTS = /(?<!지)배구|점보스|V리그|V-리그|프로야구|야구단|축구|농구|골프단|프로골퍼|선수단|프로 선수|이적|트레이드|사령탑|감독 선임|감독 사퇴|구단|세터|리베로|미들블로커|아웃사이드 히터|스파이크|블로킹|플레이오프|챔피언결정전|올스타|개막전|리그 우승/;

// ② 투자 판단용 시황 — ⚠️ '실적·매출·합병·주가' 자체는 남긴다(TOPICS 의 biz 로 분류돼 쓰인다).
// ⚠️ 우선주 종목명 뒤의 (?![가-힣]) 를 지우지 말 것: 없으면 '제주항공우'가
//    "제주항공우주박물관"에 걸려 과학관 기사가 시황으로 잘린다(실측 오탐 2건).
const STOCKS = /투자분석|투자의견|목표주가|적정주가|매수의견|매도의견|상한가|하한가|신고가|신저가|테마주|관련주|급등주|주가 전망|주가 흐름|기술적 분석|배당수익률|공매도|(?:대한항공|아시아나항공|제주항공)우(?![가-힣])/;

// ③ 개인 블로그·카페 — 출처로 판단(제목에 " : 네이버 블로그" 꼬리가 붙는 경우도 함께 본다)
const BAD_SOURCE = /블로그|blog|티스토리|tistory|브런치|brunch|디시인사이드|클리앙|뽐뿌|인스티즈/i;

// ④ 여행상품·판촉 보도(2026-08-01 오너 지시 "여행사 상품기사를 왜 스크랩하는거야")
// 여행사 패키지 출시, 항공권 특가·할인, 소비자용 '출국 꿀팁' 보도자료는 승무원 준비생이
// 면접 재료로 쓸 수 없다. 실측(1,000건)에서 58건 — 그중 '대한항공 출국 꿀팁' 한 건의
// 받아쓰기만 13건이라 뉴스판 첫 화면을 통째로 덮고 있었다.
// ⚠️ 항공사가 파는 상품이라도 판촉 기사는 뺀다. 남기는 건 그 판촉을 '업계 현상'으로 분석한
//    기사뿐이고, 그 구분은 아래 AD_KEEP 이 한다.
const TRAVEL_AD = /하나투어|모두투어|노랑풍선|참좋은여행|한진트래블|인터파크투어|온라인투어|웹투어|여행박사|마이리얼트립|여기어때|야놀자|트립닷컴|스카이스캐너|익스피디아|아고다|부킹닷컴|투어비스|특가|초특가|땡처리|얼리버드|할인|프로모션|경품|사은품|증정|반값|이벤트|감사제|감사 행사|무료 제공|무료 지원|꿀팁|여행 팁|가지 팁|가볼 만한|가볼만한|명소|맛집|호캉스|힐링 여행|여행지 추천|추천 여행지|피서지|패키지 (?:출시|선보|판매|공개)|여행상품 (?:출시|선보|판매)|전세기 상품|상품 출시/;

// ⚠️ AD_KEEP 을 지우지 말 것 — 판촉 낱말이 들어간 업계 분석 기사를 되살리는 예외다.
//    실측 오탐: "휴가철 프로모션 대거 쏟아낸 LCC…'출혈경쟁' 우려 커진다"(LCC 수익성 분석).
const AD_KEEP = /출혈|경쟁 심화|우려|적자|흑자|손실|영업이익|실적|매출|점유율|전망|분석|인수|합병|증자|파업|노조|채용|취항|운수권|제재|과징금|소송|공정위/;

// ⑤ 제주항공우주박물관 — 항공사 '제주항공'과 무관한 JDC 산하 과학관인데 이름이 겹친다.
// 실측 15건이 전부 airline='jejuair' 로 잘못 분류돼, 항공사 필터에서 제주항공을 고르면
// 천문캠프·입장료 할인 기사가 나왔다. ⚠️ '항공우주산업'(KAI)은 걸리지 않는다 — 넓히지 말 것.
const MUSEUM = /항공우주박물관|우주박물관/;

// 항공 관련성 게이트 — 제목에 이 중 하나도 없으면 항공 기사가 아니다.
// ⚠️ '민항기'는 '항공'을 포함하지 않는다(민+항+기) — 따로 넣어야 엠브라에르 협력 기사가 산다.
// ⚠️ '한진칼·한진그룹'을 빼지 말 것: 대한항공 지주사 경영권 분쟁은 면접 단골 소재인데
//    제목에 '항공'이 없어 통째로 걸러지고 있었다(실측 오탐 4건).
// ⚠️ '에어'만 잘라 쓰지 말 것 — "에어컨 고장"이 걸린다. 항공사 이름은 아래 alias 로 판단한다.
// ⚠️ '결항·회항·탑승·수하물'을 빼지 말 것: 제목에 항공사 이름도 '항공'도 없이 사건만 적는
//    기사가 있다("승객 200여 명 탑승한 채 3시간 기다리다 결항" — 실측 오탐).
const AVIATION = /항공|공항|비행기|여객기|화물기|민항기|기내|승무원|객실|조종사|파일럿|기장|취항|노선|운항|항공권|활주로|이착륙|국제선|국내선|저비용항공|LCC|하늘길|운수권|한진칼|한진그룹|결항|회항|탑승|수하물|기재 도입/;

// 항공사 이름이 제목에 있으면 그것만으로 항공 기사다.
// ⚠️ 이 줄이 없으면 '진에어'·'에어프레미아'·'티웨이'처럼 이름에 '항공'이 없는 6개 항공사
//    기사가 전부 '항공무관'으로 잘린다(실측: "에어프레미아, 1100억 유상증자"가 사라졌다).
const mentionsAirline = t => AIRLINES.some(a => a.alias.some(al => t.includes(al)));

// 제외 사유 — dry-run 에서 어떤 규칙이 몇 건을 걷어냈는지 보여주려고 사유를 돌려준다.
function dropReason(title, source) {
  if (isExcluded(title)) return '참사';
  if (SPORTS.test(title)) return '스포츠';
  if (STOCKS.test(title)) return '시황';
  if (MUSEUM.test(title)) return '박물관';
  if (TRAVEL_AD.test(title) && !AD_KEEP.test(title)) return '여행상품';
  if (BAD_SOURCE.test(source || '') || BAD_SOURCE.test(title)) return '블로그';
  if (!AVIATION.test(title) && !mentionsAirline(title)) return '항공무관';
  return null;
}

// ⚠️ 저장할 때와 기존 저장분을 청소할 때 반드시 이 함수 하나를 같이 쓸 것.
// 분류(classify)와 달리 '제외'는 저장 시점에 굳으므로, 규칙만 고치고 청소를 안 하면
// 이미 들어온 배구 기사가 뉴스판 맨 위에 그대로 남는다(실제로 그 상태였다).
const isDropped = (title, source) => dropReason(title, source) !== null;

// 주제 분류 — 첫 매칭 우선(준비생에게 가장 중요한 채용을 맨 앞에)
// 2026-07-22 키워드 확대: 실데이터 933건에서 미분류가 64%였다(주제 필터가 3분의 1만 걸러냄).
// 아래 확대로 38%까지 내려간다. 남은 미분류는 대부분 '폭염 현장점검'류 홍보성 보도자료라
// 억지로 채우면 카테고리만 오염되므로 그대로 둔다 — 전체 탭에서는 어차피 보인다.
const TOPICS = [
  { slug: 'recruit', re: /채용|공채|모집|승무원 선발|채용설명회|신입|인턴|합격자|지원자|면접|인력 충원|승무원 되/ },
  { slug: 'route',   re: /취항|노선|증편|재운항|복항|단항|운항 재개|직항|운수권|슬롯|하계 스케줄|동계 스케줄/ },
  { slug: 'biz',     re: /실적|영업이익|매출|인수|합병|유상증자|흑자|적자|유가|항공권|특가|주가|지분|매각|경영|통합|점유율|수요|성수기|비수기|화물|투자|자본|부채|리스|노조|노사|임단협|연공서열|얼라이언스|동맹|제휴/ },
  { slug: 'service', re: /기내|서비스|유니폼|라운지|기내식|좌석|마일리지|수하물|체크인|고객|승객|편의|어메니티|엔터테인먼트/ },
  { slug: 'policy',  re: /국토부|공항|안전|사고|규제|지연|결항|항공법|정부|과징금|제재|면허|점검|검역|입국|비자|관제/ },
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

// 제목 정규화 — 받아쓰기 기사(제목이 글자까지 똑같고 언론사만 다름) 스킵용
const normTitle = s => s.replace(/[\s\[\]()"'“”‘’·…‥,.?!\-]/g, '').toLowerCase();

// ── 같은 사건 받아쓰기 묶기 ──────────────────────────────────────────────────
// 보도자료 하나를 수십 개 언론사가 제목만 조금씩 바꿔 싣는다. 완전일치(normTitle)로는
// 한 건도 못 잡아서, 실측 당시 DB 1,000건 중 450건(45%)이 같은 사건 중복이었다
// (진에어 이창 취항 1건 = 26개 기사, 대한항공 출국 꿀팁 1건 = 13개 기사).
// 제목을 낱말 집합으로 보고 자카드 유사도로 묶는다.
// ⚠️ DUP_MIN 0.5 는 실데이터 1,000건으로 고른 값이다 — 0.4 로 내리면 51%가 묶이지만
//    다른 사건이 한 묶음에 섞여 멀쩡한 기사가 사라진다(제외 필터와 같은 실패 모드).
//    임계값을 건드렸으면 '묶인 목록'을 눈으로 확인할 것.
const DUP_MIN = 0.5;
// ⚠️ 낱말이 이보다 적은 제목은 자카드가 흔들려 묶지 않는다(완전일치로만 잡는다).
//    실측 오탐: "[에어 라이브] 대한항공ㆍ제주항공" 과 "[에어 라이브] 대한항공ㆍ티웨이항공ㆍ에어캐나다"
//    는 다른 날 다른 코너인데 낱말이 셋뿐이라 0.5 를 넘겼다.
const DUP_MIN_TOKENS = 5;
// ⚠️ 대괄호 말머리([에어 라이브]·[단독]·[MD인터뷰])는 기사 내용이 아니라 코너명이다.
//    토큰에 남기면 같은 코너의 다른 기사끼리 묶인다.
const tokenize = t => new Set(
  t.replace(/\[[^\]]{0,20}\]/g, ' ')
   .replace(/[^가-힣A-Za-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 2));
function similar(a, b) {
  if (a.size < DUP_MIN_TOKENS || b.size < DUP_MIN_TOKENS) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

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

// id 목록 삭제 — uuid 36자를 URL에 나열하므로 100개씩 끊는다(한 번에 500개면 URL이 18KB를 넘겨
// 게이트웨이가 414로 끊는다). 빈 배열이면 요청 자체를 보내지 않는다.
async function deleteIds(ids) {
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    await sbFetch(`news_articles?id=in.(${chunk.join(',')})`, { method: 'DELETE' });
  }
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

  // 2) 무관 보도 제외 + 분류 + 이번 배치 안의 같은 사건 중복 제거
  const seen = new Set();
  const rows = [];
  const rowTk = [];                           // rows 와 같은 순서의 제목 토큰
  // ⚠️ 토큰은 rows 행에 넣지 말 것 — 그대로 upsert 본문에 실려 없는 컬럼으로 400 이 난다.
  const drops = new Map();                    // 사유 → [제목] (dry-run 검증용)
  const dupPairs = [];                        // [버린 제목, 이미 채택한 제목] (dry-run 검증용)
  for (const it of collected.values()) {
    const why = dropReason(it.title, it.source);
    if (why) {
      if (!drops.has(why)) drops.set(why, []);
      drops.get(why).push(it.title);
      continue;
    }
    const key = normTitle(it.title);
    if (seen.has(key)) { dupPairs.push([it.title, '(제목 완전 일치)']); continue; }
    const tk = tokenize(it.title);
    const hit = rowTk.findIndex(t => similar(t, tk) >= DUP_MIN);
    if (hit >= 0) { dupPairs.push([it.title, rows[hit].title]); continue; }
    seen.add(key);
    rowTk.push(tk);
    rows.push({ ...it, ...classify(it.title) });
  }
  const droppedTotal = [...drops.values()].reduce((a, v) => a + v.length, 0);
  console.log(`제외 ${droppedTotal}건 — `
    + ([...drops].map(([w, v]) => `${w} ${v.length}`).join(' · ') || '없음'));
  console.log(`같은 사건 중복 ${dupPairs.length}건 묶음`);

  if (DRY) {
    // ⚠️ 규칙을 고쳤으면 '버린 것'을 눈으로 확인할 것 — 이 필터는 못 걸러서가 아니라
    //    멀쩡한 기사를 걷어내서 망한다(AI킬러 규칙과 같은 실패 모드).
    for (const [why, list] of drops) {
      console.log(`\n── 제외: ${why} (${list.length}건) ─────────────────`);
      for (const t of list.slice(0, 8)) console.log(`  ✗ ${t}`);
      if (list.length > 8) console.log(`  … 외 ${list.length - 8}건`);
    }
    // 중복 묶기도 '버린 쪽'을 봐야 한다 — 다른 사건이 한 묶음에 섞이면 기사가 사라진다.
    if (dupPairs.length) {
      console.log(`\n── 같은 사건으로 묶어 버림 (${dupPairs.length}건) ─────────────────`);
      for (const [dropped, kept] of dupPairs.slice(0, 10))
        console.log(`  ✗ ${dropped}\n    ↳ 남긴 것: ${kept}`);
      if (dupPairs.length > 10) console.log(`  … 외 ${dupPairs.length - 10}건`);
    }
    console.log(`\n── 저장 대상 (상위 30건) ─────────────────`);
    for (const r of rows.slice(0, 30))
      console.log(`  [${r.airline || '-'}/${r.topic || '-'}] ${r.title} (${r.source || '?'})`);
    const unclassified = rows.filter(r => !r.topic).length;
    console.log(`\ndry-run: 저장 대상 ${rows.length}건 · 주제 미분류 ${unclassified}건`
                + ` (${(unclassified / rows.length * 100).toFixed(0)}%)`);
    return;
  }

  // 3) DB 최근 제목과 대조(과거 수집분의 받아쓰기 기사 방어) — 최근 500건이면 충분
  // ⚠️ 완전일치만 보면 안 된다. 같은 보도자료가 3시간 뒤 배치에 다른 제목으로 또 들어온다.
  const recent = await (await sbFetch('news_articles?select=title&order=created_at.desc&limit=500')).json();
  const dbTitles = new Set(recent.map(r => normTitle(r.title)));
  const dbTk = recent.map(r => tokenize(r.title));
  const fresh = rows.filter((r, i) =>
    !dbTitles.has(normTitle(r.title)) && !dbTk.some(t => similar(t, rowTk[i]) >= DUP_MIN));

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
  await deleteIds(deletable);
  console.log(`정리 ${deletable.length}건 삭제 (90일 경과·스크랩 없음)`);

  // 6) 규칙이 생기기 전에 들어온 무관 보도 청소 — 스크랩된 건 여기서도 남긴다
  // ⚠️ 수집 때와 같은 isDropped 를 쓴다. '제외'는 분류와 달리 저장 시점에 굳으므로
  //    이 스텝이 없으면 규칙을 고쳐도 배구·시황 기사가 뉴스판에 그대로 남는다.
  // ⚠️ source 를 같이 받아야 블로그 출처 판정이 기존 저장분에도 걸린다.
  const stored = await (await sbFetch(
    'news_articles?select=id,title,source,airline,topic,published_at,news_scraps(id)&limit=2000')).json();
  const purge = stored
    .filter(a => isDropped(a.title, a.source) && !(a.news_scraps || []).length)
    .map(a => a.id);
  await deleteIds(purge);
  console.log(`무관 보도 ${purge.length}건 삭제 (기존 저장분)`);

  // 6-2) 규칙이 생기기 전에 쌓인 같은 사건 중복 정리 — 먼저 실린 원 보도 1건만 남긴다.
  // ⚠️ 스크랩된 기사는 무조건 남긴다(cascade 로 회원 재료함이 날아간다). 대표로도 쓴다.
  const gone = new Set(purge);
  const alive = stored.filter(a => !gone.has(a.id))
    .sort((a, b) => (a.published_at || '').localeCompare(b.published_at || ''));
  const survivors = [];
  const dupIds = [];
  for (const a of alive) {
    const tk = tokenize(a.title);
    const scrapped = (a.news_scraps || []).length > 0;
    if (!scrapped && survivors.some(t => similar(t, tk) >= DUP_MIN)) { dupIds.push(a.id); continue; }
    survivors.push(tk);
  }
  await deleteIds(dupIds);
  for (const id of dupIds) gone.add(id);
  console.log(`같은 사건 중복 ${dupIds.length}건 삭제 (기존 저장분)`);

  // 7) 저장분 재분류 — ⚠️ 분류는 저장 시점에 한 번 굳는다. 이 스텝이 없으면 AIRLINES·TOPICS를
  //    고쳐도 과거 기사엔 영원히 반영되지 않는다(실제로 키워드 확대 후 미분류가 63% 그대로였다).
  //    바뀐 행만 (airline, topic) 조합별로 묶어 PATCH하므로 평시 요청 수는 0이다.
  const groups = new Map();                       // "airline|topic" → [id]
  for (const a of stored) {
    if (gone.has(a.id)) continue;
    const want = classify(a.title);
    if (want.airline === a.airline && want.topic === a.topic) continue;
    const k = `${want.airline || ''}|${want.topic || ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a.id);
  }
  let refixed = 0;
  for (const [k, ids] of groups) {
    const [airline, topic] = k.split('|');
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      await sbFetch(`news_articles?id=in.(${chunk.join(',')})`, {
        method: 'PATCH',
        body: JSON.stringify({ airline: airline || null, topic: topic || null }),
      });
      refixed += chunk.length;
    }
  }
  console.log(`재분류 ${refixed}건 갱신`);
})().catch(e => { console.error(e); process.exit(1); });
