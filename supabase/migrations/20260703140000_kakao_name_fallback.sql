-- =============================================================================
-- handle_new_user 트리거 보완 — 카카오 로그인 대비
-- =============================================================================
-- 카카오는 이름을 구글과 다른 키(nickname 등)로 넘겨줄 수 있어서,
-- 이름 후보를 더 넓게 시도한다. 여전히 없으면 null(관리자가 나중에 입력).
-- email 은 카카오가 안 줄 수 있으므로 그대로 nullable.
-- Supabase SQL Editor 에 붙여넣어 실행하면 함수만 교체된다(재실행 안전).
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.members (id, name, email)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'nickname',
      new.raw_user_meta_data->>'user_name',
      new.raw_user_meta_data->>'preferred_username'
    ),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
