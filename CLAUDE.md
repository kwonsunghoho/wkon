# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**이 문서에는 매 작업에 공통인 핵심 규칙만 남긴다.** 기능별 상세 규칙·실측값·과거 의사결정은 아래 '기능별 문서' 표의 해당 문서가 원장이다 — **기능을 고치기 전에 그 문서를 먼저 읽는다.**

⚠️ **파일을 지우거나 이름·주소·설정을 바꿨으면, 그 이름을 `CLAUDE.md` 와 `docs/` 에서 검색해 같이 고친다.** 2026-08-03 감사에서 나온 문서 오류 5건 중 3건이 이 누락이었다 — 지워진 파일이 '편집 금지'로 남아 있었고, 라이브 도메인과 프리뷰 설정이 바뀐 채 옛 값으로 적혀 있었다. 문서가 틀리면 다음 작업이 틀린 전제로 시작한다.

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

특히 걸리는 두 부류: 과장된 비유("전부 무너진다"·"구멍이 크다")와 맞장구("정확히 짚으셨습니다"·"아주 좋은 판단입니다"). 평범하고 정확한 서술로 바꾼다 — "이 부분은 수정이 필요합니다", "이 방향이 더 적합합니다".

### 답변 구성
기본적으로 다음 순서를 따른다.
1. 결론
2. 핵심 이유
3. 필요한 대안 또는 다음 작업

내용이 간단하면 제목이나 목록 없이 바로 답한다.

## 프로젝트 구조

MONC(몬크 챌린지) — 승무원 준비생 대상 챌린지·면접 준비 도구 사이트. **정적 사이트, 빌드 단계 없음.** GitHub Pages 가 `main` 을 그대로 서빙하고, **라이브 주소는 `CNAME` 의 커스텀 도메인 https://monc.ai.kr** 이다(github.io 주소는 이리로 넘어온다 — 오너·계측이 보는 곳은 언제나 monc.ai.kr). 프레임워크·번들러·package.json·테스트 스위트 없음 — 손으로 쓴 HTML/CSS/JS.

서버는 없고, "백엔드"는 브라우저가 부르는 외부 서비스다.

1. **Google Apps Script**(레거시 신청·후기 시트) — 이 레포가 아니라 구글 콘솔에서 수정·재배포한다. 신청은 항상 새 행 append.
2. **Supabase**(`supabase-config.js`, `MONC.sb`) — 회원·신청·후기·site_config·계측·도구 테이블 전부. 테이블·RLS·컬럼은 오너가 콘솔에서 만든다.
3. **모집일정 = Supabase `challenge_rounds` 단일 소스**(admin '챌린지' 탭에서 CRUD — CSV 폴백 금지는 아래 '절대 되살리면 안 되는 것').
4. **뉴스 수집기**(GitHub Actions 3시간 주기, `scripts/fetch-news.mjs`) — 유일하게 브라우저 밖에서 도는 코드.

The repo is sometimes edited from a git **worktree** under `.claude/worktrees/...` on a `claude/*` branch; the canonical checkout is the repo root on `main`.

## 명령·검증

- 로컬 프리뷰: `.claude/launch.json` 의 **`wkon-mirror`**(포트 5761)를 `preview_start` 로 띄운다. ⚠️ **레포를 직접 서빙하지 못한다** — 프리뷰가 띄운 파이썬은 macOS 권한 때문에 `~/Documents` 를 못 읽어 전부 404 다. 스크래치패드에 rsync 미러를 만들어 그걸 서빙하는 구조라 **세션이 바뀌면 `runtimeArgs` 경로가 죽는다**(미러·`server.py` 재생성 후 경로 갱신). 소스를 고치면 rsync 를 다시 돌려야 화면에 반영된다.
- 배포: `git push origin main` — 푸시가 곧 배포다(1~2분 전파).
- **`node` 는 앞에 로더를 붙여야 잡힌다**(2026-08-03 nvm 으로 설치, v24.18.1): `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node scripts/<파일>.mjs`. nvm 은 `~/.zshrc` 에만 설정을 넣는데 자동 실행 셸(플러그인 훅·스크립트)은 그 파일을 안 읽는다 — 로더 없이 `node` 만 치면 `command not found` 가 뜨지만 **미설치가 아니다. 다시 깔라고 안내하지 말 것.** `python3` 는 `/usr/bin/python3` 라 그냥 쓴다. **`deno` 는 아직 없다.**
- **전체 lint·build·테스트 시스템이 없다. 존재하지 않는 lint/build 명령을 만들지 말 것.** 검증 수단은 아래가 전부다.
  - **브라우저 렌더 확인 — 375px 우선**(트래픽 99%가 모바일). 올리기 전 필수.
  - 항공사 문항 매칭: `node scripts/ai-killer-qmatch.mjs` — 임계값·유사도 식 변경 시(첨삭이 쓴다). 구 `ai-killer-dryrun.mjs` 는 2026-08-12 규칙 판정 폐지와 함께 삭제됐다.
  - 뉴스 필터: `python3 scripts/verify-news-rules.py` — 실데이터 RSS 에 대고 '버린 목록'을 눈으로 확인(`--old` 는 기준선).
  - 답변 프로그램: `node scripts/answer-program-tests.mjs`(2026-08-03 실측 68 통과/0 실패) + `deno check supabase/functions/answer-program/index.ts`(**deno 미설치 — 현재 못 돌린다**) + 375px 브라우저 실측.

