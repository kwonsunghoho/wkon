-- 모집글·지원 내역은 보존하고 팀원 또는 제출 기록이 있는 방은 삭제하지 않는다.
create or replace function monc_community.room_unrecruited(room uuid)
returns boolean language sql stable set search_path = '' as $$
  select not exists(select 1 from monc_community.study_members where study_id=room and role <> 'owner')
     and not exists(select 1 from monc_community.applications where study_id=room and status in ('accepted','removed'))
     and not exists(select 1 from monc_community.room_tasks t join monc_community.room_answers a on a.task_id=t.id where t.study_id=room)
$$;
revoke all on function monc_community.room_unrecruited(uuid) from public, anon, authenticated;

create or replace function public.study_room_entries(p_ids uuid[])
returns table(room_id uuid, can_delete boolean)
language sql stable security definer set search_path = '' as $$
  with viewer as (
    select m.id, monc_community.admin(m.id) as admin, p.user_id is not null as has_profile
    from public.members m left join monc_community.profiles p on p.user_id=m.id
    where m.id=auth.uid() and m.agreed_at is not null and nullif(m.phone,'') is not null
      and m.terms_version='2026-10-05' and not coalesce(p.blocked,false)
  )
  select r.study_id, case when v.admin then monc_community.room_unrecruited(r.study_id) else false end
  from monc_community.study_rooms r join monc_community.studies s on s.id=r.study_id cross join viewer v
  where r.study_id=any(p_ids) and (v.admin or (v.has_profile and s.status in ('open','closed','ended')
    and exists(select 1 from monc_community.study_members m where m.study_id=r.study_id and m.user_id=v.id)))
$$;
revoke all on function public.study_room_entries(uuid[]) from public,anon;
grant execute on function public.study_room_entries(uuid[]) to authenticated;

CREATE OR REPLACE FUNCTION monc_community.room_access(room uuid, actor uuid, writing boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if member_role is null and not writing and monc_community.admin(actor)
     and not exists(select 1 from monc_community.profiles where user_id=actor and blocked)
     and exists(select 1 from monc_community.study_rooms where study_id=room) then
    return 'observer';
  end if;
  if member_role is null then raise exception 'study:forbidden' using errcode='42501'; end if;
  return member_role;
end $function$
;
CREATE OR REPLACE FUNCTION public.study_room(p_room uuid, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  u uuid:=auth.uid(); member_role text; target uuid; item uuid; focus_week int; result jsonb;
  task monc_community.room_tasks%rowtype; answer monc_community.room_answers%rowtype;
begin
  if p_action='available' then
    perform monc_community.actor(u);
    return to_jsonb(exists(select 1 from public.study_room_entries(array[p_room])));
  end if;
  if p_action='delete-unrecruited' then
    perform monc_community.actor(u);
    if not monc_community.admin(u) or not exists(
       select 1 from public.members m where m.id=u and m.terms_version='2026-10-05'
    ) or exists(select 1 from monc_community.profiles where user_id=u and blocked) then
      raise exception 'study:forbidden' using errcode='42501';
    end if;
    perform 1 from monc_community.studies where id=p_room for update;
    perform 1 from monc_community.study_rooms where study_id=p_room for update;
    if not found then return jsonb_build_object('deleted',true); end if;
    if not monc_community.room_unrecruited(p_room) then
      raise exception 'study:has_recruits';
    end if;
    delete from monc_community.study_rooms where study_id=p_room;
    insert into monc_community.audit(actor_id,action,target_id) values(u,'ops:delete-unrecruited-room',p_room);
    return jsonb_build_object('deleted',true);
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
end $function$
;