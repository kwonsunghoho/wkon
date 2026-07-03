# 신청·후기 Supabase 이전 & 관리자 통합 — 설계

- 날짜: 2026-07-03
- 브랜치: `feature/full-redesign` (main에 병합·배포됨 → 이후 작업은 새 브랜치 권장)
- 상태: 설계 확정, 구현 플랜 대기

## 목적

신청(application)과 후기(review)를 Google Apps Script/시트에서 **Supabase 네이티브로 이전**하고, 관리자 페이지를 하나로 통합한다. 결과적으로 백엔드가 Supabase 하나로 통일되고, 신청→회원→결과가 한 DB에서 연결된다. 후기는 **카카오톡 스크린샷 이미지** 방식으로 바꿔 신뢰도를 높인다.

## 배경 (현재 구조)

- **신청**: 신청 모달 → `APPLICATION_API_URL`(Apps Script) POST → 구글 시트(학생현황). 모달은 **두 곳**에 중복 구현(`index.html` 인라인 + `application-modal.js`).
- **후기**: `APPLICATION_API_URL` GET `?action=reviews` → 구글 시트(후기) → index에서 텍스트 마퀴로 렌더, `localStorage(monc_reviews_v1)` 캐시.
- **모집일정**: `RECRUIT_CSV`(별도 published 시트 CSV, `recruit.js`) — **이번 범위 아님, 그대로 유지.**
- **회원/결과**: Supabase(members, daily_records, recordings, cohorts). 로그인/마이페이지/관리자(`admin.html`).
- **신청자현황**: `admin-applicants.html`(비밀번호 게이트 + Apps Script로 시트 읽기) — 이번에 은퇴.

## 결정 사항 (확정)

- 신청은 **누구나(비로그인 가능)** 유지 — Supabase 익명 INSERT로 구현.
- 기존 구글 시트 신청 데이터는 **이전하지 않음** — 시트는 기록보관용으로만 남김. 오늘부터 신규 신청만 Supabase.
- 후기는 **관리자가 카카오톡 스크린샷 이미지 업로드** → 공개 표시. 기존 텍스트 후기 방식 대체.
- 완료 시 **Apps Script(APPLICATION_API_URL) 완전 은퇴** (모집 CSV만 별도로 남음).

## 최우선 제약: 모바일 퍼스트

99% 모바일 유입. 신청 모달·후기 갤러리·관리자 탭 모두 375px에서 먼저 검증. 터치 영역 ≥44px.

## ⚠️ 개인정보 주의

카카오톡 스크린샷에는 상대방 이름·프로필 사진이 포함된다. 업로드 전 **당사자 동의**를 받고, 필요 시 이름/얼굴을 가린다. (운영 정책 — 코드로 강제하지 않음.)

---

## 아키텍처

### Feature 1 — 신청을 Supabase로

**테이블 `applications`**

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `created_at` | timestamptz | `now()` |
| `name` | text | 신청자 이름 |
| `phone` | text | 전화번호(입력값 그대로) |
| `refund_account` | text | 보증금 환급 계좌 |
| `challenges` | jsonb | `[{name, price}]` (모달이 만드는 배열 그대로) |
| `total_price` | int | 총액 |
| `paid` | boolean | 입금 여부, 기본 false (관리자 토글) |
| `refunded` | boolean | 환급 여부, 기본 false (관리자 토글) |
| `member_id` | uuid null | `members(id)` 참조. 전화번호 매칭 시 연결(당장은 nullable, 자동연결은 YAGNI) |
| `memo` | text null | 관리자 메모 |

**RLS**
- INSERT: `anon` + `authenticated` 허용 (`with check (true)`) — 누구나 신청.
- SELECT / UPDATE / DELETE: 관리자만 (`is_admin()`).

**프론트 — 신청 모달 2곳 수정 (반드시 동일하게)**
- `index.html` 인라인 `submitApplication()` 과 `application-modal.js` `submitApplication()` 을 **Apps Script POST → Supabase insert** 로 교체.
  - insert 데이터: `{ name, phone, refund_account: account, challenges, total_price: totalPrice }`.
  - 성공 시 기존과 동일한 UX(알림, 폼 초기화, 모달 닫기).
  - 기존 검증(이름·전화·계좌·챌린지 필수)과 전송 중 버튼 잠금(`_isSubmitting`) 유지.