### ⚠️ 어디에 푸시할까 — 오너 확정(2026-07-30)
**눈으로 보고 판단하는 수정(레이아웃·문구·색·애니메이션)은 `main` 직행.** 브랜치를 거치지 말 것 — GitHub Pages 가 `main` 만 서빙해서 **브랜치는 오너가 폰으로 미리 볼 방법이 없다.** 확인이 어차피 합친 뒤에 일어나므로 브랜치는 단계만 늘리고, 실제로 "왜 적용이 안 되냐"는 사고가 났다(오너가 라이브를 보고 있는데 작업은 브랜치에 있었다). 되돌리기는 `git revert` + 푸시로 1~2분이면 되니 브랜치 여부와 무관하다.
**잘못되면 돈·데이터가 걸리는 것은 브랜치**: 신청·결제 흐름, Supabase 마이그레이션, 로그인·동의 게이트, 큰 구조 변경. 라이브가 깨지는 몇 분이 실제 손해인 자리들이다.
⚠️ 어느 쪽이든 **올리기 전에 실제 브라우저로 렌더해서 확인**하는 게 진짜 안전장치다(브랜치가 아니라). 375px 부터.

## 데이터 안전 공통 규칙

- **마이그레이션은 레포가 소스지만, 오너가 Supabase SQL Editor 에서 실행해야 반영된다.** 미적용 상태에서도 조용히 degrade 해야 한다: 목록 조회는 `select('*')`(컬럼 나열 시 미적용 환경에서 400), 신규 컬럼은 `getMyProfile()` 같은 공용 셀렉트에 넣지 않는다(`major`·`agreed_at`·`refunded_amount` 전례).
- **SQL·마이그레이션 본문은 파일 경로가 아니라 대화창에 ```sql 코드로 붙여넣는다.** 오너는 콘솔 SQL Editor 에 붙여넣는다(경로를 bash 블록으로 주면 Run 버튼이 터미널을 연다).
- **Edge Function 배포는 Supabase 콘솔에서 한다**(오너 PC 에 CLI 없음 — `supabase functions deploy` 안내 금지). 함수는 **한 파일 유지**(콘솔 붙여넣기 배포라 모듈로 쪼개면 배포 불가). 코드를 고치면 `FN_VERSION` 도 같이 올리고, **배포 여부는 anon key 프로브로 확인한다 — 관리자에게 SQL 을 시키지 말 것.** **새 함수를 만들면 `FN_VERSION` 과 `probe:true` 분기를 처음부터 넣는다** — 인증 검사보다 **앞에** 둔다(배포 여부는 로그인 없이 확인할 수 있어야 한다). 현재 7개 함수 전부 있다. ⚠️ **portone-webhook 만 콘솔에서 JWT 검증을 끈다**(포트원이 부르는 함수라 Supabase 키가 없다) — 다른 함수는 끄지 말 것.
- 테이블 미생성 판정은 `42P01` 이 아니라 **`PGRST205`** 다.
- 함수 배포·마이그레이션 적용 같은 **시점 상태는 `docs/notes/implementation-status.md`** 에서 확인·갱신한다.
- Dead code 는 남기지 말고 제거한다. 타임스탬프 백업 파일 커밋 금지. 커밋 메시지·코드 주석은 한국어.

## 회원·로그인·동의·개인정보 — 법적 필수(완화 금지)

- **동의는 가입 시 딱 한 번.** OAuth 복귀 후 `hasConsented()` false 면 동의 게이트(`login.html #consentView`). **체크박스 사전 체크·"간주 동의"·게이트 삭제 금지.** 약관 개정 시 `supabase-config.js` 의 `TERMS_VERSION` 을 올리면 전원 재동의.
- **동의 3대 함정**(되돌리면 법적 리스크): ① 로컬 동의 캐시는 **계정별 키** `monc_consent_v1:<uid>` ② **거부 = 즉시 파기**(`MONC.deleteMyAccount()` — 로그아웃만 하면 미동의자 개인정보 잔존) ③ **회원 페이지 전부 `MONC.requireConsent()` 가드**(한 곳 빠지면 주소창 우회).
- 신청·명단 폼의 필수 동의 체크(`apply.html #appConsent` · `lecture.html` · `waitlist.js #wlAgree`)는 미체크 시 제출 차단 — **삭제·완화 금지.** 법적 고지 활자도 12px 하한.
- **개인정보·학원 자산 반입 금지**: 합격 자소서 원문, 정규반 교재의 기출·가이던스, 소재 노하우(`sojae_playbook`)는 레포·공개 테이블 어디에도 넣지 않는다(비공개 테이블 + SQL 대화창 전달). **합격자 문장을 AI 프롬프트 예시로 주지 않는다.** 자료는 파일명이 아니라 본문 출처로 확인. **커뮤니티 오픈챗 주소·참여코드도 같은 취급**(2026-08-16) — 레포가 공개라 적는 순간 회원 게이트가 무의미해진다. 회원 전용 표 `community_config`(RLS `authenticated` 만 — anon 정책 없음, `site_config` 는 비회원도 읽어서 안 씀)에만 두고, 값 insert SQL 은 대화창으로 전달한다.
- **전화번호로 남을 조회할 창구를 만들지 않는다** — 비회원 중복 신청 사전 조회, 오픈 알림 명단 본인 조회를 일부러 안 연 이유(번호만으로 신청·관심 여부가 캐진다).
- **bfcache**: 뒤로/앞으로 가면 크롬은 **떠날 때 그리던 화면을 그대로 되살린다**(파일도 데이터도 새로 받지 않는다). 2026-08-03 오너 지적("옛 디자인이 깜빡인다")으로 **입력값 없는 화면 전부에 `pageshow` + `e.persisted` → `location.reload()`** 를 달았다(24개 — `scroll-keep.js` 를 단 페이지와 같은 집합, 2026-08-17 실측 · news 는 이날, review-write 는 2026-08-20 합류 — 긴 입력칸은 answers 처럼 `draft-keep` 이 지킨다). **새 페이지를 만들면 같이 단다.** 예외 셋만 기억하면 된다: ① **홈 `index.html`·챌린지 허브 `challenges.html`** — 되돌아온 화면이 리셋되는 게 낡은 화면보다 거슬린다며 오너가 뺐다(홈은 히어로 애니메이션이, 챌린지 허브는 하단 블라인드 퀴즈가 처음부터 다시 시작한다) ② **입력값 있는 화면**(sojae·experiences·review-desk·onboarding) — 쓰던 글이 날아간다 ③ **결제로 나갔다 오는 화면**(apply·lecture·program·ai-killer·polish·lab-shelf) — 통째 reload 대신 **버튼만 복원**(복귀 흐름을 건드린다). 남는 한 가지: GitHub Pages 가 HTML 에 강제하는 `max-age=600` 은 레포에서 못 없앤다 — **배포 직후 확인은 강력 새로고침**으로 한다.
- **위 reload 를 다는 화면에는 `scroll-keep.js` 를 반드시 같이 단다**(2026-08-03 오너 신고 "영상관 갔다 나오니까 맨 위로 뚝 끊기면서 올라간다"). reload 는 브라우저가 되살려 주던 **스크롤 위치까지 같이 버린다.** 게다가 목록을 Supabase 에서 받아 그리는 화면은 다시 받는 순간 페이지가 짧아, 브라우저가 되돌아갈 자리를 못 찾고 맨 위에 멈춘다(후기 목록 실측 4000px → 0px). `scroll-keep.js` 는 떠날 때 위치를 sessionStorage 에 적어 두고, 페이지가 충분히 길어지는 순간 그 자리로 옮긴다. **되돌리는 건 `reload`·`back_forward` 방문뿐** — 새로 눌러 들어온 `navigate` 는 맨 위에서 시작하는 게 맞다(이 판정을 빼면 메뉴로 들어와도 중간부터 보인다). 사용자가 먼저 움직이면 그만두고, 옮길 땐 `scroll-behavior:smooth` 를 잠깐 꺼서 순간이동한다. **`admin.html` 은 `data-manual`** — 뒤로 오면 탭이 '오늘'로 돌아가므로 **탭을 먼저 되살린 뒤에** 스크롤을 옮겨야 한다(순서가 바뀌면 '오늘' 화면이 연구실 자료에서 적어 둔 자리로 내려간다). 저장 키 `monc_admin_tab_v1` + `restoreDesk()`(revealAdmin 뒤 호출 — 화면을 켜기 전에는 높이가 없다), 대기는 6초(탭 데이터를 그때 받는다). 기록은 sessionStorage 고정(**localStorage 금지** — 공용 기기에서 다음 사람이 남의 마지막 위치를 물려받는다).
- **⚠️ `scroll-keep.js` 태그에 `defer` 를 붙이지 말 것, 그리고 되살아난 뒤엔 아무것도 적지 말 것**(2026-08-03 2차 — 1차가 폰에서 통째로 안 먹은 원인). 순서가 이렇다: ① 떠날 때 900 적음 ② 뒤로 → bfcache 가 화면을 되살림 → 페이지가 곧바로 통째 새로고침 ③ **그 새로고침의 `pagehide` 가 또 적는데 되살아난 위치가 아직 안 잡혀 0 을 적는다** ④ 새 화면은 '적어 둔 자리 = 0' → 맨 위. 그래서 `pageshow`+`persisted` 를 보면 `frozen` 을 켜고 그 뒤로는 저장을 막는다(admin 의 '보던 탭' 저장도 `moncScrollKeep.frozen()` 으로 같이 막는다 — 안 막으면 옛 탭이 현재 화면 탭으로 덮인다). 이 잠금이 먹으려면 **페이지의 reload 처리보다 먼저 실행**돼야 하므로 `defer` 를 떼고 `?v=` 만 올린다. 파일을 고치면 23개 페이지의 `?v=` 도 같이 올린다.
- **⚠️ 되돌릴 자리가 있으면 `history.scrollRestoration='manual'` 로 브라우저 몫을 꺼야 한다**(2026-08-04 라이브 실측). 브라우저도 제 나름대로 스크롤을 되돌리는데 그 값이 **새로고침 직전 위치, 즉 0** 이라, 우리가 옮겨 놓은 뒤에 0 으로 다시 끌어내린다. 같은 페이지가 어떤 값에선 되고(우리 이동이 늦어 나중에 이김) 어떤 값에선 0 이 되는 **경합**이라 한 번 통과했다고 믿으면 안 된다. `backish && want>=MIN` 일 때만 manual 로 바꾼다(그 외에는 브라우저 기본 동작을 건드리지 않는다).
- **⚠️ bfcache 는 개발용 브라우저에서 재현이 안 된다**(CDP 가 붙으면 꺼진다 — `pagehide` 가 `persisted=false` 로 온다). 이 자리를 검증하려면 `window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}))` 로 **되살아난 순간을 직접 만들어** 페이지의 reload 처리를 태우고, 저장값이 살아남는지 본다. 뒤로가기만 눌러 보고 "통과"라고 하면 안 잰 것이다(1차가 그렇게 통과했다). 히든 프리뷰 탭은 `window.innerHeight` 가 0 이라 되돌릴 자리 계산이 어긋난다 — 재기 전에 `resize_window` 로 뷰포트를 살린다.

