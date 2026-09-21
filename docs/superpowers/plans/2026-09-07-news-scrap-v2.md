# 항공 뉴스 스크랩 v2 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026-08-28 폐지한 항공 뉴스 기능을 되살리되, 학원 홍보 기사를 걸러내고, 기사를 언론사로 나가지 않고 우리 화면·우리 활자로 요약해 읽는 '읽기 창'을 붙인다.

**Architecture:** 폐지 직전 커밋 `ca7c027` 의 `news.html`(958줄)·`scripts/fetch-news.mjs`(387줄)·`.github/workflows/news.yml` 을 기준으로 복원한다. 수집 출처만 구글뉴스 RSS → 네이버 뉴스 검색 API 로 갈아끼우고(원문 주소를 얻어야 요약을 가져올 수 있다), 수집 시 언론사가 공유용으로 써 둔 `og:description` 을 1회 읽어 `summary` 열에 저장한다. 화면에서는 카드 클릭이 언론사로 나가는 대신 바텀시트 읽기 창을 연다.

**Tech Stack:** 손으로 쓴 HTML/CSS/JS(빌드 없음) · Supabase(PostgREST·RLS) · Node 24(수집기, ESM) · GitHub Actions(3시간 스케줄) · 네이버 뉴스 검색 오픈API

**설계 원장:** `docs/superpowers/specs/2026-09-07-news-scrap-v2-design.md` — 값이 이 계획과 다르면 스펙이 맞다.

## Global Constraints

프로젝트 공통 규칙(`CLAUDE.md`)에서 이 작업에 걸리는 것만 옮긴다. **모든 태스크의 요구사항에 이 절이 암묵적으로 포함된다.**

