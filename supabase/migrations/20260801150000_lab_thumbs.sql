-- ============================================================================
-- 연구실 영상관 — 유튜브 썸네일 (2026-08-01)
-- ============================================================================
-- 오너: "영상관에 올리니까 썸네일이 와줘야하는데 이렇게 파일명만 달랑 올라가네?
--        이러면 아무도 안보지. **영상 아이디는 노출해도 되니까** 유튜브 썸네일을
--        그대로 가져오는 방향으로 설계해줘라."
--
-- 그래서 목록이 영상 id 를 그대로 내주고, 화면은 i.ytimg.com 주소를 조립해 쓴다.
-- (처음엔 id 노출을 피하려고 썸네일을 우리 버킷에 복사하는 안을 만들었으나,
--  단계가 많고 복사가 실패하면 썸네일이 아예 없어서 오너가 이 방향으로 정했다.)
--
-- ⚠️ 이 결정의 의미를 알고 쓴다: 영상 id 가 목록에 실리면 **유튜브 일부공개(미등록)
--    영상도 id 를 아는 사람은 볼 수 있다**(회원 여부와 무관). 영상에 남는 통제는
--    '누가 눌러 봤는지' 기록뿐이다. 정말 새면 안 되는 내용은 유튜브가 아니라
--    파일(비공개 버킷 + 워터마크)로 올린다.
-- ⚠️ 링크 전체(external_url)는 계속 반환하지 않는다 — 재생은 lab-file 을 거치게 둬야
--    열람 기록이 남는다. 목록에 나가는 건 썸네일을 만들 id 뿐이다.
-- ============================================================================

drop function if exists public.lab_resource_list(text, text);

create or replace function public.lab_resource_list(
  p_shelf text default 'airline',
  p_airline text default null
)
returns table (
  id uuid, shelf text, airline text, title text, summary text, doc_type text,
  file_ext text, file_size bigint, needs_password boolean, delivery text,
  is_link boolean, duration_sec integer, video_id text, published_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.shelf, r.airline, r.title, r.summary, r.doc_type,
         r.file_ext, r.file_size, (r.access = 'password'), r.delivery,
         (r.external_url is not null), r.duration_sec,
         -- admin 은 항상 watch?v= 로 정규화해 저장하지만, 손으로 넣은 주소도 받아낸다
         coalesce(
           substring(r.external_url from '[?&]v=([A-Za-z0-9_-]{11})'),
           substring(r.external_url from 'youtu\.be/([A-Za-z0-9_-]{11})'),
           substring(r.external_url from '/embed/([A-Za-z0-9_-]{11})'),
           substring(r.external_url from '/shorts/([A-Za-z0-9_-]{11})'),
           substring(r.external_url from '/live/([A-Za-z0-9_-]{11})')
         ),
         coalesce(r.published_at, r.created_at)
  from public.lab_resources r
  where r.published
    and r.shelf = p_shelf
    and (p_airline is null or r.airline = p_airline)
  order by coalesce(r.published_at, r.created_at) desc
$$;

grant execute on function public.lab_resource_list(text, text) to anon, authenticated;

-- 참고: 잠깐 검토했던 '썸네일 복사' 방식은 `lab-thumbs` 버킷과 `lab_resources.thumb_path`
-- 컬럼을 썼다. 이 프로젝트에는 만든 적이 없어(2026-08-01 확인) 치울 것도 없다.
-- 혹시 다른 환경에 남아 있으면 아래를 함께 실행한다:
--   drop policy if exists lab_thumbs_public_read on storage.objects;
--   drop policy if exists lab_thumbs_admin_all   on storage.objects;
--   alter table public.lab_resources drop column if exists thumb_path;
