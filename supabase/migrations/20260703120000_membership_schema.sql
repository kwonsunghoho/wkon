-- =============================================================================
-- MONC 챌린지 결과 관리 시스템 — 초기 스키마
-- =============================================================================
-- 실행 방법(둘 중 아무거나):
--   (A) Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 Run
--   (B) supabase CLI: `supabase db push`
--
-- 설계 원칙
--   - 회원 식별 키는 이메일이 아니라 auth.users.id (UUID) 이다.
--     카카오 로그인 등 이메일을 주지 않는 provider 추가에 대비.
--     email 은 '있으면 저장/표시하는 부가 정보'로만 다룬다(nullable).
--   - 최우선 보안 요건: 회원은 절대 남의 데이터를 볼 수 없어야 한다.
--     → 모든 테이블 RLS ON + 자기 것(member_id = auth.uid())만 SELECT.
--
-- 이 스크립트는 재실행해도 안전하도록(idempotent) 작성했다.
-- =============================================================================

-- 필요한 확장(대부분 Supabase 기본 활성화 상태) --------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()


-- =============================================================================
-- 1. cohorts (챌린지 기수)
-- =============================================================================
create table if not exists public.cohorts (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  start_date  date,
  end_date    date,
  created_at  timestamptz not null default now()
);

comment on table public.cohorts is '챌린지 기수(1기, 2기 …). 회원은 cohort_id 로 배정된다.';


-- =============================================================================
-- 2. members (회원 = 프로필). id 는 auth.users.id 를 그대로 사용
-- =============================================================================
create table if not exists public.members (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,                              -- nullable: provider 가 안 줄 수 있음
  email       text,                              -- nullable: 카카오 등은 이메일 미제공 가능
  cohort_id   uuid references public.cohorts(id) on delete set null,  -- 관리자가 나중에 배정
  role        text not null default 'member' check (role in ('admin','member')),
  created_at  timestamptz not null default now()
);

comment on table public.members is
  '회원 프로필. PK = auth.users.id. 로그인 방식과 무관하게 항상 존재하는 user id 로 식별한다.';
comment on column public.members.email is
  '부가 정보. provider 가 이메일을 주지 않으면 null. 식별 키로 쓰지 말 것.';


-- =============================================================================
-- 3. daily_records (날짜별 미션 기록)
-- =============================================================================
create table if not exists public.daily_records (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  day_number  int  not null check (day_number between 1 and 14),
  status      text not null check (status in ('success','fail')),
  comment     text,                               -- 관리자 코멘트(nullable)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (member_id, day_number)                  -- 하루에 한 기록만
);

comment on table public.daily_records is '2주(1~14일) 동안의 날짜별 미션 성공/실패 + 관리자 코멘트.';


-- =============================================================================
-- 4. recordings (Before/After 음성 메타데이터. 실제 파일은 Storage)
-- =============================================================================
create table if not exists public.recordings (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members(id) on delete cascade,
  type          text not null check (type in ('before','after')),
  storage_path  text not null,                    -- 예: {member_id}/before.mp3
  created_at    timestamptz not null default now(),
  unique (member_id, type)                        -- before 1개 / after 1개
);

comment on table public.recordings is
  '입과 전(before)/수료 후(after) 음성. private 버킷의 파일 경로만 저장, 재생은 signed URL 로.';


-- =============================================================================
-- 5. 헬퍼 함수
-- =============================================================================

-- is_admin(): 현재 로그인 유저가 admin 인지.
-- ★ SECURITY DEFINER 로 만들어야 RLS 무한 재귀를 피한다.
--   (members 정책 안에서 members 를 조회하기 때문. DEFINER 는 소유자=postgres
--    권한으로 실행되어 members 의 RLS 를 우회한다.)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.members
    where id = auth.uid()
      and role = 'admin'
  );
$$;

comment on function public.is_admin() is
  '현재 유저가 admin 인지 검사. RLS 재귀 방지를 위해 SECURITY DEFINER.';


