# 특강(special_lectures) 시스템 — 상세 기록

> 신청 폼 결제 버튼 아래 카카오톡 문의 줄(`.kakao-ask` · 2026-08-09)은 apply.html 과 한 벌 — 규칙은 apply-and-payment.md '결제 버튼 아래 카카오톡 문의' 절.

## ⚠️ 특강 신청은 로그인 필수 (2026-08-05 오너 확정)

챌린지는 비회원 신청을 유지하지만 **특강은 로그인한 회원만** 신청한다. 비회원이 계좌이체 신청으로 정원을 대량으로 먹어 실제 신청을 막는 구멍을 닫았다(2026-08-04 RLS 점검에서 '남는 자리'로 남겨 뒀던 것).

방어 세 겹 — 하나만 고치지 말 것:
- **화면(`lecture.html`)**: 비로그인이면 신청 폼 대신 '로그인하고 신청하기'(`showLoginGate()` · `_loginGated`). 하단 고정바 버튼도 로그인으로 보낸다. `readApplicant()` 도 `_memberId` 없으면 로그인으로 튕긴다(게이트가 그려지기 전 클릭 방어).
- **서버(`verify-payment`)**: `lectureId` 결제에 JWT 를 요구한다. 비로그인이 결제까지 오면 실결제(PAID)는 **전액 자동 환불** 후 `login_required` 로 거절(돈만 나간 상태를 안 남긴다). `member_id` 는 body 가 아니라 **JWT(caller) 로 정한다** — 특강은 항상 caller 명의, 챌린지는 body 값이 caller 와 일치할 때만 적는다.
- **DB(`20260805140000_lecture_login_required.sql`)**: `applications_insert_public` 에 `(lecture_id is null or member_id = auth.uid())` 추가. anon 은 `auth.uid()` 가 NULL 이라 특강 행을 못 넣는다. 카드 결제 특강은 verify-payment 가 service_role 로 넣어 이 정책과 무관.

**2026-08-05 세 겹 모두 적용 완료**(오너 실행 — RLS SQL + verify-payment 재배포, `lecture.html` 은 main 병합으로 라이브 반영).

⚠️ **verify-payment 배포 확인 신호가 바뀌었다**: 로그인 없는 프로브(`{paymentId:'probe', lectureId:'0000…'}`, anon key)는 이제 `lecture_not_found` 가 아니라 **`login_required`** 를 돌려준다(JWT 확인이 특강 조회보다 먼저다). `login_required`=로그인 필수 버전, `lecture_not_found`=그 이전 버전, `bad_request`=특강 이전 구버전, 404=미배포.

## 승.자.각 ↔ 답변 프로그램 = 단계로 나눈다 (2026-08-02 오너 확정)

두 상품이 "하루 하나씩 답변 완성"이라는 **같은 약속**을 해서 서로를 잡아먹고 있었다. 자리를 이렇게 가른다.

- **승.자.각 챌린지** = 모든 항공사에 통하는 **필수 답변 10개**를 2주 동안 **코치와** 만든다(기수제, 입문).
- **답변 프로그램** = 지원할 **항공사의 실전 기출**을 하루 한 개씩 채운다(상시 판매, AI+연구원 검수, 다음 단계).

화면 반영 세 곳: `challenge-answer.html` 최종목표 앞 '다음 단계' 안내 · `programs.html` 히어로 아래 구분 문구 · `program.html` 구매 화면 `.buy-ladder`. **문구를 지우면 두 상품이 다시 같은 말을 한다.**
또 구매 화면에 `answer_programs.description` 을 그린다(`.buy-desc`) — admin '답변 프로그램 > 프로그램' 폼의 **상세 소개** 칸. 이 칸이 비면 가장 비싼 상품의 구매 화면이 제목·일수·가격 네 줄뿐이다.

> 2026-07-30 CLAUDE.md 다이어트로 이관한 기능별 상세 기록·의사결정 원장이다.
> 매 작업 공통 규칙은 CLAUDE.md 에 있고, 이 문서는 해당 기능을 고칠 때 읽는다.
> 본문 속 '위/아래 ○○ 절 참조'는 구 CLAUDE.md 기준 표현이라, 그 절은 docs/notes/ 의 다른 문서에 있을 수 있다.

