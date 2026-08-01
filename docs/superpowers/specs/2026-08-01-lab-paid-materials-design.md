# 연구실 유료 자료집 — 설계

> 2026-08-01 오너와 확정. 연구실(`lab.html` → `lab-archive.html`)에 올리는 자료를
> 자료 단위로 값을 매겨 팔고, 구매자만 열람·다운로드하게 한다.

## 오너가 정한 것(되돌리지 말 것)

1. **자료 하나하나마다 금액을 설정한다.** 항공사 묶음 상품이 아니다 — 무료 자료와 유료 자료가 같은 목록에 섞여 있고, 값은 `price` 한 칸이 정한다(0 = 무료).
2. **금액은 언제든 바꾼다.** admin 입력칸에서 수정, 재배포 불필요. 이미 구매한 사람의 결제액은 `lab_purchases.amount` 에 찍힌 값이 남는다(값을 올려도 과거 영수증이 흔들리지 않는다).
3. **웹 열람 + PDF 다운로드 둘 다** 준다.
4. **현금 단건 결제**(포트원 V2 + verify-payment). 크레딧으로 열지 않는다 — 하루 무료 5크레딧이 저가 자료를 매일 공짜로 여는 구멍이 되고(첨삭 잠금과 같은 원리 · credits.md), 자료값과 AI 도구값은 서로 다른 축이라 섞으면 둘 다 흔들린다.

## 범위

**1차는 원장 5행 중 '항공사 자료실' 한 줄만** 실제 페이지로 연다. 나머지 4행(영상관·기출문제·현장 리포트·채용 캘린더)은 지금처럼 href 없는 비활성으로 둔다(lab.md).

- 현장 리포트는 회원이 쓰는 글이라 판매 대상이 아니다.
- 기출문제는 **답변 프로그램의 유료 기출(`interview_questions`)과 다른 물건**이다. 섞지 말 것 — 그쪽은 `ap_program_view()` RPC 전용이고 공개 테이블 반입 금지다.

## 1. 데이터

### 테이블을 둘로 쪼갠다 — 이게 이 설계의 핵심

Postgres RLS 는 **행 단위**다. 컬럼별로 못 막는다. 제목·가격·본문을 한 테이블에 두면 목록 조회 한 번에 유료 본문까지 딸려 나간다. 그래서 메타와 본문을 분리한다.

**`lab_materials`** — 목록·카드가 읽는 공개 메타. 비로그인 방문자도 읽는다.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid pk | 주소는 `?id=` — slug 는 만들지 않는다(쓸 데가 없다) |
| `section` | text | `'archive'`(1차는 이것만) · 이후 `'video'`·`'question'`·`'report'`·`'calendar'` |
| `airline` | text | `ke`·`lj`·`7c`·`tw`·`ze`·`yp`·`rf` · `'all'`(전 항공사 공통) · NULL(미분류) |
| `title` · `summary` | text | 목록·상세 상단 |
| `toc` | jsonb | 목차 문자열 배열 — **미구매자에게 보여줄 유일한 내용물**이다 |
| `price` | int not null default 0 | **0 = 무료**(로그인 회원 전체) |
| `cover_url` | text | `lab-covers` 공개 버킷 URL 전체(특강 `thumb_url` 과 같은 방식) |
| `page_count` · `file_size` | int | 상세에 표시(살지 말지 판단 재료) |
| `has_pdf` | bool | PDF 버튼 노출 여부 |
| `is_published` | bool default false | |
| `published_at` · `updated_at` · `created_at` | timestamptz | |

RLS: `select` 는 `anon, authenticated` 에게 `is_published = true` 만. 나머지는 `is_admin()`.

**`lab_material_bodies`** — 실제 내용물. 여기가 잠긴다.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `material_id` | uuid pk fk | 1:1 |
| `body_html` | text | 웹 열람 본문 |
| `file_path` | text | `lab-files` **비공개** 버킷 경로(URL 아님) |

RLS `select` 정책 하나로 무료·유료를 같이 처리한다.

