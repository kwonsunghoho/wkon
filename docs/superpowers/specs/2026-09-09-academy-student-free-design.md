# 재학생 무료 참여 — 설계 (2026-09-09 오너 확정)

학원 재학생을 사이트가 알아보고, **챌린지·특강·연구실 자료를 무료로** 접수하게 한다.
지금은 오너가 admin 에서 건건이 [무료(재학생)] 토글을 켜는 수동 흐름이다(2026-08-11 확정) — 그 흐름은
그대로 두고, 명단에 있는 재학생은 **자기가 화면에서 0원으로 접수**하게 만든다.

## 오너 확정 사항(2026-09-09)

| 물음 | 확정 |
|---|---|
| 재학생 판정 | **전화번호 명단** 등록(가입 전에도 미리 넣어 둘 수 있다) |
| 무료 범위 | **무제한 + 기간 제한**(명단 줄마다 종료일) |
| 대상 | **챌린지·특강·연구실 자료 전부** |
| 크레딧 | **제외** — AI 원가가 매번 나가는 값이라 무료로 열지 않는다 |
| 대조 기준 | **번호만**(본인인증 번호라 명의가 이미 확인된다. 명단의 이름은 오너 확인용) |
| 화면 노출 | **재학생 계정에만.** 공개 페이지엔 무료 문구를 걸지 않는다(2026-08-11 원칙 유지) |

## 왜 Edge Function 이 아니라 DB 함수인가

무료 접수에는 포트원을 부를 일이 없다 — 판정도 기록도 전부 DB 안에서 끝난다.
security definer RPC 로 두면 배포가 **SQL Editor 실행 한 번**이고(콘솔 함수 배포 불필요),
"돈이 걸린 판정은 DB 가 원장"이라는 기존 규칙과도 그대로 맞는다.

## 1. 명단 — `academy_students`

```
phone_norm  text primary key      -- monc_norm_phone() 을 거친 형태
name        text                  -- 오너 확인용. 판정에 쓰지 않는다
valid_until date not null         -- 이 날짜까지 무료(포함)
memo        text
created_at  timestamptz
```

- **RLS 는 관리자 전용**(`is_admin()`). 회원은 이 표를 못 읽는다 — 번호 목록 자체가 개인정보다.
- ⚠️ **번호 값은 레포에 커밋하지 않는다.** 등록은 admin 화면에서 한다(CLAUDE.md '개인정보' 절).
- 종료일이 지난 줄은 지우지 않는다 — 판정에서만 빠진다(재등록 이력이 남는 편이 낫다).

## 2. 판정 — 서버가 한다

```
monc_is_student()      -- security definer, 인자 없음. auth.uid() 기준
  = members.verified_at is not null
    and monc_norm_phone(members.phone) 이 academy_students 에 있고
    and valid_until >= current_date
```

- **본인인증(`verified_at`)을 요구하는 것이 이 설계의 문지기다.** 프로필에 남의 번호를 적어 무료를
  가져가는 길을 막는다(번호 저장은 `save_my_profile` 서버 대조를 거치지만, 미가입 번호는 통과한다).
- 인증을 못 한 재학생은 지금처럼 오너가 admin 에서 무료 처리한다(아래 5절).
- 화면용 `my_student_status()` → `{ student: bool, until: date }`. **명단은 노출하지 않는다.**

## 3. 무료 접수 3경로 — 전부 security definer RPC

세 함수 모두 **자기 안에서 `monc_is_student()` 를 다시 검사한다**(화면이 보낸 값을 믿지 않는다).
금액·대상 회원은 브라우저가 정하지 못한다 — 회원은 `auth.uid()`, 금액은 0 고정.

| RPC | 하는 일 | 기존 안전장치 |
|---|---|---|
| `apply_free_challenges(p_challenges jsonb)` | `applications` insert — `total_price=0`, `payment_status='free'`, `paid=false`, `member_id=auth.uid()`, 이름·전화는 `members` 값 | 중복 신청(MC002)·기수 정원 트리거가 그대로 판정 |
| `apply_free_lecture(p_lecture uuid, p_slot uuid)` | 같은 표에 `lecture_id`·`slot_id` 를 달아 `'free'` 로 insert | 좌석 재계산이 이미 `free` 를 '살아있는 자리'로 센다(`monc_app_live`) · 정원 마감(MC001) |
| `claim_free_resource(p_resource uuid)` | `lab_purchases` insert — `amount=0`, `payment_id=null` | `unique(resource_id, user_id)` |

