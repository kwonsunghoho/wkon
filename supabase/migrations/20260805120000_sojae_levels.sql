-- =============================================================================
-- 소재 발굴 — 문제 난이도 4단계 (2026-08-05)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260705120000(sojae_schema)
--
-- 배경: 문제 풀 전체가 한 줄로 섞여 하루 하나씩 순환하고 있었다. 학생이 자기 수준에
--       맞는 문제를 고를 수 없어 '기초 문제만 계속 나온다'는 지적이 나왔다(오너, 2026-08-05).
--       → questions 에 level 을 달고, 순환을 난이도별로 나눈다.
--
-- 미적용 시 degrade: 화면은 모든 문제를 '초급'으로 보고 지금과 똑같이 동작한다
--   (클라이언트가 level 을 select 조건에 넣지 않고 받아서 거른다 — 사이트 관례).
--   admin 저장은 level 없이 재시도해 계속 동작한다. 결제·크레딧에는 영향 없음.
-- =============================================================================

-- ── 1. questions.level ──────────────────────────────────────────────────────
-- basic(초급) / mid(중급) / advanced(고급) / deep(심화).
-- ⚠️ 코드명을 바꾸지 말 것 — 화면(sojae-common.js LEVEL_LABEL)과 짝이다.
alter table public.questions
  add column if not exists level text not null default 'basic';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.questions'::regclass and conname = 'questions_level_check'
  ) then
    alter table public.questions add constraint questions_level_check
      check (level in ('basic','mid','advanced','deep'));
  end if;
end $$;

comment on column public.questions.level is
  'basic/mid/advanced/deep. 학생이 고르는 난이도 — 오늘의 문제 순환이 이 값으로 갈린다.';

-- 단계별 순환 조회용(활성 풀에서 level 로 거른다)
create index if not exists questions_level_active_idx
  on public.questions (level, active);


-- ── 2. '오늘 고정'을 난이도별로 ──────────────────────────────────────────────
-- 기존 유일 인덱스는 날짜 하나당 문제 하나였다. 난이도가 생기면서 같은 날에
-- 초급·중급·고급·심화 각각 하나씩 고정할 수 있어야 한다 → (날짜, 난이도)로 바꾼다.
-- ⚠️ 순서 주의: 새 인덱스를 만들기 전에 옛 인덱스를 지운다(옛 인덱스가 남아 있으면
--    같은 날 두 번째 난이도를 고정하는 순간 23505 로 막힌다).
drop index if exists public.questions_scheduled_date_uq;

create unique index if not exists questions_scheduled_date_level_uq
  on public.questions (scheduled_date, level) where scheduled_date is not null;
