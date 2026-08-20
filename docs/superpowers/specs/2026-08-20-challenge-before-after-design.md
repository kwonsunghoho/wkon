# 챌린지 처음/끝 학생 직접 제출 — 설계 (2026-08-20 오너 승인)

오너 지시: "처음과 끝만 입력할 수 있도록. 내가 다 하면 일이 많아지니까 학생들이 직접.
영상도 학생이 직접 올릴 수 있게. 단, 승자각 같은 답변은 내 답변집에 쌓이도록."
추가 확정: 일차별 기록(1~14일)은 **화면에서 정리**(데이터 보존), 제출 자리는 **마이페이지 안**.

## 요지

- 챌린지 산출물 입력 주체를 오너(admin 수동)에서 **학생 본인**으로 바꾼다.
- 보신각·스피닝 = 음성, 영합각 = 영상 — 챌린지마다 '처음/끝' 한 쌍.
- 승자각은 파일이 아니라 **답변집(answers) 연동** — DAY1~10 문항을 눌러 직접 쓴다(저장 무료·무제한 원칙 그대로).
- 일차별 기록(daily_records) 입력·표시는 화면에서 걷는다. **테이블·데이터는 보존**(마이그레이션에 drop 없음).

## 데이터 — migration `20260820120000_challenge_submissions.sql`

새 표 `challenge_submissions` (recordings 확장 대신 신설 — 기존 unique(member_id,type)와
admin upsert 를 깨지 않는 **순수 추가형**이라 미적용 환경 degrade 가 깔끔하다):

- `member_id`·`challenge`(voice/expression/spinning — **answer 는 check 로 배제**, 파일 제출이 없다)
- `round`(smallint, 신청 시점 기수 — 표시용)·`type`(before/after)·`storage_path`
- `unique (member_id, challenge, type)` — 화면 upsert 의 onConflict 대상.
- RLS: 본인 select/insert/update/delete + admin 전체.
  insert/update 의 with check 에 **`is_challenge_participant(challenge)`**(security definer —
  applications 에서 `member_id = auth.uid()` + 결제완료/무료 + 미환불 + challenges jsonb 에
  해당 챌린지 포함) — **참가 판정은 DB 가 한다.** `storage_path` 는 본인 폴더 강제.
- 비회원 신청(전화 매칭)은 대상이 아니다 — member_id 연동 신청만. 그 경우는 admin 대리 업로드.

Storage(`recordings` 비공개 버킷 재사용):

- 본인 폴더(`<uid>/…`) insert/update/delete 정책 추가. 파일명은
  `<uid>/<challenge>-<type>.<ext>` 패턴 + 파일명의 challenge 로 참가 판정까지 정책에서 검사
  (비참가 회원이 저장소를 창고로 쓰는 것 차단).
- 버킷 `file_size_limit` 50MB. 재생은 기존 signed URL(`MONC.getSignedUrl`).
- 확장자가 바뀌는 재업로드는 옛 파일을 지운다(고아 파일 방지 — delete 정책이 필요한 이유).

## 화면

### mypage.html — '내 챌린지 제출' 카드 신설

- 결제완료/무료(미환불) 신청의 챌린지마다 카드 1장(같은 챌린지 중복 신청은 최신 기수 1장).
- voice/spinning/expression: '처음'/'끝' 슬롯 2개 — 업로드 버튼, 올리면 그 자리 재생(음성 audio ·
  영상 video), 다시 올리면 교체. 둘 다 있으면 나란히 비교.
- answer(승자각): DAY1~10 문항 목록 + 작성 상태 N/10. 문항 클릭 →
  `answers.html?title=DAY N. …#new`(제목 자동 채움) → 저장하면 '작성됨'.
  작성 판정은 본인 answers 의 title 정확 일치(우리가 제목을 채워 주므로 일치한다).
- 걷는 것: progCard(2주 미션 바)·sec-days(14일 격자)·sec-comments(코치 코멘트) 표시 +
  daily_records 조회. '오늘 할 일' 카드의 안내 문구도 제출 칸 기준으로 교체.
- 남는 것: legacy `recordings`(회원당 한 쌍) 데이터가 있으면 기존 sec-ba 접이는 그대로 보인다.
- degrade: challenge_submissions 미생성(PGRST205) → 슬롯 대신 '준비 중' 안내 한 줄.
- 영상 용량: 업로드 전 50MB 검사 + "1~2분 분량" 안내.

### admin.html — 회원 상세

- '날짜별 미션 (1~14일)' 패널 + 관련 배선 제거(요약 스탯의 미션 줄 포함). 데이터는 보존.
- '챌린지 제출물' 패널 신설: 신청한 챌린지 그룹별 처음/끝 — 학생이 올린 것 재생 +
  admin 대리 업로드/교체(같은 경로 규칙·같은 upsert). 미적용 환경이면 안내 한 줄.
- legacy 'Before / After 음성' 패널은 유지(옛 데이터·예비 경로).

### answers.html

- `?title=` 파라미터 + `#new` 조합이면 추가 화면을 열고 제목을 채운다(그 외 동작 불변).

## 검증

- 375px 브라우저 실측(카드 렌더·업로드 버튼 44px·활자 12px+), 320px 넘침 0.
- 가짜 세션/미적용 환경에서 degrade(준비 중 안내·콘솔 에러 0).
- RLS: 비참가 회원 insert 거부(42501), 타인 폴더 업로드 거부 — anon key 프로브로 확인.
- 마이그레이션은 오너가 SQL Editor 실행(본문은 대화창 ```sql 전달) — 적용 여부는
  implementation-status.md 에 기록.
