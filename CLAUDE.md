# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MONC (몬크 챌린지) — a Korean landing site for a 2-week voice/expression/interview training program for airline cabin-crew applicants. **Static site, no build step**, hosted on GitHub Pages at https://kwonsunghoho.github.io/wkon/. No framework, bundler, package.json, or test suite — hand-written HTML/CSS/JS served as-is.

## Commands

- **Local preview**: `python -m http.server 5500` → `http://localhost:5500/`. (`.claude/launch.json` defines a `wkon-static` server.)
- **Deploy**: `git push origin main` — GitHub Pages serves `main` directly; a push *is* the deploy (1–2 min propagation). Nothing to build.
- **No lint/test.** Verify by rendering in a browser — **375px first** (99% mobile traffic).

### ⚠️ 어디에 푸시할까 — 오너 확정(2026-07-30)
**눈으로 보고 판단하는 수정(레이아웃·문구·색·애니메이션)은 `main` 직행.** 브랜치를 거치지 말 것 — GitHub Pages 가 `main` 만 서빙해서 **브랜치는 오너가 폰으로 미리 볼 방법이 없다.** 확인이 어차피 합친 뒤에 일어나므로 브랜치는 단계만 늘리고, 실제로 "왜 적용이 안 되냐"는 사고가 났다(오너가 라이브를 보고 있는데 작업은 브랜치에 있었다). 되돌리기는 `git revert` + 푸시로 1~2분이면 되니 브랜치 여부와 무관하다.
**잘못되면 돈·데이터가 걸리는 것은 브랜치**: 신청·결제 흐름, Supabase 마이그레이션, 로그인·동의 게이트, 큰 구조 변경. 라이브가 깨지는 몇 분이 실제 손해인 자리들이다.
⚠️ 어느 쪽이든 **올리기 전에 실제 브라우저로 렌더해서 확인**하는 게 진짜 안전장치다(브랜치가 아니라). 375px 부터.

The repo is sometimes edited from a git **worktree** under `.claude/worktrees/...` on a `claude/*` branch; the canonical checkout is the repo root on `main`.

## Backend: there is no server

"Backend" = **Google Apps Script + published Google Sheets** and **Supabase**, called from the browser.

1. **Applications & reviews (legacy Apps Script)** — `APPLICATION_API_URL`. `POST {action:"application"}` **always appends a new row** to the **학생현황** sheet (dup phone irrelevant; phone stored with a leading apostrophe to keep the `0`). `GET ?action=reviews` returns the **후기** sheet. **Owned/edited in Google's console, not this repo** — changes need the owner to redeploy a new version.
2. **Recruitment dates** — **Supabase `challenge_rounds`(admin '모집일정' 탭에서 CRUD)가 단일 소스.** `recruit.js`가 읽어 모집중/예정/마감 + D-day chips를 그린다. 미등록 챌린지·조회 실패는 페이지별 하드코딩 폴백(`data-recruit-*` / `RECRUIT_FALLBACKS`)으로 떨어진다. **⚠️ 구 published Sheet CSV(`RECRUIT_CSV`·`loadRecruitDataFromCsv`)는 2026-07-23 완전 제거 — 구글 시트 폴백 재도입 금지(admin 단일 관리).**
3. **Supabase** — `supabase-config.js` (`MONC.sb`). Auth/members, `applications`, `reviews`, `site_config`, `page_events`, `news_articles`, `news_scraps`. **Tables/RLS/columns are created by the owner in the Supabase console.** Migrations in the repo are the source, but the owner must run each in the SQL Editor before it takes effect; **unapplied migrations degrade gracefully** (features fall back silently).
4. **뉴스 수집기 (GitHub Actions)** — 예외적으로 **브라우저 밖에서 도는 유일한 코드**. `scripts/fetch-news.mjs`가 3시간마다 구글뉴스 RSS를 긁어 `news_articles`에 쓴다(service role 키는 GitHub Secrets). 아래 '항공 뉴스 수집 파이프라인' 참조.

## Architecture

### Application flow — `apply.html` is the source of truth
All "신청하기" CTAs navigate to **`apply.html`** (detail pages → `apply.html?c=<recruit-id>` to preselect). **Bank account, curriculum, and the submit schema live in apply.html** — edit there. **⚠️ 챌린지 공통 참가비는 admin에서 관리(2026-07-24):** `site_config.challenge_price`(jsonb 숫자, admin '모집일정' 탭 상단 입력)가 단일 소스. apply.html은 `loadChallengePrice()`로 읽어 `let PRICE`에 넣고 **카드 가격·요약 라벨·FAQ·결제 금액 전부 이 값에서** 파생(하드코딩 "3만원" 금지 — 숫자 `toLocaleString()+'원'` 표기). **미설정 시 30000 폴백.** 4개 챌린지 공통 단일가(챌린지별 다른 가격 아님). **⚠️ verify-payment(서버)도 같은 `site_config.challenge_price`를 읽어 금액 검증** — 값을 바꾸면 함수 재배포가 돼 있어야 토스결제 금액이 맞는다(계좌이체는 apply.html 계산이라 무관). 특강 가격은 `special_lectures.price`(특강별). **⚠️ 보증금·환급 제도는 2026-07-20 전면 폐지**(PG 간편결제 심사에서 '보증금 환급' 문구가 승인 거절 사유). 보증금·환급 워딩을 공개 페이지에 재도입하지 말 것(admin·mypage의 '환급' UI는 기존 신청자 보증금 반환 관리용으로만 잔존).
- `application-modal.js` (self-injecting modal on detail pages, button `.app-modal-btn`) is **dormant** — kept but unused; declares `APPLICATION_API_URL` independently.
- The old inline modal in `index.html` (its markup + CSS + `openApplicationModal`/`submitApplication`/`copyAccount` + `?openModal=true`) was **removed 2026-07-14** in a dead-code cleanup.