- **빌드·린트·테스트 시스템이 없다.** 존재하지 않는 `npm test`·`npm run lint` 를 지어내지 말 것. 검증 수단은 ① `node <스크립트>` 직접 실행 ② 브라우저 375px 렌더 확인, 이 둘뿐이다.
- **`deno` 는 설치돼 있지 않다.** `deno check` 는 이 작업 범위에 없다(Edge Function 을 건드리지 않는다).
- **커밋 메시지·코드 주석은 한국어.** 타임스탬프 백업 파일 커밋 금지. Dead code 는 남기지 말고 제거.
- **활자 12px 하한 · 입력칸 16px 이상 · 터치 타겟 44px 이상 · 대비 4.5:1 · 경계선 3:1**(`docs/design-principles.md`).
- **375px 우선**(트래픽 99% 모바일). 올리기 전 필수.
- **`div` + `click` 금지** — 누를 수 있는 것은 `<button>`/`<a>`. 중첩 인터랙티브(버튼 안 버튼) 금지.
- **새 색을 만들지 않는다.** `--action`=`--accent`=`--accent-ink`=`#1B3A6B`, `--action-ink`=흰색, 배경 `--bg #FFFFFF`. 카드는 `--border-soft`·`--shadow` 로 띄운다.
- **외부 문자열은 반드시 `esc()` 를 거쳐 렌더.** 기사 제목·언론사명·요약은 전부 외부 입력이다.
- **마이그레이션은 오너가 Supabase SQL Editor 에서 실행한다.** 코드는 미적용 상태에서 조용히 degrade 해야 한다(표 없음 판정은 `42P01` 이 아니라 **`PGRST205`**).
- **SQL 본문은 파일 경로가 아니라 대화창에 ```sql 코드블록으로 전달한다**(경로를 bash 블록으로 주면 Run 버튼이 터미널을 연다).
- **기사 본문·사진을 저장하거나 표시하지 않는다.** `summary` 는 언론사가 공개한 `og:description`(≤300자)이거나 네이버 API 발췌문뿐. 읽기 창에는 언론사명과 '원문 읽기' 링크를 항상 함께 둔다.
- **구글뉴스 RSS 는 다시 쓰지 않는다**(약관: 개인·비상업 용도만).
- 배포 대상 파일을 고치면 그 파일을 싣는 페이지의 `?v=` 를 같이 올린다(`inapp.js`·`scroll-keep.js`·`community-card.js`).

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `supabase/migrations/20260907120000_news_board_v2.sql` | 표 2개 + `summary` 열 + RLS 재생성 | 1 |
| `scripts/fetch-news.mjs` | 수집·제외·분류·중복묶기·요약수집·저장·정리 (한 파일 — v1 구조 유지) | 2·3·4 |
| `.github/workflows/news.yml` | 3시간 스케줄 + 수동 실행(mode·pages 입력) | 5 |
| `news.html` | 뉴스판 화면 전부(인라인 CSS+JS — 이 레포 관습) | 6·7·8 |
| `tools.html` | 도구 허브 카드·아이콘·문구 | 9 |
| `nav.js` | 상단 메뉴 항목·현재 위치 표 | 9 |
| `mypage.html` | '뉴스 스크랩' 접이 | 10 |
| `sitemap.xml`·`community-card.js` | 검색 노출·카드 게재처 주석 | 10 |
| `CLAUDE.md`·`docs/notes/*.md` | 규칙 원장 갱신 | 11 |

**태스크 순서 근거:** 1~5(서버·수집)는 오너 작업 ①②③④ 를 거쳐 DB 를 채워야 6~10(화면)을 실데이터로 실측할 수 있다. 그래서 **1~5 는 main 직행**(화면 변화 0), **6~11 은 브랜치 → 실측 → main**(스펙 11절).

---

## Task 1: 마이그레이션 — 표 2개 재생성 + summary 열

**Files:**
- Create: `supabase/migrations/20260907120000_news_board_v2.sql`
- Modify: `docs/notes/implementation-status.md`(마이그레이션 표에 행 추가)

**Interfaces:**
- Consumes: 없음(첫 태스크)
- Produces: 표 `public.news_articles(id uuid, title text, url text unique, source text, summary text, published_at timestamptz, airline text, topic text, created_at timestamptz)` · `public.news_scraps(id uuid, member_id uuid, article_id uuid, note text, tag text, created_at timestamptz, unique(member_id, article_id))`. 태스크 2~10 이 이 컬럼 이름을 그대로 쓴다.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/20260907120000_news_board_v2.sql`:

```sql
-- =============================================================================
-- 항공 뉴스 게시판 + 회원 스크랩 — v2 재생성(2026-09-07 오너 "뉴스 스크랩 기능을 다시 사용하려고한다")
-- 스펙: docs/superpowers/specs/2026-09-07-news-scrap-v2-design.md
--
-- 2026-08-28 폐지 때 20260828130000_drop_news.sql 로 두 표를 드롭했다(오너 실행 완료 —
-- 2026-09-07 anon 프로브 PGRST205 실측). 이 파일은 같은 구조를 다시 만들고 summary 열만 더한다.
--
-- ⚠️ summary 는 언론사가 공유용으로 공개한 og:description 한두 문장(또는 네이버 검색 API 발췌문)
--    이다. 기사 본문을 긁어 넣지 말 것 — 저작권 경계다(스펙 3절). 사진(og:image)도 저장하지 않는다.
-- ⚠️ 기사는 90일 뒤 수집기가 지운다. 단 스크랩된 기사는 남긴다(cascade 로 회원 재료함이 날아간다).
--
-- 적용: Supabase SQL Editor 에서 이 파일 실행(이 레포는 자동 마이그레이션 없음).
-- 검증(실행 후): 시크릿 창에서
--   curl -s "https://apzwauiumhmsvrgffjis.supabase.co/rest/v1/news_articles?select=id&limit=1" \
--     -H "apikey: <anon key>"   →  200 []   (실행 전에는 404 PGRST205)
-- =============================================================================

create table if not exists public.news_articles (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  url          text not null unique,     -- 중복 수집 방지의 핵심
  source       text,                      -- 언론사명(og:site_name → 없으면 호스트명)
  summary      text,                      -- og:description ≤300자. 본문 금지(위 주석)
  published_at timestamptz,
  airline      text,                      -- 슬러그(kal/asiana/...), 미분류 null
  topic        text,                      -- 슬러그(recruit/route/biz/service/policy), 미분류 null
  created_at   timestamptz not null default now()
);

-- 구 v1 표가 남아 있는 환경(드롭을 안 한 경우) 대비 — 열만 더한다
alter table public.news_articles add column if not exists summary text;

comment on table public.news_articles is
  '항공 뉴스(네이버 뉴스 검색 API 자동수집). 제목+링크+요약(og:description)만 저장. 본문·사진 금지. 쓰기는 수집기(service role)만.';

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
  tag        text,                        -- 자유 입력 태그(단일)
  created_at timestamptz not null default now(),
  unique (member_id, article_id)          -- 같은 기사 중복 스크랩 방지
);

comment on table public.news_scraps is
  '회원 뉴스 스크랩(면접 답변 재료함). note = 활용 메모, tag = 자유 입력 분류. RLS로 본인만.';

create index if not exists news_scraps_member_idx on public.news_scraps (member_id);

alter table public.news_scraps enable row level security;

drop policy if exists news_scraps_own on public.news_scraps;

-- 본인 것만 SELECT/INSERT/UPDATE(메모·태그 수정)/DELETE
create policy news_scraps_own on public.news_scraps
  for all to authenticated
  using (member_id = auth.uid())
  with check (member_id = auth.uid());
```

- [ ] **Step 2: 적용 전 상태 확인(프로브)**

Run:
```bash
curl -s -o /dev/null -w '%{http_code}\n' "https://apzwauiumhmsvrgffjis.supabase.co/rest/v1/news_articles?select=id&limit=1" -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwendhdWl1bWhtc3ZyZ2ZmamlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NzQ1ODYsImV4cCI6MjA5ODU1MDU4Nn0.RzqVWeNhGe3bWzEIwU1HZ7hjE1bhQxIxJcvSFTjrN_Y"
```
Expected: `404`(표 없음 = PGRST205). 이미 `200` 이면 표가 있는 것이니 오너에게 확인할 것.

- [ ] **Step 3: implementation-status.md 에 행 추가**

`docs/notes/implementation-status.md` 의 마이그레이션 표에서 `20260828130000_drop_news` 행 **아래**에 추가:

```markdown
| `20260907120000_news_board_v2` | **뉴스 기능 부활**(오너 2026-09-07) — `news_articles`(+`summary`)·`news_scraps` 재생성. 요약은 og:description ≤300자(본문·사진 금지) | **owner 실행 필요** — 실행 전에는 뉴스판이 '준비 중'으로 뜨고 수집기가 저장에 실패한다. 검증: anon 프로브 `news_articles` → `200 []` |
```

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/20260907120000_news_board_v2.sql docs/notes/implementation-status.md
git commit -m "feat(뉴스): 표 재생성 마이그레이션 — news_articles(+summary)·news_scraps

2026-08-28 폐지 때 드롭한 두 표를 v1 구조 그대로 되살리고 summary 열을 더한다.
summary 는 언론사가 공유용으로 공개한 og:description(≤300자) — 본문·사진은 저장하지 않는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: 수집기 — 네이버 API 로 출처 교체

**Files:**
- Create: `scripts/fetch-news.mjs`(폐지 직전 `ca7c027` 버전을 꺼내 수정)
- Test: 없음(테스트 스위트가 없다 — 검증은 `--dry-run` 실행 로그)

**Interfaces:**
- Consumes: Task 1 의 `news_articles` 컬럼 이름
- Produces: `AIRLINES`(slug/name/alias) · `classify(title) → {airline, topic}` · `dropReason(title, url) → string|null` · `isDropped(title, url) → boolean` · `tokenize(title) → Set` · `similar(a,b) → number` · `normTitle(s) → string` · `sbFetch(path, opts)` · `sbFetchAll(path)` · `deleteIds(ids)` · `fetchNaver(query, page) → item[]`. Task 3(학원 규칙)·4(요약)가 이 이름들을 쓴다.

- [ ] **Step 1: 폐지 직전 수집기를 꺼내 온다**

```bash
git show ca7c027:scripts/fetch-news.mjs > scripts/fetch-news.mjs
```

- [ ] **Step 2: 파일 머리(1~14줄)를 네이버용으로 교체**

기존 머리 주석과 env 블록을 아래로 통째 교체한다:

```javascript
// =============================================================================
// 항공 뉴스 수집기 — 네이버 뉴스 검색 API → Supabase news_articles 저장
// 실행: node scripts/fetch-news.mjs              (env: SUPABASE_SERVICE_ROLE_KEY,
//                                                       NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)
//       node scripts/fetch-news.mjs --dry-run     (DB 없이 수집·제외·분류 결과만 출력)
//       node scripts/fetch-news.mjs --pages 5     (검색어당 페이지 수, 기본 1·최대 10)
//       node scripts/fetch-news.mjs --summary-test <url>   (URL 하나의 og 추출만 확인)
// 스케줄: .github/workflows/news.yml (3시간마다)
// 스펙: docs/superpowers/specs/2026-09-07-news-scrap-v2-design.md
//
// ⚠️ 구글뉴스 RSS 로 되돌리지 말 것(2026-09-07 교체). 두 가지 이유다:
//    ① 피드 <copyright> 가 "personal, non-commercial use" 만 허용한다 — 우리 사이트는 대상 밖.
//    ② 링크가 news.google.com/rss/articles/CBMi... 암호화 주소라 원문 URL 을 꺼낼 수 없다
//       (plain fetch 는 580KB JS 페이지를 주고 원문 도메인 문자열이 0건 — 2026-09-07 실측).
//       원문 URL 이 없으면 요약(og:description)을 가져올 수 없고, 그러면 '우리 화면에서 읽기'가
//       성립하지 않는다(오너 2026-09-07 "링크만 긁어오는거 자체가 뭔 의미가있어").
// ⚠️ 슬러그는 news.html·mypage.html 의 라벨 맵과 계약 — 바꾸면 3곳 동기화.
// ⚠️ 기사 본문·사진은 저장하지 않는다(스펙 3절). summary 는 og:description ≤300자.
// =============================================================================

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
// 검색어당 받아올 페이지 수(1페이지 = 100건). 첫 씨앗 채우기만 5, 평시는 1.
const PAGES = Math.min(10, Math.max(1, parseInt(argVal('--pages', '1'), 10) || 1));
const SUMMARY_TEST = argVal('--summary-test', null);

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://apzwauiumhmsvrgffjis.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NAVER_ID = process.env.NAVER_CLIENT_ID;
const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;
if (!SUMMARY_TEST && (!NAVER_ID || !NAVER_SECRET)) {
  console.error('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 가 없습니다. '
    + 'developers.naver.com 에서 검색 API 애플리케이션을 등록하고 GitHub Secrets 에 넣어주세요.');
  process.exit(1);
}
if (!DRY && !SUMMARY_TEST && !SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY 가 없습니다.'); process.exit(1);
}
```

- [ ] **Step 3: RSS 파서를 네이버 JSON 수집 함수로 교체**

`const rssUrl = q => ...` 부터 `function parseItems(xml) { ... }` 끝까지를 아래로 교체한다(`unescapeXml` 도 함께 교체 — 네이버는 XML 이 아니라 JSON 이고 `<b>` 태그와 HTML 엔티티가 섞여 온다):

```javascript
// 네이버 검색 API 는 제목·발췌문에 검색어를 <b> 로 감싸 보내고 HTML 엔티티를 섞는다.
const stripHtml = s => String(s == null ? '' : s)
  .replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')          // ⚠️ 마지막에 — 먼저 풀면 &amp;lt; 가 < 로 이중 해제된다
  .replace(/\s+/g, ' ').trim();

// 검색 API: display 최대 100, start 최대 1000, sort=date(최신순). 하루 25,000회.
async function fetchNaver(query, page) {
  const start = (page - 1) * 100 + 1;
  const url = 'https://openapi.naver.com/v1/search/news.json'
    + '?query=' + encodeURIComponent(query) + '&display=100&sort=date&start=' + start;
  const res = await fetch(url, {
    headers: { 'X-Naver-Client-Id': NAVER_ID, 'X-Naver-Client-Secret': NAVER_SECRET },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('HTTP ' + res.status + ' — 네이버 키를 확인하세요(Client ID/Secret)');
  }
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const json = await res.json();
  const out = [];
  for (const it of json.items || []) {
    const title = stripHtml(it.title);
    // originallink = 언론사 원문. link 는 네이버 뉴스 주소이거나(제휴사) 원문(비제휴사).
    // ⚠️ 원문을 우선한다 — 요약(og:description)을 읽어야 하고, 네이버 뉴스 페이지는 막힌다.
    const url2 = String(it.originallink || it.link || '').trim();
    if (!title || !/^https?:\/\//i.test(url2)) continue;
    out.push({
      title,
      url: url2,
      source: null,                                   // 6.4 에서 og:site_name → 호스트명으로 채운다
      naverDesc: stripHtml(it.description),           // 요약 폴백(저장 직전에 summary 로 옮긴다)
      published_at: it.pubDate ? new Date(it.pubDate).toISOString() : null,
    });
  }
  return out;
}
```

⚠️ 구글 시절의 '제목 꼬리 " - 언론사" 벗기기' 반복문은 **삭제한다** — 네이버 제목에는 그 꼬리가 없어 멀쩡한 제목을 자른다(dead code 금지).

- [ ] **Step 4: 수집 스텝(1)을 네이버 호출로 교체**

`(async () => {` 바로 아래 `// 1) RSS 수집` 블록을 교체:

```javascript
  // 1) 수집 — 검색어 하나가 죽어도 나머지는 진행. url 로 자동 중복 제거.
  const collected = new Map();               // url → item
  for (const q of QUERIES) {
    for (let page = 1; page <= PAGES; page++) {
      try {
        const items = await fetchNaver(q, page);
        for (const it of items) collected.set(it.url, it);
        if (items.length < 100) break;       // 더 받을 게 없다
      } catch (e) { console.warn(`검색 실패(스킵): ${q} p${page} — ${e.message}`); break; }
    }
  }
  console.log(`수집 ${collected.size}건 (검색어 ${QUERIES.length}개 × ${PAGES}페이지)`);
```

- [ ] **Step 5: `BAD_SOURCE` 판정을 URL 호스트 기준으로 바꾼다**

`dropReason` 은 v1 에서 `(title, source)` 를 받았다. 네이버 API 는 `source` 를 주지 않으므로(요약 수집 후에야 채워진다) **URL 로 판정**하도록 시그니처를 바꾼다. `BAD_SOURCE` 정의 주석과 `dropReason`·`isDropped` 를 교체:

```javascript
// ③ 개인 블로그·카페 — 출처(URL 호스트)로 판단.
// ⚠️ 네이버 검색 API 는 등록 언론사만 주지만, 원문 URL 이 블로그로 가는 경우가 있어 유지한다.
const BAD_HOST = /(^|\.)(blog|cafe|post|m\.blog|m\.cafe)\.naver\.com$|tistory\.com$|brunch\.co\.kr$|dcinside\.com$|clien\.net$|ppomppu\.co\.kr$|instiz\.net$/i;
const badSource = url => {
  try { return BAD_HOST.test(new URL(url).hostname); } catch (e) { return false; }
};

// 제외 사유 — dry-run 에서 어떤 규칙이 몇 건을 걷어냈는지 보여주려고 사유를 돌려준다.
function dropReason(title, url) {
  if (isExcluded(title)) return '참사';
  if (SPORTS.test(title)) return '스포츠';
  if (STOCKS.test(title)) return '시황';
  if (MUSEUM.test(title)) return '박물관';
  if (TRAVEL_AD.test(title) && !AD_KEEP.test(title)) return '여행상품';
  if (badSource(url)) return '블로그';
  if (!AVIATION.test(title) && !mentionsAirline(title)) return '항공무관';
  return null;
}

// ⚠️ 저장할 때와 기존 저장분을 청소할 때 반드시 이 함수 하나를 같이 쓸 것.
// 분류(classify)와 달리 '제외'는 저장 시점에 굳으므로, 규칙만 고치고 청소를 안 하면
// 이미 들어온 배구 기사가 뉴스판 맨 위에 그대로 남는다(실제로 그 상태였다).
const isDropped = (title, url) => dropReason(title, url) !== null;
```

호출부 3곳을 같이 고친다:
- 스텝 2 안: `const why = dropReason(it.title, it.source);` → `const why = dropReason(it.title, it.url);`
- 스텝 6 안: `.filter(a => isDropped(a.title, a.source) && ...)` → `.filter(a => isDropped(a.title, a.url) && ...)`
- 스텝 6 의 저장분 select 에 `url` 을 추가: `'news_articles?select=id,title,url,source,airline,topic,published_at,news_scraps(id)'`

- [ ] **Step 6: dry-run 으로 수집이 되는지 확인**

Run(네이버 키가 있는 환경에서):
```bash
NAVER_CLIENT_ID=<id> NAVER_CLIENT_SECRET=<secret> node scripts/fetch-news.mjs --dry-run
```
Expected: `수집 N건 (검색어 12개 × 1페이지)` 로 시작해 제외 사유별 목록과 `저장 대상 N건` 이 찍힌다. 키가 없으면 위 안내 문구를 내고 종료(exit 1).

⚠️ 오너 작업 ② 전이라 로컬에 키가 없으면 이 스텝은 **Task 5 배포 후 GitHub Actions 의 `mode=dry-run` 으로 대신한다.** 그 경우 여기서는 `node --check scripts/fetch-news.mjs`(문법만)로 갈음하고, 결과를 커밋 메시지에 적지 말 것.

- [ ] **Step 7: 커밋**

```bash
git add scripts/fetch-news.mjs
git commit -m "feat(뉴스): 수집 출처를 네이버 뉴스 검색 API 로 교체

구글뉴스 RSS 는 약관이 개인·비상업 용도만이고, 링크가 암호화 주소라 원문 URL 을 못 꺼내
요약을 가져올 수 없다(2026-09-07 실측). 블로그 판정도 source 문자열에서 URL 호스트로 옮겼다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: 수집기 — 학원·학과 홍보 기사 제외

**Files:**
- Modify: `scripts/fetch-news.mjs`(제외 규칙 블록)

**Interfaces:**
- Consumes: Task 2 의 `dropReason(title, url)`
- Produces: `ACADEMY` 정규식 + `dropReason` 의 `'학원'` 사유

- [ ] **Step 1: `ACADEMY` 규칙을 `MUSEUM` 정의 아래에 추가**

```javascript
// ⑥ 승무원 학원·대학 학과 홍보(2026-09-07 오너 "다른 학원의 뉴스도 스크랩해왔더라고")
// 경쟁 학원의 합격 실적 보도자료와 대학 항공서비스학과 홍보가 '채용' 기사로 들어온다.
// 실측(2026-09-07 저장 대상 678건): "홍대승무원학원 윙스카이, 대한항공승무원채용 두 자릿수
// 합격자 배출"(kal/recruit 으로 분류돼 있었다), "광주여대 항공서비스학과, 사우디항공 승무원
// 채용 행사에 취업연계 프로그램 운영".
//
// ⚠️⚠️ 아래 낱말을 넣지 말 것 — 전부 실측 오탐이다(멀쩡한 항공사 기사가 잘린다):
//   '양성'  → "에어부산, 커리어 엑스포 참가…'항공산업 인재 양성'"
//   '교육'  → "대한항공, 아시아나항공과 교육기부 봉사·안전체험 활동 지원"
//   '대학'·'학과' 단독 → 항공사–대학 산학협력 MOU 는 남긴다(면접 재료)
// ⚠️ 이 필터도 못 걸러서가 아니라 정상 기사를 걷어내서 문제가 된다 — 규칙을 고쳤으면
//    반드시 dry-run 의 '제외: 학원' 목록을 눈으로 확인할 것.
const ACADEMY = /학원|아카데미|합격(?:자|생)\s*배출|수강생|항공(?:서비스|운항|관광)\s*(?:학과|학부|과)\b|취업\s*연계/;
```

- [ ] **Step 2: `dropReason` 에 사유 추가**

`if (MUSEUM.test(title)) return '박물관';` **다음 줄**에 삽입:

```javascript
  if (ACADEMY.test(title)) return '학원';
```

⚠️ `AVIATION` 게이트보다 **앞**에 둔다 — 학원 기사에는 '승무원'·'항공' 이 들어 있어 게이트를 통과한다.

- [ ] **Step 3: dry-run 으로 '제외: 학원' 목록 눈검사**

Run:
```bash
NAVER_CLIENT_ID=<id> NAVER_CLIENT_SECRET=<secret> node scripts/fetch-news.mjs --dry-run
```
Expected: `제외 N건 — … · 학원 M` 이 찍히고 `── 제외: 학원 (M건) ──` 목록이 나온다.

**합격 기준: 그 목록에 항공사·업계 기사가 하나도 없을 것(오탐 0).** 항공사 기사가 섞였으면 그 낱말을 규칙에서 빼고 다시 돌린다. 숫자가 크면 잘 걸러진 게 아니라 잘못 걸러진 것이다.

- [ ] **Step 4: 커밋**

```bash
git add scripts/fetch-news.mjs
git commit -m "feat(뉴스): 학원·학과 홍보 기사 제외 규칙(오너 2026-09-07 지시)

경쟁 학원 합격 실적 보도자료와 대학 항공서비스학과 홍보가 채용 기사로 들어오던 것을 막는다.
'양성'·'교육'·'대학' 단독은 넣지 않는다 — 멀쩡한 항공사 기사가 잘린다(주석에 실측 오탐 기록).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: 수집기 — 요약(og:description) 수집

**Files:**
- Modify: `scripts/fetch-news.mjs`(요약 수집 함수 + 스텝 3.5 + upsert 필드 정리)

**Interfaces:**
- Consumes: Task 2 의 `fetchNaver` 결과 필드(`naverDesc`), Task 1 의 `summary`·`source` 컬럼
- Produces: `fetchOg(url) → {description, siteName}` · `attachSummaries(rows) → void`(rows 를 제자리 수정)

- [ ] **Step 1: 요약 추출 함수를 `deleteIds` 정의 아래에 추가**

```javascript
// ── 요약 수집(2026-09-07) ────────────────────────────────────────────────────
// 언론사가 카톡·SNS 공유용으로 기사 페이지에 써 둔 og:description 한두 문장을 가져온다.
// ⚠️ 본문을 긁지 않는다(저작권 — 스펙 3절). 사진(og:image)도 가져오지 않는다.
// ⚠️ 신규 행에만 1회 부른다 — 재실행마다 전체를 다시 긁으면 언론사에 민폐고 느리다.
// 실측(2026-09-07): 실기사 8곳(연합·매경×2·파이낸셜·경기일보·인더스트리·이코노미사이언스·
// 이넷뉴스) 전부 og:description 추출 성공.
const OG_TIMEOUT = 8000;
const OG_MAX_BYTES = 512 * 1024;      // 머리만 필요하다 — 512KB 넘게 읽지 않는다
const SUMMARY_MAX = 300;              // DB 주석과 한 벌

function metaContent(html, prop) {
  // <meta property="og:x" content="..."> 와 순서가 뒤집힌 것 둘 다 잡는다
  const a = new RegExp('<meta[^>]+(?:property|name)=["\\\']' + prop
    + '["\\\'][^>]*content=["\\\']([^"\\\']*)', 'i').exec(html);
  if (a) return a[1];
  const b = new RegExp('<meta[^>]+content=["\\\']([^"\\\']*)["\\\'][^>]*(?:property|name)=["\\\']'
    + prop + '["\\\']', 'i').exec(html);
  return b ? b[1] : null;
}

const unescapeHtml = s => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

async function fetchOg(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(OG_TIMEOUT),
    headers: {
      // 우리가 누구인지 밝힌다 — 막고 싶은 언론사가 막을 수 있게.
      'User-Agent': 'Mozilla/5.0 (compatible; MONC-news/1.0; +https://monc.ai.kr)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const ctype = res.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml/i.test(ctype)) throw new Error('HTML 아님: ' + ctype);

  // 512KB 까지만 읽는다(머리에 og 가 있다). 문자셋은 헤더 → <meta charset> 순.
  const buf = new Uint8Array(await res.arrayBuffer()).slice(0, OG_MAX_BYTES);
  let charset = (/charset=([\w-]+)/i.exec(ctype) || [])[1];
  let html = new TextDecoder(charset && isKnownCharset(charset) ? charset : 'utf-8',
                             { fatal: false }).decode(buf);
  if (!charset) {
    const m = /<meta[^>]+charset=["\']?([\w-]+)/i.exec(html.slice(0, 4096));
    if (m && isKnownCharset(m[1]) && !/^utf-?8$/i.test(m[1])) {
      html = new TextDecoder(m[1], { fatal: false }).decode(buf);
    }
  }
  return {
    description: unescapeHtml(metaContent(html, 'og:description')),
    siteName: unescapeHtml(metaContent(html, 'og:site_name')),
  };
}

// 한국 언론사는 EUC-KR 을 쓰는 곳이 남아 있다. TextDecoder 가 모르는 이름이면 utf-8 로 간다.
function isKnownCharset(name) {
  try { new TextDecoder(name); return true; } catch (e) { return false; }
}

const hostName = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return null; } };
const cutSummary = s => {
  const t = String(s || '').trim();
  if (!t) return null;
  return t.length > SUMMARY_MAX ? t.slice(0, SUMMARY_MAX - 1) + '…' : t;
};

// rows 를 제자리에서 채운다(summary·source). 동시 4개 — 언론사 서버를 두들기지 않는다.
async function attachSummaries(rows) {
  let ok = 0, fallback = 0, none = 0;
  const queue = rows.slice();
  const worker = async () => {
    for (;;) {
      const r = queue.shift();
      if (!r) return;
      let og = null;
      try { og = await fetchOg(r.url); } catch (e) { og = null; }
      const desc = og && og.description ? og.description : null;
      if (desc) { r.summary = cutSummary(desc); ok++; }
      else if (r.naverDesc) { r.summary = cutSummary(r.naverDesc); fallback++; }
      else { r.summary = null; none++; }
      r.source = (og && og.siteName) || hostName(r.url);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(`요약 성공 ${ok} · 폴백 ${fallback} · 없음 ${none}`);
}
```

- [ ] **Step 2: `--summary-test` 진단 분기를 `(async () => {` 맨 앞에 추가**

```javascript
  // 진단 — URL 하나의 og 추출 결과만 보고 끝낸다(막는 언론사 확인용)
  if (SUMMARY_TEST) {
    try {
      const og = await fetchOg(SUMMARY_TEST);
      console.log('og:site_name   =', og.siteName || '(없음)');
      console.log('og:description =', og.description || '(없음)');
      console.log('저장될 summary =', cutSummary(og.description) || '(없음)');
    } catch (e) { console.error('실패:', e.message); process.exitCode = 1; }
    return;
  }
```

- [ ] **Step 3: 스텝 3 과 4 사이에 요약 수집(3.5)을 넣고 upsert 본문을 정리**

기존 `// 4) upsert` 블록 **앞**에 삽입하고, upsert 본문에서 내부 전용 필드를 뺀다:

```javascript
  // 3.5) 요약·언론사명 수집 — ⚠️ 신규 행(fresh)에만. 저장분을 매번 다시 긁지 않는다.
  if (fresh.length) await attachSummaries(fresh);

  // 4) upsert — url unique 충돌은 무시(재수집 안전)
  // ⚠️ naverDesc 는 내부 폴백용 필드다. 그대로 실어 보내면 없는 컬럼이라 400 이 난다.
  const payload = fresh.map(({ naverDesc, ...row }) => row);
  let inserted = 0;
  if (payload.length) {
    const res = await sbFetch('news_articles?on_conflict=url', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(payload),
    });
    inserted = (await res.json()).length;
  }
  console.log(`신규 ${inserted}건 저장 (제목 중복 ${rows.length - fresh.length}건 스킵)`);
```

⚠️ 기존 `body: JSON.stringify(fresh)` 줄과 그 위 `let inserted = 0; if (fresh.length) {` 블록은 위 코드로 **대체**한다(중복 남기지 말 것).

- [ ] **Step 4: dry-run 안내에 요약 스킵을 명시**

`if (DRY) {` 블록 마지막 `console.log` 아래에 한 줄 추가:

```javascript
    console.log('(dry-run 은 요약을 가져오지 않는다 — 실행 시에만 신규 행에 붙는다)');
```

- [ ] **Step 5: 요약 추출을 실제 기사로 검증**

Run:
```bash
node scripts/fetch-news.mjs --summary-test https://www.yna.co.kr/view/AKR20260903000000001
```
Expected: `og:site_name`·`og:description`·`저장될 summary` 세 줄이 나온다(URL 은 그날 살아 있는 기사로 바꿔 실행). 최소 3개 매체(연합뉴스·매일경제·중소 매체 각 1)로 확인한다.

- [ ] **Step 6: 문법 확인 + 커밋**

```bash
node --check scripts/fetch-news.mjs
git add scripts/fetch-news.mjs
git commit -m "feat(뉴스): 요약 수집 — 언론사 og:description 을 신규 기사에만 1회

기사를 우리 화면에서 읽게 하려는 것(오너 2026-09-07). 본문·사진은 가져오지 않고 언론사가
공유용으로 공개한 한두 문장만 300자까지 저장한다. 실패하면 네이버 발췌문 → 없음 순으로 폴백.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: GitHub Actions 워크플로 + 1단계 배포

**Files:**
- Create: `.github/workflows/news.yml`
- Modify: `docs/notes/implementation-status.md`(Actions 시크릿 항목)

**Interfaces:**
- Consumes: Task 2~4 의 `scripts/fetch-news.mjs` 와 그 env 이름 3개
- Produces: 수동 실행 입력 `mode`(run|dry-run)·`pages`

- [ ] **Step 1: 워크플로 작성**

`.github/workflows/news.yml`:

```yaml
# 항공 뉴스 자동 수집 — 3시간마다 scripts/fetch-news.mjs 실행
# 오너 1회 설정: Settings → Secrets and variables → Actions 에 아래 3개 등록
#   SUPABASE_SERVICE_ROLE_KEY · NAVER_CLIENT_ID · NAVER_CLIENT_SECRET
# ⚠️ 공개 리포는 60일간 커밋이 없으면 GitHub가 스케줄을 자동 중지(메일 통지 → 버튼으로 재활성)
name: 항공 뉴스 수집

on:
  schedule:
    - cron: '0 */3 * * *'    # 3시간마다(UTC 기준 — KST로도 3시간 간격은 동일)
  workflow_dispatch:          # Actions 탭 'Run workflow' 버튼
    inputs:
      mode:
        description: '실행 방식 (run = 저장, dry-run = 규칙 확인만)'
        type: choice
        options: [run, dry-run]
        default: run
      pages:
        description: '검색어당 페이지 수 (1페이지 = 100건, 첫 씨앗 채우기는 5)'
        default: '1'

