# 항공 뉴스 스크랩 v2 — 복원 + 학원 기사 제외 + 요약 읽기 창 — 설계 스펙

- 날짜: 2026-09-07
- 상태: 오너 설계 승인(2026-09-07 "요약 유지로 가자") — 구현 계획 작성 전
- 복원 기준: 폐지 직전 커밋 `ca7c027`(= `5a81436^`)의 `news.html`·`scripts/fetch-news.mjs`·`.github/workflows/news.yml`. 폐지 경위·옛 확정 규칙은 `docs/notes/news.md`.
- 관련: `docs/superpowers/specs/2026-07-21-aviation-news-board-design.md`(v1 설계 — 슬러그·주제·스크랩 UI 결정은 그대로 유효), `docs/notes/briefing.md`(도구 허브), `docs/notes/nav.md`, `docs/notes/mypage.md`, `docs/notes/pages.md`(커뮤니티 카드)

## 1. 배경·목표

2026-08-28 오너 지시로 폐지한 항공 뉴스 기능을 **2026-09-07 오너 지시로 되살린다.** 원문: *"뉴스 스크랩 기능을 다시 사용하려고하는데. 승준도구"*. 같은 자리에서 두 가지를 더 요구했다.

1. *"저번에 보니까 다른 학원의 뉴스도 스크랩해왔더라고"* → 승무원 학원·대학 학과 홍보 기사가 수집되지 않게 한다.
2. *"스크랩해온 뉴스를 이동하지않고 우리 홈페이지에서 바로 볼 수는 없나? 솔직히 링크만 긁어오는거 자체가 뭔 의미가있어. 우리 홈페이지 폰트나 규칙그대로 볼 수 있어야 좋은거 아니야?"* → 기사를 누르면 언론사로 나가지 않고 **우리 화면·우리 활자로 요약을 읽는 창**을 연다.

폐지 시점에 DB 표 두 개(`news_articles`·`news_scraps`)는 오너가 drop SQL 을 실행해 **이미 지워져 있다**(2026-09-07 anon 프로브 `PGRST205` 실측). 옛 기사·회원 스크랩은 복구 대상이 아니다 — 빈 표에서 다시 채운다.

## 2. 확정 결정(오너 승인)

| 항목 | 결정 |
|---|---|
| 노출 범위 | **A안**: 승준 도구 안에서만 — 도구 허브 카드 + nav '승준 도구' 항목 + 뉴스 페이지 + 마이페이지 '뉴스 스크랩' 접이 + 자동 수집. **홈·승준 코스는 건드리지 않는다.** |
| 사이트 안 읽기 | **1안 '요약 카드 + 읽기 창'**. 2안 AI 요약(비용·오요약·언론사 반발)과 3안 본문 전체 게재(저작권)는 기각. 오너 재확인: *"요약 유지로 가자"*(요약은 AI·유료 API 를 쓰지 않는다는 설명 뒤). |
| 요약의 출처 | 언론사가 기사 페이지에 공유용으로 써 둔 `og:description` 한두 문장. 수집 시 1회 읽어 저장, 이후 호출 없음, 비용 0. |
| 수집 출처 | 구글뉴스 RSS → **네이버 뉴스 검색 API** 로 교체. 이유 ① 구글 피드 약관이 '개인·비상업 용도만' ② 구글 링크는 암호화 주소라 원문 주소를 못 꺼내 요약을 가져올 수 없다(2026-09-07 실측 — 아래 13절). |
| 학원 기사 | 제외 규칙 `ACADEMY` 신설. 대학 항공서비스학과 홍보도 같이 뺀다. **'양성'·'교육'은 규칙에 넣지 않는다**(멀쩡한 항공사 기사가 잘린다 — 6.3절). |
| 보관 | 기사 90일, 스크랩된 기사는 영구(v1 규칙 그대로). 본문·사진은 저장하지 않는다. |
| 본인인증 게이트 | 대상 아님(2026-08-26 오너 지시 "챌린지 신청·게임·뉴스·마이페이지는 대상 아님" 그대로). 열람 공개, 스크랩은 로그인. |
| sitemap | 공개 페이지로 돌아오므로 다시 넣는다(오너 이의 없음 — 원치 않으면 뺀다). |