-- updated_at 자동 갱신용
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_daily_records_updated_at on public.daily_records;
create trigger trg_daily_records_updated_at
  before update on public.daily_records
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 6. 신규 가입 시 members 행 자동 생성 (트리거)
-- =============================================================================
-- 회원가입(auth.users insert)되면 members 에 프로필 행을 자동으로 만든다.
-- role 은 기본 'member'. name/email 은 auth 메타데이터에서 가져오되 없으면 null.
-- cohort_id 는 null(관리자가 나중에 배정).
-- SECURITY DEFINER 로 auth 스키마 트리거에서 public 테이블에 insert 가능하게.
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
    -- provider 별로 이름 키가 달라서 여러 후보를 순서대로 시도
    coalesce(
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'full_name'
    ),
    new.email          -- 없으면 null
  )
  on conflict (id) do nothing;   -- 재시도/중복 이벤트 방어
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'auth.users insert 시 members 프로필 행을 자동 생성. role=member 기본, name/email 은 메타데이터에서.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =============================================================================
-- 7. RLS (Row Level Security) — 최우선 보안 요건
-- =============================================================================
alter table public.cohorts       enable row level security;
alter table public.members       enable row level security;
alter table public.daily_records enable row level security;
alter table public.recordings    enable row level security;

-- 재실행 안전을 위해 기존 정책 제거 후 재생성 --------------------------------
drop policy if exists cohorts_select_authenticated on public.cohorts;
drop policy if exists cohorts_admin_all            on public.cohorts;
drop policy if exists members_select_own           on public.members;
drop policy if exists members_select_admin         on public.members;
drop policy if exists members_update_own           on public.members;
drop policy if exists members_admin_all            on public.members;
drop policy if exists daily_select_own             on public.daily_records;
drop policy if exists daily_admin_all              on public.daily_records;
drop policy if exists recordings_select_own        on public.recordings;
drop policy if exists recordings_admin_all         on public.recordings;

-- --- cohorts: 로그인 유저 전체 SELECT, 관리자만 수정 -----------------------
create policy cohorts_select_authenticated on public.cohorts
  for select
  to authenticated
  using (true);

create policy cohorts_admin_all on public.cohorts
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- --- members: 본인 자기 행 조회/수정, 관리자 전체 ---------------------------
create policy members_select_own on public.members
  for select
  to authenticated
  using (id = auth.uid());

create policy members_select_admin on public.members
  for select
  to authenticated
  using (public.is_admin());

-- 본인 수정: 단, role 을 스스로 admin 으로 올리지 못하게 막는다(권한 상승 차단).
-- with check 에 role = 'member' 를 강제 → 회원은 자기 role 을 member 로만 유지 가능.
-- (관리자가 자기 행을 수정할 땐 아래 members_admin_all 정책으로 통과되므로 문제없음)
create policy members_update_own on public.members
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = 'member');

-- 관리자: members 전체 관리(role 배정, cohort 배정 등)
create policy members_admin_all on public.members
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- --- daily_records: 회원은 자기 것만 SELECT, 관리자는 전체 CRUD -------------
create policy daily_select_own on public.daily_records
  for select
  to authenticated
  using (member_id = auth.uid());

create policy daily_admin_all on public.daily_records
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- --- recordings: 회원은 자기 것만 SELECT, 관리자는 전체 CRUD ----------------
create policy recordings_select_own on public.recordings
  for select
  to authenticated
  using (member_id = auth.uid());

create policy recordings_admin_all on public.recordings
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- =============================================================================
-- 8. Storage — 'recordings' private 버킷 + RLS
-- =============================================================================
-- 파일 경로 구조: {member_id}/before.*  ,  {member_id}/after.*
-- private 버킷이므로 재생은 프론트에서 signed URL 로 처리.
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

-- storage.objects 에 대한 정책(정책명은 storage.objects 안에서 유일해야 함) -----
drop policy if exists recordings_bucket_read_own  on storage.objects;
drop policy if exists recordings_bucket_admin_all on storage.objects;

-- 회원: 자기 폴더({member_id}/) 파일만 읽기.
-- storage.foldername(name)[1] = 경로의 첫 번째 폴더 = member_id 문자열.
create policy recordings_bucket_read_own on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 관리자: recordings 버킷 전체 읽기/쓰기(업로드·교체·삭제 포함)
create policy recordings_bucket_admin_all on storage.objects
  for all
  to authenticated
  using (bucket_id = 'recordings' and public.is_admin())
  with check (bucket_id = 'recordings' and public.is_admin());

-- =============================================================================
-- 끝. 실행 후 할 일은 커밋 메시지/PR 설명 또는 README 참고:
--   1) Google OAuth 연결   2) 관리자 계정 부트스트랩(role=admin)   3) 키 배치
-- =============================================================================