## lectures.html / lecture.html 개요(구 CLAUDE.md Pages 항목)

- ⚠️ **커버 사진(`.lc-cover`)이 뜰 때 아래 글이 밀리는 것은 그대로 둔다 — 2026-08-03 오너 확정("그대로 둬").** 자리를 미리 잡으려면 `16:9` 같은 비율을 못 박고 넘치는 부분을 잘라야 하는데, **커버는 오너가 올리는 사진이라 비율을 모른다** — 이미 올려둔 커버가 잘려 보일 수 있어서 밀림보다 나쁘다는 판단이다. 비율을 admin 에서 같이 저장하는 안(마이그레이션+admin 수정)은 사진 있는 특강이 늘면 다시 본다. **버그로 보고 aspect-ratio 를 넣지 말 것.** 같은 판단이 `story.html .st-cover`·`reviews-list.html .rv-shot img` 에도 적용된다(pages.md).
- `lectures.html` / `lecture.html` — **특강 시스템(2026-07-24 신설).** nav '특강' + 홈 '특강 문'(.doors, 2026-07-29부터)의 목적지. 아래 '특강(special_lectures) 시스템' 참조. 챌린지와 달리 **상세페이지를 코드로 만들지 않고** admin '특강' 탭 등록분을 `lecture.html?id=<id>` 템플릿이 읽어 그리고, **그 상세페이지 안에서 바로** 토스결제·계좌이체로 신청한다(apply.html 안 거침 — 오너 요청).

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
- **⚠️ 결제 금액 서버검증 = verify-payment가 특강 금액을 DB에서 재확인**: 특강마다 금액이 달라, `lecture.html`은 `functions.invoke('verify-payment', {lectureId, applicant})`로 호출하고 edge function이 `special_lectures`에서 `price`를 읽어 `expected`로 쓴다(브라우저가 보낸 금액 불신). **이 함수는 owner가 재배포해야 특강 결제가 동작**(2026-07-24 배포 완료 — 그때는 `lecture_not_found` 응답으로 확인했다. **2026-08-05 로그인 필수 이후 확인 신호는 `login_required`** — 아래 프로브 항목 참조). 챌린지 경로(`challenges` 배열)도 **금액을 서버가 DB에서 읽는다** — `site_config.challenge_price` 를 읽어 `list.length * per` 로 계산하고, 미설정일 때만 상수 `PRICE_PER_CHALLENGE_FALLBACK = 30000` 을 쓴다(하드코딩 `*30000` 이 아니다).
  - **⚠️ Edge Function 배포는 CLI가 아니라 Supabase 콘솔에서 한다** — 오너 PC에 `supabase` CLI가 없다(2026-07-24 확인). **`supabase functions deploy …` 명령을 안내하지 말 것.** 경로는 `Supabase 대시보드 > Edge Functions > <함수명> > 코드 전체 교체 > Deploy`(Verify JWT 설정은 기존값 유지). cancel-payment·verify-payment 모두 이 방식으로 배포됐다.
  - **배포된 버전 확인법**(결제 생성·DB 쓰기 없는 안전한 프로브): `POST /functions/v1/verify-payment` 에 `{paymentId:'probe', lectureId:'00000000-0000-0000-0000-000000000000', applicant:{name:'x',phone:'0'}}` 를 anon key 로 던져 본다. **`login_required`=현행(로그인 필수) 버전** — `lectureId` 분기가 특강 조회보다 **JWT 확인을 먼저** 하므로 anon 프로브는 여기서 멈춘다(2026-08-05 변경). `lecture_not_found`=로그인 필수 이전 버전, `bad_request`=특강 이전 구버전, 404=미배포. ⚠️ 프로브는 `paymentId:'probe'` 라 포트원 조회가 실패해 **환불 없이 거절만 된다**(결제 생성·DB 쓰기 없음).
