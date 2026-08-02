# 로그인·동의·개인정보 — 상세 기록

## 로그인 뒤 '가려던 화면' 복귀 — returnTo (2026-08-02 오너 "로그인하면 마지막 페이지로 돌아가야지")

- `requireSession()`·`requireConsent()` 가 `login.html?returnTo=<파일명+쿼리+해시>` 로 보낸다(`pageRef()` — 파일명만, 절대경로 금지: GitHub Pages 하위 경로에서도 성립).
- OAuth 왕복은 쿼리가 사라지므로 **login.html 도착 즉시 sessionStorage(`monc_return_to`)에 보관**하고, `routeByRole()` 이 꺼내 쓴다(1회용 — 꺼내면 지운다). 온보딩으로 갈 땐 `onboarding.html?returnTo=…` 로 넘긴다(온보딩 `nextPage()` 가 이미 읽는다).
- ⚠️ **열린 리다이렉트 방지 — `safeReturnTo()` 를 지우지 말 것**: `파일명.html(?…)(#…)` 형식만 통과, `login/onboarding` 자신 제외. 외부 URL·`//`·`javascript:` 는 형식에서 걸러진다(2026-08-02 Playwright 실측: 정상값 보관·악성값 거부 확인).
- 되돌리면 안 되는 이유: 도구(소재·킬러·첨삭·기출) 때문에 가입한 사람이 전부 마이페이지에 떨어져 유입이 끊겼다. 관리자도 returnTo 가 있으면 그쪽 우선(없으면 admin.html).

> 2026-07-30 CLAUDE.md 다이어트로 이관한 기능별 상세 기록·의사결정 원장이다.
> 매 작업 공통 규칙은 CLAUDE.md 에 있고, 이 문서는 해당 기능을 고칠 때 읽는다.
> 본문 속 '위/아래 ○○ 절 참조'는 구 CLAUDE.md 기준 표현이라, 그 절은 docs/notes/ 의 다른 문서에 있을 수 있다.

## login.html · 동의 게이트

- `login.html` — 구글·카카오 OAuth. **두 뷰**: `#loginView`(로그인 버튼 — 항상 활성) / `#consentView`(최초 1회 동의 게이트). **⚠️ 법적 필수(2026-07-15 개편):** 약관·개인정보 동의는 **가입 시 딱 한 번** 받는다 — OAuth는 로그인 전 사용자를 식별할 수 없어 구 방식은 "로그인할 때마다" 체크를 강요했다(오너 피드백). 이제 OAuth 복귀 후 `hasConsented()`가 false면 게이트를 띄우고, `#agreeChk`(만14세+약관·개인정보)를 **사용자가 직접 체크해야** `#consentGo`가 열린다. 동의 시 `MONC.recordConsent()`가 `members.agreed_at`·`terms_version`에 기록 → 이후 **어떤 기기에서도 다시 묻지 않음**. 거부 시 `signOut()`. **금지:** 체크박스 사전 체크·"간주 동의"·게이트 삭제. 회원 페이지(`mypage`·`onboarding`)는 `MONC.requireConsent()`로 가드 — 동의 없이 우회 불가. 약관 개정 시 `supabase-config.js`의 `TERMS_VERSION`을 올리면 전원 재동의.
- **동의 마이그레이션** (`20260715120000_member_consent.sql`, owner 실행): `members.agreed_at`·`terms_version` + **`delete_my_account()` RPC**. **미적용이어도 동작** — `getConsent()`가 조회 실패를 감지해 계정별 로컬 기록으로 폴백하고, 나중에 컬럼이 생기면 `hasConsented()`가 서버로 백필한다. ⚠️ `getMyProfile()` 공용 select엔 넣지 말 것(컬럼 미생성 시 프로필 조회 전체가 깨짐 — `major`와 동일 방어).
- **⚠️ 동의 3대 함정(리뷰에서 실제로 터진 것 — 되돌리면 법적 리스크):**
  1. **로컬 동의 캐시는 계정별 키** `monc_consent_v1:<uid>`. 무기명 기기 키로 되돌리면 **공용·가족 기기에서 A의 동의 흔적으로 신규 회원 B가 게이트를 건너뛰고, B 명의의 허위 동의 기록이 서버에 저장**된다.
  2. **거부 = 즉시 파기.** OAuth가 끝나는 순간 `handle_new_user()` 트리거가 `members`(이름·이메일) 행을 만든다 → 게이트에서 '동의하지 않고 나가기'는 `MONC.deleteMyAccount()`로 **계정을 삭제**한 뒤 로그아웃한다(RPC 미적용 시 이름·이메일만 즉시 null로 비우는 폴백). 로그아웃만 시키면 미동의자·만14세 미만의 개인정보가 잔존한다. privacy.html §2가 이 흐름을 고지한다.
  3. **동의 가드는 회원 페이지 전체에.** `mypage`·`onboarding`·`sojae`·`admin` 모두 `MONC.requireConsent()`를 호출한다 — 한 곳이라도 빠지면 주소창으로 게이트를 우회할 수 있다.
