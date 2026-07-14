# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MONC (몬크 챌린지) — a Korean landing site for a 2-week voice/expression/interview training program for airline cabin-crew applicants. **Static site, no build step**, hosted on GitHub Pages at https://kwonsunghoho.github.io/wkon/. No framework, bundler, package.json, or test suite — hand-written HTML/CSS/JS served as-is.

## Commands

- **Local preview**: `python -m http.server 5500` → `http://localhost:5500/`. (`.claude/launch.json` defines a `wkon-static` server.)
- **Deploy**: `git push origin main` — GitHub Pages serves `main` directly; a push *is* the deploy (1–2 min propagation). Nothing to build.
- **No lint/test.** Verify by rendering in a browser — **375px first** (99% mobile traffic).

The repo is sometimes edited from a git **worktree** under `.claude/worktrees/...` on a `claude/*` branch; the canonical checkout is the repo root on `main`.

## Backend: there is no server

"Backend" = **Google Apps Script + published Google Sheets** and **Supabase**, called from the browser.

1. **Applications & reviews (legacy Apps Script)** — `APPLICATION_API_URL`. `POST {action:"application"}` **always appends a new row** to the **학생현황** sheet (dup phone irrelevant; phone stored with a leading apostrophe to keep the `0`). `GET ?action=reviews` returns the **후기** sheet. **Owned/edited in Google's console, not this repo** — changes need the owner to redeploy a new version.
2. **Recruitment dates** — `RECRUIT_CSV` in `recruit.js`, a published Sheet CSV. Drives 모집중/예정/마감 + D-day chips.
3. **Supabase** — `supabase-config.js` (`MONC.sb`). Auth/members, `applications`, `reviews`, `site_config`, `page_events`. **Tables/RLS/columns are created by the owner in the Supabase console.** Migrations in the repo are the source, but the owner must run each in the SQL Editor before it takes effect; **unapplied migrations degrade gracefully** (features fall back silently).

## Architecture

### Application flow — `apply.html` is the source of truth
All "신청하기" CTAs navigate to **`apply.html`** (detail pages → `apply.html?c=<recruit-id>` to preselect). **Pricing, deposit, bank account, curriculum, and the submit schema live in apply.html** — edit there.
- `application-modal.js` (self-injecting modal on detail pages, button `.app-modal-btn`) is **dormant** — kept but unused; declares `APPLICATION_API_URL` independently.
- The old inline modal in `index.html` (its markup + CSS + `openApplicationModal`/`submitApplication`/`copyAccount` + `?openModal=true`) was **removed 2026-07-14** in a dead-code cleanup.

