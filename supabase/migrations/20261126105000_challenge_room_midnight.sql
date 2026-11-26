-- 미션 원문과 녹음은 공개 모집 화면에서 조회하지 않는다.
create schema challenge_room_data;
revoke all on schema challenge_room_data from public, anon, authenticated;
alter default privileges in schema challenge_room_data revoke execute on functions from public;

create table challenge_room_data.missions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.challenge_rounds(id) on delete restrict,
  day_no smallint not null check (day_no between 1 and 10),
  release_date date not null check (extract(isodow from release_date) between 1 and 5),
  opens_at timestamptz generated always as (release_date::timestamp at time zone 'Asia/Seoul') stored,
  title text not null check (length(btrim(title)) between 1 and 100),
  body text not null check (length(btrim(body)) between 1 and 2000),
  unique(round_id,day_no), unique(round_id,release_date)
);
create table challenge_room_data.answers (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references challenge_room_data.missions(id) on delete restrict,
  member_id uuid not null references public.members(id) on delete cascade,
  request_id uuid not null,
  body text not null default '' check(length(body)<=2000),
  audio_path text unique,
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  check(length(btrim(body))>0 or audio_path is not null),
  unique(mission_id,member_id)
);
create index challenge_room_answers_history on challenge_room_data.answers(member_id,created_at desc);
create table challenge_room_data.notes (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references challenge_room_data.answers(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  request_id uuid not null,
  body text not null check (length(btrim(body)) between 1 and 180),
  created_at timestamptz not null default now(),
  unique(answer_id,member_id)
);
create table challenge_room_data.devices (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  endpoint text unique not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);
create table challenge_room_data.subscriptions (
  device_id uuid not null references challenge_room_data.devices(id) on delete cascade,
  round_id uuid not null references public.challenge_rounds(id) on delete cascade,
  enabled_at timestamptz not null default now(), primary key(device_id,round_id)
);
create index challenge_room_subscriptions_round on challenge_room_data.subscriptions(round_id);
alter table challenge_room_data.missions enable row level security;
alter table challenge_room_data.answers enable row level security;
alter table challenge_room_data.notes enable row level security;
alter table challenge_room_data.devices enable row level security;
alter table challenge_room_data.subscriptions enable row level security;

-- 신청 당시 항목의 챌린지·기수와 계정을 함께 비교한다. 이전 수동 입금과 부분 환불 참가 이력도 인정한다.
create function challenge_room_data.eligible(p_member uuid,p_round uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(
    select 1 from public.challenge_rounds r
    join public.members m on m.id=p_member and m.agreed_at is not null
    join public.applications a on a.member_id=m.id
    where r.id=p_round and r.challenge='voice'
      and (a.paid is true or a.payment_status in ('paid','free','partial_refunded'))
      and not coalesce(a.refunded,false)
      and coalesce(a.payment_status,'') not in ('refunded','cancelled','canceled','failed')
      and exists(select 1 from jsonb_array_elements(
        case when jsonb_typeof(a.challenges)='array' then a.challenges else '[]'::jsonb end
      ) item where item->>'challenge'=r.challenge and item->>'round'=r.round::text)
  )
$$;

create function challenge_room_data.mission_json(m challenge_room_data.missions)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',m.id,'day_no',m.day_no,'release_date',m.release_date,
    'opens_at',m.opens_at,'title',m.title,'body',m.body)
$$;

create function challenge_room_data.history(p_member uuid)
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'mission_id',m.id,'day_no',m.day_no,
    'title',m.title,'challenge',r.challenge,'round',r.round,'created_at',a.created_at,
    'shared',a.shared,'comment_count',(select count(*) from challenge_room_data.notes n where n.answer_id=a.id))
    order by a.created_at desc,a.id),'[]'::jsonb)
  from challenge_room_data.answers a join challenge_room_data.missions m on m.id=a.mission_id
  join public.challenge_rounds r on r.id=m.round_id where a.member_id=p_member
$$;

