-- 한 팀부터 사용하는 비공개 과제방. 참여 권한은 기존 승인 명단에서 매번 확인한다.
begin;
create table monc_community.study_rooms (
  study_id uuid primary key references monc_community.studies(id) on delete cascade
);
create table monc_community.room_tasks (
  id uuid primary key, study_id uuid not null references monc_community.study_rooms on delete cascade,
  week_no integer not null check(week_no>0), question text not null check(length(trim(question)) between 1 and 200),
  due_at timestamptz not null, notice text not null default '' check(length(notice)<=600),
  unique(study_id,week_no)
);
create table monc_community.room_answers (
  id uuid primary key, task_id uuid not null references monc_community.room_tasks on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  body text, file_name text, mime text, storage_path text unique, created_at timestamptz not null default now(),
  unique(task_id,user_id),
  check ((body is not null and length(trim(body)) between 1 and 10000 and file_name is null and mime is null and storage_path is null)
      or (body is null and file_name is not null and length(file_name) between 1 and 255 and mime is not null and storage_path is not null))
);
create table monc_community.room_notes (
  id uuid primary key, answer_id uuid not null references monc_community.room_answers on delete cascade,
  user_id uuid not null references auth.users on delete cascade, body text not null check(length(trim(body)) between 1 and 300),
  created_at timestamptz not null default now()
);
create index room_notes_by_answer on monc_community.room_notes(answer_id,created_at);
alter table monc_community.study_rooms enable row level security;
alter table monc_community.room_tasks enable row level security;
alter table monc_community.room_answers enable row level security;
alter table monc_community.room_notes enable row level security;
revoke all on monc_community.study_rooms,monc_community.room_tasks,monc_community.room_answers,monc_community.room_notes from public,anon,authenticated;

create function monc_community.room_access(room uuid, actor uuid, writing boolean)
returns text language plpgsql security definer set search_path='' as $$
declare member_role text;
begin
  perform monc_community.actor(actor);
  if not exists(select 1 from public.members m where m.id=actor and m.terms_version='2026-10-05') then
    raise exception 'study:forbidden' using errcode='42501';
  end if;
  select m.role into member_role from monc_community.study_rooms r
    join monc_community.studies s on s.id=r.study_id
    join monc_community.study_members m on m.study_id=s.id and m.user_id=actor
    join monc_community.profiles p on p.user_id=m.user_id and not p.blocked
    where r.study_id=room and (s.status in ('open','closed') or (not writing and s.status='ended'))
    for share of s,m,p;
  if member_role is null then raise exception 'study:forbidden' using errcode='42501'; end if;
  return member_role;
end $$;
revoke all on function monc_community.room_access(uuid,uuid,boolean) from public,anon,authenticated;

create function public.study_room(p_room uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); member_role text; target uuid; item uuid; focus_week int; result jsonb;
  task monc_community.room_tasks%rowtype; answer monc_community.room_answers%rowtype;
