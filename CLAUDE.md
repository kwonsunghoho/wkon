# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**이 문서에는 매 작업에 공통인 핵심 규칙만 남긴다.** 기능별 상세 규칙·실측값·과거 의사결정은 아래 '기능별 문서' 표의 해당 문서가 원장이다 — **기능을 고치기 전에 그 문서를 먼저 읽는다.**

⚠️ **파일을 지우거나 이름·주소·설정을 바꿨으면, 그 이름을 `CLAUDE.md` 와 `docs/` 에서 검색해 같이 고친다.** 문서가 틀리면 다음 작업이 틀린 전제로 시작한다(2026-08-03 감사에서 문서 오류 5건 중 3건이 이 누락).

## 한국어 응답 문체

사용자 응답과 이 문서 본문 모두에 적용한다. 단 오너 발언 인용은 원문 그대로(사실 기록).

- 결론부터. 핵심만. 설명은 판단에 필요한 근거까지만.
- 문장은 짧게, 문단은 1~3문장. 같은 내용을 표현만 바꿔 반복하지 않는다.
- 사용자가 이미 말한 내용을 다시 길게 요약하지 않는다. 불필요한 배경 설명·일반론을 넣지 않는다.
- 자연스러운 한국어 존댓말. 친절하되 감정 표현은 최소화. 칭찬·공감·추임새를 습관적으로 넣지 않는다.
- 사용자의 판단에 무조건 동의하지 않는다.
- 과장·공격적 표현, 비유·은어·유행어·임의로 만든 표현 금지. 컨설팅 보고서처럼 거창하게 쓰지 않는다 — 실무자가 업무 내용을 정리해 전달하듯 쓴다.

특히 걸리는 두 부류: 과장된 비유("전부 무너진다"·"구멍이 크다")와 맞장구("정확히 짚으셨습니다"·"아주 좋은 판단입니다"). 평범하고 정확한 서술로 바꾼다 — "이 부분은 수정이 필요합니다", "이 방향이 더 적합합니다".

답변 순서는 ① 결론 ② 핵심 이유 ③ 필요한 대안·다음 작업. 내용이 간단하면 제목·목록 없이 바로 답한다.

## 프로젝트 구조

MONC(몬크 챌린지) — 승무원 준비생 대상 챌린지·면접 준비 도구 사이트. **정적 사이트, 빌드 단계 없음.** GitHub Pages 가 `main` 을 그대로 서빙하고, **라이브 주소는 `CNAME` 의 커스텀 도메인 https://monc.ai.kr**(github.io 주소는 이리로 넘어온다 — 오너·계측이 보는 곳은 언제나 monc.ai.kr). 프레임워크·번들러·package.json·테스트 스위트 없음 — 손으로 쓴 HTML/CSS/JS.

서버는 없고, "백엔드"는 브라우저가 부르는 외부 서비스다.

1. **Google Apps Script**(레거시 신청·후기 시트) — 이 레포가 아니라 구글 콘솔에서 수정·재배포한다. 신청은 항상 새 행 append.
2. **Supabase**(`supabase-config.js`, `MONC.sb`) — 회원·신청·후기·site_config·계측·도구 테이블 전부. 테이블·RLS·컬럼은 오너가 콘솔에서 만든다.
3. **모집일정 = Supabase `challenge_rounds` 단일 소스**(admin '챌린지' 탭에서 CRUD — CSV 폴백 금지는 아래 '절대 되살리면 안 되는 것').
4. ~~뉴스 수집기~~ — **2026-08-28 오너 지시로 뉴스 기능 전체 폐지**(news.md). 이제 브라우저 밖에서 도는 코드는 없다(.github/workflows 삭제).

The repo is sometimes edited from a git **worktree** under `.claude/worktrees/...` on a `claude/*` branch; the canonical checkout is the repo root on `main`.

## 명령·검증

