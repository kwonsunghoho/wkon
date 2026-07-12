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
- `apply.html` — **신청·결제 전용 페이지(2026-07-08 신설, 모든 신청 CTA의 목적지).** 구조: 히어로 → 챌린지 카드 4개(카드 클릭=선택+2주 커리큘럼 아코디언 펼침, 다중선택 장바구니) → 회원가입 유도 배너(→`login.html`) → 조합 추천 배너 → FAQ 아코디언 → 계좌이체 신청폼 → 하단 고정 요약바. `?c=voice,answer` 쿼리로 프리셀렉트. `supabase-config.js`+`recruit.js` 로드, `loadChallengeStatuses()`로 마감/모집예정 카드 비활성, 제출은 `MONC.sb.from('applications').insert(...)`(모달과 동일 스키마). 챌린지 데이터·FAQ는 페이지 하단 인라인 `<script>`의 `CHALLENGES`/`FAQ` 배열. FAQ #3(진행방식)·#6(수료기준)·#7(환불)은 오너 확정 전 임시 문구. **회원 모드**: 로그인 시 `getMyProfile()`로 이름·전화 자동 채움(입력칸 숨김)·`applications.insert`에 `member_id` 포함(→마이페이지 '내 신청내역' 연동, `applications.member_id` 컬럼 사용)·전화가 프로필에 없으면 입력받아 `members`에 저장. 비로그인은 전체 폼 + 로그인 유도 배너. 강조 애니메이션: 회원가입 배너(테두리+글로우 브리딩+버튼 샤인), 하단 신청바(선택 시 펄스) — `prefers-reduced-motion` 시 정지. **⚠️ 법적 필수(2026-07-11):** 신청 버튼 위 `#appConsent` 통합 필수 동의 체크박스(만 14세 이상 + 개인정보 수집·이용 동의, 항목·목적·보유기간 고지) — `submitApplication()`이 미체크 시 차단. 개인정보 보호법상 삭제·완화 금지.
- `onboarding.html` — **회원 온보딩(2026-07-08 신설).** 첫 로그인 후 `login.html`의 `routeByRole()`이 `!profile.phone && !localStorage.monc_onboard_done`이면 여기로 보냄. 이름·전화·**전공(major)** 입력 → `members` 저장 후 마이페이지(또는 `?returnTo`)로. ⚠️ `members.major` 컬럼은 마이그레이션 `20260708120000_member_major.sql`로 오너가 Supabase에 직접 추가해야 함(미적용 시 전공만 방어적으로 무시, 이름·전화는 정상 저장). `getMyProfile()` 공용 셀렉트에는 major를 넣지 않음(컬럼 미생성 시 전체 프로필 조회가 깨지므로) — major는 필요한 곳에서 별도 방어 조회.
- `reviews.html` — **후기 모음 페이지(2026-07-10 신설).** 홈 '후기 더 보기 →' CTA + nav '후기' 링크의 목적지. Supabase `reviews` 테이블(visible=true) 전체를 **매스너리(CSS columns) 그리드**로 보여주고, **챌린지(보신각/영합각/스피닝/승자각) + 기수(1~4기·미상) 필터칩**(AND 조합, 데이터에 존재하는 값만 동적 생성)으로 좁혀 본다. 각 카드 = 원본 후기 스크린샷 + 챌린지·기수 칩, 클릭 시 라이트박스. `supabase-config.js`만 로드, `select('*')`라 분류 컬럼 미적용 시에도 에러 없이(필터바 숨김·전체 그리드) 동작. 후기 스크린샷엔 수강생 **실명이 그대로** 노출(공개 카페 후기, 오너 승인). 분류 데이터 출처는 아래 reviews 분류 컬럼.
- Active detail pages (index 카드에서 링크, 각자 `application-modal.js` 로드하지만 신청 버튼은 이제 `apply.html?c=<id>`로 이동): `challenge-voice.html` (보신각), `challenge-expression.html` (영합각), `challenge-spinning.html` (스피닝), `challenge-answer.html` (승자각).
- `challenge-express.html` and `challenge-speech.html` are **legacy/unused** — not linked from the index and do not load the shared modal. Don't edit these assuming they're live.
- `login.html` — 구글·카카오 OAuth 로그인. **⚠️ 법적 필수(2026-07-11):** `#agreeChk` 필수 동의 체크(만 14세 이상 + 약관·개인정보) 전에는 두 로그인 버튼 `disabled`. 구 "간주 동의" 문구는 명시 동의로 대체됨 — 되돌리기 금지.
- `terms.html`, `privacy.html` — legal pages linked from the footer. privacy.html은 2026-07-11 실제 스택 기준 전면 재작성(수탁자 Supabase 서울 리전/Google/Kakao, 국외이전 고지, CPO 권성호, 14세 미만 조항). 수집 항목·수탁자 변경 시 이 페이지도 갱신할 것.
- **`applications` RLS**: 마이그레이션 `20260711120000_applications_rls.sql` — INSERT는 공개(비회원 신청), SELECT는 관리자+본인만, UPDATE/DELETE는 관리자만. 오너가 Supabase SQL Editor에서 실행해야 적용(테이블이 콘솔 수동 생성이라 레포에 원본 스키마 없음).
- `index.backup-*.html` — manual timestamped backups, not part of the site.

