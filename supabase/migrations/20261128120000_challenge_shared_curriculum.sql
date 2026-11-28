-- 종목 공통 원본과 운영 일정을 분리한다. 이미 배정된 기수의 콘텐츠는 복사본으로 유지한다.
create table challenge_room_data.curricula (
  challenge text primary key check (challenge_room_data.supports_challenge(challenge)),
  revision bigint not null default 0 check (revision >= 0)
);
create table challenge_room_data.curriculum_sources (
  challenge text not null references challenge_room_data.curricula(challenge),
  week_no smallint not null check (week_no in (1,2)),
  upload_id uuid not null references challenge_room_data.video_uploads(id) on delete restrict,
  revision bigint not null default 1 check (revision > 0),
  primary key (challenge,week_no)
);
create index curriculum_sources_upload on challenge_room_data.curriculum_sources(upload_id);
create table challenge_room_data.curriculum_days (
  challenge text not null references challenge_room_data.curricula(challenge),
  day_no smallint not null check (day_no between 1 and 10),
  title text not null check (length(btrim(title)) between 1 and 100),
  body text not null check (length(btrim(body)) between 1 and 2000),
  start_seconds integer not null check (start_seconds >= 0),
  end_seconds integer not null check (end_seconds > start_seconds and end_seconds <= 86400),
  primary key (challenge,day_no)
);
create table challenge_room_data.curriculum_schedules (
  round_id uuid primary key references public.challenge_rounds(id) on delete restrict,
  start_date date not null check (extract(isodow from start_date)=1),
  revision bigint not null check (revision > 0)
);
alter table challenge_room_data.curricula enable row level security;
alter table challenge_room_data.curriculum_sources enable row level security;
alter table challenge_room_data.curriculum_days enable row level security;
alter table challenge_room_data.curriculum_schedules enable row level security;
revoke all on challenge_room_data.curricula,challenge_room_data.curriculum_sources,
  challenge_room_data.curriculum_days,challenge_room_data.curriculum_schedules from public,anon,authenticated;

alter table challenge_room_data.video_uploads add column curriculum_challenge text
  references challenge_room_data.curricula(challenge),
  add constraint challenge_video_one_owner check (curriculum_challenge is null or round_id is null);
alter table challenge_room_data.week_videos drop constraint week_videos_upload_id_key;
create index challenge_week_videos_upload on challenge_room_data.week_videos(upload_id) where upload_id is not null;

-- 해당 종목·주차에서 딱 하나로 특정되는 기존 비공개 원본만 별칭으로 연결한다.
-- 신규 영상, 기수, 미션, 예약은 만들지 않는다. 서로 다른 기존 원본은 운영자가 선택한다.
with candidates as materialized (
  select r.challenge,v.week_no,(array_agg(v.upload_id))[1] as upload_id
  from challenge_room_data.week_videos v join public.challenge_rounds r on r.id=v.round_id
  left join challenge_room_data.video_uploads u on u.id=v.upload_id
  where challenge_room_data.supports_challenge(r.challenge) group by r.challenge,v.week_no
  having bool_and(v.upload_id is not null and u.status='committed') and count(distinct v.upload_id)=1
), headers as (
  insert into challenge_room_data.curricula(challenge,revision) select distinct challenge,1 from candidates
  returning challenge
)
insert into challenge_room_data.curriculum_sources(challenge,week_no,upload_id)
select c.challenge,c.week_no,c.upload_id from candidates c join headers h on h.challenge=c.challenge;

-- 기수 복사본이나 공통 원본에 쓰이는 영상은 정리 대상에 포함하지 않는다.
create or replace view challenge_room_data.unused_videos as
select u.id from challenge_room_data.video_uploads u
where u.expires_at + interval '3 hours' <= now() and u.retry_at <= now()
  and not exists(select 1 from challenge_room_data.week_videos v where v.upload_id=u.id)
  and not exists(select 1 from challenge_room_data.curriculum_sources s where s.upload_id=u.id);