## 3. 법적·약관 경계(구현에서 넘지 말 것)

- **기사 본문을 저장·표시하지 않는다.** 저장 필드는 제목·원문 URL·언론사명·게시 시각·분류·요약(≤300자)뿐. `summary` 는 언론사가 공유용으로 공개한 문장(`og:description`)이거나 네이버 API 가 준 발췌문이다 — 본문 스크래핑으로 만든 문장을 넣지 않는다.
- 읽기 창에는 **언론사명과 '원문 읽기' 링크를 항상 함께** 보여준다(요약만 단독으로 쓰지 않는다).
- 사진(`og:image`)은 저장·표시하지 않는다(사진 저작권·핫링크).
- 네이버 오픈API 약관은 결과의 무단 저장·캐시를 금한다 — 우리는 검색 결과를 우리 화면에 표시하기 위한 최소 정보만 보관하고 **90일 뒤 지운다**(스크랩은 회원 본인이 고른 북마크). 이 보관 규칙을 늘리려면 오너 확인.
- 구글뉴스 RSS 는 다시 쓰지 않는다.

## 4. 범위 / 비범위

**범위**: `news.html` 복원+읽기 창, `scripts/fetch-news.mjs` 출처 교체+학원 규칙+요약 수집, `.github/workflows/news.yml`, 마이그레이션 1개, `tools.html`·`nav.js`·`mypage.html`·`sitemap.xml`·`community-card.js`(주석) 노출 연결, 문서 갱신.

**비범위**: 홈(칩·문구·클로징 링크), 승준 코스의 뉴스 단계(briefing.md "복원 시 뉴스 단계 되살리지 말 것" 유지), AI 요약, 본문 게재, 사진, 소재 발굴 연동, `scripts/verify-news-rules.py`(되살리지 않음 — node 가 바로 돌아 dry-run 으로 충분. 파이썬 검증기는 nvm 문제 시절의 우회였다).

## 5. 화면 설계 — `news.html`

### 5.1 복원 기준
`ca7c027:news.html`(958줄)을 그대로 가져온다. 탭(전체 뉴스/내 스크랩), 검색창, 픽커+바텀시트 필터, 같은 소식 접기(`FOLD_SIM` 0.15), `#moncWin` 스크랩 버튼(리본 북마크 금지), 낙관적 토글 3중 안전장치, 스크롤 오터치 가드, 되돌리기 토스트, 활용 메모·태그 편집, 항공사별 그룹, `?tab=` 상태 저장, bfcache `pageshow`+`persisted` → reload, `scroll-keep.js?v=3`(defer 없이), `inapp.js?v=10`, 커뮤니티 카드 `community-card.js?v=3` — 전부 유지. 스텁의 `noindex`·리다이렉트는 제거한다. `<title>`·`og:title`·`twitter:title` 은 `항공 뉴스 — MONC 몬크`.