permissions:
  contents: read

jobs:
  fetch:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: 뉴스 수집·저장
        env:
          SUPABASE_URL: https://apzwauiumhmsvrgffjis.supabase.co
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          NAVER_CLIENT_ID: ${{ secrets.NAVER_CLIENT_ID }}
          NAVER_CLIENT_SECRET: ${{ secrets.NAVER_CLIENT_SECRET }}
          # ⚠️ 입력값은 env 로 받아 셸 변수로 쓴다 — ${{ }} 로 run: 에 직접 끼워 넣으면 셸 주입이 된다
          #    (pages="1; curl …$SUPABASE_SERVICE_ROLE_KEY" 로 최고 권한 키가 새는 것을 2026-09-07 리뷰에서 재현).
          MODE: ${{ github.event.inputs.mode }}
          PAGES: ${{ github.event.inputs.pages }}
        run: |
          ARGS=()
          [ "$MODE" = "dry-run" ] && ARGS+=(--dry-run)
          node scripts/fetch-news.mjs "${ARGS[@]}" --pages "${PAGES:-1}"
```

- [ ] **Step 2: implementation-status.md 의 Actions 항목 갱신**

`~~GitHub Actions 뉴스 스케줄~~ — 2026-08-28 뉴스 폐지로…` 줄을 아래로 교체:

```markdown
- **GitHub Actions 뉴스 수집** — 2026-09-07 부활(news.md). 워크플로 `.github/workflows/news.yml`, 3시간마다. **시크릿 3개 필요**: `SUPABASE_SERVICE_ROLE_KEY`(폐지 때 "지워도 된다"고 안내했으므로 존재 여부 확인 필요) · `NAVER_CLIENT_ID` · `NAVER_CLIENT_SECRET`(developers.naver.com 검색 API 애플리케이션). ⚠️ 공개 리포는 60일 무커밋이면 스케줄 자동 중지.
```

- [ ] **Step 3: 커밋하고 main 에 올린다(1단계 배포 — 화면 변화 없음)**

```bash
git add .github/workflows/news.yml docs/notes/implementation-status.md
git commit -m "feat(뉴스): 수집 워크플로 부활 — 3시간 스케줄 + 수동 실행(mode·pages)

