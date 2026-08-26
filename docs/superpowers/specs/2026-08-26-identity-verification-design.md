# 휴대폰 본인인증(KG이니시스 통합인증 · 포트원 경유) 설계 — 2026-08-26

오너 승인: 2026-08-26 대화("진행해봐" · 경로=포트원 경유 · 중복가입 차단 브랜치와 같이 내보내기).
배경: 2026-08-20 전화번호 필수 + 중복 차단(`save_my_profile`)을 만들 때 "가라 번호는 못 잡는다 —
본인인증은 후속, RPC 앞단에 끼우는 구조"로 남겨 둔 그 후속. KG이니시스 통합인증 계약이 끝나
상점관리자 KEY(MID·API KEY·SEED IV)를 오너가 확보했고, 포트원 콘솔에 본인인증 채널을 등록했다.

## 결정 요약

| 항목 | 결정 |
|---|---|
| 경로 | **포트원 V2 경유**(`PortOne.requestIdentityVerification`) — 결제와 같은 인프라(상점 ID·API 시크릿·Edge Function 패턴) 재사용. 이니시스 직접 연동(SEED 암호화·결과수신 서버 자작)은 기각 |
| 적용 범위 | **신규 가입 온보딩만.** 기존 회원 재인증 요구 없음. 마이페이지 번호 변경 인증은 후속 |
| 판정 주체 | 서버. 브라우저는 `identityVerificationId` 만 보낸다 — 이름·번호·CI 를 브라우저가 보내면 안 믿는다(결제 검증과 같은 원칙) |
| 중복 판정 | **CI 우선**(같은 사람이면 번호를 바꿔도 잡힌다) + 기존 전화번호 대조 유지 |
| 폴백 | 채널 키 없음·함수 미배포·SDK 로드 실패·마이그레이션 미적용 → **기존 직접 입력 폼으로 조용히 degrade**(사이트가 멈추지 않는다) |
| 배포 단위 | `claude/prevent-duplicate-signup-150111`(전화번호 필수) 병합 + 본 작업, 한 브랜치로 검증 후 main |

## 채널·키

- 이니시스 상점관리자 KEY(MID·API KEY·SEED IV)는 **포트원 콘솔에만** 들어간다 — 레포 반입 금지(비밀값).
- 포트원 본인인증 채널 키(공개 가능 값)는 **`pay-methods.js` 한 곳**: `moncPay.identityChannel`.
  `channel-key-d4c6e771-0eb6-424d-971b-200a655c2d2b` (2026-08-26 오너 전달).
  빈 문자열이면 온보딩이 인증 UI 를 켜지 않는다(카카오페이 키와 같은 끄는 스위치 겸용).
- 이니시스 상점관리자 도메인 등록: `monc.ai.kr` (등록된 도메인에서만 인증창이 뜬다 — 미등록이면
  인증창 오류 → 화면은 폴백 안내).

## 흐름

1. 온보딩 진입 → `verify-identity` 프로브(anon·비로그인 가능)로 배포 확인. 채널 키·프로브 둘 다
   있으면 **인증 모드**: 이름·전화 입력칸 대신 [휴대폰 본인인증] 버튼. 아니면 기존 폼(폴백 모드).
2. 버튼 → `PortOne.requestIdentityVerification({ storeId, channelKey, identityVerificationId,
   redirectUrl })`. PC 는 팝업/iframe promise 복귀, 모바일은 페이지 리다이렉트 복귀
   (`?identityVerificationId=` 쿼리 — 온보딩이 로드 시 감지해 3번으로 간다).
3. 브라우저 → `verify-identity` Edge Function(POST, JWT): body 는 `identityVerificationId` 하나.
4. 서버: 포트원 API `GET /identity-verifications/{id}` (PORTONE_API_SECRET) → `status==='VERIFIED'`
   확인 → `verifiedCustomer`(name·phoneNumber·birthDate·ci·di) 추출 → RPC
   `apply_identity_verification`(service_role 전용) 호출.