- **⚠️ 잔여석 자동 카운팅(2026-07-24 신설 · migration `20260724150000_lecture_seat_counting.sql`, owner 실행 필요):** **`capacity`(정원)가 기준값, `seats_left`(잔여석)는 파생 캐시**다. `applications` 트리거가 신청이 들어올 때마다 `잔여석 = 정원 − 신청건수`로 **재계산**한다(차감 −1이 아님 — 값이 어긋나도 진실로 복구되고, admin이 신청을 지우면 자리가 자동으로 돌아온다). **정원이 NULL인 특강은 트리거가 손대지 않는다**(구 수동 운영 유지).
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
  - **`verify-payment`**: `slotId`를 받아 **그 특강 소속인지 서버가 재확인**(다른 특강의 시간대를 밀어넣어 남의 자리를 잡는 걸 막는다). 신청자 현황 표시용으로 `challenges[].slot`도 서버가 채운다. ⚠️ **`member_id` 는 body 가 아니라 JWT(caller)로 정한다**(2026-08-05) — 특강은 로그인 필수라 항상 caller 명의로 적고, 챌린지는 body 값이 caller 와 일치할 때만 적는다(남의 계정에 신청을 거는 위장 차단). 비로그인 특강 결제는 전액 환불 후 `login_required`.
  - **슬롯을 전부 지우면** 롤업이 `v_cnt=0`이라 손대지 않아 마지막 합계 정원이 남는다(입력칸은 다시 열리므로 관리자가 수정하면 된다).
  - 미적용 시 degrade: 조회가 실패해 편집기·선택 UI가 안 뜨고 종전 '일정 하나짜리 특강'으로 동작.