-- 배정 시점에 10개 DAY와 2개 원본이 모두 있어야 한다. 이후 기존 개별 편집 경로에서도 보호한다.
create function challenge_room_data.protect_curriculum_snapshot() returns trigger
language plpgsql set search_path='' as $protect$
declare cohort uuid; starts date;
begin
  if tg_table_name='mission_chapters' then
    select m.round_id into cohort from challenge_room_data.missions m where m.id=old.mission_id;
  else
    cohort:=old.round_id;
  end if;
  select s.start_date into starts from challenge_room_data.curriculum_schedules s where s.round_id=cohort;
  if found then
    if tg_table_name='missions' and tg_op='UPDATE' then
      if (to_jsonb(new)-array['release_date','opens_at'])=(to_jsonb(old)-array['release_date','opens_at'])
        and new.release_date is distinct from old.release_date
        and new.release_date=starts+(new.day_no-1)::integer+(case when new.day_no>5 then 2 else 0 end)
        and old.opens_at>clock_timestamp() then return new; end if;
    end if;
    raise exception 'challenge_room:locked';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$protect$;
create trigger curriculum_locked_mission before update or delete on challenge_room_data.missions
  for each row execute function challenge_room_data.protect_curriculum_snapshot();
create trigger curriculum_locked_chapter before update or delete on challenge_room_data.mission_chapters
  for each row execute function challenge_room_data.protect_curriculum_snapshot();
create trigger curriculum_locked_source before update or delete on challenge_room_data.week_videos
  for each row execute function challenge_room_data.protect_curriculum_snapshot();

create or replace function challenge_room_data.week_video_locked(p_round uuid,p_week smallint)
returns boolean language sql volatile set search_path='' as $lock$
  select exists(select 1 from challenge_room_data.curriculum_schedules s where s.round_id=p_round)
    or exists(select 1 from challenge_room_data.missions m join challenge_room_data.mission_chapters c on c.mission_id=m.id
      where m.round_id=p_round and (m.day_no-1)/5+1=p_week and m.opens_at<=clock_timestamp())
$lock$;

create function challenge_room_data.curriculum_read(p_challenge text,p_round uuid)
returns jsonb language sql stable set search_path='' as $read$
  with days as (
    select coalesce(jsonb_agg(jsonb_build_object('day_no',d.day_no,'title',d.title,'body',d.body,
      'chapter_start_seconds',d.start_seconds,'chapter_end_seconds',d.end_seconds) order by d.day_no),'[]'::jsonb) as rows
    from challenge_room_data.curriculum_days d where d.challenge=p_challenge
  ), sources as (
    select coalesce(jsonb_agg(jsonb_build_object('week_no',s.week_no,'provider','storage',
      'file_name',u.original_name,'revision',s.revision) order by s.week_no),'[]'::jsonb) as rows
    from challenge_room_data.curriculum_sources s join challenge_room_data.video_uploads u on u.id=s.upload_id
    where s.challenge=p_challenge and u.status='committed'
  )
  select jsonb_build_object(
    'revision',coalesce((select h.revision from challenge_room_data.curricula h where h.challenge=p_challenge),0),
    'days',days.rows,'week_videos',sources.rows,'ready',jsonb_array_length(days.rows)=10 and jsonb_array_length(sources.rows)=2,
    'round_schedule',case when p_round is not null then jsonb_build_object(
      'state',case when assigned.round_id is not null then 'scheduled'
        when exists(select 1 from challenge_room_data.missions m where m.round_id=p_round)
          or exists(select 1 from challenge_room_data.week_videos v left join challenge_room_data.curriculum_sources s
             on s.challenge=p_challenge and s.week_no=v.week_no
             where v.round_id=p_round and (v.upload_id is null or v.upload_id is distinct from s.upload_id))
          then 'manual' else 'empty' end,
      'start_date',assigned.start_date,'revision',assigned.revision) end)
  from days cross join sources left join challenge_room_data.curriculum_schedules assigned on assigned.round_id=p_round
$read$;

-- 수동 배정과 모집 자동 배정은 기수 → 커리큘럼 순서로 잠그고 동일한 복사 절차를 쓴다.
create function challenge_room_data.assign_curriculum(p_round uuid,first_day date,expected bigint,automatic boolean)
returns jsonb language plpgsql set search_path='' as $assign$
declare
  cohort public.challenge_rounds%rowtype; assigned challenge_room_data.curriculum_schedules%rowtype;
  version bigint; inserted_count integer;
