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
- `index.html` — the landing page. Large: all sections, review loading, most JS. **CSS는 `index.css`로 분리** — 구 인라인 `<style>` 2블록(메인 + `#member-appeal`/`.ts-*`/`.db-*`)을 `index.css` 한 파일로 추출해 `<head>`에서 `tokens.css` 다음에 링크(캐스케이드 `tokens.css`→`index.css` 순서 보존이 핵심 — 링크 순서 바꾸면 `!important` 싸움이 깨짐). ⚠️ index의 CSS는 이제 `index.css`에서 찾을 것(index.html 안엔 `<style>` 없음). JS는 여전히 index.html 인라인.
- `apply.html` — **신청·결제 전용(모든 신청 CTA의 목적지).** 히어로 → 챌린지 카드 4개(클릭=선택+커리큘럼 아코디언, 다중선택 장바구니) → 회원가입 배너(→login.html) → 조합 추천 → FAQ → 계좌이체 폼 → 하단 고정 요약바. `?c=voice,answer`로 프리셀렉트. `supabase-config.js`+`recruit.js` 로드, `loadChallengeStatuses()`로 마감 카드 비활성, 제출 `MONC.sb.from('applications').insert(...)`. 챌린지·FAQ는 하단 인라인 `CHALLENGES`/`FAQ` 배열(FAQ #3·#6·#7 임시 문구). **회원 모드**: 로그인 시 `getMyProfile()`로 이름·전화 자동채움·insert에 `member_id` 포함(→마이페이지 연동)·전화 미보유 시 `members`에 저장. **⚠️ 법적 필수:** 신청 버튼 위 `#appConsent` 필수 동의 체크(만14세+개인정보 수집·이용) 미체크 시 `submitApplication()`이 차단 — **개인정보 보호법상 삭제·완화 금지.**
- `onboarding.html` — 첫 로그인 후 `login.html`의 `routeByRole()`이 `!profile.phone && !localStorage.monc_onboard_done`이면 여기로. 이름·전화·전공(major) → `members`. ⚠️ `members.major`는 migration `20260708120000_member_major.sql`(owner 실행); 미적용 시 major만 방어적으로 무시. `getMyProfile()` 공용 셀렉트엔 major 미포함(컬럼 미생성 시 전체 조회가 깨지므로 별도 방어 조회).
- `reviews.html` — **후기 모음(홈 '후기 더 보기' + nav '후기'의 목적지).** Supabase `reviews`(visible=true)를 매스너리 그리드 + 챌린지·기수 필터칩(데이터 존재값만 동적 생성). `select('*')`이라 분류 컬럼 미적용에도 무에러(필터바 숨김). 후기 스크린샷에 **실명 노출**(공개 카페 후기·오너 승인).
- `researchers.html` — **연구진 소개 전용(2026-07-14 신설).** 구 `#instructors`(mi-section)를 분리. `tokens.css` + 인라인 `.mi-*` CSS·`researchers` 배열·탭 IIFE로 완전 동작. 진입: `#researchers-strip` 티저 + nav '연구진'. **연구원 이력의 소스오브트루스** — ⚠️ index의 `.ts-cred` 스트립 카드와 **별도 소스라 이력 변경 시 양쪽 동기화 필요**(아래 스트립 항목).
- Active detail pages (index 카드에서 링크, `application-modal.js` 로드하나 신청은 `apply.html?c=<id>`로): `challenge-voice.html`(보신각), `challenge-expression.html`(영합각), `challenge-spinning.html`(스피닝), `challenge-answer.html`(승자각).
- `challenge-express.html`, `challenge-speech.html` — **legacy/unused**, index 미링크. 라이브 아니니 편집 금지.
- `login.html` — 구글·카카오 OAuth. **두 뷰**: `#loginView`(로그인 버튼 — 항상 활성) / `#consentView`(최초 1회 동의 게이트). **⚠️ 법적 필수(2026-07-15 개편):** 약관·개인정보 동의는 **가입 시 딱 한 번** 받는다 — OAuth는 로그인 전 사용자를 식별할 수 없어 구 방식은 "로그인할 때마다" 체크를 강요했다(오너 피드백). 이제 OAuth 복귀 후 `hasConsented()`가 false면 게이트를 띄우고, `#agreeChk`(만14세+약관·개인정보)를 **사용자가 직접 체크해야** `#consentGo`가 열린다. 동의 시 `MONC.recordConsent()`가 `members.agreed_at`·`terms_version`에 기록 → 이후 **어떤 기기에서도 다시 묻지 않음**. 거부 시 `signOut()`. **금지:** 체크박스 사전 체크·"간주 동의"·게이트 삭제. 회원 페이지(`mypage`·`onboarding`)는 `MONC.requireConsent()`로 가드 — 동의 없이 우회 불가. 약관 개정 시 `supabase-config.js`의 `TERMS_VERSION`을 올리면 전원 재동의.
- **동의 마이그레이션** (`20260715120000_member_consent.sql`, owner 실행): `members.agreed_at`·`terms_version` + **`delete_my_account()` RPC**. **미적용이어도 동작** — `getConsent()`가 조회 실패를 감지해 계정별 로컬 기록으로 폴백하고, 나중에 컬럼이 생기면 `hasConsented()`가 서버로 백필한다. ⚠️ `getMyProfile()` 공용 select엔 넣지 말 것(컬럼 미생성 시 프로필 조회 전체가 깨짐 — `major`와 동일 방어).
- **⚠️ 동의 3대 함정(리뷰에서 실제로 터진 것 — 되돌리면 법적 리스크):**
  1. **로컬 동의 캐시는 계정별 키** `monc_consent_v1:<uid>`. 무기명 기기 키로 되돌리면 **공용·가족 기기에서 A의 동의 흔적으로 신규 회원 B가 게이트를 건너뛰고, B 명의의 허위 동의 기록이 서버에 저장**된다.
  2. **거부 = 즉시 파기.** OAuth가 끝나는 순간 `handle_new_user()` 트리거가 `members`(이름·이메일) 행을 만든다 → 게이트에서 '동의하지 않고 나가기'는 `MONC.deleteMyAccount()`로 **계정을 삭제**한 뒤 로그아웃한다(RPC 미적용 시 이름·이메일만 즉시 null로 비우는 폴백). 로그아웃만 시키면 미동의자·만14세 미만의 개인정보가 잔존한다. privacy.html §2가 이 흐름을 고지한다.
  3. **동의 가드는 회원 페이지 전체에.** `mypage`·`onboarding`·`sojae`·`admin` 모두 `MONC.requireConsent()`를 호출한다 — 한 곳이라도 빠지면 주소창으로 게이트를 우회할 수 있다.
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
히어로 직후 티저("누가 가르치는지" 선공개). 에디토리얼 좌측정렬 헤더 + **세로 4:5 포트레이트 카드**(`.ts-card` > `.ts-port` img + `.ts-body` role·name·cred, 하드라인·이름 명조). **마퀴**: `.ts-marquee`(overflow:hidden + 좌우 `mask` 페이드) > `.ts-grid#tsGrid`(flex nowrap). **이음새 없는 루프의 핵심: `gap` 대신 카드마다 `margin-right:20px`** → 트랙폭 = 2×(카드+마진)이라 되감기 지점(`half = scrollWidth/2`)이 정확히 한 벌. 카드 폭 `min(220px,72vw)`. **JS(`#tsGrid` 직후 인라인)가 카드 1벌을 `cloneNode`(aria-hidden)** 해 5→10장. ⚠️ 카드 이력 변경 시 마크업 원본만 고치면 복제는 런타임 자동 반영.
- **⚠️ 2026-07-15 물리 개편 — 되돌리기 금지:** 구 CSS `@keyframes ts-flow` + `.ts-marquee:hover .ts-grid{animation-play-state:paused}`는 **"손만 올려도 사진이 멈춘다"**는 오너 피드백으로 **폐기**. 지금은 rAF 물리 IIFE — 자동 흐름(`AUTO_V 36px/s`) + 포인터 드래그(손끝 1:1 추종) + 트랙패드 가로 휠 임펄스, 놓으면 마지막 속도로 미끄러지다 `TAU 0.5s` 지수감쇠로 자동 속도에 복귀(**"다이얼"**). **호버로는 절대 멈추지 않는다 — `:hover` 정지·`.is-paused` 재도입 금지.** IntersectionObserver로 화면 밖이면 rAF 정지(인트로 스크롤 중 프레임 뺏김 방지). `prefers-reduced-motion`이면 JS가 조기 반환 → 복제 없이 CSS 정적 `flex-wrap:wrap`.
  - **⚠️ 터치는 축 판정 후에 잡는다(`AXIS_PX 6px`, `|dx|>|dy|`).** `pointerdown`에서 곧바로 `dragging=true`로 두면 **세로로 페이지를 스크롤하려고 카드에 손을 얹은 것만으로 마퀴가 얼어붙는다** — 오너 불만("손만 올려도 멈춘다")의 터치판 재발이고, 트래픽 99%가 모바일이라 사실상 항상 멈춘 것처럼 보인다. 마우스(`pointerType==='mouse'`)만 누름 즉시 잡는다.
  - **⚠️ 놓을 때 관성은 유휴시간만큼 죽인다(`IDLE_TAU 0.12s`).** 브라우저는 포인터가 멈추면 `pointermove`를 안 쏘므로, '빠르게 끌다 → 멈춘 채 잠시 있다가 → 놓기'에서 묵은 `dragV`를 그대로 쓰면 급발진한다.

### 성장 리포트 목업 (`#member-appeal` 안 `.db-root`)
회원 마이페이지를 흉내낸 정적 목업(가짜 데이터 '박몬크'). 하단 `.db-cta` = **회원가입 유도 → `login.html`**(⚠️ 구 `href="#"`는 홈 최상단으로 튀던 버그, 2026-07-15 수정 — `#`로 되돌리지 말 것).
- **타이포 계약(2026-07-15):** 글꼴은 **사이트 것을 상속** — 명조는 `:root`의 `--serif`(Noto Serif KR), 산세는 body. ⚠️ 구 로컬 `--serif:'Nanum Myeongjo'`/`--sans:'Pretendard'` 선언은 **사이트가 로드하지도 않는 글꼴**이라 기기마다 다르게 떨어졌다("폰트가 제각각"의 진짜 원인) — **재선언 금지.** 크기는 `.db-root`의 8단 스케일 토큰(`--t-cap`~`--t-disp`)에서만 고른다(하드코딩 px 금지). 명조는 **이름·수치·제목**에만, 나머지는 산세. 숫자는 `tabular-nums`.
- **⚠️ 스케일 하한(2026-07-16 오너 "텍스트가 너무 작지 않냐"):** 구 스케일은 **최대 본문 `--t-md` 13.5px가 사이트 캡션 `--fs-caption` 14px보다도 작아** 위젯이 '축소한 스크린샷'처럼 읽혔다. 현재는 사이트 본문 17px 기준으로 12/13/15/17/19/21/27/38. **`--t-cap` 12px가 하한** — 다시 내리지 말 것.
- **⚠️ 스탬프는 칸마다 글리프 1개(2026-07-16 오너 "왜 이렇게 작게 한 거야"):** 375px 폭 예산은 `375 − 컨테이너 32 − shell 24 − card 24 = 295` → 7열에서 `(295−gap 30)/7 = 37.9px/칸`이 상한이고 **44px 칸은 수학적으로 불가능**(5열로 쪼개면 '2주=7일×2행' 의미가 깨짐). 구 마크업은 그 34px 칸에 `[체크 15px]+[날짜숫자 11px]`를 세로로 **두 개** 쌓아 스스로 목을 졸랐다 → 지금은 `done`=체크만(20px), `today`/`soon`=날짜 숫자만(`--t-lg` 명조 700). **'오늘·예정·수료' 라벨(`.db-dn`)은 `.db-legend`·`.db-ctitle em`과 중복이라 제거 — 칸 안에 요소를 다시 쌓지 말 것.** ≤560px에서 활자를 더 줄이던 구 규칙(숫자 12px·체크 13px)이 오너 불만의 직접 원인 — 폭이 모자라면 활자가 아니라 gap·패딩을 줄인다(≤420px에서 root 0/shell 12/card 12).
- **⚠️ 링 `%`는 흐름 밖에(2026-07-16 오너 "79% 정렬도 안 맞고"):** 구 `.db-pct small{vertical-align:6px}`은 `%`가 흐름 안이라 그 폭까지 `.db-pct` 센터링에 포함돼 **숫자 '79'의 시각 중심이 링 중심에서 7.35px 왼쪽으로 밀렸다**(아래 `.db-frac`은 정확히 중앙이라 두 줄이 어긋나 보임). 지금은 `position:absolute; left:100%; top:.1em`으로 흐름에서 빼 `.db-pct` 폭 = 숫자 폭 → 두 줄이 같은 축. `vertical-align` 방식으로 되돌리면 재발. `top`은 **em 단위**(`--t-disp`가 바뀌어도 캡라인 유지 — 매직 px 금지). 또 링 안 글꼴은 **수치=명조 1종·캡션=산세 1종**으로 통일(구 4종 혼용이 "폰트가 안 어울린다"의 실체) — `%`는 `font-family`를 주지 않고 `.db-pct`의 명조를 상속받는다.
- **⚠️ 링 크기는 '안에 들어가는 글자'가 정한다(2026-07-16 오너 "79% 밑에 또 튀어나온다"):** `.db-ringc`의 텍스트는 `position:absolute`로 얹은 **HTML**이라 SVG와 달리 링을 키워도 같이 커지지 않는다 → 링 크기 = 글자가 원에 내접할 여유. 캡션 `11 / 14일 인증`은 원이 좁아지는 아래쪽에 놓여 **폭이 아니라 모서리 대각 거리**가 지배한다(`√((83.9/2)²+28.5²)=50.73`). 구 132px(안쪽 반지름 45.5)는 **구 스케일에서도 여유가 1px뿐**이라 활자를 한 단 올리자 획을 5.2px 파고들었다. 현재 **156px + `stroke-width:11`**(뷰박스 132→156 확대 렌더라 `11×156/132=13px` — **획 두께는 종전 그대로**), 안쪽 반지름 54.95, 여유 4.2px. `r=52`는 그대로라 `stroke-dasharray:326.73`·`dashoffset:70`은 손댈 필요 없다. **활자 스케일을 또 올리면 이 여유부터 다시 계산할 것.**
- **⚠️ `<b>` 굵기는 명시할 것:** `<b>`의 UA 기본값은 `bolder`(상대값)라 부모가 700이면 **900으로 조용히 올라간다**(Noto Serif KR은 900이 실제 로드돼 있어 티가 안 남). `.db-day.today b`/`.db-day.soon b`가 이렇게 혼자 굵어졌던 자리 — 상속에 맡기지 말고 `font-weight:700` 명시.
- **⚠️ 그리드 넘침:** `.db-days`/`.db-stats`/`.db-badges`/`.db-ba-row`는 **`minmax(0,1fr)`** 필수 — `1fr`(=`minmax(auto,1fr)`)은 칸이 min-content 아래로 못 줄어들어 375px에서 **스탬프가 카드 밖으로 튀어나왔다**(오너 피드백). `repeat(N,1fr)`로 되돌리지 말 것.
- **카드 순서·데이터(오너 확정):** 권성호(수석·승무원 교육 11년·3,500명+) → 박새암(수석·객실승무원 9년·면접관) → 고은지(책임·합격생 다수·브랜딩) → 최보민(선임·대한항공 국제선·부사무장) → 김유리(선임·대한항공 부사무장 10년·기내방송). 김유리 사진 `images/instructor-kim.webp`.
- CSS `.ts-*`(`index.css`). 마크업은 인라인 static, **`.ts-cred` 하드코딩** — **`researchers.html`의 `researchers` 배열과 별도 소스라 이력 변경 시 양쪽 동기화 필요.**

### COMMUNITY 섹션 (`#community`)
집계 지표(카운트업, IntersectionObserver 1회) + '가장 좋았던 점' 롤링 배너 + 대표 후기 카드 3장 + '후기 더 보기' CTA(→reviews.html). `--mc-*` 서브테마는 2026-07-14부터 아이보리-**에스프레소-코랄**(구 네이비·골드 폐기). 지표 = 흰 카드 `border-right` 구분(≤640px 세로 `border-bottom`), 숫자 명조 900·단위는 카운트업 JS가 `<em class="mc-unit">`로 코랄 렌더. 롤링 = 에스프레소 배경 + 거대 명조 따옴표(`::before` `\201C`). **⚠️ 롤링 배너 `.mc-rolling-stage` 높이는 JS가 가장 긴 문구 기준 `height`로 px 고정(`lockHeight`)** — 문구마다 줄 수가 달라 3초 회전 시 배너가 출렁이면 아래 콘텐츠가 그만큼 밀려 '모바일 스크롤 중 페이지가 위아래로 튀는' 원인이었다(오너 피드백). `min-height`만으로 되돌리지 말 것(긴 문구에서 박스가 자람). 명조 스왑(`fonts.ready`)·폭 변화 시 재측정하며 **재측정 전 `height` 해제 필수**(안 풀면 클램프된 높이가 굳어 긴 문구가 잘림).
- **후기 카드 = A안:** '실제 후기' 초록 배지(`.mc-review-verify`) + 명조 한줄평(`.mc-review-quote` serif; 진입 시 `.mc-q-in` fade-up 1회, 기본 opacity 1이라 reduced-motion에도 노출) + 이름·챌린지 칩(`.mc-review-tag` 코랄) + '원문 보기' 버튼(`.mc-review-src` → `#mcLightbox`). (구 캡처 밴드 `.mc-capture-*`·`.mc-review-capture` CSS는 2026-07-14 제거.)
- **소스:** 지표·롤링 = `site_config`(key `community_stats`/`community_phrases`, admin '홈 커뮤니티' 탭; migration `20260710120000_site_config.sql`). 후기 카드 = `reviews`에서 `sort_order≥1` 상위 3개(`loadCommunityCards()`; admin '후기 관리'에서 대표 번호 1·2·3, 미지정 시 최근 3개). JS 상수 `COMMUNITY_STATS`/`ROLLING_PHRASES`는 site_config 폴백. **후기 카드엔 폴백 없음 — 실패 시 빈 그리드, 가짜 카드 재도입 금지.**
- `#mcLightbox`는 세로 긴 스크린샷용 폭 기준 확대. nav 앵커 `#community`·`#testimonials` 둘 다 유지. ⚠️ 개인 "몇 분 전" 실시간 활동 연출·섹션 하단 신청 CTA **재도입 금지**(브릿지 카피 `.mc-bridge` + '후기 더 보기' `.mc-cta`만; 신청 전환은 직전 B&A·직후 Advisor가 담당). admin 후기 관리·bulk-reviews.html은 `reviews`에 쓰지만 홈은 안 읽음 — reviews.html이 소비.

### reviews 테이블 분류 컬럼
`reviews`에 `challenge`(보신각/영합각/스피닝/승자각)·`cohort`(smallint, NULL=미상)·`reviewer_name`·`review_date`·`quote` 컬럼 (migration `20260710130000_reviews_classify.sql` + 기존 108건 백필, owner 실행). reviews.html 필터·커뮤니티 카드에 사용. admin '후기 관리'에서 수정. `quote`는 저장만(미표시).

### Design system (`tokens.css`)
Linked by index + detail/legal pages + member pages(login/mypage/admin).
- **팔레트(웜 통일):** 배경 = 베이지 `--bg #E9E4D8`; 타이틀·전환 CTA = 오렌지 `--action #F27945`; 본문 = `--text #26221C`. **네이비 폐기.** 코랄 3단: `--accent #F27945`(장식 면·큰 디스플레이), `--accent-dark #D9531F`(큰 볼드 24px+·테두리·포커스링, 3:1+), **`--accent-ink #A33D14`(12~15px 소형 텍스트·링크·활성 칩 — 4.5:1)**. ⚠️ 코랄·`--accent-dark`를 소형 텍스트에 쓰지 말 것 → `--accent-ink`. ⚠️ 오렌지·코랄 배경 위 흰 글씨 금지(≈2.7:1) — 채움이 `--accent`면 글씨 `--action-ink #2A1206`, `--accent-ink`면 흰 글씨 가능. 섹션 타이틀 = 오렌지 + 명조, 에이브로우 = `--accent-ink`(`.section-label`, tokens 오버라이드 `!important`). 커뮤니티 `--mc-*` 서브테마(아이보리-에스프레소-코랄)는 유지.
- **타이포:** 섹션 제목은 명조 — `h2.section-title/.ts-title/.mc-title/.ma-title`에 `var(--serif)`(Noto Serif KR) 700 + `--fs-h2 clamp(30px,4.2vw,46px)` (tokens.css 오버라이드, h2 접두 특이도로 `index.css`의 `.section-title` 규칙을 이김). **명조 쓰는 페이지(index·상세 4종·reviews)는 `<head>`에 Noto Serif KR `600;700;900` 링크 필수.**
- **UI 9대 원칙**(docs/design-principles.md): 가독성 12pt+ / 터치 44px+ / 대비 4.5:1 / 아이콘 통일 / 라운드 / 계층 / 여백 / 그룹핑 / 큼직. **375px 우선 검증.**
- Typography(`--fs-*`)·spacing(`--space-*`, 8px)·radius(8/14/20/24)·섹션 배경 리듬 전부 토큰화 — 하드코딩보다 토큰 우선.
- 아이콘 = `<body>` 상단 `<symbol>` 스프라이트(`currentColor` 리컬러). 모바일 스티키 CTA바 `.mobile-cta-bar`(≤768px).

### Audio (detail pages)
`audio/`의 before/after 클립, 위치 기반 네이밍: `challenger-a-before.mp3`…(voice), `spinning-a-before.m4a`…(spinning). Windows에서 추가 시 이중 확장자 주의(`*.mp3.m4a`). **클립은 음성이라 mono ~80kbps로 최적화**(스테레오·128k+ 불필요) — 새 클립도 `-ac 1 -b:a 80k`로 맞출 것. 전·후는 동일 설정으로 인코딩해 대비를 왜곡하지 않는다.

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
- **Dead code는 남기지 말고 제거.** 타임스탬프 백업 파일은 커밋하지 말 것.
