# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**이 문서에는 매 작업에 공통인 핵심 규칙만 남긴다.** 기능별 상세 규칙·실측값·과거 의사결정은 아래 '기능별 문서' 표의 해당 문서가 원장이다 — **기능을 고치기 전에 그 문서를 먼저 읽는다.**

## 한국어 응답 문체

사용자에게 답변할 때 짧고 자연스러운 실무 문체를 사용한다.

이 규칙은 **사용자 응답과 이 문서(CLAUDE.md) 본문에 모두 적용한다.** 단 오너 발언 인용은 원문 그대로 남긴다(사실 기록이므로).

### 기본 원칙
- 결론부터 말한다.
- 핵심 내용만 전달한다.
- 설명은 판단에 필요한 근거까지만 작성한다.
- 한 문장은 가능한 한 짧게 작성한다.
- 문단은 1~3문장으로 구성한다.
- 같은 내용을 표현만 바꿔 반복하지 않는다.
- 사용자가 이미 말한 내용을 다시 길게 요약하지 않는다.
- 불필요한 배경 설명과 일반론을 넣지 않는다.

### 말투
- 자연스러운 한국어 존댓말을 사용한다.
- 친절하되 감정 표현은 최소화한다.
- 칭찬, 공감, 추임새를 습관적으로 넣지 않는다.
- 사용자의 판단에 무조건 동의하지 않는다.
- 과장되거나 공격적인 표현을 쓰지 않는다.
- 비유, 은어, 유행어, 임의로 만든 표현을 사용하지 않는다.
- 컨설팅 보고서처럼 거창하게 표현하지 않는다.
- 실제 실무자가 업무 내용을 정리해 전달하는 방식으로 작성한다.

### 피해야 할 표현
다음과 같은 표현을 사용하지 않는다.
- 이 판이 낫다
- 구멍이 크다
- 남는 물건이 다르다
- 팔 거리가 된다
- 전부 무너진다
- 본질은 이것이다
- 핵심은 단 하나다
- 정확히 짚으셨습니다
- 아주 좋은 판단입니다
- 완전히 맞습니다

평범하고 정확한 표현으로 바꾼다. 예시:
- "구멍이 크다" → "이 부분은 수정이 필요합니다."
- "이 판이 낫다" → "이 방향이 더 적합합니다."
- "팔 거리가 된다" → "상품의 차별점으로 활용할 수 있습니다."
- "전부 무너진다" → "기존 원칙과 충돌할 수 있습니다."

### 답변 구성
기본적으로 다음 순서를 따른다.
1. 결론
2. 핵심 이유
3. 필요한 대안 또는 다음 작업

내용이 간단하면 제목이나 목록 없이 바로 답한다.

### 출력 전 점검
답변을 출력하기 전에 다음을 확인한다.
- 더 짧게 줄일 수 있는 문장이 있는가?
- 같은 내용을 반복했는가?
- 없어도 이해되는 문장이 들어갔는가?
- 한국인이 잘 쓰지 않는 표현이 있는가?
- 불필요한 칭찬이나 공감 표현이 있는가?

문제가 있으면 삭제하거나 간결하게 수정한 뒤 최종 답변만 출력한다.

## 프로젝트 구조

