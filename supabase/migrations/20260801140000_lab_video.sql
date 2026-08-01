-- ============================================================================
-- 연구실 자료 — 외부 링크(영상관 유튜브) 지원 (2026-08-01)
-- ============================================================================
-- 영상관은 파일이 아니라 유튜브 링크로 올린다(오너 확인). 그런데 첫 설계는 파일 업로드
-- 전용이라 storage_path 가 NOT NULL 이었다 — 링크만 있는 자료를 넣을 수 없었다.
--
-- ⚠️ external_url 은 목록 RPC 가 반환하지 않는다. 유튜브 '미등록' 영상은 **링크가 곧
--    접근권**이라, 목록에 실어 보내면 비회원도 그대로 볼 수 있다. 회원 확인 뒤
--    lab-file 함수만 링크를 돌려준다(파일과 같은 문을 쓴다).
-- ⚠️ 그래서 썸네일도 목록에 넣지 않는다 — 유튜브 썸네일 주소에 영상 id 가 들어 있어
--    썸네일을 노출하면 링크를 노출한 것과 같다.
-- ============================================================================

alter table public.lab_resources alter column storage_path drop not null;
alter table public.lab_resources add column if not exists external_url text;
alter table public.lab_resources add column if not exists duration_sec integer;

-- 파일이든 링크든 하나는 있어야 한다
alter table public.lab_resources drop constraint if exists lab_resources_source_required;
alter table public.lab_resources add constraint lab_resources_source_required
  check (storage_path is not null or external_url is not null);

-- ── 목록 RPC 재생성 ─────────────────────────────────────────────────────────
-- 반환 컬럼이 늘어 create or replace 로는 안 바뀐다(반환 타입 변경 불가) — drop 후 생성.
-- is_link: 외부 링크 자료인지(화면에서 아이콘·문구를 바꾸는 데만 쓴다. 링크 자체는 안 준다)
drop function if exists public.lab_resource_list(text, text);

create or replace function public.lab_resource_list(
  p_shelf text default 'airline',
  p_airline text default null
)
returns table (
  id uuid, shelf text, airline text, title text, summary text, doc_type text,
  file_ext text, file_size bigint, needs_password boolean, delivery text,
  is_link boolean, duration_sec integer, published_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.shelf, r.airline, r.title, r.summary, r.doc_type,
         r.file_ext, r.file_size, (r.access = 'password'), r.delivery,
         (r.external_url is not null), r.duration_sec,
         coalesce(r.published_at, r.created_at)
  from public.lab_resources r
  where r.published
    and r.shelf = p_shelf
    and (p_airline is null or r.airline = p_airline)
  order by coalesce(r.published_at, r.created_at) desc
$$;

grant execute on function public.lab_resource_list(text, text) to anon, authenticated;