워크플로는 main 에 있어야 Actions 탭에 뜬다. 화면 변경은 없다 — 표를 먼저 채우고
실데이터로 375px 실측한 뒤 화면을 합류시킨다(스펙 11절 롤아웃).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

⚠️ **이 시점에 Task 1~5 를 main 으로 보낸다.** 화면 변화가 0이라 라이브에 영향이 없고, 워크플로가 main 에 있어야 오너가 Actions 탭에서 실행할 수 있다.

- [ ] **Step 4: 오너 안내문을 작성해 전달**

대화창에 아래를 전달한다(SQL 은 ```sql 코드블록으로 — 파일 경로를 bash 로 주지 말 것):
1. GitHub → Settings → Secrets and variables → Actions 에서 `SUPABASE_SERVICE_ROLE_KEY` 존재 확인(없으면 Supabase 콘솔 → Project Settings → API → service_role 키로 재등록)
2. developers.naver.com → 로그인 → Application → 애플리케이션 등록 → 사용 API 에 '검색' 선택 → 발급된 Client ID·Secret 을 위와 같은 곳에 `NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET` 로 등록
3. Task 1 의 마이그레이션 SQL 전문을 Supabase SQL Editor 에서 실행
4. Actions 탭 → '항공 뉴스 수집' → Run workflow → `mode=dry-run` 으로 먼저 1회(학원 규칙 눈검사) → 이상 없으면 `mode=run, pages=5` 로 1회

- [ ] **Step 5: 오너 실행 후 결과 확인**

Run:
```bash
curl -s -o /dev/null -w '%{http_code}\n' "https://apzwauiumhmsvrgffjis.supabase.co/rest/v1/news_articles?select=id&limit=1" -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwendhdWl1bWhtc3ZyZ2ZmamlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NzQ1ODYsImV4cCI6MjA5ODU1MDU4Nn0.RzqVWeNhGe3bWzEIwU1HZ7hjE1bhQxIxJcvSFTjrN_Y"
```
Expected: `200`. 이어서 요약이 붙었는지 본다:
```bash
curl -s "https://apzwauiumhmsvrgffjis.supabase.co/rest/v1/news_articles?select=title,source,summary&limit=3" -H "apikey: <위와 같은 anon key>"
```
Expected: `summary` 가 채워진 행이 보인다. 비어 있으면 Actions 로그의 `요약 성공/폴백/없음` 을 확인한다.

⚠️ 여기부터 Task 6~11 은 **브랜치에서** 작업한다.

---

## Task 6: 뉴스 화면 복원(읽기 창 없이) — 스텁 → 게시판

**Files:**
- Modify: `news.html`(리다이렉트 스텁 → `ca7c027` 판 전체)

**Interfaces:**
- Consumes: Task 1 의 컬럼, Task 5 가 채운 데이터
- Produces: 페이지 전역 함수·변수 `cardHtml(a, group)` · `appendRows(rows)` · `toggleScrap(btn)` · `setScrapBtn(btn, on)` · `scrapByArticle`(Map) · `scrapsReady`(Promise) · `showToast(msg, undo)` · `switchTab(tab)` · `renderScraps()` · `drawScraps()` · `esc(s)` · `fmtDate(iso)` · `AIRLINE_LABEL` · `TOPIC_LABEL`. Task 7·8 이 이 이름들을 쓴다.

- [ ] **Step 1: 폐지 직전 화면을 꺼내 온다**

```bash
git show ca7c027:news.html > news.html
```

- [ ] **Step 2: 목록 조회에 `summary` 를 추가**

`fetchPage()` 안:

```javascript
      let q = MONC.sb.from('news_articles')
        .select('id, title, url, source, summary, published_at, airline, topic')
```

`renderScraps()` 의 임베드 select 도:

```javascript
        .select('id, note, tag, created_at, news_articles(id, title, url, source, summary, published_at, airline, topic)')
```

- [ ] **Step 3: 프리뷰로 화면이 뜨는지 확인**

`preview_start` 로 `wkon-static` 을 띄우고 `news.html` 로 이동한다. Expected: 기사 목록이 그려지고, 필터 픽커·검색창이 뜬다. 표가 비어 있으면 '표시할 뉴스가 없어요'.

- [ ] **Step 4: 커밋**

```bash
git add news.html
git commit -m "feat(뉴스): 게시판 화면 복원 — 스텁을 폐지 직전 판으로 되돌리고 summary 조회 추가

읽기 창은 다음 커밋에서 붙인다. 필터 픽커·같은 소식 접기·스크랩 3중 안전장치 등
확정 규칙은 폐지 직전 판 그대로다(news.md).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: 읽기 창 — 카드에서 열고 뒤로가기로 닫기

**Files:**
- Modify: `news.html`(CSS 블록·바디 마크업·JS)

**Interfaces:**
- Consumes: Task 6 의 `cardHtml`·`toggleScrap`·`setScrapBtn`·`scrapByArticle`·`esc`·`fmtDate`·`AIRLINE_LABEL`·`TOPIC_LABEL`·`showToast`·`closeSheet`
- Produces: `openReader(article)` · `closeReader()` · `articleById`(Map: id → row) · `.nw-open` 카드 버튼

- [ ] **Step 1: 카드 마크업을 링크에서 버튼으로 바꾼다**

`cardHtml()` 의 `<a class="nw-link" ...>` 를 버튼으로 교체하고 요약 줄을 넣는다:

```javascript
      const sum = a.summary
        ? `<p class="nw-card-sum">${esc(a.summary)}</p>` : '';
      return `<li class="nw-card" data-id="${esc(a.id)}"${group ? ` data-group="${esc(group)}"` : ''}>
        <button class="nw-open" type="button" data-id="${esc(a.id)}">
          <span class="nw-card-title">${esc(a.title)}</span>
          ${sum}
          <span class="nw-card-meta">${chips}<span>${esc(a.source || '')}</span><span>${fmtDate(a.published_at)}</span></span>
        </button>
        <button class="nw-bm${scrapped ? ' on' : ''}" type="button" data-id="${esc(a.id)}"
          aria-label="${scrapped ? '스크랩 해제' : '스크랩'}" aria-pressed="${scrapped}">${BM_SVG}</button>${group ? `
        <button class="nw-fold-btn" type="button" hidden aria-expanded="false"><span class="fd-off">같은 소식 <b>0</b>건 더 보기</span><span class="fd-open">접기</span></button>
        <ul class="nw-sublist" hidden></ul>` : ''}
      </li>`;
```

⚠️ `<div>` 를 `<span>` 으로 바꾼 이유: `<button>` 안에는 블록 요소를 넣을 수 없다(HTML 파서가 버튼을 조기 종료한다). `.nw-card-title`·`.nw-card-meta` CSS 에 `display:block`/`display:flex` 를 더한다(다음 스텝).

`drawScraps()` 안의 카드(833~840줄 부근)도 같은 구조로 바꾼다:

```javascript
          return `<li class="nw-card" data-id="${esc(a.id)}">
            <button class="nw-open" type="button" data-id="${esc(a.id)}">
              <span class="nw-card-title">${esc(a.title)}</span>
              ${a.summary ? `<p class="nw-card-sum">${esc(a.summary)}</p>` : ''}
              <span class="nw-card-meta">${chips}<span>${esc(a.source || '')}</span><span>${fmtDate(a.published_at)}</span></span>
            </button>
            <button class="nw-bm on" type="button" data-id="${esc(a.id)}" aria-label="스크랩 해제" aria-pressed="true">${BM_SVG}</button>
```

- [ ] **Step 2: CSS 를 고친다 — `.nw-link` 를 `.nw-open` 으로 교체하고 요약 줄을 추가**

`.nw-link { ... }` 줄을 아래로 교체(같은 자리):

```css
    /* 카드 본문 = 버튼(읽기 창을 연다 — 2026-09-07). 오른쪽 여백은 스크랩 알약(≈86px)이
       제목 위로 겹치지 않을 만큼 — 알약이 absolute라 자동으로 안 밀린다.
       ⚠️ <a target="_blank"> 로 되돌리지 말 것: 오너 2026-09-07 "이동하지않고 우리 홈페이지에서
       바로 볼 수는 없나". 원문으로 나가는 문은 읽기 창 안의 '원문 읽기' 하나다. */
    .nw-open { appearance: none; display: block; width: 100%; text-align: left; border: 0;
      background: none; font: inherit; color: inherit; cursor: pointer;
      padding: 16px 98px 14px 16px; -webkit-tap-highlight-color: transparent; }
    .nw-open:focus-visible { outline: 3px solid var(--action); outline-offset: -3px; border-radius: var(--radius-sm); }
    .nw-card-title { display: -webkit-box; font-size: 16px; font-weight: 700; line-height: 1.5; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    /* 요약 2줄 — 훑기만 해도 내용이 잡히게(원칙: 값에는 그것이 무엇인지 붙이기) */
    .nw-card-sum { margin-top: 6px; font-size: 13px; line-height: 1.6; color: var(--text-muted);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .nw-card-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 8px; font-size: 12px; color: var(--text-muted); }
```

⚠️ 기존 `.nw-card-title`·`.nw-card-meta` 정의 줄은 위에 포함시켰으므로 **원래 자리의 두 줄은 지운다**(중복 정의 금지).

`.nw-sublist .nw-link { padding: 13px 98px 12px 14px; }` → `.nw-sublist .nw-open { padding: 13px 98px 12px 14px; }`

`prefers-reduced-motion` 규칙에 읽기 창을 더한다:
```css
      .nw-card, .nw-bm svg, .nw-pick, .nw-sheet, .nw-scrim, .nw-reader { transition: none; }
```

- [ ] **Step 3: 읽기 창 CSS 를 바텀시트 CSS 아래에 추가**

```css
    /* ── 읽기 창(2026-09-07) — 기사를 언론사로 나가지 않고 우리 활자로 읽는다 ──
       필터 시트(.nw-sheet)와 같은 부품이지만 내용이 길어 max-height 를 키웠다.
       ⚠️ 기사 본문을 넣지 말 것 — summary 는 언론사가 공유용으로 공개한 og:description 이다. */
    .nw-reader { max-height: 82vh; }
    .nw-reader-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .nw-reader-title { font-size: 18px; font-weight: 800; line-height: 1.45; color: var(--ink); margin: 0; }
    .nw-reader-title:focus { outline: none; }
    .nw-reader-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; font-size: 12px; color: var(--text-muted); }
    .nw-reader-sum { margin-top: 14px; font-size: 15px; line-height: 1.7; color: var(--text); }
    .nw-reader-none { margin-top: 14px; font-size: 14px; line-height: 1.7; color: var(--text-muted); }
    .nw-reader-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
    /* 원문 읽기 = 밖으로 나가는 유일한 문. 알약 대신 사각 라운드(사이트 버튼 관습) */
    .nw-reader-out { display: inline-flex; align-items: center; gap: 6px; min-height: 44px;
      padding: 0 18px; border-radius: var(--radius-xs); background: var(--action);
      color: var(--action-ink); font-size: 14px; font-weight: 800; text-decoration: none; }
    .nw-reader-out:focus-visible { outline: 3px solid var(--action); outline-offset: 2px; }
    /* 읽기 창 안 스크랩 버튼 — 카드의 것과 같은 그림·라벨이되 자리만 흐름 배치 */
    .nw-reader-actions .nw-bm { position: static; height: 44px; }
    /* ⚠️ 기저 .nw-bm::after(inset:-4px 히트영역 확장)는 position:static 인 여기서 컨테이닝 블록이
       fixed 시트가 돼 창 전체를 덮는다 — 닫기·원문 읽기가 눌리지 않던 결함(2026-09-07 리뷰). 창 안 버튼은 이미 44px 이라 확장이 필요 없다. */
    .nw-reader-actions .nw-bm::after { content: none; }
    .nw-reader-close { appearance: none; cursor: pointer; display: block; width: 100%;
      margin-top: 16px; min-height: 44px; border: 1.5px solid var(--border);
      border-radius: var(--radius-xs); background: var(--surface); color: var(--text);
      font: inherit; font-size: 14px; font-weight: 700; }
    .nw-reader-close:hover { border-color: var(--accent-dark); }
    .nw-reader .nw-extras { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border-soft); }
