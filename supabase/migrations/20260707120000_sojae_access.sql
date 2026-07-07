-- =============================================================================
-- MONC 소재 발굴 — 관리자 부여 권한 게이트
-- =============================================================================
-- 배경: 지금까지 소재 발굴은 로그인만 하면 누구나 사용 가능했다(sojae.html=requireSession,
--       RLS=본인이면 CRUD, Edge Function=JWT만 확인). 유료 회원 전용 기능이므로
--       관리자가 명시적으로 권한을 준 회원만 쓸 수 있게 한다.
--
-- 설계(docs/superpowers/specs/2026-07-07-sojae-access-permission-design.md)
--   - members.sojae_enabled 플래그. 기본 false → 적용 즉시 전원 잠금.
--   - 관리자(role='admin')/오너는 값과 무관하게 항상 허용(can_sojae).
--   - 부여는 모든 관리자 가능(role 변경과 달리 오너 전용 아님).
--
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run (또는 supabase db push)
-- idempotent — 여러 번 실행해도 안전.
-- =============================================================================

-- 1. 권한 플래그 -------------------------------------------------------------
alter table public.members
  add column if not exists sojae_enabled boolean not null default false;

comment on column public.members.sojae_enabled is
  '소재 발굴 사용 권한. 관리자가 부여. 관리자/오너는 값과 무관하게 항상 허용(can_sojae).';

-- 2. can_sojae(): 현재 유저가 소재 발굴을 쓸 수 있는지. --------------------
--    RLS 재귀 방지 위해 SECURITY DEFINER (members 를 정책 없이 조회).
create or replace function public.can_sojae()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where id = auth.uid()
      and (sojae_enabled = true or role = 'admin')
  );
$$;

comment on function public.can_sojae() is
  '소재 발굴 접근 허용 여부(sojae_enabled 또는 관리자). RLS·Edge Function에서 사용.';

-- 3. own 정책 교체 — can_sojae() 추가 ---------------------------------------
--    admin_all 정책(관리자 전체 접근)은 그대로 둔다. questions 읽기도 그대로.
drop policy if exists sessions_own on public.discovery_sessions;
create policy sessions_own on public.discovery_sessions
  for all to authenticated
  using (member_id = auth.uid() and public.can_sojae())
  with check (member_id = auth.uid() and public.can_sojae());

drop policy if exists messages_own on public.discovery_messages;
create policy messages_own on public.discovery_messages
  for all to authenticated
  using (member_id = auth.uid() and public.can_sojae())
  with check (member_id = auth.uid() and public.can_sojae());

drop policy if exists answers_own on public.answers;
create policy answers_own on public.answers
  for all to authenticated
  using (member_id = auth.uid() and public.can_sojae())
  with check (member_id = auth.uid() and public.can_sojae());

-- =============================================================================
-- 끝. 적용 후: admin 페이지에서 소재 발굴 쓸 회원의 권한을 켜준다(개별/일괄).
--   Edge Function(sojae-chat)도 403 검사 추가분으로 새 버전 재배포 필요.
-- =============================================================================
