-- 수강 자격, 미션, 수신 동의, 주차 영상 모두 같은 네 종목만 사용한다.
create function challenge_room_data.supports_challenge(p_challenge text)
returns boolean language sql immutable strict set search_path = '' as $$
  select p_challenge in ('voice', 'spinning', 'expression', 'answer')
$$;
revoke all on function challenge_room_data.supports_challenge(text) from public, anon, authenticated;

create or replace function challenge_room_data.eligible(p_member uuid,p_round uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(
    select 1 from public.challenge_rounds r
    join public.members m on m.id=p_member and m.agreed_at is not null
    join public.applications a on a.member_id=m.id
    where r.id=p_round and challenge_room_data.supports_challenge(r.challenge)
      and (a.paid is true or a.payment_status in ('paid','free','partial_refunded'))
      and not coalesce(a.refunded,false)
      and coalesce(a.payment_status,'') not in ('refunded','cancelled','canceled','failed')
      and exists(select 1 from jsonb_array_elements(
        case when jsonb_typeof(a.challenges)='array' then a.challenges else '[]'::jsonb end
      ) item where item->>'challenge'=r.challenge and item->>'round'=r.round::text)
  )
$$;

create or replace function challenge_room_data.history(p_member uuid)
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'mission_id',m.id,'day_no',m.day_no,
    'title',m.title,'challenge',r.challenge,'round',r.round,'created_at',a.created_at,
    'shared',a.shared,'comment_count',(select count(*) from challenge_room_data.notes n where n.answer_id=a.id))
    order by a.created_at desc,a.id),'[]'::jsonb)
  from challenge_room_data.answers a join challenge_room_data.missions m on m.id=a.mission_id
  join public.challenge_rounds r on r.id=m.round_id where a.member_id=p_member and challenge_room_data.supports_challenge(r.challenge)
$$;