begin
  select r.* into cohort from public.challenge_rounds r where r.id=p_round for update;
  if not found or challenge_room_data.supports_challenge(cohort.challenge) is not true then raise exception 'challenge_curriculum:not_found'; end if;
  select s.* into assigned from challenge_room_data.curriculum_schedules s where s.round_id=cohort.id;
  if found then
    if not automatic and (assigned.start_date<>first_day or assigned.revision<>expected) then raise exception 'challenge_curriculum:schedule_conflict'; end if;
    return jsonb_build_object('state','scheduled','start_date',assigned.start_date,'revision',assigned.revision,'mission_count',10,'idempotent',true);
  end if;
  select h.revision into version from challenge_room_data.curricula h where h.challenge=cohort.challenge for update;
  version:=coalesce(version,0);
  if not automatic and version<>expected then raise exception 'challenge_curriculum:edit_conflict'; end if;
  if first_day is null or extract(isodow from first_day)<>1 or (first_day::timestamp at time zone 'Asia/Seoul')<=clock_timestamp()
    or first_day<cohort.program_start then raise exception 'challenge_curriculum:bad_schedule'; end if;
  if exists(select 1 from challenge_room_data.missions m where m.round_id=cohort.id) or exists(
    select 1 from challenge_room_data.week_videos v left join challenge_room_data.curriculum_sources s
      on s.challenge=cohort.challenge and s.week_no=v.week_no where v.round_id=cohort.id
      and (v.upload_id is null or v.upload_id is distinct from s.upload_id)) then
    if automatic then return null; end if;
    raise exception 'challenge_curriculum:schedule_conflict';
  end if;
  if (select count(*) from challenge_room_data.curriculum_days d where d.challenge=cohort.challenge)<>10
    or (select count(*) from challenge_room_data.curriculum_sources s join challenge_room_data.video_uploads u
      on u.id=s.upload_id and u.status='committed' where s.challenge=cohort.challenge)<>2 then
    if automatic then return null; end if;
    raise exception 'challenge_curriculum:incomplete';
  end if;
  insert into challenge_room_data.week_videos(round_id,week_no,upload_id)
    select cohort.id,s.week_no,s.upload_id from challenge_room_data.curriculum_sources s where s.challenge=cohort.challenge
    on conflict(round_id,week_no) do nothing;
  with inserted as (
    insert into challenge_room_data.missions(round_id,day_no,release_date,title,body)
    select cohort.id,d.day_no,first_day+(d.day_no-1)::integer+(case when d.day_no>5 then 2 else 0 end),d.title,d.body
    from challenge_room_data.curriculum_days d where d.challenge=cohort.challenge returning id,day_no
  )
  insert into challenge_room_data.mission_chapters(mission_id,start_seconds,end_seconds)
    select i.id,d.start_seconds,d.end_seconds from inserted i join challenge_room_data.curriculum_days d
      on d.challenge=cohort.challenge and d.day_no=i.day_no;
  get diagnostics inserted_count=row_count;
  if inserted_count<>10 then raise exception 'challenge_curriculum:incomplete'; end if;
  insert into challenge_room_data.curriculum_schedules(round_id,start_date,revision) values(cohort.id,first_day,version);
  -- 배정표를 먼저 기록해야 최초 개강일 확정 트리거가 같은 열 개를 다시 만들지 않는다.
  if cohort.program_start is null then update public.challenge_rounds set program_start=first_day where id=cohort.id; end if;
  return jsonb_build_object('state','scheduled','start_date',first_day,'revision',version,'mission_count',10,'idempotent',false);
end
$assign$;

create function challenge_room_data.first_mission_monday(p_day date)
returns date language sql immutable strict set search_path='' as $monday$
  select p_day + (8-extract(isodow from p_day)::integer)%7
$monday$;