## 결제·유료 기능 — 판정은 서버·DB 가 한다

- 결제는 **포트원 V2 단일 경로**(간편결제 채널 토스페이·카카오페이 — **상점·채널 키는 `pay-methods.js` 한 곳**, 페이지에 하드코딩 금지. 카카오 키가 비면 카카오페이는 화면에 안 나온다), 신청·충전·이용권 저장은 **verify-payment Edge Function 경유.** **금액은 브라우저를 믿지 않고 서버가 DB 에서 재확인**(`site_config.challenge_price`·`special_lectures.price`·`site_config.credit_packs`·`answer_programs.price`), **지급 대상은 body 가 아니라 JWT.** ⚠️ **DB 를 못 읽었을 때 쓰는 폴백 금액은 화면과 서버 두 곳에 있다 — 한쪽만 고치지 말 것**(`apply.html` 의 `PRICE` ↔ `verify-payment` 의 `PRICE_PER_CHALLENGE_FALLBACK`). 2026-08-02 참가비 인상 때 서버만 30,000 에 남아, `site_config` 를 못 읽는 순간 화면 33,000 · 서버 30,000 으로 갈리는 상태였다(2026-08-03 정정).
- 결제 후 실패(특강 정원 마감 `MC001`·중복 신청 `MC002`·이용권 중복 등)는 **전액 자동 환불 + HTTP 200** 으로 응답한다(non-2xx 면 supabase-js 가 본문을 감춰 브라우저가 환불 안내를 못 띄운다). 크레딧 부족·실패도 HTTP 200 + `code`.
- **미결 결제 기록은 `pay-pending.js` 공용(localStorage)** — 결제창을 열기 **전에** add, **확답**(성공·확정 실패)일 때만 drop, 방문마다 조용히 재확인. sessionStorage 단건 보관으로 되돌리면 인앱 복귀 유실로 돈만 나가는 사고가 재발한다(2026-08-10 전수 점검). 챌린지·특강 재확인은 `appsRetrySafe()` 가드 필수 — 상세는 apply-and-payment.md '미결 결제 기록'.
- **지급의 최종 안전망은 웹훅(portone-webhook)** — 브라우저가 영영 안 돌아와도 포트원 통보로 서버가 지급을 끝낸다. 그래서 **모든 `requestPayment` 에 주문 맥락 `customData`(`k`=종류 + 대상)를 싣는다 — 새 결제 흐름을 만들면 반드시 같이 싣고 웹훅에 분기를 더한다.** 통보 본문은 방아쇠일 뿐, 서버가 포트원 API 로 재조회해 금액을 DB 와 대조한 뒤에만 지급한다(멱등 — 브라우저 확인과 경합해도 한 번만).
- 환불(cancel-payment)에서 포트원 취소 성공 + DB 기록 실패는 `ok:true + warning` — 실패로 바꾸면 관리자가 다시 눌러 **이중 환불**이 난다.
- **돈이 걸린 판정은 전부 DB 가 원장이다**: 잔여석·중복 신청·답변 프로그램 세션 상태는 DB 트리거(+`for update` 행 잠금·advisory lock), 크레딧 잔액은 **원장(`credit_ledger`) 합계**(잔액 컬럼 금지). 브라우저 검사·클라이언트 update 로 대체 금지. 브라우저가 보낸 `answerId`·금액·슬롯도 서버가 소유·소속을 재확인.
- **크레딧 공통 규칙**: 저장은 언제나 **무료·무제한**(글이 저장소로 들어오는 세 길 — 직접 쓰기·소재 발굴·킬러 자동 저장 — 어느 것도 막지 말 것). 단가는 소재 2 / 킬러 3 / 첨삭 10(**가치 기준** — 원가 비율로 되돌리지 말 것). **하루 무료 5는 지급량 조절값이 아니라 '첨삭 잠금장치'** — 첨삭 단가(10) 이상이 되는 순간 첨삭이 매일 공짜가 된다. 후하게 줄 땐 `grant_credit` 일괄 지급. 차감 키는 `<대상 id>#<묶음>` 패턴(재전송·허용된 재검사가 무차감). 유료 기능은 기록 테이블 count 실패 시 **차감 전에 `not_ready`** 로 멈춘다(무시하면 영구 무료 결함 — polish p-1 전례). **환급은 서버 전용 `refund_credit_for`(service_role)로만 부른다** — 대상을 `auth.uid()` 로 정하는 RPC 를 `authenticated` 에 열면 학생이 결과를 받은 뒤 자기 차감을 되돌려 유료 기능이 통째로 공짜가 된다(2026-08-04 점검에서 발견·차단).
- **유료 콘텐츠 비공개**: 답변 프로그램 기출은 회원 전체 읽기인 `questions` 에 넣지 않는다 — 비공개 `interview_questions` + `ap_program_view()` RPC 만. `program_enrollments` 에 회원 자가 INSERT 정책 금지(**체험판·무료 등록 없음** — 오너 확정). `airline_profiles`·`ai_killer_terms`·`sojae_playbook` RLS 는 일반 회원에게 닫혀 있다.