```
to authenticated using (
  exists (select 1 from lab_materials m
          where m.id = material_id and m.is_published
            and (m.price = 0 or exists (
                  select 1 from lab_purchases p
                  where p.material_id = m.id and p.member_id = auth.uid())))
  or public.is_admin()
)
```

**`lab_purchases`** — 구매 기록.

`id` · `member_id` · `material_id` · `amount` · `payment_id` · `created_at`,
**`unique (member_id, material_id)`** · `unique (payment_id)` · index `(member_id, created_at desc)`.

RLS: 본인 행 select 만. **insert 정책 없음** — 지급은 service role(verify-payment)과 admin 뿐이다(`program_enrollments` 와 같은 원칙: 자가 INSERT 를 열면 무료 등록 경로가 생긴다).

**`lab_downloads`** — 다운로드 로그. `member_id` · `material_id` · `created_at` · `ua`. 유출 추적용이자 인기 자료 판단 재료.

### 버킷 3

| 버킷 | 공개 | 용도 |
|---|---|---|
| `lab-covers` | public | 표지 이미지(`lecture-images` 와 같은 정책) |
| `lab-files` | **private** | 원본 PDF. **읽기 정책을 만들지 않는다** — service role 만 접근 |
| `lab-files-tmp` | **private** | 워터마크 찍은 임시본. 경로 `<member_id>/<material_id>.pdf` 로 **upsert** 해 회원×자료당 한 개만 쌓인다(같은 사람이 열 번 받아도 파일은 하나). 자료를 갱신하면 admin 이 그 자료의 임시본을 지운다 — 안 지우면 옛 PDF 가 계속 나간다 |