MONC(몬크 챌린지) — 승무원 준비생 대상 챌린지·면접 준비 도구 사이트. **정적 사이트, 빌드 단계 없음.** GitHub Pages 가 `main` 을 그대로 서빙한다(https://kwonsunghoho.github.io/wkon/). 프레임워크·번들러·package.json·테스트 스위트 없음 — 손으로 쓴 HTML/CSS/JS.

서버는 없고, "백엔드"는 브라우저가 부르는 외부 서비스다.

1. **Google Apps Script**(레거시 신청·후기 시트) — 이 레포가 아니라 구글 콘솔에서 수정·재배포한다. 신청은 항상 새 행 append.
2. **Supabase**(`supabase-config.js`, `MONC.sb`) — 회원·신청·후기·site_config·계측·도구 테이블 전부. 테이블·RLS·컬럼은 오너가 콘솔에서 만든다.
3. **모집일정 = Supabase `challenge_rounds` 단일 소스**(admin '챌린지' 탭에서 CRUD). 구 구글시트 CSV 폴백은 완전 제거 — 재도입 금지.
4. **뉴스 수집기**(GitHub Actions 3시간 주기, `scripts/fetch-news.mjs`) — 유일하게 브라우저 밖에서 도는 코드.

The repo is sometimes edited from a git **worktree** under `.claude/worktrees/...` on a `claude/*` branch; the canonical checkout is the repo root on `main`.

## 명령·검증

- 로컬 프리뷰: `python -m http.server 5500` → `http://localhost:5500/` (`.claude/launch.json` 의 `wkon-static`).
- 배포: `git push origin main` — 푸시가 곧 배포다(1~2분 전파).
- **`node` 는 앞에 로더를 붙여야 잡힌다**(2026-08-03 nvm 으로 설치, v24.18.1): `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node scripts/<파일>.mjs`. nvm 은 `~/.zshrc` 에만 설정을 넣는데 자동 실행 셸(플러그인 훅·스크립트)은 그 파일을 안 읽는다 — 로더 없이 `node` 만 치면 `command not found` 가 뜨지만 **미설치가 아니다. 다시 깔라고 안내하지 말 것.** `python3` 는 `/usr/bin/python3` 라 그냥 쓴다. **`deno` 는 아직 없다.**
- **전체 lint·build·테스트 시스템이 없다. 존재하지 않는 lint/build 명령을 만들지 말 것.** 검증 수단은 아래가 전부다.
  - **브라우저 렌더 확인 — 375px 우선**(트래픽 99%가 모바일). 올리기 전 필수.
  - AI킬러 규칙: `node scripts/ai-killer-dryrun.mjs` — 기준선 비교('사람이 잘 쓴 글' 0곳 유지 확인).
  - 항공사 문항 매칭: `node scripts/ai-killer-qmatch.mjs` — 임계값·유사도 식 변경 시.
  - 뉴스 필터: `python3 scripts/verify-news-rules.py` — 실데이터 RSS 에 대고 '버린 목록'을 눈으로 확인(`--old` 는 기준선).
  - 답변 프로그램: `node scripts/answer-program-tests.mjs`(2026-08-03 실측 68 통과/0 실패) + `deno check supabase/functions/answer-program/index.ts`(**deno 미설치 — 현재 못 돌린다**) + 375px 브라우저 실측.

### ⚠️ 어디에 푸시할까 — 오너 확정(2026-07-30)
**눈으로 보고 판단하는 수정(레이아웃·문구·색·애니메이션)은 `main` 직행.** 브랜치를 거치지 말 것 — GitHub Pages 가 `main` 만 서빙해서 **브랜치는 오너가 폰으로 미리 볼 방법이 없다.** 확인이 어차피 합친 뒤에 일어나므로 브랜치는 단계만 늘리고, 실제로 "왜 적용이 안 되냐"는 사고가 났다(오너가 라이브를 보고 있는데 작업은 브랜치에 있었다). 되돌리기는 `git revert` + 푸시로 1~2분이면 되니 브랜치 여부와 무관하다.
**잘못되면 돈·데이터가 걸리는 것은 브랜치**: 신청·결제 흐름, Supabase 마이그레이션, 로그인·동의 게이트, 큰 구조 변경. 라이브가 깨지는 몇 분이 실제 손해인 자리들이다.
⚠️ 어느 쪽이든 **올리기 전에 실제 브라우저로 렌더해서 확인**하는 게 진짜 안전장치다(브랜치가 아니라). 375px 부터.

## 데이터 안전 공통 규칙

- **마이그레이션은 레포가 소스지만, 오너가 Supabase SQL Editor 에서 실행해야 반영된다.** 미적용 상태에서도 조용히 degrade 해야 한다: 목록 조회는 `select('*')`(컬럼 나열 시 미적용 환경에서 400), 신규 컬럼은 `getMyProfile()` 같은 공용 셀렉트에 넣지 않는다(`major`·`agreed_at`·`refunded_amount` 전례).
- **SQL·마이그레이션 본문은 파일 경로가 아니라 대화창에 ```sql 코드로 붙여넣는다.** 오너는 콘솔 SQL Editor 에 붙여넣는다(경로를 bash 블록으로 주면 Run 버튼이 터미널을 연다).
- **Edge Function 배포는 Supabase 콘솔에서 한다**(오너 PC 에 CLI 없음 — `supabase functions deploy` 안내 금지). 함수는 **한 파일 유지**(콘솔 붙여넣기 배포라 모듈로 쪼개면 배포 불가). 코드를 고치면 `FN_VERSION` 도 같이 올리고, **배포 여부는 anon key 프로브로 확인한다 — 관리자에게 SQL 을 시키지 말 것.**
- 테이블 미생성 판정은 `42P01` 이 아니라 **`PGRST205`** 다.
- 함수 배포·마이그레이션 적용 같은 **시점 상태는 `docs/notes/implementation-status.md`** 에서 확인·갱신한다.
- Dead code 는 남기지 말고 제거한다. 타임스탬프 백업 파일 커밋 금지. 커밋 메시지·코드 주석은 한국어.

## 회원·로그인·동의·개인정보 — 법적 필수(완화 금지)

- **동의는 가입 시 딱 한 번.** OAuth 복귀 후 `hasConsented()` false 면 동의 게이트(`login.html #consentView`). **체크박스 사전 체크·"간주 동의"·게이트 삭제 금지.** 약관 개정 시 `supabase-config.js` 의 `TERMS_VERSION` 을 올리면 전원 재동의.
- **동의 3대 함정**(되돌리면 법적 리스크): ① 로컬 동의 캐시는 **계정별 키** `monc_consent_v1:<uid>` ② **거부 = 즉시 파기**(`MONC.deleteMyAccount()` — 로그아웃만 하면 미동의자 개인정보 잔존) ③ **회원 페이지 전부 `MONC.requireConsent()` 가드**(한 곳 빠지면 주소창 우회).
- 신청·명단 폼의 필수 동의 체크(`apply.html #appConsent` · `lecture.html` · `waitlist.js #wlAgree`)는 미체크 시 제출 차단 — **삭제·완화 금지.** 법적 고지 활자도 12px 하한.
- **개인정보·학원 자산 반입 금지**: 합격 자소서 원문, 정규반 교재의 기출·가이던스, 소재 노하우(`sojae_playbook`)는 레포·공개 테이블 어디에도 넣지 않는다(비공개 테이블 + SQL 대화창 전달). **합격자 문장을 AI 프롬프트 예시로 주지 않는다.** 자료는 파일명이 아니라 본문 출처로 확인.
- **보증금·환급 워딩을 공개 페이지에 재도입하지 말 것**(2026-07-20 폐지 — PG 심사 거절 사유).
- **전화번호로 남을 조회할 창구를 만들지 않는다** — 비회원 중복 신청 사전 조회, 오픈 알림 명단 본인 조회를 일부러 안 연 이유(번호만으로 신청·관심 여부가 캐진다).
- **bfcache**: 외부(OAuth·결제)로 나갔다 뒤로 돌아오는 화면은 상태를 되돌린다 — 입력값 없는 화면은 `pageshow` 에 reload(login·mypage·answers), 입력값 있는 화면은 버튼만 복원(apply·lecture). 외부로 나가는 버튼을 새로 만들면 이 처리를 같이 단다.

## 결제·유료 기능 — 판정은 서버·DB 가 한다

- 결제는 **포트원 V2 단일 경로**, 신청·충전·이용권 저장은 **verify-payment Edge Function 경유.** **금액은 브라우저를 믿지 않고 서버가 DB 에서 재확인**(`site_config.challenge_price`·`special_lectures.price`·`site_config.credit_packs`·`answer_programs.price`), **지급 대상은 body 가 아니라 JWT.**
- 결제 후 실패(특강 정원 마감 `MC001`·중복 신청 `MC002`·이용권 중복 등)는 **전액 자동 환불 + HTTP 200** 으로 응답한다(non-2xx 면 supabase-js 가 본문을 감춰 브라우저가 환불 안내를 못 띄운다). 크레딧 부족·실패도 HTTP 200 + `code`.
- 환불(cancel-payment)에서 포트원 취소 성공 + DB 기록 실패는 `ok:true + warning` — 실패로 바꾸면 관리자가 다시 눌러 **이중 환불**이 난다.
- **돈이 걸린 판정은 전부 DB 가 원장이다**: 잔여석·중복 신청·답변 프로그램 세션 상태는 DB 트리거(+`for update` 행 잠금·advisory lock), 크레딧 잔액은 **원장(`credit_ledger`) 합계**(잔액 컬럼 금지). 브라우저 검사·클라이언트 update 로 대체 금지. 브라우저가 보낸 `answerId`·금액·슬롯도 서버가 소유·소속을 재확인.
- **크레딧 공통 규칙**: 저장은 언제나 **무료·무제한**(글이 저장소로 들어오는 세 길 — 직접 쓰기·소재 발굴·킬러 자동 저장 — 어느 것도 막지 말 것). 단가는 소재 2 / 킬러 3 / 첨삭 10(**가치 기준** — 원가 비율로 되돌리지 말 것). **하루 무료 5는 지급량 조절값이 아니라 '첨삭 잠금장치'** — 첨삭 단가(10) 이상이 되는 순간 첨삭이 매일 공짜가 된다. 후하게 줄 땐 `grant_credit` 일괄 지급. 차감 키는 `<대상 id>#<묶음>` 패턴(재전송·허용된 재검사가 무차감). 유료 기능은 기록 테이블 count 실패 시 **차감 전에 `not_ready`** 로 멈춘다(무시하면 영구 무료 결함 — polish p-1 전례).
- **유료 콘텐츠 비공개**: 답변 프로그램 기출은 회원 전체 읽기인 `questions` 에 넣지 않는다 — 비공개 `interview_questions` + `ap_program_view()` RPC 만. `program_enrollments` 에 회원 자가 INSERT 정책 금지(**체험판·무료 등록 없음** — 오너 확정). `airline_profiles`·`ai_killer_terms`·`sojae_playbook` RLS 는 일반 회원에게 닫혀 있다.

## 디자인 공통

- **UI 원칙 15개와 현행 팔레트 상세 = `docs/design-principles.md`**(2026-08-02 재검토로 구 '9대 원칙'을 대체). 요지: 활자 12px+·**입력칸 16px+** · 터치 44px+·**간격 8px** · 대비 4.5:1·**경계선 3:1** · 라운드·계층·여백·그룹핑 · **상태를 단정하지 않기** · **결정 화면에 값·버튼·근거** · **전송량 예산** · **포커스와 키보드**(div+click 금지 — role·tabindex·Enter/Space 가 한 벌) · **값에는 그것이 무엇인지 붙이기**(카드 구석 '1기' 처럼 값만 남으면 오타로 읽힌다).
- **375px 눈검사만으로는 절반이 통과한다**(2026-08-02 교훈 — 입력칸 15px·전송량 3.8MB·경계 대비 1.38:1·320px 잘림이 전부 그렇게 통과했다). 올리기 전 재는 항목표가 design-principles.md '적용 방법'에 있다.
- 팔레트는 **딥 네이비 on 웜 페이퍼**(2026-07-29 오렌지 전면 폐지): `--action`=`--accent`=`--accent-ink`=`#1B3A6B`, `--action-ink`=흰색. **다크 면 위 강조는 `--action-on-dark`, 다크 위 CTA 는 흰 알약+네이비 글씨.** 새 색을 자리마다 만들지 말 것. 기능색(에러 빨강·항공사 CI·브랜드색)은 통일 대상이 아니다.
- **`tokens.css` 맨 아래 '팔레트 오버라이드' 블록 삭제 금지**(실사고 — CSS 변수는 미정의여도 에러 없이 글자만 사라진다). 큰 블록을 지웠으면 `var(--x)` 미정의 사용처를 훑는다. `background-clip:text` 로 글자를 칠하지 말 것(실패 모드가 '글자 없음').
- CSS 를 크게 손댔으면 **주석 짝(`/* */`) 균형을 센다** — 주석 안 클래스 나열의 별표+슬래시가 규칙 하나를 조용히 삼킨 실사고 2건.
- **nav 는 `nav.js`+`nav.css` 전 페이지 공용** — 페이지에 nav 마크업 복사 금지(admin·login·onboarding 은 일부러 제외). 메뉴 항목·현재 위치는 `nav.js` 의 배열·표에서만 고친다.
- **`inapp.js` 도 전 페이지 공용(login 포함) — 지우지 말 것.** 인앱 브라우저(인스타·카톡)는 **파일 다운로드를 막고 구글 OAuth 를 거부한다**(2026-08-01 실사고 — 인스타 유입 학생이 무료 자료를 못 받았다). 인앱이면 **nav 아래 상단 한 줄 안내**(오너 확정 — 전체 화면 덮개는 기각 "장난치냐? 그냥 상단 설명으로 바꿔"). 형태 규칙 셋: ① `position:fixed` + `top=#navbar 실측 높이`(흐름 안 배너 금지 — nav 와 글자가 겹쳐 깨진 실사고) ② **화면 문자열은 전부 `\uXXXX` 이스케이프**(생성기 주석 참조 — 한글 리터럴 직접 넣기 금지) ③ 파일을 고치면 **`?v=` 캐시 버스터도 같이 올린다**(인앱 웹뷰가 캐시를 안 버려 깨진 옛 화면이 계속 보인 실사고). 자동 이동 없음 — 버튼을 눌렀을 때만 안드로이드 크롬 인텐트 / 아이폰 주소 복사. **인스타가 유입 1위라 이 자리가 막히면 유입 전체가 막힌다.** 새 페이지를 만들면 `nav.js` 옆에 같이 넣는다. ⚠️ **비동기 응답 뒤 `window.open` 으로 파일을 열지 말 것**(인앱이 조용히 막는다 — 받기는 `location.href`).
- **새 페이지를 만들면 `<title>` 아래 og·twitter 메타 블록을 복사해 넣는다**(다른 페이지 head 에서 그대로 가져와 url·title·description만 교체). 카톡·DM 링크 미리보기용이라 **크롤러가 JS 를 안 돌린다 — nav 처럼 스크립트로 심으면 무효**다. 빠지면 로고 없이 제목만 뜬다(2026-08-01 실사고 — index 말고 28개 페이지 전부 비어 있었다).
- **제목 꼬리표는 `[페이지 이름] — MONC 몬크` 하나뿐**(2026-08-03 오너 확정 — 홈 `index.html` 만 브랜드 문장 `MONC 몬크 — 승무원 준비의 새로운 기준` 예외). 사이트가 챌린지보다 넓어졌는데 꼬리표가 손으로 적히다 6가지로 갈렸고, **자료실·뉴스·약관까지 '몬크 챌린지'로 떠서 오너가 지적했다.** `· MONC`·`| MONC`·`— MONC`·`MONC 로그인` 같은 변형을 다시 만들지 말 것. **`<title>`·`og:title`·`twitter:title` 세 값은 항상 같다** — 미리보기는 og 를, 주소창·검색 결과는 `<title>` 을 읽어서 한 곳만 고치면 화면마다 다른 이름이 뜬다. 페이지 이름의 부제는 가운뎃점으로 붙인다(`보.신.각 · 보이스 신분상승 각 — MONC 몬크`). ⚠️ **`document.title` 을 다시 쓰는 페이지도 같이 고친다**(`lab-shelf.html`·`program.html`·`story.html`·`reviews-list.html`).

## 기능별 문서(소스오브트루스)

| 영역 | 핵심 파일 | 어기면 안 되는 것 한 줄 | 상세 문서 |
|---|---|---|---|
| 홈 랜딩·히어로·챌린지 허브 | `index.html`·`index.css`·`challenges.html`·`blind-quiz.js` | 섹션 서사·히어로 상수·카드 규격은 전부 실측 기반 — 값 수정 전 문서 필독 | `docs/notes/home.md` |
| 공용 nav | `nav.js`·`nav.css` | 활자·정렬 값은 실측 합의값 — 임의 변경 금지 | `docs/notes/nav.md` |
| 신청·결제·모집일정·오픈 알림 | `apply.html`·`recruit.js`·`waitlist.js`·verify/cancel-payment | 참가비는 `site_config.challenge_price` 단일 소스, 모든 신청 CTA 는 apply.html 로 | `docs/notes/apply-and-payment.md` |
| 특강 | `lectures.html`·`lecture.html`·`lecture-common.js` | 상세는 `lecture.html?id=` 템플릿(특강별 HTML 금지), 잔여석은 DB 트리거 | `docs/notes/lectures.md` |
| 승준노트 허브 | `briefing.html` | 이름은 화면 글자만 '승준노트'(파일·클래스명 유지), 카드에 회원별 상태 문구 금지 | `docs/notes/briefing.md` |
| 연구실 | `lab.html`(허브)·`lab-archive.html`(원장)·`lab-shelf.html`(서가 5종 공용)·`researchers-data.js` | 허브는 카드 두 장·원장은 카드형·상세는 `?shelf=` 한 파일(서가별 HTML 금지), 자료 파일은 비공개 버킷 + lab-file 서명 URL 로만(공개 URL 금지), 숫자는 `lab_shelf_counts()` 실측값만, **값은 자료마다 `lab_resources.price`(0=무료) — 자료 테이블을 새로 만들지 말 것** | `docs/notes/lab.md` |
| 뉴스 | `news.html`·`scripts/fetch-news.mjs` | 필터는 픽커+바텀시트(칩 나열 회귀 금지), 규칙 수정 시 verify-news-rules.py | `docs/notes/news.md` |
| AI킬러·항공사 프로필 | `ai-killer.html`·`supabase/functions/ai-killer` | 구조화 출력·한 파일 유지, 감점 사전은 admin 탭(DB) | `docs/superpowers/specs/2026-07-24-ai-killer-design.md` |
| 답변 첨삭 | `polish.html`(서버는 ai-killer 의 `mode:'polish'`) | 제출 전 프로브 게이트 유지, fix 는 학생이 쓴 사실만 | `docs/notes/polish.md` |
| 소재 발굴 v2 | `sojae.html`·`sojae-common.js`·sojae-chat | 다듬기 버튼은 2번째 답변부터 항상 노출(오너 확정), 노하우는 `sojae_playbook`(DB) | `docs/superpowers/specs/2026-07-30-sojae-v2-design.md` |
| 답변 저장소·크레딧 | `answers.html`·`mypage.html` | 저장 무료·무제한, answers/mypage 는 같이 고친다 | `docs/notes/credits.md` |
| 마이페이지 | `mypage.html` | '오늘 한 칸'엔 사이트가 아는 사실만(제출 여부 문장 금지), 접이는 데이터 있는 줄만 | `docs/notes/mypage.md` |
| 미니 다듬기(표현 수집) | `quickfix.js`(서버는 ai-killer 의 `mode:'quickfix'`) | 프로브 게이트 유지(구버전이면 3크레딧 오차감), 300자+하루 3회는 한 쌍의 우회 방지 | `docs/notes/quickfix.md` |
| 로그인·동의 | `login.html`·`onboarding.html`·`supabase-config.js` | 동의 게이트·거부 시 파기 흐름 완화 금지 | `docs/notes/auth-consent.md` |
| admin | `admin.html` | 좌측 사이드바 셸(운영/상품/콘텐츠 그룹) + '오늘' 브리핑 — 탭을 추가하면 어느 그룹인지부터 정한다 | `docs/notes/admin.md` |
| 후기(허브·챌린지·상담·합격 수기) | `reviews.html`(허브)·`reviews-list.html`(목록 공용)·`stories.html`·`story.html` | 목록은 `?kind=` 한 파일(종류별 HTML 금지), 자료 0건인 종류는 카드를 안 그린다, **상담 후기는 실명 미노출** | `docs/notes/pages.md` |
| 기타 페이지(연구진·상세 4종·오디오) | `researchers.html`·`challenge-*.html` | 상세 4종 인라인 공통 CSS 는 네 파일을 같이 고친다 | `docs/notes/pages.md` |
| 매일 답변 프로그램 | 아래 절 | 절대 원칙 10개 먼저 읽기 | `docs/monc-answer-program/` |
| 배포·적용 시점 상태 | — | 함수 버전·마이그레이션 적용 현황은 여기서 확인 | `docs/notes/implementation-status.md` |

## 매일 답변 프로그램

### MONC 답변 프로그램 개발 원칙 (오너 지시 원문 · 2026-07-30)

#### 제품 목표

항공사별 기출문제를 매일 작성하며 학생의 실제 경험을 바탕으로
개인화된 면접답변을 완성하는 프로그램을 개발한다.

상세 요구사항은 다음 문서를 따른다.

`docs/monc-answer-program-spec.md`

#### 절대 원칙

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

#### 작업 방식

- 먼저 기존 저장소 구조를 분석한다.
- 저장소에서 확인 가능한 내용은 사용자에게 다시 묻지 않는다.
- 구현 계획만 작성하고 종료하지 않는다.
- 기능을 작은 수직 단위로 구현하고 검증한다.
- 완료하지 못한 내용은 정확하게 기록한다.

### 작업 규칙 요약

- **파일**: `programs.html`(허브) · `program.html`(작성 흐름) · `experiences.html`(경험 창고) · `review-desk.html`(연구원 검수 — `reviews.html` 후기와 다른 파일) · admin '답변 프로그램' 탭 · `supabase/functions/answer-program/index.ts`(한 파일·프로브 있음) · migration `20260730150000_answer_program.sql`.
- **근거 없는 문장 차단이 이 상품의 핵심**: 서버 `apValidateSentences` 가 근거 id 실존·자료에 없는 숫자를 검사해 unsupported 를 붙인다(화면 빨간 표시·'이 버전으로 다듬기' 제외). 이 검증을 우회하는 코드 금지.
- **유료 기출 비공개**: `questions`(회원 전체 읽기) 반입 금지 — 비공개 `interview_questions` + `ap_program_view()` RPC 만. 교재 원문·기출 SQL 은 공개 리포 커밋 금지.
- **이용권은 서버가 지급**: verify-payment `programId` 분기(JWT 지급·`answer_programs.price` 재확인·중복 구매 전액 환불) 또는 admin '이용권 지급' 둘뿐. 자가 INSERT·체험판·무료 등록 없음.
- **확정본은 `answers` 자유 글로 합류**(title=문항·doc_kind=interview) — 킬러·첨삭·답변노트가 무수정으로 붙는 연결을 끊지 말 것.
- **전용 검증 명령**: `node scripts/answer-program-tests.mjs` · `deno check supabase/functions/answer-program/index.ts` · 375px 브라우저 실측.
- **상세 문서**: 데이터 모델·화면 흐름·AI 파이프라인·테스트·구현 현황은 `docs/monc-answer-program/`(구현 상태는 `implementation-status.md`). 오너 원본 요구사항은 `docs/monc-answer-program-spec.md`.

## 절대 되살리면 안 되는 것(요지)

각 항목의 배경·실측은 괄호의 문서에 있다.

- `application-modal.js`·구 index 인라인 신청 모달 — 상세 안 신청은 `lecture.html` 인라인 폼이 정본 패턴 (apply-and-payment.md)
- 보증금·환급 워딩(공개 페이지) — PG 심사 거절 사유 (apply-and-payment.md)
- 모집일정 구글시트 CSV 폴백(`RECRUIT_CSV`) (apply-and-payment.md)
- `members.sojae_enabled` 권한 스위치 방식 — 소재는 크레딧으로 통제 (credits.md)
- 승준노트 카드 권한 배지(`.bf-badge`)·'첫 1회 무료' 같은 회원별 상태 문구 (briefing.md)
- 뉴스 필터 칩 나열 sticky 바·리본 북마크·라벨 없는 스크랩 아이콘 (news.md)
- 투명 nav(`nav-transparent`)·홈 업계 현실 숫자(0.18%)·MONC PROMISE 3단·파인더(#advisor)·홈 커뮤니티 섹션 (home.md)
- 히어로 스크롤 구동·창 통과 줌·로고 흩날림 안·하단바 '몬크 더 알아보기' 상태 (home.md)
- 특강 카드 커버 가격 배지·backdrop-filter 유리 패널·클라이언트 잔여석 update (lectures.md)
- 블라인드 퀴즈를 상세 페이지나 두 곳 이상에 싣기 — challenges.html 하단 한 곳 확정 (home.md)
- admin '홈 커뮤니티' 탭·'기출 은행' 독립 탭 승격(상품>답변 프로그램 서브탭 유지 — 오너 확정) (admin.md)
- `rehearsal.html` 카드 숨김 해제 — 코드가 main 에 없어 404 난다(`claude/rehearsal-wip` 먼저 병합) (implementation-status.md)
- `challenge-express.html`·`challenge-speech.html` — legacy, 편집 금지 (pages.md)
- AI킬러 일반 텍스트 응답·규칙 엔진 모듈 분리 (ai-killer 스펙)
- 첨삭(polish) 제출 전 프로브 게이트 삭제 (polish.md)
- 소재 발굴을 답변 저장의 관문으로 만들기·다듬기 버튼을 AI 판정 뒤로 숨기기 (sojae 스펙)
- 연구진 전원=챌린지 코치 전제 문구 — 현형빈은 챌린지 미지도 (pages.md)
