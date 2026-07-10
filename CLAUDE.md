# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MONC (몬크 챌린지) — a Korean landing site for a 2-week voice/expression/interview training program aimed at airline cabin crew applicants. It is a **static site with no build step**, hosted on GitHub Pages at https://kwonsunghoho.github.io/wkon/. There is no framework, bundler, package.json, or test suite — just hand-written HTML/CSS/JS files served as-is.

## Commands

- **Local preview**: `python -m http.server 5500` then open `http://localhost:5500/`. (A `.claude/launch.json` defines a `wkon-static` server for the preview tooling.)
- **Deploy**: `git push origin main` — GitHub Pages serves `main` directly. There is nothing to build; a push *is* the deploy. Allow 1–2 minutes for propagation.
- **No lint/test commands exist.** Verify changes by rendering in a browser.

The repo is sometimes edited from a git **worktree** under `.claude/worktrees/...` on a `claude/*` branch. The canonical checkout is the repo root on `main`; make sure work lands on `main`.

## Backend: there is no server

All "backend" behavior is **Google Apps Script** + **published Google Sheets**, called directly from the browser. Two independent data sources:

1. **Applications & reviews** — `APPLICATION_API_URL` (Apps Script web app).
   - `POST {action:"application", ...}` → appends/updates a row in the **학생현황** sheet (one row per student, keyed by phone; challenge columns marked "신청"). Phone is stored with a leading apostrophe so Sheets keeps the leading `0`.
   - `GET ?action=reviews` → returns JSON from the **후기** sheet (columns: A=이름, B=후기, C=요약, D=원문 링크).
   - **The Apps Script is owned/edited in Google's console, not in this repo.** Code changes there require the owner to redeploy a *new version* before they take effect.