### Pages
- `index.html` — the landing page. **2026-07-30 C안 서사**(인트로 → 막막함 → 열 가지→세 가지 → 세 개의 문(타임라인) → 숫자 → 마무리 CTA — 아래 '랜딩 섹션 순서' 참조). **CSS는 `index.css`로 분리** — 캐스케이드 `tokens.css`→`index.css` 순서 보존이 핵심(링크 순서 바꾸면 `!important` 싸움이 깨짐). ⚠️ index의 CSS는 `index.css`에서 찾을 것(index.html 안엔 `<style>` 없음). JS는 여전히 index.html 인라인.
- `apply.html` — **신청·결제 전용(모든 신청 CTA의 목적지).** 히어로 → 챌린지 카드 4개(클릭=선택+커리큘럼 아코디언, 다중선택 장바구니) → 회원가입 배너(→login.html) → 조합 추천 → FAQ → 계좌이체 폼 → 하단 고정 요약바. `?c=voice,answer`로 프리셀렉트. `supabase-config.js`+`recruit.js` 로드, `loadChallengeStatuses()`로 마감 카드 비활성, 제출 `MONC.sb.from('applications').insert(...)`. 챌린지·FAQ는 하단 인라인 `CHALLENGES`/`FAQ` 배열(FAQ #3·#6·#7 임시 문구). **회원 모드**: 로그인 시 `getMyProfile()`로 이름·전화 자동채움·insert에 `member_id` 포함(→마이페이지 연동)·전화 미보유 시 `members`에 저장. **⚠️ 법적 필수:** 신청 버튼 위 `#appConsent` 필수 동의 체크(만14세+개인정보 수집·이용) 미체크 시 `submitApplication()`이 차단 — **개인정보 보호법상 삭제·완화 금지.**
- `onboarding.html` — 첫 로그인 후 `login.html`의 `routeByRole()`이 `!profile.phone && !localStorage.monc_onboard_done`이면 여기로. 이름·전화·전공(major) → `members`. ⚠️ `members.major`는 migration `20260708120000_member_major.sql`(owner 실행); 미적용 시 major만 방어적으로 무시. `getMyProfile()` 공용 셀렉트엔 major 미포함(컬럼 미생성 시 전체 조회가 깨지므로 별도 방어 조회).
- `reviews.html` — **후기 모음(홈 '후기 더 보기' + nav '후기'의 목적지).** Supabase `reviews`(visible=true)를 매스너리 그리드 + 챌린지·기수 필터칩(데이터 존재값만 동적 생성). `select('*')`이라 분류 컬럼 미적용에도 무에러(필터바 숨김). 후기 스크린샷에 **실명 노출**(공개 카페 후기·오너 승인).
- `researchers.html` — **연구진 소개 전용(2026-07-14 신설).** 구 `#instructors`(mi-section)를 분리. `tokens.css` + 인라인 `.mi-*` CSS·`researchers` 배열·탭 IIFE로 완전 동작. 진입: `#researchers-strip` 티저 + nav '연구진'. **연구원 이력의 소스오브트루스** — ⚠️ index의 `.ts-cred` 스트립 카드와 **별도 소스라 이력 변경 시 양쪽 동기화 필요**(아래 스트립 항목).
- `briefing.html` — **면접 준비 도구 허브(2026-07-22 배포).** nav '승준노트'의 목적지. **⚠️ 이름은 2026-07-30 오너 지시로 '브리핑룸'→'승준노트'로 바뀌었다(파일명·클래스명 `.nav-briefing`·`data-pillar="briefing"`은 그대로 — 계측 기준선이 이어져야 하고 URL 을 바꾸면 밖에 나간 링크가 죽는다). 화면에 보이는 글자만 바꿀 것.** 영문 라벨은 `MONC NOTE`. 카드 4장(항공산업, 항공사 뉴스 모아보기→`news.html` / 답변 기초 쌓기→`sojae.html` / 답변노트→`mypage.html#sec-answers` / AI킬러→`ai-killer.html`) + 숨김 카드 1장(실전 모의면접 `rehearsal.html`, `display:none`으로 보류 중 — 열 때 `style` 한 줄만 제거). **⚠️ 카드에 권한 알약 배지를 달지 말 것(2026-07-25 오너 지시 "이거 다 빼")** — 구 `.bf-badge`(누구나/수강생 전용/회원 전용/응시권 필요)는 마크업·CSS 통째로 삭제됐다. 4장 중 3장이 같은 회색 알약을 달고 있어 구분에 기여하는 정보가 없었고, 11.5px로 9대 원칙 '가독성 12pt+'에도 미달이었다. 권한 안내는 각 도구 페이지의 로그인·동의 게이트가 담당. **⚠️ `.bf-desc`의 `padding-right:26px`는 `.bf-go` 화살표 자리** — 화살표가 `absolute`라 설명 텍스트가 자동으로 안 밀린다(news.html `.nw-link`와 같은 함정). 실측(375px)상 이 여백이 없으면 답변노트 첫 줄이 화살표를 밟는다 — **문구를 늘리면 이 여백도 같이 볼 것.** **⚠️ 설명줄 활자 = `var(--fs-body-sm, 15px)`/500/행간 1.62(2026-07-25 오너 "서브타이틀이 너무 안 읽힌다" → 목업 4안 중 B 선택, `outputs/briefing-card-desc-mockup.html`이 결정 기록).** 구 14px/400은 대비 문제가 아니었고(`--text-muted` 흰 카드 위 7.12:1) **카드의 유일한 설명 줄이 캡션 크기로 19px 명조 제목 밑에 앉은 위계**가 원인이었다. 기각: 17px(`--fs-body`)은 제목과 무게가 붙어 위계가 흐려진다. **⚠️ `var()` 폴백 15px를 지우지 말 것** — 이 CSS는 HTML 인라인이고 tokens.css는 별도 파일이라 '새 HTML + 캐시된 구 tokens.css' 조합에서 선언이 무효가 되어 16px로 튄다(실측 확인). **⚠️ 홈 티저 `index.css`의 `.bp-desc`와 같은 값으로 유지** — 같은 카드라 한쪽만 올리면 홈에서 넘어올 때 다르게 보인다. 부피 실측(375px 4장+간격): 624→**665px**. nav는 **허브 하나만** 노출한다(뉴스·소재발굴을 각각 메뉴에 올리지 말 것 — 메뉴 줄이 감당 못 한다). ⚠️ nav '승준노트'는 index·researchers·challenges 세 파일 하드코딩이라 **문구·표식 변경 시 셋 다 동기화**. 표식은 **펄스 점**(`.nav-briefing::before`, `--action` 6px·모바일 7px, bfPulse 2.6s) — 구 창문 아이콘은 2026-07-22 폐기(오너 "로고같지도 않다": 10px에선 정체불명 캡슐 테두리, 창문 심볼은 로고가 크게 나오는 자리에만). 메뉴 위치는 **맨 앞** — 구 끝자리는 코랄 '신청하기' 버튼 옆이라 점이 버튼 덩어리에 묶여 강조가 죽었다. '면접관 체험' nav 링크는 2026-07-22 오너 판단으로 삭제(홈 섹션일 뿐 메뉴 한 자리 무게가 아니다 — 섹션 `#blind-quiz` 자체는 유지).
- **모바일 메뉴 '챌린지' 아코디언**(2026-07-22, index·researchers 양쪽 동일): 탭하면 `#challenges`로 튀지 않고 챌린지 4개(`.mm-sub`: 이름+한줄설명)를 펼쳐 **상세 페이지로 직행**. ⚠️ **토글은 반드시 `<button class="mm-acc-btn">`** — 햄버거 IIFE가 `mm.querySelectorAll('a')` 전부에 '클릭 시 메뉴 닫기'를 걸어놔서 `<a>`로 만들면 **펼치는 순간 메뉴가 통째로 닫힌다.** 펼침은 `max-height` 전환(구형 iOS 사파리에서 grid `0fr→1fr`이 안 먹어 펼침이 죽음), 상한 460px는 실측 콘텐츠 298px(4칸×72px+여백)보다 넉넉히 잡은 값이라 **항목을 추가하면 같이 올릴 것**(모자라면 마지막 칸이 잘린다). 접힘 시 `visibility:hidden`으로 키보드 포커스도 차단. 데스크톱 nav엔 '챌린지' 링크가 그대로 `#challenges`. `vertical-align:middle` 보정은 유지(점이 첫 요소면 기준선이 점 하단으로 잡혀 뜬다 — 실측 어긋남 0.49px) — 빼면 3px 뜬다.
- `news.html` — **항공 뉴스 게시판(2026-07-22 배포).** 2탭(전체 뉴스 / 내 스크랩). 필터 = 제목 검색창 + **[항공사]·[주제] 픽커 버튼 2개 → 바텀시트 선택**(2026-07-23 오너 지시 "지저분하게 나열하지 말고 눌러서 선택" — 구 칩 나열 폐기). 버튼 라벨이 선택값으로 바뀌며 `.set` 틴트 — 현재 필터 상태가 항상 보인다. 옵션은 최근 1000건에 실존하는 값만 렌더. 기사 시각은 상대시간("3시간 전")이 아니라 **게시 날짜 YYYY.MM.DD**(`fmtDate`, 2026-07-23 오너 "시간은 의미 없다"). ⚠️ 칩 나열(가로 스크롤 줄)로 되돌리지 말 것 — sticky 필터바가 375px 화면의 70%를 먹던 실측 문제로 회귀한다. `.nw-filter-row`/`.nw-chip` CSS는 내 스크랩 탭 '내 태그' 줄이 아직 써서 남겨둔 것(삭제 금지). 스크랩 버튼은 **창문 심볼 + 글자 라벨 알약**(인라인 `#moncWin`, 전=`grayscale(1)`+'스크랩' / 후=원색+'저장됨'+코랄 틴트). 리본 북마크로 되돌리지 말 것이며 원본 SVG는 로고 교체(a5f1b85)로 삭제됐으므로 **인라인 심볼이 정본**이다. ⚠️ **라벨을 빼고 아이콘만 두지 말 것**(2026-07-22 오너 피드백 "저게 스크랩인지 모르겠다") — 창문은 브랜드 심볼이지 '저장'의 관습 기호가 아니라 아이콘 단독으로는 무슨 버튼인지 안 읽힌다. 시각 높이 36px에 `::after{inset:-4px}`로 터치 44px를 만들고, `.nw-link`의 `padding-right:98px`가 알약(≈75px) 자리를 비운다 — **알약은 absolute라 제목이 자동으로 안 밀린다. 라벨 길이를 바꾸면 이 여백도 같이 볼 것.**
- `ai-killer.html` — **AI킬러(2026-07-25 신설).** 자소서·답변에서 'AI 같은 표현'을 찾아 밑줄 + [왜/고치기] 칸으로 돌려준다. 승준노트 카드에서 진입, **로그인 + 동의 게이트 필수**. 전체 스펙: `docs/superpowers/specs/2026-07-24-ai-killer-design.md`(소스오브트루스). 요약만:
  - **화면 = D안**(원문 + 하단 dock, 44px ‹ ›로 하나씩 순회) + '전체 목록으로 보기' 토글. ⚠️ **원문 모드와 목록 모드는 배타적**(`.show-list`) — 한 화면에 둘 다 띄우지 말 것. ⚠️ D안을 고른 이유가 **원칙 2(터치 44px)**다: 글 속 밑줄은 실측 32~33px이라 44px이 불가능한데, D안은 필수 조작이 화살표라 밑줄을 안 눌러도 전부 볼 수 있다. **화살표·토글·저장이 44px 아래로 내려가면 이 안의 근거가 무너진다.** 기각된 A·B·C안은 `outputs/ai-killer-mockup.html`에 결정 기록으로 보존.
  - **⚠️ 결과 화면의 액션은 dock 안에 둔다(2026-07-25 오너 신고 "전체목록으로 가야만 저장이 뜬다").** 구 버전은 본문 끝(`.d-save`)에 뒀는데, ① 1,500자 원문을 끝까지 스크롤해야 닿고 ② **`body`의 아래 여백을 180px로 어림잡아 박아 둬서** 원문 모드 dock(실측 **291px**)에 111px 가려졌다. 목록 모드에선 dock이 45px로 줄어 드러나기 때문에 "목록으로 가야만 보인다"로 나타난 것이다. 지금은 `[전체 목록][저장소 보기][새 검사]` 3칸(각 48px)이 dock 안에 있다. ⚠️ **dock은 `fixed`라 문서 흐름에서 빠져 있고 지적마다 시트 높이가 달라진다 — 아래 여백을 고정값으로 두지 말 것.** `ResizeObserver`가 따라간다(`syncDockPad`). ⚠️ 지적이 0곳일 때 **dock을 통째로 숨기지 말 것** — 액션이 그 안에 있어 닿을 데가 없어진다. `.no-hits`로 시트·화살표만 감추고 액션 줄은 남긴다(dock 49px).
  - **서버 = `supabase/functions/ai-killer/index.ts`**(Opus 5). 규칙이 자리를 찍고 AI는 칸만 채운다. ⚠️ **구조화 출력(`output_config.format`)으로 인사말·맺음말이 들어갈 자리를 물리적으로 없앴다** — 일반 텍스트 응답으로 되돌리지 말 것. ⚠️ **한 파일이어야 한다**(오너가 콘솔에 붙여넣어 배포 — CLI 없음). 규칙 엔진을 모듈로 쪼개면 배포 불가.
  - ⚠️ **밑줄 수와 등장 횟수는 다른 수다.** 밑줄은 같은 표현당 하나(화면 문제), 등급의 분자는 등장 횟수 전부(측정 문제). 묶으면 긴 AI 글의 등급이 뒤집힌다(실측 확인). **화면에는 '고칠 곳 N곳' 하나만** 보여준다 — 두 수를 같이 띄우면 "6곳인데 왜 7번?"이 된다.
  - **규칙을 고치면 `node scripts/ai-killer-dryrun.mjs`로 기준선과 비교할 것**(DB·API 없이 규칙만). 특히 '사람이 잘 쓴 글'이 0곳을 유지해야 한다 — 규칙 검사기는 못 잡아서가 아니라 멀쩡한 글에 밑줄을 그어서 망한다.
  - **충전 = 포트원 카드·간편결제(자동, 2026-07-25).** `verify-payment`의 `creditPack` 분기가 결제를 검증하고 원장에 넣는다. ⚠️ **넣을 대상은 body 가 아니라 JWT 로 정한다**(남의 계정 충전·결제 가로채기 차단). ⚠️ 금액은 `site_config.credit_packs`를 서버가 다시 읽어 검증 — admin '크레딧' 탭에서 바꾸면 **재배포 없이** 반영된다. ⚠️ 같은 결제로 두 번 충전되는 걸 막는 건 `credit_ledger_purchase_uq`(키가 `(tool, ref)`라 *다른 계정에* 충전하려는 시도도 막힌다). ⚠️ 모바일 리다이렉트·bfcache 는 `lecture.html` 패턴을 따르되, 이 화면은 **입력값(글)을 살려야 하므로 복귀 시 새로고침이 아니라 버튼만 되돌린다.**
  - **관리자 수동 지급도 admin '크레딧' 탭**에서 한다(회원별 잔액·지급/회수·기수 일괄·원장 50건). ⚠️ 잔액은 저장된 컬럼이 아니라 **원장 합계**다 — 잔액 컬럼을 만들지 말 것. ⚠️ **Supabase SQL Editor 에서는 `grant_credit` RPC 가 안 된다**(세션이 없어 `auth.uid()` NULL → `is_admin()` false → `not_admin`). 콘솔에서 급히 넣어야 하면 `credit_ledger` 에 직접 insert 한다.
  - **⚠️ 배포 상태는 프로브로 확인한다 — SQL 을 시키지 말 것.** 로그인 게이트라 밖에서는 어떤 버전이든 401 만 보이고 `airline_profiles` 는 RLS 로 개수도 안 보여서, 확인할 방법이 없어 관리자에게 SQL 을 여러 번 돌리게 한 자리다. 지금은 로그인 없이 `POST {"probe":true}` 하면 `version`·`features`·`airline_profiles` 개수·`terms` 개수·`has_api_key` 를 돌려준다(내용은 안 나간다). **코드를 고치면 `FN_VERSION` 도 같이 올릴 것** — 이 값이 배포 상태를 아는 유일한 길이다. 2026-07-25 확인: `2026-07-25d` · 프로필 4곳 · 사전 28개.
  - **⚠️ 마이그레이션·SQL 은 파일 경로가 아니라 코드로 대화창에 붙여넣는다**(오너 지시). 경로를 bash 블록으로 주면 앱이 Run 버튼을 붙여 터미널이 열리는데, 오너는 Supabase 콘솔에 붙여넣는다.

### 답변 저장소 + 크레딧 (2026-07-25 재설계 — 구조가 뒤집혔다)

**AI킬러가 주인공이 아니라 `answers`(답변 저장소)가 주인공이고 KILL AI 는 그 위에서 도는 기능이다.**
오너 지적: *"소재발굴을 하지 않고 그냥 바로 답변을 넣고싶은 애들도 있다. 소재 발굴은 소재를 발굴하는 곳이지 답변을 넣는 관문이 아니다."*

- **글이 저장소로 들어오는 길 셋 — 전부 열어 둔다**: ① `answers.html` 에서 직접 쓰기(무료·무제한) ② 소재 발굴 ③ **KILL AI 에 붙여넣으면 서버가 자동 저장**. ⚠️ 어느 길도 막지 말 것 — 특히 소재 발굴을 관문으로 만들지 말 것.
- **⚠️ 저장은 언제나 무료·무제한.** 크레딧과 무관하다. 화면에도 "무제한 무료"를 명시한다(검사 횟수가 없으면 저장도 못 하는 줄 아는 오해가 실제로 생긴다).
- **크레딧 차등**: 소재 발굴 **2** / KILL AI **3** / 첨삭 **10**. ⚠️ **가격은 원가가 아니라 가치를 따랐다** — 첨삭 원가는 킬러의 두 배쯤인데 단가는 세 배다. 학생이 돈을 내는 이유가 진단이 아니라 처방이라서다. **진단이 싸야 자주 쓰고, 자주 써야 처방이 팔린다.** 원가 비율로 되돌리지 말 것.
- **무료 = 하루 5크레딧(소재 1회 + 킬러 1회), 쌓이지 않고 리셋.** *(설계 기본값 — 실제 값은 2026-07-27부터 admin '크레딧' 탭에서 조절한다. 아래 소재 발굴 항목 참조.)* ⚠️ **이 리셋이 곧 첨삭 잠금이다** — 하루 5로는 첨삭 10을 못 모으므로 별도 free/paid 구분이 필요 없다(첨삭이 5크레딧이던 시절 계산을 그대로 들고 와 잠금을 넣었다가 오너 지적으로 걷어냈다). 첨삭만 **가입 후 총 1회** 무료(`credit_free_limits`) — 한 번은 봐야 값어치를 알고, 안 보면 결제할 이유가 없다.
- **⚠️ 차감 키(`spend_credit`의 `p_ref`)는 검사 id 가 아니라 `<answer_id>#<묶음>`** 이다. 같은 답변을 `MAX_RECHECK`(2회)까지는 같은 키로 부르므로 RPC 가 `already` 로 통과시켜 **재검사가 무차감**이 된다. 고치고 다시 확인하는 게 이 도구의 핵심 루프라, 재검사에 매번 받으면 학생이 확인을 안 해 도구가 반쪽이 된다. 3번째부터 묶음 번호가 올라가 새로 차감된다.
- **⚠️ 브라우저가 보낸 `answerId` 를 믿지 않는다.** 저장·수정이 service role 이라 RLS 를 통과하므로, 남의 답변 id 를 넣으면 그 사람 글이 덮인다. 소유 확인 후 **아니면 에러 대신 새로 저장**한다(에러로 막으면 '답변을 지운 뒤 뒤로가기' 같은 정상 사용까지 죽는다).
- **⚠️ 검사 뒤 저장소의 그 답변도 방금 검사한 글로 맞춘다** — 안 하면 다음 검사가 옛 글로 돌아간다.
- **⚠️ `free_use` 행에 `cost` 를 남긴다** — `delta` 가 0 이라 그것만으로는 하루 사용량을 셀 수 없다. **환급은 `cost` 만큼**(구 `+1` 고정이면 첨삭 10 실패에 1만 돌려주고 9를 삼킨다). 하루 경계는 **Asia/Seoul 자정**(UTC 로 두면 한국 오전 9시에 초기화된다).
- **분류 3종**(`answers.category`·`doc_kind`·`airline`): 유형은 **새로 만들지 않고** `questions.category` 4종을 그대로 쓴다 — 새 체계를 만들면 소재 발굴 답변과 직접 쓴 답변이 서로 다른 분류에 걸려 필터가 반쪽이 된다. ⚠️ `airline` 의 **`'all'`(만능)과 NULL(아직 안 정함)은 다른 값**이다(첨삭 방향이 갈린다).
- **⚠️ `answers.html` 과 `mypage.html` 은 같이 고친다** — 제목 폴백(`questions.content || title`)·분류를 한쪽만 고치면 직접 쓴 답변이 제목 없이 뜬다. 조회는 **`select('*')`** (컬럼을 나열하면 미적용 환경에서 목록 전체가 400).
- 검사 이력은 답변에 **1:N**(`ai_killer_checks.answer_id`). `answers.html` 카드에 마지막 등급, 펼치면 이력 전체. 이력 → `ai-killer.html?check=<id>`(저장된 결과 복원, 재검사 아님) / 검사 → `?answer=<id>`.
- 충전 팩: 체험 5,000/14 · **기본 10,000/30** · 집중 30,000/100(챌린지 참가비와 같은 값 — 이미 그 값을 내 본 사람들이라 저항이 낮다). 자소서 1문항 완성 = **18크레딧**(소재 2 + 킬러 2회 6 + 첨삭 10). ⚠️ **비교 기준 문구를 빼지 말 것** — "학원 자소서 첨삭은 한 문항에 2~5만 원" 한 줄이 없으면 '30크레딧 10,000원'은 싼지 비싼지 판단이 안 돼 결제가 안 일어난다.
- migration: `20260725170000`(분류 3종) · `20260725180000`(단가·하루 무료) · `20260725190000`(팩 3종) — **전부 적용 완료(2026-07-25)**.
- **⚠️ 소재 발굴도 2026-07-27부터 크레딧으로 통제한다 — 구 `members.sojae_enabled` 권한 스위치는 폐지.** 회원이면 누구나 들어가고, 값은 **다듬기 한 번에만** 붙는다(되묻기 대화는 무료). 관련 UI(admin 회원별 토글·일괄 켜기/끄기·목록 '소재' 배지, mypage 카드 잠금, sojae 권한 차단 화면, `MONC.hasSojaeAccess`)는 전부 삭제 — **권한 플래그 방식으로 되돌리지 말 것.** 서버(`sojae-chat`)의 권한 검사도 함께 제거됐다.
  - **⚠️ 왜 '세션당'이 아니라 '다듬기마다'인가(오너와 확정):** 되묻기는 Haiku 4.5 라 1회 약 5원인데 다듬기는 Sonnet 5 라 약 50~150원 — **10배 이상 차이**다. 한 문제당 한 번만 받고 다듬기를 무제한으로 두면 **하루 무료 한도가 원가 상한 노릇을 못 한다**(한 사람이 하루에 몇 번을 눌러도 2크레딧). 비싼 호출 하나에 값을 붙여야 하루 무료가 그대로 인당 원가 상한이 된다. 대화가 무료인 건 덤이 아니라 설계다 — 말만 해보고 나가는 사람이 손해 보지 않아야 들어온다.
  - **⚠️ 차감 키는 `<question_id>#<이전 차감 횟수>`** — 같은 키 재호출은 `already` 로 통과해 네트워크 재전송에 두 번 깎이지 않고, 다음 다듬기는 번호가 올라가 새로 차감된다(AI킬러와 같은 방식). 횟수는 `credit_ledger` 에서 `reason in ('use','free_use')` 인 행만 센다 — refund 행까지 세면 환급 뒤 번호가 어긋난다.
  - **⚠️ 크레딧 부족·실패는 반드시 HTTP 200 + `code`** 로 돌려준다. non-2xx 면 supabase-js 가 `data` 를 null 로 만들어 화면이 사유를 못 띄우고, `refineAI()` 의 폴백(뼈대)에 삼켜져 **"안 깎였는데 결과가 나왔다"** 가 된다. 실패 시엔 다음 단계로 넘기지 말고 되묻기 화면으로 되돌린다(대화는 무료라 잃는 게 없다).
  - **원가 손잡이 둘**: 다듬기 재료 상한 `MAX_MATERIALS_CHARS` **4,000자**(구 8,000)와 다듬기 `output_config.effort: "medium"`(Sonnet 5 기본은 high). ⚠️ **`max_tokens` 는 상한이지 청구액이 아니다** — 줄여도 원가는 안 줄고 답만 잘린다(8192 유지).
  - **⚠️⚠️ 하루 무료(`credit_daily_free`)를 올려서 후하게 풀려고 하지 말 것 — 5는 인심 조절 손잡이가 아니라 첨삭 잠금장치다(2026-07-27 오너 지적으로 되돌림).** `spend_credit` 의 판정이 `쓴양 + 단가 <= 하루무료` 라서 **하루 무료가 첨삭 단가(10) 이상이 되는 순간 첨삭이 매일 공짜**가 된다 — 만원짜리 주력 상품이 사라진다. 5는 '소재 1회 + 킬러 1회'인 동시에 '하루 5로는 첨삭 10을 못 모은다'는 뜻이고, 그래서 별도 free/paid 구분 없이도 첨삭이 잠긴다. **초반에 후하게 풀고 싶으면 하루 무료가 아니라 `grant_credit`(admin 기수 일괄 지급)으로 준다** — 한 번 주고 끝이라 구조를 건드리지 않고, 회수도 필요 없다. admin '크레딧' 탭의 하루 무료 입력칸은 `>= 첨삭 단가`면 빨간 경고 + 저장 시 재확인으로 막는다(이 가드를 지우지 말 것).
  - admin '크레딧' 탭의 **하루 무료·도구별 단가 입력칸**(`site_config.credit_daily_free`/`credit_costs` upsert, 재배포 불필요)은 값을 **보고 바로잡기** 위한 것이지 상시 조절용이 아니다. ⚠️ 단가 저장은 **기존 객체에 덮어쓰기** — 화면에 칸이 없는 도구(`rehearsal`)를 지우면 조용히 폴백 단가로 돌아간다.
  - ⚠️ **`sojae-chat` 은 오너가 Supabase 콘솔에서 재배포해야 실제로 차감된다**(CLI 없음 — 대시보드 > Edge Functions > sojae-chat > 코드 교체 > Deploy). 재배포 전에는 화면 안내만 바뀌고 차감은 일어나지 않는다.

### 항공사 프로필 — 이 도구의 자산 (`airline_profiles`)

오너가 준 실제 합격 자소서에서 뽑았다(제주 3 · 에프 2 · 이스타 1 · 티웨이 1). **항공사마다 문항도 문체도 완전히 다르다** — 제주는 대괄호 소제목을 쓰고 에어프레미아는 안 쓴다(정반대), 티웨이는 **분량 상한이 절반**(최대 500자)이고 2번 문항에 **"항공업 관련 내용 제외"** 라는 제약이 있다.

- **⚠️ 원문은 저장소·DB 어디에도 넣지 않는다.** 실명 자소서는 개인정보다. 패턴만 넣고 원본은 오너 PC 에만 둔다(`.gitignore` 에 방어선). **자료를 받으면 파일명을 믿지 말고 본문의 회사명·출처 URL 로 확인할 것** — `박신원 대한항공.pdf` 의 내용이 실제로는 제주항공 지원서였다.
- **⚠️ 합격자 문장을 AI 에게 예시로 주지 않는다**(확정본 결정 10). 프롬프트에 못 박혀 있다 — 흉내 내라고 하면 지원자 글이 전부 같아져 **우리가 잡으려는 AI스러움을 우리가 만든다.** 형식과 '빠진 것'을 짚는 데만 쓴다.
- **⚠️⚠️ 레퍼런스는 참고지 정답이 아니다(오너).** 자소서 문항은 **채용마다 바뀐다.** 그래서 프로필을 두 겹으로 나눠 싣는다 — 잘 안 바뀌는 것(회사 소재·문체·분량)은 **늘**, 문항별 주의사항은 **문항이 일치할 때만**. 일치 판정은 학생이 입력한 문항과 견주어 서버가 한다(오너 착안). 불일치면 *"문항에 대한 판단은 하지 마라"* 를 대신 싣고 **로그에 남긴다**(쌓이면 그 항공사 문항이 바뀌었다는 신호).
- **⚠️ 판정은 일부러 보수적이다**(임계 0.62, 애매하면 불일치). 틀린 조언보다 조언을 덜 하는 편이 낫다. 대가로 학생이 문항을 아주 짧게 줄여 쓰면 놓치므로 입력칸이 *"그대로 넣어 주세요"* 로 안내한다. **임계값·유사도 식을 고치면 `node scripts/ai-killer-qmatch.mjs`** 로 확인할 것(불일치가 일치로 뒤집히는 게 가장 위험).
- RLS 는 `ai_killer_terms` 와 같이 **일반 회원에게 닫혀 있다**(경쟁사 복제 방지). 중계 함수(service role)와 관리자만.
- migration `20260725200000` + 티웨이 `20260725210000` — 적용 완료. **아직 자료가 없는 항공사: 대한항공 · 진에어 · 에어로케이**(아시아나는 대한항공에, 에어서울·에어부산은 진에어에 통합돼 목록에 없다). **대한항공은 지망자 최다인데 0건이라 확보 우선순위 1번.**
  - **승준노트 카드 아이콘 = 저격 조준선**(`#mw-kill`, briefing.html 스프라이트 한 곳에만 — 홈 티저엔 AI킬러 카드가 없다). 2026-07-25 오너 지시("저격하는 느낌") → 목업 3안 중 ①(링+십자선+코랄 조준점) + "좀 얇게"로 **획 1.0**(형제 1.35보다 의도적으로 얇다 — 조준선은 가늘어야 조준선으로 읽힌다). 구 코랄 취소선 안은 폐기. 결정 기록·기각안(②흰색 1종 / ③귀퉁이 브래킷)·획 두께 4단 비교는 `outputs/ai-killer-icon-mockup.html`. **⚠️ 획을 바꾸면 십자선 path 좌표도 다시 계산할 것** — round cap 이 획 절반만큼 더 튀어나오므로, 좌표를 그대로 두면 조준선이 짧아져 링을 가로지르지 못한다(상세는 심볼 위 주석).
- `answers.html` — **내 답변 저장소.** 위 '답변 저장소 + 크레딧' 참조. 목록(검색 + 유형 칩 + 마지막 검사 등급) · **답변 직접 추가**(하단 고정 버튼, 무료·무제한) · 펼치면 검사 이력. ⚠️ 검색창·분류 칩은 **원래 있었다** — 자유 글에 분류가 없어 필터에서 빠졌던 것이라, 새로 만드는 게 아니라 동작하게 고치는 작업이었다. `mypage.html#sec-answers` 는 같은 데이터의 미리보기 3개.
- `lectures.html` / `lecture.html` — **특강 시스템(2026-07-24 신설).** nav '특강' + 홈 '특강 문'(.doors, 2026-07-29부터)의 목적지. 아래 '특강(special_lectures) 시스템' 참조. 챌린지와 달리 **상세페이지를 코드로 만들지 않고** admin '특강' 탭 등록분을 `lecture.html?id=<id>` 템플릿이 읽어 그리고, **그 상세페이지 안에서 바로** 토스결제·계좌이체로 신청한다(apply.html 안 거침 — 오너 요청).
- `challenges.html` — **챌린지 허브(2026-07-29 신설, 홈 '챌린지 문'의 목적지).** 아래 '챌린지 카드 목록 — challenges.html' 참조. nav '챌린지' 드롭다운·모바일 아코디언의 첫 항목 '챌린지 한눈에'가 여기로.
- Active detail pages (challenges.html 카드에서 링크, `application-modal.js` 로드하나 신청은 `apply.html?c=<id>`로): `challenge-voice.html`(보신각 · 블라인드 퀴즈 탑재), `challenge-expression.html`(영합각), `challenge-spinning.html`(스피닝 · 블라인드 퀴즈 탑재), `challenge-answer.html`(승자각).
- `challenge-express.html`, `challenge-speech.html` — **legacy/unused**, index 미링크. 라이브 아니니 편집 금지.
- `login.html` — 구글·카카오 OAuth. **두 뷰**: `#loginView`(로그인 버튼 — 항상 활성) / `#consentView`(최초 1회 동의 게이트). **⚠️ 법적 필수(2026-07-15 개편):** 약관·개인정보 동의는 **가입 시 딱 한 번** 받는다 — OAuth는 로그인 전 사용자를 식별할 수 없어 구 방식은 "로그인할 때마다" 체크를 강요했다(오너 피드백). 이제 OAuth 복귀 후 `hasConsented()`가 false면 게이트를 띄우고, `#agreeChk`(만14세+약관·개인정보)를 **사용자가 직접 체크해야** `#consentGo`가 열린다. 동의 시 `MONC.recordConsent()`가 `members.agreed_at`·`terms_version`에 기록 → 이후 **어떤 기기에서도 다시 묻지 않음**. 거부 시 `signOut()`. **금지:** 체크박스 사전 체크·"간주 동의"·게이트 삭제. 회원 페이지(`mypage`·`onboarding`)는 `MONC.requireConsent()`로 가드 — 동의 없이 우회 불가. 약관 개정 시 `supabase-config.js`의 `TERMS_VERSION`을 올리면 전원 재동의.
- **동의 마이그레이션** (`20260715120000_member_consent.sql`, owner 실행): `members.agreed_at`·`terms_version` + **`delete_my_account()` RPC**. **미적용이어도 동작** — `getConsent()`가 조회 실패를 감지해 계정별 로컬 기록으로 폴백하고, 나중에 컬럼이 생기면 `hasConsented()`가 서버로 백필한다. ⚠️ `getMyProfile()` 공용 select엔 넣지 말 것(컬럼 미생성 시 프로필 조회 전체가 깨짐 — `major`와 동일 방어).
- **⚠️ 동의 3대 함정(리뷰에서 실제로 터진 것 — 되돌리면 법적 리스크):**
  1. **로컬 동의 캐시는 계정별 키** `monc_consent_v1:<uid>`. 무기명 기기 키로 되돌리면 **공용·가족 기기에서 A의 동의 흔적으로 신규 회원 B가 게이트를 건너뛰고, B 명의의 허위 동의 기록이 서버에 저장**된다.
  2. **거부 = 즉시 파기.** OAuth가 끝나는 순간 `handle_new_user()` 트리거가 `members`(이름·이메일) 행을 만든다 → 게이트에서 '동의하지 않고 나가기'는 `MONC.deleteMyAccount()`로 **계정을 삭제**한 뒤 로그아웃한다(RPC 미적용 시 이름·이메일만 즉시 null로 비우는 폴백). 로그아웃만 시키면 미동의자·만14세 미만의 개인정보가 잔존한다. privacy.html §2가 이 흐름을 고지한다.
  3. **동의 가드는 회원 페이지 전체에.** `mypage`·`onboarding`·`sojae`·`admin` 모두 `MONC.requireConsent()`를 호출한다 — 한 곳이라도 빠지면 주소창으로 게이트를 우회할 수 있다.
- **⚠️ 밖으로 나갔다 뒤로 돌아오는 화면은 상태를 되돌려야 한다(bfcache · 2026-07-24 오너 신고 "카카오 로그인 눌렀다 뒤로가기하니 이지랄"):** 브라우저는 페이지를 떠날 때 문서를 **그대로 얼려 뒀다가 뒤로가기 때 스크립트 재실행 없이 되살린다.** 그래서 '버튼 비활성 + …중 문구'를 띄운 채 외부(카카오/구글 OAuth·결제사)로 나가는 화면은 돌아왔을 때 **죽은 버튼이 그대로 남아 로그인·결제를 다시 할 수 없다.** 모바일은 결제도 리다이렉트 방식이라 `requestPayment`의 promise가 영영 안 끝나 `finally`도 못 돈다 — 스스로 풀리지 않는다. **처리 규칙: 입력값이 없는 화면은 통째로 새로고침**(`login`·`mypage`·`answers`: `pageshow`에 `location.reload()`), **입력값이 있는 화면은 버튼만 되돌린다**(`apply`·`lecture`: 결제 시작 시 `_payRestore` 클로저를 담아 뒀다가 `pageshow`에서 호출 — 이름·전화·선택한 챌린지는 살려야 하므로 reload 금지). 외부로 나가는 버튼을 새로 만들면 이 처리를 같이 달 것.
- `terms.html`, `privacy.html` — footer 법적 페이지. privacy는 실제 스택 기준(수탁자 Supabase 서울/Google/Kakao, 국외이전 고지, CPO 권성호, 14세 미만 조항). 수집 항목·수탁자 변경 시 갱신.
- **`applications` RLS** (`20260711120000_applications_rls.sql`, owner 실행): INSERT 공개(비회원 신청), SELECT 관리자+본인, UPDATE/DELETE 관리자만.

### recruit.js (challenges + 상세 4종 + index 공유)
`loadRecruitData()`(Supabase `challenge_rounds` 단일 소스), `applyIndexRecruit()`(`.ch-card` 상태 칩·흑백·`monc:recruitready` 디스패치 — **2026-07-29부터 카드가 challenges.html에 있어 사실상 그 페이지용**, 이름은 구명 유지), `applyDetailRecruit(id)`(상세 + 마감 시 `.apply-btn` 비활성), `loadChallengeStatuses()`(`window._challengeStatuses`), `applyGlobalRecruitCta()`(index 하단 고정 CTA 바 D-day 뱃지 — index에서 호출하는 유일한 함수). 챌린지 정체성 = `data-recruit-id`(`voice`/`expression`/`spinning`/`answer`), 카드·폴백 전반 일관.
- **⚠️ 데이터 소스는 Supabase `challenge_rounds` 단일(2026-07-23 구글 시트 CSV 폴백 완전 제거 — admin 단일 관리):** `loadRecruitData()`는 `loadRecruitDataFromSupabase()`만 부른다. Supabase에 미등록인 챌린지(예: voice·spinning)나 조회 실패는 그 자리를 비워 두고, 각 호출부(`applyIndexRecruit`/`applyDetailRecruit`/`loadChallengeStatuses`/`applyGlobalRecruitCta`)가 카드의 `data-recruit-start/-end` 어트리뷰트나 `RECRUIT_FALLBACKS`로 폴백한다(전부 null-safe: `data ? data[id] : null` → 폴백). ⚠️ 그래서 Supabase에 일부 기수만 등록된 상태(예: expression·answer만 4기, voice·spinning 미등록)에선 **미등록 챌린지는 하드코딩 날짜로 뜬다 — 올바른 날짜는 admin '모집일정' 탭에서 기수를 등록하면 자동 반영**(코드가 아니라 데이터 문제). **구글 시트/CSV 폴백을 재도입하지 말 것.**
- **⚠️ `applyDetailRecruit`는 로딩 중 날짜를 숨긴다(2026-07-23 오너 "새로고침마다 날짜가 다르게 보인다"):** 구 버전은 `await loadRecruitData()` **전에** HTML 하드코딩 날짜가 그려진 채였다가 원격 도착 후 교체돼, 새로고침 타이밍마다 하드코딩값↔원격값 플래시가 보였다(캐시·최적화 문제 아님, 렌더 순서 문제). 지금은 함수 진입 즉시 chip을 `'모집기간 확인 중…'`(opacity .55)로 덮고, **데이터가 온 뒤에만** 실제 기간을 그린다. ⚠️ 로딩 표시로 chip의 `<strong>`이 사라지므로 도착 후엔 **항상 `innerHTML`을 새로 조립**(구 버전은 `open && dday` 조합에서만 재구성해, 그 외 엣지에서 빈 chip이 됐다). 하드코딩 날짜를 곧바로 표시하는 방식으로 되돌리지 말 것.

### 특강(special_lectures) 시스템 (2026-07-24 신설)
**주기적으로 여는 단발성 특강.** 챌린지(챌린지=코드로 만든 고정 상세페이지 + apply.html 신청)와 **완전히 다른 흐름**: 오너가 admin '특강' 탭에서 등록 → `lecture.html?id=<id>` 템플릿이 그 한 행을 읽어 상세페이지를 그리고 → **상세페이지 안에서 바로** 신청·결제(오너 요청 "신청하기 따로 없이 상세에서 바로"). 승준노트 카드 허브 패턴을 데이터 기반으로 옮긴 것.
- **데이터 = Supabase `special_lectures`(단일 소스)**: `title·subtitle·description·highlights(jsonb)·recruit_start/end(모집=신청 기간, 상태 판정)·lecture_date(진행일)·schedule_text(시간·장소 자유표기)·instructor·price(원, 0=무료)·capacity·thumb_url·visible·sort_order`. 마이그레이션 `20260724120000_special_lectures.sql`(**owner가 SQL Editor에서 실행 필요** — 미실행 시 목록은 에러/빈 상태, 상세는 '찾을 수 없음'으로 **graceful degrade**). 같은 마이그레이션이 `applications.lecture_id` 컬럼도 추가.
- **RLS**: 공개는 `visible=true`만 읽기(anon+authenticated), 쓰기·숨김조회는 admin(`is_admin()`)만.
- **페이지**:
  - `lectures.html` — 허브. `special_lectures`(visible)를 카드로(신청중→예정→마감 순 정렬). `lecture.html?id=`로 이동.
  - `lecture.html` — **동적 상세 템플릿**(코드로 특강별 HTML 만들지 말 것). `?id=`로 한 행 조회 → 히어로·정보카드(일시·강사·신청기간·정원·참가비)·소개·핵심포인트 + **인라인 신청 폼**(이름·전화·**필수 동의**) + **토스결제 버튼 + 계좌이체 버튼**(price 0이면 '무료로 신청하기' 직접 접수). apply.html의 결제 로직을 그대로 옮김.
  - `lecture-common.js` — 두 페이지 공용 순수 유틸(`LEC.esc/status/ddaySuffix/fmtDate/fmtPeriod`). index.html도 홈 특강 섹션용으로 로드.
- **신청 저장 = `applications` 재사용**(관리자 신청자 현황 한곳): `challenges` jsonb에 `[{type:'lecture', lecture_id, name, price}]`, `total_price=price`, `lecture_id` 컬럼. admin `chSummary()`가 `type==='lecture'`면 `📚 이름`으로 표시. 계좌이체·무료는 `applications`에 직접 insert(paid=false, 관리자 확인), 토스는 verify-payment 경유.
  - **신청자 현황 종류 필터(2026-07-24 오너 요청 "챌린지·특강 나눠서, 특강은 특강별로")**: 툴바 아래 2줄 칩 — 1줄 `전체/챌린지/특강`(`_appKind`), 2줄 세부(`_appSub`, 챌린지는 보이스·표현력…, 특강은 특강별). **세부 옵션은 `_apps`에 실제 신청이 있는 값만** 뜬다(신청자 0명인 특강은 안 나옴) — `special_lectures`를 따로 조회하지 않는다. 종류가 하나뿐이면 2줄은 숨는다. 종류를 바꾸면 `_appSub`는 초기화.
  - 특강 판별 `appIsLecture()`는 **행의 `lecture_id`와 `challenges[].type==='lecture'` 둘 중 하나만 있어도** 참(구 데이터 방어). 세부 키는 `lecture_id` 우선, 없으면 이름.
  - **검색창·CSV는 필터 결과를 그대로 따른다** — `visibleApps()`가 종류 필터 + 검색어를 함께 적용하고 렌더·CSV가 같은 함수를 쓴다. CSV 파일명에 현재 필터명이 들어간다(`신청자_대한항공…특강_날짜.csv`).
  - ⚠️ **특강 신청 카드에는 '환급계좌' 줄을 그리지 않는다** — `lecture.html`이 `refund_account`를 아예 안 받아 늘 '미입력'만 떴다(정보량 0). 챌린지 계좌이체 건은 그대로 표시.
- **⚠️ 결제 금액 서버검증 = verify-payment가 특강 금액을 DB에서 재확인**: 특강마다 금액이 달라, `lecture.html`은 `functions.invoke('verify-payment', {lectureId, applicant})`로 호출하고 edge function이 `special_lectures`에서 `price`를 읽어 `expected`로 쓴다(브라우저가 보낸 금액 불신). **이 함수는 owner가 재배포해야 특강 결제가 동작**(2026-07-24 배포 완료 — `lecture_not_found` 응답으로 확인). 챌린지 경로(`challenges` 배열 → `list.length*30000`)는 그대로 유지.
  - **⚠️ Edge Function 배포는 CLI가 아니라 Supabase 콘솔에서 한다** — 오너 PC에 `supabase` CLI가 없다(2026-07-24 확인). **`supabase functions deploy …` 명령을 안내하지 말 것.** 경로는 `Supabase 대시보드 > Edge Functions > <함수명> > 코드 전체 교체 > Deploy`(Verify JWT 설정은 기존값 유지). cancel-payment·verify-payment 모두 이 방식으로 배포됐다.
  - **배포된 버전 확인법**(결제 생성·DB 쓰기 없는 안전한 프로브): `POST /functions/v1/verify-payment` 에 `{paymentId:'probe', lectureId:'00000000-0000-0000-0000-000000000000', applicant:{name:'x',phone:'0'}}` 를 anon key 로 던져 본다. `lecture_not_found`=특강 지원 버전, `bad_request`=특강 이전 구버전, 404=미배포.
- **⚠️ 잔여석 자동 카운팅(2026-07-24 신설 · migration `20260724150000_lecture_seat_counting.sql`, owner 실행 필요):** **`capacity`(정원)가 원장, `seats_left`(잔여석)는 파생 캐시**다. `applications` 트리거가 신청이 들어올 때마다 `잔여석 = 정원 − 신청건수`로 **재계산**한다(차감 −1이 아님 — 값이 어긋나도 진실로 복구되고, admin이 신청을 지우면 자리가 자동으로 돌아온다). **정원이 NULL인 특강은 트리거가 손대지 않는다**(구 수동 운영 유지).
  - **왜 브라우저가 아니라 DB 트리거인가:** 특강 신청 경로가 셋(무료 직접 insert / 계좌이체 직접 insert / 토스결제→verify-payment)인데 전부 `applications` insert로 수렴한다. 반대로 브라우저가 잔여석을 UPDATE하게 하려면 `special_lectures` 쓰기 정책을 열어야 하고, **그러면 누구나 잔여석을 조작**할 수 있다(현재 쓰기는 `is_admin()`만). **클라이언트에서 잔여석을 update하는 방식으로 되돌리지 말 것.**
  - **정원 초과 차단**: BEFORE INSERT 트리거가 꽉 찬 특강 신청을 `errcode MC001`(message `lecture_full`)로 거부한다. ⚠️ **`select … for update` 행 잠금이 핵심** — 없으면 마지막 한 자리를 두 사람이 동시에 통과한다(각자 count를 세는 순간엔 둘 다 여유가 있으므로).
  - **⚠️ 결제 후 마감 = verify-payment가 전액 자동 환불**: 결제 승인과 저장 사이에 자리가 나가면 insert가 MC001로 막히므로, edge function이 포트원 취소 API로 전액 환불하고 `refunds`에 이력을 남긴 뒤 `{ok:false, error:'lecture_full', refunded}`를 돌려준다. **이때만 HTTP 200으로 답한다** — supabase-js `functions.invoke`는 non-2xx면 `data`를 null로 만들고 본문을 `error.context`에 숨겨서, 브라우저가 '환불됐다'는 안내를 띄울 수 없다. `refundAll()`은 실패해도 예외를 던지지 않고 false를 반환(사용자에겐 고객센터 안내).
  - **lecture.html**: 결제창을 띄우기 **전에** `ensureSeatOpen()`이 최신 잔여석을 다시 읽어 마감이면 결제를 시작하지 않는다(환불 상황 자체를 줄인다). 신청 성공 뒤엔 `afterApplied()`가 화면을 다시 그려 줄어든 숫자를 바로 보여준다. ⚠️ **재렌더는 반드시 `rerender()`로** — `render()`는 신청 폼을 통째로 다시 만들어 회원 자동입력이 날아간다(`initMember()` 재실행 필요). 같은 이유로 `document` keydown 리스너는 `wireApply()` 밖에서 **한 번만** 건다(재렌더마다 쌓임).
  - **admin '특강' 탭**: 잔여석은 **입력칸이 아니라 읽기 전용 표시**(`.lf-seats`, `renderSeatsInfo()`). 관리자가 넣는 값은 정원뿐. ⚠️ 저장 payload에 **`seats_left`를 넣지 말 것** — 파생값이라 덮으면 실제 신청 수와 어긋나고, 마이그레이션 미적용 환경에선 기존 수동값을 지운다(그래서 null로 미는 것도 금지, 아예 빼는 게 맞다). 신청자 현황에서 특강 신청을 삭제하면 `loadLectures()`로 잔여석을 다시 읽는다.
  - 마감 문구는 **'정원 마감'(자리가 참) / '신청 마감'(기간 종료)**으로 나눈다 — 카드·배지·안내문·하단바 전부. 구 '신청 마감 · 마감' 중복 표기로 되돌리지 말 것.
  - 미적용 시 degrade: 잔여석이 자동으로 안 줄어들 뿐 신청·결제는 정상(트리거가 없으니 초과 차단도 없음).
- **⚠️ 시간대(`lecture_slots`) — 같은 특강을 여러 날·여러 타임으로(2026-07-24 신설 · migration `20260724160000_lecture_slots.sql`, owner 실행 필요):** 특강은 소개·사진·가격·항공사를 갖고, **정원·잔여석·마감은 타임마다 따로** 센다. 신청자는 상세페이지에서 시간대를 골라 신청(`applications.slot_id`).
  - **⚠️ 핵심 = 롤업(이걸 모르면 정원이 이상하게 보인다):** 슬롯이 하나라도 있으면 트리거가 특강의 **`capacity`=슬롯 정원 합계, `lecture_date`=최초 슬롯 날짜**로 자동으로 덮는다. 덕분에 카드·정렬·마감판정·잔여석 표시 **기존 코드가 그대로 동작**하고(특강 잔여석 = 전체 합), 슬롯 없는 특강은 종전과 100% 동일. → **슬롯이 있으면 admin '정원' 입력칸은 잠긴다**(손으로 넣어봐야 합계가 덮어쓴다). ⚠️ 그래서 저장 payload에서 **슬롯이 있으면 `capacity`를 아예 빼야 한다** — null로 밀면 롤업값이 지워지고 다음 슬롯 변경 전까지 특강 잔여석이 사라진다.
  - **⚠️ 슬롯 트리거는 `update of capacity, lecture_id, slot_date`로 좁혀야 한다** — 그냥 `update`면 재계산이 `seats_left`를 쓰는 순간 자기 자신을 다시 불러 무한 재귀에 빠진다(값이 같아도 Postgres는 트리거를 또 쏜다).
  - **정원 초과 차단**은 슬롯 우선 → 특강 합계 백스톱 2단(둘 다 `errcode MC001`). 잠금 순서는 **항상 '슬롯 → 특강'**(교착 방지, 롤업 함수도 같은 순서). 합계 백스톱은 모든 타임이 꽉 찼을 때만 걸린다(per-slot 가드가 있어 총합이 정원을 넘을 수 없으므로 오탐 없음).
  - **`lecture.html`**: `SLOTS`/`_slotId` 전역. 슬롯 있으면 신청 폼 위에 라디오 카드(`#slotPicker`, 마감 타임은 disabled+흐림), **미선택 시 `readApplicant()`가 차단**. 타임이 **하나뿐이면 자동 선택**하고 여럿이면 절대 임의 선택하지 않는다(되돌리기 어려운 선택). 품절 판정은 `SLOTS.every(slotFull)`. 신청이 닫힌 상태(예정·마감)에선 폼이 없어 시간대를 볼 데가 없으므로 본문에 읽기전용 목록을 따로 그린다. 모바일 결제 복귀용 `sessionStorage`에도 `slotId`를 함께 담는다(페이지가 새로 뜨므로).
  - **`lecture-common.js`**: `fmtTime/slotWhen/slotShort/slotFull/sortSlots/attachSlots`. 카드는 `l._slots`가 붙어 있을 때만 `7월 24일(금) · 3개 타임`(날짜가 갈리면 `… 외 · N개 타임`). ⚠️ `attachSlots`가 **별도 조회**인 이유: `select('*,lecture_slots(*)')` 조인은 마이그레이션 미적용 환경에서 **목록 조회 전체를 400**으로 만든다. 실패하면 조용히 넘어가 카드가 진행일 한 줄로 그려진다.
  - **admin '특강' 탭**: 폼 안에 시간대 편집기(행: 날짜·시작·종료·정원·메모 + 잔여 표시). 저장은 `특강 저장 → saveSlotRows(삭제→수정→추가)` 순이고, **새 특강은 insert에 `.select('id')`를 붙여 id를 받아야** 슬롯을 붙일 수 있다. ⚠️ `exitLectureEdit()`에서 **`_slotRemoved`를 반드시 비울 것** — 안 비우면 '수정 중 시간대 삭제 → 취소 → 새 특강 추가'에서 남은 id로 **남의 시간대를 지운다**. `admin.html`은 이걸 위해 `lecture-common.js`를 로드한다.
  - **`verify-payment`**: `slotId`를 받아 **그 특강 소속인지 서버가 재확인**(다른 특강의 시간대를 밀어넣어 남의 자리를 잡는 걸 막는다). 신청자 현황 표시용으로 `challenges[].slot`도 서버가 채운다.
  - **슬롯을 전부 지우면** 롤업이 `v_cnt=0`이라 손대지 않아 마지막 합계 정원이 남는다(입력칸은 다시 열리므로 관리자가 수정하면 된다).
  - 미적용 시 degrade: 조회가 실패해 편집기·선택 UI가 안 뜨고 종전 '일정 하나짜리 특강'으로 동작.
- **⚠️ 법적 필수**: 상세 신청 폼의 `#appConsent`(만14세+개인정보 수집·이용) 미체크 시 `readApplicant()`가 차단 — 삭제·완화 금지(apply.html과 동일 규정).
- **입구(2026-07-29 갱신)**: nav '특강'(**index·researchers·challenges 3파일 하드코딩 + 모바일 메뉴 — 변경 시 동기화**, 챌린지 드롭다운 바로 뒤) + 홈 '특강 문'(.doors — 공개 특강 있을 때만 노출, 위 '랜딩 섹션 순서' 참조). 구 홈 `#lectures-home` 카드 섹션은 2026-07-29 삭제(index는 이제 lectures.css·lecture-common.js를 로드하지 않는다).
- **admin '특강' 탭**: `special_lectures` CRUD(모집일정 탭과 같은 `.round-form`/`.round-list` 패턴). 항공사 select + 정원 입력(잔여석은 자동 표시 — 위 '잔여석 자동 카운팅' 참조). `loadLectures()`가 초기화 시퀀스에 포함.
- **⚠️ 카드 디자인 = `lectures.css` 단일 소스 + `LEC.cardHtml()` 단일 빌더(2026-07-24 스펙):** 특강 카드는 lectures.html·상세 eyebrow **공용**(구 홈 `#lectures-home`은 2026-07-29 삭제)이라, 스타일은 `lectures.css`, 마크업은 `lecture-common.js`의 `LEC.cardHtml`/`skeletonHtml` 한 곳에서만 관리한다(제각각 방지 — 페이지별 인라인으로 만들지 말 것). 두 파일 모두 `<link lectures.css>` + `lecture-common.js` 로드.
  - **핵심 규칙(오너 스펙 — 어기면 "가족처럼 안 보인다"):** ① **사진 없는 카드의 커버 배경(`--lx-cover #E4DDC9`)은 전부 동일** — 항공사별로 바꾸지 말 것. ② 항공사별로 바뀌는 건 **영문 사명 색**과 **커버 하단 1px 룰 색** 둘뿐(둘 다 `--lx-accent`). ③ **한글 제목은 항상 네이비**(`--lx-navy #1B2E4E`, 500). ④ 굵기는 **400·500만**. ⑤ **그림자·글로우·리프트 금지** — hover는 테두리만 진하게(사진 페이드용 그라디언트는 아래 예외). ⑥ 항공사 로고 이미지 금지(영문명 텍스트 조판). ⑦ 커버 패턴·텍스처 금지.
  - **⚠️ 사진 커버(2026-07-24 오너가 목업 4종 중 ③ 선택 — `outputs/lecture-card-image-mockup.html`):** `thumb_url`이 있으면 카드에 `.has-shot`이 붙어 커버가 **사진 + 아래로 갈수록 아이보리(#FBF9F4)에 녹아드는 그라디언트**가 된다. 사진이 없으면 위 ①의 아이보리 커버 그대로(폴백) — 사진을 준비 못 한 특강도 카드가 안 깨진다. 통일감은 '커버가 전부 같은 색'이 아니라 **'모든 사진에 같은 페이드 처리'**로 지킨다(자르는 위치도 `center 34%`로 통일).
    - **⚠️ 페이드는 커버 높이의 %가 아니라 `.lx-txt` 블록에 px로 건다.** %로 걸면 제목 줄 수에 따라 글자가 앉는 높이가 달라져(2줄 45%·3줄 35%) 어떤 카드는 반투명 구간에 글자가 얹힌다 — 실제로 항공사 영문명이 이 때문에 흐렸던 자리. 글자 블록 기준이면 줄 수와 무관하게 **위 46px에서 페이드가 끝나고 글자는 늘 불투명 위에** 앉는다.
    - **⚠️ `.lx-ko`는 2줄 클램프 + 커버 `padding-top:88px`(모바일 96px) 한 쌍.** 클램프가 없으면 3줄 제목이 글자 블록을 220px까지 키워 **사진이 32px만 남는다**(사진을 넣은 의미가 사라짐). padding-top은 '사진이 최소 이만큼은 보인다'는 약속이라 `min-height`만으로 대체 불가 — 긴 제목에서 글자가 커버를 다 먹는다. 전체 제목은 상세페이지에 나오므로 카드에서 잘려도 된다.
    - **⚠️ `.lx-cover > *`로 뭉뚱그려 `position:relative`를 주지 말 것** — 배지가 `absolute`인데 덮여서 자리가 무너진다. `.lx-txt`에만 준다. 배지는 사진 위에 뜨므로 `.has-shot`에서 **불투명 알약 + 실선 테두리**(흰 배경 사진 위에서 흰 알약이 사라지는 걸 막는다).
    - **⚠️ backdrop-filter 유리 패널 방식은 검토 후 폐기** — 블러가 뒤 사진을 완전히 뭉개 목업 ④안(사진/글자 분리)과 똑같아 보였고, 구형 아이폰 지원이 불안정한 데다 카드 수만큼 블러 레이어가 생긴다. 재도입 금지.
    - `LEC.shotUrl()`이 주소를 검사한다: 스킴이 붙어 있으면 http(s)·`data:image`만 통과(`javascript:` 차단), 스킴이 없으면 `images/foo.webp` 같은 사이트 안 경로로 보고 허용. CSS `url("…")`에 넣을 수 있게 역슬래시·따옴표를 이스케이프한 뒤 호출부에서 `esc()`로 한 번 더 감싼다.
  - **사진 첨부 = Storage `lecture-images` public 버킷**(migration `20260724140000_lecture_images_bucket.sql`, **owner 실행 완료 2026-07-24 — 다시 실행 안내 금지**). admin '특강' 탭에서 파일을 고르면 **후기와 같은 압축 루틴(`optimizeReviewImage`)**을 거쳐 업로드되고, `thumb_url`엔 **공개 URL 전체**가 들어간다(경로가 아니라 — 그래야 외부 주소 붙여넣기도 계속 동작). 버킷 미생성 시 업로드가 실패하며 폼이 마이그레이션 파일명을 안내한다. ⚠️ 원본을 그대로 올리면 목록 한 번에 20MB가 넘어 데이터 환경에서 카드가 한참 뒤에 뜬다 — 압축을 우회하지 말 것.
  - **⚠️ 사진 크기 기준(2026-07-24 실측):** 카드 커버 표시폭은 **모바일 1열이 가장 크다(597×264)** — 3열 331×273, 2열 291×273. 상세 `.lc-cover`는 **680×340**(container 720−padding 40, `max-height:340` + `object-fit:cover`). 고해상도 화면 2배를 감안해 `optimizeReviewImage(file, **1280**)`로 특강만 상한을 올렸다(후기는 세로 스크린샷이라 기본 1080 유지 — 인자 없이 호출). **1080으로 되돌리지 말 것**: 상세 680×2=1360에 한참 못 미쳐 큰 화면에서 뭉개진다. 더 올리면(1440+) 목록 6장에 900KB를 넘어 데이터 환경에서 손해가 이득보다 크다.
  - **⚠️ 카드에서 선명하게 보이는 건 사진 위쪽뿐**(`background-position: center 34%` + 아래는 아이보리 페이드에 덮임): 실측상 원본 세로의 **약 7~43% 구간**만 노출된다. 상세는 위아래 5%씩만 잘려 거의 전체가 보인다.
  - **권장 원본 = 1600×900(16:9).** 세 자리의 표시 비율이 제각각(상세 2:1 · 폰카드 2.26:1 · 컴3열 1.21:1)이라 어떤 비율을 줘도 어딘가는 잘린다 — cover 규칙으로 계산한 **잘림률이 16:9에서 가장 낮다**(평균 21% / 3:2 26% / 4:3 28%). 세로 잘림은 `center 34%`라 위쪽이 남고 가로 잘림은 `center`라 좌우 균등 → 운영 안내는 **"인물을 가로 가운데·세로 위쪽에"**. 이 문구는 admin 폼의 `.lf-thumb-spec`에 고정 노출된다(업로드 상태 메시지 `.lf-thumb-msg`와 별개 — 상태가 바뀌어도 안 사라진다).
  - **항공사 액센트 = `lectures.css`의 `--air-<code>` 변수**(ke/lj/7c/tw/ze/yp/rf). 카드는 `style="--lx-accent:var(--air-<code>)"`로 주입, 영문명은 `LEC.AIRLINES[code].en`. 값은 스펙 시작값을 **아이보리 커버 위 4.5:1 이상**으로 미세조정(7C·LJ·RF 소폭 하향) — 공식 CI로 추후 조정 가능. 항공사 미지정(null) = 영문명 없이 기본 네이비.
  - **⚠️ 가격 = 정보부 맨 아래 `.lx-price` 한 줄(2026-07-24 오너가 목업 3안 중 A안 선택 — `outputs/lecture-card-price-mockup.html`):** `참가비` 라벨(14px) + 금액(20px 네이비 500), 위에 1px 구분선. 커머스 카드 표준 위치(무신사·29CM·클래스101)라 "정보를 읽고 가격에서 끝맺는" 흐름이 된다. **⚠️ 구 커버 우상단 `.lx-badge` 알약은 폐기 — 되살리지 말 것**(시선은 큰 제목부터 가는데 가격은 반대쪽 구석 11px 회색이라 끝까지 눈에 안 걸렸다). **무료도 이 줄 하나로만 말한다**(`무료` 초록 #2E6E42) — 배지를 남기면 무료가 위아래로 두 번 나온다(오너 지적).
  - **⚠️ 정보부 활자 하한 14px + 대비 4.5:1(2026-07-24 오너 "9대 원칙 위배"):** 구 메타 13px·참가비 라벨 12.5px·배지 11px 이 원칙 1번(최소 12pt) 미달이었다. 메타·라벨은 **14px**(사이트 `--fs-caption`), 커버 영문 사명만 12→**13px**(라틴 대문자 브랜드 마크). 메타 보조색 `--lx-metac` 도 구 `#7A756C` 가 아이보리(#FBF9F4) 위 **4.35:1 로 원칙 4번 미달**이라 **`#736E64`(4.82:1)** 로 낮췄다 — 더 밝게 되돌리지 말 것. (실측 대비: 소개 8.9 / 메타·라벨 4.82 / 금액 12.9 / 무료 5.83)
  - **잔여석**: `<=5` 텍스트만 액센트 강조, `0`이면 '정원 마감'+카드 `opacity:.55`+상세 신청 차단(품절=마감 취급). 값은 신청마다 DB 트리거가 자동 계산(위 '잔여석 자동 카운팅'). **반응형** 3열(≥1024)/2열/1열(<640, 제목 24px).
  - 상세페이지(lecture.html)도 같은 계열: 항공사 영문명 eyebrow(`--lx-accent`) + **네이비 제목**(구 코랄에서 전환) + 잔여석 fact. hero는 `root.style.setProperty('--lx-accent', …)`로 페이지 전역 지정.
  - ⚠️ 목록·홈 조회는 **`select('*')`** — airline·seats_left 마이그레이션(`20260724130000`) 미적용 환경에서 컬럼 지정 시 조회 전체가 400나므로. 미적용 시 브랜딩만 빠지고 카드는 뜬다.
  - 스켈레톤 커버는 **190px** — 사진 커버(252px)와 기본 커버(약 130px)의 중간값이라 로딩이 끝날 때 카드가 덜 튄다.

### 랜딩 섹션 순서 — 2026-07-30 C안 서사(오너 확정 · `outputs/home-story-v2-mockup.html`의 C안 + B안 칩 장치가 결정 기록, 기각안 A·B도 그 파일에 보존)
창문 인트로(유지) → **① 막막함(`.msn`, `id="home"`)** → **② 열 가지 → 세 가지(`.sortsec`)** → **③ 세 개의 문 = 타임라인(`.doors`)** → **④ 숫자(`.nums`)** → **⑤ 마무리 CTA(`.closing`)**. 오너가 제공한 목업(`monc_why_mockup_v3`)의 WHY MONC 내용을 현재 홈에 얹으며 재구성한 것으로, **감정 → 정리 → 순서 → 근거 → 마무리** 다섯 박자다. 구 7/29 순서(미션+숫자 → 문 → CTA)를 대체한다.
- **① 막막함**: 라벨 Why MONC + "혼자 준비하는 시간이 막막하지 않도록." + 리드 + **질문 카드**(`.worry` — "그래서 저는 지금 뭘 준비해야 하나요?"). **⚠️ `id="home"`이 이 섹션에 있다** — 하단 CTA 바 '몬크 더 알아보기'(.is-browse) 착지점·footer '서비스 소개'·`hero_reached` 계측이 전부 이 앵커를 보므로 **인트로 직후 첫 섹션에서 옮기지 말 것**.
- **② 열 가지 → 세 가지**("혼자하면 막막하지만, 몬크와 함께하면 **간결합니다**." — 2026-07-30 오너 문구): 칩 10개(자기소개서·보이스·스피치·이미지연출·기업분석·카메라연출·필수기출·롤플레잉·영어인터뷰·멘탈관리 — **오너 확정 목록**)가 0.28초 간격으로 하나씩 체크된 뒤, **같은 칩이 제자리에서 세 그룹으로 날아가 붙는다**(FLIP). `data-g` 1=승준노트 2=챌린지 3=특강 → **③의 문 순서와 같다**. ⚠️ 칩 나열 순서는 일부러 섞여 있다(그룹 순으로 늘어놓으면 '정리되는 순간'이 안 보인다). ⚠️ 그룹 제목은 문 이름과 **글자 그대로 같아야** 방금 정리한 세 덩어리가 아래 세 문과 같은 것으로 읽힌다. ⚠️ **한 번만 실행**(`io.disconnect`) — 되감기를 넣으면 스크롤을 오르내릴 때마다 글이 다시 움직인다. ⚠️ reduced-motion·구형에선 이동 없이 결과 화면만 성립한다(요점은 '칩이 움직였다'가 아니라 '열 개가 세 덩어리가 됐다'). ⚠️ `.sort-pool[hidden]{display:none}` 가드 필수 — `display:grid`가 UA `[hidden]`을 이긴다(`.door[hidden]`과 같은 함정).
- **③ 세 개의 문 = 타임라인**: **매일(승준노트→`briefing.html`) → 2주(챌린지→`challenges.html`) → 면접 직전(특강→`lectures.html`)**. 각 문 위에 `.tl-when` 라벨 + 앞 카드와 잇는 짧은 세로선(`.tl-step + .tl-step::before`)이 붙어 나열이 순서가 된다. **⚠️ 문 순서가 구 스케치(챌린지→승준노트→특강)와 다르다** — 되돌리면 ②의 그룹 순서·타임라인 라벨과 전부 어긋난다. 사진 카드가 좌우로 번갈아 붙는 리듬은 유지(2번째만 `rev`). **⚠️ 카드 자리는 반드시 사진**(텍스트 목록·미니 UI 덩어리는 오너 2회 기각). 사진 3장은 **샘플 — 최종본 오면 교체**. ⚠️ 특강은 `#doorLecture`(=`.tl-step`)가 `hidden` 시작, 공개 특강이 있을 때만 JS가 켠다 — **C안을 고른 이유 중 하나가 이것**으로, 문이 하나 빠져도 '매일 → 2주'만으로 순서가 성립한다. `.tl-step[hidden]`·`.door[hidden]` 가드 둘 다 유지. 문 칩은 **실데이터만**(승준노트 = 오늘 news_articles count, 특강 = 가장 임박한 신청중 특강 D-n) — 숫자를 꾸며내지 않는다.
  - **⚠️ 문 설명줄(`.dr-ds`)의 `&nbsp;`를 지우지 말 것(2026-07-30).** 이 칸은 375px에서 **실측 155px**뿐이라 `<br>`로 잡은 두 줄이 네 줄로 풀린다. 그때 nbsp가 없으면 '답변 / 소재까지'·'필요한 / 내용을'처럼 한 덩어리가 갈라지고 낱말 하나가 혼자 한 줄에 남는다. 데스크톱(글 칸 440px)에선 nbsp가 있어도 그대로 두 줄이라 손해가 없다. **문구를 길게 고치면 375px에서 어디가 갈라지는지 다시 볼 것.**
  - ⚠️ **폭의 주인은 `.tl-step`**(문이 타임라인 칸 안으로 들어갔다). `.door`에도 `max-width`가 남아 있으면 좁은 쪽이 이겨 큰 화면에서 카드가 안 커진다 — `.door`는 `max-width:100%`로 칸을 채우기만 한다.
  - ⚠️ 타임라인 라벨·연결선은 카드 **바깥 가운데**다. 왼쪽 레일(세로줄+점) 방식은 375px에서 카드 폭을 26px 잡아먹어 사진이 눈에 띄게 좁아진다(실측).
- **④ 숫자**: **2만 준비생 · 350여 명 합격 · 0.18% 가능성**(오너 확정 값, 출처 대응은 오너 몫) + "이 숫자를 바꾸는 건 준비한 시간입니다." 카운트업 1회(`#numStats`). **⚠️ 숫자는 삭제된 게 아니라 ①에서 여기로 이사한 것** — 감정 뒤에 사실이 와야 더 세게 읽힌다는 것이 C안의 전제다.
- **⑤ 마무리 CTA**: "국내 최초 온라인 승준 플랫폼, **몬크ON** 시작하기" + **버튼 2개**(왼쪽 '온라인 챌린지 시작하기'→`challenges.html` / 오른쪽 '나만의 승준로그 채우기'→`briefing.html`) + '이미 회원이라면 로그인'. 2026-07-30 오너 지시로 구 수미상관 문장·단일 버튼(→apply.html)에서 교체.
  - **⚠️ 버튼 둘의 무게가 다르다**: 왼쪽=돈 내고 시작하는 상품(흰 알약), 오른쪽=무료로 매일 채우는 도구(테두리 버튼). 둘 다 흰 알약으로 만들면 어디를 눌러야 할지 알 수 없다. ⚠️ `.closing-btn`의 **투명 1.5px 테두리를 지우지 말 것** — 고스트 쪽에만 테두리가 있으면 나란히 놓였을 때 높이가 3px 어긋난다(실측).
  - 375px에선 세로로 쌓고 480px부터 나란히 — 실측상 알약 하나가 195px이라 나란히 두려면 400px이 필요한데 375px 화면의 콘텐츠 폭은 335px뿐이다.
  - ⚠️ 다크 무대라 '몬크ON' 강조는 **`--action-on-dark`(밝은 하늘 블루)** 다. 네이비(`--accent`)는 이 배경에서 묻힌다.
  - ⚠️ 오너 지시로 목업의 **MONC PROMISE 3단 목록(01 오늘 할 일을 찾고 / 02 직접 연습하고 / 03 다시 나아가도록)은 넣지 않는다** — 다시 넣지 말 것.
- **⚠️⚠️ 홈 팔레트 = 딥 네이비 on 웜 페이퍼(2026-07-29 오너 확정 · 목업 `outputs/home-color-mockup.html` B안이 결정 기록, 기각안 A·C도 그 파일에 보존)**: 오너 지시 *"폰트에 색을 너무 많이 추가한 것 같다 / 오렌지는 탈피 / 첫 이미지처럼 깔끔·단정하게"*. **`index.css` 최상단 `:root` 오버라이드**가 단일 소스 — `--action`·`--accent`·`--accent-dark`·`--accent-ink`를 **전부 `#1B3A6B` 한 값으로 모았다**(세 단계로 나뉘어 있으면 자리마다 다른 채도가 섞여 다시 산만해진다). 배경도 `--bg #FBF9F5` / `--bg2 #F4F1EA`로 밝고 채도를 낮췄고, 다크 무대 `--bg-dark`는 갈색에서 잉크 네이비 `#1C2A3A`로.
  - **⚠️ 액센트는 세 자리만 — 라벨 · 숫자 3개 중 '가능성' 하나 · 링크.** 개편 전엔 오렌지 하나가 홈 스토리 영역에만 9자리(라벨 대시·라벨·숫자·"가능성"·문 링크 3개·칩·"옵니다"·버튼)에 쓰여 강조가 너무 많아 아무것도 강조되지 않았다. **새 색을 자리마다 늘리지 말 것.** "가능성" 강조는 색이 아니라 **밑줄**(`box-shadow: inset`)이다 — 색으로 칠하면 라벨·링크와 같은 색이 문장 한가운데 또 나온다.
  - **⚠️ `--action-ink`를 다크로 되돌리지 말 것** — 구 `#2A1206`은 '오렌지 배경 위 다크 글씨'로 대비를 맞추려던 값이다. 네이비 배경엔 흰 글씨(10:1). 반대로 **마무리 CTA 버튼은 흰 알약 + 네이비 글씨**여야 한다(다크 네이비 무대 위 네이비 버튼은 1.2:1로 안 보인다).
  - **2026-07-29 같은 날 전 사이트로 확장 완료**(오너 지시) — 팔레트 본체는 `tokens.css`에 있고, `index.css`의 `:root`엔 **홈에만 필요한 값**(`--ink`·다크 무대·테두리)만 남는다. 인트로 태그라인도 `--ht-mark`로 전환. 전 사이트 규칙은 위 'Design system' 항목 참조.
  - **⚠️ 승준노트 문(`.door.rev`)은 글도 오른쪽 정렬**(2026-07-29 오너 지적 "승준노트이 변칙인데 왜 텍스트는 왼쪽 정렬이냐"). 사진이 왼쪽·글이 오른쪽인 카드라, 왼쪽 정렬로 두면 글 블록 오른쪽에 빈 띠가 남아 카드가 한쪽으로 쏠려 보인다. 라벨 대시(`::before`)와 링크 화살표는 inline 요소라 자동으로 따라간다.
  - **⚠️ 미션 섹션은 밝은 종이(구 다크 무대) · 세 개의 문은 테두리 있는 흰 카드**(오너 요청). 문 카드가 박스가 되면서 **구 '모바일 사진 블리드 + 카드마다 다른 높이·글 시작점' 구도는 폐지** — 블리드로 되돌리지 말 것(세 개가 같은 급의 '문'으로 묶여 보이는 것이 요청의 목적). 다크 무대는 **마무리 CTA 한 곳뿐**.
  - **⚠️ 구 `nav.nav-transparent`(인트로 구간 투명 nav + 흰 글씨)는 CSS·JS 모두 삭제.** 인트로가 밝은 종이색이 된 뒤로 흰 글씨가 배경에 묻혔다(대비 약 1.1:1). 되살리려면 인트로 배경부터 어둡게 돌려야 한다.
- **⚠️⚠️ CSS 주석 안에서 클래스 이름을 슬래시로 나열하지 말 것 — 별표 뒤에 슬래시가 오면 주석이 그 자리에서 닫힌다.** 2026-07-29 스토리 개편 때 섹션 주석에 `hero-scene`·`hs-`·`ch-` 계열을 슬래시로 이어 적으며 별표+슬래시가 생겼고, 주석이 조기 종료되면서 뒤따르던 구분선 종료 기호가 문법 오류가 되어 **파서가 바로 다음 규칙인 `.msn { … }`을 통째로 삼켰다.** 결과: 미션 섹션에 배경이 안 깔린 채 제목·브릿지만 다크용 밝은 글씨로 남아 **베이지 배경에 흰 글씨**가 됐다(오너 신고 "배경에 흰색 글씨라 안 보인다"). 규칙 하나가 조용히 사라지는 종류의 오타라 눈으로는 안 잡힌다 — **CSS를 크게 손댔으면 주석 짝(`/*`/`*/`) 균형을 한 번 세어 볼 것.**
- **⚠️ `footer` 스타일도 같은 개편에서 통째로 날아가 있었다**(2026-07-29 복구). 규칙이 하나도 없어 링크가 **브라우저 기본 파란 밑줄 `#0000EE`**로 떴다 — 사이트 어디에도 없는 색이라 홈 맨 아래에서만 튀었다. 지우지 말 것.
- **⚠️ 데스크톱(≥1024px) — 스토리 컬럼 확대(2026-07-29 오너 "웹인데 따닥따닥")**: 구조는 그대로 두고 폭·활자만 큰 화면 급으로 올린다(미션 560→720px, 문 640→900px, 문 제목 20→28px·설명 15→17px). 개편 직후엔 브레이크포인트가 720px 하나뿐이라 **1440px에서도 375px 모바일 값이 그대로 떴다** — `clamp()`가 미션·마무리 제목에만 걸려 있어 문 섹션은 아예 커지지 않았다. ⚠️ **문 3개를 3열 카드로 펼치지 말 것(오너 기각)** — 좌우 교차 리듬이 이 섹션의 구도이고, 3열이면 challenges.html 카드 목록과 구분이 사라진다. ⚠️ `.door`의 `max-width`는 `min(900px, calc(100% - 96px))` — 고정값이면 브레이크포인트가 시작되는 1024px에서 좌우 여백이 거의 안 남는다(실측). ⚠️ 문 카드 사진은 `position:absolute`여야 한다 — 카드가 글 높이에 맞춰 늘어나는 구조(`align-items:stretch`)라 img가 흐름에 있으면 자기 높이로 카드를 밀어버린다.
- **홈에서 삭제된 것(2026-07-29 오너 확정 "깔끔하게")**: 구 #pillars(세 개의 문 카드) · 히어로 챌린지 카드 목록(→challenges.html 이사) · Before&After(증거는 각 상세가 담당) · #briefing-home · #lectures-home · 연구진 스트립 · 커뮤니티(후기는 reviews.html) · **파인더(#advisor — 존치 계측 중이었으나 개편에 포함해 삭제, 오너 승인)** · 블라인드 퀴즈(→blind-quiz.js로 보신각·스피닝 상세 이사) · 성장기록 · 구 .cta-box. index.html 2979→1354줄, index.css 2006→673줄.
- **계측**: `pillar_challenge/lecture/briefing`(문 3개, pointerdown)은 유지 — 구 pillars와 이벤트명이 같아 기준선이 이어진다. `briefing_go`/`lecture_go`/`advisor_*`/`hero_ab_*` 리스너는 대상 소멸로 제거. `hero_reached`는 이제 '미션 섹션 도달'을 뜻한다(앵커 동일 — 인트로 이탈률 지표로서 연속성 유지).
- **nav(2026-07-29)**: '커뮤니티' 메뉴 삭제(섹션 소멸 — researchers.html의 `index.html#community` 링크도 함께 제거). '챌린지' 드롭다운·모바일 아코디언 첫 항목에 '챌린지 한눈에'(→challenges.html) 추가. ⚠️ nav 마크업은 **index·researchers·challenges 3파일 하드코딩 — 변경 시 셋 동기화.**
- **⚠️ nav 활자 크기(2026-07-30 2차 — 오너 "크기가 너무 크지 않니")**: 메뉴 21→**17px** · 신청하기 21→**16px** · 로그인 18→**15px** · 로고 30→**26px** · 드롭다운 18/15→16/14px · 메뉴 gap 26→24 · 두 버튼 사이 12→10 · 세로 여백 12→11px → **바 높이 73→66px**(모바일 57px 그대로). 자간 -0.015em 유지. ⚠️ **CSS도 3파일(index.css·researchers.html·challenges.html) 동기화 대상**이다.
  - **⚠️ 같은 날 1차로 14→21px 로 올렸다가(오너 "너무 작다") 되돌린 게 아니라 중간에 앉힌 것이다.** 21px 은 본문 17px 은 물론 소제목 `--fs-h3`(20px)보다 커서 **껍데기인 nav 가 내용보다 크게 읽혔다**(9대 원칙 6번 계층 구조 위배). 17px = 본문과 같은 급이고 12pt(16px) 하한도 넘는다. **14px 로 다시 내리지도, 20px 위로 올리지도 말 것.**
  - **⚠️⚠️ `.nav-inner`는 `auto auto 1fr` — 메뉴를 가운데 두려는 시도는 두 번 다 실패했으니 되돌리지 말 것.** ① `1fr auto 1fr`(화면 정중앙) → 메뉴가 버튼에 들러붙음 ② `auto 1fr auto`(로고·버튼 사이 정중앙, 양옆 150px 균등) → 그래도 "정렬 좀 잘 해봐라". 원인은 같다 — **왼쪽 로고(87px)와 오른쪽 버튼 덩어리(245px)의 무게가 3배 차이**라 무엇을 기준으로 가운데를 잡아도 메뉴가 어디에도 안 붙은 채 뜬다. 지금은 **로고+메뉴가 왼쪽 한 덩어리, 버튼이 오른쪽 끝, 빈 공간은 가운데 한 군데**(1440px에서 388px). 빈칸이 하나면 의도한 여백으로, 둘이면 정렬 실수로 읽힌다. `column-gap: 40px`가 로고↔메뉴 간격이다.
  - **⚠️ 메뉴 간격 24px + 행간 1**: 활자의 1.4배를 넘으면 글자 폭 30px인 '특강'·'후기'보다 틈이 넓어 메뉴가 다섯 덩어리로 흩어져 보인다. 행간을 안 잡으면 링크(body 1.7 상속, 높이 29px)와 드롭다운 버튼(21px)이 달라 **'승준노트'만 2px 처진다** — `.nav-links > li`를 flex로 세우고 링크·드롭다운 버튼에 `line-height: 1`을 준 이유이자 **세로 줄 맞춤의 핵심**이다. (2026-07-30 실측: 다섯 항목·로고·두 버튼의 잉크 중심이 전부 33.0~33.3px = 오차 0.3px.)
  - **⚠️ 로그인(15px)은 신청하기(16px)보다 한 단계 작다** — 같은 크기면 오른쪽 끝에 비슷한 알약 둘이 서서 어느 쪽이 본 행동인지 안 읽힌다(9대 원칙 6번 '채움 CTA는 하나').
  - ⚠️ **버튼에 `line-height: 1.15` + `min-height: 44px`** — `.btn`은 body의 `--lh-body`(1.7)를 물려받아 그대로 두면 활자만큼 버튼이 부푼다(21px 시절 실측: 버튼 60px, 바 85px). **높이는 활자가 아니라 min-height 로 잡는다** — 활자를 줄였다고 44px(9대 원칙 2번 터치 최소치) 아래로 내려가면 원칙 위반이다.
  - ⚠️ **좁은 데스크톱 구간은 769~820px 로 좁혔고, 여기서 활자는 안 건드린다** — 활자를 줄인 뒤 한 줄에 필요한 폭이 약 1,150 → **759px**로 내려갔다(실측). 구 1180px 상한을 그대로 뒀으면 줄일 이유가 없는 노트북에서도 더 작은 nav 가 떴다. 이 구간은 간격만 좁혀(column-gap 28 · 메뉴 gap 18) 한 줄을 유지한다. ⚠️ 이 블록은 여전히 `.nav-cta`·`.btn-login-outline` **뒤에** 둘 것(특이도가 같아 앞에 두면 기본 규칙이 이긴다).
  - ⚠️ **`.mypage-pill`·`.nav-avatar`의 좁은 화면 축소는 기본 선언 *뒤*의 별도 미디어 블록에 둔다** — 구 1180px 블록 안에 있던 두 줄은 뒤에 오는 기본 규칙에 밀려 **한 번도 적용된 적이 없었다**(2026-07-30 발견). researchers·challenges 에 있던 같은 두 줄은 그 페이지에 마이페이지 알약 자체가 없어(index만 생성) 죽은 코드라 삭제.
  - ⚠️ **햄버거는 보이는 크기 38×32px + `::after` 투명 히트영역 44×44px**(2026-07-30). 보이는 크기를 키우면 모바일 바가 57→68px로 부푼다 — news.html 스크랩 알약과 같은 방식으로 히트영역만 넓혔다. 지우면 9대 원칙 2번 위반으로 되돌아간다.
  - ⚠️ nav 높이를 또 바꾸면 **`.msn`의 `scroll-margin-top`(모바일 60 / ≥769px 78)과 `.mobile-menu`의 `top: 60px`**도 같이 볼 것 — 착지점이 바 밑에 깔린다.

### 2026-07-14 목업 리디자인 (소스오브트루스: `outputs/monc-font-mockup.html`·`monc-mockup-2.html`)
색·폰트 + **레이아웃까지** 풀 리디자인(웜 통일). `.section-label`/`.mc-eyebrow`에 코랄 대시(—) `::before` 시그니처, 연구원 이름 명조. **회귀 방지 핵심:**
- `.section-label` 코랄 대시 시그니처·명조 제목 규칙은 유지. (구 ③ B&A 다크 시네마틱·④ `.cta-box` 항목은 2026-07-29 홈 개편으로 대상 소멸 — 다크 무대 위 라벨 `!important` 오버라이드 패턴은 `.msn`이 계승.)

### 연구진 (홈 스트립·성장 리포트 목업은 2026-07-29 삭제)
구 `#researchers-strip`(포트레이트 마퀴 + rAF 물리 IIFE)과 `#member-appeal`(성장 리포트 목업 `.db-root`)은 홈 개편으로 **통째로 삭제**(`.ts-*`/`.db-*`/`.ma-*` CSS 포함). 연구진 소개는 `researchers.html` 단독 — **이력의 소스오브트루스도 이제 그 파일의 `researchers` 배열 하나**(구 '스트립 카드와 양쪽 동기화' 부담 소멸).
- **⚠️ 현형빈은 챌린지를 지도하지 않는다(2026-07-24 오너 확인).** researchers.html에만 노출하고 apply.html·terms.html의 '담당 코치' 명단에는 넣지 않는다(약관상 실제 지도자 명단). '연구진 전원 = 챌린지 담당 코치'를 전제한 문구 금지.
- **카드 순서 = 직급 순**(수석 권성호·박새암 → 책임 고은지 → 선임 최보민·김유리·현형빈) — 직급이 바뀌면 자리도 같이 옮긴다. 사진 `images/instructor-<kwon|park|hyun|koh|choi|kim>.webp`(800px 폭 webp q78).

### 커뮤니티/후기 (홈 섹션은 2026-07-29 삭제)
구 `#community`(지표 카운트업 · 롤링 배너 · 대표 후기 카드 · 라이트박스)는 홈 개편으로 삭제. **후기 소비처는 reviews.html 하나**(nav '후기'). ⚠️ admin '홈 커뮤니티' 탭과 `site_config`의 `community_stats`/`community_phrases`, admin '후기 관리'의 대표 번호(`sort_order≥1`)는 **잔존하지만 현재 소비처가 없다** — 홈에 사회적 증거를 되살릴 때 재사용할 수 있게 남겨둔 것(그 전까진 admin에서 수정해도 화면 변화 없음).

### reviews 테이블 분류 컬럼
`reviews`에 `challenge`(보신각/영합각/스피닝/승자각)·`cohort`(smallint, NULL=미상)·`reviewer_name`·`review_date`·`quote` 컬럼 (migration `20260710130000_reviews_classify.sql` + 기존 108건 백필, owner 실행). reviews.html 필터·커뮤니티 카드에 사용. admin '후기 관리'에서 수정. `quote`는 저장만(미표시).

### 항공 뉴스 수집 파이프라인 (`scripts/fetch-news.mjs` + `.github/workflows/news.yml`)
**이 레포에서 유일하게 서버처럼 도는 것.** 구글뉴스 RSS 12쿼리(항공사 10개사 + '항공사 채용'·'국내 항공업계') → 분류 → `news_articles` upsert. GitHub Actions가 **3시간마다** 실행하며 `SUPABASE_SERVICE_ROLE_KEY`는 **GitHub Secrets**에 있다(오너 등록 완료). 테이블은 migration `20260721120000_news_board.sql`(owner 실행 완료) — 읽기 공개, 쓰기는 service role만.
- **로컬 검증**: `node scripts/fetch-news.mjs --dry-run` — DB 없이 파싱·분류·제외 결과와 미분류 비율을 찍는다. **규칙을 고치면 반드시 dry-run으로 실데이터에 대고 확인할 것**(정규식 한 줄이 수백 건을 좌우한다).
- ⚠️ **분류는 저장 시점에 굳는다.** `AIRLINES`·`TOPICS`를 고쳐도 과거 기사엔 반영되지 않아 재분류 스텝(7)이 매 실행 소급 적용한다 — 이 스텝을 지우면 키워드를 확대해도 **DB 통계가 꿈쩍 않는다**(실제로 겪은 자리: 규칙상 36%인데 DB는 63%였다).
- ⚠️ **참사 보도 제외**(2026-07-22 오너 결정, 승무원 지망생이 보는 화면이라): `EXCLUDE` 정규식. **`RESCUE` 예외를 지우지 말 것** — "승무원 신속 대응으로 참사 막았다"는 참사 보도가 아니라 승무원 대응 미담이고 준비생에겐 최상급 면접 소재다(첫 시험에서 실제로 오탐된 자리).
- **주제 미분류 38%는 정상.** 남은 건 대부분 '폭염 현장점검'류 홍보성 보도자료라 억지로 분류하면 카테고리만 오염된다(전체 탭에선 어차피 보인다). 같은 사건 중복은 933건 중 4%뿐이라 **중복 묶기는 품값을 못 한다** — 최신순 정렬 탓에 도배처럼 보일 뿐이다.
- 삭제는 `deleteIds()`로 **100개씩 청크**(uuid 36자를 URL에 나열하므로 500개면 18KB로 414를 맞는다). 90일 정리·참사 청소 **둘 다 스크랩된 기사는 남긴다** — cascade로 회원 재료함이 날아가므로.
- ⚠️ 공개 리포는 **60일간 커밋이 없으면 GitHub가 스케줄을 자동 중지**한다(메일 통지 → 버튼으로 재활성).

### Design system (`tokens.css`)
Linked by index + detail/legal pages + member pages(login/mypage/admin).
- **⚠️⚠️ 팔레트 = 딥 네이비 on 웜 페이퍼(2026-07-29 오렌지 전면 폐지 · 오너 "오렌지는 탈피" · 목업 `outputs/home-color-mockup.html` B안).** 배경 = `--bg #F4F1EA` / `--bg2 #FBF9F5`(구 `#E9E4D8`보다 한 단계 밝고 채도 낮음); 액센트 = **`--action`·`--accent`·`--accent-ink` 전부 `#1B3A6B`** (한 값으로 모은 게 의도 — 세 단계로 벌리면 자리마다 다른 채도가 섞여 산만해진다), `--accent-dark #142C52`는 테두리·포커스링·다크 위 겹침용; 본문 `--text #26221C`.
  - **⚠️ `--action-ink`는 흰색(#FFFFFF)이다** — 이름 그대로 'action 면 위에 얹는 잉크'. 구 오렌지 시절엔 이 값이 다크(#2A1206)라 **밝은 배경 위 텍스트 강조로도 같이 쓰이고 있었는데**, 그 용도는 전부 `--accent-ink`로 옮겼다(ai-killer·admin·news 태그 등 12곳). **다시 어둡게 만들면 사이트 전역의 CTA 버튼 글씨가 사라진다.**
  - **⚠️ 반대 방향의 함정 — 네이비는 다크 배경 위에서 묻힌다(다크 #26221C 위 1.4:1).** 다크 무대 위 강조 텍스트·테두리·점은 **`--action-on-dark #A8C7F0`**(밝은 하늘 블루), 다크 위 CTA 버튼은 **'흰 알약 + 네이비 글씨'로 뒤집는다.** 해당 자리: 홈 마무리 CTA · apply 회원가입 배너 · news 토스트 · 블라인드 퀴즈 · mypage 멤버십 카드. 새로 다크 블록을 만들면 이 규칙을 같이 챙길 것.
  - **⚠️ `--bg`를 흰색 근처(#FBF9F5 등)로 올리지 말 것** — challenges.html 레터프레스 카드(그라디언트 `#FCF9F1→#F3EEE1`)가 배경에 묻힌다. 관계는 `--bg`(기본 면) < `--bg2`(밝은 섹션) < `--surface`(흰 카드).
  - **기능색은 오렌지·빨강 그대로 유지**(브랜드색이 아니라 의미색이라 통일 대상이 아니다): admin 에러(`#A33D14`·`#c0392b`), AI킬러 지적 강조(`--k-cliche`)·등급색(`#8C4318`/`#9E3B34`), 항공사 CI(`--air-*`), 카카오·구글 브랜드색, 상세 페이지 아바타 이니셜 원 그라디언트, 노을·창문 SVG 일러스트.
  - 에이브로우 = `--accent-ink`(`.section-label`, tokens 오버라이드 `!important`). 인트로 태그라인 M·O·N·C 강조는 `--ht-mark #A8C7F0` — **창밖이 노을이라 어두운 색은 못 쓴다**(구 `#FFB27A`는 노을과 같은 색상각이라 배경에 녹았다).
- **타이포:** 섹션 제목은 명조 — `h2.section-title/.ts-title/.mc-title/.ma-title`에 `var(--serif)`(Noto Serif KR) 700 + `--fs-h2 clamp(30px,4.2vw,46px)` (tokens.css 오버라이드, h2 접두 특이도로 `index.css`의 `.section-title` 규칙을 이김). **명조 쓰는 페이지(index·상세 4종·reviews)는 `<head>`에 Noto Serif KR `600;700;900` 링크 필수.**
- **UI 9대 원칙**(docs/design-principles.md): 가독성 12pt+ / 터치 44px+ / 대비 4.5:1 / 아이콘 통일 / 라운드 / 계층 / 여백 / 그룹핑 / 큼직. **375px 우선 검증.**
- Typography(`--fs-*`)·spacing(`--space-*`, 8px)·radius(8/14/20/24)·섹션 배경 리듬 전부 토큰화 — 하드코딩보다 토큰 우선. **`--fs-body-sm: 15px`(2026-07-25 신설)는 본문 17과 캡션 14 사이의 '카드 설명줄' 칸** — 캡션 14px는 보조 정보용이라 카드의 유일한 설명 줄에는 작다(승준노트 `.bf-desc`·홈 `.bp-desc`가 쓴다). ⚠️ 별도 파일에서 쓸 땐 `var(--fs-body-sm, 15px)` 폴백을 붙일 것(캐시 분리 대비 — 위 briefing.html 항목 참조).
- 아이콘 = `<body>` 상단 `<symbol>` 스프라이트(`currentColor` 리컬러). 하단 스티키 CTA바 `.mobile-cta-bar`(index 전용, **2026-07-22부터 전 화면폭** — 넓은 화면은 `max-width:460px; margin:auto`로 가운데 알약. 클래스명은 구 이름 유지).

### Audio (detail pages)
`audio/`의 before/after 클립, 위치 기반 네이밍: `challenger-a-before.mp3`…(voice), `spinning-a-before.m4a`…(spinning). Windows에서 추가 시 이중 확장자 주의(`*.mp3.m4a`). **클립은 음성이라 mono ~80kbps로 최적화**(스테레오·128k+ 불필요) — 새 클립도 `-ac 1 -b:a 80k`로 맞출 것. 전·후는 동일 설정으로 인코딩해 대비를 왜곡하지 않는다.

### 블라인드 퀴즈 (`blind-quiz.js` — 2026-07-29 홈에서 보신각·스피닝 상세로 이사)
자기 주입 공용 컴포넌트(application-modal.js 패턴): `challenge-voice.html`·`challenge-spinning.html`이 `<div id="blind-quiz-mount">`(최종 CTA 직전) + `<script src="blind-quiz.js" defer>`로 싣는다. 퀴즈 재료(전·후 녹음)가 전부 이 두 챌린지 클립이라 이 자리가 맞다(오너 확정 — 허브에 넣으면 다크 체험이 카드 훑기를 끊는다). **⚠️ 스타일·마크업·로직이 blind-quiz.js 한 파일 — 두 페이지에 복사본을 만들지 말 것.** 클래스는 전부 `bq-` 네임스페이스(상세 페이지의 `.section-label`/`.btn`과 충돌 방지 — 헤더 `.bq-label/.bq-title`, 버튼 `.bq-btn`). 동작은 종전 그대로: 5라운드(보신각 7쌍 중 3 + 스피닝 4쌍 중 2 랜덤), 실루엣 영상(`video/bq-candidate.mp4`)은 클립 재생 중일 때만(`syncScene`), `prefers-reduced-motion`이면 켄번즈·영상 자동재생 정지, '같은 사람' 반전은 1라운드 1회만.
### 히어로 — 창문 정적 배경 + MONC 조립 (`#heroIntro` · 2026-07-29 전면 교체)
오너가 새 배경 이미지(창+하늘 **합본**)를 주면서 히어로를 갈아엎었다. **조립 안무 자체는 구 인트로 그대로**이고, 바뀐 것은 **구동 방식(스크롤 → 시간)**과 **뒷부분(창 통과 줌 삭제)**이다. 오너 지시: *"원래 애니메이션을 쓰되, 스크롤하면 작동하는 게 아니라 입장하면 자동으로 발동되게."*

- **구성**: `<section class="hero-intro">` = `<picture>` 배경 한 장 + 정중앙 `.hi-stack`(문장 `.hi-phrase` ↔ 로고 `.hi-target`) + 한글 줄 `.hi-kor` + `#heroCue`(SCROLL). 높이 **100svh 한 장**.
- **안무**: 0~0.6초 문장 정지(읽는 시간) → 0.6~2.4초 **조립** → 2.35초 한글 → 2.9초 SCROLL. 총 3.6초, **로드 직후 rAF 1회**.
- **⚠️⚠️ 문장은 두 줄이고, 첫 화면에 **다 보여야** 한다(2026-07-30 오너 "첫 화면이 글자가 이딴식으로 시작하는 게 어딨냐, 화면 안에 봐야 할 거 아니야" — 구 한 줄은 375px 에서 화면의 241%라 `nt Of New` 만 보였다).** `Moment Of` / `New Career` 두 줄(`.hi-line`)이고, `clamp(48px,16vw,128px)` 위에 **`fitPhrase()`가 화면 폭(-32px)에 맞춰 더 줄인다** — 기기 폭이 제각각이라 clamp 만으론 '화면 안'이 보장되지 않는다. **⚠️ 한 줄로 되돌리지 말 것**: 20자라 화면에 맞추는 순간 34px 이 되어 로고(40px)보다 작아지고, '줄어들며 창으로 들어오는' 연출이 **커지는** 방향으로 뒤집힌다(실측). 조립 배율 0.55~0.65.
- **⚠️⚠️ 로고 크기·자리는 CSS 가 아니라 JS(`fitWindow`)가 개구부에서 역산한다 — 퍼센트로 되돌리지 말 것.** 개구부의 화면 대비 폭이 **세로형 38.1% · 가로형 15.7%**로 완전히 달라 같은 `vw` 값이 두 경우에 전혀 다른 결과를 낸다. 게다가 배경이 `object-fit: cover` 라 화면 비율에 따라 이미지가 잘리면서 개구부의 폭도 **세로 위치도** 또 달라진다(실측: 1440×900 에서 창이 224px 이 아니라 **264px**). 그래서 cover 스케일을 직접 계산해 **개구부 사각형을 박스 좌표로 환산**한 뒤 ① 로고 폭이 그 폭의 `FIT`(0.90)이 되도록 font-size 를 역산하고 ② `.hero-mid`를 그 중심에 앉힌다(`top` px + `translate`). 실측 채움률 **90.0%**, 중심 오차 **0.0px**(320·393·430·768·1024·1440·1920 전 폭). CSS 의 `clamp(28px, 10vw, 52px)`·`top:49.4%/50.7%`는 **JS 가 죽었을 때의 폴백일 뿐**이다.
- **⚠️⚠️ `OPEN` 상수는 '유리(개구부)' 좌표다 — 바깥 창틀이 아니다(2026-07-30 오너 "글자가 창틀 밖으로 삐져나오고 위치도 중앙이 아니다").** 구 세로형 값 `0.230~0.769`는 유리가 아니라 **창틀 바깥 테두리**를 잰 것이어서, 로고가 개구부의 **127%**(실측)로 커져 M 과 C 가 창틀 위로 올라탔다. 가로형 값만 우연히 유리였다. 현재 값 — 세로형 `l .3118 / r .6928 / t .3384 / b .6490`, 가로형 `l .4222 / r .5789 / t .2750 / b .7385`. **배경 이미지를 교체하면 네 값을 '유리 기준으로' 다시 잴 것**(창틀을 재면 같은 사고가 반복된다).
- **⚠️⚠️ 세로 기준은 '로고 + 한글'을 합친 **덩어리 중심**이고, 거기서 개구부 높이의 `LIFT`(4%)만큼 더 올린다(2026-07-30 오너 "아직도 창문 아래쪽에 있잖아").** 한글 줄이 흐름 밖(`top:100%`)이라 `.hero-mid` 높이에 안 잡혀서, **로고만** 정중앙에 두면 그 아래 한글 42px 이 통째로 덤으로 붙어 덩어리가 아래로 쏠린다 — 오너가 두 번 지적한 지점이 정확히 이것이다. LIFT 는 시각 보정(기하학적 정중앙은 눈에 낮게 읽히고, 위가 짙은 하늘·아래가 흰 구름이라 아래가 더 비어 보인다). 네 자리(0 / 덩어리중앙 / +4% / +7%)를 **실제로 렌더해 비교**한 결과이고, 값을 바꾸려면 같은 방식으로 비교할 것.
- **⚠️⚠️ 한글 줄은 로고와 **양끝을 맞춘다**(2026-07-30 오너 "서브타이틀 메인타이틀 양쪽 글자에 맞춰라, 혼자 툭 튀어나오잖아"). `fitKor()`가 자간을 계산해 넣는다** — 로고 폭이 창 크기에 따라 달라지므로 CSS 고정 자간으로는 절대 안 맞는다. 순서: ① 한 줄이 로고보다 좁으면 자간을 벌려 채운다 ② 조금 넘치면 **글씨를 줄여** 한 줄로 맞춘다(하한 12px — 9대 원칙) ③ 그래도 넘치면 **두 줄로 접고 줄마다** 편다(모바일: 한글 207px vs 로고 135px 이라 항상 두 줄). ⚠️ ②를 빼면 로고가 한글보다 아주 조금 좁은 폭(실측 1024px)에서 반토막 난 줄을 억지로 늘려 **자간이 18px(≈1em)** 까지 벌어진다.
  - **⚠️ 맞추는 기준은 상자가 아니라 '보이는 글자(잉크)'다.** M·C 는 사이드베어링이 넓고 한글은 좁아, `getBoundingClientRect` 끼리 맞추면 한글이 양쪽으로 **3~4px 씩 삐져나온다**(실측). 그래서 캔버스 `measureText`의 `actualBoundingBoxLeft/Right`로 첫 글자·끝 글자의 베어링을 빼고 잰다(`bearings()`/`inkEdges()`). 구형 브라우저에 확장이 없으면 0 으로 떨어져 상자 기준으로 degrade.
  - **⚠️ 마지막 글자 뒤에 붙는 자간은 `margin-right: -자간`으로 도로 뺀다.** 안 빼면 그 빈칸까지 폭에 잡혀 가운데정렬이 왼쪽으로 밀린다. 그래서 `.hi-kl` 은 `inline-block` 이어야 한다.
- **⚠️ 로고-한글 간격은 로고 크기에 **비례**한다(`GAP` 0.55em · `gapFor()`, 2026-07-30 오너 "모바일에서는 메인과 서브 행간이 더 줄어들어야 할 것 같다").** 구 CSS 고정 `margin-top:18px` 은 로고가 작아지는 모바일에서만 헐거워졌다 — 실측 시각 간격 **모바일 0.94em vs 웹 0.62em**. 지금은 세 폭 모두 **0.50em**(모바일 21px). ⚠️ margin 값 ≠ 보이는 간격이다 — 두 줄 상자 안의 빈 공간(로고 글자 아래 ≈0.30em, 한글 줄 위 ≈0.5×글자크기)을 빼고 넣는다.
- **⚠️ 문장과 로고 크기는 한 쌍이다.** 로고만 창에 맞춰 키우고 문장을 그대로 두면 배율이 0.97 이 되어 **크기가 안 변하는 것처럼 보인다**(실제로 한 번 그렇게 됐다). 한쪽을 바꾸면 배율을 다시 볼 것(현재 0.47(모바일) ~ 0.45(웹)).
- **⚠️ 이미지 로드 전에는 `naturalWidth`가 0이라 창을 못 잰다** → `load` 이벤트에서 `refit()`을 다시 부른다. 이 재호출을 빼면 폴백 크기(작은 로고)로 굳는다. **화면 회전은 `<picture>` 소스까지 세로형↔가로형으로 갈아치우므로**(개구부 상수도 함께 바뀐다) `resize`·`load` 둘 다 재생이 끝난 뒤에도 `fitWindow()`를 돌려야 한다 — 재생 중에만 재측정하면 회전 후 로고가 엉뚱한 크기·자리로 남는다.
- **⚠️ 문장 배치는 `left:50%` + `translateX(-50%)` + `width:max-content`.** `left/right:0` + `text-align:center` 는 내용이 컨테이너보다 넓어지는 순간 왼쪽 기준이 되어 **오른쪽으로만 삐져나간다**(구 한 줄 시절 실측으로 밟은 자리).
- **⚠️ 조립 후 로고가 화면에 남는다.** 구 인트로의 뒷부분(로고 전진 확대 → 창 통과 → 페이드아웃)은 **되살릴 수 없다** — 새 배경은 창과 하늘이 한 장에 합쳐져 있어 확대하면 그림 전체가 커질 뿐이다. 되살리려면 하늘/창틀 2겹 이미지부터 필요하다.
- **⚠️⚠️ 도착점은 `.hi-target`을 실측해서 얻는다 — 계산으로 만들지 말 것.** `.hi-target`은 `visibility:hidden`이지만 **자리는 차지하는 실물**이고, JS가 각 글자의 `getBoundingClientRect` 중심을 도착 좌표로 읽는다. 지우거나 `display:none`으로 바꾸면 조립이 엉뚱한 데로 간다.
- **⚠️ 자간은 `letter-spacing`이 아니라 `margin`으로 준다**(`.hi-target span { margin: 0 .035em }`). letter-spacing 은 글자 박스를 부풀려 박스 중심이 실제 글자 중심과 어긋난다 — 구 인트로에서 서브라인 정렬이 삐뚤어졌던 원인이 이것이다.
- **⚠️ 조립이 끝나면 문장을 숨기고 `.hi-target`을 보인다**(`u > 0.995`). transform 으로 2.28배 키운 글자는 래스터가 흐려진다 — 이 교체를 빼면 로고가 뿌옇게 남는다.
- **⚠️ 한글 줄은 흐름에서 빼 `position:absolute; top:100%`로 둔다** — 흐름에 두면 조립 중 커진 글자에 밀려 줄 위치가 출렁인다. **대신 `.hero-mid` 높이에 안 잡히므로 세로 중심을 잡을 때 그 높이를 직접 더해 줘야 한다**(위 '덩어리 중심' 항목 — 이걸 빠뜨린 게 오너가 두 번 지적한 '아래로 쏠림'의 원인이었다).
- **⚠️ `.hi-stack` 높이를 고정해 둔 이유** — 조립되며 글자가 커질 때 아래 한글 줄이 밀려 내려가는 걸 막는다.
- **⚠️ 웹폰트(SUIT)가 늦게 오면 글자 폭이 바뀐다** → `document.fonts.ready`에서 재측정한다(재생 중일 때만 — 도착 좌표가 필요한 구간이라).
- **⚠️ `prefers-reduced-motion`이면 조립을 건너뛰고 '완성된 로고' 상태로 둔다.** 아무것도 안 하면 문장만 남아 로고를 못 보게 된다.
- **⚠️ 타임라인 `total`은 마지막 페이드(`cueAt + 0.6`)보다 커야 한다** — 3.4로 뒀더니 SCROLL 이 0.83에서 멈췄다(실측).
- **⚠️ 배경 이미지가 뜬 뒤 시작한다**(`load`/`error` + 1.2초 안전망). 안 그러면 느린 회선에서 글자만 떠 있는 화면이 보인다.
- **이미지**: `images/hero-window-web.webp`(1717×916 · 60KB) / `images/hero-window-mob.webp`(853×1844 · 67KB). **⚠️ 분기는 폭이 아니라 `(max-aspect-ratio: 1/1)`** — 태블릿 세로에서 가로형 이미지를 cover 하면 좌우가 심하게 잘려 창만 거대해진다. 모바일 이미지 비율 1:2.16이 375×812(1:2.165)와 거의 일치해 잘림이 없다. ⚠️ `<picture>` source 는 **로드 시점에 결정**된다 — 창을 리사이즈해도 안 바뀌므로 확인할 땐 새로고침할 것.
- **⚠️ 스크롤과 무관하다.** 러웨이(200/180vh)·sticky 핀·재방문 단축(`data-zoom-runway` 재작성)·`monc:zoomprogress` 이벤트가 전부 사라졌다. 인트로 도달률 38%의 원인이던 긴 스크롤 구간 자체가 없어진다(index.html 1353→약 730줄).
- **함께 삭제된 것**: `scroll-fx.js`의 `initZoomExit`(293줄) · `tokens.css`의 `[data-zoom-exit]`/`.zoom-exit-pin` 규칙 · 구 태그라인 IIFE(약 35KB, 줌·개구부 알파 스캔·fixed 승격 포함) · 창틀·하늘 이미지 2겹(89KB) · 페이드 레이어 4장. 구 스펙 문서(`docs/superpowers/specs/2026-07-10-hero-monc-tagline-design.md` 등)는 이제 **역사 기록**이다.
- **⚠️ 하단 CTA 바 `.is-browse` 판정 기준이 바뀌었다** — 구 `monc:zoomprogress` 0.85 대신 **히어로가 화면에 절반 넘게 남아 있는 동안**(`rect.bottom > innerHeight*0.5`). 삭제 금지 규칙(인트로 구간엔 '몬크 더 알아보기' → `#home`)은 그대로다.
- **계측**(`intro_view`/`hero_reached`)과 `monc_intro_seen` 플래그는 유지. 다만 `monc_intro_seen`은 이제 **러웨이 단축이 아니라 첫 방문 판별에만** 쓰인다.
- **폐기된 중간안 — 로고 흩날림**: 같은 날 오너가 *"모래알처럼 한쪽으로 날아가는 느낌"*을 제안해 한 번 구현했다가(위로 스르륵 사라지고 SCROLL만 남는 안) *"날아가는 거 말고 원래 애니메이션을 쓰자"*로 되돌렸다. 결정 기록은 `outputs/hero-sand-mockup.html`. **되돌리지 말 것** — 그 안은 4초 뒤 히어로에 브랜드 메시지가 하나도 안 남는다는 문제가 있었다.
### 챌린지 카드 목록 — `challenges.html` (2026-07-29 홈 #home에서 통째로 이사)
**챌린지 허브(신설)** — 홈 '챌린지 문'의 목적지. 구성: nav → 허브 히어로(홈 문과 같은 문장 "매일 습관을 만들 기회" + 상품 사실 한 줄) → 레터프레스 카드 4장 → 홈으로 돌아가기 → footer. **신청 CTA 없음**(카드가 곧 문, 신청 버튼은 각 상세가 담당 — 오너 확정 "챌린지만 구성되어 있는 게 좋다"). **전·후 증거도 없음**(각 상세가 이미 담당 — 허브에 B&A를 넣자는 안은 오너가 "깔끔하게"로 철회). 카드 CSS·재정렬 JS(`heroReorder` 이관)는 이 파일 인라인.
카드 규격·회귀 금지 규칙은 index 시절 그대로(위반 이력 전부 이 카드에서 나온 것):
- **레터프레스 종이 카드**: 종이 그라디언트(#FCF9F1→#F3EEE1) + 갈빛 그림자 3겹(inset 1px / 2px / 18px — 하나라도 빼면 물성 붕괴). ⚠️ 흰 카드 금지(베이지 배경 위 이물감) · 사진 위 글자 금지(크림 막이 사진을 죽인다 — 글자는 사진 밖).
- ⚠️ hover는 `@media (hover:hover)` 안에(모바일 탭 잔류 강조 방지). ⚠️ `.ch-list`는 `minmax(0,1fr)` + `grid-auto-rows:1fr`(넘침·행높이 함정), 375px부터 2×2 · ≥860px 4열. ⚠️ `.ch-shot`은 `flex:0 0 auto` + 4:5. ⚠️ `.ch-name`은 `'Noto Serif KR', serif` 600 명시(`var(--serif)` 1순위 Song Myung엔 700이 없어 합성 볼드가 난다).
- **상태는 활자로만**(구 초록 알약 재도입 금지): 모집 중 = `--accent-ink`, 마감·예정 = 사진 흑백(`.is-dim`, recruit.js가 부여) + '다음 기수 준비 중'('마감 · ' 접두 금지 — 카드 폭에서 두 줄이 된다). **카드 순서·번호는 런타임**: `monc:recruitready` → `heroReorder()`가 모집 중→예정→마감 재정렬 + `.ch-num`을 표시 순서로 재부여(마크업 고정값 금지).
- **모집 기간 줄(`.ch-meta` — 허브 전용 신설)**: recruit 데이터 도착 후 'N기 · 모집 M/D ~ M/D'를 카드 하단에 채운다. 마감 카드는 비워 둔다(지난 기간은 정보가 아니다 — 칩이 '다음 기수 준비 중'을 말한다).

| 마크업 순서 | id | 이름 | 이미지 | 변화 문장 |
|---|---|---|---|---|
| 1 | `voice` | 보.신.각 | `hero-voice.webp` | 떨리는 목소리 → 신뢰가 실리는 목소리 |
| 2 | `expression` | 영.합.각 | `hero-expression.webp` | 굳은 표정 → 카메라 앞에서도 자연스럽게 |
| 3 | `spinning` | 스.피.닝 | `hero-spinning.webp` | 딱딱한 말투 → 귀에 감기는 말투 |
| 4 | `answer` | 승.자.각 | `hero-answer.webp` | 뻔한 답변 → 나만 할 수 있는 답변 |

⚠️ 위 순서는 **마크업 순서일 뿐 화면 순서가 아니다**(모집 상태로 재정렬됨). 변화 문장은 '전 → 후' 구조 유지(강조는 색이 아니라 굵기 — `em`은 잉크색 700). 구 'B&A `.ba-arc`와 한 쌍' 규칙은 B&A 삭제로 소멸 — 이 문장의 단일 소스는 이제 challenges.html.
### (삭제) Before&After 섹션 · 변화 문장 띠
홈 `#before-after`(.ba-* 전부)와 `.ba-arc` '한 쌍' 규칙은 2026-07-29 홈 개편으로 소멸. 전·후 증거(오디오 플레이어·영합각 영상)는 **각 챌린지 상세 페이지가 담당**(원래도 갖고 있었다 — 오너 "챌린지마다 다 들어가 있으니 굳이 밖으로 뺄 필요 없다"). 승자각 '고치기 전/후 답변' 글 카드 아이디어(실제 지원자 답변 2개 필요)는 재료 확보 시 상세에 추가하는 보류 과제로 유효.
### Google Apps Script — 중복 신청
`학생현황` 시트에 **항상 새 행 추가**(전화 중복 무관; 구 find-and-update는 덮어쓰기 문제로 제거). 편집은 Google 콘솔에서 후 새 버전 재배포 필요. ⚠️ 이건 **구 레거시 시트 경로**이고, 현재 신청은 아래 Supabase 중복 가드가 막는다 — 시트 쪽 '항상 append'와 혼동하지 말 것.

### 결제·환불 (포트원 V2 · admin 원클릭) — 2026-07-23 신설, **적용 실측 확인 2026-07-25**
- **결제 = 포트원(PortOne) V2 단일 경로**(PG 무관 — 카드·간편결제). 신청 저장은 **반드시 `verify-payment` Edge Function 경유** — 브라우저가 보낸 금액을 믿지 않고 서버가 DB(`site_config.challenge_price` / `special_lectures.price`)에서 금액을 재확인한 뒤 service role 로 insert 한다. 결제 컬럼은 `pay_method·payment_id·payment_status·paid_amount`(migration `20260717120000_applications_payment.sql`).
- **환불 = admin '신청자 현황'의 [환불] 버튼 → `cancel-payment` Edge Function → 포트원 취소 API.** 원결제수단으로 자동 환불되므로 **환불계좌를 받지 않는다.** 금액 프롬프트 기본값이 전액이고 **금액을 고쳐 넣으면 그만큼만 부분취소**된다(별도 '부분환불' 버튼 없음). 누계는 `applications.refunded_amount`, 이력은 `refunds` 테이블(migration `20260723120000_payment_refunds.sql` — **owner 실행 완료, 다시 실행 안내 금지**).
- **⚠️ [환불] 버튼은 `payment_id` 가 있는 간편결제 건에만 뜬다.** 계좌이체 건은 취소할 PG 결제가 없어 기존 **[입금]/[환급] 수동 토글** 그대로다 — **버튼이 안 보이는 것은 기능 누락이 아니라 그 목록에 간편결제 건이 없다는 뜻**(2026-07-25 '적용 안 됨'으로 오인해 배포본·컬럼·함수를 전수 점검한 자리). 구분법: 카드에 `간편결제 N원 결제완료` 줄이 있으면 PG 건. 추가 조건은 `paid_amount − refunded_amount > 0` — **전액 환불된 건은 버튼이 사라진다**(정상).
- **⚠️ 포트원 취소는 성공했는데 DB 기록이 실패하면 함수가 `ok:true + warning` 을 돌려준다 — 실패(`ok:false`)로 바꾸지 말 것.** 관리자가 실패로 읽고 다시 누르면 **이중 환불**이 난다.
- **⚠️ `refunded_amount` 를 공용 select 에 넣지 말 것**(`major`·`agreed_at` 과 같은 방어 — 마이그레이션 미적용 환경에서 조회 전체가 깨진다). mypage 는 `payment_status` 만 보고 결제완료/부분 환불/환불완료를 판정한다.
- 결제 **후** 자동 환불 경로 2종은 `verify-payment` 담당 — 특강 정원 마감(MC001)·중복 신청(MC002). 둘 다 `refundAll()` + **HTTP 200**(위 각 항목 참조).
- **배포·확인**: 두 함수 모두 **Supabase 콘솔에서 코드 교체 → Deploy**(CLI 안내 금지). 배포 여부는 anon key 프로브로 판별 — `POST /functions/v1/cancel-payment` 에 `{applicationId:'probe',amount:1}` → **`unauthorized`(401)=배포됨**, 404=미배포. **결제 생성·DB 쓰기가 없어 안전하다.**

### 같은 프로그램 중복 신청 차단 (2026-07-25 신설 · migration `20260725120000_duplicate_application_guard.sql`, **owner 실행 필요**)
같은 사람이 같은 프로그램을 두 번 신청하는 것을 막는다(오너 지시 — admin 신청자 현황에 같은 이름·전화가 같은 챌린지·기수를 6분 간격으로 두 번 신청한 행이 쌓였다).
- **⚠️ 원장은 DB 트리거 하나(`applications_duplicate` → errcode `MC002`, message `duplicate_application`).** 신청이 들어오는 길이 **다섯**(챌린지 계좌이체·토스 / 특강 무료·계좌이체·토스)인데 전부 `applications` insert 로 수렴하므로 여기서 한 번 막는 것이 유일하게 새지 않는 방법이다. **브라우저 검사만으로 대체하지 말 것** — 비회원은 RLS 때문에 사전 조회가 아예 불가능하고(아래), 검사와 저장 사이의 틈은 늘 남는다.
- **판정 규칙**: 챌린지는 `challenge` + `round`(기수가 다르면 정상 재신청 → 허용), 특강은 `lecture_id`. **⚠️ 특강은 시간대(slot)가 달라도 차단** — 시간대는 '같은 내용을 여는 다른 타임'이라 두 번 들을 이유가 없다. '같은 사람' = 전화번호(숫자만) 일치 **또는** `member_id` 일치(비회원으로 한 번, 로그인해서 또 한 번을 잡는다). **환불·취소된 건(`refunded` / `payment_status` refunded·partial_refunded·cancelled·failed)은 세지 않아** 환불 뒤 재신청은 정상 동작.
- **⚠️ `pg_advisory_xact_lock`(전화·계정 키) 필수** — 두 번 연속 탭·두 탭 동시 신청은 서로 아직 커밋 전이라 `select` 에 안 잡혀 **둘 다 통과한다**(정원 가드의 `for update`와 같은 이유). 실측: 락 없으면 2건 저장, 락 있으면 뒤엣것이 MC002.
- **⚠️ 트리거 이름이 `applications_duplicate`인 이유**: 같은 BEFORE INSERT 인 정원 가드(`applications_lecture_capacity`)보다 알파벳 순서가 앞이라 **중복 판정이 먼저 돈다**(중복이면 자리 계산까지 갈 필요가 없다). 이름을 바꾸면 순서가 뒤집혀 중복 신청이 MC001(정원 마감)로 보고될 수 있다.
- **클라이언트(트리거 미적용이어도 회원은 동작)**: 공용 헬퍼는 `supabase-config.js`의 `MONC.isDuplicateError / isLiveApplication / programKey / myAppliedPrograms`.
  - `apply.html` — 회원은 **이미 신청한 기수 카드가 `.disabled` + '신청완료'(`.status-applied`) 로 잠긴다**(`markAppliedCards()`). 호출은 `applyStatuses()` 끝과 `initMember()` 끝 **두 곳** — 기수(round)는 recruit 조회 후에, `_memberId` 는 프로필 조회 후에 정해지므로 **어느 쪽이 늦게 끝나도 잠기게** 양쪽에서 부른다(한 곳으로 줄이지 말 것). 마감·모집예정 배지가 이미 있으면 그대로 두고(그쪽이 더 중요한 사실) 잠금만 건다.
  - `lecture.html` — 회원이 이미 신청했으면 **신청 폼이 '이미 신청하신 특강' 안내로 교체**되고 하단바가 '신청 완료'로 비활성(`markAlreadyApplied()`).
  - **계좌 안내 모달을 열기 전에** `dupBlocked()` 를 통과해야 한다 — 접수될 수 없는 신청에 입금 계좌를 먼저 보여주면 **입금부터 하고 막히는 사고**가 난다.
- **⚠️ 비회원은 사전 검사가 불가능하다(설계상 옳다).** 전화번호로 남의 신청을 조회하게 열어주면 번호만 넣어 '이 사람이 몬크에 신청했는지'를 캐낼 수 있다(현재 RLS SELECT 는 관리자·본인만). 그래서 비회원 중복은 트리거가 막고, 결제까지 끝난 건은 **verify-payment 가 전액 자동 환불**한다(`{ok:false, error:'duplicate_application', refunded, program}` · MC001 과 같은 이유로 **HTTP 200**). **⚠️ 이 응답은 owner 가 verify-payment 를 재배포해야 동작**(콘솔에서 배포 — CLI 안내 금지).
- **admin '신청자 현황'** — 이미 쌓인 중복 행에 **'중복' 배지 + 코랄 테두리**(`.ac-dup`/`.is-dup`, `dupIdSet()`). 트리거는 앞으로 들어올 것만 막으므로 과거 행은 관리자가 골라 지운다. **가장 오래된 1건(원본)에는 배지를 붙이지 않는다.** ⚠️ `appProgramKeys()`는 **Set 으로 묶어야 한다** — 특강 행은 `lecture_id` 컬럼과 `challenges` 항목에 같은 키가 둘 다 들어 있어, 배열로 두면 **자기 자신을 중복으로 세어 원본에까지 배지가 붙는다**(실제로 겪은 자리).
- **예외 접수(오너가 한 사람 이름으로 두 자리를 대신 넣어야 할 때)**: service role·콘솔 insert 도 트리거를 통과하지 못한다 → `alter table public.applications disable trigger applications_duplicate;` 로 잠깐 끄고 넣은 뒤 **반드시 다시 켠다**(마이그레이션 파일 하단에 명령 그대로 적혀 있음).
- 미적용 시 degrade: 회원 사전 검사만 남아 비회원 중복이 통과한다(챌린지·특강 신청 자체는 정상).

## Conventions
- Commit messages and in-code comments in Korean (matching existing history).
- **Dead code는 남기지 말고 제거.** 타임스탬프 백업 파일은 커밋하지 말 것.