### 5.2 읽기 창(신설)
- 두 번째 바텀시트 `#nwReader`(`.nw-sheet.nw-reader`, `role="dialog" aria-modal="true" aria-labelledby="nwReaderTitle"`). 스크림은 기존 `#nwScrim` 하나를 공유한다 — 스크림 클릭·Esc 는 열려 있는 쪽(필터 시트 또는 읽기 창)을 닫는다.
- 내용 순서: 손잡이 → 항공사·주제 칩(`.nw-tag` 재사용) → 제목 `h2#nwReaderTitle` → 언론사 · 게시 날짜(`fmtDate`) → 요약 `p.nw-reader-sum`(15px/1.7, `--text`) → 동작 줄 `.nw-reader-actions`: **[스크랩/저장됨]**(카드와 같은 `#moncWin` 그림+글자 라벨, 상태는 `scrapByArticle` 과 동기) + **[원문 읽기 ↗]**(`<a target="_blank" rel="noopener noreferrer">`, 라벨에 언론사명 포함 — "원문 읽기 · 연합뉴스") → 스크랩된 기사면 `.nw-extras`(활용 메모·태그 — 내 스크랩 탭의 편집기와 **같은 마크업·같은 위임 핸들러**, 코드 복사 금지: 핸들러를 공용 함수로 빼서 스크랩 뷰와 읽기 창 컨테이너 둘에 붙인다) → 닫기 버튼.
- 활자: 제목 18px/1.45(`--ink`), 메타 12px `--text-muted`, 요약 15px/1.7, 버튼 높이 ≥44px, 창 `max-height: 82vh; overflow-y: auto`(필터 시트 72vh 보다 크게 — 요약이 길 때 스크롤).
- 포커스: 열면 제목(`tabindex="-1"`)으로, 닫으면 **열었던 카드의 버튼으로 복귀.** `prefers-reduced-motion` 은 기존 `.nw-sheet` 규칙에 포함.
- 스크랩 토글은 읽기 창 안에서도 `toggleScrap()` 하나를 통해서만 한다(경쟁 조건 3중 안전장치 공유). 토글 결과는 목록 카드의 버튼 상태에도 반영한다.

### 5.3 카드
- 카드 본문(제목·요약·메타)을 `<button class="nw-open" type="button" data-id>` 로 감싼다(블록 버튼, `text-align:left; font:inherit`). 스크랩 버튼 `.nw-bm` 은 **버튼 안에 넣지 않고 형제**로 둔다(중첩 인터랙티브 금지). div+click 금지(원칙 14).
- 제목 아래 `p.nw-card-sum`: 요약이 있을 때만, 13px `--text-muted`, 2줄 클램프. 제목 2줄 클램프는 그대로.
- 접힌 하위 카드(`.nw-sublist`)·내 스크랩 탭 카드도 같은 구조 — 어디서 눌러도 읽기 창이 열린다.
- 목록 조회 `select` 에 `summary` 를 추가한다. 표가 아직 없으면 기존 `showNotReady()`('뉴스 게시판을 준비 중이에요')가 그대로 동작해야 한다.

### 5.4 주소·뒤로가기
- 카드에서 열면 `history.pushState({ nwReader: id }, '', ?a=<id> 를 더한 주소)`. 닫기(버튼·스크림·Esc)는 `history.state.nwReader` 가 있으면 `history.back()`, `popstate` 가 창을 닫는다 → **폰 뒤로가기는 창만 닫고 페이지를 떠나지 않는다.**
- `news.html?a=<id>` 로 직접 들어오면(마이페이지 접이 링크·공유) 목록과 별개로 `.eq('id', a).maybeSingle()` 로 그 기사 1건을 받아 창을 연다. 이때는 push 하지 않고, 닫을 때 `replaceState` 로 `a` 를 지운다. 기사가 없으면(90일 정리됨·잘못된 id) 창을 열지 않고 토스트 "지워진 기사예요".
- 기존 `switchTab()` 의 `?tab=` replaceState 와 공존: `a` 와 `tab` 은 서로 지우지 않는다. bfcache 복원(reload)은 주소의 `?a=` 를 다시 읽어 창을 되살린다.

### 5.5 문구
- 요약 없음: `p.nw-reader-none` "요약을 가져오지 못한 기사예요. 원문에서 읽어 주세요." — 빈칸으로 두지 않는다.
- 히어로 부제(v1 그대로): "스크랩하면 마이페이지에 항공사별로 쌓여요 — 면접 답변 재료가 됩니다."
- 비로그인 스크랩 시도: v1 confirm 문구 그대로.

### 5.6 보안·접근성
- 요약·제목·언론사명은 외부 문자열 — **반드시 `esc()` 를 거쳐 렌더**(innerHTML 직접 삽입 금지). 원문 URL 은 `^https?://` 만 링크로 만든다(그 외는 링크 없이 텍스트).
- 12px 하한, 대비 4.5:1, 경계선 3:1, 터치 44px, 가로 넘침 0(375px 실측).

## 6. 수집기 설계 — `scripts/fetch-news.mjs`

