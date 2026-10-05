# AGENTS.md

MONC(몬크 챌린지) 작업의 공통 지침. 과거 문서의 `CLAUDE.md`는 이 파일을 뜻한다.
**공통 규칙은 여기, 기능별 세부 규칙은 아래 연결 문서가 원장이다.**

## 응답과 진행

- 한국어 존댓말로 결론부터 짧게 답한다. 판단에 필요한 근거만 적고, 반복·과장·비유·습관적인 칭찬과 맞장구는 피한다. 오너 인용은 원문을 유지한다.
- 질문은 쉬운 말로 한 번에 1~2개. 저장소에서 확인할 수 있는 내용은 직접 확인한다.
- 계획은 오너와 논의하고 승인 뒤 구현한다. **원인과 고칠 곳이 특정된 수정은 바로 처리**한다. 승인된 범위의 구현·수정·검증은 계속 진행한다.
- UI는 **구현 → 375px 스크린샷 제시 → 오너 승인 → main 반영** 순서다. 이미 승인된 배포본의 명백한 결함 수정은 바로 반영할 수 있다. 브랜드 방향 변경은 별도 승인한다.
- 구현은 기본적으로 한 세션에서 직접 한다. 원인이 특정된 수정에 하위 에이전트·다단 리뷰를 붙이지 않는다.
- 오너가 직접 해야 할 일은 **실행 순서·누를 메뉴·복사할 내용·완료 기준**으로 따로 정리한다. SQL은 대화창의 `sql` 코드 블록, 긴 함수 코드는 바로 열 수 있는 파일 링크로 준다. 에이전트가 확인할 일과 구분한다.
- 운영 반영 여부와 로컬 구현 완료를 구분해 보고한다. 가능한 검증을 마치고, 외부 적용이 남았으면 정확히 적는다.

## 프로젝트와 작업 시작

- 손으로 작성한 HTML/CSS/JS 정적 사이트. 프레임워크·번들러·`package.json`·전체 lint/build 시스템은 없다.
- GitHub Pages가 `main`을 그대로 서빙한다. 라이브 주소는 **https://monc.ai.kr**(`CNAME`). 운영 확인은 이 주소에서 한다.
- 데이터·회원·결제는 Supabase(`supabase-config.js`, `MONC.sb`). 레거시 신청·후기 Google Apps Script는 Google 콘솔에서 수정·재배포하며 신청은 새 행 append다.
- **새 코드 변경 작업**은 `git status`로 기존 변경을 확인하고, `git fetch origin main` 후 `origin/main` 기준 새 브랜치에서 시작한다. 같은 작업의 후속 수정은 그 작업 상태를 이어간다. `.claude/worktrees/`·`claude/*`의 오래된 사본을 기준으로 삼지 않는다.
- UI 작업의 'main 직행'은 **로컬 확인·승인 후 main 배포**를 뜻한다. 결제·신청·DB·로그인·큰 구조 변경은 브랜치에서 검증한 뒤 해당 작업의 승인 범위에 따라 반영한다.
- 배포 명령은 `git push origin main`. 푸시가 배포이므로 해당 작업의 승인 범위를 따른다. 이미 승인받은 같은 작업에 허락을 반복해서 구하지 않는다.
- **Windows·macOS 공통 지침이다. OS·셸·실행 파일은 현재 세션에서 확인**하고 그 환경의 명령과 경로를 사용한다. 다른 PC의 절대 경로를 그대로 적용하지 않는다. `wkon-mirror` rsync 미러·구 nvm 로더는 폐기됐다. 레포를 직접 서빙한다.
- 파일명·주소·설정을 바꾸거나 삭제하면 기존 이름을 `AGENTS.md`와 `docs/`에서 검색해 관련 설명도 고친다. 코드 주석·커밋 메시지는 한국어. 죽은 코드와 타임스탬프 백업 파일을 남기지 않는다.

## 필요한 문서만 읽기