- 작업 기계는 **윈도우**(2026-08-27 윈도우로 옮김 — 구 macOS 절차인 `wkon-mirror` rsync 미러·nvm 로더는 폐기. 되살리지 말 것).
- 로컬 프리뷰: `.claude/launch.json` 의 **`wkon-static`**(파이썬 단순 서버, 포트 5500·autoPort)을 `preview_start` 로 띄운다 — 레포를 직접 서빙한다.
- 배포: `git push origin main` — 푸시가 곧 배포다(1~2분 전파).
- **`node`(v24)·`python`(3.14)은 바로 실행된다.** **`deno` 는 없다.**
- **전체 lint·build·테스트 시스템이 없다. 존재하지 않는 lint/build 명령을 만들지 말 것.** 검증 수단은 아래가 전부다.
  - **브라우저 렌더 확인 — 375px 우선**(트래픽 99%가 모바일). 올리기 전 필수.
  - 항공사 문항 매칭: `node scripts/ai-killer-qmatch.mjs` — 임계값·유사도 식 변경 시(첨삭이 쓴다).
  - 답변 프로그램: `node scripts/answer-program-tests.mjs` + `deno check supabase/functions/answer-program/index.ts`(**deno 미설치 — 현재 못 돌린다**) + 375px 브라우저 실측.

### ⚠️ 어디에 푸시할까 — 오너 확정(2026-07-30)

**눈으로 보고 판단하는 수정(레이아웃·문구·색·애니메이션)은 `main` 직행.** GitHub Pages 가 `main` 만 서빙해서 브랜치는 오너가 폰으로 미리 볼 방법이 없다 — 실제로 "왜 적용이 안 되냐" 사고가 났다. 되돌리기는 `git revert` + 푸시로 1~2분.
**잘못되면 돈·데이터가 걸리는 것은 브랜치**: 신청·결제 흐름, Supabase 마이그레이션, 로그인·동의 게이트, 큰 구조 변경.
⚠️ 어느 쪽이든 진짜 안전장치는 **올리기 전 실제 브라우저 렌더 확인**이다(브랜치가 아니라). 375px 부터.

## 데이터 안전 공통 규칙

