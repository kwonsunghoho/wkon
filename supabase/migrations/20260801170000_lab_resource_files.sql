-- ============================================================================
-- 연구실 자료 — 자료 하나에 파일 여러 개 (2026-08-01)
-- ============================================================================
-- 오너: **"2개를 올려도 하나씩 따로따로 올라가는데? 상, 하편같은것도 다 이렇게
--        따로따로 올라가는거야?"** → 오너 확정: **고른 파일은 항상 한 자료로 묶는다.**
--
-- 첫 구조는 자료 1건 = 파일 1개(`lab_resources.storage_path` 한 칸)였다. 상·하편처럼
-- 한 자료가 파일 여러 개인 경우를 담을 수 없어, 값도 구매도 쪼개졌다.
-- 이제 파일은 `lab_resource_files` 가 갖고, **값·구매는 자료 단위 그대로**다
-- (한 번 사면 그 자료의 파일 전부를 받는다).
--
-- ⚠️ 이 표에도 회원 읽기 정책을 만들지 않는다 — `storage_path` 가 들어 있다.
--    파일로 가는 문은 여전히 `lab-file` Edge Function 뿐이다.
-- ⚠️ `lab_resources.storage_path` 는 백필 뒤 **레거시**다. 새 코드는 이 표만 본다.
--    컬럼을 지우지는 않는다(옛 함수·기록이 참조할 수 있다).
-- ============================================================================

create extension if not exists pgcrypto;

-- ── 1. 파일 표 ──────────────────────────────────────────────────────────────
create table if not exists public.lab_resource_files (
  id           uuid primary key default gen_random_uuid(),
  resource_id  uuid not null references public.lab_resources(id) on delete cascade,
  storage_path text not null,
  label        text,        -- 화면에 보이는 이름(비면 파일명). 예: '상편' · '하편'
  file_ext     text,
  file_size    bigint,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

comment on table public.lab_resource_files is
  '자료 한 건에 붙는 파일들. 값·구매는 자료 단위이고 이 표는 "무엇을 받을 수 있는가"만 정한다.';
comment on column public.lab_resource_files.label is
  '학생 화면에 보이는 이름. 비면 파일명을 쓴다. 상·하편처럼 순서가 있으면 sort_order 로 정렬한다.';

create index if not exists lab_resource_files_res_idx
  on public.lab_resource_files (resource_id, sort_order, created_at);

alter table public.lab_resource_files enable row level security;

drop policy if exists lab_files_rows_admin_all on public.lab_resource_files;

-- 관리자만. 회원 읽기 정책을 만들지 말 것(경로가 그대로 노출된다).
create policy lab_files_rows_admin_all on public.lab_resource_files
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ── 2. 기존 파일 백필 ───────────────────────────────────────────────────────
-- 지금까지 올린 자료(파일 1개짜리)를 그대로 옮긴다. 재실행해도 중복되지 않는다.
insert into public.lab_resource_files (resource_id, storage_path, label, file_ext, file_size, sort_order)
select r.id, r.storage_path, null, r.file_ext, r.file_size, 0
from public.lab_resources r
where r.storage_path is not null
  and not exists (
    select 1 from public.lab_resource_files f
    where f.resource_id = r.id and f.storage_path = r.storage_path
  );


-- ── 3. '파일이 있어야 한다' 제약 완화 ───────────────────────────────────────
-- 파일 유무는 이제 lab_resource_files 가 정한다 — storage_path 는 비어 있어도 된다.
-- (영상은 계속 external_url 로 판별한다.)
alter table public.lab_resources drop constraint if exists lab_resources_source_required;


-- ── 4. 목록 RPC 재생성 — file_count 추가 ────────────────────────────────────
-- ⚠️ 이 파일이 lab_resource_list() 의 최종 정의다(video_id + price + owned + file_count).
--    140000·150000·160000 을 이 파일 뒤에 실행하면 file_count 가 사라진다.
drop function if exists public.lab_resource_list(text, text);

create or replace function public.lab_resource_list(
  p_shelf text default 'airline',
  p_airline text default null
)
returns table (
  id uuid, shelf text, airline text, title text, summary text, doc_type text,
  file_ext text, file_size bigint, needs_password boolean, delivery text,
  is_link boolean, duration_sec integer, video_id text,
  price integer, owned boolean, file_count integer,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.shelf, r.airline, r.title, r.summary, r.doc_type,
         r.file_ext, r.file_size, (r.access = 'password'), r.delivery,
         (r.external_url is not null), r.duration_sec,
         -- 영상 썸네일용 id(20260801150000_lab_thumbs 와 같은 정의)
         coalesce(
           substring(r.external_url from '[?&]v=([A-Za-z0-9_-]{11})'),
           substring(r.external_url from 'youtu\.be/([A-Za-z0-9_-]{11})'),
           substring(r.external_url from '/embed/([A-Za-z0-9_-]{11})'),
           substring(r.external_url from '/shorts/([A-Za-z0-9_-]{11})'),
           substring(r.external_url from '/live/([A-Za-z0-9_-]{11})')
         ),
         r.price,
         exists (
           select 1 from public.lab_purchases p
           where p.resource_id = r.id and p.user_id = auth.uid()
         ),
         -- 몇 개를 받게 되는지. 화면이 '파일 2개'를 미리 알려 준다.
         -- ⚠️ 경로·이름은 내보내지 않는다(파일로 가는 문은 lab-file 뿐).
         (select count(*)::integer from public.lab_resource_files f where f.resource_id = r.id),
         coalesce(r.published_at, r.created_at)
  from public.lab_resources r
  where r.published
    and r.shelf = p_shelf
    and (p_airline is null or r.airline = p_airline)
  order by coalesce(r.published_at, r.created_at) desc
$$;

grant execute on function public.lab_resource_list(text, text) to anon, authenticated;


-- ============================================================================
-- 롤백 (백필된 파일 행이 사라지므로 실제 운영 뒤에는 쓰지 말 것)
-- ============================================================================
-- drop table if exists public.lab_resource_files;
-- (목록 RPC 는 20260801160000 의 정의로 되돌린다)
