# 재학생 무료 참여 — 구현 계획

설계: `docs/superpowers/specs/2026-09-09-academy-student-free-design.md`(오너 승인 2026-09-09)

**목표:** 명단에 있는 재학생이 챌린지·특강·연구실 자료를 화면에서 0원으로 접수한다.
**구조:** 판정·기록은 전부 DB(security definer RPC). 브라우저는 "나는 재학생인가"만 묻고 화면을 바꾼다.
**검증:** 이 레포엔 lint·build·테스트가 없다 — SQL 실측 + 375px 브라우저 실측 + 상호작용 뒤 상태 확인.

---

### Task 1 — 마이그레이션 `supabase/migrations/20260909120000_academy_students.sql`

- [ ] `academy_students` 표(phone_norm PK · name · valid_until · memo · created_at) + 관리자 전용 RLS
- [ ] `monc_is_student()` — verified_at + 명단 + 기간. security definer, `authenticated` 만 실행
- [ ] `my_student_status()` — `{student, until}` 만 돌려준다(명단 비노출)
- [ ] `apply_free_challenges(p_ids text[])` — 기수·이름·금액은 서버가 정한다. MC001/MC002 를 코드로 변환
- [ ] `apply_free_lecture(p_lecture uuid, p_slot uuid)` — 정원·중복은 기존 트리거
- [ ] `claim_free_resource(p_resource uuid)` — `lab_purchases` 0원 기록. 자가 INSERT 정책은 열지 않는다
- [ ] 커밋

### Task 2 — `supabase-config.js` 공용 판정

- [ ] `MONC.studentStatus()` — `my_student_status()` 호출 + 세션 캐시. 함수 미배포·실패는 `{student:false}`
      (실패가 무료를 주면 안 된다 — 게이트와 반대 방향)
- [ ] `MONC.applyFree(kind, payload)` — 세 RPC 로 가는 창구 한 곳
- [ ] 전역 노출 목록에 추가 · 커밋

### Task 3 — `apply.html` 재학생 분기

- [ ] 초기화에서 `studentStatus()` 를 읽어 `_isStudent` 저장
- [ ] `updateSummary()` — 재학생이면 금액 줄·합계·하단바를 0원으로, 정가/할인 줄은 숨긴다
- [ ] 결제 버튼 묶음(`#tossWrap`·`#submitBtn`)을 숨기고 `[무료로 신청하기]` 노출
- [ ] `applyFreeChallenges()` — 동의 체크·중복 사전검사는 기존 그대로, 접수는 RPC
- [ ] 375px 실측 후 커밋

### Task 4 — `lecture.html` 재학생 분기

- [ ] 같은 방식(0원 표시 + 무료 버튼 + RPC). 시간대 선택·정원 표시는 그대로
- [ ] 375px 실측 후 커밋

### Task 5 — `lab-shelf.html` 재학생 분기

- [ ] 유료 자료 카드/뷰어 진입 버튼을 `[무료로 받기]` 로, RPC 후 자료 열기
- [ ] 375px 실측 후 커밋

### Task 6 — `admin.html` '재학생 명단'

- [ ] '회원 관리' 탭 안 묶음: 붙여넣기 등록(종료일 일괄) · 목록 · 검색 · 삭제
- [ ] 줄마다 '가입/미가입 · 인증/미인증' 표시(무료가 안 되는 이유가 보여야 한다)
- [ ] 375px 실측 후 커밋

### Task 7 — 문서

- [ ] `docs/notes/admin.md`(재학생 명단 · 자동/수동 두 길) · `apply-and-payment.md` · `lectures.md` · `lab.md`
- [ ] `CLAUDE.md` 기능별 문서 표에 한 줄
- [ ] 커밋 · 오너에게 SQL 을 대화창으로 전달
