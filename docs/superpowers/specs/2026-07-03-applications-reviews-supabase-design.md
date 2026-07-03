# 신청·후기·모집일정 Supabase 이전 & 관리자 통합 — 설계

- 날짜: 2026-07-03
- 브랜치: `feature/supabase-applications-reviews`
- 상태: 설계 확정, 구현 플랜 대기

## 목적

신청(application)·후기(review)·모집일정(recruit)을 Google Apps Script/시트에서 **Supabase 네이티브로 이전**하고, 관리자 페이지를 하나로 통합한다. 결과적으로 백엔드가 Supabase 하나로 통일되고, **모집일정(기수) → 신청 → 회원 → 결과**가 한 DB에서 자동 연결된다. 후기는 **카카오톡 스크린샷 이미지** 방식으로 신뢰도를 높인다.

## 배경 (현재)

- **신청**: 모달 → `APPLICATION_API_URL`(Apps Script) POST → 시트. 모달은 **두 곳** 중복 구현(`index.html` 인라인 + `application-modal.js`).
- **후기**: `APPLICATION_API_URL` GET `?action=reviews` → 시트 → index 텍스트 마퀴, `localStorage(monc_reviews_v1)` 캐시.
- **모집일정**: `RECRUIT_CSV`(published 시트 CSV) → `recruit.js` 가 챌린지별(voice/expression/spinning/answer) 모집 시작·마감·D-day·상태 렌더. per-card `data-recruit-start/-end` 폴백.
- **회원/결과**: Supabase(members, daily_records, recordings, cohorts). `admin.html`(회원 관리).
- **신청자현황**: `admin-applicants.html`(비밀번호 게이트 + Apps Script). 은퇴 예정.

## 결정 사항 (확정)

- 신청은 **누구나(비로그인)** 유지 → Supabase 익명 INSERT.
- 기존 시트 신청 데이터는 **이전 안 함**(시트는 기록보관용). 오늘부터 신규만 Supabase.
- **기수는 챌린지별 독립**(보이스 3기·스피닝 5기 각각).
- **모집일정을 Supabase로 이전**해 관리자에서 관리(RECRUIT_CSV 폐기).
- **신청↔회원 자동 연결**(전화번호 매칭 트리거) 포함.
- **마이페이지 "내 신청 내역"** 포함.
- 후기 = **관리자가 카톡 스크린샷 이미지 업로드** → 공개 표시.
- 완료 시 **Apps Script(APPLICATION_API_URL) + RECRUIT_CSV 완전 은퇴**.

## 최우선 제약: 모바일 퍼스트 (99% 모바일)

모든 화면 375px 우선 검증. 터치 영역 ≥44px.

## ⚠️ 개인정보 주의

카톡 스크린샷엔 상대방 이름·프로필 사진 포함. 업로드 전 **당사자 동의**, 필요 시 가림. (운영 정책)

---

## 데이터 모델 (Supabase)

### `challenge_rounds` — 챌린지별 기수·모집일정 (신규)
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | |
| `challenge` | text | `voice`/`expression`/`spinning`/`answer` (data-recruit-id와 일치) |
| `round` | int | 기수(보이스 3기 → 3) |
| `recruit_start` | date | 모집 시작 |
| `recruit_end` | date | 모집 마감 |
| `program_start` | date null | 프로그램 시작(선택) |
| `created_at` | timestamptz | |
| — | | `unique(challenge, round)` |

- 상태(모집중/예정/마감)는 **날짜로 클라이언트에서 계산**(현 recruit.js 로직 유지).
- 챌린지의 **"현재 기수"** = 오늘 기준 `recruit_end >= today` 중 가장 이른 것, 없으면 가장 최근 것.
- RLS: SELECT 공개(anon+authenticated) / INSERT·UPDATE·DELETE 관리자.

### `applications` — 신청 (신규)
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | |
| `created_at` | timestamptz | **= 신청일자** |
| `name` | text | |
| `phone` | text | 입력값 그대로 |
| `refund_account` | text | 보증금 환급 계좌 |
| `challenges` | jsonb | `[{challenge, round, price}]` — 신청 시점 기수를 **스냅샷** |
| `total_price` | int | |
| `paid` | boolean | 입금, 기본 false (관리자 토글) |
| `refunded` | boolean | 환급, 기본 false (관리자 토글) |
| `member_id` | uuid null | `members(id)` — 트리거로 자동 연결 |
| `memo` | text null | 관리자 메모 |

- RLS: INSERT anon+authenticated(`with check (true)`) / SELECT·UPDATE·DELETE 관리자 / **회원 본인 SELECT**(`member_id = auth.uid()`) — 마이페이지용.

### 자동 연결 (트리거/함수)
- `normalize_phone(text)` = 숫자만 추출.
- **applications INSERT 시**: 같은 정규화 전화번호의 member 있으면 `member_id` 세팅.
- **members 의 phone 세팅/변경 시**: 매칭되는 applications 의 `member_id` 백필.

