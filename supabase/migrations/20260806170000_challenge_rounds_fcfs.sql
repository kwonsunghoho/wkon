-- =============================================================================
-- 챌린지 선착순 모드 — challenge_rounds.start_mode (2026-08-06 오너 요청)
-- =============================================================================
-- 배경: 기수는 지금까지 모집 시작~마감 날짜로만 열렸다. 오너 요청으로
--   "인원이 모이면 바로 시작"하는 선착순 기수를 추가한다.
--   - start_mode 'scheduled'(기본) = 기존 그대로 날짜로 판정
--   - start_mode 'fcfs' = 선착순. 모집 마감(recruit_end)이 없어도 되고,
--     그동안 화면은 '선착순 모집 중 · 인원이 모이면 바로 시작'으로 말한다.
--     닫는 건 admin '챌린지' 탭에서 수정(마감일 입력 또는 개강일 지정으로 전환)·삭제.
-- 미적용 상태에서도 조용히 degrade: 조회는 select('*') 라 400이 안 나고,
--   admin 저장은 '개강일 지정'이면 start_mode 없이 재시도한다(선착순만 안내로 멈춤).
-- 적용: 오너가 Supabase SQL Editor 에서 실행.
-- =============================================================================

alter table public.challenge_rounds
  add column if not exists start_mode text not null default 'scheduled';

do $$ begin
  alter table public.challenge_rounds
    add constraint challenge_rounds_start_mode_check
    check (start_mode in ('scheduled', 'fcfs'));
exception when duplicate_object then null; end $$;

-- 선착순은 모집 마감이 없을 수 있다(콘솔 생성 표라 not null 여부가 환경마다 다를 수 있어
-- 방어적으로 푼다 — 이미 nullable 이면 no-op).
alter table public.challenge_rounds alter column recruit_end drop not null;

-- =============================================================================
-- 적용 확인
-- select column_name, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'challenge_rounds'
--  order by ordinal_position;
-- =============================================================================
-- 롤백 (되돌릴 일이 생기면)
-- alter table public.challenge_rounds drop constraint if exists challenge_rounds_start_mode_check;
-- alter table public.challenge_rounds drop column if exists start_mode;
-- =============================================================================
