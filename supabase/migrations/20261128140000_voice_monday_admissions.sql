-- 보신각 주간 모집. 신청 이력과 기존 개강일은 유지하고 새 구매만 배정한다.
alter table public.challenge_rounds add column weekly_voice boolean not null default false,
  add constraint weekly_voice_calendar check (not weekly_voice or
    (challenge='voice' and program_start is not null and extract(isodow from program_start)=1
      and recruit_start is not null and recruit_end is not null
      and recruit_start=program_start-6 and recruit_end=program_start));
create unique index voice_one_group_per_monday on public.challenge_rounds(program_start) where weekly_voice;
alter table public.applications add column voice_paid_at timestamptz;

-- 직접 등록한 완성본이 한 기수로 특정되고 공통 원본 두 개와 일치할 때만 처음 한 번 가져온다.
with candidates as (
  select r.id from public.challenge_rounds r join challenge_room_data.missions m on m.round_id=r.id
  join challenge_room_data.mission_chapters c on c.mission_id=m.id
  join challenge_room_data.week_videos v on v.round_id=r.id and v.week_no=(m.day_no-1)/5+1
  join challenge_room_data.curriculum_sources s on s.challenge=r.challenge and s.week_no=v.week_no and s.upload_id=v.upload_id
  where r.challenge='voice' group by r.id having count(*)=10
), copied as (
  insert into challenge_room_data.curriculum_days(challenge,day_no,title,body,start_seconds,end_seconds)
  select 'voice',m.day_no,m.title,m.body,c.start_seconds,c.end_seconds
  from candidates old join challenge_room_data.missions m on m.round_id=old.id
  join challenge_room_data.mission_chapters c on c.mission_id=m.id
  where (select count(*) from candidates)=1 and not exists
    (select 1 from challenge_room_data.curriculum_days where challenge='voice') returning 1
)
update challenge_room_data.curricula set revision=revision+1 where challenge='voice' and exists(select 1 from copied);

create or replace function challenge_room_data.assign_curriculum(p_round uuid,first_day date,expected bigint,automatic boolean)
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
  if first_day is null or extract(isodow from first_day)<>1 or ((first_day::timestamp at time zone 'Asia/Seoul')<=clock_timestamp()
      and not (automatic and cohort.weekly_voice and first_day=(clock_timestamp() at time zone 'Asia/Seoul')::date))
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
  insert into challenge_room_data.week_videos(round_id,week_no,upload_id,curriculum_copy)
    select cohort.id,s.week_no,s.upload_id,true from challenge_room_data.curriculum_sources s where s.challenge=cohort.challenge
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

-- 다음 모집분까지 미리 준비하므로 월요일 당일 한 명만 결제해도 첫 미션이 열린다.
create function challenge_room_data.ensure_voice_week(p_monday date)
returns int language plpgsql set search_path='' as $week$
declare allocation int; cohort uuid; day_kst date:=(now() at time zone 'Asia/Seoul')::date;
begin
  select r.round into allocation from public.challenge_rounds r where r.weekly_voice and r.program_start=p_monday;
  if found then return allocation; end if;
  if p_monday is null or extract(isodow from p_monday)<>1 or p_monday<day_kst or p_monday>day_kst+13 then return null; end if;
  perform pg_advisory_xact_lock(192718364,1128002);
  select r.round into allocation from public.challenge_rounds r where r.weekly_voice and r.program_start=p_monday;
  if found then return allocation; end if;
  if (challenge_room_data.curriculum_read('voice',null)->>'ready')::boolean is not true then return null; end if;
  -- 관리자가 새 기수를 저장하는 경우에도 같은 기수 번호를 사용하지 않는다.
  lock table public.challenge_rounds in share row exclusive mode;
  select coalesce(max(r.round),0)+1 into allocation from public.challenge_rounds r where r.challenge='voice';
  insert into public.challenge_rounds(challenge,round,weekly_voice,recruit_start,recruit_end,program_start,start_mode)
    values('voice',allocation,true,p_monday-6,p_monday,p_monday,'scheduled') returning id into cohort;
  perform challenge_room_data.assign_curriculum(cohort,p_monday,null,true);
  if not exists(select from challenge_room_data.curriculum_schedules where round_id=cohort) then
    raise exception 'voice_week:incomplete';
  end if;
  return allocation;