5. RPC: advisory lock(ci·번호) → ① 같은 `identityVerificationId` 재사용(다른 계정) 차단
   ② CI 또는 전화번호가 다른 회원과 겹치면 → `dup_phone`(기존 save_my_profile 과 같은 모양 —
   화면이 한 경로를 재사용한다) + 기존 계정 provider·me_fresh
   ③ 통과 시 `members` 에 실명·표준형 번호·생년월일·CI·DI·`verified_at` 저장 + 감사 행 기록.
6. 화면: 성공 → 확인된 이름·번호를 읽기 전용 표시, 전공만 입력받아 `saveMyProfile({major})` 후 이동.
   `dup_ci`/`dup_phone` → 기존 `#dupView` 선택 강제 화면 재사용(기존 계정으로 로그인 / 다시 시도).

## 데이터

migration `20260826150000_identity_verification.sql`:

- `members` 컬럼 추가: `ci text`·`di text`·`birth_date date`·`verified_at timestamptz` + `ci` 인덱스
  (유니크 아님 — phone_dedup 과 같은 이유: 판정은 RPC 한 곳, 경합은 advisory lock).
  ⚠️ **공용 `getMyProfile()` 셀렉트에 넣지 않는다**(미적용 환경 400 방지 — major 전례).
  화면 판정은 별도 방어 조회(`select('verified_at')` try/catch).
- `identity_verifications` 감사 표(RLS ON·정책 없음 — service_role 만): member_id ·
  verification_id(unique — 재사용 차단 겸) · 이름·번호·생일·CI·DI · created_at.
- `apply_identity_verification(...)` — security definer, **grant 는 service_role 만**
  (`refund_credit_for` 패턴 — authenticated 에 열면 화면이 인증 없이 아무 값이나 넣는다).
- `save_my_profile` 재정의(create or replace): **verified 회원은 name·phone 입력을 무시하고
  major 만 갱신**(`phone_locked:true` 로 알림). 인증으로 확정된 실명·번호를 화면 저장이 덮으면 안 된다.
- 미적용 degrade: verify-identity 가 RPC 부재(PGRST202)를 감지해 `not_ready` → 화면은 폴백 폼.

## Edge Function `verify-identity`

- 한 파일. `FN_VERSION` + `probe:true` 분기를 **인증 검사보다 앞에**(배포 확인은 로그인 없이).
- 지급 대상(누구의 프로필에 저장할지)은 body 가 아니라 **JWT**.
- 알려진 실패는 전부 **HTTP 200 + code**(non-2xx 면 supabase-js 가 본문을 감춘다):
  `not_verified`(미완료·실패) · `dup_phone`(CI·번호 중복 공용) · `verification_used` ·
  `not_ready` · `bad_phone`(휴대전화 형식 아님). 401 은 미로그인뿐.
- 콘솔 배포(오너) + anon 프로브로 확인. JWT 검증은 켠 채 둔다(portone-webhook 만 예외 규칙).

## 화면 규칙(기존 규칙 승계)

- 온보딩은 입력값 있는 화면 — 통째 reload 금지, 인증 나갔다 bfcache 복귀 시 **버튼만 복원**.
- 인증창으로 나가는 새 버튼이므로 복귀 복원 처리를 같이 단다(apply `_payRestore` 원칙).
- 폴백 모드는 기존 폼 그대로(전화번호 필수·중복 차단 동작 불변).
- mypage 연락처: verified 회원은 입력칸 잠금 + "본인인증으로 확인된 번호예요" 문구
  (서버 가드가 이미 막지만, 되는 것처럼 보이는 입력칸을 두면 안 된다).
- 375px 실측 필수. 실제 인증창 완주는 배포 후 오너 폰 실측(테스트 채널 없음).

## 하지 않는 것(이번 범위 밖)

- 기존 회원 소급 재인증 · 마이페이지 번호 변경 인증 · admin 인증 여부 칸 · 신청/특강 폼(비회원)
  인증 · 웹훅(돈이 아니라서 유실 시 재인증으로 충분).