## 디자인 공통

- **UI 원칙 15개와 현행 팔레트 상세 = `docs/design-principles.md`**(2026-08-02 재검토로 구 '9대 원칙'을 대체). 요지: 활자 12px+·**입력칸 16px+** · 터치 44px+·**간격 8px** · 대비 4.5:1·**경계선 3:1** · 라운드·계층·여백·그룹핑 · **상태를 단정하지 않기** · **결정 화면에 값·버튼·근거** · **전송량 예산** · **포커스와 키보드**(div+click 금지 — role·tabindex·Enter/Space 가 한 벌) · **값에는 그것이 무엇인지 붙이기**(카드 구석 '1기' 처럼 값만 남으면 오타로 읽힌다).
- **375px 눈검사만으로는 절반이 통과한다**(2026-08-02 교훈 — 입력칸 15px·전송량 3.8MB·경계 대비 1.38:1·320px 잘림이 전부 그렇게 통과했다). 올리기 전 재는 항목표가 design-principles.md '적용 방법'에 있다.
- 팔레트는 **딥 네이비 on 쿨 화이트**(2026-07-29 오렌지 폐지 → 2026-08-05 웜 페이퍼 폐지): `--action`=`--accent`=`--accent-ink`=`#1B3A6B`, `--action-ink`=흰색. **다크 면 위 강조는 `--action-on-dark`, 다크 위 CTA 는 흰 알약+네이비 글씨.** 새 색을 자리마다 만들지 말 것. 기능색(에러 빨강·항공사 CI·브랜드색)은 통일 대상이 아니다.
- **배경은 순백(`--bg #FFFFFF`) + 쿨 그레이**(2026-08-05 오너 "누리끼리해서 사기가 저하된다 / 완전히 백색, 시원시원하게"). 베이지·아이보리(`#F4F1EA`·`#FBF9F5`·`#F4F0E8`·`#E9E4D8`·`#FCF9F1→#F3EEE1`)로 되돌리지 말 것 — nav 바 반투명(`rgba(255,255,255,.92)`)·잉크/회색(`--text`·`--text-muted`·`--text-dim`)·그림자(`rgba(20,32,52,…)`)·테두리(`rgba(23,42,71,…)`)가 한 벌이다. **순백 위에서는 카드가 밝기 차가 아니라 `--border-soft`(0.12)와 `--shadow` 로 뜬다 — 이 둘을 낮추면 흰 카드가 배경에 녹는다.** 상세는 design-principles.md '현행 팔레트'.
- **제목 색은 `--ink #1C2A3A`** — `tokens.css` 의 `h1, h2, h3 { color: var(--ink) }` 가 전 페이지 기본값(2026-08-05 전역화 — 그전엔 홈만 네이비, 나머지는 먹빛이었다). ⚠️ **다크 배경 위 제목은 자기 규칙에 색을 명시할 것** — 이 요소 규칙이 부모에게서 물려받은 흰색을 이겨서 제목이 배경에 사라진다(apply 배너 전례).
- **`tokens.css` 맨 아래 '팔레트 오버라이드' 블록 삭제 금지**(실사고 — CSS 변수는 미정의여도 에러 없이 글자만 사라진다). 큰 블록을 지웠으면 `var(--x)` 미정의 사용처를 훑는다. `background-clip:text` 로 글자를 칠하지 말 것(실패 모드가 '글자 없음').
- CSS 를 크게 손댔으면 **주석 짝(`/* */`) 균형을 센다** — 주석 안 클래스 나열의 별표+슬래시가 규칙 하나를 조용히 삼킨 실사고 2건.
- **nav 는 `nav.js`+`nav.css` 전 페이지 공용** — 페이지에 nav 마크업 복사 금지(admin·login·onboarding·review-desk 는 일부러 제외 — review-desk 는 admin 처럼 단독 화면이라 자체 헤더를 쓴다). 메뉴 항목·현재 위치는 `nav.js` 의 배열·표에서만 고친다. **`lab-*.html` 5개(airline·calendar·question·report·video)는 세지 않는다** — `lab-shelf.html?shelf=` 로 즉시 넘겨보내는 34줄짜리 안내판이라 nav·inapp 둘 다 없는 게 맞다(2026-08-07 실측).
- **`inapp.js` 도 공용 — 지우지 말 것.** **login 에도 들어간다**(구글 OAuth 가 인앱에서 거부되는 바로 그 화면이다). 제외는 admin·onboarding·review-desk 셋뿐 — 인앱 유입이 닿지 않는 화면이다(2026-08-07 실측). 인앱 브라우저(인스타·카톡)는 **파일 다운로드를 막고 구글 OAuth 를 거부한다**(2026-08-01 실사고 — 인스타 유입 학생이 무료 자료를 못 받았다). 인앱이면 **nav 아래 상단 한 줄 안내**(오너 확정 — 전체 화면 덮개는 기각 "장난치냐? 그냥 상단 설명으로 바꿔"). 형태 규칙 셋: ① `position:fixed` + `top=#navbar 실측 높이`(흐름 안 배너 금지 — nav 와 글자가 겹쳐 깨진 실사고) ② **화면 문자열은 전부 `\uXXXX` 이스케이프**(생성기 주석 참조 — 한글 리터럴 직접 넣기 금지) ③ 파일을 고치면 **`?v=` 캐시 버스터도 같이 올린다**(인앱 웹뷰가 캐시를 안 버려 깨진 옛 화면이 계속 보인 실사고). 자동 이동 없음 — 버튼을 눌렀을 때만 안드로이드 크롬 인텐트 / 아이폰 주소 복사. **인스타가 유입 1위라 이 자리가 막히면 유입 전체가 막힌다.** 새 페이지를 만들면 `nav.js` 옆에 같이 넣는다. ⚠️ **비동기 응답 뒤 `window.open` 으로 파일을 열지 말 것**(인앱이 조용히 막는다 — 받기는 `location.href`).
- **새 페이지를 만들면 `<title>` 아래 og·twitter 메타 블록을 복사해 넣는다**(다른 페이지 head 에서 그대로 가져와 url·title·description만 교체). 카톡·DM 링크 미리보기용이라 **크롤러가 JS 를 안 돌린다 — nav 처럼 스크립트로 심으면 무효**다. 빠지면 로고 없이 제목만 뜬다(2026-08-01 실사고 — index 말고 28개 페이지 전부 비어 있었다).
- **제목 꼬리표는 `[페이지 이름] — MONC 몬크` 하나뿐**(2026-08-03 오너 확정 — 홈 `index.html` 만 브랜드 문장 `MONC 몬크 — 승무원 준비의 새로운 기준` 예외). 사이트가 챌린지보다 넓어졌는데 꼬리표가 손으로 적히다 6가지로 갈렸고, **자료실·뉴스·약관까지 '몬크 챌린지'로 떠서 오너가 지적했다.** `· MONC`·`| MONC`·`— MONC`·`MONC 로그인` 같은 변형을 다시 만들지 말 것. **`<title>`·`og:title`·`twitter:title` 세 값은 항상 같다** — 미리보기는 og 를, 주소창·검색 결과는 `<title>` 을 읽어서 한 곳만 고치면 화면마다 다른 이름이 뜬다. 페이지 이름의 부제는 가운뎃점으로 붙인다(`보.신.각 · 보이스 신분상승 각 — MONC 몬크`). ⚠️ **`document.title` 을 다시 쓰는 페이지도 같이 고친다**(`lab-shelf.html`·`program.html`·`story.html`·`reviews-list.html`).

