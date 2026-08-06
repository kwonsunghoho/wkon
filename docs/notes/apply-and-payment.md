# 신청·결제·모집일정·오픈 알림 — 상세 기록

## ⚠️ 브라우저가 넣는 신청은 '결제 전' 상태만 (2026-08-04 보안 점검)

**구멍**: `applications_insert_public` 이 `member_id` 만 검사했다. 비회원 신청 때문에 anon INSERT 가 열려 있는데 컬럼 제약이 없어, 누구나 anon key 로 `paid=true`·`payment_status='paid'`·`paid_amount` 를 임의로 채운 행을 넣을 수 있었다 — **admin 신청 목록에 입금 완료로 뜬다.** 특강이면 `lecture_id`·`slot_id` 를 넣어 정원까지 먹는다(정원 가드가 결제 여부를 안 보고 행 수만 센다).

**고친 방식**(migration `20260804150000_rls_hardening.sql`): WITH CHECK 에 `paid=false · refunded=false · refunded_amount=0 · payment_id is null · paid_amount is null · payment_status='pending'` 을 강제. `apply.html`·`lecture.html` 이 보내는 payload 는 이 컬럼들을 안 건드리므로 정상 신청은 그대로 통과하고, **카드 결제 행은 verify-payment 가 service_role 로 넣으므로 영향이 없다.**

**특강 정원 소모 차단(2026-08-05 오너 확정 — '로그인해야 신청')**: 위의 '남는 것'을 닫았다. 특강(`lecture_id` 있는 신청)은 로그인한 본인만 넣을 수 있다. 화면·verify-payment·RLS 세 겹 방어이고 상세는 `docs/notes/lectures.md` 맨 위 절. 챌린지는 종전대로 비회원 신청 유지. migration `20260805140000_lecture_login_required.sql`.

**같이 하드닝한 콘솔 생성 표**: `reviews`(공개 읽기는 `visible` 인 것만·쓰기 관리자만) · `challenge_rounds`(공개 읽기 전체·쓰기 관리자만). 둘 다 콘솔에서 만든 표라 레포에 RLS 선언이 없었다 — `applications` 가 2026-07-11 에 같은 이유로 하드닝된 전례.

**⚠️ 콘솔에서 정책을 손으로 만들지 말 것**(2026-08-04 실측). `pg_policies` 를 떠 보니 콘솔에서 붙인 정책 7개가 남아 있었고, 그중 **`anyone can apply`**(applications INSERT · `with check true`)가 위 제한을 통째로 무효화하고 있었다 — **정책은 OR 로 합쳐지므로 헐거운 쪽이 이긴다.** 마이그레이션은 이름을 아는 정책만 지울 수 있어서, 레포가 모르는 정책은 조용히 살아남는다. 지운 7개: `anyone can apply` · `admin manage applications` · `member reads own applications` · `admin write rounds` · `public read rounds` · `admin manage reviews` · `public read visible reviews`(뒤 6개는 레포 정책과 같은 내용의 중복본). 정책을 손볼 일이 생기면 마이그레이션 파일로 한다.

## ⚠️ 챌린지 피드백은 '중간 점검 1회'다 — 과장 문구 재도입 금지 (2026-08-02 오너 확인)

사실: 2주(14일) 기간 · 주중 매일 미션 · **총 10회차(DAY 1~10)** · 코치 **중간 점검 1회**.
**개별(1:1) 피드백 상품은 아직 없다**(오너: "개별 피드백이 있는 상품도 개발할건데 아직은 없긴해").

- **확정 워딩(2026-08-02 오너)**: 판매 문구는 **'코치와 함께하는 2주'**(횟수를 안 세는 자리 — 신청 히어로 배지·마이페이지), 구체 항목·약관은 **'코치 1:1 중간 점검'**. 중간 점검은 실제로 **1:1 개별**이다.
- ⚠️⚠️ **챌린지별 진행 방식이 다르다 — 약관·상품정보 고시에 이름으로 갈라 적는다**(2026-08-02 오너 확인).
  - **보.신.각 · 스.피.닝 · 영.합.각** = 진행 중간에 담당 코치의 **1:1 개별 점검**.
  - **승.자.각** = 코치 **가이던스 영상**을 따라 매일 답변을 직접 작성(**1:1 점검이 아니다 — 승자각 화면에 '1:1' 을 쓰지 말 것**).
  - '챌린지별 최소 1회' 같은 **뭉뚱그린 표현으로 되돌리지 말 것** — 그렇게 쓰면 승자각까지 1:1 을 약속한 게 된다(그 표현으로 한 번 나갔다가 같은 날 정정).