- **마이그레이션은 레포가 소스지만, 오너가 Supabase SQL Editor 에서 실행해야 반영된다.** 미적용 상태에서도 조용히 degrade 해야 한다: 목록 조회는 `select('*')`(컬럼 나열 시 미적용 환경에서 400), 신규 컬럼은 `getMyProfile()` 같은 공용 셀렉트에 넣지 않는다.
- **SQL·마이그레이션 본문은 파일 경로가 아니라 대화창에 ```sql 코드로 붙여넣는다**(경로를 bash 블록으로 주면 Run 버튼이 터미널을 연다).
- **Edge Function 배포는 Supabase 콘솔에서 한다**(오너 PC 에 CLI 없음 — `supabase functions deploy` 안내 금지). 함수는 **한 파일 유지**(콘솔 붙여넣기 배포라 모듈로 쪼개면 배포 불가). 코드를 고치면 `FN_VERSION` 도 같이 올리고, **배포 여부는 anon key 프로브로 확인한다 — 관리자에게 SQL 을 시키지 말 것.** **새 함수에는 `FN_VERSION` 과 `probe:true` 분기를 처음부터, 인증 검사보다 앞에** 넣는다. 현재 8개 함수 전부 있다. ⚠️ **portone-webhook 만 콘솔에서 JWT 검증을 끈다**(포트원이 부르는 함수라 Supabase 키가 없다) — 다른 함수는 끄지 말 것.
- 테이블 미생성 판정은 `42P01` 이 아니라 **`PGRST205`** 다.
- 함수 배포·마이그레이션 적용 같은 **시점 상태는 `docs/notes/implementation-status.md`** 에서 확인·갱신한다.
- Dead code 는 남기지 말고 제거한다. 타임스탬프 백업 파일 커밋 금지. 커밋 메시지·코드 주석은 한국어.

## 회원·로그인·동의·개인정보 — 법적 필수(완화 금지)

- **동의는 가입 시 딱 한 번.** OAuth 복귀 후 `hasConsented()` false 면 동의 게이트(`login.html #consentView`). **체크박스 사전 체크·"간주 동의"·게이트 삭제 금지.** 약관 개정 시 `supabase-config.js` 의 `TERMS_VERSION` 을 올리면 전원 재동의.
- **동의 3대 함정**(되돌리면 법적 리스크): ① 로컬 동의 캐시는 **계정별 키** `monc_consent_v1:<uid>` ② **거부 = 즉시 파기**(`MONC.deleteMyAccount()` — 로그아웃만 하면 미동의자 개인정보 잔존) ③ **회원 페이지 전부 `MONC.requireConsent()` 가드**(한 곳 빠지면 주소창 우회).
- 신청·명단 폼의 필수 동의 체크(`apply.html #appConsent` · `lecture.html` · `waitlist.js #wlAgree`)는 미체크 시 제출 차단 — **삭제·완화 금지.** 법적 고지 활자도 12px 하한.
- **개인정보·학원 자산 반입 금지**: 합격 자소서 원문, 정규반 교재의 기출·가이던스, 소재 노하우(`sojae_playbook`)는 레포·공개 테이블 어디에도 넣지 않는다(비공개 테이블 + SQL 대화창 전달). **합격자 문장을 AI 프롬프트 예시로 주지 않는다.** 자료는 파일명이 아니라 본문 출처로 확인. **커뮤니티 오픈챗 주소·참여코드도 같은 취급** — 회원 전용 표 `community_config`(RLS `authenticated` 만)에만 두고, 값 insert SQL 은 대화창으로 전달한다.
- **전화번호로 남을 조회할 창구를 만들지 않는다**(번호만으로 신청·관심 여부가 캐진다 — 비회원 사전 조회·명단 본인 조회를 일부러 안 열었다).
- **휴대폰 본인인증(KG이니시스 통합인증·포트원 경유)**: 가입 온보딩 + **특강 신청·승준 도구·연구실 자료는 인증 회원만**(`MONC.requireVerified()` 게이트 — 챌린지 신청·게임은 대상 아님). 판정은 서버(verify-identity → `apply_identity_verification` service_role 전용), 인증 회원의 이름·번호는 화면 저장으로 못 바꾼다. **게이트는 fail-open** — 안전장치(3중 + **인앱 브라우저 통과**, 2026-08-27 오너 확정 유예 — 면제 아님)를 빼면 인프라 장애·인앱 유입이 전 기능 잠금이 된다. 채널 키는 `pay-methods.js` `identityChannel` 한 곳. 번호 서버 대조의 승인된 예외는 `save_my_profile` RPC 하나뿐 — 넓히려면 오너 확인 먼저. 상세는 auth-consent.md '휴대폰 본인인증'.
- **전화번호는 가입 필수 + 구글·카카오 이중 가입 차단(오너 확정)**: 온보딩 건너뛰기 없음. 프로필 저장은 `MONC.saveMyProfile()`(서버 대조) 한 곳 — 직접 `members.update` 로 되돌리지 말 것. 상세는 auth-consent.md '전화번호 필수'.

## 결제·유료 기능 — 판정은 서버·DB 가 한다