migration 파일: `supabase/migrations/20260801120000_lab_materials.sql`.
**적용은 오너가 Supabase SQL Editor 에서** 한다 — 안내할 때 파일 경로가 아니라 ```sql 본문을 대화창에 붙인다.

## 2. 결제

`verify-payment/index.ts` 에 **`materialId` 분기 추가.** 이용권(`programId`) 분기가 그대로 본이다 — 구조가 같다(단건 · 중복 시 환불 · DB 가격 재확인 · JWT 지급).

1. `Authorization` 헤더의 **JWT 로 구매자 확정**(body 의 회원 id 를 믿지 않는다)
2. `lab_materials` 에서 `price`·`is_published` **재조회** — 브라우저가 보낸 금액 불신. `price <= 0` 이거나 미공개면 `not_for_sale`
3. 같은 `payment_id` 의 구매가 이미 있으면 `{ok:true, already:true}`(모바일 복귀 중복 호출 방어)
4. 포트원 조회 → `status !== 'PAID'` 면 402, `amount.total !== price` 면 `amount_mismatch`
5. `lab_purchases` insert. 유니크 위반(23505) = **이미 산 자료를 또 결제** → `refundAll()` **전액 자동 환불 + HTTP 200 + `error:'already_purchased', refunded`**
6. insert 가 다른 이유로 실패해도 **전액 환불 + HTTP 200**(돈만 나간 상태를 남기지 않는다)

⚠️ **실패를 non-2xx 로 돌려주지 말 것.** supabase-js 가 본문을 감춰 브라우저가 환불 사실을 안내하지 못한다.

`FN_VERSION` 을 올리고, **배포 여부는 anon key 프로브로 확인**한다(오너 PC 에 CLI 없음 — 콘솔에서 코드 교체 후 Deploy).

## 3. PDF 다운로드 — 새 함수 `lab-download`

Storage 직링크를 주면 링크 하나로 전부 새어나간다. 함수를 거친다.

1. JWT 로 회원 확정 → `lab_purchases` **또는** `price=0` 확인. 아니면 403
2. service role 로 `lab-files` 원본 다운로드
3. **pdf-lib 로 모든 페이지 하단에 워터마크 스탬프**
4. `lab-files-tmp/<member_id>/<material_id>.pdf` 에 upsert
5. **만료 60초 서명 URL** 반환. 브라우저는 그 URL 로 받는다
6. `lab_downloads` 에 기록

**워터마크 문구는 ASCII 만 쓴다** — pdf-lib 기본 폰트(Helvetica)는 한글을 못 그린다. 한글 TTF 를 임베드하면 함수가 무거워지므로 이름 대신 이메일을 쓴다.

```
MONC LAB · student@example.com · 2026-08-01 · 7F2A9C31
```

이메일이면 단톡방에 퍼진 파일만 봐도 출처가 나온다. 마지막은 `lab_purchases.id` 앞 8자.

⚠️ **함수가 PDF 본문을 응답에 싣지 않는다**(응답 크기 제한). 반환은 서명 URL 문자열뿐이다.
⚠️ 원본이 20MB 를 넘으면 스탬프를 건너뛰고 서명 URL 만 준다(로그에 남긴다). admin 업로드 화면에 크기 안내를 띄운다.

## 4. 화면

### `lab-materials.html` — 항공사 자료실 목록

- `lab-archive.html` 01행에 href 를 단다(`.lg-row:focus-visible` 가 그때 살아난다). nav `LAB_SUB` 에 한 줄 추가.
- 항공사 픽커(7곳 + 전체) + 카드 목록. 픽커는 뉴스 필터 패턴(칩 나열 sticky 바 금지 · news.md).
- 카드: 표지 · 제목 · 요약 1줄 · 페이지수 · **가격은 카드 본문 줄에 활자로**.
  ⚠️ **표지 사진 위에 가격 배지를 얹지 말 것**(특강 커버 가격 배지 회귀 금지 · lectures.md).
- 상태 세 가지를 글자로 구분: `무료` / `9,900원` / `구매함`.
- 조회는 **`select('*')`** — 컬럼을 나열하면 마이그레이션 미적용 환경에서 목록 전체가 400.

### `lab-material.html?id=` — 상세

| 상태 | 보이는 것 |
|---|---|
| 비로그인 | 제목·요약·목차·페이지수·가격 + 로그인 유도 |
| 로그인 · 무료 | 본문 전체 + PDF 버튼 |
| 로그인 · 유료 미구매 | 제목·요약·**목차**·페이지수 + **비교 기준 한 줄** + 결제 버튼 |
| 구매함 | 본문 전체 + PDF 버튼 + 구매일 |

- 미구매자에게 본문 앞부분을 잘라 보여주지 않는다. **본문은 아예 못 받는다**(RLS). 판단 재료는 목차와 페이지수다.
- **비교 기준 한 줄이 필수다** — "학원 항공사 정보 특강은 회당 3~5만 원" 류. 이 문장이 없으면 9,900원이 싼지 비싼지 판단이 안 돼 결제가 일어나지 않는다(크레딧 팩에서 확인된 부분 · credits.md).
- 결제 버튼은 `lecture.html` 인라인 폼 패턴을 따른다. **신청 모달을 만들지 말 것**(`application-modal.js` 회귀 금지).
- **bfcache**: 결제로 외부에 나갔다 돌아오는 화면이다. 입력값이 없으므로 `pageshow` 에서 reload(mypage·login 과 같은 처리).

### mypage

`#sec-answers` 아래 '구매한 자료' 줄을 접이에 추가한다 — **데이터가 있을 때만**(mypage.md 원칙: 접이는 데이터 있는 줄만).

## 5. admin — '연구실 자료' 탭

**콘텐츠 그룹**(후기 관리·감점 사전·소재 문제 옆)에 넣는다. 운영·상품이 아니다 — 매일 보는 화면이 아니고 하는 일이 자료 등록이다. ⚠️ 탭을 맨 뒤에 이어붙이지 말 것(admin.md).

- 목록(항공사·공개 여부 필터) · 등록/수정 폼 · 표지 업로드 · PDF 업로드 · **가격 입력칸** · 공개 토글
- 자료별 구매 수·매출·다운로드 수 표시
- `.tabbtn` 클래스를 서브탭에 쓰지 않는다(initTabs 가 전부에 패널 전환을 건다).

