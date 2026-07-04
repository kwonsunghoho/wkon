-- =============================================================================
-- 관리자 임명을 "오너" 1인만 할 수 있도록 제한 + 오너 계정 보호
--
-- 배경: 기존 members_admin_all RLS 는 "admin 이면 누구나" 다른 회원의 role 을
--       바꿀 수 있게 허용한다. 관리자를 여러 명 두더라도 role(관리자 임명/강등)만은
--       오너만 다룰 수 있게 하고, 오너 계정 자체는 강등/삭제되지 않게 보호한다.
--
-- 방식: RLS 는 행(row) 단위라 특정 컬럼(role)만 막기 어렵다. 그래서 컬럼 규칙은
--       BEFORE UPDATE 트리거로 강제한다. service_role / SQL 에디터(로그인 컨텍스트
--       없음)는 관리·복구용 이스케이프 해치로 통과시킨다.
--
-- idempotent — 여러 번 실행해도 안전.
-- =============================================================================

-- 1. is_owner 플래그 컬럼
alter table public.members
  add column if not exists is_owner boolean not null default false;

comment on column public.members.is_owner is
  '오너(최고관리자) 여부. role 변경 권한은 오너만 가진다. 앱에서는 변경 불가(트리거로 고정), 이전은 SQL 에디터에서만.';

-- 2. 오너 부트스트랩: kwonsunghoho@gmail.com (이미 admin) 을 오너로 지정.
--    트리거(4번) 생성 전이라 여기서는 자유롭게 갱신된다.
update public.members
   set is_owner = true, role = 'admin'
 where email = 'kwonsunghoho@gmail.com';

-- 3. is_owner(): 현재 로그인 유저가 오너인지. RLS/트리거 재귀 방지 위해 SECURITY DEFINER.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where id = auth.uid() and is_owner = true
  );
$$;

comment on function public.is_owner() is
  '현재 유저가 오너인지 검사. role 변경 트리거에서 사용.';

-- 4. role / is_owner 변경 보호 트리거 (로그인한 클라이언트에만 규칙 적용)
create or replace function public.protect_member_privilege()
returns trigger
language plpgsql
as $$
begin
  -- service_role / SQL 에디터(로그인 컨텍스트 없음)는 통과. 클라이언트는 auth.uid() 가
  -- null 이면 애초에 members RLS 를 못 넘으므로, 여기 도달하는 null 은 신뢰된 서버뿐.
  if auth.uid() is null then
    return new;
  end if;

  -- role(관리자 임명/강등) 변경은 오너만.
  if new.role is distinct from old.role and not public.is_owner() then
    raise exception '관리자 권한(role) 변경은 오너만 가능합니다.';
  end if;

  -- is_owner 플래그는 앱에서 변경 불가 (오너 이전은 SQL 에디터에서만).
  if new.is_owner is distinct from old.is_owner then
    raise exception 'is_owner 플래그는 앱에서 변경할 수 없습니다.';
  end if;

  -- 오너 행은 앱에서 강등 불가 (항상 admin 유지).
  if old.is_owner and new.role <> 'admin' then
    raise exception '오너는 강등할 수 없습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_members_protect_privilege on public.members;
create trigger trg_members_protect_privilege
  before update on public.members
  for each row execute function public.protect_member_privilege();

-- 5. 오너 행 삭제 보호 (앱 경유 삭제 차단, SQL 에디터는 허용)
create or replace function public.protect_owner_delete()
returns trigger
language plpgsql
as $$
begin
  if old.is_owner and auth.uid() is not null then
    raise exception '오너 계정은 앱에서 삭제할 수 없습니다.';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_members_protect_delete on public.members;
create trigger trg_members_protect_delete
  before delete on public.members
  for each row execute function public.protect_owner_delete();
