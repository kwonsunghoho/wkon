begin;
-- 실제 파일 삭제는 Storage API만 사용한다. 이 표는 교체 후 정리 이력이다.
create table public.online_video_cleanup (
 path text primary key, state text not null default 'pending' check(state in ('pending','deleting','deleted')),
 created_at timestamptz not null default now(), retry_at timestamptz not null default now(),
 attempts integer not null default 0, lease uuid, deleted_at timestamptz
);
alter table public.online_video_cleanup enable row level security;
revoke all on public.online_video_cleanup from public,anon,authenticated;
grant all on public.online_video_cleanup to service_role;

create function public.oc_video_cleanup_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 -- 연결 변경과 삭제 예약을 직렬화한다. 삭제 예약 이후 경로 재연결은 금지한다.
 perform pg_advisory_xact_lock(74291029);
 if exists(select 1 from public.online_video_cleanup where path in (new.video_path,new.material_path) and state<>'pending') then
  raise exception 'retired_video_path';
 end if;
 if TG_OP='UPDATE' and old.video_path is distinct from new.video_path and old.video_path is not null
  and old.video_path ~ '^[a-zA-Z0-9_-]+/[0-9a-f-]{36}/video/[0-9a-f-]{36}\.(mp4|webm)$' then
  insert into public.online_video_cleanup(path) values(old.video_path) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function public.oc_video_cleanup_guard() from public,anon,authenticated;
grant execute on function public.oc_video_cleanup_guard() to service_role;
create trigger oc_video_cleanup_guard before insert or update of video_path,material_path on public.online_lessons
for each row execute function public.oc_video_cleanup_guard();

create function public.oc_claim_video_cleanup() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform pg_advisory_xact_lock(74291029);
 with candidates as (
  select q.path from public.online_video_cleanup q
  where q.state<>'deleted' and q.retry_at<=now()
   and not exists(select 1 from public.online_lessons l where l.video_path=q.path or l.material_path=q.path)
  order by q.created_at limit 5 for update skip locked
 ), claimed as (
  update public.online_video_cleanup q set state='deleting',attempts=attempts+1,
   lease=gen_random_uuid(),retry_at=now()+interval '5 minutes'
  from candidates c where q.path=c.path returning q.path,q.lease
 ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
 return result;
end $$;
revoke all on function public.oc_claim_video_cleanup() from public,anon,authenticated;
grant execute on function public.oc_claim_video_cleanup() to service_role;

create function public.oc_finish_video_cleanup(p_path text,p_lease uuid,p_success boolean) returns void
language sql security invoker set search_path='' as $$
 update public.online_video_cleanup set state=case when p_success then 'deleted' else 'deleting' end,
 deleted_at=case when p_success then now() else null end,
 retry_at=case when p_success then retry_at else now()+interval '1 minute' end
 where path=p_path and lease=p_lease and state='deleting';
$$;
revoke all on function public.oc_finish_video_cleanup(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.oc_finish_video_cleanup(text,uuid,boolean) to service_role;
commit;
