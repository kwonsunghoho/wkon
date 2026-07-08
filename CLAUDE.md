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

### Reviews on the index
`loadReviews()` in `index.html` fetches `?action=reviews`, renders a horizontally-scrolling marquee, and caches results in `localStorage` under `monc_reviews_v1` (shown instantly on repeat visits, refreshed in the background).

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