end
$week$;

create function challenge_room_data.prepare_voice_weeks()
returns void language plpgsql security definer set search_path='' as $prepare$
declare first_day date:=challenge_room_data.first_mission_monday((now() at time zone 'Asia/Seoul')::date);
begin
  perform challenge_room_data.ensure_voice_week(first_day);
  perform challenge_room_data.ensure_voice_week(first_day+7);
end
$prepare$;

-- applications_duplicate 앞에서 보신각 항목의 기수만 확정한다. 여러 상품, 기존 신청과 환불 이력은 그대로 둔다.
create function challenge_room_data.route_voice_application()
returns trigger language plpgsql security definer set search_path='' as $route$
declare
  day_kst date:=(statement_timestamp() at time zone 'Asia/Seoul')::date;
  monday date; allocation int; item jsonb; confirmed boolean;
begin
  if jsonb_typeof(new.challenges) is distinct from 'array' or not new.challenges @> '[{"challenge":"voice"}]' then return new; end if;
  confirmed:=(new.paid is true or new.payment_status in ('paid','free')) is true
    and not coalesce(new.refunded,false) and coalesce(new.payment_status,'') not in ('refunded','cancelled','canceled','failed');
  if tg_op='UPDATE' then
    if not confirmed or old.paid is true or old.payment_status in ('paid','free','partial_refunded') then return new; end if;
    if not exists (select 1 from jsonb_array_elements(old.challenges) x join public.challenge_rounds r
      on r.weekly_voice and x->>'challenge'='voice' and x->>'round'=r.round::text) then return new; end if;
    -- 입금 체크를 취소하고 다시 확인해도 이미 확정된 날짜를 유지한다.
    if old.voice_paid_at is not null then return new; end if;
  end if;
  if tg_op='INSERT' and current_setting('role',true)='service_role' and new.payment_id is not null
     and confirmed and new.voice_paid_at is not null then
    -- 전환 전에 승인된 레거시 주문은 통지가 늦어도 주문한 기수에 접수한다.
    if new.voice_paid_at < (select min(created_at) from public.challenge_rounds where weekly_voice)
       and exists (select from jsonb_array_elements(new.challenges) x join public.challenge_rounds r
         on r.challenge='voice' and not r.weekly_voice and x->>'challenge'='voice' and x->>'round'=r.round::text)
    then return new; end if;
    day_kst:=(new.voice_paid_at at time zone 'Asia/Seoul')::date;
  else
    new.voice_paid_at:=case when confirmed then statement_timestamp() end;
  end if;
  monday:=challenge_room_data.first_mission_monday(day_kst);
  allocation:=challenge_room_data.ensure_voice_week(monday);
  if allocation is null then
    raise exception 'voice_week:unavailable' using errcode='MC001';
  end if;
  if tg_op='UPDATE' then
    select x into item from jsonb_array_elements(old.challenges) x where x->>'challenge'='voice' limit 1;
    if item->>'round' is distinct from allocation::text then
      if public.monc_norm_phone(new.phone) is not null then perform pg_advisory_xact_lock(hashtext('monc_dup_p:'||public.monc_norm_phone(new.phone))); end if;
      if new.member_id is not null then perform pg_advisory_xact_lock(hashtext('monc_dup_m:'||new.member_id::text)); end if;
      if exists(select 1 from public.applications a where a.id<>new.id and public.monc_app_live(a.refunded,a.payment_status)
        and (a.member_id=new.member_id or public.monc_norm_phone(a.phone)=public.monc_norm_phone(new.phone))
        and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(a.challenges)='array' then a.challenges else '[]' end) x
          where x->>'challenge'='voice' and x->>'round'=allocation::text)) then
        raise exception 'duplicate_application' using errcode='MC002',hint='보신각 같은 월요일 시작반';
      end if;
    end if;
  end if;
  select jsonb_agg(case when x.value->>'challenge'='voice' then jsonb_set(x.value,'{round}',to_jsonb(allocation))
    else x.value end order by x.ord) into new.challenges from jsonb_array_elements(new.challenges) with ordinality x(value,ord);
  return new;