- 결제는 **포트원 V2 단일 경로**(간편결제 토스페이·카카오페이 — **상점·채널 키는 `pay-methods.js` 한 곳**, 페이지 하드코딩 금지), 신청·충전·이용권 저장은 **verify-payment Edge Function 경유.** **금액은 서버가 DB 에서 재확인**(`site_config.challenge_price` 등), **지급 대상은 body 가 아니라 JWT.** ⚠️ **DB 폴백 금액은 화면·서버 두 곳(`apply.html` `PRICE` ↔ verify-payment `PRICE_PER_CHALLENGE_FALLBACK`) — 한쪽만 고치지 말 것**(2026-08-02 인상 때 실사고).
- 결제 후 실패(정원 마감 `MC001`·중복 신청 `MC002`·이용권 중복 등)는 **전액 자동 환불 + HTTP 200**(non-2xx 면 supabase-js 가 본문을 감춰 브라우저가 환불 안내를 못 띄운다). 크레딧 부족·실패도 HTTP 200 + `code`.
- **미결 결제 기록은 `pay-pending.js` 공용(localStorage)** — 결제창 열기 **전에** add, **확답**(성공·확정 실패)일 때만 drop, 방문마다 조용히 재확인(sessionStorage 단건 보관으로 되돌리면 인앱 복귀 유실 사고 재발). 챌린지·특강 재확인은 `appsRetrySafe()` 가드 필수 — 상세는 apply-and-payment.md '미결 결제 기록'.
- **지급의 최종 안전망은 웹훅(portone-webhook)** — 브라우저가 영영 안 돌아와도 서버가 지급을 끝낸다. **모든 `requestPayment` 에 주문 맥락 `customData`(`k`=종류 + 대상)를 싣고, 새 결제 흐름엔 웹훅 분기를 더한다.** 통보 본문은 방아쇠일 뿐 — 서버가 포트원 API 재조회로 금액을 DB 와 대조한 뒤에만 지급한다(멱등).
- 환불(cancel-payment)에서 포트원 취소 성공 + DB 기록 실패는 `ok:true + warning` — 실패로 바꾸면 관리자가 다시 눌러 **이중 환불**이 난다.
- **돈이 걸린 판정은 전부 DB 가 원장**: 잔여석·중복 신청·세션 상태는 DB 트리거(+`for update`·advisory lock), 크레딧 잔액은 **원장(`credit_ledger`) 합계**(잔액 컬럼 금지). 브라우저 검사·클라이언트 update 로 대체 금지. 브라우저가 보낸 `answerId`·금액·슬롯도 서버가 소유·소속 재확인.
- **크레딧 공통 규칙**: 저장(직접 쓰기·소재 발굴·킬러 자동 저장)은 언제나 **무료·무제한.** 단가는 소재 2 / 킬러 3 / 첨삭 10(**가치 기준**). **하루 무료 5는 '첨삭 잠금장치'** — 첨삭 단가 이상이 되면 첨삭이 매일 공짜가 된다. 후하게 줄 땐 `grant_credit`. 차감 키는 `<대상 id>#<묶음>`(재전송 무차감). 유료 기능은 기록 count 실패 시 **차감 전에 `not_ready`** 로 멈춘다(무시하면 영구 무료 결함). **환급은 서버 전용 `refund_credit_for`(service_role)만** — `auth.uid()` 대상 RPC 를 `authenticated` 에 열면 학생이 자기 차감을 되돌린다.
- **유료 콘텐츠 비공개**: 답변 프로그램 기출은 비공개 `interview_questions` + `ap_program_view()` RPC 만(회원 전체 읽기 `questions` 금지). `program_enrollments` 자가 INSERT 정책 금지(**체험판·무료 등록 없음** — 오너 확정). `airline_profiles`·`ai_killer_terms`·`sojae_playbook` RLS 는 일반 회원에게 닫혀 있다.

## 디자인 공통

