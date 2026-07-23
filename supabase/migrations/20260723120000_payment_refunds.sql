-- =============================================================================
-- 간편결제 환불 (admin 원클릭) — applications 환불 누계 + refunds 이력
-- 적용: Supabase SQL Editor 에 전체 붙여넣고 실행 (idempotent, 재실행 안전)
-- ⚠️ cancel-payment Edge Function 배포 전에 먼저 실행할 것 (없는 컬럼 참조 방지)
-- =============================================================================

-- 환불 누계 (부분 환불 합산). paid_amount 와 대조해 전액/부분 판정.
alter table public.applications
  add column if not exists refunded_amount integer not null default 0;

-- 환불 이력 (언제·얼마·왜·포트원 응답) — 감사/장부용
create table if not exists public.refunds (
  id               uuid primary key default gen_random_uuid(),
  application_id   uuid references public.applications(id) on delete set null,
  amount           integer not null check (amount > 0),
  reason           text,
  portone_response jsonb,
  created_by       uuid,
  created_at       timestamptz not null default now()
);

alter table public.refunds enable row level security;

-- 관리자만 조회/기록 (is_admin() 은 membership 스키마에서 정의됨)
drop policy if exists refunds_admin_all on public.refunds;
create policy refunds_admin_all on public.refunds
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