```

- [ ] **Step 4: 읽기 창 마크업을 필터 시트 아래에 추가**

`</div>`(필터 시트 닫는 태그) 다음:

```html
  <!-- 읽기 창(2026-09-07 오너 "이동하지않고 우리 홈페이지에서 바로 볼 수 있어야") —
       스크림은 필터 시트와 공유한다. 내용은 openReader() 가 채운다. -->
  <div class="nw-sheet nw-reader" id="nwReader" role="dialog" aria-modal="true" aria-labelledby="nwReaderTitle" hidden>
    <div class="nw-sheet-handle" aria-hidden="true"></div>
    <div class="nw-reader-chips" id="nwReaderChips"></div>
    <h2 class="nw-reader-title" id="nwReaderTitle" tabindex="-1"></h2>
    <div class="nw-reader-meta" id="nwReaderMeta"></div>
    <div id="nwReaderBody"></div>
    <div class="nw-reader-actions" id="nwReaderActions"></div>
    <div id="nwReaderExtras"></div>
    <button class="nw-reader-close" type="button" id="nwReaderClose">닫기</button>
  </div>
```

- [ ] **Step 5: 읽기 창 JS 를 `closeSheet` 정의 아래에 추가**

```javascript
    // ── 읽기 창(2026-09-07) ──────────────────────────────────────────────────
    // 기사를 누르면 언론사로 나가지 않고 우리 활자로 요약을 읽는다. 원문으로 나가는 문은
    // 창 안의 '원문 읽기' 하나뿐(언론사명을 반드시 함께 보여준다 — 스펙 3절).
    const readerEl = document.getElementById('nwReader');
    const readerTitleEl = document.getElementById('nwReaderTitle');
    const readerChipsEl = document.getElementById('nwReaderChips');
    const readerMetaEl = document.getElementById('nwReaderMeta');
    const readerBodyEl = document.getElementById('nwReaderBody');
    const readerActionsEl = document.getElementById('nwReaderActions');
    const readerExtrasEl = document.getElementById('nwReaderExtras');
    const articleById = new Map();          // id → row (목록·스크랩·?a= 조회 결과가 쌓인다)
    let readerOpenId = null;                // 열려 있는 기사 id
    let readerReturnEl = null;              // 닫을 때 포커스를 돌려줄 버튼
    let readerPushed = false;               // history 에 항목을 쌓았는지(뒤로가기 처리)

    // ⚠️ javascript: 같은 주소를 링크로 만들지 않는다 — 기사 URL 은 외부 입력이다.
    const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : null);

    function openReader(a, opts) {
      if (!a) return;
      readerOpenId = a.id;
      readerReturnEl = (opts && opts.returnEl) || null;

      readerChipsEl.innerHTML =
        (a.airline ? `<span class="nw-tag">${esc(AIRLINE_LABEL[a.airline] || a.airline)}</span>` : '')
        + (a.topic ? `<span class="nw-tag nw-tag-topic">${esc(TOPIC_LABEL[a.topic] || a.topic)}</span>` : '');
      readerTitleEl.textContent = a.title || '';
      readerMetaEl.innerHTML =
        (a.source ? `<span>${esc(a.source)}</span>` : '')
        + `<span>${fmtDate(a.published_at)}</span>`;
      readerBodyEl.innerHTML = a.summary
        ? `<p class="nw-reader-sum">${esc(a.summary)}</p>`
        : '<p class="nw-reader-none">요약을 가져오지 못한 기사예요. 원문에서 읽어 주세요.</p>';

      const scrapped = scrapByArticle.has(a.id);
      const href = safeUrl(a.url);
      readerActionsEl.innerHTML =
        `<button class="nw-bm${scrapped ? ' on' : ''}" type="button" data-id="${esc(a.id)}"
           aria-label="${scrapped ? '스크랩 해제' : '스크랩'}" aria-pressed="${scrapped}">${BM_SVG}</button>`
        + (href ? `<a class="nw-reader-out" href="${esc(href)}" target="_blank" rel="noopener noreferrer">원문 읽기${a.source ? ' · ' + esc(a.source) : ''} ↗</a>` : '');
      renderReaderExtras(a.id);

      scrimEl.hidden = false; readerEl.hidden = false;
      void readerEl.offsetWidth;                 // 강제 리플로 — 슬라이드업 전환이 걸린다
      scrimEl.classList.add('open'); readerEl.classList.add('open');
      document.body.style.overflow = 'hidden';
      readerTitleEl.focus();

      // 폰 뒤로가기 = 창만 닫기(페이지를 떠나지 않는다)
      if (!(opts && opts.fromUrl)) {
        try {
          const u = new URL(location.href);
          u.searchParams.set('a', a.id);
          history.pushState({ ...(history.state || {}), nwReader: a.id }, '', u);
          readerPushed = true;
        } catch (e) { readerPushed = false; }
      } else {
        readerPushed = false;
      }
    }

    function hideReader() {
      readerOpenId = null;
      scrimEl.classList.remove('open'); readerEl.classList.remove('open');
      document.body.style.overflow = '';
      setTimeout(() => {
        if (!readerEl.classList.contains('open')) { readerEl.hidden = true; }
        if (!sheetEl.classList.contains('open') && !readerEl.classList.contains('open')) scrimEl.hidden = true;
      }, 240);
      if (readerReturnEl && document.contains(readerReturnEl)) readerReturnEl.focus();
      readerReturnEl = null;
    }

    function closeReader() {
      if (!readerOpenId) return;
      if (readerPushed) { readerPushed = false; history.back(); return; }  // popstate 가 hideReader 를 부른다
      try {                                   // ?a= 로 직접 들어온 경우 — 주소만 정리
        const u = new URL(location.href);
        u.searchParams.delete('a');
        history.replaceState(history.state, '', u);
      } catch (e) {}
      hideReader();
    }

    window.addEventListener('popstate', () => { if (readerOpenId) { readerPushed = false; hideReader(); } });
    document.getElementById('nwReaderClose').addEventListener('click', closeReader);

    // 카드 본문 클릭 → 읽기 창. 스크롤 오터치 가드는 스크랩 버튼과 같은 것을 쓴다.
    document.body.addEventListener('click', e => {
      const open = e.target.closest('.nw-open');
      if (!open || wasDrag(e)) return;
      const a = articleById.get(open.dataset.id);
      if (a) openReader(a, { returnEl: open });
    });