2. **Recruitment dates** — `RECRUIT_CSV` in `recruit.js`, a *published* Google Sheet CSV (different mechanism from #1). Drives "모집 중 / 모집 예정 / 마감" status and D-day chips.

## Architecture / things that require reading multiple files

### The application modal exists in TWO places — keep them in sync
This is the single biggest footgun. The challenge sign-up modal is implemented twice:

- **`index.html`** has its own inline copy: the modal markup, `submitApplication()`, `copyAccount()`, price/deposit logic, and the bank account info — button class `.modal-btn`.
- **`application-modal.js`** is a *separate, self-injecting* copy used by the detail pages: it injects its own CSS + modal HTML and defines its own `submitApplication()` / `copyAccount()` — button class `.app-modal-btn`.

Any change to pricing, the deposit, the bank account number, the submit/duplicate-guard logic, or the modal fields **must be made in both files**. `APPLICATION_API_URL` is also declared independently in each (currently identical — keep them identical).

**⚠️ 2026-07-08 업데이트 — 신청 창구가 `apply.html`(별도 페이지)로 이관됨.** index·상세페이지의 모든 "신청하기" CTA는 이제 팝업을 열지 않고 `apply.html`로 이동한다(상세페이지는 `apply.html?c=<recruit-id>`로 해당 챌린지 프리셀렉트). 위 두 모달 코드는 **삭제하지 않고 남았지만 휴면(미사용)** 상태다(`openApplicationModal`은 정의부 + `?openModal=true` 자동열기에만 남음). **가격·보증금·계좌번호·커리큘럼·제출 스키마의 실사용 소스는 이제 `apply.html`** 이니 변경은 여기를 우선 수정한다. (모달 2곳은 향후 정리 예정.)

### Pages
- `index.html` — the landing page. Large and self-contained: design tokens, all sections, the inline modal, review loading, and most JS live here.
- `apply.html` — **신청·결제 전용 페이지(2026-07-08 신설, 모든 신청 CTA의 목적지).** 구조: 히어로 → 챌린지 카드 4개(카드 클릭=선택+2주 커리큘럼 아코디언 펼침, 다중선택 장바구니) → 회원가입 유도 배너(→`login.html`) → 조합 추천 배너 → FAQ 아코디언 → 계좌이체 신청폼 → 하단 고정 요약바. `?c=voice,answer` 쿼리로 프리셀렉트. `supabase-config.js`+`recruit.js` 로드, `loadChallengeStatuses()`로 마감/모집예정 카드 비활성, 제출은 `MONC.sb.from('applications').insert(...)`(모달과 동일 스키마). 챌린지 데이터·FAQ는 페이지 하단 인라인 `<script>`의 `CHALLENGES`/`FAQ` 배열. FAQ #3(진행방식)·#6(수료기준)·#7(환불)은 오너 확정 전 임시 문구. **회원 모드**: 로그인 시 `getMyProfile()`로 이름·전화 자동 채움(입력칸 숨김)·`applications.insert`에 `member_id` 포함(→마이페이지 '내 신청내역' 연동, `applications.member_id` 컬럼 사용)·전화가 프로필에 없으면 입력받아 `members`에 저장. 비로그인은 전체 폼 + 로그인 유도 배너. 강조 애니메이션: 회원가입 배너(테두리+글로우 브리딩+버튼 샤인), 하단 신청바(선택 시 펄스) — `prefers-reduced-motion` 시 정지.
- `onboarding.html` — **회원 온보딩(2026-07-08 신설).** 첫 로그인 후 `login.html`의 `routeByRole()`이 `!profile.phone && !localStorage.monc_onboard_done`이면 여기로 보냄. 이름·전화·**전공(major)** 입력 → `members` 저장 후 마이페이지(또는 `?returnTo`)로. ⚠️ `members.major` 컬럼은 마이그레이션 `20260708120000_member_major.sql`로 오너가 Supabase에 직접 추가해야 함(미적용 시 전공만 방어적으로 무시, 이름·전화는 정상 저장). `getMyProfile()` 공용 셀렉트에는 major를 넣지 않음(컬럼 미생성 시 전체 프로필 조회가 깨지므로) — major는 필요한 곳에서 별도 방어 조회.
- `reviews.html` — **후기 모음 페이지(2026-07-10 신설).** 홈 '후기 더 보기 →' CTA + nav '후기' 링크의 목적지. Supabase `reviews` 테이블(visible=true) 전체를 **매스너리(CSS columns) 그리드**로 보여주고, **챌린지(보신각/영합각/스피닝/승자각) + 기수(1~4기·미상) 필터칩**(AND 조합, 데이터에 존재하는 값만 동적 생성)으로 좁혀 본다. 각 카드 = 원본 후기 스크린샷 + 챌린지·기수 칩, 클릭 시 라이트박스. `supabase-config.js`만 로드, `select('*')`라 분류 컬럼 미적용 시에도 에러 없이(필터바 숨김·전체 그리드) 동작. 후기 스크린샷엔 수강생 **실명이 그대로** 노출(공개 카페 후기, 오너 승인). 분류 데이터 출처는 아래 reviews 분류 컬럼.
- Active detail pages (index 카드에서 링크, 각자 `application-modal.js` 로드하지만 신청 버튼은 이제 `apply.html?c=<id>`로 이동): `challenge-voice.html` (보신각), `challenge-expression.html` (영합각), `challenge-spinning.html` (스피닝), `challenge-answer.html` (승자각).
- `challenge-express.html` and `challenge-speech.html` are **legacy/unused** — not linked from the index and do not load the shared modal. Don't edit these assuming they're live.
- `terms.html`, `privacy.html` — legal pages linked from the footer.
- `index.backup-*.html` — manual timestamped backups, not part of the site.

### recruit.js (shared by index + detail pages)
Fetches `RECRUIT_CSV`, falls back to `RECRUIT_FALLBACKS` (and per-card `data-recruit-start/-end` attributes) when the sheet is unavailable. Key entry points:
- `applyIndexRecruit()` — rewrites each `.challenge-card`'s status badge, period text, and D-day chip on the index.
- `applyDetailRecruit(id)` — does the same for a detail page and disables `.apply-btn` when closed.
- `loadChallengeStatuses()` — populates `window._challengeStatuses` so the modal can disable checkboxes for closed/upcoming challenges.
Each challenge's identity is the `data-recruit-id` (`voice` / `expression` / `spinning` / `answer`), used consistently across cards, fallbacks, and the sheet.

### COMMUNITY 섹션 (index, 2026-07-10 리디자인)
구 "LIVE FEED" 후기 캐러셀/라이트박스(`loadReviews()`·Supabase reviews 조회)는 **제거**되고, `#community` 사회적 증거 섹션으로 교체됨. 구성: 집계 지표 3카드(카운트업, IntersectionObserver 1회) + '가장 좋았던 점' 롤링 배너(네이비) + **대표 후기 카드 3장** + '후기 더 보기' CTA(→reviews.html). **후기 카드 구조(2026-07-10 재설계 — 실명 카페 스크린샷=진짜 증거를 주인공으로):** 카드 상단에 **원문 캡처 크롭 프리뷰 밴드**(`.mc-review-capture`) — 스크린샷 윗부분(제목·작성자 실명·첫 문장)만 `object-position:top`으로 128px(모바일 116px) 노출하고 아랫부분은 흰색 페이드, **밴드 전체가 `#mcLightbox` 트리거 버튼**(터치 116px+), 좌하단 '실제 참여 인증' 초록칩·우하단 '원문 전체 보기' 네이비 pill 오버레이. 그 아래 본문에 **한줄평 quote**(`.mc-review-quote` — 15px/700 볼드 + 골드 좌측 3px 라인으로 '요약 훅' 정적 강조[9대원칙6], 뷰포트 진입 시 `.mc-q-in` fade-up **1회**만·**기본 opacity 1이라 IO 미발화·reduced-motion에도 항상 노출**[우아한 강등]·펄스/타이핑은 히어로 위계 전복·가독성 문제로 배제) + 이름·챌린지 태그. **captureUrl 없는 후기는 밴드 없이 텍스트 + `.mc-review-badge` 인증 배지 폴백**. (구 '40px 하단 썸네일 + 원문 캡처 보기 회색 행' 구조는 폐기.) **지표·롤링 문구는 `site_config`(key `community_stats`/`community_phrases`, admin '홈 커뮤니티' 탭에서 수정).** **후기 카드는 `reviews` 테이블에서 `sort_order≥1`(대표) 상위 3개**를 로드(`loadCommunityCards()`) — admin '후기 관리' 탭에서 대표 번호(1·2·3)를 매기면 그 순서로 홈에 노출, 미지정 시 최근 3개 자동. 카드의 name=`reviewer_name`·tag=`challenge`·quote=`quote`·캡처=스크린샷. `index.html` 하단 JS 상수(`COMMUNITY_STATS`·`ROLLING_PHRASES`)는 site_config 로드 실패 시 폴백(후기 카드엔 폴백 없음 — 실패 시 빈 그리드, **가짜 카드 재도입 금지**). ⚠️ `site_config`는 마이그레이션 `20260710120000_site_config.sql`을 오너가 실행해야 생성(미적용이어도 홈은 폴백으로 정상). `#mcLightbox`는 세로 긴 스크린샷 가독성을 위해 폭 기준 확대 + 탭 확대(reviews.html과 동일 방식). CSS는 `.mc-community` 스코프(--mc-* 아이보리-네이비-골드 토큰). nav 앵커 `#community`(섹션)·`#testimonials`(내부 span) 둘 다 유지. ⚠️ 개인의 "몇 분 전" 실시간 활동 연출은 재도입 금지. (구 `site_config.community_reviews` 키·admin '홈 커뮤니티' 후기 카드 편집기는 폐기됨 — 후기 카드는 이제 reviews 테이블 대표가 소스.) **admin 후기 관리 탭·bulk-reviews.html은 여전히 Supabase `reviews` 테이블에 쓰지만, index(홈)는 더 이상 읽지 않음** — 대신 [reviews.html](reviews.html)(후기 모음 페이지)가 이 테이블을 소비한다.

### reviews 테이블 분류 컬럼 (2026-07-10)
`reviews`에 `challenge`(보신각/영합각/스피닝/승자각)·`cohort`(smallint, NULL=미상)·`reviewer_name`·`review_date`(date)·`quote`(대표 한줄평, 현재 미표시) 컬럼 추가 — reviews.html의 기수·챌린지 필터에 사용. 마이그레이션 `20260710130000_reviews_classify.sql`이 컬럼 추가 + **기존 108건 백필**(후기 스크린샷을 비전 분류해 얻은 값)까지 포함하니 오너가 Supabase SQL Editor에서 실행해야 함. admin '후기 관리' 탭의 각 카드에서 챌린지 드롭다운·기수·이름을 수정하면 이 컬럼들이 갱신된다(신규 업로드분 분류·오분류 교정용). `quote`는 저장만 하고 어디에도 표시하지 않음(admin 참고·향후 활용).

### Design system (`tokens.css`)
Shared design tokens live in `tokens.css` (linked by `index.html` + the detail/legal pages + the member pages login/mypage/admin). Core conventions:
- **팔레트 (2026-07-04 리브랜드):** 넓은 면·배경 = 베이지 `--bg #E9E4D8`; **타이틀·전환 CTA = 오렌지 `--action #F27945`**; 중간 강조·액센트 = 네이비 `--accent #194192`; 본문 = 다크 뉴트럴 `--text #26221C`. ⚠️ 오렌지는 흰 글씨 대비가 낮으므로(≈2.7:1) **CTA 버튼은 오렌지 배경 + 진한 글씨 `--action-ink #2A1206`(≈5.6:1)** 로 구성한다. 섹션 타이틀=오렌지(`.section-title`), 에이브로우 라벨=네이비(`.section-label`). (구 Warm Sunrise 브라운/코랄 및 그 이전 pink/teal 설명은 모두 폐기.) 잔여: 일부 하드코딩 갈색(상세페이지 아바타 등) 정리 미완.
- **UI 디자인 원칙:** 모든 UI 작업은 [docs/design-principles.md](docs/design-principles.md)의 **모바일 UI 9대 원칙**(가독성 12pt+ / 터치 44px+ / 명도대비 4.5:1 / 아이콘 통일 / 라운드 기조 / 계층 / 여백 / 그룹핑 / 큼직한 레이아웃)을 엄격히 준수한다. 회원 99%가 모바일 유입 → **375px에서 먼저 검증**.
- Typography (`--fs-*`), spacing (`--space-*`, 8px scale), radius scale (8/14/20/24), and section background rhythm are all tokenized. Prefer tokens over hardcoded values.
- Icons are inline SVG `<symbol>`s in a sprite at the top of `<body>`, recolored via `currentColor`. There is a mobile sticky CTA bar (`.mobile-cta-bar`, shown ≤768px).

### Audio (before/after recordings on detail pages)
`audio/` holds challenger before/after clips referenced by the detail pages. Naming is positional: `challenger-a-before.mp3` … (voice page) and `spinning-a-before.m4a` … (spinning page). Watch for double extensions when files are added on Windows (e.g. `*.mp3.m4a`).

### 면접관 체험 블라인드 퀴즈 (`index.html` #blind-quiz)
사진 인트로(`images/bq-intro.jpg`) + 실루엣 영상 씬(`video/bq-candidate.mp4`, muted loop — 클립 재생 중일 때만 재생/배지 "지원자 X 답변 중" 전환, `syncScene()`) + 판정 콘솔 구조. 퀴즈 로직(5라운드, `audio/` 전/후 풀 랜덤)은 IIFE에 있고, 루트 셀렉터는 `.bq-stage`(구 `.bq-card`). `prefers-reduced-motion`이면 영상 자동재생·Ken Burns·EQ 애니메이션 정지.

### 창문 인트로 태그라인 + MONC 조립 (`index.html` #heroTagline, 2026-07-10)
`.hero-window-intro` 안, `.zoom-exit-pin` **밖**(형제)의 오버레이 `.hero-tagline` — 핀의 scale(3.2) 확대를 받지 않도록 분리, JS가 `position:fixed`로 승격(`.ht-fixed`). 창문 줌과 동일한 스크롤 진행률 계산식(`scroll-fx.js`는 무수정, 독립 IIFE가 파일 맨 끝 `<script>`에 있음)으로: "Moment Of New Career" 문장(M·O·N·C만 오렌지 800)이 0~30%에서 MONC 로고로 FLIP 조립 → 조립 완료 순간 transform 확대 글자를 네이티브 렌더 `.ht-target`로 교체(래스터 흐림 방지) → 52~78%에서 확대+페이드로 창 통과 연출. 서브라인("새로운 커리어가 밝아오는 순간")은 자간 락업이 문장 폭(g0)→로고 **잉크** 폭(g1, 캔버스 `measureText` 사이드베어링 보정)으로 동반 수축, 넘치면 scale 축소. 로고 크기는 `min(17vw, 18vh)` — 개구부가 뷰포트 높이에 비례해서 vh 제약이 창틀 침범을 막음. reduced-motion·무JS = 정적 풀 문장(absolute 폴백). 모바일에선 스크롤 화살표가 `.mobile-cta-bar`에 가리지 않게 `bottom:96px`. 스펙: [docs/superpowers/specs/2026-07-10-hero-monc-tagline-design.md](docs/superpowers/specs/2026-07-10-hero-monc-tagline-design.md)

### Hero scene carousel (`index.html`)
The landing page hero section is a **4-slide full-screen carousel** (`.hero-scene` > `.hs-slide`), stacked with `position: absolute` and toggled via `opacity` + `pointer-events`. Controlled by `heroSwitchTo(idx)` in JS.

Slides (0-indexed):
| idx | id | 이름 | 특이사항 |
|---|---|---|---|
| 0 | `hs-slide-0` | 보신각 | 전/후 오디오 (`challenger-c-before.mp3` / `challenger-c-after.mp3`), 웨이브폼 바 |
| 1 | `hs-slide-1` | 영합각 | YouTube Shorts (`s1a0ozDYMMo`) 임베드, **YT IFrame API**로 재생 상태 추적 — 재생 중 스와이프/자동전환 차단 |
| 2 | `hs-slide-2` | 스피닝 | 전/후 오디오 (`spinning-c-before.m4a` / `spinning-c-after.m4a`), 원형 버튼 UI |
| 3 | `hs-slide-3` | 승자각 | light cream 배경, 20개 키워드 bounce 애니메이션 (`setInterval 16ms`), 5-node SVG 두괄식 다이어그램 |

Key JS globals: `_heroIdx`, `_heroMode`, `_heroAutoTimer` (5초 자동전환), `_ytPlaying` (YT 재생 상태 플래그), `_ytPlayer` (YT.Player 인스턴스).

슬라이드 3(승자각)은 배경이 밝은 크림색이라 CTA 보조 텍스트 색을 별도로 오버라이드: `#hs-slide-3.active ~ .hs-cta-bar .hs-cta-sec`.

### Google Apps Script — 중복 신청 처리
`학생현황` 시트에 **항상 새 행으로 추가** (전화번호 중복 여부 무관). 기존의 find-and-update 로직은 데이터 덮어쓰기 문제로 제거됨. Apps Script 편집은 Google 콘솔에서 수행 후 새 버전으로 재배포 필요.

## Conventions
- Commit messages and in-code comments are written in Korean (matching the existing history and content).