### Pages
- `index.html` — the landing page. Large, self-contained: design tokens, all sections, review loading, most JS.
- `apply.html` — **신청·결제 전용(모든 신청 CTA의 목적지).** 히어로 → 챌린지 카드 4개(클릭=선택+커리큘럼 아코디언, 다중선택 장바구니) → 회원가입 배너(→login.html) → 조합 추천 → FAQ → 계좌이체 폼 → 하단 고정 요약바. `?c=voice,answer`로 프리셀렉트. `supabase-config.js`+`recruit.js` 로드, `loadChallengeStatuses()`로 마감 카드 비활성, 제출 `MONC.sb.from('applications').insert(...)`. 챌린지·FAQ는 하단 인라인 `CHALLENGES`/`FAQ` 배열(FAQ #3·#6·#7 임시 문구). **회원 모드**: 로그인 시 `getMyProfile()`로 이름·전화 자동채움·insert에 `member_id` 포함(→마이페이지 연동)·전화 미보유 시 `members`에 저장. **⚠️ 법적 필수:** 신청 버튼 위 `#appConsent` 필수 동의 체크(만14세+개인정보 수집·이용) 미체크 시 `submitApplication()`이 차단 — **개인정보 보호법상 삭제·완화 금지.**
- `onboarding.html` — 첫 로그인 후 `login.html`의 `routeByRole()`이 `!profile.phone && !localStorage.monc_onboard_done`이면 여기로. 이름·전화·전공(major) → `members`. ⚠️ `members.major`는 migration `20260708120000_member_major.sql`(owner 실행); 미적용 시 major만 방어적으로 무시. `getMyProfile()` 공용 셀렉트엔 major 미포함(컬럼 미생성 시 전체 조회가 깨지므로 별도 방어 조회).
- `reviews.html` — **후기 모음(홈 '후기 더 보기' + nav '후기'의 목적지).** Supabase `reviews`(visible=true)를 매스너리 그리드 + 챌린지·기수 필터칩(데이터 존재값만 동적 생성). `select('*')`이라 분류 컬럼 미적용에도 무에러(필터바 숨김). 후기 스크린샷에 **실명 노출**(공개 카페 후기·오너 승인).
- `researchers.html` — **연구진 소개 전용(2026-07-14 신설).** 구 `#instructors`(mi-section)를 분리. `tokens.css` + 인라인 `.mi-*` CSS·`researchers` 배열·탭 IIFE로 완전 동작. 진입: `#researchers-strip` 티저 + nav '연구진'. **연구원 이력의 소스오브트루스** — ⚠️ index의 `.ts-cred` 스트립 카드와 **별도 소스라 이력 변경 시 양쪽 동기화 필요**(아래 스트립 항목).
- Active detail pages (index 카드에서 링크, `application-modal.js` 로드하나 신청은 `apply.html?c=<id>`로): `challenge-voice.html`(보신각), `challenge-expression.html`(영합각), `challenge-spinning.html`(스피닝), `challenge-answer.html`(승자각).
- `challenge-express.html`, `challenge-speech.html` — **legacy/unused**, index 미링크. 라이브 아니니 편집 금지.
- `login.html` — 구글·카카오 OAuth. **⚠️ 법적 필수:** `#agreeChk`(만14세+약관·개인정보) 전엔 두 로그인 버튼 `disabled` — 명시 동의, 구 "간주 동의"로 되돌리기 금지.
- `terms.html`, `privacy.html` — footer 법적 페이지. privacy는 실제 스택 기준(수탁자 Supabase 서울/Google/Kakao, 국외이전 고지, CPO 권성호, 14세 미만 조항). 수집 항목·수탁자 변경 시 갱신.
- **`applications` RLS** (`20260711120000_applications_rls.sql`, owner 실행): INSERT 공개(비회원 신청), SELECT 관리자+본인, UPDATE/DELETE 관리자만.

### recruit.js (index + detail pages 공유)
`RECRUIT_CSV` fetch, 실패 시 `RECRUIT_FALLBACKS` + per-card `data-recruit-start/-end` 폴백. `applyIndexRecruit()`(카드 배지·기간·D-day), `applyDetailRecruit(id)`(상세 + 마감 시 `.apply-btn` 비활성), `loadChallengeStatuses()`(`window._challengeStatuses`), `applyGlobalRecruitCta()`(히어로·모바일바 D-day 뱃지). 챌린지 정체성 = `data-recruit-id`(`voice`/`expression`/`spinning`/`answer`), 카드·폴백·시트 전반 일관.

### 랜딩 섹션 순서
창문 인트로 → 히어로 캐러셀(#home) → 연구진 신뢰 스트립(#researchers-strip) → 블라인드 퀴즈(#blind-quiz) → Before&After(#before-after) → 커뮤니티(#community) → 챌린지 진단(#advisor) → 챌린지 목록(#challenges) → 성장기록(#member-appeal) → 최종 CTA. 강사진 풀 섹션(#instructors)은 `researchers.html`로 분리(스트립이 티저). **구 "3단계 How"(#how)·"LIVE FEED" 후기 캐러셀은 삭제됨 — 재도입 금지**(진행방식 안내는 apply.html FAQ가 커버). 푸터 "서비스 소개"→`#challenges`. 스펙: docs/superpowers/specs/2026-07-12-landing-section-restructure.md, 2026-07-14-landing-text-diet.md.

### 2026-07-14 목업 리디자인 (소스오브트루스: `outputs/monc-font-mockup.html`·`monc-mockup-2.html`)
색·폰트 + **레이아웃까지** 풀 리디자인(웜 통일). `.section-label`/`.mc-eyebrow`에 코랄 대시(—) `::before` 시그니처, 연구원 이름 명조. **회귀 방지 핵심:**
- **③ Before&After (`.ba-section`)** 다크 시네마틱: `background:var(--bg-dark)`·카드 `#332E27`·인용 명조·태그/링크/제목 코랄. ⚠️ 다크 위 헤더 라벨은 `.ba-section .section-label{color:var(--action)!important; -webkit-text-fill-color:var(--action)!important}`로 tokens.css의 `accent-ink!important`를 이겨야 함 — **이 `!important` 제거 시 라벨 대비가 1.8:1로 깨짐.** 오디오 전/후 토글·YT 카드·플레이어는 **기능 유지**(이미지-only로 교체 금지 — 실제 녹음 증거).
- **④ 최종 CTA (`.cta-box`)**: `--cta-ink:#26221C`(구 네이비 폐기) + 상단 코랄 방사형 글로우 + `.cta-title` 명조 900.

### 연구진 신뢰 스트립 (`#researchers-strip`)
히어로 직후 티저("누가 가르치는지" 선공개). 에디토리얼 좌측정렬 헤더 + **세로 4:5 포트레이트 카드**(`.ts-card` > `.ts-port` img + `.ts-body` role·name·cred, 하드라인·이름 명조). **자동 흐름 마퀴**: `.ts-marquee`(overflow:hidden + 좌우 `mask` 페이드) > `.ts-grid#tsGrid`(flex nowrap·`animation:ts-flow 34s linear infinite`·translateX 0→-50%). **이음새 없는 루프의 핵심: `gap` 대신 카드마다 `margin-right:20px`.** 카드 폭 `min(220px,72vw)`. **JS(`#tsGrid` 직후 인라인)가 카드 1벌을 `cloneNode`(aria-hidden)** 해 5→10장; 호버/누름 시 `.is-paused`; `prefers-reduced-motion`이면 복제 스킵 + CSS 정적 `flex-wrap:wrap`. 마퀴 overflow가 가로 넘침 방지. ⚠️ 카드 이력 변경 시 마크업 원본만 고치면 복제는 런타임 자동 반영.
- **카드 순서·데이터(오너 확정):** 권성호(수석·승무원 교육 11년·3,500명+) → 박새암(수석·객실승무원 9년·면접관) → 고은지(책임·합격생 다수·브랜딩) → 최보민(선임·대한항공 국제선·부사무장) → 김유리(선임·대한항공 부사무장 10년·기내방송). 김유리 사진 `images/instructor-kim.jpg`.
- CSS `.ts-*`(index 인라인 `<style>`). 마크업은 인라인 static, **`.ts-cred` 하드코딩** — **`researchers.html`의 `researchers` 배열과 별도 소스라 이력 변경 시 양쪽 동기화 필요.**

### COMMUNITY 섹션 (`#community`)
집계 지표(카운트업, IntersectionObserver 1회) + '가장 좋았던 점' 롤링 배너 + 대표 후기 카드 3장 + '후기 더 보기' CTA(→reviews.html). `--mc-*` 서브테마는 2026-07-14부터 아이보리-**에스프레소-코랄**(구 네이비·골드 폐기). 지표 = 흰 카드 `border-right` 구분(≤640px 세로 `border-bottom`), 숫자 명조 900·단위는 카운트업 JS가 `<em class="mc-unit">`로 코랄 렌더. 롤링 = 에스프레소 배경 + 거대 명조 따옴표(`::before` `\201C`).
- **후기 카드 = A안:** '실제 후기' 초록 배지(`.mc-review-verify`) + 명조 한줄평(`.mc-review-quote` serif; 진입 시 `.mc-q-in` fade-up 1회, 기본 opacity 1이라 reduced-motion에도 노출) + 이름·챌린지 칩(`.mc-review-tag` 코랄) + '원문 보기' 버튼(`.mc-review-src` → `#mcLightbox`). (구 캡처 밴드 `.mc-capture-*`·`.mc-review-capture` CSS는 2026-07-14 제거.)
- **소스:** 지표·롤링 = `site_config`(key `community_stats`/`community_phrases`, admin '홈 커뮤니티' 탭; migration `20260710120000_site_config.sql`). 후기 카드 = `reviews`에서 `sort_order≥1` 상위 3개(`loadCommunityCards()`; admin '후기 관리'에서 대표 번호 1·2·3, 미지정 시 최근 3개). JS 상수 `COMMUNITY_STATS`/`ROLLING_PHRASES`는 site_config 폴백. **후기 카드엔 폴백 없음 — 실패 시 빈 그리드, 가짜 카드 재도입 금지.**
- `#mcLightbox`는 세로 긴 스크린샷용 폭 기준 확대. nav 앵커 `#community`·`#testimonials` 둘 다 유지. ⚠️ 개인 "몇 분 전" 실시간 활동 연출·섹션 하단 신청 CTA **재도입 금지**(브릿지 카피 `.mc-bridge` + '후기 더 보기' `.mc-cta`만; 신청 전환은 직전 B&A·직후 Advisor가 담당). admin 후기 관리·bulk-reviews.html은 `reviews`에 쓰지만 홈은 안 읽음 — reviews.html이 소비.

### reviews 테이블 분류 컬럼
`reviews`에 `challenge`(보신각/영합각/스피닝/승자각)·`cohort`(smallint, NULL=미상)·`reviewer_name`·`review_date`·`quote` 컬럼 (migration `20260710130000_reviews_classify.sql` + 기존 108건 백필, owner 실행). reviews.html 필터·커뮤니티 카드에 사용. admin '후기 관리'에서 수정. `quote`는 저장만(미표시).

### Design system (`tokens.css`)
Linked by index + detail/legal pages + member pages(login/mypage/admin).
- **팔레트(웜 통일):** 배경 = 베이지 `--bg #E9E4D8`; 타이틀·전환 CTA = 오렌지 `--action #F27945`; 본문 = `--text #26221C`. **네이비 폐기.** 코랄 3단: `--accent #F27945`(장식 면·큰 디스플레이), `--accent-dark #D9531F`(큰 볼드 24px+·테두리·포커스링, 3:1+), **`--accent-ink #A33D14`(12~15px 소형 텍스트·링크·활성 칩 — 4.5:1)**. ⚠️ 코랄·`--accent-dark`를 소형 텍스트에 쓰지 말 것 → `--accent-ink`. ⚠️ 오렌지·코랄 배경 위 흰 글씨 금지(≈2.7:1) — 채움이 `--accent`면 글씨 `--action-ink #2A1206`, `--accent-ink`면 흰 글씨 가능. 섹션 타이틀 = 오렌지 + 명조, 에이브로우 = `--accent-ink`(`.section-label`, tokens 오버라이드 `!important`). 커뮤니티 `--mc-*` 서브테마(아이보리-에스프레소-코랄)는 유지.
- **타이포:** 섹션 제목은 명조 — `h2.section-title/.ts-title/.mc-title/.ma-title`에 `var(--serif)`(Noto Serif KR) 700 + `--fs-h2 clamp(30px,4.2vw,46px)` (tokens.css 오버라이드, h2 접두 특이도로 인라인 규칙을 이김). **명조 쓰는 페이지(index·상세 4종·reviews)는 `<head>`에 Noto Serif KR `600;700;900` 링크 필수.**
- **UI 9대 원칙**(docs/design-principles.md): 가독성 12pt+ / 터치 44px+ / 대비 4.5:1 / 아이콘 통일 / 라운드 / 계층 / 여백 / 그룹핑 / 큼직. **375px 우선 검증.**
- Typography(`--fs-*`)·spacing(`--space-*`, 8px)·radius(8/14/20/24)·섹션 배경 리듬 전부 토큰화 — 하드코딩보다 토큰 우선.
- 아이콘 = `<body>` 상단 `<symbol>` 스프라이트(`currentColor` 리컬러). 모바일 스티키 CTA바 `.mobile-cta-bar`(≤768px).

### Audio (detail pages)
`audio/`의 before/after 클립, 위치 기반 네이밍: `challenger-a-before.mp3`…(voice), `spinning-a-before.m4a`…(spinning). Windows에서 추가 시 이중 확장자 주의(`*.mp3.m4a`).

### 블라인드 퀴즈 (`#blind-quiz`)
사진 인트로(`images/bq-intro.jpg`) + 실루엣 영상(`video/bq-candidate.mp4`, 클립 재생 중일 때만 재생/배지 전환, `syncScene()`) + 판정 콘솔. 5라운드, `audio/` 전·후 풀 랜덤, 루트 셀렉터 `.bq-stage`. `prefers-reduced-motion`이면 영상 자동재생·Ken Burns·EQ 정지. (텍스트 다이어트로 '같은 사람' 반전은 1라운드 1회만.)

### 창문 인트로 태그라인 + MONC 조립 (`#heroTagline`)
전체 스펙: docs/superpowers/specs/2026-07-10-hero-monc-tagline-design.md, 2026-07-12-intro-logo-advance-design.md.

`.hero-window-intro` 안, `.zoom-exit-pin` **밖**의 오버레이 `.hero-tagline`(핀 scale 확대 회피 위해 분리, JS가 `position:fixed`로 승격). 흐름: "Moment Of New Career" 문장(M·O·N·C만 오렌지)이 0~30%에서 MONC 로고로 FLIP 조립 → 30%~ 줌 구간에서 로고 전진 확대 → 창 통과(~89%) 후 여운(89~94%) → 94~99.5% 페이드아웃. 서브라인("새로운 커리어가 시작되는 순간")은 모바일에서만 대기 한 줄→조립 두 줄. **진행률 스무딩:** `scroll-fx.js`의 `initZoomExit`가 목표 진행률로 매 프레임 지수감쇠 lerp 후 `monc:zoomprogress` CustomEvent dispatch — 태그라인 IIFE가 구독(미수신 시 1:1 폴백). `calibrateZoom()`이 개구부 캔버스 알파 스캔(`scanOpening()`)으로 줌 배율·`transform-origin`·로고 fit 크기를 실측(`data-zoom-scale 2.2`는 폴백).

**⚠️ 회귀 금지 규칙(하나라도 어기면 튐/끊김 재발):**
- **body는 `overflow-x: clip`** — `hidden`이면 sticky가 뷰포트에 안 붙어 인트로 전체가 스크롤되는 치명 버그.
- 모바일 정지 튐: 진행률 분모는 `innerHeight`가 아니라 **svh 핀 높이 `item.vhRef`** — innerHeight로 되돌리지 말 것. resize→`measure()`는 **폭 변화에만**(툴바 높이 토글 스킵).
- 인앱 WebView(인스타·페북) 튐: `freezeGeometry()`가 러웨이·핀 높이를, 태그라인 IIFE가 오버레이 높이를 **px로 동결** — **vh/svh로 되돌리면 재발.**
- 조립은 문장 글자 '기존 크기'로 끝남(소형 조립) — **대형 조립·핀 배율 재커플링 금지.** 줌 확대는 로고 전진 커브(`GROW_SHAPE` β 0.5 미만 금지).
- 조기 페이드 재도입 금지(로고가 통과 전 사라짐). 창틀은 페이드 아닌 확대에 밀려 지나감(창틀 페이드 82~90%, 하늘 96~100% — 55~75%로 되돌리면 '창 뚫기'가 '하늘 커지기'로 퇴화). 스케일 커브 `(1+K)^(zp^1.35)` 로그 기하 보간 — 선형으로 되돌리지 말 것.
- 서브라인 정렬은 **실측(공식 아님).** FLIP 글자 중심 = **박스 left + 자연 반폭**(getBoundingClientRect 박스 중심은 letter-spacing 박스 부풀림 오염) — **`subCharRects()` 박스 중심 회귀 금지**(정지 삐뚤 + 스크롤 시작 시 툭 튐). 상시 두 줄 금지, 서브 글자별 FLIP은 메인과 통일 타이밍(스태거 금지), 통짜 블록 이동 금지.
- **재방문 단축 + 계측:** 완주(≥0.98)/건너뛰기 시 `localStorage.monc_intro_seen`; 재방문 시 인트로 직후 인라인 스크립트가 `data-zoom-runway`를 200/180으로 축소(안무는 % 기반이라 동일). ⚠️ 첫 방문 390/340은 축소 금지. `page_events` 비콘(`intro_view`/`hero_reached`, migration `20260712120000_page_events.sql`, owner 실행)으로 히어로 도달률 계측.
- **렌더링 성능 계약:** ① 페이드 레이어(`.zoom-content-fade`·`.zoom-bezel-fade`·`.zoom-tone-bridge`·`.ht-scrim`)는 `will-change:opacity`로 합성 승격 — 제거 금지(없으면 매 프레임 풀스크린 리페인트). ② 창틀 `<picture class="zoom-bezel-fade">`는 `display:block; position:absolute; inset:0` 필수(인라인 0×0이면 Chrome이 컬링해 창틀이 안 그려짐). ③ 태그라인 `apply()`는 조립값 u가 직전과 같으면 letter-spacing·transform 재기록 스킵(`lastU` 가드), `.hero-tagline`은 `contain:layout paint`. ④ scroll-fx.js는 섹션 설정·페이드 대상 요소를 init에 캐시(프레임 루프에서 querySelector/getAttribute 금지).

### Hero scene carousel (`#home`)
카드 4장 coverflow형 센터 캐러셀: `.hero-scene#home` > `.zoom-exit-pin` > `.hs-carousel` > `.hs-stage#hs-stage` + `.hs-card`×4. 활성 카드 중앙, 이웃이 살짝 기울어 걸침. (구 `.hs-slide` 크로스페이드·YT IFrame·키워드 bounce는 폐기.)

| idx | id | 이름 | 이미지 (`.hs-img`) | 강조어 |
|---|---|---|---|---|
| 0 | `hs-card-0` | 보신각 | `hero-voice.webp` (`fetchpriority=high`) | 목소리 |
| 1 | `hs-card-1` | 영합각 | `hero-expression.webp` (lazy) | 이미지 |
| 2 | `hs-card-2` | 스피닝 | `hero-spinning.webp` (lazy) | 말투 |
| 3 | `hs-card-3` | 승자각 | `hero-answer.webp` (lazy) | 답변 |

레이어: `.hs-media`(로드 실패 시 웜톤 그라디언트 폴백) → `.hs-card-overlay`(크림 60%) → `.hs-card-content`(`.hs-h1` + 오렌지 `.hs-accent`, `.hs-name` 칩). `object-position:50% 28%`. 배치는 `heroLayout()` 인라인 스타일: 활성 scale1·0°, 이웃 ±4°·scale.86, `|d|≥2` opacity0. **이웃 카드도 완전 불투명 유지(반투명 재도입 금지).** 폭 `--card-w` min(560px,62vw)(≤768px min(420px,78vw)). 전환: `.hs-nav` 화살표, 비활성 카드 클릭, 스와이프, 5초 자동. Globals: `_hsCards`·`_heroIdx`·`_heroAutoTimer`. 자동전환은 IntersectionObserver로 `.hero-scene`이 뷰포트에 있을 때만(인트로 스크롤 중 프레임 뺏김 방지). `.hs-cta` = 공통 신청 CTA(→apply.html) + `data-recruit-cta-badge`(recruit.js `applyGlobalRecruitCta()`). ⚠️ `.hero-scene`에 `data-zoom-exit` 재부착 금지(캐러셀 전체 페이드 → 모바일에 빈 구간).

### Google Apps Script — 중복 신청
`학생현황` 시트에 **항상 새 행 추가**(전화 중복 무관; 구 find-and-update는 덮어쓰기 문제로 제거). 편집은 Google 콘솔에서 후 새 버전 재배포 필요.

## Conventions
- Commit messages and in-code comments in Korean (matching existing history).
- **Dead code는 남기지 말고 제거.** 2026-07-14 index.html에서 휴면 인라인 모달·mi-section CSS·구 `researchers` 배열·탭 IIFE·`.mc-capture-*` CSS·`maPreview` 파형 IIFE·고아 modal-overlay CSS 등 ~1,130줄 정리. 타임스탬프 백업 파일은 커밋하지 말 것.