- 지웠던 표현 — **되살리지 말 것**: `24시간 이내 1:1 피드백`(빈도가 거짓) · `코치 개별 피드백`(매 회차로 읽힘) · `매일 미션을 올리면 코치가 다음 날 코멘트를 남깁니다` · `매일 하나씩 쓰고 피드백받으며`. **'1:1' 자체는 사실이라 살아 있다 — 문제는 빈도였다.**
- 고친 곳(1차 12군데 + 워딩 확정 15군데): `apply.html`(히어로 배지·상품정보 3줄·FAQ) · **`terms.html`(상품형태·제공방식·진행주기)** · `login.html` 혜택 줄 · `mypage.html` 상태 문구 2곳 · `challenge-answer.html` 추천 카드.
- ⚠️ **약관·상품정보 고시는 분쟁 시 기준이 되는 글이다.** 판매 문구를 세게 쓰고 싶어도 이 세 곳은 실제 제공 내용과 같아야 한다. 개별 피드백 상품이 실제로 나오면 그때 상품별로 나눠 쓴다(지금 상품에 소급 적용 금지).
- 데이터 모델은 일차별 코멘트를 담을 수 있다(`daily_records.comment`) — **담을 수 있다는 것과 매일 준다는 것은 다르다.** 화면 문구는 실제 운영을 따른다.

> 2026-07-30 CLAUDE.md 다이어트로 이관한 기능별 상세 기록·의사결정 원장이다.
> 매 작업 공통 규칙은 CLAUDE.md 에 있고, 이 문서는 해당 기능을 고칠 때 읽는다.
> 본문 속 '위/아래 ○○ 절 참조'는 구 CLAUDE.md 기준 표현이라, 그 절은 docs/notes/ 의 다른 문서에 있을 수 있다.

### Application flow — `apply.html` is the source of truth
All "신청하기" CTAs navigate to **`apply.html`** (detail pages → `apply.html?c=<recruit-id>` to preselect). **Bank account, curriculum, and the submit schema live in apply.html** — edit there. **⚠️ 챌린지 공통 참가비는 admin에서 관리(2026-07-24):** `site_config.challenge_price`(jsonb 숫자, admin '챌린지' 탭 상단 입력)가 단일 소스. apply.html은 `loadChallengePrice()`로 읽어 `let PRICE`에 넣고 **카드 가격·요약 라벨·FAQ·결제 금액 전부 이 값에서** 파생(하드코딩 "3만원" 금지 — 숫자 `toLocaleString()+'원'` 표기). **⚠️ 폴백은 두 곳이고 값이 다르다**(2026-08-02 오너 지시로 브라우저만 33,000 으로 올렸다): 브라우저는 `apply.html`의 `let PRICE = 33000`, 서버는 `verify-payment/index.ts`의 `PRICE_PER_CHALLENGE_FALLBACK = 30000`. **둘 다 DB 를 못 읽었을 때만 쓰인다** — `site_config.challenge_price`가 설정돼 있으면 양쪽 다 그 값을 쓰므로 어긋나지 않는다. 4개 챌린지 공통 단일가(챌린지별 다른 가격 아님). **⚠️ verify-payment(서버)도 같은 `site_config.challenge_price`를 읽어 금액 검증** — 값을 바꾸면 함수 재배포가 돼 있어야 토스결제 금액이 맞는다(계좌이체는 apply.html 계산이라 무관). 특강 가격은 `special_lectures.price`(특강별). **⚠️ 보증금·환급 제도는 2026-07-20 전면 폐지**(PG 간편결제 심사에서 '보증금 환급' 문구가 승인 거절 사유). 보증금·환급 워딩을 공개 페이지에 재도입하지 말 것(admin·mypage의 '환급' UI는 기존 신청자 보증금 반환 관리용으로만 잔존).
- **⚠️ `application-modal.js`(자기 주입 신청 모달, 진입점 `.app-modal-btn`)는 2026-07-30 삭제 — 되살리지 말 것.** 상세 4종이 `<script>`로 싣고는 있었지만 **네 페이지 어디에도 `.app-modal-btn`이 없어** 381줄·20KB를 받아만 놓고 아무 일도 안 했다(신청은 2026-07-14부터 `apply.html`이 전부 담당). 게다가 로드되는 것만으로 `#applicationModal` CSS를 상세 페이지에 주입하고 있었다. 신청 흐름을 상세 안에서 처리하고 싶어지면 `lecture.html`(특강 상세 안 인라인 폼)이 정본 패턴이다.
- The old inline modal in `index.html` (its markup + CSS + `openApplicationModal`/`submitApplication`/`copyAccount` + `?openModal=true`) was **removed 2026-07-14** in a dead-code cleanup.

