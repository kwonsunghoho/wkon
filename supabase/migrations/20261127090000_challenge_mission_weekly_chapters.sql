-- 기수마다 주차별 영상을 하나 등록하고, 각 미션에는 해당 영상의 재생 구간을 저장한다.
create table challenge_room_data.week_videos (
  round_id uuid not null references public.challenge_rounds(id) on delete cascade,
  week_no smallint not null check (week_no in (1, 2)),
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  primary key (round_id, week_no)
);

create table challenge_room_data.mission_chapters (
  mission_id uuid primary key references challenge_room_data.missions(id) on delete cascade,
  start_seconds integer not null check (start_seconds >= 0),
  end_seconds integer not null check (end_seconds > start_seconds and end_seconds <= 86400)
);

alter table challenge_room_data.week_videos enable row level security;
alter table challenge_room_data.mission_chapters enable row level security;
revoke all on challenge_room_data.week_videos, challenge_room_data.mission_chapters
  from public, anon, authenticated;

create function challenge_room_data.youtube_id(p_value text)
returns text language plpgsql immutable strict set search_path = '' as $id$
declare
  value text := btrim(p_value);
  result text[];
begin
  if value ~ '^[A-Za-z0-9_-]{11}$' then return value; end if;
  if length(value) > 2048 or value ~ '[[:space:][:cntrl:]]' then return null; end if;
  result := regexp_match(value,
    '^https?://(?:www\.)?youtu\.be/([A-Za-z0-9_-]{11})(?:[?#].*)?$', 'i');
  if result is null then
    result := regexp_match(value,
      '^https?://(?:(?:www|m)\.)?youtube\.com/(?:embed|shorts|live)/([A-Za-z0-9_-]{11})(?:[?#].*)?$', 'i');
  end if;
  if result is null and value ~* '^https?://(?:(?:www|m)\.)?youtube\.com/watch\?' then
    result := regexp_match(split_part(split_part(value, '?', 2), '#', 1),
      '(?:^|&)v=([A-Za-z0-9_-]{11})(?:&|$)');
  end if;
  return result[1];
end
$id$;

create function challenge_room_data.week_video_locked(p_round uuid, p_week smallint)
returns boolean language sql volatile set search_path = '' as $lock$
  select exists (
    select 1 from challenge_room_data.missions m
    join challenge_room_data.mission_chapters c on c.mission_id = m.id
    where m.round_id = p_round and (m.day_no - 1) / 5 + 1 = p_week
      and m.opens_at <= clock_timestamp()
  )
$lock$;

-- 기존 미션 API에서 동의, 기수, 공개 시각, 개인 기록 접근을 계속 검사한다.
alter function public.challenge_room(text, jsonb) set schema challenge_room_data;
alter function challenge_room_data.challenge_room(text, jsonb) rename to base_rpc;
revoke all on function challenge_room_data.base_rpc(text, jsonb) from public, anon, authenticated;

create function challenge_room_data.manage_chapters(p_action text, p_data jsonb)
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
      where r.challenge = 'voice' and r.challenge = p_data->>'challenge'
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
    where r.challenge = 'voice' and r.challenge = p_data->>'challenge'
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

create function public.challenge_room(p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $rpc$
declare
  result jsonb;
  chapter jsonb;
begin
  if p_action in ('admin-list', 'admin-week-save', 'admin-save') then
    return challenge_room_data.manage_chapters(p_action, p_data);
  end if;
  result := challenge_room_data.base_rpc(p_action, p_data);
  if p_action = 'home' then
    return result || jsonb_build_object('server_now', now());
  elsif p_action = 'mission' then
    if (result#>>'{mission,eligible}')::boolean then
      select jsonb_build_object('provider', 'youtube', 'video_id', v.video_id, 'week_no', v.week_no,
        'start_seconds', c.start_seconds, 'end_seconds', c.end_seconds)
      into chapter
      from challenge_room_data.missions m
      join challenge_room_data.mission_chapters c on c.mission_id = m.id
      join challenge_room_data.week_videos v on v.round_id = m.round_id and v.week_no = (m.day_no - 1) / 5 + 1
      where m.id = (result#>>'{mission,id}')::uuid and m.opens_at <= now();
    end if;
    return jsonb_set(result, '{mission,chapter}', coalesce(chapter, 'null'::jsonb));
  end if;
  return result;
end
$rpc$;

revoke all on all functions in schema challenge_room_data from public, anon, authenticated;
revoke all on function public.challenge_room(text, jsonb) from public, anon;
grant execute on function public.challenge_room(text, jsonb) to authenticated;