- 상세페이지 4개(`challenge-voice/expression/spinning/answer.html`)에 `supabase-js` CDN + `supabase-config.js` 로드 추가 (모달이 `MONC.sb` 사용). index는 이미 로드됨.
- 신청 POST 경로만 제거(Supabase insert로 교체). **`APPLICATION_API_URL` 상수는 아직 남긴다** — 후기 GET이 Phase B까지 이 상수를 계속 쓰기 때문. 상수 최종 제거는 Phase C.
- 레거시 `challenge-express.html`/`challenge-speech.html` 은 미사용 → 손대지 않음.

### Feature 2 — 후기를 Supabase 이미지로

**Storage 버킷 `reviews`** — 공개 읽기(public). 관리자만 쓰기.

**테이블 `reviews`**

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | |
| `created_at` | timestamptz | `now()` |
| `image_path` | text | Storage 경로 |
| `sort_order` | int | 표시 순서(작을수록 먼저), 기본 0 |
| `visible` | boolean | 노출 여부, 기본 true |
| `caption` | text null | 선택 설명 |

**RLS**
- SELECT: 공개 (`visible = true` 인 행을 `anon`+`authenticated` 가 읽음).
- INSERT / UPDATE / DELETE: 관리자만.
- Storage `reviews` 버킷: 공개 read, 관리자 write.

**프론트 — index 후기 섹션 렌더 교체**
- `loadReviews()` 를 Supabase 조회로 교체: `reviews`(visible, sort_order 순) + 각 이미지의 public URL → **이미지 갤러리/마퀴**로 렌더.
- 기존 텍스트 마퀴 마크업/스타일과 `localStorage(monc_reviews_v1)` 캐시 로직 제거.
- 이미지 lazy-load, 모바일에서 가로 스크롤 마퀴 또는 세로 카드(구현 시 375px 확인).

### Feature 3 — 관리자 통합 (`admin.html`)

- 상단 탭: **[회원 관리] [신청자 현황] [후기 관리]**. 진입 게이트는 기존 `MONC.requireAdmin()`(Supabase 로그인 + role='admin') 하나.
- **회원 관리 탭**: 현재 `admin.html` 내용 그대로(회원 리스트→14일 편집→음성 업로드→기수).
- **신청자 현황 탭**: `applications` 조회(관리자 RLS). 이름·전화·챌린지 검색 / `paid`·`refunded` 토글(update) / CSV 내보내기. (신청자현황 페이지에 있던 기능 이식, 데이터만 Supabase.)
- **후기 관리 탭**: 카톡 스크린샷 이미지 업로드(→ Storage + `reviews` insert) / 순서 변경(sort_order) / 노출 토글(visible) / 삭제.
- `admin-applicants.html` 및 `admin-apps-script.gs` 은퇴(제거). 비밀번호 게이트 삭제.

### 은퇴 정리

- `APPLICATION_API_URL` (index.html + application-modal.js) 제거.
- `admin-applicants.html`, `admin-apps-script.gs` 제거.
- 남는 외부 의존: `RECRUIT_CSV`(모집일정 published 시트) — 이번 범위 밖.

---

## 구현 순서 (플랜에서 단계화)

각 단계 독립 배포 가능. **후기 렌더를 Supabase로 바꾸기 전까지 Apps Script를 유지**해 후기가 안 끊기게 한다.

- **Phase A — 신청 → Supabase**: 테이블/RLS(콘솔) → 모달 2곳 + 상세페이지 → admin "신청자 현황" 탭. (신청 저장이 Supabase로. 후기는 아직 Apps Script.)
- **Phase B — 후기 → Supabase 이미지**: 버킷/테이블/RLS(콘솔) → admin "후기 관리" 탭 → index 후기 렌더 교체.
- **Phase C — 은퇴/정리**: `APPLICATION_API_URL`·`admin-applicants.html`·`admin-apps-script.gs` 제거.

## 검증

정적 사이트(테스트 없음) → 브라우저 렌더링, **375px 모바일 우선**.

- 신청: 비로그인 상태로 모달 제출 → Supabase `applications`에 행 생성 확인(콘솔 또는 관리자 탭). index + 상세페이지 4곳 모두.
- 후기: 관리자 업로드 → 공개 index에서 이미지 표시. 로그인 없이 조회되는지.
- 관리자 탭 전환, paid/refund 토글 반영, CSV.
- 콘솔 에러 없음, 가로 오버플로우 없음.

## 범위 밖 (YAGNI)

- 기존 시트 신청 데이터 마이그레이션(안 함).
- 모집일정(RECRUIT_CSV) 이전(나중에).
- 신청↔회원 자동 연결 트리거(당장은 member_id nullable + 관리자 수동/전화번호 대조).
- 마이페이지 "내 신청 내역"(나중에).
- 후기 텍스트 병행(이미지로 대체).