begin
  if p_action='available' then
    perform monc_community.actor(u);
    return to_jsonb(exists(select 1 from monc_community.study_rooms r join monc_community.studies s on s.id=r.study_id
      join monc_community.study_members m on m.study_id=r.study_id and m.user_id=u
      join monc_community.profiles p on p.user_id=u and not p.blocked where r.study_id=p_room and s.status in ('open','closed','ended')));
  end if;
  member_role:=monc_community.room_access(p_room,u,p_action<>'read');
  if p_action='read' then
    select jsonb_build_object('title',s.title,'status',s.status,'schedule',s.schedule,'role',member_role,
      'members',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.nickname,'mine',m.user_id=u) order by m.joined_at),'[]')
        from monc_community.study_members m join monc_community.profiles p on p.user_id=m.user_id where m.study_id=s.id),
      'tasks',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'week',t.week_no,'question',t.question,'due',t.due_at,'notice',t.notice,
        'answers',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'member',ap.id,'name',ap.nickname,'mine',a.user_id=u,'body',a.body,
          'file_name',a.file_name,'mime',a.mime,'notes',(select coalesce(jsonb_agg(jsonb_build_object('name',np.nickname,'body',n.body)
            order by n.created_at,n.id),'[]') from monc_community.room_notes n join monc_community.profiles np on np.user_id=n.user_id where n.answer_id=a.id))
          order by a.created_at,a.id),'[]') from monc_community.room_answers a join monc_community.profiles ap on ap.user_id=a.user_id where a.task_id=t.id))
        order by t.week_no),'[]') from monc_community.room_tasks t where t.study_id=s.id))
    into result from monc_community.studies s where s.id=p_room;
    return result;
  end if;
  target:=(p_data->>'id')::uuid;
  if p_action in ('create-task','edit-task') then
    if member_role<>'owner' then raise exception 'study:forbidden'; end if;
    perform 1 from monc_community.study_rooms where study_id=p_room for no key update;
    if p_action='create-task' then
      select coalesce(max(week_no),0)+1 into focus_week from monc_community.room_tasks where study_id=p_room;
      insert into monc_community.room_tasks(id,study_id,week_no,question,due_at,notice)
      values(target,p_room,focus_week,btrim(p_data->>'question'),(p_data->>'due')::timestamptz,coalesce(p_data->>'notice',''))
      on conflict(id) do nothing;
    else
      update monc_community.room_tasks set question=btrim(p_data->>'question'),due_at=(p_data->>'due')::timestamptz,
        notice=coalesce(p_data->>'notice','') where id=target and study_id=p_room;
    end if;
    if not exists(select 1 from monc_community.room_tasks where id=target and study_id=p_room) then raise exception 'study:missing'; end if;
  elsif p_action in ('text','upload-check') then
    select * into task from monc_community.room_tasks where study_id=p_room and id=(p_data->>'task')::uuid for share;
    if task.id is null then raise exception 'study:missing'; end if;
    select * into answer from monc_community.room_answers where task_id=task.id and user_id=u;
    if answer.id=target then return jsonb_build_object('id',target,'saved',true); end if;
    if answer.id is not null then raise exception 'study:already_submitted'; end if;
    if task.due_at<now() then raise exception 'study:deadline'; end if;
    if p_action='upload-check' then
      perform monc_community.room_access(p_room,u,true);
      return jsonb_build_object('saved',false);
    end if;
    insert into monc_community.room_answers(id,task_id,user_id,body) values(target,task.id,u,btrim(p_data->>'body'));
  elsif p_action='note' then
    item:=(p_data->>'answer')::uuid;
    select a.* into answer from monc_community.room_answers a join monc_community.room_tasks t on t.id=a.task_id
      where t.study_id=p_room and a.id=item;
    if answer.id is null or answer.user_id=u then raise exception 'study:forbidden'; end if;
    insert into monc_community.room_notes(id,answer_id,user_id,body) values(target,item,u,btrim(p_data->>'body'))
      on conflict(id) do nothing;
    if not exists(select 1 from monc_community.room_notes where id=target and answer_id=item and user_id=u) then raise exception 'study:missing'; end if;
  else raise exception 'study:bad_action';
  end if;
  return jsonb_build_object('id',target);
end $$;
revoke all on function public.study_room(uuid,text,jsonb) from public,anon;
grant execute on function public.study_room(uuid,text,jsonb) to authenticated;

-- 파일은 인증한 서버가 업로드한 뒤에만 과제와 연결한다.
insert into storage.buckets(id,name,public,file_size_limit) values('study-room-private','study-room-private',false,41943040);
create function public.study_room_file(p_actor uuid,p_room uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target uuid:=(p_data->>'id')::uuid; task monc_community.room_tasks%rowtype;
  answer monc_community.room_answers%rowtype;
begin
  perform monc_community.room_access(p_room,p_actor,p_action='attach');
  if p_action='attach' then
    select * into task from monc_community.room_tasks where study_id=p_room and id=(p_data->>'task')::uuid for share;
    if task.id is null then raise exception 'study:missing'; end if;
    select * into answer from monc_community.room_answers where user_id=p_actor and task_id=task.id;
    if answer.id=target then return jsonb_build_object('path',answer.storage_path); end if;
    if task.due_at<now() then raise exception 'study:deadline'; end if;
    insert into monc_community.room_answers(id,task_id,user_id,file_name,mime,storage_path)
      values(target,task.id,p_actor,p_data->>'name',p_data->>'mime',p_data->>'path');
    return jsonb_build_object('path',p_data->>'path');
  elsif p_action='read' then
    select a.* into answer from monc_community.room_answers a join monc_community.room_tasks t on t.id=a.task_id
      where a.id=target and t.study_id=p_room and a.storage_path is not null;
    if answer.id is not null then return jsonb_build_object('path',answer.storage_path,'name',answer.file_name,'mime',answer.mime); end if;
  end if;
  raise exception 'study:missing';
end $$;
revoke all on function public.study_room_file(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.study_room_file(uuid,uuid,text,jsonb) to service_role;
commit;