## 기능별 문서(소스오브트루스)

| 영역 | 핵심 파일 | 어기면 안 되는 것 한 줄 | 상세 문서 |
|---|---|---|---|
| 홈 랜딩·히어로·챌린지 허브 | `index.html`·`index.css`·`challenges.html`·`blind-quiz.js` | 섹션 서사·히어로 상수·카드 규격은 전부 실측 기반 — 값 수정 전 문서 필독 | `docs/notes/home.md` |
| 공용 nav | `nav.js`·`nav.css` | 활자·정렬 값은 실측 합의값 — 임의 변경 금지, 소셜 링크는 모바일=햄버거·데스크톱=푸터(상단 바 금지) | `docs/notes/nav.md` |
| 신청·결제·모집일정·오픈 알림 | `apply.html`·`recruit.js`·`waitlist.js`·`pay-methods.js`·verify/cancel-payment | 참가비는 `site_config.challenge_price` 단일 소스, 모든 신청 CTA 는 apply.html 로. **취소선 정가는 `challenge_list_price` — 표시 전용이라 청구·검증 금액과 무관하고, 없거나 참가비 이하면 앵커를 안 그린다(판정은 `MONC.loadChallengePricing()` 한 곳)** | `docs/notes/apply-and-payment.md` |
| 특강 | `lectures.html`·`lecture.html`·`lecture-common.js` | 상세는 `lecture.html?id=` 템플릿(특강별 HTML 금지), 잔여석은 DB 트리거 | `docs/notes/lectures.md` |
| 승준 코스·승준 도구 | `briefing.html`(코스)·`tools.html`(도구) | 2026-08-06 분리(구 승준노트 — 파일·클래스명 유지, 화면 글자만 교체). 코스는 **두 상태**(선택 전=코스 줄 4개+패널 하나 / 선택 후=개인화 헤더+'오늘 이어서', 저장은 `members.course`), 도구는 격자 7종 허브(2026-08-24 역량검사 게임 합류 — 2026-08-25 AI킬러 잠시 내림: 타일·메뉴 한 세트, 표시 6종). 카드·타일에 회원별 상태 문구·금액 금지. nav 는 코스(단독)+도구(드롭다운) 두 항목 — 6항목이라 햄버거 상한 880px | `docs/notes/briefing.md` |
| 역량검사 게임 | `games.html`·`games.js` | **전부 자체 제작**(잡다·자인원 화면·그래픽·명칭 복제 금지 — 유형만 참고), **이모지 금지 — 아이콘·게임 그래픽은 자체 라인 SVG 심볼만**(2026-08-25 오너), 무료·비회원 공개·서버 호출 없음(제공 원가 0), 점수는 localStorage, 페이지 하단 '자체 도구·무관' 고지 삭제 금지 | `docs/notes/games.md` |
| 연구실 | `lab.html`(허브)·`lab-archive.html`(원장)·`lab-shelf.html`(서가 4종 공용)·`lab-viewer.js`(PDF 읽기 화면)·`researchers-data.js` | 허브는 카드 두 장·원장은 카드형·상세는 `?shelf=` 한 파일(서가별 HTML 금지), 기출문제는 취업 자료실 안의 갈래(2026-08-03 합침 — DB shelf 값은 그대로), 자료 파일은 비공개 버킷 + lab-file 서명 URL 로만(공개 URL 금지), **PDF 는 읽기 화면(lab-viewer)이 먼저 열리고 저장 버튼은 `delivery!=='view'` 만 — 화면 전용 차단은 서버가 유지, `lab-viewer.js` 수정 시 `VIEWER_SRC` `?v=` 동반**, 숫자는 `lab_shelf_counts()` 실측값만, **값은 자료마다 `lab_resources.price`(0=무료) — 자료 테이블을 새로 만들지 말 것**, 단 **채용 캘린더만 예외로 `recruit_rounds`**(파일이 아니라 날짜 · 무료 확정 · 상/하반기 칸 금지) | `docs/notes/lab.md` |
| 뉴스 | `news.html`·`scripts/fetch-news.mjs` | 필터는 픽커+바텀시트(칩 나열 회귀 금지), 규칙 수정 시 verify-news-rules.py | `docs/notes/news.md` |
| AI킬러·항공사 프로필 | `ai-killer.html`·`supabase/functions/ai-killer` | **판정은 오너 지침 프롬프트(4기준+의심 지수 %+인간미 그린 플래그) — 2026-08-12 전면 교체, 사전·밀도 규칙 판정으로 되돌리지 말 것.** 구조화 출력·한 파일 유지, 감점 사전은 admin 'AI킬러' 탭(DB — 이제 자기 출력 재검사·첨삭용), 판정 피드백(만족/보통/불만족)은 `ai_killer_feedback` 직접 upsert — **판정에 자동 반영 금지(수동 정리→오너 결정)** | `docs/superpowers/specs/2026-07-24-ai-killer-design.md` |
| 답변 첨삭 | `polish.html`(서버는 ai-killer 의 `mode:'polish'`) | 제출 전 프로브 게이트 유지, fix 는 학생이 쓴 사실만 | `docs/notes/polish.md` |
| 소재 발굴 v2 | `sojae.html`·`sojae-common.js`·sojae-chat | 다듬기 버튼은 2번째 답변부터 항상 노출(오너 확정), 노하우는 `sojae_playbook`(DB), **난이도 4단계는 `questions.level`(basic/mid/advanced/deep) 한 곳 — 코드명 변경 금지·`.eq('level')` 금지(미적용 환경 400)**, 진입은 난이도 고르는 화면이 먼저(`?q=` 는 건너뜀) | `docs/superpowers/specs/2026-07-30-sojae-v2-design.md` |
| 답변 저장소·크레딧 | `answers.html`·`mypage.html` | 저장 무료·무제한, answers/mypage 는 같이 고친다 | `docs/notes/credits.md` |
| 마이페이지 | `mypage.html`·`submit.html`(오픈챗 공유용 챌린지 제출 입구) | '오늘 한 칸'엔 사이트가 아는 사실만(제출 여부 문장 금지), 접이는 데이터 있는 줄만. 제출 칸 이름·규칙은 mypage·admin·submit 세 곳 한 벌 | `docs/notes/mypage.md` |
| 미니 다듬기(표현 수집) | `quickfix.js`(서버는 ai-killer 의 `mode:'quickfix'`) | 프로브 게이트 유지(구버전이면 3크레딧 오차감), 300자+하루 3회는 한 쌍의 우회 방지 | `docs/notes/quickfix.md` |
| 로그인·동의 | `login.html`·`onboarding.html`·`supabase-config.js` | 동의 게이트·거부 시 파기 흐름 완화 금지 | `docs/notes/auth-consent.md` |
| admin | `admin.html` | 좌측 사이드바 셸(운영/상품/콘텐츠 그룹) + '오늘' 브리핑 — 탭을 추가하면 어느 그룹인지부터 정한다. **UI 는 역할마다 모양이 다른 한 벌**(고르기=밑줄 탭·좁은 칸=라벨 셀렉트·행 동작=네모 버튼·삭제=빨간 글자·목록=구분선 한 판·상태=radius 4 라벨) — **알약 금지**(2026-08-22 전 탭 교체, `999px` 0곳). **회원 관리는 현황 5단(고객·참여·관심·가입만·흔적 없음)·활동 타임라인·메모/태그·조건 저장 — 등급 판정 두 자리(`free_use` 는 delta 0 · '관심'의 신청 이력)를 건드리면 사람이 잘못 보관된다** | `docs/notes/admin.md` |
| 후기(허브·챌린지·상담·합격 수기) | `reviews.html`(허브)·`reviews-list.html`(목록 공용)·`stories.html`·`story.html`·`review-write.html`(참가자 직접 제출) | 목록은 `?kind=` 한 파일(종류별 HTML 금지), 자료 0건인 종류는 카드를 안 그린다, **상담 후기는 실명 미노출**. **회원 제출 후기는 서버(RPC)가 참가·기수를 판정해 `visible=false` 로 넣는다 — 즉시 공개 금지, 승인은 admin '승인 대기' 칩·보상 없음(오너 확정)**. **합격 수기는 2026-08-16 잠시 내림**(상담 후기가 찰 때까지 — `STORIES_OPEN=false`·stories/story 는 reviews 로 리다이렉트·nav 갈래 주석, 데이터·admin 칸은 유지. 복원 절차는 pages.md '합격 수기 잠시 내림') | `docs/notes/pages.md` |
| 1:1 상담·네이버 예약 | `consult.html` | **네이버 예약 주소 정본은 consult.html 한 곳** — 다른 자리는 이 페이지로 보낸다. 진입점 3곳 고정(상담 후기 목록 CTA·index 푸터·사이트 밖), **홈 본문·nav 메뉴·플로팅 금지**, 초록 버튼은 진한 글씨(흰 글씨 대비 미달) | `docs/notes/pages.md` |
| 커뮤니티 오픈챗 모집 카드 | `community-card.js` | **카드는 서가(lab-shelf)·뉴스·도구(tools) 3곳뿐**(2026-08-16 오너 "덕지덕지 오픈하진 말고" — 홈 금지는 유지), 문구·모양·동작은 이 한 파일(페이지 복사 금지, 수정 시 세 페이지 `?v=` 동반), 주소·참여코드는 레포 반입 금지(위 '개인정보' 절 — 회원만 `community_config` 에서 받는다), nav 소셜 줄 '오픈채팅 커뮤니티'는 방 직링크가 아니라 `tools.html#community` 착지 | `docs/notes/pages.md` |
| 기타 페이지(연구진·상세 4종·오디오) | `researchers.html`·`challenge-*.html` | 상세 4종 인라인 공통 CSS 는 네 파일을 같이 고친다 | `docs/notes/pages.md` |
| 매일 답변 프로그램 | 아래 절 | 절대 원칙 10개 먼저 읽기 | `docs/monc-answer-program/` |
| 배포·적용 시점 상태 | — | 함수 버전·마이그레이션 적용 현황은 여기서 확인 | `docs/notes/implementation-status.md` |