- 아래 표에서 **바꾸는 기능에 해당하는 문서와 관련 절만** 읽는다. 여러 기능을 건드리면 해당 문서를 함께 확인한다. 전 문서 읽기를 매 작업의 선행 절차로 삼지 않는다.
- 문서가 길면 제목·식별자로 관련 절을 찾고, 그 절의 규칙·예외·연결 파일을 읽는다. 공용 파일은 영향을 받는 기능까지 확인한다.
- UI/CSS 변경: `docs/design-principles.md`. 새 페이지·메타·뒤로가기·인앱 배너: `docs/notes/page-common.md`.
- DB·Edge Function 변경/배포: `docs/notes/supabase.md`. 적용 여부·함수 버전 확인: `docs/notes/implementation-status.md`.
- 스크린샷·스텁·셸·이미지 생성 절차가 필요할 때: `docs/notes/working-rules.md`의 해당 절.
- 기능 문서 첫머리의 핵심 규칙과 최근 확정 사항을 따른다. 오래된 기록에 상반된 값이 있으면 그대로 되살리지 않는다. 충돌을 해결할 근거가 없으면 오너에게 확인한다.
- `docs/archive/plans/`는 과거 계획이다. 설계 문서도 아래에 지정한 AI킬러·소재 발굴 두 문서를 제외하면 설계 시점 기록이며, 현행 notes가 우선한다.

| 작업 영역 / 파일 | 먼저 읽을 문서 |
|---|---|
| 홈·챌린지 허브: `index.*`, `challenges.html`, `blind-quiz.js` | `docs/notes/home.md` |
| 공용 메뉴: `nav.js`, `nav.css` | `docs/notes/nav.md` |
| 페이지 공통: `inapp.js`, `scroll-keep.js`, 메타·제목 | `docs/notes/page-common.md` |
| 신청·결제·환불·모집: `apply.html`, `recruit.js`, `waitlist.js`, `pay-methods.js`, `pay-pending.js`, `refund-details.*`, verify/cancel-payment, portone-webhook | `docs/notes/apply-and-payment.md` |
| 특강: `lecture.html`, `lectures.html`, `lecture-common.js` | `docs/notes/lectures.md` |
| 코스·도구 허브: `briefing.html`, `tools.html` | `docs/notes/briefing.md` |
| 역량검사: `games.html`, `games.js` | `docs/notes/games.md` |
| 연구실: `lab*`, `researchers-data.js`, lab-file | `docs/notes/lab.md` |
| 뉴스·자동 수집: `news.html`, `scripts/fetch-news.mjs` | `docs/notes/news.md` |
| AI킬러·항공사 프로필: `ai-killer.html`, ai-killer 함수 | `docs/superpowers/specs/2026-07-24-ai-killer-design.md` |
| 답변 첨삭: `polish.html`, ai-killer의 polish 모드 | `docs/notes/polish.md` |
| 소재 발굴: `sojae.html`, `sojae-common.js`, sojae-chat | `docs/superpowers/specs/2026-07-30-sojae-v2-design.md` |
| 답변 저장소·크레딧·충전: `answers.html`, `credits.html`, `credit-charge.js`, mypage의 답변·지갑 | `docs/notes/credits.md` |
| 마이페이지·제출: `mypage.html`, `submit.html`, `round-gate.js` | `docs/notes/mypage.md` |
| 미니 다듬기: `quickfix.js`, ai-killer의 quickfix 모드 | `docs/notes/quickfix.md` |
| 로그인·동의·본인인증·프로필: `login.html`, `onboarding.html`, `supabase-config.js` | `docs/notes/auth-consent.md` |
| 관리자: `admin.html` | `docs/notes/admin.md` + 변경하는 기능의 문서 |
| 후기·KE20·상담·연구진·상세 5종·오디오·커뮤니티: `reviews*`, `review-write.html`, `review-rich.js`, `stories.html`, `story.html`, `consult.html`, `researchers.html`, `challenge-*.html`, `challenge-detail.css`, `community-card.js` | `docs/notes/pages.md` |
| 매일 답변 프로그램: `program*`, `experiences.html`, `review-desk.html`, answer-program 함수 | `docs/monc-answer-program/product-spec.md`의 작업 전 원칙 → 같은 폴더의 관련 문서 |