```

> **구현 중 수정(2026-09-07 리뷰):** ① `.nw-reader-actions .nw-bm::after { content:none }` — static 버튼의 확장 히트영역이 시트 전체를 덮던 결함 ② `wasDrag` 가 키보드 click(`detail===0`)을 드래그로 오판하던 회귀 수정 ③ 읽기 창 포커스 트랩(Tab 순환)·`openReader` 재진입 가드·스크림 상호 존중(`hideReader`/`closeSheet` 가 상대 창이 열려 있으면 `open` 을 지우지 않음)·`openSheet` 가 읽기 창 위에서 열리지 않음.

- [ ] **Step 6: 스크림·Esc 가 두 창을 구분하게 고친다**

기존 두 줄을 교체:

```javascript
    scrimEl.addEventListener('click', () => { if (readerOpenId) closeReader(); else closeSheet(); });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (readerOpenId) closeReader(); else closeSheet();
    });
```

`closeSheet()` 안의 마지막 스크림 숨김도 읽기 창을 존중하도록 고친다 — `setTimeout` 안:

```javascript
      setTimeout(() => {                                   // 전환이 끝난 뒤 숨김(그새 재오픈이면 스킵)
        if (!sheetEl.classList.contains('open')) sheetEl.hidden = true;
        if (!sheetEl.classList.contains('open') && !readerEl.classList.contains('open')) scrimEl.hidden = true;
      }, 240);
```

- [ ] **Step 7: `articleById` 를 채운다**

`appendRows(rows)` 첫 줄:

```javascript
    function appendRows(rows) {
      for (const a of rows) {
        articleById.set(a.id, a);
```

`renderScraps()` 의 `scrapRows` 대입 다음:

```javascript
      scrapRows = (data || []).filter(r => r.news_articles);
      scrapRows.forEach(r => articleById.set(r.news_articles.id, r.news_articles));
```

- [ ] **Step 8: 읽기 창 안 스크랩 버튼이 카드와 동기되게 한다**

`setScrapBtn` 은 버튼 하나만 고친다. **모든 사본**(목록·하위·읽기 창)을 함께 맞추는 함수를 그 아래에 추가하고, `toggleScrap` 의 성공 경로에서 부른다:

```javascript
    // 같은 기사의 버튼이 목록·접힌 하위·읽기 창에 동시에 있을 수 있다 — 전부 맞춘다.
    function syncScrapButtons(id) {
      const on = scrapByArticle.has(id);
      document.querySelectorAll(`.nw-bm[data-id="${CSS.escape(id)}"]`).forEach(b => setScrapBtn(b, on));
    }
```

`toggleScrap` 안에서 `scrapByArticle.delete(id);` 다음과 `scrapByArticle.set(id, data);` 다음에 각각 `syncScrapButtons(id);` 를 넣는다. 또 `finally` 블록에서 읽기 창이 열려 있으면 메모·태그 영역을 다시 그린다:

```javascript
      } finally {
        scrapInFlight.delete(id);
        btn.disabled = false;
        if (readerOpenId === id) renderReaderExtras(id);
      }
```

- [ ] **Step 9: `renderReaderExtras` 는 Task 8 에서 채운다 — 임시 빈 함수를 둔다**

`openReader` 위에 둔다(Task 8 이 본문을 채운다):

```javascript
    // 스크랩한 기사의 활용 메모·태그 — 본문은 Task 8(공용 편집기)에서 채운다.
    function renderReaderExtras(id) { readerExtrasEl.innerHTML = ''; }
```

- [ ] **Step 10: 프리뷰 확인**

375px 에서: 카드를 누르면 창이 올라오고 제목·언론사·날짜·요약이 보인다. 스크림 클릭·Esc·닫기 버튼·폰 뒤로가기(브라우저 뒤로) 넷 다 창만 닫는다. 창 안 스크랩을 누르면 뒤 카드의 버튼도 같이 바뀐다.

- [ ] **Step 11: 커밋**

```bash
git add news.html
git commit -m "feat(뉴스): 읽기 창 — 기사를 우리 화면·우리 활자로 읽는다(오너 2026-09-07)

카드 본문을 링크에서 버튼으로 바꿔 바텀시트를 연다. 언론사로 나가는 문은 창 안
'원문 읽기' 하나뿐이고 언론사명을 함께 보여준다. 폰 뒤로가기는 창만 닫는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: 읽기 창의 메모·태그 편집 + `?a=` 직접 진입

**Files:**
- Modify: `news.html`

**Interfaces:**
- Consumes: Task 7 의 `openReader`·`renderReaderExtras`·`articleById`, Task 6 의 `scrapRows`·`updateLocal`·`drawScraps`
- Produces: `extrasHtml(row)` · `bindExtras(container)` · `?a=<id>` 진입 규약

- [ ] **Step 1: 메모·태그 마크업 생성을 공용 함수로 뺀다**

`drawScraps()` 안에서 `tagLine`·`noteLine` 을 만드는 부분을 함수로 올린다(`drawScraps` 위에 정의):

```javascript
    // 활용 메모·태그 마크업 — 내 스크랩 탭과 읽기 창이 같은 것을 쓴다.
    // ⚠️ 두 곳에 복사하지 말 것: 한쪽만 고쳐서 동작이 갈리는 자리가 된다.
    function extrasHtml(r) {
      const tagLine = r.tag
        ? `<span class="nw-mytag">#${esc(r.tag)}</span><button class="nw-tag-btn" type="button" data-scrap="${esc(r.id)}">태그 수정</button>`
        : `<button class="nw-tag-btn" type="button" data-scrap="${esc(r.id)}">+ 태그 붙이기</button>`;
      const noteLine = r.note
        ? `<div class="nw-note" data-scrap="${esc(r.id)}">${esc(r.note)}</div>
           <button class="nw-note-btn" type="button" data-scrap="${esc(r.id)}">메모 수정</button>`
        : `<button class="nw-note-btn" type="button" data-scrap="${esc(r.id)}">+ 활용 메모 남기기</button>`;
      return `<div class="nw-extras">${tagLine}</div>${noteLine}`;
    }
```

`drawScraps()` 안에서는 이 함수를 부르도록 바꾼다(기존 `tagLine`/`noteLine` 지역 변수 정의는 삭제 — dead code 금지).

- [ ] **Step 2: 편집 핸들러를 컨테이너에 붙이는 함수로 뺀다**

기존 `scrapView.addEventListener('click', async e => { ... })` 전체를 `function bindExtras(container) { container.addEventListener('click', async e => { ... }); }` 로 감싸고, 아래를 이어서 부른다:

```javascript
    bindExtras(scrapView);
    bindExtras(readerExtrasEl);
```

⚠️ 핸들러 안의 `scrapView.querySelector(...)` 는 `container.querySelector(...)` 로 바꾼다(읽기 창에서도 자기 안의 요소를 찾아야 한다). 저장 성공 뒤 다시 그리는 부분은 두 곳을 함께 갱신하도록:

```javascript
          updateLocal(scrapId, { note: val });
          drawScraps();
          if (readerOpenId) renderReaderExtras(readerOpenId);
```

(태그 저장 `saveTag` 안도 같은 두 줄을 넣는다.)

⚠️ 핸들러 끝의 스크랩 해제 분기(`const bm = e.target.closest('.nw-bm'); if (bm && !wasDrag(e)) { await toggleScrap(bm); renderScraps(); }`)는 **`container === scrapView` 일 때만** 목록을 다시 그리게 한다 — 읽기 창에서 해제했다고 목록을 갈아엎으면 창 뒤가 흔들린다:

```javascript
      const bm = e.target.closest('.nw-bm');
      if (bm && !wasDrag(e)) { await toggleScrap(bm); if (container === scrapView) renderScraps(); }
```

- [ ] **Step 3: `renderReaderExtras` 본문을 채운다**

Task 7 의 빈 함수를 교체:

```javascript
    // 스크랩한 기사면 활용 메모·태그를 창 안에서 바로 남긴다(내 스크랩 탭과 같은 편집기).
    function renderReaderExtras(id) {
      const row = scrapByArticle.get(id);
      readerExtrasEl.innerHTML = row && row.id ? extrasHtml(row) : '';
    }
```

⚠️ `scrapByArticle` 의 값에는 `{id, note, tag}` 가 들어 있다(`loadMyScraps`·`toggleScrap` 이 그렇게 넣는다) — `extrasHtml` 이 요구하는 모양과 같다.

- [ ] **Step 4: `?a=` 직접 진입 처리를 초기화 IIFE 에 추가**

맨 아래 `(async () => { ... })()` 안, `resetAndLoad();` 다음에:

```javascript
      // mypage 접이·공유 링크에서 기사 하나를 직접 열고 들어오는 규약(?a=<article id>)
      const wantId = new URLSearchParams(location.search).get('a');
      if (wantId) {
        if (session) await scrapsReady;         // 스크랩 상태를 알고 나서 창을 그린다
        let row = articleById.get(wantId);
        if (!row) {
          const { data } = await MONC.sb.from('news_articles')
            .select('id, title, url, source, summary, published_at, airline, topic')
            .eq('id', wantId).maybeSingle();
          row = data || null;
          if (row) articleById.set(row.id, row);
        }
        // 90일 정리로 지워졌거나 잘못된 id — 창을 열지 않고 알려준다
        if (row) openReader(row, { fromUrl: true });
        else showToast('지워진 기사예요');
      }