> 끝난 작업의 **계획서는 `docs/archive/plans/`** 에 있다 — 현행 규칙이 아니다. 설계 문서(`docs/superpowers/specs/`)도 위 표가 가리키는 둘(ai-killer·sojae-v2) 말고는 설계 시점 기록이라, 값이 notes 와 다르면 notes 가 맞다.

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

> ⚠️ **10번의 이 레포 대응**(오너 원문은 그대로 둔다): 이 레포엔 린트·빌드·타입 검사 시스템이 **없다**(위 '명령·검증'). 없는 명령을 지어내지 말고 `node scripts/answer-program-tests.mjs` · `deno check supabase/functions/answer-program/index.ts` · 375px 브라우저 실측 셋으로 대신한다.

#### 작업 방식

> 이 절은 **답변 프로그램 작업에 한한다.** 아래 '구현 계획만 작성하고 종료하지 않는다'는 착수한 일을 계획서만 남기고 덮지 말라는 뜻이지, 큰 작업 전에 오너에게 방향을 확인하는 것까지 막는 규칙이 아니다.

- 먼저 기존 저장소 구조를 분석한다.
- 저장소에서 확인 가능한 내용은 사용자에게 다시 묻지 않는다.
- 구현 계획만 작성하고 종료하지 않는다.
- 기능을 작은 수직 단위로 구현하고 검증한다.
- 완료하지 못한 내용은 정확하게 기록한다.