- **UI 원칙 15개와 현행 팔레트 상세 = `docs/design-principles.md`.** 요지: 활자 12px+·**입력칸 16px+**·터치 44px+·간격 8px·대비 4.5:1·**경계선 3:1**·라운드·계층·여백·그룹핑·상태를 단정하지 않기·결정 화면에 값/버튼/근거·전송량 예산·**포커스와 키보드**(div+click 금지)·값에는 그것이 무엇인지 붙이기.
- **375px 눈검사만으로는 절반이 통과한다** — 올리기 전 재는 항목표가 design-principles.md '적용 방법'에 있다.
- 팔레트는 **딥 네이비 on 쿨 화이트**: `--action`=`--accent`=`--accent-ink`=`#1B3A6B`, `--action-ink`=흰색. 다크 면 위 강조는 `--action-on-dark`, 다크 위 CTA 는 흰 알약+네이비 글씨. 새 색을 자리마다 만들지 말 것(기능색 — 에러 빨강·항공사 CI — 은 통일 대상 아님).
- **배경은 순백(`--bg #FFFFFF`) + 쿨 그레이** — 베이지·아이보리 폐기값으로 되돌리지 말 것(잉크·그림자·테두리가 한 벌). 순백 위 카드는 `--border-soft`(0.12)와 `--shadow` 로 뜬다 — 이 둘을 낮추면 카드가 배경에 녹는다. 폐기 hex 목록·상세는 design-principles.md '현행 팔레트'.
- **제목 색은 `--ink #1C2A3A`**(`tokens.css` 의 `h1,h2,h3` 전 페이지 기본값). ⚠️ 다크 배경 위 제목은 자기 규칙에 색을 명시할 것 — 상속받은 흰색이 밀려 제목이 배경에 사라진다.
- **`tokens.css` 맨 아래 '팔레트 오버라이드' 블록 삭제 금지**(CSS 변수는 미정의여도 에러 없이 글자만 사라진다 — 큰 블록을 지웠으면 `var(--x)` 미정의 사용처를 훑는다). `background-clip:text` 금지(실패 모드가 '글자 없음'). CSS 를 크게 손댔으면 **주석 짝(`/* */`) 균형을 센다.**
- **nav 는 `nav.js`+`nav.css` 전 페이지 공용** — 페이지에 nav 마크업 복사 금지, 메뉴 항목·현재 위치는 `nav.js` 의 배열·표에서만 고친다. 싣는 페이지·제외 목록(admin·login·onboarding·review-desk, `lab-*.html` 스텁 5개)은 nav.md.
- **새 페이지 체크리스트**(상세·사고 기록은 page-common.md): ① `nav.js` + `inapp.js`(인스타가 유입 1위 — 인앱 배너를 지우지 말 것) ② `<title>` 아래 og·twitter 메타 블록 복사(크롤러가 JS 를 안 돌려 스크립트 주입 무효) ③ bfcache `pageshow`+`persisted` → reload + `scroll-keep.js`(**defer 금지**) — 예외 셋: 홈·챌린지 허브 / 입력값 있는 화면 / 결제 복귀 화면(버튼만 복원) ④ 제목 꼬리표는 `[페이지 이름] — MONC 몬크` 하나뿐(`<title>`=`og:title`=`twitter:title`). `inapp.js`·`scroll-keep.js` 를 고치면 싣는 페이지의 `?v=` 도 같이 올린다.

## 기능별 문서(소스오브트루스)