## apply.html(구 CLAUDE.md Pages 항목)

- `apply.html` — **신청·결제 전용(모든 신청 CTA의 목적지).** 히어로 → 챌린지 카드 4개(클릭=선택+커리큘럼 아코디언, 다중선택 장바구니) → 회원가입 배너(→login.html) → 조합 추천 → FAQ → 계좌이체 폼 → 하단 고정 요약바. `?c=voice,answer`로 프리셀렉트. `supabase-config.js`+`recruit.js` 로드, `loadChallengeStatuses()`로 마감 카드 비활성, 제출 `MONC.sb.from('applications').insert(...)`. 챌린지·FAQ는 하단 인라인 `CHALLENGES`/`FAQ` 배열(FAQ #3·#6·#7 임시 문구). **회원 모드**: 로그인 시 `getMyProfile()`로 이름·전화 자동채움·insert에 `member_id` 포함(→마이페이지 연동)·전화 미보유 시 `members`에 저장. **⚠️ 법적 필수:** 신청 버튼 위 `#appConsent` 필수 동의 체크(만14세+개인정보 수집·이용) 미체크 시 `submitApplication()`이 차단 — **개인정보 보호법상 삭제·완화 금지.**

### recruit.js (challenges + 상세 4종 + index 공유)
`loadRecruitData()`(Supabase `challenge_rounds` 단일 소스), `applyIndexRecruit()`(`.ch-card` 상태 칩·흑백·`monc:recruitready` 디스패치 — **2026-07-29부터 카드가 challenges.html에 있어 사실상 그 페이지용**, 이름은 구명 유지), `applyDetailRecruit(id)`(상세 + 마감 시 `.apply-btn` 비활성), `loadChallengeStatuses()`(`window._challengeStatuses`), `applyGlobalRecruitCta()`(index 하단 고정 CTA 바 D-day 뱃지 — index에서 호출하는 유일한 함수). 챌린지 정체성 = `data-recruit-id`(`voice`/`expression`/`spinning`/`answer`), 카드·폴백 전반 일관.
- **⚠️ 데이터 소스는 Supabase `challenge_rounds` 단일(2026-07-23 구글 시트 CSV 폴백 제거 · 2026-08-02 하드코딩 날짜 폴백도 제거 — admin 단일 관리):** `loadRecruitData()`는 `loadRecruitDataFromSupabase()`만 부른다. **날짜 폴백이 없다** — 모르면 칩을 아예 안 그린다. `RECRUIT_FALLBACKS`·`data-recruit-start/-end` 는 레포 코드에 남아 있지 않다(문서 안 언급은 전부 과거 사고 기록). 각 호출부(`applyIndexRecruit`/`applyDetailRecruit`/`loadChallengeStatuses`/`applyGlobalRecruitCta`)는 **'안 한다'와 '모른다'를 가른다**: 조회 성공 + 그 챌린지 행 없음이면 `'none'`(다음 기수 준비 중 · 신청 닫힘 → 오픈 알림), 조회 실패(`loadRecruitDataFromSupabase()` 가 `null` 반환)면 상태 키를 안 넣고 '불러오지 못했어요'만 띄운 채 **버튼은 살려 둔다**(최종 판정은 DB 트리거·verify-payment). ⚠️ 그래서 일부 기수만 등록된 상태에선 **미등록 챌린지가 '다음 기수 준비 중'으로 뜬다 — admin '챌린지' 탭에서 기수를 등록하면 자동 반영**(코드가 아니라 데이터 문제). 상태 상세는 아래 '⚠️ 모집 상태 네 갈래' 절. **구글 시트/CSV 폴백도, 하드코딩 날짜 폴백도 재도입하지 말 것.**
- **⚠️ `applyDetailRecruit`는 로딩 중 날짜를 숨긴다(2026-07-23 오너 "새로고침마다 날짜가 다르게 보인다"):** 구 버전은 `await loadRecruitData()` **전에** HTML 하드코딩 날짜가 그려진 채였다가 원격 도착 후 교체돼, 새로고침 타이밍마다 하드코딩값↔원격값 플래시가 보였다(캐시·최적화 문제 아님, 렌더 순서 문제). 지금은 함수 진입 즉시 chip을 `'모집기간 확인 중…'`(opacity .55)로 덮고, **데이터가 온 뒤에만** 실제 기간을 그린다. ⚠️ 로딩 표시로 chip의 `<strong>`이 사라지므로 도착 후엔 **항상 `innerHTML`을 새로 조립**(구 버전은 `open && dday` 조합에서만 재구성해, 그 외 엣지에서 빈 chip이 됐다). 하드코딩 날짜를 곧바로 표시하는 방식으로 되돌리지 말 것.

### 오픈 알림 대기 명단 (`waitlist.js` + `challenge_waitlist`) — 2026-07-30 신설
마감·모집예정 챌린지에 **연락처를 남길 자리**를 만든 것. 배경: 4개 중 2개가 마감인데 상세페이지가 `alert('다음 회차를 기다려주세요!')`로 끝나서, **전·후 오디오 14개와 후기 55개를 다 보고 마음먹은 사람이 그 경고창만 보고 나갔다.**
- **자기 주입 공용 컴포넌트**(`nav.js`·`blind-quiz.js` 패턴). `<script src="waitlist.js" defer>` 두 줄이면 되고, 열 자리에서 `MONC.openWaitlist(challengeId, status)`를 부른다. ⚠️ **상세 4종에 모달을 복사해 넣지 말 것** — 그 네 파일의 인라인 `<style>` 공통 블록은 글자 그대로 같아서 한 곳만 고치면 넷이 어긋난다.
- **입구 2곳(오너 확정)**: ① 상세 4종의 `handleApply()` — 마감·모집예정이면 모달을 연다(⚠️ `alert` 폴백을 지우지 말 것, waitlist.js 로드 실패 시 최소한 상태는 알려야 한다) ② `apply.html` 마감 카드의 `.wl-cta`(기본 `hidden`, `applyStatuses()`가 켠다). **챌린지 허브는 일부러 제외** — 아직 마음을 정하기 전 화면이라 연락처를 남길 마음이 약하다. **마감 + 모집예정 둘 다**에 보여준다.
- **⚠️⚠️ 등장 연출에서 투명도를 애니메이션하지 말 것 — 실측으로 두 번 겪었다.** ① `requestAnimationFrame`으로 `opacity 0→1` 클래스를 붙이는 방식은 탭이 백그라운드면 rAF 가 늦어 **모달이 안 보인 채로 남는다** ② CSS 애니메이션으로 옮겨도 애니메이션이 일시정지되면 **첫 프레임(투명)에 멈춰** 똑같이 안 보인다(`fill-mode`를 떼도 재생 중에는 애니메이션 값이 이긴다). 지금은 배경막이 **처음부터 불투명**하고 움직임은 `.wl-box`의 위치만(`wl-rise`)이다 — 멈춰도 상자가 14px 아래 있을 뿐 내용은 보인다. **실패 방향이 '열림'이어야 한다.**
- **⚠️ 법적 필수**: 이름·전화는 개인정보다. `#wlAgree`(만14세 + 수집·이용) 필수 체크를 **사용자가 직접 켜야** 제출 버튼이 열린다. 사전 체크·'간주 동의'·체크 삭제 금지(apply.html·lecture.html 과 동일 규정). 동의 시각은 `agreed_at`, 약관 버전은 `terms_version`에 남긴다. 고지 문구는 **12px 하한**(9대 원칙 1) — 법적 고지라도 더 줄이지 말 것.
- **⚠️ `applications` 에 섞지 말 것**(섞자는 안은 명시적 기각): 중복 신청 트리거(MC002)·정원 트리거가 대기 명단을 '신청'으로 세고, admin 신청자 현황·CSV·매출 집계가 오염된다. 대기 명단은 **아직 안 산 사람**이다.
- **⚠️ 중복은 에러가 아니라 '이미 신청됨'**이다. `challenge_waitlist_uq`(challenge + 숫자만 뽑은 전화)가 막고, 클라이언트는 `23505`를 완료 화면으로 돌린다.
- **⚠️ 테이블 미생성 판정은 `PGRST205`** — PostgREST 는 `42P01`이 아니라 `PGRST205`("Could not find the table … in the schema cache")를 돌려준다(실측). `42P01`만 보면 안내 분기를 영원히 못 탄다. `waitlist.js`·admin 양쪽 같은 판정.
- **⚠️ apply.html 의 `.wl-cta` 클릭은 `stopPropagation` 필수** — 안 하면 카드 선택 토글까지 같이 돈다. `display:block`이 UA `[hidden]`을 이기므로 `.wl-cta[hidden]{display:none}` 가드도 유지.
- **admin '오픈 알림' 탭**: 챌린지 필터 · 연락 완료 숨기기 · **전화번호 `tel:` 링크**(보고 바로 거는 작업대다) · [연락 완료]/[되돌리기] · 삭제 · CSV. ⚠️ 자동 발송 기능이 없으므로 **'사람이 보고 연락한다'가 전제**이고, 그래서 [연락 완료] 체크가 핵심이다 — 누구에게 연락했는지 남지 않으면 명단의 용도가 사라진다. ⚠️ 조회는 `select('*')`(컬럼 나열 시 미적용 환경에서 400). ⚠️ **안내가 끝난 명단은 삭제를 권한다** — 개인정보는 목적을 다하면 파기.
- **RLS**: INSERT 공개(비회원도 남긴다, `member_id`는 null 또는 본인 uid만), SELECT/UPDATE/DELETE 는 `is_admin()`만. ⚠️ **본인 조회조차 열지 않는다** — 전화번호로 명단을 조회할 창구를 만들면 번호만으로 '이 사람이 관심을 남겼는지' 캐낼 수 있다(중복 신청 가드에서 비회원 사전 조회를 막은 것과 같은 이유).
- migration `20260730120000_challenge_waitlist.sql` — **owner 실행 필요.** 미적용 시 degrade: 제출이 실패하며 '준비 중' 안내가 뜨고, admin 탭은 마이그레이션 실행 안내를 보여준다. 챌린지 신청·결제는 영향 없음.

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
- **⚠️ 원장은 DB 트리거 하나(`applications_duplicate` → errcode `MC002`, message `duplicate_application`).** 신청이 들어오는 길이 **다섯**(챌린지 계좌이체·토스 / 특강 무료·계좌이체·토스)인데 전부 `applications` insert 로 수렴하므로 여기서 한 번 막는 것이 빠짐없이 차단할 수 있는 유일한 방법이다. **브라우저 검사만으로 대체하지 말 것** — 비회원은 RLS 때문에 사전 조회가 아예 불가능하고(아래), 검사와 저장 사이의 틈은 늘 남는다.
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

## 백엔드 구성 원문(구 CLAUDE.md 'Backend: there is no server')

## Backend: there is no server

"Backend" = **Google Apps Script + published Google Sheets** and **Supabase**, called from the browser.

1. **Applications & reviews (legacy Apps Script)** — `APPLICATION_API_URL`. `POST {action:"application"}` **always appends a new row** to the **학생현황** sheet (dup phone irrelevant; phone stored with a leading apostrophe to keep the `0`). `GET ?action=reviews` returns the **후기** sheet. **Owned/edited in Google's console, not this repo** — changes need the owner to redeploy a new version.
2. **Recruitment dates** — **Supabase `challenge_rounds`(admin '챌린지' 탭에서 CRUD — 구명 '모집일정', 2026-07-30 개편)가 단일 소스.** `recruit.js`가 읽어 모집중/예정/마감 + D-day chips를 그린다. **날짜 폴백은 없다**(2026-08-02 제거) — 미등록 챌린지는 `'none'`(다음 기수 준비 중), 조회 실패는 상태 키 없음('불러오지 못했어요' + 버튼 유지)으로 간다. **⚠️ 구 published Sheet CSV(`RECRUIT_CSV`·`loadRecruitDataFromCsv`)는 2026-07-23 완전 제거 — 구글 시트 폴백도, 하드코딩 날짜 폴백(`data-recruit-*`·`RECRUIT_FALLBACKS`)도 재도입 금지(admin 단일 관리).**
3. **Supabase** — `supabase-config.js` (`MONC.sb`). Auth/members, `applications`, `reviews`, `site_config`, `page_events`, `news_articles`, `news_scraps`. **Tables/RLS/columns are created by the owner in the Supabase console.** Migrations in the repo are the source, but the owner must run each in the SQL Editor before it takes effect; **unapplied migrations degrade gracefully** (features fall back silently).
4. **뉴스 수집기 (GitHub Actions)** — 예외적으로 **브라우저 밖에서 도는 유일한 코드**. `scripts/fetch-news.mjs`가 3시간마다 구글뉴스 RSS를 긁어 `news_articles`에 쓴다(service role 키는 GitHub Secrets). 아래 '항공 뉴스 수집 파이프라인' 참조.

## 2026-08-02 UX 진단 반영 — 모집 상태·결제 폼·결제 복귀

### ⚠️⚠️ 모집 상태 하드코딩 폴백 금지 (A-1 실사고)
`recruit.js` 의 `RECRUIT_FALLBACKS` 에 6월 날짜가 박혀 있어서, Supabase 조회가 실패하면
`getStatus()` 가 전부 `'closed'` 를 냈다. **방문자에게는 오류가 아니라 "이 사이트는 모집이
끝났다"로 보였고, 오류처럼 안 보이니 재시도도 안 한다.** `challenge_rounds` 에 행이 없기만
해도 같은 길을 탔다 — 장애만의 문제가 아니었다. 재현 완료(목으로 조회 실패 → 4장 전부 '마감').
- 지금은 **모르면 상태 키를 아예 안 넣는다.** 소비처 4곳(apply.applyStatuses ·
  apply.reorderCards · challenges.heroReorder · index.challengeChip)이 이미 '키 없음'을
  안전하게 다룬다 — 비활성 안 함·정렬 가운데·개수 안 셈.
- 상세 4종 `#recruitChip` 의 `data-recruit-*` 도 제거. 실패 시 '모집 기간을 불러오지
  못했어요 · 새로고침', apply 는 `#recruitFail` 안내. **어느 쪽도 신청 버튼을 막지 않는다** —
  잔여석·중복·마감 최종 판정은 DB 트리거와 verify-payment 가 한다.
- **하드코딩 날짜를 다시 넣지 말 것.** 이 절이 그 이유다.

### 결제 폼 3종 (A-2)
- `.inp` **font-size 16px 하한** — iOS 는 15px 이하 입력칸에서 화면을 확대하고 안 되돌린다.
  같은 조건이던 onboarding·news 2곳·answers 도 같이 올렸다. **15px 로 되돌리지 말 것.**
- **전화번호 검증** — 구 검증은 `if (!name || !phone)` 이 전부라 '1' 한 글자도 통과했다.
  ⚠️ 여기 있던 '이름 2자·숫자 10자리' 규칙은 2026-08-02(오후) **`phone-check.js` 한 곳으로
  옮겨졌다**(아래 '전화번호 양식 검증' 절의 표가 현행). `waitlist.js` 도 `window.MONC_PHONE`
  을 부르고, 그 안의 `length >= 10` 은 파일이 없을 때만 쓰는 폴백이다.
  **페이지끼리 값을 맞추는 게 아니라 `phone-check.js` 하나만 고친다.**
- **오류는 인라인**(`.field-err`) — alert 은 어느 칸이 틀렸는지 못 알려주고 닫으면 사라진다.
  제출 3경로 전부 교체.
- **로그인 링크 returnTo** — 자동 리다이렉트는 이미 붙이는데 사람이 누르는 링크에만 빠져
  있었다. apply 는 선택한 챌린지까지 싣는다(`?c=` — `preselectFromUrl` 기존 규약,
  `a.js-login-ret` 클래스를 `syncLoginReturn()` 이 갱신).

### 결제 복귀 대기 화면 (D-7 · `pay-return.js`)
모바일 결제는 `?payresult=1` 로 **페이지가 새로 뜬다.** verify-payment 왕복이 끝날 때까지
평소와 똑같은 화면이 보여서 뒤로가기·새로고침을 누르게 됐다(트래픽 99%가 이 경로).
- `?payresult` 를 스스로 보고 **즉시** 뜬다. 끝나면 `moncPayDone()`.
- ⚠️ **`defer` 를 붙이지 말 것** — 페이지 인라인 스크립트가 URL 에서 payresult 를 지운 뒤
  실행돼 오버레이가 아예 안 뜬다(실측).
- 30초 안전장치 — 어떤 이유로든 화면이 잠기면 안 된다.
- 대기 중인 주문이 없으면(직접 접근) 즉시 사라진다.

## 2026-08-02(오후) 전화번호 양식 검증 — `phone-check.js` 공용 (오너 지시)

오너: "전화번호 양식이 다를 시 가입 또는 신청 안 되게 해줘".

**왜 한 파일인가**: 같은 사람이 같은 번호를 **다섯 창구**에 넣는다 — 가입(onboarding) ·
챌린지 신청(apply) · 특강 신청(lecture) · 오픈 알림(waitlist) · 마이페이지 연락처 수정.
각자 검증을 들고 있으면 한쪽만 통과하는 번호가 생긴다(실제로 그랬다).
**규칙을 바꾸려면 `phone-check.js` 하나만 고친다. 페이지에 정규식을 복사하지 말 것.**

| 규칙 | 값 |
|---|---|
| 010 | 숫자 **정확히 11자리** (10자리 010 은 전환 완료된 지 오래라 지금 오면 오타) |
| 011·016·017·018·019 | 10~11자리 |
| 유선(02·03x·04x·05x·06x)·070 | **거부** — 연락이 문자·카톡이라 휴대전화가 아니면 안내가 안 간다 |
| `+82`·`82` 접두 | 국내 형식으로 되돌린 뒤 검사(붙여넣기가 흔하다) |
| 하이픈·공백·괄호 | 자유(숫자만 뽑아 본다). **입력 중 자동 포맷팅은 안 한다** — 커서가 튀어 오히려 오입력이 는다 |

- 오류 문구는 **무엇이 틀렸는지**를 말한다(유선번호/자릿수/시작 숫자를 구분).
- 이름도 같은 파일에서 본다(2~20자) — 같은 창구가 같은 값을 받으므로.
- 표시는 화면 성격을 따른다: apply·lecture 는 **필드 아래 인라인**, onboarding 은 그 화면의
  상태 줄, waitlist 는 시트 안 `.wl-msg`.
- ⚠️ `phone-check.js` 가 없는 페이지에서도 죽지 않게 각 호출부에 폴백을 남겼다.

## 2026-08-02(오후) 참가비 폴백 33,000
`apply.html` 의 `let PRICE` 는 **DB 를 못 읽었을 때만** 쓰이는 값이다. 화면 금액을 바꾸려면
**admin '챌린지' 탭의 참가비**를 고친다 — 단일 소스는 `site_config.challenge_price` 다.
폴백과 admin 기본값을 33,000 으로 맞춰 두었다(오너 지시). 코드에 금액을 박지 말 것.

## 폼 오류 인라인화 마무리 (2026-08-02 · 진단 D-6)

이름·전화는 이미 인라인이었는데 **'챌린지 미선택'과 '동의 미체크'는 alert 로 남아 있었다.**
alert 은 닫는 순간 문구가 사라지고, 모바일에서 **어디를 고쳐야 하는지**를 못 알려준다.

- **apply.html**: `validateOrder()` 하나로 합쳤다 — 챌린지 선택 → 이름·전화 → 동의 순.
  세 결제 경로(계좌 안내·계좌 확정·토스)가 **같은 함수**를 부른다.
  ⚠️ 세 곳에 검사를 복사하지 말 것 — 한쪽만 고쳐지면 그 경로로만 빠져나간다.
  ⚠️ 계좌 모달 경로는 `validateOrder({noScroll:true})` 로 먼저 판정하고, 실패면 **모달을 닫은 뒤**
     다시 불러 표시·스크롤한다. 인라인 오류는 모달 뒤에 가려 안 보인다.
  - 오류 자리: `#errPick`(챌린지 카드 **바로 아래** — 결제 버튼 옆에 두면 무엇을 고르라는 건지
    안 읽힌다) · `#errConsent`(동의 라벨 아래).
- **lecture.html**: 같은 규칙으로 `setBlockErr()` + `#lcErrSlot`(시간대) · `#lcErrConsent`.
  ⚠️ 두 파일은 같은 결제 흐름이다. 한쪽만 고치지 말 것.
- **남긴 alert 은 폼 오류가 아니다** — 결제 결과·모듈 로드 실패·중복 신청(전액 환불 안내).
  apply 21→15 · lecture 16→14. 이 셋은 '어느 칸이 틀렸다'가 아니라 결과 통보라 alert 이 맞다.
- **실측**: 미선택·미동의·이름 빔 각각에서 alert 0건, 인라인 문구 표시·해제 정상,
  전부 채우면 통과(393px · apply/lecture 양쪽).

## ⚠️ 모집 상태 네 갈래 — '모른다'와 '안 한다'를 가른다 (2026-08-02 실사고 2건)

하루에 **양쪽으로 다 틀렸다.** 둘 다 같은 뿌리 — 상태를 둘로만 봤다.

| 상태 | 뜻 | 화면 | 신청 |
|---|---|---|---|
| `open` | 모집 기간 안 | 모집 M/D~M/D · D-n | 열림 |
| `upcoming` | 모집 시작 전 | 모집 예정 | 닫힘 → 오픈 알림 |
| `closed` | 모집 끝남 | 다음 기수 준비 중 | 닫힘 → 오픈 알림 |
| **`none`** | **조회 성공 + 그 챌린지 행 없음 = admin 에 기수 미등록** | 다음 기수 준비 중 | **닫힘 → 오픈 알림** |
| `null` | **조회 실패**(네트워크·권한) = 정말 모른다 | 불러오지 못했어요 · 새로고침 | **열림**(서버가 재판정) |

- **사고 ①** `RECRUIT_FALLBACKS` 에 6월 날짜가 박혀 있어 조회 실패 시 전부 `closed`.
  방문자에겐 오류가 아니라 "이 사이트는 모집이 끝났다"로 보였다.
- **사고 ②** ①을 고치면서 **`none` 과 `null` 을 같이 '키 없음'으로** 두었다.
  소비처의 **`window._recruitStatus || 'open'`** 기본값 때문에 **기수가 하나도 없는데
  전 챌린지가 신청·결제 가능**해졌다(오너 지적 — admin 은 '등록된 기수가 없습니다' 상태였다).

### 고친 자리 (한 곳만 고치면 안 된다 — 다섯 곳이 같은 상태를 읽는다)
- `recruit.js loadChallengeStatuses()` — 조회 성공인데 행이 없으면 `'none'` 을 넣는다.
  조회 실패면 **키를 안 넣는다**(그때만 '모름').
- `recruit.js applyDetailRecruit()` — `status` 계산에 `(data ? 'none' : null)`.
  칩·`.apply-btn` 문구 '다음 기수 준비 중'.
- `recruit.js applyIndexRecruit()` — 홈 카드도 `'none'` 이면 흑백 + '다음 기수 준비 중'.
- **상세 4종 `handleApply()`** — ⚠️ **`|| 'open'` 을 되살리지 말 것.**
  `if (state && state !== 'open')` 로 바꿨다. `state` 가 null 인 경우는 **조회 실패뿐**이다.
- `apply.html applyStatuses()` — `'none'` 을 마감과 같이 처리(카드 비활성 + '준비 중' 태그 +
  오픈 알림 버튼). `reorderCards`·`challenges.heroReorder` 의 rank 에 `none: 2` 추가.

### 검증(재현 가능)
`challenge_rounds` 를 목으로 갈아끼워 세 경우를 각각 연다 — `scratchpad/recruit-gate.mjs`.

## 선착순 기수 — `challenge_rounds.start_mode` (2026-08-06 오너 요청)

날짜 마감 외에 **"인원이 모이면 바로 시작"하는 선착순 기수**를 열 수 있다.
마이그레이션 `20260806170000_challenge_rounds_fcfs.sql`(`start_mode` 'scheduled'/'fcfs' + `recruit_end` nullable).

- **판정**: `start_mode='fcfs'** 면 `recruit_end` 가 null 이어도 정상 기수다. `getStatus()` 는
  마감 없음 = 시작했으면 계속 `open`. 마감(닫기)은 admin 이 수정(마감일 입력·개강일 지정 전환)·삭제로 한다.
- **화면 문구**: 허브 카드 띠 '모집 중 · 선착순' + 메타 '선착순 모집 8/6~', 상세 칩
  '선착순 모집 중 · 인원이 모이면 바로 시작', 하단 CTA 뱃지는 날짜 D-day 가 하나도 없을 때만 '선착순 모집 중'.
  D-day 는 없다(마감이 날짜가 아니다).
- **⚠️ null 마감을 'none' 으로 떨어뜨리지 말 것** — `loadChallengeStatuses`/`applyIndexRecruit`/
  `applyDetailRecruit`/`applyGlobalRecruitCta`/`challenge-sticky.js` 다섯 곳 모두
  `(!end && !fcfs)` 일 때만 미등록 취급한다. 선착순 행이 '다음 기수 준비 중'으로 보이면 이 조건이 깨진 것.
- **⚠️ `loadRecruitDataFromSupabase` 는 `select('*')`** — `start_mode` 를 나열하면 마이그레이션
  미적용 환경에서 조회 전체가 400 난다. 미적용이면 `fcfs=false` 로 떨어져 기존 동작 그대로.
- 서버는 모집 기간을 안 본다(중복·정원만 판정) — 선착순이라고 verify-payment 를 고칠 일은 없다.
- 검증: `scratchpad/recruit-fcfs-test.mjs`(node 16검사) + admin 검사대·상세/허브 목 주입 실측(2026-08-06).
1. **기수 0건**: 상태 `none` · 칩/버튼 '다음 기수 준비 중' · 버튼을 눌러도 **apply.html 로 안 감** ·
   오픈 알림 시트가 열림 · 신청 페이지 카드 4개 전부 비활성 + '준비 중' + 오픈 알림 버튼.
2. **보이스만 모집 중**: voice 만 열림, 나머지 3개는 '준비 중'.
3. **조회 실패**: 버튼 살아 있음 + '불러오지 못했어요 · 새로고침'(사고 ① 재발 방지 유지).

### 오픈 알림은 어디에 있나
**독립 코너가 없다.** 모집 중이 아닌 챌린지에서만 나타난다 —
`apply.html` 카드 안 '오픈 알림 받기' 버튼, 상세 4종의 신청 버튼(누르면 바텀시트).
`waitlist.js` 가 `challenge_waitlist` 에 쌓고 admin '오픈 알림' 탭에서 본다.
⚠️ 사고 ② 동안에는 **전 챌린지가 'open' 이라 이 버튼이 어디에도 안 떴다** — 오너가
"오픈알림받기 코너가 대체 어디 있냐"고 물은 것이 그 증상이다.