### 작업 규칙 요약

- **파일**: `programs.html`(허브) · `program.html`(작성 흐름) · `experiences.html`(소재 창고 — 구 경험 창고, 2026-08-16 오너 개명·파일명 유지) · `review-desk.html`(연구원 검수 — `reviews.html` 후기와 다른 파일) · admin '일문일답' 탭(구 답변 프로그램 — 2026-08-16 오너 개명, data-tab=approgram 유지) · `supabase/functions/answer-program/index.ts`(한 파일·프로브 있음) · migration `20260730150000_answer_program.sql`.
- **근거 없는 문장 차단이 이 상품의 핵심**: 서버 `apValidateSentences` 가 근거 id 실존·자료에 없는 숫자를 검사해 unsupported 를 붙인다(화면 빨간 표시·'이 버전으로 다듬기' 제외). 이 검증을 우회하는 코드 금지.
- **유료 기출 비공개·이용권 서버 지급**: 위 '결제·유료 기능' 절의 규칙이 그대로 적용된다(`interview_questions` 비공개·verify-payment `programId` 분기·자가 INSERT 없음). 교재 원문·기출 SQL 은 공개 리포 커밋 금지(위 '개인정보·학원 자산 반입 금지').
- **확정본은 `answers` 자유 글로 합류**(title=문항·doc_kind=interview) — 킬러·첨삭·답변노트가 무수정으로 붙는 연결을 끊지 말 것.
- **상세 문서**: 데이터 모델·화면 흐름·AI 파이프라인·테스트·구현 현황은 `docs/monc-answer-program/`(구현 상태는 `implementation-status.md`). 오너 원본 요구사항은 `docs/monc-answer-program-spec.md`.