| 영역 | 핵심 파일 | 어기면 안 되는 것 한 줄 | 상세 문서 |
|---|---|---|---|
| 홈 랜딩·히어로·챌린지 허브 | `index.html`·`index.css`·`challenges.html`·`blind-quiz.js` | 섹션 서사·히어로 상수·카드 규격은 전부 실측 기반 — 값 수정 전 문서 필독 | `docs/notes/home.md` |
| 공용 nav | `nav.js`·`nav.css` | 활자·정렬 값은 실측 합의값 — 임의 변경 금지, 소셜 링크는 모바일=햄버거·데스크톱=푸터 | `docs/notes/nav.md` |
| 페이지 공통 장비(bfcache·스크롤·인앱 배너·og 메타·제목) | `scroll-keep.js`·`inapp.js` | 새 페이지에 한 벌로 장착(위 체크리스트), scroll-keep `defer` 금지, 인앱 문자열은 `\uXXXX`, 수정 시 `?v=` 동반 | `docs/notes/page-common.md` |
| 신청·결제·모집일정·오픈 알림 | `apply.html`·`recruit.js`·`waitlist.js`·`pay-methods.js`·verify/cancel-payment | 참가비는 `site_config.challenge_price` 단일 소스, 모든 신청 CTA 는 apply.html 로. 취소선 정가 `challenge_list_price` 는 표시 전용(판정은 `MONC.loadChallengePricing()` 한 곳) | `docs/notes/apply-and-payment.md` |
| 특강 | `lectures.html`·`lecture.html`·`lecture-common.js` | 상세는 `lecture.html?id=` 템플릿(특강별 HTML 금지), 잔여석은 DB 트리거 | `docs/notes/lectures.md` |
| 승준 코스·승준 도구 | `briefing.html`(코스)·`tools.html`(도구) | 코스는 2026-08-25 잠시 내림(briefing→tools 리다이렉트 — 복원 절차는 briefing.md), 도구 허브는 종이 카드 리스트(2026-08-27 3안 — AI킬러·일문일답 잠시 내림, 표시 4종 · 2026-08-28 뉴스 폐지로 5→4). 카드·타일에 회원별 상태 문구·금액 금지 | `docs/notes/briefing.md` |
| 역량검사 게임 | `games.html`·`games.js` | 전부 자체 제작(타사 화면·그래픽·명칭 복제 금지), 이모지 금지 — 자체 라인 SVG 만, 무료·비회원·서버 호출 없음, 하단 '자체 도구·무관' 고지 삭제 금지 | `docs/notes/games.md` |
| 연구실 | `lab.html`·`lab-archive.html`·`lab-shelf.html`(서가 4종 공용)·`lab-viewer.js`·`researchers-data.js` | 상세는 `?shelf=` 한 파일(서가별 HTML 금지), 자료 파일은 비공개 버킷 + lab-file 서명 URL 만, PDF 는 lab-viewer 가 먼저(화면 전용 차단은 서버 유지), 값은 `lab_resources.price`(0=무료) — 채용 캘린더만 `recruit_rounds` 예외 | `docs/notes/lab.md` |
| 뉴스(폐지) | `news.html`(홈 리다이렉트 스텁만 남음) | **2026-08-28 오너 지시로 기능 전체 폐지** — 화면·수집기·Actions 삭제. 경위·복구는 news.md | `docs/notes/news.md` |
| AI킬러·항공사 프로필 | `ai-killer.html`·`supabase/functions/ai-killer` | 판정은 오너 지침 프롬프트(4기준+의심 지수+인간미 그린 플래그) — 규칙 판정으로 되돌리지 말 것. 구조화 출력·한 파일 유지, 피드백은 판정에 자동 반영 금지 | `docs/superpowers/specs/2026-07-24-ai-killer-design.md` |
| 답변 첨삭 | `polish.html`(서버는 ai-killer `mode:'polish'`) | 제출 전 프로브 게이트 유지, fix 는 학생이 쓴 사실만 | `docs/notes/polish.md` |
| 소재 발굴 v2 | `sojae.html`·`sojae-common.js`·sojae-chat | 다듬기 버튼은 2번째 답변부터 항상 노출(오너 확정), 노하우는 `sojae_playbook`(DB), 난이도는 `questions.level` 한 곳(`.eq('level')` 금지 — 미적용 환경 400), 진입은 난이도 화면 먼저 | `docs/superpowers/specs/2026-07-30-sojae-v2-design.md` |
| 답변 저장소·크레딧 | `answers.html`·`mypage.html` | 저장 무료·무제한, answers/mypage 는 같이 고친다 | `docs/notes/credits.md` |
| 마이페이지 | `mypage.html`·`submit.html`(챌린지 제출 입구) | '오늘 한 칸'엔 사이트가 아는 사실만, 접이는 데이터 있는 줄만. 제출 칸 이름·규칙은 mypage·admin·submit 세 곳 한 벌. **결제했어도 기수 시작일(`challenge_rounds.program_start`) 전엔 문항·제출 칸을 열지 않는다**(판정은 `round-gate.js` 한 곳) | `docs/notes/mypage.md` |
| 미니 다듬기(표현 수집) | `quickfix.js`(서버는 ai-killer `mode:'quickfix'`) | 프로브 게이트 유지(구버전이면 3크레딧 오차감), 300자+하루 3회는 한 쌍의 우회 방지 | `docs/notes/quickfix.md` |
| 로그인·동의 | `login.html`·`onboarding.html`·`supabase-config.js` | 동의 게이트·거부 시 파기 흐름 완화 금지 | `docs/notes/auth-consent.md` |
| admin | `admin.html` | 좌측 사이드바 셸 + '오늘' 브리핑 — 탭 추가는 그룹부터 정한다. UI 는 역할별 모양 한 벌 — **알약(`999px`) 금지.** 회원 관리 등급 판정 두 자리(`free_use` 는 delta 0 · '관심'의 신청 이력)를 건드리면 사람이 잘못 보관된다 | `docs/notes/admin.md` |
| 후기(허브·챌린지·상담·합격 수기) | `reviews.html`·`reviews-list.html`·`stories.html`·`story.html`·`review-write.html` | 목록은 `?kind=` 한 파일, 0건 종류는 카드를 안 그린다, 상담 후기 실명 미노출. 회원 제출 후기는 서버 RPC 가 `visible=false` 로(즉시 공개 금지·보상 없음). 합격 수기는 잠시 내림(복원 절차는 pages.md) | `docs/notes/pages.md` |
| 1:1 상담·네이버 예약 | `consult.html` | 네이버 예약 주소 정본은 consult.html 한 곳. 진입점 3곳 고정 — 홈 본문·nav 메뉴·플로팅 금지 | `docs/notes/pages.md` |
| 커뮤니티 오픈챗 모집 카드 | `community-card.js` | 카드는 서가·도구 2곳뿐(홈 금지 · 뉴스는 2026-08-28 폐지로 빠짐), 이 한 파일에서만 수정(두 페이지 `?v=` 동반), 주소·참여코드는 레포 반입 금지(위 '개인정보' 절) | `docs/notes/pages.md` |
| 기타 페이지(연구진·상세 5종·오디오) | `researchers.html`·`challenge-*.html` | 상세 5종 인라인 공통 CSS 는 다섯 파일을 같이 고친다 | `docs/notes/pages.md` |
| 매일 답변 프로그램 | 아래 절 | 절대 원칙 10개 먼저 읽기 | `docs/monc-answer-program/` |
| 배포·적용 시점 상태 | — | 함수 버전·마이그레이션 적용 현황은 여기서 확인 | `docs/notes/implementation-status.md` |

