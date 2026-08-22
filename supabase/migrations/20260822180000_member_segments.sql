-- =============================================================================
-- 회원 조건 저장(세그먼트) (2026-08-22)
-- =============================================================================
-- 배경: 반복해서 거르는 조건("3기 참가자 중 미입금", "고객인데 30일 무소식")을 매번 손으로
--       훑고 있었다. 조건에 이름을 붙여 저장하고, 걸린 사람을 '오늘' 탭의 할 일로 올린다.
--       스펙 docs/superpowers/specs/2026-08-22-admin-members-crm-design.md
--
-- ⚠️ rule 은 **AND 로 묶인 조건 배열**이다. OR·괄호를 넣지 않는다 — 넣는 순간 화면이
--    질의 편집기가 된다. 필요해지면 그때 늘린다.
--
-- ⚠️ 거르기는 브라우저가 한다(이미 받아 둔 회원·신청·크레딧 배열로). 이 표는 **조건만** 담는다.
--    돈이 걸린 판정이 아니라 '목록을 어떻게 볼까'라서 서버가 소유할 이유가 없다.
--
-- ⚠️ 관리자 전용. 회원에게 보일 값이 아니다(조건 이름 자체가 영업 판단이다).
-- ⚠️ 오너가 Supabase SQL Editor 에서 실행해야 반영된다. 미적용이어도 회원 관리 탭은
--    '저장한 조건' 묶음만 빠진 채 그대로 돈다.
-- =============================================================================

create table if not exists public.member_segments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 30),
  rule       jsonb not null default '{"all":[]}'::jsonb,
  -- 켜면 '오늘' 탭 '지금 처리'에 인원수 한 줄로 올라간다
  followup   boolean not null default false,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.member_segments is
  '회원 목록을 거르는 조건(관리자 전용). rule = {"all":[{k,op,v},…]} — AND 만. 거르기는 브라우저가 한다.';
comment on column public.member_segments.followup is
  'true 면 오늘 탭 ''지금 처리''에 인원수가 한 줄로 뜬다.';

-- 이름이 같은 조건을 둘 만들 이유가 없다(어느 것을 고른 건지 알 수 없다)
create unique index if not exists member_segments_name_idx on public.member_segments (lower(btrim(name)));

alter table public.member_segments enable row level security;

drop policy if exists member_segments_admin on public.member_segments;
create policy member_segments_admin on public.member_segments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