## 절대 되살리면 안 되는 것(요지)

각 항목의 배경·실측은 괄호의 문서에 있다.

- 전체 폭 섹션 밴드(`background: var(--bg2)` 를 화면 폭 섹션·푸터에 깔기) — 순백과 만나는 가로선이 생긴다. `--bg2` 는 **흰 카드 안 옅은 판 전용** (design-principles.md)
- 웜 페이퍼 배경(`--bg #F4F1EA`·`--bg2 #FBF9F5`·`--surface2 #F4F0E8`·nav 바 `rgba(255,250,243,·)`·레터프레스 `#FCF9F1→#F3EEE1`)과 웜그레이 잉크(`#26221C`·`#5F574B`) — 2026-08-05 순백+쿨 그레이로 전면 교체 (design-principles.md)
- `application-modal.js`·구 index 인라인 신청 모달 — 상세 안 신청은 `lecture.html` 인라인 폼이 정본 패턴 (apply-and-payment.md)
- 보증금·환급 워딩(공개 페이지) — 2026-07-20 폐지, PG 심사 거절 사유 (apply-and-payment.md)
- 모집일정 구글시트 CSV 폴백(`RECRUIT_CSV`) (apply-and-payment.md)
- `members.sojae_enabled` 권한 스위치 방식 — 소재는 크레딧으로 통제 (credits.md)
- 환급 RPC(`refund_credit`)를 `authenticated` 에 다시 grant — 학생이 결과를 받은 뒤 스스로 환급해 유료 기능이 공짜가 된다 (credits.md)
- `applications` INSERT 정책에서 결제 컬럼 제약 빼기 — 누구나 '입금 완료' 행을 넣고 특강 정원을 먹는다 (apply-and-payment.md)
- 승준노트 카드 권한 배지(`.bf-badge`)·'첫 1회 무료' 같은 회원별 상태 문구 (briefing.md)
- 승준노트 B 머리의 기록 칩(`답변·대화 중·스크랩`)과 '마이페이지에서 자세히' 링크 — 누를 수 없는 숫자 + 코스와 무관한 값 + 시작하라는 화면 맨 위에서 밖으로 빼는 문(2026-08-06 삭제) (briefing.md)
- 승준노트 매거진 목차 6줄(`.ix-item`)·루트맵 룰렛(`.d-route`)·강조 세 자리(01 판·06 소인·03 '처음 추천' 배지) — 2026-08-05 코스형 개편으로 폐지 (briefing.md)
- 뉴스 필터 칩 나열 sticky 바·리본 북마크·라벨 없는 스크랩 아이콘 (news.md)
- 투명 nav(`nav-transparent`)·홈 업계 현실 숫자(0.18%)·MONC PROMISE 3단·파인더(#advisor)·홈 커뮤니티 섹션 (home.md)
- nav 강조의 깜빡이는 점(`bfPulse`) — 챌린지는 모집 0인 기간이 있어 '새 것' 신호의 근거가 없다(2026-08-03 삭제). 승준노트를 nav 4번으로 내리는 것도 기각 (nav.md)
- 히어로 스크롤 구동·창 통과 줌·로고 흩날림 안·하단바 '몬크 더 알아보기' 상태 (home.md)
- 특강 카드 커버 가격 배지·backdrop-filter 유리 패널·클라이언트 잔여석 update (lectures.md)
- 블라인드 퀴즈를 상세 페이지나 두 곳 이상에 싣기 — challenges.html 하단 한 곳 확정 (home.md)
- admin '홈 커뮤니티' 탭·'기출 은행' 독립 탭 승격(상품>일문일답(구 답변 프로그램) 서브탭 유지 — 오너 확정) (admin.md)
- admin 의 알약(`border-radius:999px` — 필터 칩·서브탭·행 버튼·상태 배지) — 2026-08-22 오너 "죄다 알약이야"로 역할별 모양 한 벌로 교체 (admin.md '알약 걷어내기')
- `rehearsal.html` 카드 숨김 해제 — 코드가 main 에 없어 404 난다(`claude/rehearsal-wip` 먼저 병합) (implementation-status.md)
- `challenge-express.html`·`challenge-speech.html` 되살리기 — 2026-07-14 커밋 `072c937` 에서 고아 파일로 제거됐다. 상세는 voice·expression·spinning·answer 4종뿐(2026-08-07 실측) (pages.md)
- AI킬러 일반 텍스트 응답(칸 없는 자유 출력)·함수 모듈 분리 (ai-killer 스펙)
- AI킬러 규칙 엔진 판정(사전 매칭·어미 반복·밀도 등급) — 2026-08-12 오너 지시 "너무 기계적으로 판단한다"로 폐지, 판정은 오너 지침 종합 판정 (ai-killer 스펙)
- 첨삭(polish) 제출 전 프로브 게이트 삭제 (polish.md)
- 소재 발굴을 답변 저장의 관문으로 만들기·다듬기 버튼을 AI 판정 뒤로 숨기기 (sojae 스펙)
- admin 소재 문제의 항공사 칸(`#qfAirline`) — 소재 문제는 전 항공사 공통이라 2026-08-05 삭제. 답변 프로그램 기출 은행의 항공사는 그대로 (admin.md)
- 연구진 전원=챌린지 코치 전제 문구 — 현형빈은 챌린지 미지도 (pages.md)
