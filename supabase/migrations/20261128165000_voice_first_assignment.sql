-- 입장한 운영자 본인의 개강 전 첫 과제만 열어 준다. 공개일과 일반 회원의 입장 조건은 그대로 사용한다.
create function challenge_room_data.admin_first_mission(actor uuid,cohort uuid)
returns uuid language sql stable set search_path='' as $first$
  select m.id from challenge_room_data.admin_challenge_entries e
  join public.members u on u.id=e.member_id and u.role='admin' and u.agreed_at is not null
  join public.challenge_rounds r on r.id=e.round_id and r.weekly_voice and r.challenge='voice'
  join challenge_room_data.missions m on m.round_id=r.id and m.day_no=1 and m.opens_at>now()
  where e.member_id=actor and e.round_id=cohort
$first$;
revoke all on function challenge_room_data.admin_first_mission(uuid,uuid) from public,anon,authenticated;

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
    select * into m from challenge_room_data.missions where id=target and (opens_at<=now() or id=challenge_room_data.admin_first_mission(u,round_id));
    if m.opens_at>now() then visible:=false; end if;
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
    where ms.id=parts[2]::uuid and (ms.opens_at<=now() or ms.id=challenge_room_data.admin_first_mission(u,r.id)) and challenge_room_data.supports_challenge(r.challenge);
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
  if p_action = 'home' then
    select coalesce(jsonb_agg(case when r.weekly_voice then entry.value ||
      jsonb_strip_nulls(jsonb_build_object('weekly_start', r.program_start,'admin_first_day',challenge_room_data.admin_first_mission(auth.uid(),r.id))) else entry.value end order by entry.ord),'[]'::jsonb)
    into sources from jsonb_array_elements(result->'cohorts') with ordinality entry(value,ord)
    join public.challenge_rounds r on r.challenge=entry.value->>'challenge' and r.round=(entry.value->>'round')::int;
    return jsonb_set(result,'{cohorts}',sources) || jsonb_build_object('server_now',now());
  end if;
  if p_action = 'mission' then
    if (result#>>'{mission,opens_at}')::timestamptz>now() then
      result:=jsonb_set(result,'{mission,admin_preview}','true');
    end if;
    if (result#>>'{mission,eligible}')::boolean then
      select jsonb_build_object('week_no', v.week_no, 'start_seconds', c.start_seconds, 'end_seconds', c.end_seconds)
        || case when v.upload_id is null then jsonb_build_object('provider','youtube','video_id',v.video_id)
                else jsonb_build_object('provider','storage') end
      into chapter from challenge_room_data.missions m
      join challenge_room_data.mission_chapters c on c.mission_id = m.id
      join challenge_room_data.week_videos v on v.round_id = m.round_id and v.week_no = (m.day_no-1)/5+1
      where m.id = (result#>>'{mission,id}')::uuid and (m.opens_at <= now() or result#>>'{mission,admin_preview}'='true');
    end if;
    return jsonb_set(result,'{mission,chapter}',coalesce(chapter,'null'::jsonb));
  end if;
  return result;
end
$rpc$;