create or replace function public.challenge_room_audio_access(p_path text,p_action text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  m challenge_room_data.missions%rowtype;
  a challenge_room_data.answers%rowtype;
  parts text[];
begin
  if u is null or not exists(select 1 from public.members where id=u and agreed_at is not null) then return false; end if;
  parts:=regexp_match(p_path,'^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webm|ogg|mp4|m4a|mp3|wav)$');
  if parts is null then return false; end if;
  select ms.* into m from challenge_room_data.missions ms join public.challenge_rounds r on r.id=ms.round_id
    where ms.id=parts[2]::uuid and ms.opens_at<=now() and challenge_room_data.supports_challenge(r.challenge);
  if not found then return false; end if;
  select * into a from challenge_room_data.answers where audio_path=p_path;
  if p_action='upload' then
    return parts[1]::uuid=u and challenge_room_data.eligible(u,m.round_id)
      and not exists(select 1 from challenge_room_data.answers where mission_id=m.id and member_id=u);
  elsif p_action='cleanup' then
    return parts[1]::uuid=u and a.id is null;
  elsif p_action='read' then
    return parts[1]::uuid=u or (a.shared and challenge_room_data.eligible(u,m.round_id));
  end if;
  return false;
end $$;

create or replace function challenge_room_data.manage(p_action text,p_data jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  r public.challenge_rounds%rowtype;
  m challenge_room_data.missions%rowtype;
  target uuid:=nullif(p_data->>'id','')::uuid;
  day_value integer; release_value date;
  label text:=btrim(p_data->>'title'); prompt text:=btrim(p_data->>'body');
begin
  if not public.is_admin() then raise exception 'challenge_room:forbidden' using errcode='42501'; end if;
  if p_action='admin-delete' then
    -- 예전 보신각 관리자 화면은 삭제 시 미션 ID만 보냈다.
    select ms.* into m from challenge_room_data.missions ms
    join public.challenge_rounds cohort on cohort.id=ms.round_id
    where ms.id=target and challenge_room_data.supports_challenge(cohort.challenge)
      and ((not (p_data ?| array['challenge','round']) and cohort.challenge='voice')
        or (cohort.challenge=p_data->>'challenge' and cohort.round::text=p_data->>'round'))
    for update of ms;
    if not found then raise exception 'challenge_room:not_found'; end if;
    if m.opens_at<=clock_timestamp() then raise exception 'challenge_room:locked'; end if;
    delete from challenge_room_data.missions where id=m.id;
    return '{"ok":true}'::jsonb;
  end if;
  select * into r from public.challenge_rounds
   where challenge_room_data.supports_challenge(challenge) and challenge=p_data->>'challenge' and round=(p_data->>'round')::integer;
  if not found then raise exception 'challenge_room:not_found'; end if;
  if p_action='admin-list' then
    return jsonb_build_object('missions',coalesce((
      select jsonb_agg(challenge_room_data.mission_json(ms)||jsonb_build_object('locked',ms.opens_at<=now())
        order by ms.day_no) from challenge_room_data.missions ms where ms.round_id=r.id
    ),'[]'::jsonb));
  end if;
  if p_action<>'admin-save' then raise exception 'challenge_room:invalid_input'; end if;
  day_value:=(p_data->>'day_no')::integer;
  release_value:=(p_data->>'release_date')::date;
  if day_value is null or day_value not between 1 and 10 or coalesce(length(label),0) not between 1 and 100
    or coalesce(length(prompt),0) not between 1 and 2000 then raise exception 'challenge_room:invalid_input'; end if;
  if release_value is null or extract(isodow from release_value)>5
    or (release_value::timestamp at time zone 'Asia/Seoul')<=clock_timestamp()
    or release_value<r.program_start then raise exception 'challenge_room:bad_schedule'; end if;
  if target is null then
    insert into challenge_room_data.missions(round_id,day_no,release_date,title,body)
      values(r.id,day_value,release_value,label,prompt) returning id into target;
  else
    select * into m from challenge_room_data.missions where id=target and round_id=r.id for update;
    if not found then raise exception 'challenge_room:not_found'; end if;
    if m.opens_at<=clock_timestamp() then raise exception 'challenge_room:locked'; end if;
    update challenge_room_data.missions set day_no=day_value,release_date=release_value,title=label,body=prompt where id=m.id;
  end if;
  return jsonb_build_object('id',target);
exception when unique_violation then raise exception 'challenge_room:duplicate_schedule';
end $$;

create or replace function challenge_room_data.push_options(p_action text,p_data jsonb,u uuid)
returns jsonb language plpgsql set search_path='' as $$
declare
  r uuid; d challenge_room_data.devices%rowtype;
  ep text:=p_data->>'endpoint'; public_key text:=p_data#>>'{keys,p256dh}'; secret_key text:=p_data#>>'{keys,auth}';
begin
  select id into r from public.challenge_rounds where challenge_room_data.supports_challenge(challenge)
    and challenge=p_data->>'challenge' and round=(p_data->>'round')::integer;
  if r is null then raise exception 'challenge_room:not_found'; end if;
  if p_action='push-disable' then
    delete from challenge_room_data.subscriptions s using challenge_room_data.devices dev
      where s.device_id=dev.id and dev.member_id=u and dev.endpoint=ep and s.round_id=r;
    return '{"enabled":false}'::jsonb;
  end if;
  if not challenge_room_data.eligible(u,r) then raise exception 'challenge_room:forbidden' using errcode='42501'; end if;
  if p_action='push-status' then
    return jsonb_build_object('enabled',exists(select 1 from challenge_room_data.subscriptions s
      join challenge_room_data.devices dev on dev.id=s.device_id where dev.member_id=u and dev.endpoint=ep and s.round_id=r));
  end if;
  if p_action<>'push-enable' or ep is null or length(ep)>2048 or ep~'[[:space:][:cntrl:]]'
    or ep !~ '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*(notify|wns)\.windows\.com|([a-z0-9-]+\.)*push\.apple\.com)/[^#]+$'
    or public_key is null or public_key !~ '^B[A-P][A-Za-z0-9_-]{84}[AEIMQUYcgkosw048]$'
    or secret_key is null or secret_key !~ '^[A-Za-z0-9_-]{21}[AQgw]$' then raise exception 'challenge_room:invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(ep,0));
  select * into d from challenge_room_data.devices where endpoint=ep for update;
  if found and d.member_id<>u then
    -- 같은 브라우저에서 이전 계정의 알림이 새 계정에 남지 않게 기존 기기 구독과 배송을 해제한다.
    if d.p256dh<>public_key or d.auth_key<>secret_key then raise exception 'challenge_room:invalid_input'; end if;
    delete from challenge_room_data.devices where id=d.id;
    d.id:=null;
  end if;
  if d.id is null then
    insert into challenge_room_data.devices(member_id,endpoint,p256dh,auth_key) values(u,ep,public_key,secret_key) returning id into d.id;
  else
    update challenge_room_data.devices set p256dh=public_key,auth_key=secret_key where id=d.id;
  end if;
  insert into challenge_room_data.subscriptions(device_id,round_id) values(d.id,r) on conflict do nothing;
  return '{"enabled":true}'::jsonb;
end $$;

create or replace function challenge_room_data.base_rpc(p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); target uuid:=nullif(p_data->>'id','')::uuid;
  req uuid:=nullif(p_data->>'request_id','')::uuid;
  file_id uuid:=nullif(p_data->>'file_id','')::uuid;
  ext text:=p_data->>'extension'; content text:=btrim(coalesce(p_data->>'body','')); file_path text;
  visible boolean:=coalesce((p_data->>'shared')::boolean,false);
  m challenge_room_data.missions%rowtype; a challenge_room_data.answers%rowtype; n challenge_room_data.notes%rowtype;
  can_participate boolean;
begin
  if u is null or not exists(select 1 from public.members where id=u and agreed_at is not null) then
    raise exception 'challenge_room:forbidden' using errcode='42501';
  end if;
  if p_action in ('admin-list','admin-save','admin-delete') then return challenge_room_data.manage(p_action,p_data); end if;
  if p_action in ('push-enable','push-disable','push-status') then return challenge_room_data.push_options(p_action,p_data,u); end if;
  if p_action='history' then return jsonb_build_object('history',challenge_room_data.history(u)); end if;
  if p_action='home' then
    return jsonb_build_object('history',challenge_room_data.history(u),'cohorts',coalesce((
      select jsonb_agg(jsonb_build_object('round',r.round,'challenge',r.challenge,'missions',coalesce((
        select jsonb_agg(challenge_room_data.mission_json(ms)||jsonb_build_object('submission_id',ans.id)
          order by ms.day_no) from challenge_room_data.missions ms
          left join challenge_room_data.answers ans on ans.mission_id=ms.id and ans.member_id=u
          where ms.round_id=r.id and ms.opens_at<=now()),'[]'::jsonb)) order by r.round desc,r.challenge)
      from public.challenge_rounds r where challenge_room_data.eligible(u,r.id)
        and exists(select 1 from challenge_room_data.missions ms where ms.round_id=r.id)
    ),'[]'::jsonb));
  end if;
  if p_action in ('mission','submit') then
    select * into m from challenge_room_data.missions where id=target and opens_at<=now();
  elsif p_action in ('share','comment') then
    select * into a from challenge_room_data.answers where id=target for update;
    select * into m from challenge_room_data.missions where id=a.mission_id and opens_at<=now();
  else raise exception 'challenge_room:invalid_input'; end if;
  if m.id is null or not exists (
    select 1 from public.challenge_rounds r where r.id=m.round_id and challenge_room_data.supports_challenge(r.challenge)
  ) then raise exception 'challenge_room:not_found'; end if;
  can_participate:=challenge_room_data.eligible(u,m.round_id);
  if p_action='mission' then
    if not can_participate and not exists(select 1 from challenge_room_data.answers where member_id=u and mission_id=m.id)
      then raise exception 'challenge_room:not_found'; end if;
    return challenge_room_data.mission_detail(m,u);
  end if;
  if p_action='share' and a.member_id=u and not visible then
    update challenge_room_data.answers set shared=false where id=a.id; return '{"shared":false}'::jsonb;
  end if;
  if not can_participate then raise exception 'challenge_room:forbidden' using errcode='42501'; end if;
  if p_action='share' then
    if a.member_id<>u then raise exception 'challenge_room:forbidden' using errcode='42501'; end if;
    update challenge_room_data.answers set shared=visible where id=a.id; return jsonb_build_object('shared',visible);
  end if;
  if req is null then raise exception 'challenge_room:invalid_input'; end if;
  if p_action='comment' then
    if a.member_id=u or not a.shared then raise exception 'challenge_room:forbidden' using errcode='42501'; end if;
    if length(content) not between 1 and 180 then raise exception 'challenge_room:invalid_input'; end if;
    insert into challenge_room_data.notes(answer_id,member_id,request_id,body) values(a.id,u,req,content)
      on conflict(answer_id,member_id) do nothing;
    select * into n from challenge_room_data.notes where answer_id=a.id and member_id=u;
    if n.request_id<>req or n.body<>content then raise exception 'challenge_room:already_commented' using errcode='23505'; end if;
    return jsonb_build_object('id',n.id);
  end if;
  if length(content)>2000 or (content='' and file_id is null) or ((file_id is null)<>(ext is null)) then
    raise exception 'challenge_room:invalid_input'; end if;
  if file_id is not null then
    if ext not in ('webm','ogg','mp4','m4a','mp3','wav') then raise exception 'challenge_room:invalid_input'; end if;
    file_path:=u::text||'/'||m.id::text||'/'||file_id::text||'.'||ext;
    perform 1 from storage.objects where bucket_id='challenge-room-audio' and name=file_path for share;
    if not found then raise exception 'challenge_room:audio_missing'; end if;
  end if;
  insert into challenge_room_data.answers(mission_id,member_id,request_id,body,audio_path,shared)
    values(m.id,u,req,content,file_path,visible) on conflict(mission_id,member_id) do nothing;
  select * into a from challenge_room_data.answers where mission_id=m.id and member_id=u;
  if a.request_id<>req or a.body<>content or a.audio_path is distinct from file_path then
    raise exception 'challenge_room:already_submitted' using errcode='23505'; end if;
  return jsonb_build_object('id',a.id);
end $$;

create or replace function challenge_room_data.manage_chapters(p_action text, p_data jsonb)
returns jsonb language plpgsql set search_path = '' as $manage$
declare
  cohort uuid;
  week_value smallint;
  video text;
  previous_video text;
  start_value integer;
  end_value integer;
  has_start boolean := p_data ? 'chapter_start_seconds';
  has_end boolean := p_data ? 'chapter_end_seconds';
  result jsonb;
  mission challenge_room_data.missions%rowtype;
begin
  if auth.uid() is null or public.is_admin() is not true or not exists (
    select 1 from public.members where id = auth.uid() and agreed_at is not null
  ) then
    raise exception 'challenge_room:forbidden' using errcode = '42501';
  end if;
  if p_action = 'admin-list' then
    result := challenge_room_data.base_rpc(p_action, p_data);
    select r.id into strict cohort from public.challenge_rounds r
      where challenge_room_data.supports_challenge(r.challenge) and r.challenge = p_data->>'challenge'
        and r.round = (p_data->>'round')::integer;
    return jsonb_build_object(
      'missions', coalesce((
        select jsonb_agg(item.value || jsonb_build_object(
          'chapter_start_seconds', c.start_seconds, 'chapter_end_seconds', c.end_seconds
        ) order by item.ordinality)
        from jsonb_array_elements(result->'missions') with ordinality item(value, ordinality)
        left join challenge_room_data.mission_chapters c on c.mission_id = (item.value->>'id')::uuid
      ), '[]'::jsonb),
      'week_videos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'week_no', v.week_no, 'video_url', 'https://www.youtube.com/watch?v=' || v.video_id,
          'locked', challenge_room_data.week_video_locked(cohort, v.week_no)
        ) order by v.week_no) from challenge_room_data.week_videos v where v.round_id = cohort
      ), '[]'::jsonb)
    );
  end if;

  -- 같은 기수의 영상과 구간을 동시에 수정해도 공개 잠금과 구간 순서를 지킨다.
  select r.id into cohort from public.challenge_rounds r
    where challenge_room_data.supports_challenge(r.challenge) and r.challenge = p_data->>'challenge'
      and r.round = (p_data->>'round')::integer for update;
  if not found then raise exception 'challenge_room:not_found'; end if;

  if p_action = 'admin-week-save' then
    if coalesce(p_data->>'week_no', '') not in ('1', '2') then
      raise exception 'challenge_room:invalid_input';
    end if;
    week_value := (p_data->>'week_no')::smallint;
    video := challenge_room_data.youtube_id(p_data->>'video_url');
    if video is null then raise exception 'challenge_room:bad_video'; end if;
    select v.video_id into previous_video from challenge_room_data.week_videos v
      where v.round_id = cohort and v.week_no = week_value;
    if previous_video is distinct from video then
      if challenge_room_data.week_video_locked(cohort, week_value) then
        raise exception 'challenge_room:locked';
      end if;
      insert into challenge_room_data.week_videos (round_id, week_no, video_id)
        values (cohort, week_value, video)
      on conflict (round_id, week_no) do update set video_id = excluded.video_id;
    end if;
    return jsonb_build_object('week_no', week_value, 'video_url', 'https://www.youtube.com/watch?v=' || video);
  end if;

  -- 기존 미션 저장 절차가 공개 시각 잠금과 예약 규칙을 먼저 검사한다.
  result := challenge_room_data.base_rpc('admin-save', p_data);
  select m.* into strict mission from challenge_room_data.missions m where m.id = (result->>'id')::uuid;
  if has_start <> has_end then raise exception 'challenge_room:bad_chapter'; end if;
  if has_start then
    if p_data->>'chapter_start_seconds' is null and p_data->>'chapter_end_seconds' is null then
      delete from challenge_room_data.mission_chapters where mission_id = mission.id;
      return result;
    end if;
    if jsonb_typeof(p_data->'chapter_start_seconds') is distinct from 'number'
      or jsonb_typeof(p_data->'chapter_end_seconds') is distinct from 'number'
      or (p_data->>'chapter_start_seconds') !~ '^(0|[1-9][0-9]{0,4})$'
      or (p_data->>'chapter_end_seconds') !~ '^[1-9][0-9]{0,4}$' then
      raise exception 'challenge_room:bad_chapter';
    end if;
    start_value := (p_data->>'chapter_start_seconds')::integer;
    end_value := (p_data->>'chapter_end_seconds')::integer;
    if end_value <= start_value or end_value > 86400 then raise exception 'challenge_room:bad_chapter'; end if;
  else
    select c.start_seconds, c.end_seconds into start_value, end_value
      from challenge_room_data.mission_chapters c where c.mission_id = mission.id;
    if not found then return result; end if;
  end if;

  if extract(isodow from mission.release_date) <> (mission.day_no - 1) % 5 + 1 then
    raise exception 'challenge_room:bad_chapter_day';
  end if;
  week_value := (mission.day_no - 1) / 5 + 1;
  if not exists (select 1 from challenge_room_data.week_videos v
    where v.round_id = cohort and v.week_no = week_value) then
    raise exception 'challenge_room:week_video_missing';
  end if;
  if exists (
    select 1 from challenge_room_data.missions m
    join challenge_room_data.mission_chapters c on c.mission_id = m.id
    where m.round_id = cohort and (m.day_no - 1) / 5 + 1 = week_value and m.id <> mission.id
      and ((m.day_no < mission.day_no and c.end_seconds > start_value)
        or (m.day_no > mission.day_no and c.start_seconds < end_value))
  ) then
    raise exception 'challenge_room:chapter_order';
  end if;
  insert into challenge_room_data.mission_chapters (mission_id, start_seconds, end_seconds)
    values (mission.id, start_value, end_value)
  on conflict (mission_id) do update
    set start_seconds = excluded.start_seconds, end_seconds = excluded.end_seconds;
  return result;
end
$manage$;

create or replace function public.challenge_video_media(p_user uuid, p_action text, p_data jsonb)
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
    select id into cohort from public.challenge_rounds where challenge_room_data.supports_challenge(challenge) and challenge = p_data->>'challenge'
      and round = (p_data->>'round')::integer;
  else raise exception 'challenge_video:not_found';
  end if;
  perform 1 from public.challenge_rounds where id=cohort and challenge_room_data.supports_challenge(challenge) for update;
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
