-- ============================================================================
-- 연구실 자료실 — 파일 보관·열람 (2026-08-01)
-- ============================================================================
-- 오너 요구: ① 회원만 다운로드 ② 특정 자료는 비밀번호 ③ 무분별한 재배포 방지.
-- 오너 확정(2026-08-01): 자료마다 '다운로드 허용/열람 전용'을 섞어 쓴다 + 워터마크 찍는다.
--
-- ⚠️ 설계의 핵심 — 파일을 공개 버킷에 두지 않는다.
--    공개 버킷은 주소만 알면 로그인 여부와 무관하게 받아진다. 그래서 버킷은 비공개고,
--    브라우저는 파일 경로를 절대 받지 못한다(목록 RPC 가 storage_path 를 반환하지 않음).
--    실제 파일 접근은 lab-file Edge Function 이 회원·비밀번호를 확인한 뒤 발급하는
--    60초짜리 서명 URL 뿐이다.
-- ⚠️ lab_resources 본문에는 RLS 정책을 '하나도' 만들지 않는다 = 아무도 직접 못 읽는다.
--    비밀번호 해시와 파일 경로가 그 안에 있기 때문이다. 정책을 추가하지 말 것.
-- ⚠️ 비밀번호 대조 함수는 service_role 에게만 준다 — 회원에게 주면 브라우저에서
--    수천 번 호출해 맞출 때까지 시도할 수 있다.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ── 자료 ────────────────────────────────────────────────────────────────────
create table if not exists public.lab_resources (
  id           uuid primary key default gen_random_uuid(),
  -- 서가: airline(항공사 자료실) | video | question | report | calendar
  shelf        text not null default 'airline',
  airline      text,                         -- 항공사 슬러그(자료실에서만 씀)
  title        text not null,
  summary      text,
  doc_type     text,                         -- '한 장 요약' 같은 자료 유형 라벨
  storage_path text not null,                -- lab-files 버킷 내 경로 — 브라우저에 절대 노출 금지
  file_ext     text,
  file_size    bigint,
  -- 누가 여는가: member(로그인만) | password(로그인 + 비밀번호)
  access       text not null default 'member' check (access in ('member','password')),
  -- 어떻게 여는가: download(파일 받기) | view(화면 열람 전용)
  delivery     text not null default 'download' check (delivery in ('download','view')),
  password_hash text,                        -- crypt() 해시. access='password' 일 때만 채운다
  watermark    boolean not null default true, -- 받는 사람 표시(PDF 만 적용)
  published    boolean not null default false,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint lab_resources_pw_required
    check (access <> 'password' or password_hash is not null)
);

create index if not exists lab_resources_shelf_idx
  on public.lab_resources (shelf, published, published_at desc);
create index if not exists lab_resources_airline_idx
  on public.lab_resources (airline) where airline is not null;

alter table public.lab_resources enable row level security;
-- 정책 없음 = service_role(Edge Function) 외에는 아무도 못 읽는다. 위 주석 참조.

-- ── 열람·다운로드 기록 ──────────────────────────────────────────────────────
-- 유출 추적의 원장. kind: download | view | fail(비밀번호 틀림)
create table if not exists public.lab_downloads (
  id          bigserial primary key,
  resource_id uuid not null references public.lab_resources(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null default 'download' check (kind in ('download','view','fail')),
  ua          text,
  created_at  timestamptz not null default now()
);
create index if not exists lab_downloads_user_idx on public.lab_downloads (user_id, created_at desc);
create index if not exists lab_downloads_res_idx  on public.lab_downloads (resource_id, created_at desc);
-- 비밀번호 연속 실패를 셀 때 쓰는 인덱스(잠금 판정)
create index if not exists lab_downloads_fail_idx
  on public.lab_downloads (user_id, resource_id, created_at desc) where kind = 'fail';

alter table public.lab_downloads enable row level security;
-- 정책 없음 = 기록 열람은 admin(service_role) 만. 회원이 남의 열람 이력을 보게 하지 말 것.

-- ── 목록 ────────────────────────────────────────────────────────────────────
-- 목록은 비회원도 본다(원장 화면 문구: "목록은 누구나 볼 수 있어요").
-- 대신 storage_path·password_hash 는 반환하지 않는다 — 파일로 가는 길은 Edge Function 뿐.
create or replace function public.lab_resource_list(
  p_shelf text default 'airline',
  p_airline text default null
)
returns table (
  id uuid, shelf text, airline text, title text, summary text, doc_type text,
  file_ext text, file_size bigint, needs_password boolean, delivery text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.shelf, r.airline, r.title, r.summary, r.doc_type,
         r.file_ext, r.file_size, (r.access = 'password'), r.delivery,
         coalesce(r.published_at, r.created_at)
  from public.lab_resources r
  where r.published
    and r.shelf = p_shelf
    and (p_airline is null or r.airline = p_airline)
  order by coalesce(r.published_at, r.created_at) desc
$$;

grant execute on function public.lab_resource_list(text, text) to anon, authenticated;

-- ── 서가별 집계 ─────────────────────────────────────────────────────────────
-- 허브(lab.html) 목차 5줄과 원장(lab-archive.html) 현황 스트립의 숫자가 여기서 나온다.
-- 이 함수가 붙기 전까지 그 숫자는 화면에 박아둔 예시값이다.
create or replace function public.lab_shelf_counts()
returns table (shelf text, n bigint, last_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.shelf, count(*)::bigint, max(coalesce(r.published_at, r.created_at))
  from public.lab_resources r
  where r.published
  group by r.shelf
$$;

grant execute on function public.lab_shelf_counts() to anon, authenticated;

-- ── 비밀번호 대조 ───────────────────────────────────────────────────────────
-- ⚠️ service_role 전용. authenticated 에게 주면 브라우저에서 무제한 시도가 가능해진다.
create or replace function public.lab_check_password(p_id uuid, p_pw text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.lab_resources
    where id = p_id
      and password_hash is not null
      and password_hash = crypt(p_pw, password_hash)
  )
$$;

revoke all on function public.lab_check_password(uuid, text) from public, anon, authenticated;

-- 비밀번호를 저장할 때 쓰는 해시 함수(admin 이 평문을 넣지 않도록).
-- ⚠️ 평문 비밀번호를 password_hash 에 그대로 넣지 말 것.
create or replace function public.lab_set_password(p_id uuid, p_pw text)
returns void
language sql
volatile
security definer
set search_path = public, extensions
as $$
  update public.lab_resources
  set password_hash = case when p_pw is null or p_pw = '' then null else crypt(p_pw, gen_salt('bf', 10)) end,
      access = case when p_pw is null or p_pw = '' then 'member' else 'password' end,
      updated_at = now()
  where id = p_id
$$;

revoke all on function public.lab_set_password(uuid, text) from public, anon, authenticated;

-- ── 파일 버킷 ───────────────────────────────────────────────────────────────
-- 비공개(public=false). 워터마크 처리본은 wm/ 아래에 잠깐 놓였다 지워진다.
insert into storage.buckets (id, name, public)
values ('lab-files', 'lab-files', false)
on conflict (id) do nothing;
-- storage.objects 정책도 만들지 않는다 = service_role 만 접근. 서명 URL 로만 열린다.