### recruit.js (shared by index + detail pages)
Fetches `RECRUIT_CSV`, falls back to `RECRUIT_FALLBACKS` (and per-card `data-recruit-start/-end` attributes) when the sheet is unavailable. Key entry points:
- `applyIndexRecruit()` — rewrites each `.challenge-card`'s status badge, period text, and D-day chip on the index.
- `applyDetailRecruit(id)` — does the same for a detail page and disables `.apply-btn` when closed.
- `loadChallengeStatuses()` — populates `window._challengeStatuses` so the modal can disable checkboxes for closed/upcoming challenges.
Each challenge's identity is the `data-recruit-id` (`voice` / `expression` / `spinning` / `answer`), used consistently across cards, fallbacks, and the sheet.

### 랜딩 섹션 순서 (2026-07-12 개편)
창문 인트로 → 히어로 캐러셀(#home) → 블라인드 퀴즈(#blind-quiz) → Before&After(#before-after) → 커뮤니티(#community) → 챌린지 진단(#advisor) → 챌린지 목록(#challenges) → 강사진(#instructors) → 성장기록(#member-appeal) → 최종 CTA. **구 "3단계 How"(#how) 섹션은 삭제됨**(B&A·커뮤니티 증거 연타를 갈라놓던 위치 문제 — 재도입 금지, 진행방식 안내는 apply.html FAQ가 커버). 푸터 "서비스 소개"는 `#challenges`로 연결. 근거: [docs/superpowers/specs/2026-07-12-landing-section-restructure.md](docs/superpowers/specs/2026-07-12-landing-section-restructure.md)

### COMMUNITY 섹션 (index, 2026-07-10 리디자인)
구 "LIVE FEED" 후기 캐러셀/라이트박스(`loadReviews()`·Supabase reviews 조회)는 **제거**되고, `#community` 사회적 증거 섹션으로 교체됨. 구성: 집계 지표 3카드(카운트업, IntersectionObserver 1회) + '가장 좋았던 점' 롤링 배너(네이비) + **대표 후기 카드 3장** + '후기 더 보기' CTA(→reviews.html). **후기 카드 구조(2026-07-10 재설계 — 실명 카페 스크린샷=진짜 증거를 주인공으로):** 카드 상단에 **원문 캡처 크롭 프리뷰 밴드**(`.mc-review-capture`) — 스크린샷 윗부분(제목·작성자 실명·첫 문장)만 `object-position:top`으로 128px(모바일 116px) 노출하고 아랫부분은 흰색 페이드, **밴드 전체가 `#mcLightbox` 트리거 버튼**(터치 116px+), 좌하단 '실제 참여 인증' 초록칩·우하단 '원문 전체 보기' 네이비 pill 오버레이. 그 아래 본문에 **한줄평 quote**(`.mc-review-quote` — 15px/700 볼드 + 골드 좌측 3px 라인으로 '요약 훅' 정적 강조[9대원칙6], 뷰포트 진입 시 `.mc-q-in` fade-up **1회**만·**기본 opacity 1이라 IO 미발화·reduced-motion에도 항상 노출**[우아한 강등]·펄스/타이핑은 히어로 위계 전복·가독성 문제로 배제) + 이름·챌린지 태그. **captureUrl 없는 후기는 밴드 없이 텍스트 + `.mc-review-badge` 인증 배지 폴백**. (구 '40px 하단 썸네일 + 원문 캡처 보기 회색 행' 구조는 폐기.) **지표·롤링 문구는 `site_config`(key `community_stats`/`community_phrases`, admin '홈 커뮤니티' 탭에서 수정).** **후기 카드는 `reviews` 테이블에서 `sort_order≥1`(대표) 상위 3개**를 로드(`loadCommunityCards()`) — admin '후기 관리' 탭에서 대표 번호(1·2·3)를 매기면 그 순서로 홈에 노출, 미지정 시 최근 3개 자동. 카드의 name=`reviewer_name`·tag=`challenge`·quote=`quote`·캡처=스크린샷. `index.html` 하단 JS 상수(`COMMUNITY_STATS`·`ROLLING_PHRASES`)는 site_config 로드 실패 시 폴백(후기 카드엔 폴백 없음 — 실패 시 빈 그리드, **가짜 카드 재도입 금지**). ⚠️ `site_config`는 마이그레이션 `20260710120000_site_config.sql`을 오너가 실행해야 생성(미적용이어도 홈은 폴백으로 정상). `#mcLightbox`는 세로 긴 스크린샷 가독성을 위해 폭 기준 확대 + 탭 확대(reviews.html과 동일 방식). CSS는 `.mc-community` 스코프(--mc-* 아이보리-네이비-골드 토큰). nav 앵커 `#community`(섹션)·`#testimonials`(내부 span) 둘 다 유지. ⚠️ 개인의 "몇 분 전" 실시간 활동 연출은 재도입 금지. (구 `site_config.community_reviews` 키·admin '홈 커뮤니티' 후기 카드 편집기는 폐기됨 — 후기 카드는 이제 reviews 테이블 대표가 소스.) **admin 후기 관리 탭·bulk-reviews.html은 여전히 Supabase `reviews` 테이블에 쓰지만, index(홈)는 더 이상 읽지 않음** — 대신 [reviews.html](reviews.html)(후기 모음 페이지)가 이 테이블을 소비한다. **증거 연타 마감(2026-07-12):** How 삭제로 B&A와 인접해지면서 `mc-title` 아래 브릿지 카피(`.mc-bridge` "방금 들으신 변화, 특별한 사례가 아니에요.")로 깊은 증거(B&A)→넓은 증거(집계 지표)를 연결, 섹션 하단 신청 CTA는 제거하고 '후기 더 보기 →'(`.mc-cta`)만 주 동선으로 유지(신청 전환은 직전 B&A 끝 CTA와 직후 Advisor→챌린지 카드가 담당 — 신청 CTA 재추가 금지).

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
`.hero-window-intro` 안, `.zoom-exit-pin` **밖**(형제)의 오버레이 `.hero-tagline` — 핀의 scale(3.2) 확대를 받지 않도록 분리, JS가 `position:fixed`로 승격(`.ht-fixed`). 독립 IIFE가 파일 맨 끝 `<script>`에 있음. **진행률 공급(2026-07-11 스크롤 스무딩):** `scroll-fx.js`의 `initZoomExit`가 스크롤을 스타일에 1:1로 꽂지 않고 목표 진행률을 향해 매 프레임 지수 감쇠 lerp(시정수 **적응형**: 격차 0→TAU 150ms, 0.25+→TAU_FAST 60ms 선형 보간, 2026-07-12 — 고정 150ms는 빠른 스크롤에서 줌 클라이맥스가 핀이 화면을 벗어난 뒤 재생되는 '줌 희석'을 만들어 적응형으로 교체, 휠 한 칸의 완충은 유지. 터치만 80ms로 줄였던 구 방식은 플릭의 성긴 이벤트 점프가 덜 걸러져 폐기. 수렴하면 rAF 루프 자동 정지)로 따라붙은 뒤, 스무딩된 진행률을 wrap에 **`monc:zoomprogress` CustomEvent로 매 프레임 dispatch** — 태그라인 IIFE는 이 이벤트를 구독해 줌과 프레임 단위 동기화(미수신 시 자체 계산 1:1 폴백). 휠 한 칸의 계단식 점프가 이 보간으로 사라짐. 조립 흐름: "Moment Of New Career" 문장(M·O·N·C만 오렌지 800)이 0~30%에서 MONC 로고로 FLIP 조립 → 조립 완료 순간 transform 확대 글자를 네이티브 렌더 `.ht-target`로 교체(래스터 흐림 방지) → **로고 락업은 창 통과 내내 잔류 + '로고 전진'(2026-07-12):** 줌 구간(30%~) 동안 락업(`.ht-inner`)이 자체 지수 커브 `GROW_END^(zp^GROW_SHAPE)` = `1.7^(zp^0.7)`(중반 +25%·통과 ×1.6·종점 ×1.7 고정)로 확대 — MONC는 조립 직후부터 꾸준히 다가오고 창틀은 뒤늦게 가속하며 지나쳐 원근 시차가 생긴다. 진행률 p만으로 계산해 이벤트 미수신 폴백·reduced-motion(zp=0, 전진 없음)·`measure()` 동기 재진입(같은 p→`lastG` 가드 스킵→측정 좌표계 무오염)에 안전. 종점이 캘리브레이션 K 무관 고정이라 모바일 여운 시점 로고 ~330px<375px fit 보장, 개구부 성장 대비 일시 초과 최대 +6%(<fit 여유 13.6%)로 창틀 침범 없음. ⚠️ v1 '핀 배율^0.3 커플링'(scroll-fx detail.scale 동봉, 당일 회수)은 핀 커브(zp^1.35)의 후반 몰림을 물려받아 중반까지 +9%뿐 — "크기 그대로" 오너 피드백로 당일 폐기, **핀 배율 재커플링 금지** — 창틀이 로고 주위로 밀려 지나간 뒤(통과 ~89%) 하늘 위에 뜬 MONC만 남는 여운 구간(89~94%)을 거쳐 94~99.5%에서 페이드아웃(2026-07-12 오너 요청 — 구 '52~78% 확대+페이드 동반 퇴장'은 통과 전에 로고가 '사라진' 게 문제라 폐기: **조기 페이드 재도입 금지**, 확대 자체는 로고 전진으로 재도입, [specs/2026-07-12-intro-logo-advance-design.md](docs/superpowers/specs/2026-07-12-intro-logo-advance-design.md)). 서브라인("새로운 커리어가 시작되는 순간")은 자간 락업이 문장 **잉크** 폭(g0, M 왼쪽·r 오른쪽 사이드베어링 제외)→로고 **잉크** 폭(g1)으로 동반 수축, 넘치면 scale 축소 — 모두 캔버스 `measureText` 베어링 보정. **중앙 정렬은 실측 translateX(dx0→dx1)**: 자간 적용 후 잉크 중심을 재서 문장/로고 잉크 중심에 맞춘다(마지막 글자 뒤 팬텀 자간의 박스 포함 여부가 엔진마다 달라 폭 실측으로 판별 — 구 `margin-right:-g` 음수 마진 보정은 이 편차로 서브가 g/2만큼 우측으로 밀려 메인을 삐져나오는 버그가 있어 2026-07-11 제거, 재도입 금지). **로고 크기(2026-07-11 개구부 실측 fit):** CSS `min(16vw, 18vh)`는 1차 캡(무JS 폴백)일 뿐이고, `measure()`의 `scanOpening()`이 현재 표시 중인 프레임 이미지(desktop-wide/mobile-frame, `currentSrc` 기준)의 **투명 영역(개구부)을 캔버스 알파 스캔**으로 실측 → object-fit:cover 매핑으로 화면 표시폭을 구해, 조립 로고가 개구부 폭×0.88을 넘으면 인라인 font-size로 축소한다(서브라인은 로고 잉크 락업이라 자동 동반). 프레임 이미지를 교체해도 자동 추종 — 고정 vh 캡이 개구부 폭 변화를 못 따라가 로고가 창틀을 삐져나온 버그의 재발 방지(데모 정합 프레임의 개구부는 표시폭 ≈ 0.53×vh로 이전보다 좁음). 문장이 한 줄에 안 들어가면 `fitPhrase()`가 폰트를 비율 축소(모바일 375px에서 Career 줄바꿈 방지). reduced-motion·무JS = 정적 풀 문장(absolute 폴백). 모바일에선 스크롤 화살표가 `.mobile-cta-bar`에 가리지 않게 `bottom:96px`. **줌 타이밍:** `data-zoom-runway 390`(모바일 340)·`data-zoom-start 0.30`(조립 0~30% 동안 정지, 30%부터 확대 — scroll-fx.js가 attr 지원. 러웨이 확장분은 통과 후 여운 구간 확보용, 2026-07-12). **'창문 통과' 배율·고정점 실측 캘리브레이션(2026-07-12):** `data-zoom-scale 2.2`는 무JS/캔버스 실패 폴백일 뿐 — 태그라인 IIFE의 `calibrateZoom()`이 개구부 실측 rect(scanOpening이 x·y 경계 모두 스캔)로 ① 개구부가 뷰포트를 완전히 삼키는 데 필요한 배율(×1.15 모서리 여유)에 **로그 공간 오버슛 ^1.25**(통과가 100%가 아닌 ~89%에 완료되어 나머지가 여운 구간이 되고, 여운 동안에도 줌이 은은히 계속 흐름)를 곱해 `monc:zoomcalib` 이벤트로 scroll-fx에 전달하고(6.5 캡 — 울트라와이드는 클램프로 통과만 약간 늦어짐) ② 핀 `transform-origin`을 개구부 중심(인라인 스타일)으로 맞춘다. **창틀은 페이드로 지우지 않고 확대에 밀려 화면 밖으로 지나가는 것이 통과감의 본체** — 창틀 페이드는 82~90%(둥근 모서리 잔여물 정리용 안전망), 하늘 페이드는 96~100%(여운 MONC의 배경 확보. 구 55~75%/80~100%로 되돌리면 '창문을 뚫는' 느낌이 '하늘 사진이 커지는' 느낌으로 퇴화, 2026-07-12). **스케일 커브(2026-07-11):** `(1+K)^(zp^1.35)` 로그 공간 기하 보간 — 체감 줌 속도가 거의 일정하게 서서히 가속하며 감속 없이 끝까지 '쭉' 빨려들어감(구 `1+smoothstep×K` 선형 보간 + zoom-start 0.5는 중반 급가속·종반 감속이라 '확 당겨지는' 느낌이었음 — 되돌리지 말 것). 하늘은 세로 패닝 없이 이미지 전체 높이(구름 포함)를 100vh로 표시(타일 주기 600vh). ⚠️ **body는 `overflow-x: clip`이어야 함** — `hidden`이면 body가 스크롤 컨테이너가 되어 `.zoom-exit-pin`의 sticky가 뷰포트에 안 붙는다(창문 인트로 전체가 그냥 스크롤되어 올라가는 치명 버그, 2026-07-10 수정). 스펙: [docs/superpowers/specs/2026-07-10-hero-monc-tagline-design.md](docs/superpowers/specs/2026-07-10-hero-monc-tagline-design.md)

**재방문 단축 + 도달률 계측(2026-07-12):** 인트로를 한 번 완주(진행률 ≥0.98)했거나 건너뛰기를 누른 방문자는 `localStorage.monc_intro_seen='1'`이 기록되고(하단 건너뛰기 IIFE), 재방문 시 인트로 섹션 **직후의 파스타임 인라인 스크립트**가 `initZoomExit` 실행 전에 `data-zoom-runway`를 200(모바일 180)으로 재작성해 연출은 그대로 두고 스크롤 비용만 줄인다(조립·줌·페이드가 전부 진행률 % 기반이라 안무 동일). ⚠️ 첫 방문 기본값 390/340은 계측 데이터 없이 축소 금지. 계측은 `page_events` 비콘(파일 맨 끝 IIFE): 첫 방문(`window.__moncIntroFirstVisit` 스냅샷)·비딥링크 세션만 `intro_view`(로드)와 `hero_reached`(#home IO 진입)를 insert — 두 카운트의 비율이 히어로 도달률. 마이그레이션 `20260712120000_page_events.sql`(anon INSERT만, SELECT는 관리자)을 오너가 실행해야 쌓이며 미적용이어도 실패는 조용히 무시된다.

**렌더링 성능 계약(2026-07-11 인트로 끊김 수정 — 지키지 않으면 재발):** ① 줌 중 매 프레임 opacity가 바뀌는 페이드 레이어(`.zoom-content-fade`·`.zoom-bezel-fade`·`.zoom-tone-bridge` — tokens.css, `.ht-scrim` — index)는 `will-change: opacity`로 합성 승격 — 없으면 opacity가 pin 레이어 래스터에 구워져 **매 프레임 풀스크린 리페인트**가 되고 이것이 인트로 버벅임의 주원인이었다(제거 금지). ② ⚠️ 창틀 `<picture class="zoom-bezel-fade">`는 `display:block; position:absolute; inset:0` 박스 필수 — 기본 인라인(0×0)인 채 승격되면 Chrome이 레이어를 0×0 경계로 컬링해 **창틀 img가 통째로 안 그려진다**. ③ 태그라인 `apply()`는 조립 진행값 u가 직전과 같으면(30% 이후 전 구간이 u=1) letter-spacing(리플로우 유발)·글자 transform 재기록을 건너뛰고(`lastU` 가드, `measure()`가 -1로 리셋), `.hero-tagline`은 `contain: layout paint`로 그 리플로우를 오버레이 내부에 격리. ④ scroll-fx.js는 섹션 설정(zoomStart/scaleK/fadeNone)과 페이드 대상 요소를 init에서 items에 캐시 — 프레임 루프(renderWrap)에서 querySelector/getAttribute 금지.

### Hero scene carousel (`index.html`)
히어로는 **카드 4장 coverflow형 센터 캐러셀** — 구조는 `.hero-scene#home` > `.zoom-exit-pin` > `.hs-carousel` > `.hs-stage#hs-stage` + `.hs-card`×4. 활성 카드가 중앙, 좌우 이웃이 살짝 기울어 걸쳐 보인다. (구 `.hs-slide` 풀스크린 크로스페이드 + 슬라이드1 YouTube Shorts YT IFrame API + 슬라이드3 키워드 bounce 구현은 **폐기** — `_heroMode`/`_ytPlaying`/`_ytPlayer` 전역은 더 이상 없음.)

카드 (0-indexed, 모두 이미지 카드):
| idx | id | 이름 | 이미지 (`.hs-img`) | 헤드라인 강조어 |
|---|---|---|---|---|
| 0 | `hs-card-0` | 보신각 | `images/hero-voice.webp` (`fetchpriority=high`) | 목소리 |
| 1 | `hs-card-1` | 영합각 | `images/hero-expression.webp` (lazy) | 이미지 |
| 2 | `hs-card-2` | 스피닝 | `images/hero-spinning.webp` (lazy) | 말투 |
| 3 | `hs-card-3` | 승자각 | `images/hero-answer.webp` (lazy) | 답변 |

카드 내부 레이어: `.hs-media`(이미지, 로드 실패 시 카드별 웜톤 폴백 그라디언트) → `.hs-card-overlay`(크림 60% 반투명) → `.hs-card-content`(오렌지 `.hs-accent` 강조어가 든 `.hs-h1` — 크림 헤일로 text-shadow로 대비 확보, `.hs-sub`, 네이비 `.hs-name` 챌린지 이름 칩). 이미지는 `object-position: 50% 28%`(세로 3:4 사진을 카드에 cover — 얼굴이 상단이라 크롭 기준을 위로).

배치는 `heroLayout()`이 인라인 스타일로: 거리 `d = i - _heroIdx` 기준 활성=중앙 scale 1·0°, 이웃=`--card-w`×0.8 좌우 오프셋·±4°·scale .86, `|d|≥2`=opacity 0. **이웃 카드도 완전 불투명 유지**(반투명은 "캐러셀이 투명해진다"로 체감돼 제거 — 재도입 금지), 전환 애니메이션은 CSS transition(.62s, reduced-motion 시 none). 카드 폭 `--card-w` = min(560px, 62vw)(≤768px: min(420px, 78vw)), 스테이지 높이 min(72svh, 600px)(≤768px: min(56svh, 440px)).

전환 수단: `.hs-nav` 화살표(`heroPrev()`/`heroNext()`), 비활성 카드 클릭(→ 해당 카드로), `#hs-stage` 터치 스와이프(가로 40px 미만·세로 우세 제스처는 무시), 5초 자동전환(`_heroResetAuto`). Key JS globals: `_hsCards`, `_heroIdx`, `_heroAutoTimer` (`_heroReduce`는 선언만 있고 미사용).

자동전환(`_heroResetAuto`)은 IntersectionObserver로 `.hero-scene`이 뷰포트에 있을 때만 돈다(2026-07-11, threshold 0.15) — 페이지 첫 화면이 창문 인트로라, 인트로 스크롤 중 화면 밖 카드 transition이 프레임을 뺏는 것을 방지. 화면 밖이면 `_heroAutoTimer = null`, IO 미지원 브라우저는 상시 동작.

캐러셀 하단 `.hs-cta`는 4장 공통 신청 CTA(→`apply.html`) + `data-recruit-cta-badge` 긴급성 뱃지(recruit.js `applyGlobalRecruitCta()`가 가장 임박한 모집의 D-day로 채움 — `.mobile-cta-bar`에도 동일 attr 존재). ⚠️ `.hero-scene`에 `data-zoom-exit`를 다시 붙이지 말 것 — 스크롤 시 캐러셀 전체가 opacity 페이드되어 모바일에서 한 화면 분량의 빈 구간이 생겼던 원인(마크업 주석에도 경고 있음).

### Google Apps Script — 중복 신청 처리
`학생현황` 시트에 **항상 새 행으로 추가** (전화번호 중복 여부 무관). 기존의 find-and-update 로직은 데이터 덮어쓰기 문제로 제거됨. Apps Script 편집은 Google 콘솔에서 수행 후 새 버전으로 재배포 필요.

## Conventions
- Commit messages and in-code comments are written in Korean (matching the existing history and content).
