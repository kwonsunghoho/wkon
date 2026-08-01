-- ============================================================================
-- 연구실 자료 — 관리자 권한 (2026-08-01, 앞 마이그레이션의 보완)
-- ============================================================================
-- 20260801120000 은 lab_resources·lab_downloads·lab-files 에 정책을 하나도 두지 않아
-- service_role(Edge Function) 만 접근할 수 있게 잠갔다. 그런데 **admin.html 의 관리자도
-- service_role 이 아니라 그냥 로그인한 사용자**라, 그대로 두면 자료를 올릴 수조차 없다.
-- 그래서 여기서 is_admin() 에게만 문을 연다(회원에게는 계속 닫혀 있다).
--
-- ⚠️ `authenticated` 전체에 여는 정책을 만들지 말 것 — password_hash·storage_path 가
--    그대로 노출된다. 조건은 반드시 public.is_admin().
-- ⚠️ lab_check_password 는 계속 service_role 전용이다(관리자에게도 주지 않는다 —
--    브라우저에서 대조 함수를 부를 수 있으면 시도 제한이 무의미해진다).
-- ============================================================================

-- ── 자료: 관리자만 전권 ─────────────────────────────────────────────────────
drop policy if exists lab_resources_admin_all on public.lab_resources;
create policy lab_resources_admin_all on public.lab_resources
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- ── 열람 기록: 관리자만 조회(유출 추적용). 회원은 남의 이력도 자기 이력도 못 본다 ──
drop policy if exists lab_downloads_admin_read on public.lab_downloads;
create policy lab_downloads_admin_read on public.lab_downloads
  for select
  using (public.is_admin());

-- ── 파일 버킷: 관리자만 올리고 지운다. 회원 열람은 서명 URL 이 담당한다 ──────
drop policy if exists lab_files_admin_all on storage.objects;
create policy lab_files_admin_all on storage.objects
  for all
  using (bucket_id = 'lab-files' and public.is_admin())
  with check (bucket_id = 'lab-files' and public.is_admin());

-- ── 비밀번호 설정: 관리자가 브라우저에서 부른다(평문은 이 함수 안에서만 해시로 바뀐다) ──
-- 함수 자체에 is_admin() 가드를 넣는다 — grant 만으로는 일반 회원이 부를 수 있다.
create or replace function public.lab_set_password(p_id uuid, p_pw text)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 변경할 수 있습니다.' using errcode = '42501';
  end if;
  update public.lab_resources
  set password_hash = case when p_pw is null or p_pw = '' then null else crypt(p_pw, gen_salt('bf', 10)) end,
      access = case when p_pw is null or p_pw = '' then 'member' else 'password' end,
      updated_at = now()
  where id = p_id;
end;
$$;

revoke all on function public.lab_set_password(uuid, text) from public, anon;
grant execute on function public.lab_set_password(uuid, text) to authenticated;