-- 주차 원본을 배정한 뒤 첫 공개 전이라면 날짜만 움직인다. 발송 큐가 같은 시각에 작성되지 않게 한다.
create function challenge_room_data.move_curriculum(p_round uuid,p_start date)
returns void language plpgsql set search_path='' as $move$
declare old_start date; day_row record;
begin
  select s.start_date into strict old_start from challenge_room_data.curriculum_schedules s where s.round_id=p_round for update;
  perform pg_advisory_xact_lock(192718364,1126001);
  perform 1 from challenge_room_data.missions m where m.round_id=p_round order by m.day_no for update;
  if p_start is null or (p_start::timestamp at time zone 'Asia/Seoul')<=clock_timestamp()
    or (old_start::timestamp at time zone 'Asia/Seoul')<=clock_timestamp()
    or exists(select 1 from challenge_room_data.missions m left join challenge_room_data.push_deliveries j on j.mission_id=m.id
      where m.round_id=p_round and (m.opens_at<=clock_timestamp() or j.id is not null))
    then raise exception 'challenge_curriculum:schedule_locked'; end if;
  if old_start=p_start then return; end if;
  update challenge_room_data.curriculum_schedules set start_date=p_start where round_id=p_round;
  for day_row in select m.id,m.day_no from challenge_room_data.missions m where m.round_id=p_round
    order by case when p_start>old_start then -m.day_no else m.day_no end
  loop
    update challenge_room_data.missions set release_date=p_start+(day_row.day_no-1)::integer+
      case when day_row.day_no>5 then 2 else 0 end where id=day_row.id;
  end loop;
  if (old_start::timestamp at time zone 'Asia/Seoul')<=clock_timestamp() then raise exception 'challenge_curriculum:schedule_locked'; end if;
end
$move$;

create function challenge_room_data.schedule_new_round()
returns trigger language plpgsql security definer set search_path='' as $start$
declare assigned_date date;
begin
  if tg_op='UPDATE' then
    if new.program_start is not distinct from old.program_start and new.challenge=old.challenge and new.round=old.round then return new; end if;
    select s.start_date into assigned_date from challenge_room_data.curriculum_schedules s where s.round_id=old.id;
    if found then
      if new.challenge is distinct from old.challenge or new.round is distinct from old.round or new.program_start is null
        or new.program_start<=(clock_timestamp() at time zone 'Asia/Seoul')::date then
        raise exception 'challenge_curriculum:schedule_locked';
      end if;
      perform challenge_room_data.move_curriculum(new.id,challenge_room_data.first_mission_monday(new.program_start));
      return new;
    end if;
    if old.program_start is not null or new.program_start is null then return new; end if;
  end if;
  if challenge_room_data.supports_challenge(new.challenge) is true
    and new.program_start>(clock_timestamp() at time zone 'Asia/Seoul')::date then
    perform challenge_room_data.assign_curriculum(new.id,challenge_room_data.first_mission_monday(new.program_start),null,true);
  end if;
  return new;
end
$start$;
create trigger challenge_round_curriculum_schedule after insert or update of program_start,challenge,round on public.challenge_rounds
  for each row execute function challenge_room_data.schedule_new_round();