create function challenge_room_data.mission_detail(m challenge_room_data.missions,p_member uuid)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('mission',challenge_room_data.mission_json(m)||
      jsonb_build_object('round',r.round,'challenge',r.challenge,
        'eligible',challenge_room_data.eligible(p_member,r.id)),
    'answers',coalesce((
      select jsonb_agg(jsonb_build_object('id',a.id,'mine',a.member_id=p_member,'shared',a.shared,
        'author_label',coalesce(nullif(btrim(p.nickname),''),'참가자'),'created_at',a.created_at,
        'audio_path',a.audio_path,'body',a.body,'comments',coalesce((
          select jsonb_agg(jsonb_build_object('id',n.id,'mine',n.member_id=p_member,
            'author_label',coalesce(nullif(btrim(np.nickname),''),'참가자'),'created_at',n.created_at,'body',n.body)
            order by n.created_at,n.id)
          from challenge_room_data.notes n left join monc_community.profiles np on np.user_id=n.member_id
          where n.answer_id=a.id
        ),'[]'::jsonb)) order by a.created_at desc,a.id)
      from challenge_room_data.answers a left join monc_community.profiles p on p.user_id=a.member_id
      where a.mission_id=m.id and (a.member_id=p_member or
        (a.shared and challenge_room_data.eligible(p_member,m.round_id)))
    ),'[]'::jsonb))
  from public.challenge_rounds r where r.id=m.round_id
$$;

-- 파일은 사용자/미션/시도별 고유 경로에 한 번만 올린다. 원본 파일 목록 전체는 노출하지 않는다.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('challenge-room-audio','challenge-room-audio',false,20971520,
  array['audio/webm','audio/ogg','audio/mp4','audio/x-m4a','audio/mpeg','audio/wav','audio/x-wav']);

create function public.challenge_room_audio_access(p_path text,p_action text)
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
  select * into m from challenge_room_data.missions where id=parts[2]::uuid and opens_at<=now();
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
revoke all on function public.challenge_room_audio_access(text,text) from public,anon;
grant execute on function public.challenge_room_audio_access(text,text) to authenticated;

create policy challenge_room_audio_insert on storage.objects for insert to authenticated
  with check (bucket_id='challenge-room-audio' and public.challenge_room_audio_access(name,'upload'));
create policy challenge_room_audio_read on storage.objects for select to authenticated
  using (bucket_id='challenge-room-audio' and public.challenge_room_audio_access(name,'read'));
create policy challenge_room_audio_cleanup on storage.objects for delete to authenticated
  using (bucket_id='challenge-room-audio' and public.challenge_room_audio_access(name,'cleanup'));

create function challenge_room_data.manage(p_action text,p_data jsonb)
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
    select * into m from challenge_room_data.missions where id=target for update;
    if not found then raise exception 'challenge_room:not_found'; end if;
    if m.opens_at<=clock_timestamp() then raise exception 'challenge_room:locked'; end if;
    delete from challenge_room_data.missions where id=m.id;
    return '{"ok":true}'::jsonb;
  end if;
  select * into r from public.challenge_rounds
   where challenge='voice' and challenge=p_data->>'challenge' and round=(p_data->>'round')::integer;
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

create function challenge_room_data.push_options(p_action text,p_data jsonb,u uuid)
returns jsonb language plpgsql set search_path='' as $$
declare
  r uuid; d challenge_room_data.devices%rowtype;
  ep text:=p_data->>'endpoint'; public_key text:=p_data#>>'{keys,p256dh}'; secret_key text:=p_data#>>'{keys,auth}';
begin
  select id into r from public.challenge_rounds where challenge='voice'
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

create function public.challenge_room(p_action text,p_data jsonb default '{}')
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
          where ms.round_id=r.id and ms.opens_at<=now()),'[]'::jsonb)) order by r.round desc)
      from public.challenge_rounds r where r.challenge='voice' and challenge_room_data.eligible(u,r.id)
        and exists(select 1 from challenge_room_data.missions ms where ms.round_id=r.id)
    ),'[]'::jsonb));
  end if;
  if p_action in ('mission','submit') then
    select * into m from challenge_room_data.missions where id=target and opens_at<=now();
  elsif p_action in ('share','comment') then
    select * into a from challenge_room_data.answers where id=target for update;
    select * into m from challenge_room_data.missions where id=a.mission_id and opens_at<=now();
  else raise exception 'challenge_room:invalid_input'; end if;
  if m.id is null then raise exception 'challenge_room:not_found'; end if;
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
revoke all on function public.challenge_room(text,jsonb) from public,anon;
grant execute on function public.challenge_room(text,jsonb) to authenticated;