> 끝난 작업의 **계획서는 `docs/archive/plans/`** 에 있다 — 현행 규칙이 아니다. 설계 문서(`docs/superpowers/specs/`)도 위 표가 가리키는 둘(ai-killer·sojae-v2) 말고는 설계 시점 기록이라, 값이 notes 와 다르면 notes 가 맞다.

## 매일 답변 프로그램

**절대 원칙(오너 지시 원문 · 2026-07-30 — 같은 지시의 제품 목표·작업 방식 원문은 `docs/monc-answer-program/implementation-status.md` 'CLAUDE.md 이관 메모', 상세 요구사항은 `docs/monc-answer-program-spec.md`):**

1. 학생이 제공하지 않은 경험, 행동, 성과, 감정, 결과를 생성하지 않는다.
2. 정보가 부족하면 답변을 만들지 말고 추가 질문을 한다.
3. 학생이 먼저 초안을 작성한 뒤 AI가 첨삭한다.
4. 모든 주요 문장은 학생의 경험 및 사실과 연결돼야 한다.
5. 학생마다 같은 구조와 말투를 강제하지 않는다.
6. 기존 회원, 상품, 결제, 답변 첨삭 구조를 우선 재사용한다.
7. 학생 원문, AI 수정본, 연구원 수정본, 수정 이유를 모두 저장한다.
8. 기존 기능을 삭제하거나 임의로 변경하지 않는다.
9. 데이터베이스 변경에는 마이그레이션을 작성한다.
10. 구현 후 타입 검사, 테스트, 린트, 빌드를 실행한다.

> ⚠️ **10번의 이 레포 대응**: 이 레포엔 린트·빌드·타입 검사가 **없다**(위 '명령·검증'). 없는 명령을 지어내지 말고 `node scripts/answer-program-tests.mjs` · `deno check`(미설치) · 375px 실측 셋으로 대신한다.
> 지시 원문의 "구현 계획만 작성하고 종료하지 않는다"는 착수한 일을 계획서만 남기고 덮지 말라는 뜻 — 큰 작업 전 오너에게 방향을 확인하는 것까지 막는 규칙이 아니다.

- **근거 없는 문장 차단이 이 상품의 핵심**: 서버 `apValidateSentences` 가 근거 id 실존·자료에 없는 숫자를 검사해 unsupported 를 붙인다. 이 검증을 우회하는 코드 금지.
- **유료 기출 비공개·이용권 서버 지급**은 위 '결제·유료 기능' 절 그대로. 교재 원문·기출 SQL 은 공개 리포 커밋 금지(위 '개인정보' 절).
- **확정본은 `answers` 자유 글로 합류**(title=문항·doc_kind=interview) — 킬러·첨삭·답변노트가 붙는 연결을 끊지 말 것.
- **파일 지도·데이터 모델·화면 흐름·AI 파이프라인·테스트·구현 현황은 `docs/monc-answer-program/`**(구현 상태는 implementation-status.md).