create function public.challenge_curriculum(p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $admin$
declare
  kind text:=p_data->>'challenge'; cohort public.challenge_rounds%rowtype;
  old_day challenge_room_data.curriculum_days%rowtype; day_value integer; begin_sec integer; end_sec integer;
  day_title text:=btrim(p_data->>'title'); day_body text:=btrim(p_data->>'body');
  version bigint; expected bigint; first_day date;
begin
  if auth.uid() is null or public.is_admin() is not true
    or not exists(select 1 from public.members where id=auth.uid() and agreed_at is not null)
    then raise exception 'challenge_curriculum:forbidden' using errcode='42501'; end if;
  if challenge_room_data.supports_challenge(kind) is not true then raise exception 'challenge_curriculum:not_found'; end if;
  if p_action='admin-curriculum' then
    if p_data ? 'round' then
      select r.* into cohort from public.challenge_rounds r where r.challenge=kind and r.round=(p_data->>'round')::integer;
      if not found then raise exception 'challenge_curriculum:not_found'; end if;
    end if;
    return challenge_room_data.curriculum_read(kind,cohort.id);
  end if;
  if p_action not in ('admin-curriculum-save','admin-curriculum-schedule') or p_action is null
    or coalesce(p_data->>'expected_revision','') !~ '^(0|[1-9][0-9]{0,17})$' then
    raise exception 'challenge_curriculum:invalid_input'; end if;
  expected:=(p_data->>'expected_revision')::bigint;
  if p_action='admin-curriculum-schedule' then
    if coalesce(p_data->>'start_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'challenge_curriculum:bad_schedule'; end if;
    begin first_day:=(p_data->>'start_date')::date;
    exception when datetime_field_overflow or invalid_datetime_format then raise exception 'challenge_curriculum:bad_schedule'; end;
    select r.id into cohort.id from public.challenge_rounds r where r.challenge=kind and r.round=(p_data->>'round')::integer;
    return challenge_room_data.assign_curriculum(cohort.id,first_day,expected,false);
  end if;
  insert into challenge_room_data.curricula(challenge) values(kind) on conflict do nothing;
  select h.revision into strict version from challenge_room_data.curricula h where h.challenge=kind for update;
  if p_action='admin-curriculum-save' then
    if coalesce(p_data->>'day_no','') !~ '^([1-9]|10)$' or coalesce(length(day_title),0) not between 1 and 100
      or coalesce(length(day_body),0) not between 1 and 2000 then raise exception 'challenge_curriculum:invalid_input'; end if;
    if jsonb_typeof(p_data->'chapter_start_seconds') is distinct from 'number'
      or jsonb_typeof(p_data->'chapter_end_seconds') is distinct from 'number'
      or (p_data->>'chapter_start_seconds') !~ '^(0|[1-9][0-9]{0,4})$'
      or (p_data->>'chapter_end_seconds') !~ '^[1-9][0-9]{0,4}$' then raise exception 'challenge_curriculum:bad_chapter'; end if;
    day_value:=(p_data->>'day_no')::integer; begin_sec:=(p_data->>'chapter_start_seconds')::integer; end_sec:=(p_data->>'chapter_end_seconds')::integer;
    if end_sec<=begin_sec or end_sec>86400 then raise exception 'challenge_curriculum:bad_chapter'; end if;
    select d.* into old_day from challenge_room_data.curriculum_days d where d.challenge=kind and d.day_no=day_value;
    if found and old_day.title=day_title and old_day.body=day_body and old_day.start_seconds=begin_sec and old_day.end_seconds=end_sec then
      return jsonb_build_object('revision',version);
    end if;
    if version<>expected then raise exception 'challenge_curriculum:edit_conflict'; end if;
    if exists(select 1 from challenge_room_data.curriculum_days d where d.challenge=kind and (d.day_no-1)/5=(day_value-1)/5
      and ((d.day_no<day_value and d.end_seconds>begin_sec) or (d.day_no>day_value and d.start_seconds<end_sec))) then
      raise exception 'challenge_curriculum:chapter_order'; end if;
    insert into challenge_room_data.curriculum_days(challenge,day_no,title,body,start_seconds,end_seconds)
    values(kind,day_value,day_title,day_body,begin_sec,end_sec) on conflict(challenge,day_no) do update
      set title=excluded.title,body=excluded.body,start_seconds=excluded.start_seconds,end_seconds=excluded.end_seconds;
    update challenge_room_data.curricula set revision=revision+1 where challenge=kind returning revision into version;
    return jsonb_build_object('revision',version);
  end if;

exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'challenge_curriculum:invalid_input';
end
$admin$;
revoke all on function public.challenge_curriculum(text,jsonb) from public,anon;
grant execute on function public.challenge_curriculum(text,jsonb) to authenticated;

-- 공통 원본의 업로드·검증·승인은 기존 비공개 영상 버킷을 사용한다. 경로는 서버만 지정한다.
create function public.challenge_curriculum_media(p_user uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $media$
declare
  kind text; wk smallint; job challenge_room_data.video_uploads%rowtype;
  previous uuid; version bigint; expected bigint; asset uuid; target text; file_name text; ext text; mime text; meta jsonb;
begin
  if p_user is null or not exists(select 1 from public.members where id=p_user and role='admin' and agreed_at is not null)
    then raise exception 'challenge_video:forbidden' using errcode='42501'; end if;
  if p_action in ('curriculum-commit','curriculum-cancel') then
    select u.curriculum_challenge,u.week_no into kind,wk from challenge_room_data.video_uploads u
      where u.id=(p_data->>'upload_id')::uuid and u.actor_id=p_user and u.curriculum_challenge is not null;
  elsif p_action in ('curriculum-upload','curriculum-preview') then
    kind:=p_data->>'challenge';
    if coalesce(p_data->>'week_no','') not in ('1','2') then raise exception 'challenge_video:not_found'; end if;
    wk:=(p_data->>'week_no')::smallint;
  else raise exception 'challenge_video:not_found'; end if;
  if challenge_room_data.supports_challenge(kind) is not true then raise exception 'challenge_video:not_found'; end if;
  if p_action='curriculum-preview' then
    select u.path into target from challenge_room_data.curriculum_sources s join challenge_room_data.video_uploads u on u.id=s.upload_id
      where s.challenge=kind and s.week_no=wk and u.status='committed';
    if not found then raise exception 'challenge_video:not_found'; end if;
    return jsonb_build_object('path',target);
  end if;
  insert into challenge_room_data.curricula(challenge) values(kind) on conflict do nothing;
  perform 1 from challenge_room_data.curricula where challenge=kind for update;
  select s.revision,s.upload_id into version,previous from challenge_room_data.curriculum_sources s where s.challenge=kind and s.week_no=wk;
  version:=coalesce(version,0);
  if p_action='curriculum-upload' then
    if coalesce(p_data->>'expected_source_revision','') !~ '^(0|[1-9][0-9]{0,17})$' then raise exception 'challenge_video:edit_conflict'; end if;
    expected:=(p_data->>'expected_source_revision')::bigint;
    if expected<>version then raise exception 'challenge_video:edit_conflict'; end if;
    file_name:=btrim(p_data->>'name'); ext:=lower(substring(file_name from '\.([^.]+)$'));
    mime:=case ext when 'mp4' then 'video/mp4' when 'webm' then 'video/webm' end;
    if mime is null or length(file_name)>180 or file_name~'[\\/[:cntrl:]]'
      or coalesce(p_data->>'contentType','') not in ('',mime) or jsonb_typeof(p_data->'size') is distinct from 'number'
      or coalesce(p_data->>'size','') !~ '^[1-9][0-9]{0,9}$' then raise exception 'challenge_video:invalid_file'; end if;
    if (p_data->>'size')::bigint>2147483648 then raise exception 'challenge_video:invalid_file'; end if;
    asset:=gen_random_uuid(); target:='curriculum/'||kind||'/'||wk::text||'/'||asset::text||'.'||ext;
    insert into challenge_room_data.video_uploads(id,curriculum_challenge,week_no,actor_id,original_name,mime_type,bytes,path,expected_revision)
      values(asset,kind,wk,p_user,file_name,mime,(p_data->>'size')::bigint,target,version);
    return jsonb_build_object('upload_id',asset,'path',target,'contentType',mime);
  end if;
  select u.* into job from challenge_room_data.video_uploads u
    where u.id=(p_data->>'upload_id')::uuid and u.actor_id=p_user and u.curriculum_challenge=kind for update;
  if not found then raise exception 'challenge_video:upload_expired'; end if;
  if p_action='curriculum-cancel' then
    update challenge_room_data.video_uploads set status='cancelled' where id=job.id and status='pending';
    return '{"ok":true}'::jsonb;
  end if;
  if previous=job.id and job.status='committed' then return '{"ok":true}'::jsonb; end if;
  if job.status='committed' or job.expected_revision<>version then raise exception 'challenge_video:edit_conflict'; end if;
  if job.status<>'pending' or job.expires_at<=clock_timestamp() then raise exception 'challenge_video:upload_expired'; end if;
  select o.metadata into meta from storage.objects o where o.bucket_id='challenge-room-video' and o.name=job.path for share;
  if meta->>'size' is distinct from job.bytes::text or lower(split_part(meta->>'mimetype',';',1)) is distinct from job.mime_type
    then raise exception 'challenge_video:upload_incomplete'; end if;
  update challenge_room_data.video_uploads set status='committed' where id=job.id;
  insert into challenge_room_data.curriculum_sources(challenge,week_no,upload_id,revision) values(kind,wk,job.id,version+1)
    on conflict(challenge,week_no) do update set upload_id=excluded.upload_id,revision=excluded.revision;
  update challenge_room_data.curricula set revision=revision+1 where challenge=kind;
  return '{"ok":true}'::jsonb;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'challenge_video:not_found';
end
$media$;
revoke all on function public.challenge_curriculum_media(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.challenge_curriculum_media(uuid,text,jsonb) to service_role;

create or replace function public.challenge_video_cleanup(p_action text,p_data jsonb) returns jsonb
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
        and not exists(select 1 from challenge_room_data.week_videos v where v.upload_id=u.id)
        and not exists(select 1 from challenge_room_data.curriculum_sources s where s.upload_id=u.id);
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