### 6.1 출처
- `GET https://openapi.naver.com/v1/search/news.json?query=<검색어>&display=100&sort=date&start=<1, 101, 201…>` 헤더 `X-Naver-Client-Id`·`X-Naver-Client-Secret`(env `NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET`). 하루 한도 25,000회 — 평시 12회/실행 × 8회/일 = 96회.
- 검색어 12개는 v1 그대로: 항공사 10개 이름(`AIRLINES[].name`) + `항공사 채용` + `국내 항공업계`.
- `--pages N`(기본 1, 최대 10): 검색어마다 N 페이지를 받는다. 첫 씨앗 채우기는 5.
- 검색어 하나가 실패해도 나머지는 진행(v1 규칙). 401/403 이면 키 문제라고 로그에 명시.

### 6.2 파싱·정규화
- 응답 JSON `items[]`: `title`·`description`(검색어가 `<b>` 로 감싸져 있고 HTML 엔티티가 섞인다 → 태그 제거 + `&quot; &amp; &lt; &gt; &apos; &#39; &nbsp;` 해제), `originallink`(원문 URL), `link`(네이버 뉴스 URL 또는 원문), `pubDate`(RFC 2822 → `new Date().toISOString()`).
- `url = originallink || link`. `^https?://` 가 아니면 버린다. 구글 시절의 '제목 꼬리 " - 언론사" 제거' 코드는 네이버 제목엔 없으므로 삭제(dead code 금지).
- `source`(언론사명)는 네이버 API 가 주지 않는다 → 6.4 의 `og:site_name`, 없으면 호스트명(`www.` 제거).

### 6.3 제외 규칙
- v1 규칙 전부 유지: `EXCLUDE`+`RESCUE`(참사), `SPORTS`, `STOCKS`, `AVIATION` 화이트리스트+`mentionsAirline`, `BAD_SOURCE`, `TRAVEL_AD`+`AD_KEEP`, `MUSEUM`. 함정 낱말 목록(`골프`·`방출`·`선수`·`감독`·`에어`·`(?<!지)배구`·`제주항공우(?![가-힣])`·`한진칼`·`이스타` 별칭)은 news.md 그대로.
- `BAD_SOURCE` 는 이제 `source` 문자열 대신 **URL 호스트**(`blog.naver.com`·`cafe.naver.com`·`tistory.com`·`post.naver.com`)로 판정한다(네이버 뉴스 API 는 등록 언론사만 주지만 방어로 유지).
- **신설 `ACADEMY`**(사유 표기 `학원`): 초안 `/승무원\s*학원|학원|아카데미|합격(자|생)\s*배출|수강생|항공(서비스|운항|관광)\s*(학과|학부|과)|취업\s*연계/`. 실측 근거(2026-09-07 dry-run 678건 중): "홍대승무원학원 윙스카이, 대한항공승무원채용 두 자릿수 합격자 배출"(kal/recruit 로 분류돼 있었다), "광주여대 항공서비스학과, 사우디항공 승무원 채용 행사에 취업연계 프로그램 운영".
  - ⚠️ **넣지 말 것**: `양성`("에어부산, 커리어 엑스포 참가…항공산업 인재 양성" 잘림), `교육`("대한항공, 아시아나항공과 교육기부 봉사·안전체험" 잘림), `대학`·`학과` 단독(항공사–대학 MOU 기사는 남긴다).
  - 최종 낱말은 dry-run '제외: 학원' 목록을 눈으로 보고 **오탐 0** 으로 확정한다. 숫자가 크면 잘 걸러진 게 아니라 잘못 걸러진 것이다(v1 교훈).
- `dropReason()`/`isDropped()` 한 쌍을 수집(스텝 2)과 저장분 청소(스텝 6)가 같이 쓴다(v1 그대로).