- **⚠️ 법적 필수**: 상세 신청 폼의 `#appConsent`(만14세+개인정보 수집·이용) 미체크 시 `readApplicant()`가 차단 — 삭제·완화 금지(apply.html과 동일 규정).
- **입구(2026-07-29 갱신)**: nav '특강'(**`nav.js` 한 곳** — 데스크톱·모바일 메뉴가 같은 배열에서 그려진다, 챌린지 드롭다운 바로 뒤) + 홈 '특강 문'(.doors — 공개 특강 있을 때만 노출, 위 '랜딩 섹션 순서' 참조). 구 홈 `#lectures-home` 카드 섹션은 2026-07-29 삭제(index는 이제 lectures.css·lecture-common.js를 로드하지 않는다).
- **admin '특강' 탭**: `special_lectures` CRUD('챌린지' 탭과 같은 `.round-form`/`.round-list` 패턴). 항공사 select + 정원 입력(잔여석은 자동 표시 — 위 '잔여석 자동 카운팅' 참조). `loadLectures()`가 초기화 시퀀스에 포함.
- **⚠️ 카드 디자인 = `lectures.css` 단일 소스 + `LEC.cardHtml()` 단일 빌더(2026-07-24 스펙):** 특강 카드는 lectures.html·상세 eyebrow **공용**(구 홈 `#lectures-home`은 2026-07-29 삭제)이라, 스타일은 `lectures.css`, 마크업은 `lecture-common.js`의 `LEC.cardHtml`/`skeletonHtml` 한 곳에서만 관리한다(제각각 방지 — 페이지별 인라인으로 만들지 말 것). 두 파일 모두 `<link lectures.css>` + `lecture-common.js` 로드.
  - **핵심 규칙(오너 스펙 — 어기면 "가족처럼 안 보인다"):** ① **사진 없는 카드의 커버 배경(`--lx-cover #DDE5EF` — 2026-08-05 쿨 화이트 전환, 구 `#E4DDC9`)은 전부 동일** — 항공사별로 바꾸지 말 것. ② 항공사별로 바뀌는 건 **영문 사명 색**과 **커버 하단 1px 룰 색** 둘뿐(둘 다 `--lx-accent`). ③ **한글 제목은 항상 네이비**(`--lx-navy #1B2E4E`, 500). ④ 굵기는 **400·500만**. ⑤ **그림자·글로우·리프트 금지** — hover는 테두리만 진하게(사진 페이드용 그라디언트는 아래 예외). ⑥ 항공사 로고 이미지 금지(영문명 텍스트 조판). ⑦ 커버 패턴·텍스처 금지.
  - **⚠️ 사진 커버(2026-07-24 오너가 목업 4종 중 ③ 선택 — `outputs/lecture-card-image-mockup.html`):** `thumb_url`이 있으면 카드에 `.has-shot`이 붙어 커버가 **사진 + 아래로 갈수록 정보부 색(#F8FAFD, 구 아이보리 #FBF9F4)에 녹아드는 그라디언트**가 된다. 사진이 없으면 위 ①의 커버 그대로(폴백) — 사진을 준비 못 한 특강도 카드가 안 깨진다. 통일감은 '커버가 전부 같은 색'이 아니라 **'모든 사진에 같은 페이드 처리'**로 지킨다(자르는 위치도 `center 34%`로 통일).
    - **⚠️ 페이드는 커버 높이의 %가 아니라 `.lx-txt` 블록에 px로 건다.** %로 걸면 제목 줄 수에 따라 글자가 앉는 높이가 달라져(2줄 45%·3줄 35%) 어떤 카드는 반투명 구간에 글자가 얹힌다 — 실제로 항공사 영문명이 이 때문에 흐렸던 자리. 글자 블록 기준이면 줄 수와 무관하게 **위 46px에서 페이드가 끝나고 글자는 늘 불투명 위에** 앉는다.
    - **⚠️ `.lx-ko`는 2줄 클램프 + 커버 `padding-top:88px`(모바일 96px) 한 쌍.** 클램프가 없으면 3줄 제목이 글자 블록을 220px까지 키워 **사진이 32px만 남는다**(사진을 넣은 의미가 사라짐). padding-top은 '사진이 최소 이만큼은 보인다'는 약속이라 `min-height`만으로 대체 불가 — 긴 제목에서 글자가 커버를 다 차지한다. 전체 제목은 상세페이지에 나오므로 카드에서 잘려도 된다.
    - **⚠️ `.lx-cover > *`로 뭉뚱그려 `position:relative`를 주지 말 것** — 배지가 `absolute`인데 덮여서 자리가 어긋난다. `.lx-txt`에만 준다. 배지는 사진 위에 뜨므로 `.has-shot`에서 **불투명 알약 + 실선 테두리**(흰 배경 사진 위에서 흰 알약이 사라지는 걸 막는다).
    - **⚠️ backdrop-filter 유리 패널 방식은 검토 후 폐기** — 블러가 뒤 사진을 완전히 뭉개 목업 ④안(사진/글자 분리)과 똑같아 보였고, 구형 아이폰 지원이 불안정한 데다 카드 수만큼 블러 레이어가 생긴다. 재도입 금지.
    - `LEC.shotUrl()`이 주소를 검사한다: 스킴이 붙어 있으면 http(s)·`data:image`만 통과(`javascript:` 차단), 스킴이 없으면 `images/foo.webp` 같은 사이트 안 경로로 보고 허용. CSS `url("…")`에 넣을 수 있게 역슬래시·따옴표를 이스케이프한 뒤 호출부에서 `esc()`로 한 번 더 감싼다.
  - **사진 첨부 = Storage `lecture-images` public 버킷**(migration `20260724140000_lecture_images_bucket.sql`, **owner 실행 완료 2026-07-24 — 다시 실행 안내 금지**). admin '특강' 탭에서 파일을 고르면 **후기와 같은 압축 루틴(`optimizeReviewImage`)**을 거쳐 업로드되고, `thumb_url`엔 **공개 URL 전체**가 들어간다(경로가 아니라 — 그래야 외부 주소 붙여넣기도 계속 동작). 버킷 미생성 시 업로드가 실패하며 폼이 마이그레이션 파일명을 안내한다. ⚠️ 원본을 그대로 올리면 목록 한 번에 20MB가 넘어 데이터 환경에서 카드가 한참 뒤에 뜬다 — 압축을 우회하지 말 것.
  - **⚠️ 사진 크기 기준(2026-07-24 실측):** 카드 커버 표시폭은 **모바일 1열이 가장 크다(597×264)** — 3열 331×273, 2열 291×273. 상세 `.lc-cover`는 **680×340**(container 720−padding 40, `max-height:340` + `object-fit:cover`). 고해상도 화면 2배를 감안해 `optimizeReviewImage(file, **1280**)`로 특강만 상한을 올렸다(후기는 세로 스크린샷이라 기본 1080 유지 — 인자 없이 호출). **1080으로 되돌리지 말 것**: 상세 680×2=1360에 한참 못 미쳐 큰 화면에서 뭉개진다. 더 올리면(1440+) 목록 6장에 900KB를 넘어 데이터 환경에서 손해가 이득보다 크다.
  - **⚠️ 카드에서 선명하게 보이는 건 사진 위쪽뿐**(`background-position: center 34%` + 아래는 아이보리 페이드에 덮임): 실측상 원본 세로의 **약 7~43% 구간**만 노출된다. 상세는 위아래 5%씩만 잘려 거의 전체가 보인다.
  - **권장 원본 = 1600×900(16:9).** 세 자리의 표시 비율이 제각각(상세 2:1 · 폰카드 2.26:1 · 컴3열 1.21:1)이라 어떤 비율을 줘도 어딘가는 잘린다 — cover 규칙으로 계산한 **잘림률이 16:9에서 가장 낮다**(평균 21% / 3:2 26% / 4:3 28%). 세로 잘림은 `center 34%`라 위쪽이 남고 가로 잘림은 `center`라 좌우 균등 → 운영 안내는 **"인물을 가로 가운데·세로 위쪽에"**. 이 문구는 admin 폼의 `.lf-thumb-spec`에 고정 노출된다(업로드 상태 메시지 `.lf-thumb-msg`와 별개 — 상태가 바뀌어도 안 사라진다).
  - **항공사 액센트 = `lectures.css`의 `--air-<code>` 변수**(ke/lj/7c/tw/ze/yp/rf). 카드는 `style="--lx-accent:var(--air-<code>)"`로 주입, 영문명은 `LEC.AIRLINES[code].en`. 값은 스펙 시작값을 **아이보리 커버 위 4.5:1 이상**으로 미세조정(7C·LJ·RF 소폭 하향) — 공식 CI로 추후 조정 가능. 항공사 미지정(null) = 영문명 없이 기본 네이비.
  - **⚠️ 가격 = 정보부 맨 아래 `.lx-price` 한 줄(2026-07-24 오너가 목업 3안 중 A안 선택 — `outputs/lecture-card-price-mockup.html`):** `참가비` 라벨(14px) + 금액(20px 네이비 500), 위에 1px 구분선. 커머스 카드 표준 위치(무신사·29CM·클래스101)라 "정보를 읽고 가격에서 끝맺는" 흐름이 된다. **⚠️ 구 커버 우상단 `.lx-badge` 알약은 폐기 — 되살리지 말 것**(시선은 큰 제목부터 가는데 가격은 반대쪽 구석 11px 회색이라 끝까지 눈에 안 걸렸다). **무료도 이 줄 하나로만 말한다**(`무료` 초록 #2E6E42) — 배지를 남기면 무료가 위아래로 두 번 나온다(오너 지적).
  - **⚠️ 정보부 활자 하한 14px + 대비 4.5:1(2026-07-24 오너 "9대 원칙 위배"):** 구 메타 13px·참가비 라벨 12.5px·배지 11px 이 원칙 1번(최소 12pt) 미달이었다. 메타·라벨은 **14px**(사이트 `--fs-caption`), 커버 영문 사명만 12→**13px**(라틴 대문자 브랜드 마크). 메타 보조색 `--lx-metac` 도 구 `#7A756C` 가 아이보리(#FBF9F4) 위 **4.35:1 로 원칙 4번 미달**이라 낮췄다 — 더 밝게 되돌리지 말 것. 2026-08-05 쿨 화이트 전환으로 `#736E64` → **`#666E7B`**(새 정보부 `#F8FAFD` 위 4.9:1).
  - **잔여석**: `<=5` 텍스트만 액센트 강조, `0`이면 '정원 마감'+카드 `opacity:.55`+상세 신청 차단(품절=마감 취급). 값은 신청마다 DB 트리거가 자동 계산(위 '잔여석 자동 카운팅'). **반응형** 3열(≥1024)/2열/1열(<640, 제목 24px).
  - 상세페이지(lecture.html)도 같은 계열: 항공사 영문명 eyebrow(`--lx-accent`) + **네이비 제목**(구 코랄에서 전환) + 잔여석 fact. hero는 `root.style.setProperty('--lx-accent', …)`로 페이지 전역 지정.
  - ⚠️ 목록·홈 조회는 **`select('*')`** — airline·seats_left 마이그레이션(`20260724130000`) 미적용 환경에서 컬럼 지정 시 조회 전체가 400나므로. 미적용 시 브랜딩만 빠지고 카드는 뜬다.
  - 스켈레톤 커버는 **190px** — 사진 커버(252px)와 기본 커버(약 130px)의 중간값이라 로딩이 끝날 때 카드가 덜 튄다.