```

⚠️ `?a=` 가 uuid 가 아니면 Supabase 가 400 을 준다 — `maybeSingle()` 은 `data:null` 로 돌아오므로 토스트만 뜬다(에러를 던지지 않는다).

- [ ] **Step 5: 375px 실측**

- 카드 → 창: 제목 2줄·요약 2줄 클램프, 창 제목 18px, 요약 15px, 버튼 높이 44px 이상, 창 높이 82vh 이하에서 스크롤.
- 스크랩 → 창 안에 '+ 활용 메모 남기기'·'+ 태그 붙이기' 가 나타난다. 메모를 저장하면 창과 내 스크랩 탭 둘 다 반영.
- `news.html?a=<실제 id>` 직접 열기 → 창이 열린다. 닫으면 주소에서 `a` 가 사라진다.
- `news.html?a=zzz` → '지워진 기사예요' 토스트.
- 가로 넘침 0, 콘솔 에러 0.

- [ ] **Step 6: 커밋**

```bash
git add news.html
git commit -m "feat(뉴스): 읽기 창에서 메모·태그 편집 + ?a= 직접 진입

편집기 마크업·핸들러를 공용 함수로 빼 내 스크랩 탭과 읽기 창이 같은 코드를 쓴다
(복사하면 한쪽만 고쳐져 동작이 갈린다). 마이페이지 접이가 ?a= 로 기사를 연다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: 도구 허브 카드 + 상단 메뉴

**Files:**
- Modify: `tools.html:144`(심볼)·`tools.html:197-208`(부제·카드)·`tools.html` head 메타 3곳
- Modify: `nav.js:41`(TOOLS_SUB)·`nav.js` `SECTION_OF`

**Interfaces:**
- Consumes: Task 6~8 의 `news.html`
- Produces: 도구 허브 카드 1개, nav 항목 1개

- [ ] **Step 1: `tools.html` 의 신문 아이콘 심볼을 되살린다**

144줄 `<!-- (항공사 뉴스 아이콘은 2026-08-28 뉴스 폐지로 제거 — news.md) -->` 를 교체:

```html
      <!-- 뉴스 스크랩 — 신문: 제목 칸 + 기사 줄 + 말린 모서리 -->
      <symbol id="tn-news" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 8.5V17a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17V7a2.5 2.5 0 0 1 2.5-2.5H16A2.5 2.5 0 0 1 18.5 7"/>
        <path d="M18.5 7v10.2a1.3 1.3 0 1 0 2.6 0V8.5h-2.6"/>
        <rect x="7" y="7.8" width="4.6" height="3.6" rx=".7"/>
        <path d="M14 8.4h2M14 11h2M7 14.6h9M7 17h6"/>
      </symbol>
```

- [ ] **Step 2: 부제 숫자를 4 → 5 로**

197~198줄을 교체:

```html
      <!-- 2026-09-07 뉴스 부활로 4→5가지(표시 카드 수와 한 벌 — 아래 목록 주석 참조) -->
      <p class="bf-sub">필요한 도구만 골라 바로 쓰세요.<br>매일 쓰는 면접 준비 도구 <b>5가지</b></p>
```

- [ ] **Step 3: 뉴스 카드를 격자 첫 칸에 넣는다**

208줄 `sojae.html` 카드 **앞**에:

```html
        <a class="tl-card" href="news.html"><span class="tl-ic"><svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true"><use href="#tn-news"/></svg></span><span class="tl-tx"><b>뉴스 스크랩</b><small>항공 뉴스를 요약으로 읽고 담아요</small></span><span class="tl-pill" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#tn-go"/></svg></span></a>
```

- [ ] **Step 4: head 메타 3곳에 '뉴스 스크랩, ' 를 되살린다**

`og:description`·`twitter:description`·`description` 세 줄 모두:

```html
content="승무원 면접 준비 도구 모음 — 뉴스 스크랩, 소재 발굴, 답변 첨삭, 나만의 노트, 역량검사 게임."
```

- [ ] **Step 5: `nav.js` 의 `TOOLS_SUB` 에 항목 추가**

41줄 주석(`/* 항공사 뉴스는 2026-08-28 오너 지시로 기능 전체 폐지(news.md) — 메뉴에 되살리지 말 것 */`)을 교체:

```javascript
    ['news.html', '항공사 뉴스&산업분석', '10개 항공사 소식 · 스크랩'],
```

- [ ] **Step 6: `nav.js` 의 `SECTION_OF` 에 뉴스 추가**

```javascript
    'tools.html': 'tools', 'news.html': 'tools', 'sojae.html': 'tools',
```

- [ ] **Step 7: 프리뷰 확인**

`tools.html` 375px: 카드 5개, 첫 칸이 뉴스, 아이콘이 신문 그림. 상단 메뉴 '승준 도구' 드롭다운에 '항공사 뉴스&산업분석'. `news.html` 에서 nav 의 '승준 도구'에 현재 위치 표시.

- [ ] **Step 8: 커밋**

```bash
git add tools.html nav.js
git commit -m "feat(뉴스): 도구 허브 카드·상단 메뉴 복귀 — 표시 4→5종

노출은 승준 도구 안에서만(오너 2026-09-07 A안). 홈·승준 코스는 건드리지 않는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: 마이페이지 접이 + sitemap + 커뮤니티 카드 주석

**Files:**
- Modify: `mypage.html:453`(접이 마크업)·`mypage.html:818`(로더)·`mypage.html:1483`(호출)
- Modify: `sitemap.xml`·`community-card.js`(주석만)

**Interfaces:**
- Consumes: Task 1 의 표, Task 8 의 `?a=` 규약
- Produces: `loadNewsScraps()`

- [ ] **Step 1: 접이 마크업을 `#sec-labdocs` 앞에 되살린다**

453줄 `<details class="v2-fold" id="sec-labdocs" ...>` **앞**에:

```html
        <details class="v2-fold" id="sec-news" style="display:none;">
          <summary>
            <svg class="v2-fold-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h13v14a1 1 0 0 0 1 1H5a1 1 0 0 1-1-1V5z"/><path d="M17 9h3v10a1 1 0 0 1-1 1M7 9h6M7 13h6M7 17h4"/></svg>
            <span class="v2-fold-t">뉴스 스크랩</span>
            <span class="v2-fold-c" id="newsCount">0</span>
            <svg class="v2-fold-ar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </summary>
          <div class="v2-fold-body">
            <ul class="v2-list" id="newsScraps"></ul>
            <a class="v2-more" id="newsMore" href="news.html?tab=scraps">전체 보기 →</a>
          </div>
        </details>
```

- [ ] **Step 2: 로더를 `loadLabPurchases` 앞에 되살린다(링크 목적지만 바뀐다)**

818줄 `// ── 구매한 연구실 자료 접이` 주석 **앞**에:

```javascript
    // ── 내 뉴스 스크랩 접이 — 최근 3건. news_scraps 미생성(마이그레이션 전)이면 접이를 숨긴 채로 둔다. ──
    // ⚠️ 항목 링크는 언론사 URL 이 아니라 news.html?a=<기사 id> 다 — 우리 읽기 창으로 보낸다
    //    (오너 2026-09-07 "이동하지않고 우리 홈페이지에서 바로 볼 수 있어야").
    const AIRLINE_LABEL_MP = { kal:'대한항공', asiana:'아시아나항공', jinair:'진에어', jejuair:'제주항공', twayair:'티웨이항공', airbusan:'에어부산', airseoul:'에어서울', eastarjet:'이스타항공', airpremia:'에어프레미아', aerok:'에어로케이' };
    async function loadNewsScraps() {
      try {
        const { data, error } = await MONC.sb.from('news_scraps')
          .select('created_at, news_articles(id, title, airline)')
          .order('created_at', { ascending: false });
        if (error) return;
        const rows = (data || []).filter(r => r.news_articles);
        if (!rows.length) return;                    // 0건이면 접이를 안 연다
        document.getElementById('newsScraps').innerHTML = rows.slice(0, 3).map(r => {
          const a = r.news_articles;
          const air = a.airline ? AIRLINE_LABEL_MP[a.airline] || a.airline : '';
          return `<li><a class="v2-item" href="news.html?a=${encodeURIComponent(a.id)}">
            <span class="v2-news-t">${esc(a.title)}</span>
            ${air ? `<span class="v2-news-s">${esc(air)}</span>` : ''}
          </a></li>`;
        }).join('');
        document.getElementById('newsCount').textContent = rows.length;
        document.getElementById('newsMore').textContent = '전체 ' + rows.length + '건 →';
        document.getElementById('sec-news').style.display = '';
      } catch (_) { /* 접이 숨김 유지 */ }
    }
```

- [ ] **Step 3: 호출을 되살린다**

1483줄 `loadLabPurchases();` **앞**에 `loadNewsScraps();` 를 넣는다.

- [ ] **Step 4: `.v2-news-t` 주석을 되돌린다**

160줄 부근 주석(`/* 목록 줄 제목·부제 — 연구실 구매 접이가 쓴다(구 뉴스 접이에서 승계한 이름 …) */`)을 교체:

```css
    /* 목록 줄 제목·부제 — 뉴스 스크랩 접이와 연구실 구매 접이가 함께 쓴다 */
```

- [ ] **Step 5: sitemap 에 뉴스 페이지 추가**

`sitemap.xml` 의 tools 항목 부근에:

```xml
  <url>
    <loc>https://monc.ai.kr/news.html</loc>
    <lastmod>2026-09-07</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>
```

- [ ] **Step 6: `community-card.js` 헤더 주석을 3곳으로 되돌린다**

```javascript
   커뮤니티 오픈채팅 모집 카드 — lab-shelf·news·tools 3곳 공용 (2026-08-16 신설 · 2026-08-28 뉴스
   폐지로 2곳 → 2026-09-07 뉴스 부활로 다시 3곳)
```

그리고 `- 파일을 고치면 두 페이지의 ?v= 도 같이 올린다.` → `세 페이지`.

⚠️ 동작 변경이 없으므로 `?v=` 는 올리지 않는다(주석만 바뀌었다).

- [ ] **Step 7: 프리뷰 확인**

로그인 상태로 `mypage.html`: 스크랩이 있으면 '뉴스 스크랩' 접이가 뜨고, 항목을 누르면 `news.html?a=` 로 가서 읽기 창이 열린다. 스크랩이 0건이면 접이가 안 보인다.

- [ ] **Step 8: 커밋**

```bash
git add mypage.html sitemap.xml community-card.js
git commit -m "feat(뉴스): 마이페이지 접이·sitemap·커뮤니티 카드 게재처 복귀

접이 항목은 언론사가 아니라 news.html?a= 로 보낸다 — 우리 읽기 창에서 읽는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: 문서 갱신 + 실측 기록 + main 합류

**Files:**
- Modify: `CLAUDE.md` · `docs/notes/news.md` · `docs/notes/briefing.md` · `docs/notes/nav.md` · `docs/notes/pages.md` · `docs/notes/mypage.md` · `docs/notes/page-common.md`

**Interfaces:**
- Consumes: Task 1~10 전부
- Produces: 없음(최종 태스크)

- [ ] **Step 1: `docs/notes/news.md` 맨 위에 부활 절을 넣는다**

문서 머리 주석 다음, `## news.html 게시판` 앞에:

```markdown
## ⚠️ 2026-09-07 부활(v2) — 이 절이 현행 규칙이다

오너 지시 원문: *"뉴스 스크랩 기능을 다시 사용하려고하는데. 승준도구"*, 이어 *"저번에 보니까 다른 학원의 뉴스도 스크랩해왔더라고"*, *"스크랩해온 뉴스를 이동하지않고 우리 홈페이지에서 바로 볼 수는 없나? 솔직히 링크만 긁어오는거 자체가 뭔 의미가있어. 우리 홈페이지 폰트나 규칙그대로 볼 수 있어야 좋은거 아니야?"*

설계서는 `docs/superpowers/specs/2026-09-07-news-scrap-v2-design.md`. **아래 폐지 절과 그 아래 v1 상세는 역사 기록이다** — 값이 다르면 이 절이 맞다.

- **노출은 승준 도구 안에서만**(오너 확정 A안): 도구 허브 카드(첫 칸)·nav '승준 도구'·뉴스 페이지·마이페이지 접이. **홈은 건드리지 않았다**(칩·문구·클로징 링크 전부 폐지 후 상태 그대로). **승준 코스의 뉴스 단계도 되살리지 않았다.**
- **수집 출처 = 네이버 뉴스 검색 API**(`scripts/fetch-news.mjs`). ⚠️ **구글뉴스 RSS 로 되돌리지 말 것** — ① 피드 저작권 문구가 개인·비상업 용도만 허용 ② 링크가 암호화 주소라 원문 URL 을 못 꺼내고, 그러면 요약을 가져올 수 없다(2026-09-07 실측: plain fetch 가 580KB JS 페이지를 주고 원문 도메인 문자열 0건).
- **요약(`summary`)은 언론사가 공유용으로 공개한 `og:description`** 한두 문장을 수집 시 1회 읽어 300자까지 저장한 것이다. 폴백은 네이버 발췌문 → 없음. ⚠️ **기사 본문·사진을 저장하거나 표시하지 말 것**(저작권). 읽기 창에는 언론사명과 '원문 읽기' 링크를 항상 함께 둔다. AI 요약도 쓰지 않는다(비용·오요약·언론사 반발 — 오너에게 설명 후 기각).
- **읽기 창**(`#nwReader`): 카드 본문이 `<a target="_blank">` 가 아니라 `<button class="nw-open">` 이고, 누르면 바텀시트가 올라온다. ⚠️ **링크로 되돌리지 말 것** — 이 기능의 요구 자체다. 폰 뒤로가기는 `pushState`+`popstate` 로 창만 닫는다. `news.html?a=<기사 id>` 는 그 기사를 바로 여는 진입 규약(마이페이지 접이가 쓴다).
- **학원·학과 홍보 제외**(`ACADEMY`): 학원·아카데미·합격자 배출·수강생·항공서비스학과·취업연계. ⚠️ **'양성'·'교육'·'대학' 단독을 넣지 말 것** — 실측 오탐("에어부산…항공산업 인재 양성", "대한항공, 아시아나항공과 교육기부 봉사"). `AVIATION` 게이트보다 앞에 둔다(학원 기사에도 '승무원'·'항공'이 있다).
- **보관**: 기사 90일, 스크랩된 기사는 영구(v1 규칙 그대로). `BAD_SOURCE` 판정은 `source` 문자열이 아니라 **URL 호스트**(`badSource`)로 바뀌었다 — 네이버 API 가 언론사명을 주지 않는다.
- **검증 방법**: `node scripts/fetch-news.mjs --dry-run`(네이버 키 필요) 또는 Actions 수동 실행 `mode=dry-run`. `--summary-test <url>` 로 매체별 요약 추출 확인. ⚠️ 규칙을 고쳤으면 **'제외' 목록을 눈으로 확인**할 것 — 이 필터는 못 걸러서가 아니라 정상 기사를 걷어내서 망한다.
- **시크릿 3개**: `SUPABASE_SERVICE_ROLE_KEY`·`NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET`.
```

- [ ] **Step 2: 폐지 절 머리에 한 줄 덧댄다**

`## ⚠️⚠️ 뉴스 기능 전체 폐지 (2026-08-28)` 제목 바로 아래에:

```markdown
> **2026-09-07 오너 지시로 부활했다(위 v2 절이 현행).** 아래는 폐지 시점의 기록으로 남긴다.
```

- [ ] **Step 3: `CLAUDE.md` 4곳을 고친다**

1. 프로젝트 구조 4번:
```markdown
4. **뉴스 수집기**(`scripts/fetch-news.mjs` + `.github/workflows/news.yml`) — 브라우저 밖에서 도는 유일한 코드. 네이버 뉴스 검색 API 로 3시간마다 수집한다(2026-08-28 폐지 → 2026-09-07 오너 지시로 부활 · news.md).
```

2. 기능별 문서 표의 뉴스 행:
```markdown
| 뉴스 스크랩 | `news.html`·`scripts/fetch-news.mjs` | 출처는 네이버 뉴스 검색 API(구글 RSS 금지 — 약관·원문 주소), 요약은 언론사 og:description ≤300자(**본문·사진 저장 금지**), 카드는 링크가 아니라 읽기 창을 여는 버튼, 학원·학과 홍보 제외에 '양성'·'교육'을 넣지 말 것 | `docs/notes/news.md` |
```

3. 승준 도구 행의 '표시 4종' → '표시 5종'(뉴스 부활).

4. 커뮤니티 카드 행의 '서가·도구 2곳' → '서가·뉴스·도구 3곳'.

5. '절대 되살리면 안 되는 것' 의 뉴스 줄을 교체:
```markdown
- 뉴스 수집을 구글뉴스 RSS 로 되돌리기 · 기사 본문·사진 저장 · AI 요약 · 카드를 `<a target="_blank">` 로 되돌리기 (news.md '2026-09-07 부활')
```

- [ ] **Step 4: 나머지 문서 5곳**

- `docs/notes/briefing.md`: 도구 4종 → 5종(뉴스 부활), 아이콘 목록에 '뉴스=신문' 복귀. 코스의 뉴스 단계는 **복원하지 않았다**는 문장을 유지하되 "기능은 2026-09-07 부활했으나 코스 단계는 오너와 다시 정한다"로 보강.
- `docs/notes/nav.md`: 싣는 페이지 28 → 29곳(news 복귀), `TOOLS_SUB`·`SECTION_OF` 언급 갱신.
- `docs/notes/pages.md`: 커뮤니티 카드 2곳 → 3곳(lab-shelf·news·tools).
- `docs/notes/mypage.md`: '뉴스 스크랩' 접이 복귀 + 항목 링크가 `news.html?a=` 라는 점.
- `docs/notes/page-common.md`: bfcache 통째 reload 집합에 news 복귀.

- [ ] **Step 5: 375px·1280px 실측을 문서에 적는다**

`docs/notes/news.md` 의 v2 절 끝에 실측 줄을 추가한다(측정값은 실제로 잰 것만 — 지어내지 말 것):

```markdown
- **실측(2026-09-07 · 375px)**: 카드 제목 16px 2줄·요약 13px 2줄 클램프 / 읽기 창 제목 18px·요약 15px·'원문 읽기' 높이 44px·창 높이 ≤82vh / 스크림·Esc·닫기·폰 뒤로가기 넷 다 창만 닫힘 / 창 안 스크랩 토글 ↔ 카드 버튼 동기 / `?a=` 직접 진입·잘못된 id 토스트 / 가로 넘침 0 · 콘솔 에러 0.
```

- [ ] **Step 6: 커밋하고 main 에 합류**

```bash
git add CLAUDE.md docs/notes/
git commit -m "docs: 뉴스 부활 반영 — news.md v2 절 신설 + 규칙 원장 7곳 갱신

구글 RSS 회귀·본문 저장·AI 요약·카드 링크화를 금지 목록에 넣었다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

이어서 브랜치를 main 에 합치고 푸시한다(2단계 배포). 푸시 1~2분 뒤 monc.ai.kr 에서 강력 새로고침으로 확인한다(GitHub Pages 가 HTML 에 `max-age=600` 을 건다).

---

## Self-Review

**1. 스펙 커버리지**

| 스펙 절 | 태스크 |
|---|---|
| 3 법적 경계(본문·사진 금지, 언론사명+원문 링크, 90일) | 1(주석·컬럼) · 4(300자 컷) · 7(원문 읽기 버튼) · 11(금지 목록) |
| 5.1 복원 기준 | 6 |
| 5.2 읽기 창 | 7 · 8(메모·태그) |
| 5.3 카드 | 7 |
| 5.4 주소·뒤로가기 | 7(pushState/popstate) · 8(`?a=`) |
| 5.5 문구 | 7(요약 없음) · 9(카드 부제) |
| 5.6 보안·접근성 | 7(`esc`·`safeUrl`·포커스) · 8(실측) |
| 6.1 출처 | 2 |
| 6.2 파싱 | 2 |
| 6.3 제외 규칙 | 2(BAD_HOST) · 3(ACADEMY) |
| 6.4 요약 수집 | 4 |
| 6.5 스텝 순서 | 4(3.5 삽입) |
| 6.6 실행 모드 | 2(args) · 4(`--summary-test`) |
| 6.7 워크플로 | 5 |
| 7 데이터 모델 | 1 |
| 8 노출·연결 | 9 · 10 |
| 9 문서 | 1(status) · 5(status) · 11 |
| 10 검증 | 3(눈검사) · 4(요약) · 5(프로브) · 8(375px) · 11(기록) |
| 11 롤아웃 | 5(1단계) · 11(2단계) |

빠진 절 없음.

**2. 플레이스홀더 스캔**: "TBD"·"적절히"·"비슷하게" 없음. Task 7 Step 9 의 빈 함수는 Task 8 Step 3 에서 실제 본문으로 교체되며, 그 코드가 계획에 적혀 있다.

**3. 타입·이름 일관성**
- `dropReason(title, url)`·`isDropped(title, url)` — Task 2 에서 시그니처를 바꾸고 호출부 3곳을 같이 고친다고 명시. Task 3 은 같은 시그니처를 쓴다.
- `fetchOg(url) → {description, siteName}` — Task 4 정의, 같은 태스크 안에서만 소비.
- `cutSummary`·`hostName`·`isKnownCharset` — Task 4 정의·소비.
- `articleById`·`openReader`·`closeReader`·`hideReader`·`renderReaderExtras`·`syncScrapButtons` — Task 7 정의, Task 8 소비.
- `extrasHtml(r)`·`bindExtras(container)` — Task 8 정의·소비.
- `naverDesc` 는 내부 필드이고 Task 4 의 upsert 에서 제거된다(400 방지).
- `summary` 컬럼 이름이 Task 1(DDL)·2(row)·4(대입)·6(select)·7(렌더)·10(mypage select 에는 불필요 — 제목·항공사만 읽는다)에서 일치.