## 공통 안전 기준

- **개인정보·학원 비공개 자산을 공개 레포/공개 테이블에 넣지 않는다.** 합격 자소서 원문·교재 기출/가이던스·소재 노하우·오픈챗 주소/참여코드가 포함된다. 비공개 표를 사용하고 데이터 입력 SQL은 대화창으로 전달한다. 합격자 문장을 AI 프롬프트 예시로 쓰지 않는다. 출처는 파일명이 아닌 본문으로 확인한다.
- 로컬 비공개 메모도 공개 레포에 옮기지 않는다. 상품 방향·자료 확보·쇼츠 작업은 `docs/notes/working-rules.md`의 비공개 메모 안내를 먼저 확인한다.
- **동의 게이트·거부 시 계정 파기·계정별 동의 캐시·회원 페이지 `MONC.requireConsent()`를 완화하지 않는다.** 동의 사전 체크/간주 동의 금지. 신청 폼 필수 동의는 미체크 시 제출 차단, 법적 고지 12px 이상.
- 전화번호로 타인의 신청·관심 여부를 조회하는 기능을 만들지 않는다. 프로필 저장은 `MONC.saveMyProfile()`만 사용한다. 본인인증 게이트의 승인된 fail-open·인앱 통과 예외는 auth-consent 문서를 따른다.
- **금액·지급 대상·잔여석·중복·크레딧·참가 권한은 서버/DB가 판단**한다. 브라우저 검사로 대체하지 않는다. 결제는 포트원 V2와 verify-payment, 지급 대상은 JWT. `requestPayment`의 주문 맥락과 웹훅 지급 경로를 유지한다.
- **포트원 환불 성공 후 DB 기록 실패는 `ok:true + warning`**이다. 실패로 바꿔 재환불을 유도하지 않는다. 유료 콘텐츠 RLS·서버 전용 환급 RPC를 회원에게 열지 않는다.
- 학생이 주지 않은 경험·성과·감정·결과를 생성하지 않는다. 부족한 사실은 추가 질문한다. 답변 프로그램의 `apValidateSentences` 근거 검증을 우회하지 않는다.
- 답변 저장은 무료·무제한이다. 비용·무료량·재학생 판정은 임의로 바꾸지 말고 해당 기능 문서와 서버 원장을 따른다.
- nav는 `nav.js`+`nav.css` 공용이다. 새 페이지에 nav·인앱 배너·메타·뒤로가기 장비를 적용할 때 page-common의 예외까지 확인한다.

## 검증과 완료

- 없는 lint/build 명령을 만들지 않는다. 변경한 동작에 맞는 아래 검사와 브라우저 검증을 수행한다.
- 프리뷰: 레포 루트에서 `python -m http.server 5500`(설치 상태에 따라 `python3` 또는 Windows의 `py -3` 사용). **화면은 375px부터 실제 렌더로 확인**하고 누른 뒤 성공·실패 상태까지 본다. 순서·배치 변경은 1280·768·375px 좌표로 확인한다. UI 측정 항목은 design-principles의 '적용 방법'을 따른다.
- 회원·결제 화면 테스트는 운영 호출을 차단한 스텁을 사용한다. `supabase-config.js` 계측 비콘은 로컬에서도 운영 DB로 나간다. 절차는 working-rules의 '회원 화면 검증'.

| 변경한 내용 | 검사 |
|---|---|
| 항공사 문항 매칭 임계값·유사도 | `node scripts/ai-killer-qmatch.mjs` |
| 답변 프로그램 | `node scripts/answer-program-tests.mjs` + `deno check supabase/functions/answer-program/index.ts`(deno가 없으면 미실행 보고) + 375px 렌더 |
| 환불 항목 처리 | `node scripts/refund-details-tests.cjs` + 선택·확인·처리 후 내역 렌더 |
| 문서만 변경 | 참조 경로·중복·충돌·규칙 누락 확인 |

새 규칙은 실제 적용 범위의 문서 한 곳에 기록한다. `AGENTS.md`에는 매 작업에 필요한 핵심과 찾는 경로만 남긴다.