## 6. 가격 — 제안값

오너가 자료마다 넣는 값이고, 아래는 기존 상품과 나란히 놓고 잡은 기준선이다
(챌린지 30,000 / 크레딧 기본 팩 10,000·30크레딧 / 학원 자소서 첨삭 한 문항 2~5만).

| 자료 성격 | 제안 | 근거 |
|---|---|---|
| 맛보기(항공사별 1건) | **0원** | 무료 칸이 없으면 유료 자료의 값어치를 판단할 근거가 없다 |
| 단품(리포트 1편·기출 모음) | **2,900~4,900원** | 첫 결제 문턱을 넘기는 자리 |
| 항공사 자료집 본편 | **9,900원** | 크레딧 기본 팩과 같은 값 — 이미 그 값을 내 본 사람들이라 저항이 낮다 |
| 시즌 패키지 | **19,900~29,900원** | 챌린지(30,000) 아래에 둔다. 넘으면 챌린지 결제를 갉아먹는다 |

## 7. 함정 목록

- **본문·가격을 한 테이블에 두지 말 것** — RLS 는 컬럼을 못 막는다(1절).
- **`lab_purchases` 에 회원 자가 INSERT 정책을 만들지 말 것** — 무료 구매 경로가 열린다.
- **결제 실패·중복을 non-2xx 로 돌려주지 말 것** — 환불 안내가 사라진다.
- **`lab-files` 버킷에 읽기 정책을 만들지 말 것** — 만드는 순간 함수를 우회한다.
- **워터마크에 한글을 넣지 말 것** — pdf-lib 기본 폰트가 못 그려 함수가 던진다.
- **목록 조회는 `select('*')`** — 컬럼 나열은 미적용 환경 400.
- **카드 커버 위 가격 배지 금지**(lectures.md 회귀 목록).
- **학원 자산·개인정보 반입 금지** — 합격 자소서 원문, 정규반 교재 기출·가이던스는 자료로 올리지 않는다. 자료는 파일명이 아니라 본문 출처로 확인한다.
- 무료 자료도 **로그인은 필요**하다(현재 `lab-archive.html` 안내 문구와 일치).

## 8. 구현 순서 — 수직 4단계

각 단계가 혼자 돌아가는 상태로 끝난다.

1. **migration + admin 탭** — 자료를 올리고 값을 매길 수 있다(화면엔 아직 안 나온다)
2. **목록 + 상세, 무료 자료까지 열람** — 결제 없이 동작하는 구간을 먼저 완성
3. **`materialId` 결제 분기 + 구매자 열람** — 유료가 열린다
4. **`lab-download` 워터마크 다운로드** — PDF 가 열린다

⚠️ 3단계 전까지 `price > 0` 인 자료는 **공개하지 않는다**(살 방법이 없는 자료가 목록에 뜬다).

## 9. 검증

빌드·린트 시스템이 없다. 수단은 이것뿐이다.

- **375px 브라우저 실측** — 목록·상세·admin 폼. 올리기 전 필수
- `deno check supabase/functions/lab-download/index.ts` · `.../verify-payment/index.ts`
- 결제 분기: 미공개 자료 결제 시도 · 중복 구매 환불 · 금액 위조(브라우저에서 price 조작) 3종을 실제로 태워 본다
- 열람 게이트: **미구매 계정으로 `lab_material_bodies` 를 직접 조회**해 0행인지 확인(RLS 가 진짜 막는지)
- 다운로드: 서명 URL 만료 후 접근이 실패하는지, 워터마크에 본인 이메일이 찍히는지
- 함수 배포 여부는 **anon key 프로브**로 확인(관리자에게 SQL 을 시키지 않는다)

## 10. 문서

구현이 끝나면 `docs/notes/lab.md` 에 유료 자료 절을 추가하고,
`docs/notes/implementation-status.md` 에 migration 적용 여부와 함수 배포 상태를 기록한다.
CLAUDE.md 기능별 문서 표의 연구실 행에 "자료 가격은 자료별 `price`" 한 줄을 더한다.