### 6.4 요약 수집
- 대상: 필터·중복 제거를 통과한 **신규 행(`fresh`)만**. 재실행마다 전체를 다시 긁지 않는다.
- 방법: 원문 URL 을 `fetch`(리다이렉트 follow, `AbortSignal.timeout(8000)`, UA `Mozilla/5.0 (compatible; MONC-news/1.0; +https://monc.ai.kr)`, `Accept: text/html`). `content-type` 이 HTML 이 아니면 스킵. 본문은 최대 512KB 까지만 읽고, 문자셋은 `content-type`→`<meta charset>` 순으로 읽어 `TextDecoder`(EUC-KR 포함) 로 해제. `og:description`·`og:site_name` 을 정규식으로 뽑는다(`property`→`content` 순서와 그 반대 둘 다). 동시 4개.
- 폴백 사슬: `og:description` → 네이버 `description`(태그 제거) → `null`. 요약은 공백 정리 후 **300자에서 자른다**(말줄임 '…').
- 저장 필드: `summary`, `source`(og:site_name → 호스트명).
- 로그: `요약 성공 N · 폴백 N · 없음 N`. 실패는 기사 저장을 막지 않는다.
- 진단 플래그 `--summary-test <url>`: URL 하나의 og 결과만 출력하고 종료(막는 언론사 확인용).

### 6.5 저장·정리 스텝(v1 순서 유지)
1. 수집(6.1) → 2. 제외+분류+배치 내 같은 사건 묶기(`DUP_MIN` 0.5·`DUP_MIN_TOKENS` 5·대괄호 말머리 제거 유지) → 3. DB 최근 500건 제목과 대조 → **3.5 요약 수집(6.4, `fresh` 만)** → 4. `upsert on_conflict=url`(중복 무시) → 5. 90일 지난 기사 삭제, **스크랩된 기사는 남긴다**(`news_scraps(id)` 임베드로 판정 — cascade 로 회원 재료함이 날아가므로) → 6. 저장분 무관 보도 청소(스크랩 제외) → 6-2. 저장분 같은 사건 중복 정리(먼저 실린 1건·스크랩 우선) → 7. 저장분 재분류(바뀐 행만 PATCH).
- PostgREST 1,000행 상한 페이지네이션(`sbFetchAll`)·`deleteIds` 100개 청크 유지.