-- 푸시 전송 대기열은 자정 공개가 이미 시작된 미션에 대해서만 만든다.
create table challenge_room_data.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references challenge_room_data.missions(id) on delete cascade,
  device_id uuid not null references challenge_room_data.devices(id) on delete cascade,
  member_id uuid not null,
  enabled_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','sent','failed')),
  attempts smallint not null default 0,
  next_at timestamptz not null default now(),
  lease uuid,
  transport_hash bytea,
  unique (mission_id, device_id)
);
create index challenge_push_pending_time on challenge_room_data.push_deliveries(next_at) where state='pending';
create index challenge_push_device on challenge_room_data.push_deliveries(device_id);
create index challenge_push_open_time on challenge_room_data.missions(opens_at);

create table challenge_room_data.push_tickets (
  token_hash bytea primary key,
  expires_at timestamptz not null
);
create table challenge_room_data.push_vapid (
  singleton boolean primary key default true check (singleton),
  public_key text not null,
  private_key text not null
);
alter table challenge_room_data.push_deliveries enable row level security;
alter table challenge_room_data.push_tickets enable row level security;
alter table challenge_room_data.push_vapid enable row level security;

-- 구독 해지·환불·계정 전환을 배달 직전에 다시 확인한다.
create view challenge_room_data.ready_push as
select j.id, j.next_at, d.endpoint, d.p256dh, d.auth_key,
       m.id as mission_id, m.day_no, r.round, r.challenge
from challenge_room_data.push_deliveries j
join challenge_room_data.devices d on d.id=j.device_id and d.member_id=j.member_id
join challenge_room_data.missions m on m.id=j.mission_id
join public.challenge_rounds r on r.id=m.round_id
join challenge_room_data.subscriptions s on s.round_id=m.round_id and s.device_id=d.id
where j.state='pending' and j.next_at<=now() and j.attempts<6
  and m.opens_at<=now() and m.opens_at>now()-interval '24 hours'
  and j.enabled_at=s.enabled_at and s.enabled_at<=m.opens_at
  and challenge_room_data.eligible(d.member_id,m.round_id);

create function challenge_room_data.push_tick() returns void
language plpgsql security definer set search_path='' as $tick$
declare
  bearer text;
  ticket uuid;
begin
  if not pg_try_advisory_xact_lock(192718364,1126001) then return; end if;

  delete from challenge_room_data.push_tickets where expires_at<=now();
  delete from challenge_room_data.push_deliveries j using challenge_room_data.missions m
    where m.id=j.mission_id and m.opens_at<now()-interval '7 days';
  insert into challenge_room_data.push_deliveries(mission_id,device_id,member_id,enabled_at)
    select m.id,d.id,d.member_id,s.enabled_at
    from challenge_room_data.missions m
    join challenge_room_data.subscriptions s on s.round_id=m.round_id and s.enabled_at<=m.opens_at
    join challenge_room_data.devices d on d.id=s.device_id
    where m.opens_at<=now() and m.opens_at>now()-interval '24 hours'
      and challenge_room_data.eligible(d.member_id,m.round_id)
    on conflict (mission_id,device_id) do nothing;

  if exists(select 1 from challenge_room_data.push_tickets)
     or not exists(select 1 from challenge_room_data.ready_push) then return; end if;

  select secret.decrypted_secret into bearer from vault.decrypted_secrets secret
    where secret.name='monc_anon_jwt';
  if nullif(bearer,'') is null then return; end if;

  ticket:=gen_random_uuid();
  insert into challenge_room_data.push_tickets(token_hash,expires_at)
    values (sha256(convert_to(ticket::text,'UTF8')),now()+interval '90 seconds');
  perform net.http_post(
    url:='https://apzwauiumhmsvrgffjis.supabase.co/functions/v1/challenge-mission-push',
    body:=jsonb_build_object('action','dispatch','token',ticket),
    headers:=jsonb_build_object('content-type','application/json','apikey',bearer,'authorization','Bearer '||bearer),
    timeout_milliseconds:=60000
  );