end
$route$;
create trigger applications_assign_voice_week before insert or update of paid,payment_status on public.applications
  for each row execute function challenge_room_data.route_voice_application();

create or replace function public.apply_free_challenges(p_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text;
  v_phone text;
  v_id    text;
  v_ids   text[];
  v_round int;
  v_items jsonb := '[]'::jsonb;
  v_hint  text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_authenticated'); end if;
  if not public.monc_is_student() then return jsonb_build_object('ok', false, 'code', 'not_student'); end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('ok', false, 'code', 'no_selection');
  end if;
  if array_length(p_ids, 1) > 10 then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;

  -- 신청자 정보도 브라우저가 아니라 계정에서 읽는다(무료는 로그인 회원만이라 언제나 있다).
  select m.name, m.phone into v_name, v_phone from public.members m where m.id = v_uid;
  if coalesce(btrim(v_name), '') = '' or coalesce(btrim(v_phone), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'profile_missing');
  end if;

  -- 같은 챌린지를 두 번 담아 보내도 한 번만 접수한다(중복 트리거는 다른 신청 건끼리만 본다).
  select array_agg(distinct x) into v_ids from unnest(p_ids) x where coalesce(btrim(x), '') <> '';
  if v_ids is null then return jsonb_build_object('ok', false, 'code', 'no_selection'); end if;

  foreach v_id in array v_ids
  loop
    -- 모집 중(recruit_start 지났고 recruit_end 안 지난) 기수만. 선착순 기수는 recruit_end 가 없다.
    if v_id='voice' then
      select r.round into v_round from public.challenge_rounds r where r.weekly_voice
        and r.program_start=challenge_room_data.first_mission_monday((now() at time zone 'Asia/Seoul')::date);
    else
    select r.round into v_round
      from public.challenge_rounds r
     where r.challenge = v_id
       and (r.recruit_start is null or r.recruit_start <= current_date)
       and (r.recruit_end   is null or r.recruit_end   >= current_date)
     order by r.recruit_end asc nulls last
     limit 1;
    end if;

    if v_round is null then
      return jsonb_build_object('ok', false, 'code', 'not_open', 'challenge', v_id);
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'challenge', v_id,
      -- 표시 이름 — apply.html CHALLENGES 의 fullName 과 같은 문자열. 화면 표시용이라
      -- 판정에는 쓰이지 않는다(admin 은 id 로 라벨을 붙인다).
      'name', case v_id
                when 'voice'      then '보.신.각(보이스) - 목소리 챌린지'
                when 'answer'     then '승.자.각(답변) - 답변 챌린지'
                when 'expression' then '영.합.각(표현력) - 영상면접 표현력 챌린지'
                when 'spinning'   then '스.피.닝(스피치) - 말 맛 챌린지'
                when 'culture'    then '댄.특.완(대한항공 특화 답변 완성) - 기업분석 챌린지'
                else v_id
              end,
      'round', v_round,
      'price', 0
    ));
  end loop;

  insert into public.applications (name, phone, challenges, total_price, payment_status, paid, member_id)
  values (v_name, v_phone, v_items, 0, 'free', false, v_uid) returning challenges into v_items;

  return jsonb_build_object('ok', true, 'items', v_items);
exception
  -- 중복 신청 — 트리거(MC002)가 막았다. hint 에 '무엇이' 중복인지 들어 있다.
  when sqlstate 'MC002' then
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'code', 'duplicate', 'program', v_hint);
end;
$$;

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
      jsonb_build_object('weekly_start', r.program_start) else entry.value end order by entry.ord),'[]'::jsonb)
    into sources from jsonb_array_elements(result->'cohorts') with ordinality entry(value,ord)
    join public.challenge_rounds r on r.challenge=entry.value->>'challenge' and r.round=(entry.value->>'round')::int;
    return jsonb_set(result,'{cohorts}',sources) || jsonb_build_object('server_now',now());
  end if;
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

revoke all on function challenge_room_data.ensure_voice_week(date), challenge_room_data.prepare_voice_weeks(),
  challenge_room_data.route_voice_application() from public,anon,authenticated;
select challenge_room_data.prepare_voice_weeks();
select cron.schedule('challenge-voice-weekly-admissions','5 * * * *','select challenge_room_data.prepare_voice_weeks()');
