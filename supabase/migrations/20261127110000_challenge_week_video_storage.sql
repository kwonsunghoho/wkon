-- 수강 영상처럼 관리자가 서명된 TUS로 전송한다. 회원에게는 짧은 읽기 서명만 발급한다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('challenge-room-video', 'challenge-room-video', false, 2147483648, array['video/mp4', 'video/webm']);
create policy challenge_week_video_signed_only on storage.objects as restrictive
  for all to anon,authenticated using (bucket_id <> 'challenge-room-video')
  with check (bucket_id <> 'challenge-room-video');

create table challenge_room_data.video_uploads (
  id uuid primary key default gen_random_uuid(),
  round_id uuid references public.challenge_rounds(id) on delete set null,
  week_no smallint not null check (week_no in (1, 2)),
  actor_id uuid not null,
  original_name text not null,
  mime_type text not null check (mime_type in ('video/mp4','video/webm')),
  bytes bigint not null check (bytes between 1 and 2147483648),
  path text unique not null,
  expected_revision bigint not null,
  status text not null default 'pending' check (status in ('pending','cancelled','committed','deleting')),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  cleanup_lease uuid,
  retry_at timestamptz not null default now()
);
create index challenge_video_expiry on challenge_room_data.video_uploads (expires_at, retry_at);
alter table challenge_room_data.video_uploads enable row level security;

alter table challenge_room_data.week_videos
  alter column video_id drop not null,
  add column upload_id uuid unique references challenge_room_data.video_uploads(id) on delete restrict,
  add column revision bigint not null default 1,
  add constraint challenge_week_exactly_one_video check (num_nonnulls(video_id, upload_id) = 1);

-- 기존 YouTube 저장도 같은 원본 교체 및 버전 검사를 거치게 한다.
create function challenge_room_data.video_revision()
returns trigger language plpgsql set search_path = '' as $revision$
begin
  if new.video_id is not null and new.video_id is distinct from old.video_id then new.upload_id := null; end if;
  if new.video_id is distinct from old.video_id or new.upload_id is distinct from old.upload_id then
    new.revision := old.revision + 1;
  end if;
  return new;
end
$revision$;
create trigger challenge_week_source_revision before update on challenge_room_data.week_videos
  for each row execute function challenge_room_data.video_revision();