### `reviews` — 후기 이미지 (신규)
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | |
| `created_at` | timestamptz | |
| `image_path` | text | Storage 경로 |
| `sort_order` | int | 표시 순서, 기본 0 |
| `visible` | boolean | 노출, 기본 true |
| `caption` | text null | 선택 설명 |

- Storage 버킷 `reviews`: **공개 read**, 관리자 write.
- RLS: SELECT `visible=true` 공개 / 그 외 관리자.

---

## 프론트엔드 변경

### 신청 모달 (2곳 동일 수정)
- `index.html` 인라인 + `application-modal.js` 의 `submitApplication()` 을 **Supabase insert** 로 교체.
- 제출 전 선택 챌린지별 **현재 기수**를 `challenge_rounds`(또는 recruit.js가 노출한 값)에서 읽어 `challenges: [{challenge, round, price}]` 구성.
- insert: `{ name, phone, refund_account, challenges, total_price }`. 기존 검증·`_isSubmitting` 잠금·성공 UX 유지.
- 상세페이지 4개(`challenge-voice/expression/spinning/answer.html`)에 `supabase-js` + `supabase-config.js` 로드 추가. 레거시 `challenge-express/speech.html` 제외.

### recruit.js — Supabase 소스로 전환
- `RECRUIT_CSV` fetch → `challenge_rounds` 조회로 교체. `applyIndexRecruit`/`applyDetailRecruit`/`loadChallengeStatuses` 는 인터페이스 유지하되 데이터 소스만 Supabase.
- 모달이 쓸 수 있게 챌린지별 현재 기수/상태를 `window._challengeStatuses` 에 계속 노출(기수 포함).

### index 후기 렌더 교체
- `loadReviews()` → Supabase `reviews`(visible, sort_order) + 이미지 public URL → **이미지 갤러리/마퀴**. 텍스트 마퀴 마크업·`localStorage` 캐시 제거. 이미지 lazy-load.

### 마이페이지 "내 신청 내역"
- 로그인 회원의 `applications`(member_id=본인, 자동 연결) 조회 → 챌린지·기수·신청일자·입금/환급 상태 카드. 비어있으면 안내 문구.

### 관리자 `admin.html` — 탭 통합
진입 게이트: `MONC.requireAdmin()` 하나. 탭 4개:
- **회원 관리**: 현행 유지.
- **모집일정**: `challenge_rounds` CRUD(챌린지별 기수 추가/수정, 날짜 입력).
- **신청자 현황**: `applications` 조회 — **신청일자·기수 표시**, 이름·전화·챌린지 검색, `paid`/`refunded` 토글, CSV, 회원 연결 상태.
- **후기 관리**: 카톡 이미지 업로드(→Storage+insert), 순서·노출·삭제.

### 은퇴 정리
- `APPLICATION_API_URL`(index+application-modal.js), `RECRUIT_CSV`(recruit.js), `admin-applicants.html`, `admin-apps-script.gs` 제거.

---

## 구현 순서 (각 Phase 독립 배포 · 플랜은 Phase별로 분리 작성)

의존성상 **모집일정/기수가 먼저**(신청이 기수를 참조하므로).

- **Phase 1 — 모집일정/기수**: `challenge_rounds`(콘솔) → admin "모집일정" 탭 → recruit.js Supabase 전환. (RECRUIT_CSV 폴백은 전환 검증까지 임시 유지.)
- **Phase 2 — 신청 → Supabase**: `applications`+RLS+자동연결 트리거(콘솔) → 모달 2곳+상세페이지 → admin "신청자 현황" 탭.
- **Phase 3 — 마이페이지 내 신청 내역**.
- **Phase 4 — 후기 → 이미지**: 버킷·테이블·RLS(콘솔) → admin "후기 관리" 탭 → index 렌더 교체.
- **Phase 5 — 은퇴/정리**: APPLICATION_API_URL·RECRUIT_CSV·admin-applicants.html·admin-apps-script.gs 제거.

## 검증

정적 사이트(테스트 없음) → 브라우저 렌더링, 375px 우선.
- 모집일정: admin에서 기수 추가 → index/상세 배지·D-day·모달 체크박스 반영.
- 신청: 비로그인 제출 → `applications` 행 생성(기수 스냅샷 포함) → 관리자 탭 표시. 회원 전화 일치 시 자동 연결.
- 마이페이지: 로그인 회원이 자기 신청 내역 확인.
- 후기: 관리자 업로드 → 공개 index 이미지 표시.
- 콘솔 에러·가로 오버플로우 없음.

## 범위 밖 (YAGNI)

- 기존 시트 신청 데이터 마이그레이션(안 함).
- 신청 결제 연동(입금은 관리자 수동 토글 유지).
- 후기 텍스트 병행(이미지로 대체).