### 6.6 실행 모드
- `node scripts/fetch-news.mjs` — 실행(env: `SUPABASE_URL` 기본값 내장, `SUPABASE_SERVICE_ROLE_KEY`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` 필수).
- `--dry-run` — DB 없이 수집·제외·묶기·분류 결과 출력(네이버 키는 필요). 요약 수집은 하지 않는다(빠르게). 제외 사유별 목록·묶인 목록·저장 대상 상위 30건·미분류 비율 출력(v1 그대로) + `학원` 사유 추가.
- `--pages N`, `--summary-test <url>` 은 위.

### 6.7 워크플로 — `.github/workflows/news.yml`
- `schedule: cron '0 */3 * * *'` + `workflow_dispatch` 입력 `mode`(`run`|`dry-run`, 기본 run)·`pages`(기본 '1'). `permissions: contents: read`, `timeout-minutes: 10`, `actions/setup-node@v4` node 22.
- env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`·`NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET` 은 `secrets.*`.
- ⚠️ 공개 리포는 60일 무커밋이면 스케줄이 자동 중지된다(v1 기록) — 메일 오면 Actions 탭에서 재활성.
- 워크플로는 **기본 브랜치(main)에 있어야 Actions 탭에 뜬다** → 11절 롤아웃 1단계에서 main 에 먼저 올린다.

## 7. 데이터 모델 — `supabase/migrations/20260907120000_news_board_v2.sql`

v1 `20260721120000_news_board.sql` 과 같은 구조를 `create table if not exists` 로 다시 만들고, `summary text` 열을 더한다(`alter table … add column if not exists summary text` 도 함께 — 표가 이미 있는 환경 대비). 인덱스(`published_at desc`·`airline`·`topic`·`news_scraps.member_id`), RLS(`news_articles` SELECT anon+authenticated 공개 / 쓰기 정책 없음 = service role 만, `news_scraps` 본인 CRUD `member_id = auth.uid()`), `unique(url)`, `unique(member_id, article_id)`, `on delete cascade` 전부 v1 그대로. 주석에 "본문·사진 저장 금지, summary 는 og:description ≤300자" 를 적는다. 검증: anon 프로브 `rest/v1/news_articles?select=id&limit=1` → `200 []`(전엔 `PGRST205`).

## 8. 노출·연결 변경

| 파일 | 변경 |
|---|---|
| `news.html` | 스텁 → 5절 페이지 |
| `tools.html` | 격자 **첫 칸**에 `<a class="tl-card" href="news.html">` — 제목 '뉴스 스크랩', 부제 '항공 뉴스를 요약으로 읽고 담아요'; `<symbol id="tn-news">`(신문 그림 — `d03424e` 에서 지운 path 그대로) 복귀; 부제 '매일 쓰는 면접 준비 도구 **5가지**'; `og:description`·`twitter:description`·`description` 3곳에 '뉴스 스크랩, ' 복귀 |
| `nav.js` | `TOOLS_SUB` 2번째(answers 다음)에 `['news.html', '항공사 뉴스&산업분석', '10개 항공사 소식 · 스크랩']`, `SECTION_OF` 에 `'news.html': 'tools'`; 폐지 주석 제거 |
| `mypage.html` | `#sec-news` 접이(`d03424e` 제거분 복귀) + `loadNewsScraps()` — 항목 링크는 언론사 URL 이 아니라 **`news.html?a=<article id>`**(우리 읽기 창), '전체 N건 →' 은 `news.html?tab=scraps`. 0건이면 접이를 안 연다(빈 껍데기 금지). 호출은 `loadLabPurchases()` 옆 |
| `community-card.js` | 헤더 주석 '2곳' → '3곳(lab-shelf·news·tools)'. 동작 변경 없음 → `?v=` 상향 없음 |
| `sitemap.xml` | `news.html` 항목 복귀(`changefreq daily`, `priority 0.7`, lastmod 배포일) |

## 9. 문서 갱신(같은 커밋)

- `CLAUDE.md`: 프로젝트 구조 4번(뉴스 수집기 부활 — "브라우저 밖에서 도는 코드는 GitHub Actions 수집기 하나"), 기능별 문서 표 '뉴스' 행(폐지 → 현행: 출처 네이버 API·요약 og:description·본문 금지·학원 규칙), 승준 도구 행 '표시 4종'→5종, 커뮤니티 카드 행 2곳→3곳, '절대 되살리면 안 되는 것' 의 뉴스 폐지 줄 → "구글뉴스 RSS 출처·본문 저장·AI 요약" 으로 교체.
- `docs/notes/news.md`: 맨 위에 '2026-09-07 부활(v2)' 절 — 오너 원문, 결정 표, 학원 규칙·함정 낱말, 요약 규칙, 네이버 API 전환 이유, 실측(13절). 폐지 절은 역사 기록으로 남긴다.
- `docs/notes/briefing.md`(도구 4→5, 아이콘 6종), `docs/notes/nav.md`(싣는 페이지 28→29, TOOLS_SUB), `docs/notes/pages.md`(커뮤니티 카드 3곳), `docs/notes/mypage.md`(접이 복귀·`?a=` 링크), `docs/notes/page-common.md`(bfcache 집합에 news 복귀), `docs/notes/implementation-status.md`(마이그레이션 행·Actions 시크릿 3개·워크플로 상태).

## 10. 검증

- 수집기: Actions `workflow_dispatch` `mode=dry-run` 로그에서 '제외: 학원' 목록 눈검사(오탐 0), 여행상품·스포츠 등 기존 사유 건수가 v1 실측 범위인지 확인. 로컬은 키가 있을 때만 `node scripts/fetch-news.mjs --dry-run`.
- 요약: `--summary-test` 로 연합뉴스·조선·매경·중소 매체 URL 각 1건 확인. 첫 실 실행 로그의 `요약 성공/폴백/없음` 비율 기록(실측 근거 8/8 성공 — 13절).
- DB: 마이그레이션 후 anon 프로브 `200 []`.
- 화면 375px(필수)·1280px: 카드(요약 2줄 클램프·제목 2줄), 읽기 창(≤82vh 스크롤·버튼 44px·포커스 복귀), 폰 뒤로가기 = 창 닫힘, `?a=` 직접 진입·없는 id 토스트, 읽기 창 스크랩 토글 ↔ 카드 상태 동기, 메모·태그 편집 in 창, 내 스크랩 탭·마이페이지 접이 링크, 가로 넘침 0, 콘솔 에러 0, 표 없을 때 '준비 중'.
- design-principles.md '적용 방법' 항목표로 측정값 기록.

## 11. 오너 작업·롤아웃 순서

**오너 작업 4개**: ① GitHub → Settings → Secrets and variables → Actions 에 `SUPABASE_SERVICE_ROLE_KEY` 존재 확인(없으면 Supabase 콘솔 service_role 키로 재등록) ② developers.naver.com → Application 등록(사용 API '검색') → `NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET` 를 같은 곳에 등록(절차는 구현 완료 시 화면 순서대로 전달) ③ 마이그레이션 SQL 을 Supabase SQL Editor 에서 실행(대화창 ```sql 로 전달) ④ Actions 탭 '항공 뉴스 수집' → Run workflow(`pages=5`) 1회.

**롤아웃 2단계**(워크플로는 main 에 있어야 실행되고, UI 는 실데이터로 실측해야 하므로):
1. **1단계(main 직행, 화면 변화 없음)**: 마이그레이션 + `scripts/fetch-news.mjs` + `.github/workflows/news.yml` + implementation-status. → 오너 ①②③④ → 표가 채워진다. dry-run 으로 학원 규칙 확정.
2. **2단계(브랜치 `claude/news-scraping-feature-01b81f` → 375px 실측 → main)**: `news.html`·`tools.html`·`nav.js`·`mypage.html`·`sitemap.xml`·`community-card.js` 주석·문서. 로컬 프리뷰(`wkon-static`)는 라이브 Supabase 를 읽으므로 1단계 데이터로 실측할 수 있다.

## 12. 리스크·대응

- 언론사가 서버 요청을 막아 요약이 없다 → 폴백 사슬 + '요약 없음' 문구. 비율이 높으면 `--summary-test` 로 매체별 확인.
- 네이버 API 장애·키 만료 → 검색어 단위 스킵 로그, 다음 3시간에 재시도. 401 이면 로그에 '키 확인'.
- 학원 규칙 오탐 → dry-run 눈검사로만 확정, 넓히지 않는다.
- 스케줄 60일 자동 중지 → 메일 통지 시 재활성(구 v1 기록).
- 약관 → 3절 경계 유지(본문·사진 금지, 90일).
- `?a=` 뒤로가기 처리 회귀(bfcache reload 와 충돌) → 10절 실측 항목으로 고정.

## 13. 2026-09-07 실측 기록(결정 근거)

- 옛 수집기 dry-run(구글 RSS, 12쿼리): 수집 1,052 → 제외 73(블로그 2·여행상품 54·항공무관 7·참사 10) → 같은 사건 301 묶음 → 저장 대상 678(주제 미분류 34%). 그 678건 안에 학원 홍보 1건(kal/recruit 오분류)·대학 학과 홍보 1건.
- 구글 RSS `<copyright>`: "solely for … personal, non-commercial use. Any other use … expressly prohibited". 기사 링크(`news.google.com/rss/articles/CBMi…`)는 plain fetch 로 원문 주소를 돌려주지 않는다(580KB JS 페이지, 원문 도메인 문자열 0건).
- Bing 뉴스 RSS: 쿼리당 11~12건(구글 ~100건 대비 얇음), 3/11 이 msn.com 사본 → 주 출처 부적합.
- 네이버 뉴스 검색 API: 엔드포인트 살아 있음(키 없이 401 `024`), 문서상 `originallink`·`description`·`pubDate`, display ≤100, start ≤1000, 하루 25,000회. 약관: 허용 범위 밖 저장·캐시 금지(3절 반영).
- `og:description` 서버 fetch: 실기사 8/8 성공(industrynews·enetnews·e-science·yna·mk×2·fnnews·kyeonggi). `og:site_name` 도 같은 방식.