end
$tick$;
revoke all on function challenge_room_data.push_tick() from public,anon,authenticated,service_role;

create function public.challenge_push_worker(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $worker$
declare
  pub text;
  priv text;
  consumed boolean;
  batch jsonb;
  outcome text;
  job challenge_room_data.push_deliveries%rowtype;
begin
  if p_action='vapid' then
    select v.public_key,v.private_key into pub,priv from challenge_room_data.push_vapid v;
    if not found then
      pub:=p_data->>'publicKey';
      priv:=p_data->>'privateKey';
      if pub is null or pub !~ '^B[A-P][A-Za-z0-9_-]{85}$'
         or priv is null or priv !~ '^[A-Za-z0-9_-]{43}$' then
        raise exception 'challenge_push:invalid_key' using errcode='22023';
      end if;
      insert into challenge_room_data.push_vapid(public_key,private_key) values(pub,priv)
        on conflict (singleton) do nothing;
      select v.public_key,v.private_key into pub,priv from challenge_room_data.push_vapid v;
    end if;
    return jsonb_build_object('publicKey',pub,'privateKey',priv);
  elsif p_action='claim' then
    delete from challenge_room_data.push_tickets
      where token_hash=sha256(convert_to(p_data->>'token','UTF8')) and expires_at>now()
      returning true into consumed;
    if consumed is not true then
      raise exception 'challenge_push:invalid_ticket' using errcode='42501';
    end if;

    with candidates as materialized (
      select ready.* from challenge_room_data.ready_push ready
      join challenge_room_data.push_deliveries locked_job on locked_job.id=ready.id
      order by ready.next_at,ready.id limit 50 for update of locked_job skip locked
    ), claimed as (
      update challenge_room_data.push_deliveries j
      set lease=gen_random_uuid(),next_at=now()+interval '4 minutes',attempts=j.attempts+1,
          transport_hash=sha256(convert_to(concat_ws('|',c.endpoint,c.p256dh,c.auth_key),'UTF8'))
      from candidates c where j.id=c.id and j.state='pending' and j.next_at<=now()
      returning j.id,j.lease,c.mission_id,c.day_no,c.round,c.challenge,c.endpoint,c.p256dh,c.auth_key
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'lease',lease,'mission_id',mission_id,'day_no',day_no,'round',round,'challenge',challenge,
      'endpoint',endpoint,'keys',jsonb_build_object('p256dh',p256dh,'auth',auth_key)
    )),'[]'::jsonb) into batch from claimed;
    return jsonb_build_object('deliveries',batch);
  elsif p_action='finish' then
    outcome:=p_data->>'status';
    if outcome is null or outcome not in ('sent','gone','retry','failed') then
      raise exception 'challenge_push:invalid_status' using errcode='22023';
    end if;
    select * into job from challenge_room_data.push_deliveries j
      where j.id=(p_data->>'id')::uuid and j.lease=(p_data->>'lease')::uuid and j.state='pending'
      for update;
    if not found then return jsonb_build_object('ok',false); end if;

    update challenge_room_data.push_deliveries j
      set state=case when outcome='sent' then 'sent'
                     when outcome='retry' and job.attempts<6 then 'pending' else 'failed' end,
          lease=null,transport_hash=null,
          next_at=now()+interval '1 minute'*(1<<(job.attempts-1))
      where j.id=job.id;
    if outcome='gone' then
      delete from challenge_room_data.devices d where d.id=job.device_id
        and d.member_id=job.member_id
        and sha256(convert_to(concat_ws('|',d.endpoint,d.p256dh,d.auth_key),'UTF8'))=job.transport_hash;
    end if;
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'challenge_push:unknown_action' using errcode='22023';
end
$worker$;
revoke all on function public.challenge_push_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.challenge_push_worker(text,jsonb) to service_role;

select cron.schedule('challenge-room-due-push','* * * * *','select challenge_room_data.push_tick()');

revoke all on all tables in schema challenge_room_data from public, anon, authenticated;
revoke all on all functions in schema challenge_room_data from public, anon, authenticated;
