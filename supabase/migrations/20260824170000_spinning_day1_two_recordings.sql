-- =============================================================================
-- 스피닝 첫날 녹음 2개 (2026-08-24 오너 지시 "스피닝은 첫날에 녹음본 두 개")
-- =============================================================================
-- 스피닝만 제출 칸이 셋이 된다: 처음 ①·②(첫날 녹음 두 개) + 끝(마칠 무렵).
-- 두 번째 첫날 녹음은 type='before2' 로 저장한다 — 스피닝 전용이라
-- 다른 챌린지(voice·expression)는 지금처럼 before/after 한 쌍 그대로다.
--
-- 바꾸는 곳 두 자리:
--   1) challenge_submissions.type check — 'before2' 를 스피닝에 한해 허용
--   2) recordings 버킷 쓰기 정책의 파일명 패턴 — spinning-before2.<ext> 허용
--
-- ⚠️ 오너가 Supabase SQL Editor 에서 실행해야 반영된다.
-- ⚠️ 미적용 상태 degrade: 화면은 칸을 그리지만 처음 ② 업로드가 저장 정책에 막혀
--    "업로드하지 못했어요" 안내가 뜬다(다른 칸·다른 챌린지는 무관하게 돈다).
-- =============================================================================


-- ── 1. type check 확장 — before2 는 스피닝에서만 ────────────────────────────
-- 제약 이름은 표 생성 시 컬럼 check 의 기본 이름(challenge_submissions_type_check).
alter table public.challenge_submissions
  drop constraint if exists challenge_submissions_type_check;

alter table public.challenge_submissions
  add constraint challenge_submissions_type_check
  check (
    type in ('before', 'after')
    or (challenge = 'spinning' and type = 'before2')
  );

comment on table public.challenge_submissions is
  '챌린지 처음/끝 제출물(학생 본인 업로드). voice·spinning=음성, expression=영상. 스피닝만 첫날 녹음 2개(before·before2)+끝(after). answer(승자각)는 답변집(answers) 연동이라 여기 없음.';


-- ── 2. Storage 쓰기 정책 — spinning-before2 파일명 허용 ─────────────────────
-- 원본 정책(20260820120000)과 같고 파일명 패턴만 넓힌다.
-- split_part(파일명, '-', 1) 참가 판정은 'spinning-before2.m4a' 에서도 'spinning' 이라 그대로다.
drop policy if exists recordings_bucket_write_own  on storage.objects;
drop policy if exists recordings_bucket_update_own on storage.objects;

create policy recordings_bucket_write_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-f-]+/((voice|expression|spinning)-(before|after)|spinning-before2)\.[A-Za-z0-9]{1,8}$'
    and public.is_challenge_participant(split_part(storage.filename(name), '-', 1))
  );

create policy recordings_bucket_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-f-]+/((voice|expression|spinning)-(before|after)|spinning-before2)\.[A-Za-z0-9]{1,8}$'
    and public.is_challenge_participant(split_part(storage.filename(name), '-', 1))
  );


-- =============================================================================
-- 검증(실행 후)
-- =============================================================================
-- 1) 제약 확인:
--    select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.challenge_submissions'::regclass and conname like '%type%';
--    → before2 가 spinning 조건으로 들어 있으면 정상.
-- 2) 정책 확인:
--    select policyname from pg_policies where tablename='objects'
--     and policyname in ('recordings_bucket_write_own','recordings_bucket_update_own');
--    → 2건.
-- 3) 화면: 스피닝 참가 회원 mypage 제출 카드에 칸 3개(처음 ①·② / 끝),
--    처음 ② 업로드·재생이 되는지.
-- =============================================================================
-- 롤백(원본 20260820120000 상태로)
-- =============================================================================
-- alter table public.challenge_submissions
--   drop constraint if exists challenge_submissions_type_check;
-- alter table public.challenge_submissions
--   add constraint challenge_submissions_type_check check (type in ('before', 'after'));
--   (⚠️ before2 행이 이미 있으면 위 add 가 실패한다 — 행을 지운 뒤 되돌릴 것)
-- 정책 2종은 20260820120000 의 원문으로 다시 create 한다.
-- =============================================================================