create or replace function public.challenge_room(p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $rpc$
declare result jsonb; chapter jsonb; sources jsonb;
begin
  if p_action in ('admin-list', 'admin-week-save', 'admin-save') then
    result := challenge_room_data.manage_chapters(p_action, p_data);
    if p_action <> 'admin-list' then return result; end if;
    select coalesce(jsonb_agg(
      case when v.upload_id is null then item.value || jsonb_build_object('provider','youtube')
           else (item.value - 'video_url') || jsonb_build_object('provider','storage','file_name',u.original_name)
      end order by v.week_no), '[]'::jsonb) into sources
    from jsonb_array_elements(result->'week_videos') item(value)
    join public.challenge_rounds r on r.challenge = p_data->>'challenge' and r.round = (p_data->>'round')::integer
    join challenge_room_data.week_videos v on v.round_id = r.id and v.week_no = (item.value->>'week_no')::integer
    left join challenge_room_data.video_uploads u on u.id = v.upload_id;
    return jsonb_set(result,'{week_videos}',sources);
  end if;
  result := challenge_room_data.base_rpc(p_action, p_data);
  if p_action = 'home' then return result || jsonb_build_object('server_now',now()); end if;
  if p_action = 'mission' then
    if (result#>>'{mission,eligible}')::boolean then
      select jsonb_build_object('week_no', v.week_no, 'start_seconds', c.start_seconds, 'end_seconds', c.end_seconds)
        || case when v.upload_id is null then jsonb_build_object('provider','youtube','video_id',v.video_id)
                else jsonb_build_object('provider','storage') end
      into chapter from challenge_room_data.missions m
      join challenge_room_data.mission_chapters c on c.mission_id = m.id
      join challenge_room_data.week_videos v on v.round_id = m.round_id and v.week_no = (m.day_no-1)/5+1
      where m.id = (result#>>'{mission,id}')::uuid and m.opens_at <= now();
    end if;
    return jsonb_set(result,'{mission,chapter}',coalesce(chapter,'null'::jsonb));
  end if;
  return result;
end
$rpc$;

-- Edge가 실제 로그인 세션을 확인한 뒤에만 이 함수를 호출한다.
create function public.challenge_video_media(p_user uuid, p_action text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $media$
declare
  cohort uuid; wk smallint; video_path text; rev bigint; asset uuid; ext text; mime text; file_name text;
  job challenge_room_data.video_uploads%rowtype; object_meta jsonb;
begin
  if p_user is null then raise exception 'challenge_video:forbidden' using errcode='42501'; end if;
  if p_action = 'play' then
    select u.path into video_path from challenge_room_data.missions m
    join challenge_room_data.mission_chapters c on c.mission_id = m.id
    join challenge_room_data.week_videos v on v.round_id = m.round_id and v.week_no = (m.day_no-1)/5+1
    join challenge_room_data.video_uploads u on u.id = v.upload_id and u.status = 'committed'
    where m.id = (p_data->>'id')::uuid and m.opens_at <= now() and challenge_room_data.eligible(p_user,m.round_id);
    if not found then raise exception 'challenge_video:not_found'; end if;
    return jsonb_build_object('path',video_path);
  end if;
  if not exists (select 1 from public.members where id=p_user and role='admin' and agreed_at is not null) then
    raise exception 'challenge_video:forbidden' using errcode='42501';
  end if;
  if p_action in ('admin-commit','admin-cancel') then
    select u.* into job from challenge_room_data.video_uploads u
      where u.id=(p_data->>'upload_id')::uuid and u.actor_id=p_user;
    if not found then raise exception 'challenge_video:not_found'; end if;
    cohort := job.round_id; wk := job.week_no;
  elsif p_action in ('admin-upload','admin-preview') then
    if coalesce(p_data->>'week_no','') not in ('1','2') then raise exception 'challenge_video:not_found'; end if;
    wk := (p_data->>'week_no')::smallint;
    select id into cohort from public.challenge_rounds where challenge = 'voice' and challenge = p_data->>'challenge'
      and round = (p_data->>'round')::integer;
  else raise exception 'challenge_video:not_found';
  end if;
  perform 1 from public.challenge_rounds where id=cohort for update;
  if not found then raise exception 'challenge_video:not_found'; end if;
  select v.revision,v.upload_id into rev,asset from challenge_room_data.week_videos v
    where v.round_id=cohort and v.week_no=wk;
  rev := coalesce(rev,0);
  if p_action='admin-preview' then
    select path into video_path from challenge_room_data.video_uploads where id=asset and status='committed';
    if not found then raise exception 'challenge_video:not_found'; end if;
    return jsonb_build_object('path',video_path);
  end if;
  if p_action in ('admin-commit','admin-cancel') then
    select u.* into job from challenge_room_data.video_uploads u where u.id=job.id for update;
    if not found then raise exception 'challenge_video:upload_expired'; end if;
    if p_action='admin-cancel' then
      update challenge_room_data.video_uploads set status='cancelled' where id=job.id and status='pending';
      return '{"ok":true}'::jsonb;
    end if;
    if asset=job.id and job.status='committed' then return '{"ok":true}'::jsonb; end if;
    if job.status='committed' or rev<>job.expected_revision then raise exception 'challenge_video:edit_conflict'; end if;
    if job.status<>'pending' or job.expires_at<=clock_timestamp() then raise exception 'challenge_video:upload_expired'; end if;
  end if;
  if challenge_room_data.week_video_locked(cohort,wk) then raise exception 'challenge_video:locked'; end if;
  if p_action='admin-upload' then
    file_name := btrim(p_data->>'name');
    ext := lower(substring(file_name from '\.([^.]+)$'));
    mime := case ext when 'mp4' then 'video/mp4' when 'webm' then 'video/webm' end;
    if mime is null or length(file_name)>180 or file_name ~ '[\\/[:cntrl:]]'
      or coalesce(p_data->>'contentType','') not in ('',mime)
      or jsonb_typeof(p_data->'size') is distinct from 'number'
      or coalesce(p_data->>'size','') !~ '^[1-9][0-9]{0,9}$' then
      raise exception 'challenge_video:invalid_file';
    end if;
    if (p_data->>'size')::bigint>2147483648 then raise exception 'challenge_video:invalid_file'; end if;
    asset := gen_random_uuid();
    video_path := cohort::text || '/' || wk::text || '/' || asset::text || '.' || ext;
    insert into challenge_room_data.video_uploads (id,round_id,week_no,actor_id,original_name,mime_type,bytes,path,expected_revision)
    values (asset,cohort,wk,p_user,file_name,mime,(p_data->>'size')::bigint,video_path,rev);
    return jsonb_build_object('upload_id',asset,'path',video_path,'contentType',mime);
  end if;
  select o.metadata into object_meta from storage.objects o
    where o.bucket_id='challenge-room-video' and o.name=job.path for share;
  if object_meta->>'size' is distinct from job.bytes::text
     or lower(split_part(object_meta->>'mimetype',';',1)) is distinct from job.mime_type then
    raise exception 'challenge_video:upload_incomplete';
  end if;
  insert into challenge_room_data.week_videos(round_id,week_no,video_id,upload_id) values(cohort,wk,null,job.id)
    on conflict(round_id,week_no) do update set video_id=null,upload_id=excluded.upload_id;
  update challenge_room_data.video_uploads set status='committed' where id=job.id;
  return '{"ok":true}'::jsonb;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'challenge_video:not_found';
end
$media$;
revoke all on function public.challenge_video_media(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.challenge_video_media(uuid,text,jsonb) to service_role;

-- 취소된 TUS 전송이 뒤늦게 끝날 수 있으므로 전송 수명보다 먼저 객체를 정리하지 않는다.
create table challenge_room_data.video_cleanup_tickets (
  hash bytea primary key, expires_at timestamptz not null
);
alter table challenge_room_data.video_cleanup_tickets enable row level security;
revoke all on challenge_room_data.video_uploads,challenge_room_data.video_cleanup_tickets from public,anon,authenticated;

create view challenge_room_data.unused_videos as
select u.id from challenge_room_data.video_uploads u
where u.expires_at + interval '3 hours' <= now() and u.retry_at <= now()
  and not exists (select 1 from challenge_room_data.week_videos v where v.upload_id=u.id);
revoke all on challenge_room_data.unused_videos from public,anon,authenticated;

create function challenge_room_data.video_cleanup_tick() returns void
language plpgsql security definer set search_path='' as $tick$
declare bearer text; ticket uuid;
begin
  if not pg_try_advisory_xact_lock(192718364,1127001) then return; end if;
  delete from challenge_room_data.video_cleanup_tickets where expires_at<=now();
  if exists(select 1 from challenge_room_data.video_cleanup_tickets)
     or not exists(select 1 from challenge_room_data.unused_videos) then return; end if;
  select decrypted_secret into bearer from vault.decrypted_secrets where name='monc_anon_jwt';
  if nullif(bearer,'') is null then return; end if;
  ticket:=gen_random_uuid();
  insert into challenge_room_data.video_cleanup_tickets values(sha256(convert_to(ticket::text,'UTF8')),now()+interval '3 minutes');
  perform net.http_post(url:='https://apzwauiumhmsvrgffjis.supabase.co/functions/v1/challenge-week-video',
    headers:=jsonb_build_object('content-type','application/json','apikey',bearer,'authorization','Bearer '||bearer),
    body:=jsonb_build_object('action','cleanup','token',ticket),timeout_milliseconds:=60000);
end
$tick$;

create function public.challenge_video_cleanup(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $sweep$
declare result jsonb;
begin
  if p_action='claim' then
    delete from challenge_room_data.video_cleanup_tickets
      where hash=sha256(convert_to(p_data->>'token','UTF8')) and expires_at>now();
    if not found then raise exception 'challenge_video:invalid_ticket' using errcode='42501'; end if;
    with picked as materialized (
      select u.id from challenge_room_data.video_uploads u join challenge_room_data.unused_videos x on x.id=u.id
        order by u.expires_at,u.id limit 20 for update of u skip locked
    ), claimed as (
      update challenge_room_data.video_uploads u set status='deleting',cleanup_lease=gen_random_uuid(),
        retry_at=now()+interval '10 minutes' from picked where u.id=picked.id
        returning u.id,u.path,u.cleanup_lease as lease
    ) select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from claimed c;
    return jsonb_build_object('jobs',result);
  elsif p_action='finish' then
    if (p_data->>'success')::boolean then
      delete from challenge_room_data.video_uploads u where u.id=(p_data->>'id')::uuid and u.status='deleting'
        and u.cleanup_lease=(p_data->>'lease')::uuid
        and not exists(select 1 from challenge_room_data.week_videos v where v.upload_id=u.id);
    else
      update challenge_room_data.video_uploads set retry_at=now()+interval '10 minutes',cleanup_lease=null
        where id=(p_data->>'id')::uuid and status='deleting' and cleanup_lease=(p_data->>'lease')::uuid;
    end if;
    return jsonb_build_object('ok',found);
  end if;
  raise exception 'challenge_video:not_found';
end
$sweep$;
revoke all on all functions in schema challenge_room_data from public,anon,authenticated;
revoke all on function public.challenge_video_cleanup(text,jsonb) from public,anon,authenticated;
grant execute on function public.challenge_video_cleanup(text,jsonb) to service_role;
select cron.schedule('challenge-room-unused-video-cleanup','17 * * * *','select challenge_room_data.video_cleanup_tick()');