- `p_challenges` 는 **챌린지 id 배열만** 받는다. 이름·기수·금액은 서버가 다시 읽는다
  (금액은 0 고정, 기수는 `challenge_rounds` 의 현재 모집 기수) — 브라우저가 기수를 정하면
  마감된 기수에 무료로 끼어들 수 있다.
- ⚠️ **`lab_purchases` 에 회원 자가 INSERT 정책을 열지 않는다** — 이 함수만 넣는다(20260801160000 경고 그대로).
- `claim_free_resource` 는 `price > 0 and published` 인 자료만 받는다(무료 자료는 애초에 로그인만으로 열린다).
- 세 함수 모두 `authenticated` 에만 grant. `anon` 에는 주지 않는다.
- 실패는 예외가 아니라 `{ ok:false, code }` 로 돌려준다(`not_student`·`duplicate`·`full`·`already`) —
  화면이 사유를 구분해 안내할 수 있어야 한다.

## 4. 화면 — 재학생 계정에만

판정 호출은 **`supabase-config.js` 의 `MONC.studentStatus()` 한 곳**에 둔다(세 페이지가 규칙을 복사하지 않는다).
결과는 세션 동안 캐시한다.

- `apply.html` — 합계가 `0원`, 결제 버튼(토스페이·카카오페이)·계좌이체 안내를 숨기고 **[무료로 신청하기]** 하나.
  동의 체크(`#appConsent`)는 그대로 필수. 환불 계좌는 받지 않는다(받을 돈이 없다).
- `lecture.html` — 같은 방식. 시간대 선택·정원 표시는 그대로.
- `lab-shelf.html` — 유료 자료 카드의 [구매] 자리가 **[무료로 받기]**.
- 비재학생 화면은 **한 픽셀도 바뀌지 않는다.** 종료일이 지나면 조용히 정상가로 돌아간다(만료 안내 없음).
- 미적용(마이그레이션 실행 전) degrade: `my_student_status()` 가 없으면 화면은 그냥 정상가로 돈다.

## 5. 지금 것은 그대로 둔다

- admin 의 수동 [무료(재학생)] 토글·[무료 재등록]은 유지한다 — 명단에 없거나 인증을 못 한 학생의 예외 처리.
- **원장은 여전히 `applications.payment_status='free'` 하나다.** 자동·수동을 구분하는 컬럼을 만들지 않는다
  (미입금 판정 두 곳·CSV '재학생' 칸이 전부 이 값 하나를 본다).
- mypage '내 신청내역'은 `free` 를 이미 '무료 참여'로 보여준다 — 손댈 것이 없다.

## 6. admin — '재학생 명단'

'회원 관리' 탭 안의 묶음으로 넣는다(탭을 새로 만들지 않는다).

- 번호 **여러 줄 붙여넣기** 등록(`010-1234-5678`·`01012345678` 섞여도 `monc_norm_phone` 이 정규화).
  이름이 같은 줄에 붙어 있으면(`홍길동 010-…`) 이름 칸에 넣는다.
- 등록할 때 **종료일을 한 번 골라 전체에 적용**한다. 목록에서 줄별 수정·삭제·검색.
- 목록에 '가입함/미가입', '인증함/미인증'을 같이 보여준다 — 무료가 안 되는 학생의 이유가 여기서 보여야
  오너가 문의를 바로 답할 수 있다.

## 7. 검증

이 레포에는 lint·build·테스트가 없다(CLAUDE.md '명령·검증'). 대신:

1. **SQL 실측** — Supabase SQL Editor 에서 명단에 없는 회원 / 있지만 미인증 / 있고 인증 / 종료일 지난 회원
   네 경우로 `monc_is_student()` 를 확인한다.
2. **375px 브라우저 실측** — apply·lecture·lab-shelf 세 화면을 재학생·비재학생 두 상태로 본다
   (회원 화면이라 스텁 사본으로 잡는다).
3. **버튼 누른 뒤까지** 확인한다 — 접수 후 mypage '무료 참여' 표시, admin 신청 목록의 '무료(재학생)' 배지,
   특강 잔여석이 1 줄어드는지.
4. 중복 신청·정원 마감이 무료 경로에서도 막히는지 실측(트리거는 공용이지만 경로가 새로 생겼다).

## 8. 손대는 파일

- `supabase/migrations/20260909120000_academy_students.sql` — 표·RLS·판정 함수·RPC 3개
- `supabase-config.js` — `MONC.studentStatus()`
- `apply.html` · `lecture.html` · `lab-shelf.html` — 재학생 분기
- `admin.html` — '재학생 명단' 묶음
- 문서: `docs/notes/admin.md` · `apply-and-payment.md` · `lectures.md` · `lab.md` · `CLAUDE.md` 표