## 절대 되살리면 안 되는 것(요지)

각 항목의 배경·실측은 괄호의 문서에 있다.

- 전체 폭 섹션 밴드 — `--bg2` 는 흰 카드 안 옅은 판 전용 (design-principles.md)
- 웜 페이퍼 배경·웜그레이 잉크 일습 — 2026-08-05 순백+쿨 그레이로 전면 교체 (design-principles.md)
- `application-modal.js`·구 index 인라인 신청 모달 — 상세 안 신청은 `lecture.html` 인라인 폼이 정본 (apply-and-payment.md)
- 보증금·환급 워딩(공개 페이지) — PG 심사 거절 사유 (apply-and-payment.md)
- 모집일정 구글시트 CSV 폴백(`RECRUIT_CSV`) (apply-and-payment.md)
- `members.sojae_enabled` 권한 스위치 — 소재는 크레딧으로 통제 (credits.md)
- 환급 RPC(`refund_credit`)를 `authenticated` 에 다시 grant (credits.md)
- `applications` INSERT 정책에서 결제 컬럼 제약 빼기 (apply-and-payment.md)
- 승준노트 카드 권한 배지(`.bf-badge`)·회원별 상태 문구 (briefing.md)
- 승준노트 B 머리의 기록 칩·'마이페이지에서 자세히' 링크 (briefing.md)
- 승준노트 매거진 목차 6줄·루트맵 룰렛·강조 세 자리 (briefing.md)
- 뉴스 기능 일습(게시판·수집기·스크랩) — 2026-08-28 오너 "뉴스 자체글 빼자"로 전체 폐지. 복구 절차·구 확정 규칙은 news.md
- 투명 nav·홈 업계 현실 숫자(0.18%)·MONC PROMISE 3단·파인더(#advisor)·홈 커뮤니티 섹션 (home.md)
- nav 강조의 깜빡이는 점(`bfPulse`)·승준노트를 nav 4번으로 내리는 안 (nav.md)
- 히어로 스크롤 구동·창 통과 줌·로고 흩날림 안·하단바 '몬크 더 알아보기' 상태 (home.md)
- 특강 카드 커버 가격 배지·backdrop-filter 유리 패널·클라이언트 잔여석 update (lectures.md)
- 블라인드 퀴즈를 상세 페이지나 두 곳 이상에 싣기 — challenges.html 하단 한 곳 확정 (home.md)
- admin '홈 커뮤니티' 탭·'기출 은행' 독립 탭 승격 (admin.md)
- admin 의 알약(`border-radius:999px`) — 역할별 모양 한 벌로 교체됨 (admin.md '알약 걷어내기')
- `rehearsal.html` 카드 숨김 해제 — 코드가 main 에 없어 404 난다(`claude/rehearsal-wip` 먼저 병합) (implementation-status.md)
- `challenge-express.html`·`challenge-speech.html` 되살리기 — 상세는 voice·expression·spinning·answer·culture 5종뿐 (pages.md)
- AI킬러 일반 텍스트 응답·함수 모듈 분리 (ai-killer 스펙)
- AI킬러 규칙 엔진 판정(사전 매칭·어미 반복·밀도 등급) — 판정은 오너 지침 종합 판정 (ai-killer 스펙)
- 첨삭(polish) 제출 전 프로브 게이트 삭제 (polish.md)
- 소재 발굴을 답변 저장의 관문으로 만들기·다듬기 버튼을 AI 판정 뒤로 숨기기 (sojae 스펙)
- admin 소재 문제의 항공사 칸(`#qfAirline`) — 소재 문제는 전 항공사 공통(답변 프로그램 기출 은행의 항공사는 그대로) (admin.md)
- 연구진 전원=챌린지 코치 전제 문구 — 현형빈은 챌린지 미지도 (pages.md)