- **⚠️ 밖으로 나갔다 뒤로 돌아오는 화면은 상태를 되돌려야 한다(bfcache · 2026-07-24 오너 신고 "카카오 로그인 눌렀다 뒤로가기하니 이지랄"):** 브라우저는 페이지를 떠날 때 문서를 **그대로 얼려 뒀다가 뒤로가기 때 스크립트 재실행 없이 되살린다.** 그래서 '버튼 비활성 + …중 문구'를 띄운 채 외부(카카오/구글 OAuth·결제사)로 나가는 화면은 돌아왔을 때 **비활성 상태의 버튼이 그대로 남아 로그인·결제를 다시 할 수 없다.** 모바일은 결제도 리다이렉트 방식이라 `requestPayment`의 promise가 영영 안 끝나 `finally`도 못 돈다 — 스스로 풀리지 않는다. **처리 규칙: 입력값이 없는 화면은 통째로 새로고침**(`login`·`mypage`·`answers`: `pageshow`에 `location.reload()`), **입력값이 있는 화면은 버튼만 되돌린다**(`apply`·`lecture`: 결제 시작 시 `_payRestore` 클로저를 담아 뒀다가 `pageshow`에서 호출 — 이름·전화·선택한 챌린지는 살려야 하므로 reload 금지). 외부로 나가는 버튼을 새로 만들면 이 처리를 같이 달 것.
- `terms.html`, `privacy.html` — footer 법적 페이지. privacy는 실제 스택 기준(수탁자 Supabase 서울/Google/Kakao, 국외이전 고지, CPO 권성호, 14세 미만 조항). 수집 항목·수탁자 변경 시 갱신.
- **`applications` RLS** (`20260711120000_applications_rls.sql`, owner 실행): INSERT 공개(비회원 신청), SELECT 관리자+본인, UPDATE/DELETE 관리자만.

## onboarding.html(구 CLAUDE.md Pages 항목)

- `onboarding.html` — 첫 로그인 후 `login.html`의 `routeByRole()`이 `!profile.phone && !localStorage.monc_onboard_done`이면 여기로. 이름·전화·전공(major) → `members`. ⚠️ `members.major`는 migration `20260708120000_member_major.sql`(owner 실행); 미적용 시 major만 방어적으로 무시. `getMyProfile()` 공용 셀렉트엔 major 미포함(컬럼 미생성 시 전체 조회가 깨지므로 별도 방어 조회).

## 2026-08-02 동의 게이트 — 파괴적 동작에 이름과 확인 (B-1)

`login.html` 의 '동의하지 않고 나가기'가 **confirm 없이 바로 cascade 삭제**를 호출했다.
게이트 화면에 '계정이 삭제된다'는 말이 한 줄도 없었다.

- ⚠️ **삭제 호출 자체는 법적 필수라 그대로 둔다**(거부 = 즉시 파기). 없앤 게 아니라 확인을 더한 것.
- 라벨 → **'동의하지 않고 계정 삭제하기'**. 파괴적 동작이 이름에 드러나야 한다.
- `confirm` + 지워질 것 명시.
- **이 화면을 보는 사람은 두 종류다.** ① 방금 가입한 사람(지울 것이 빈 계정) ② 약관 개정으로
  재동의를 요구받은 기존 회원(저장한 답변·경험 카드·구매한 크레딧이 걸려 있다).
  ②에게는 **'나중에 하기'(로그아웃만)** 를 연다 — '나가기'로 읽고 오탭하면 몇 달치가 사라진다.
  판정은 `MONC.getConsent()` 의 `agreed_at` 유무. `undefined`(컬럼 미생성)면 **안전한 쪽인
  기존 회원으로 취급**한다.
  ⚠️ '나중에 하기'가 **간주 동의가 아니다**: 동의 기록이 없으므로 다음 로그인에 게이트를
  다시 만나고 회원 페이지는 `requireConsent()` 가 계속 막는다. 결정을 미루는 길일 뿐이다.
- ⚠️ 지금은 `TERMS_VERSION` 이 최초값이라 ②가 0명이다. **약관을 올리는 순간 전원이 ②가 된다** —
  그때 급히 만들면 늦는다.

## 2026-08-02 회원 탈퇴 창구 (B-2)
`privacy.html` 이 회원 정보를 '회원 탈퇴 시까지' 보관한다고 고지하는데 학생이 그 요구를
행사할 창구가 사이트에 없었다(`deleteMyAccount()` 호출처가 동의 게이트 하나뿐).
- 마이페이지 '내 정보' 접이 맨 아래. **접이 안에 둔 것은 의도** — 자주 누를 것이 아니고
  로그아웃 버튼과 나란히 두면 오탭 위험이 커진다.
- confirm + '탈퇴' 타이핑 2단계. 삭제는 **동의 게이트와 같은 `MONC.deleteMyAccount()`** 재사용
  (두 벌로 나누면 한쪽만 고쳐져 데이터가 남는다).
