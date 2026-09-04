-- =============================================================================
-- challenge_rounds 가 'culture' 기수를 받게 (2026-09-04)
-- =============================================================================
-- 실사고: 댄.특.완 1기를 admin 에서 저장하니
--   new row for relation "challenge_rounds" violates check constraint
--   "challenge_rounds_challenge_check"
-- `challenge_rounds` 는 **콘솔에서 만든 표**라 레포에 정의가 없다 — 챌린지 값 목록을
-- 못 박은 check 제약이 DB 에만 있었고, 새 챌린지가 생겨도 아무도 몰랐다.
--
-- ⚠️ 오너가 Supabase SQL Editor 에서 실행해야 반영된다. 이걸 실행하기 전에는
--    댄특완 기수를 만들 수 없고, 그래서 화면은 계속 '다음 기수 준비 중'으로 잠긴다.
-- ⚠️ 제약을 없애 버리지 않고 값 목록만 넓힌다 — 오타('cultrue')로 기수를 만들면
--    카드도 신청도 조용히 비는데, 제약이 그걸 잡아 준다.
-- ⚠️ **앞으로 챌린지를 하나 더 만들면 이 목록에 그 id 를 더한다.**
--    같은 성격의 목록이 `challenge_submissions.challenge`(파일 제출용 셋)에도 있는데,
--    거기는 음성·영상 챌린지 전용이라 답변형(answer·culture)을 넣지 않는다.
-- =============================================================================

alter table public.challenge_rounds
  drop constraint if exists challenge_rounds_challenge_check;

alter table public.challenge_rounds
  add constraint challenge_rounds_challenge_check
  check (challenge in ('voice', 'expression', 'spinning', 'answer', 'culture'));


-- =============================================================================
-- 검증(실행 후)
-- =============================================================================
-- admin '챌린지' 탭에서 댄특완 기수를 저장해 본다 — 저장되면 끝이다.
--
-- 남은 제약을 눈으로 보고 싶으면:
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.challenge_rounds'::regclass and contype = 'c';
-- =============================================================================
