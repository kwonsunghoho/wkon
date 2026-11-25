-- 공개 닉네임은 그대로 두고 기존 관리자 목록에만 작성 계정의 이름을 표시한다.
-- 탈퇴 또는 미등록인 경우에도 게시글을 보존하며, 본인인증 여부를 따로 표시한다.
create or replace function public.community_operator(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=monc_community.actor(); target uuid:=nullif(p_data->>'id','')::uuid;
 profile_id uuid:=nullif(p_data->>'profile_id','')::uuid;
 q text:=left(trim(coalesce(p_data->>'q','')),100); st text:=coalesce(p_data->>'status','');
 filter_topic text:=coalesce(p_data->>'topic',''); off integer:=greatest(0,least(coalesce((p_data->>'offset')::integer,0),100000));
 rows jsonb; item jsonb; result jsonb; prior text; label text; affected integer; owner_id uuid;
 note text:=trim(coalesce(p_data->>'note','')); kind text:=p_data->>'type'; report_row monc_community.reports%rowtype;
begin
 if not monc_community.admin(u) then raise exception 'community:forbidden' using errcode='42501'; end if;
 if p_action='overview' then
  return jsonb_build_object('ok',true,'version','2026-10-15a',
   'proofs',(select count(*) from monc_community.proof_requests where status='pending'),
   'reports',(select count(*) from monc_community.reports where status='pending'),
   'posts',(select count(*) from monc_community.posts where status='published'),
   'studies',(select count(*) from monc_community.studies where status='open'),
   'assessed',(select count(*) from monc_community.assessments where active and (valid_until is null or valid_until>=current_date)));
 elsif p_action='posts' then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (
   select p.id,p.topic,p.title,p.body,p.nickname,p.status,p.created_at,
    nullif(btrim(m.name),'') as author_real_name,
    (m.verified_at is not null and nullif(btrim(m.name),'') is not null) as author_name_verified,
    (select count(*) from monc_community.comments c where c.post_id=p.id) comments
   from monc_community.posts p
   left join public.members m on m.id=p.user_id
   where (st='' or p.status=st) and (filter_topic='' or p.topic=filter_topic)
    and (q='' or p.title ilike '%'||q||'%' or p.body ilike '%'||q||'%' or p.nickname ilike '%'||q||'%') order by p.created_at desc,p.id desc limit 31 offset off)t;
 elsif p_action='comments' then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (
   select c.id,c.post_id,c.nickname,c.body,c.status,c.created_at,p.title from monc_community.comments c join monc_community.posts p on p.id=c.post_id
   where (st='' or c.status=st) and (q='' or c.body ilike '%'||q||'%' or c.nickname ilike '%'||q||'%') order by c.created_at desc,c.id desc limit 31 offset off)t;
 elsif p_action='studies' then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (
   select s.id,s.title,s.description,s.mode,s.location,s.schedule,s.status,s.capacity,s.created_at,p.nickname,
    (select count(*) from monc_community.study_members m where m.study_id=s.id) members,
    s.min_level,s.require_experience,s.required_skills
   from monc_community.studies s left join monc_community.profiles p on p.user_id=s.owner_id
   where (st='' or s.status=st) and (q='' or s.title ilike '%'||q||'%' or s.description ilike '%'||q||'%' or p.nickname ilike '%'||q||'%') order by s.created_at desc,s.id desc limit 31 offset off)t;
 elsif p_action='proofs' then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (
   select r.id,r.airline,r.recruit_year,r.stage,r.asset_id,r.status,r.note,r.created_at,r.reviewed_at,
    p.nickname,p.id profile_id,m.name member_name,a.mime,a.state asset_state,a.expires_at
   from monc_community.proof_requests r join monc_community.profiles p on p.user_id=r.user_id
   join public.members m on m.id=r.user_id join monc_community.assets a on a.id=r.asset_id
   where (st='' or r.status=st) and (q='' or p.nickname ilike '%'||q||'%' or m.name ilike '%'||q||'%')
   order by r.created_at,r.id limit 31 offset off)t;
 elsif p_action='profiles' then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (
   select p.id,p.nickname,p.blocked,p.created_at,m.name member_name,monc_community.skill_level(p.user_id) level,
    (select to_jsonb(a)-'user_id'-'assessed_by' from monc_community.assessments a where a.user_id=p.user_id) assessment,
    coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'airline',c.airline,'year',c.recruit_year,'stage',c.stage)) from monc_community.certificates c where c.user_id=p.user_id and c.active),'[]') certificates
   from monc_community.profiles p join public.members m on m.id=p.user_id
   where q<>'' and (p.nickname ilike '%'||q||'%' or m.name ilike '%'||q||'%') order by p.created_at desc limit 31 offset off)t;
 elsif p_action='reports' then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (
   select r.id,r.target_type,r.target_id,r.reason,r.status,r.decision,r.created_at,r.resolved_at,p.nickname,
    case r.target_type when 'post' then (select title||E'\n'||body from monc_community.posts where id=r.target_id)
      when 'comment' then (select body from monc_community.comments where id=r.target_id)
      else (select title||E'\n'||description from monc_community.studies where id=r.target_id) end content
   from monc_community.reports r left join monc_community.profiles p on p.user_id=r.user_id
   where (st='' or r.status=st) and (q='' or r.reason ilike '%'||q||'%' or p.nickname ilike '%'||q||'%') order by r.created_at,r.id limit 31 offset off)t;
 elsif p_action='history' then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (
   select a.id,a.action,a.target_id,a.details,a.created_at,coalesce(m.name,'탈퇴한 운영자') actor
   from monc_community.audit a left join public.members m on m.id=a.actor_id where a.action like 'ops:%'
   order by a.created_at desc,a.id desc limit 31 offset off)t;
 elsif p_action='guides' then
  select coalesce(jsonb_agg(to_jsonb(g)-'updated_by' order by scope),'[]') into rows from monc_community.board_guides g;
 elsif p_action='guide-save' then
  if char_length(note)<2 or char_length(note)>500 then raise exception 'community:reason_required'; end if;
  insert into monc_community.board_guides(scope,title,body,active,updated_by) values(p_data->>'scope',trim(p_data->>'title'),trim(p_data->>'body'),coalesce((p_data->>'active')::boolean,false),u)
   on conflict(scope) do update set title=excluded.title,body=excluded.body,active=excluded.active,updated_by=u,updated_at=now();
  label:=p_data->>'title';
 elsif p_action='moderate' then
  if char_length(note)<2 or char_length(note)>500 then raise exception 'community:reason_required'; end if;
  if kind not in ('post','comment','study') or kind is null or p_data->>'decision' not in ('hide','restore') or p_data->>'decision' is null then raise exception 'community:bad_action'; end if;
  if kind='post' then
   select status,title,user_id into prior,label,owner_id from monc_community.posts where id=target for update;
   if prior is null or prior='deleted' then raise exception 'community:not_found'; end if;
   if (p_data->>'decision'='hide' and prior='hidden') or (p_data->>'decision'='restore' and prior<>'hidden') then raise exception 'community:already_processed'; end if;
   update monc_community.posts set status=case when p_data->>'decision'='hide' then 'hidden' else 'published' end,updated_at=now() where id=target;
  elsif kind='comment' then
   select status,left(body,80),user_id into prior,label,owner_id from monc_community.comments where id=target for update;
   if prior is null or prior='deleted' then raise exception 'community:not_found'; end if;
   if (p_data->>'decision'='hide' and prior='hidden') or (p_data->>'decision'='restore' and prior<>'hidden') then raise exception 'community:already_processed'; end if;
   update monc_community.comments set status=case when p_data->>'decision'='hide' then 'hidden' else 'published' end where id=target;
  else
   select s.status,s.title,s.owner_id into prior,label,owner_id from monc_community.studies s where s.id=target for update;
   if prior is null then raise exception 'community:not_found'; end if;
   if (p_data->>'decision'='hide' and prior='hidden') or (p_data->>'decision'='restore' and prior<>'hidden') then raise exception 'community:already_processed'; end if;
   update monc_community.studies set moderation_previous_status=case when prior<>'hidden' then prior else moderation_previous_status end,
    status=case when p_data->>'decision'='hide' then 'hidden' else coalesce(moderation_previous_status,'closed') end,updated_at=now() where id=target;
   if p_data->>'decision'='hide' then update monc_community.applications set status='closed',updated_at=now() where study_id=target and status='pending'; end if;
  end if;
  if owner_id is not null then perform monc_community.notify(owner_id,'moderation','콘텐츠 운영 조치: '||note,target); end if;
 elsif p_action in ('proof-decide','assessment-save','assessment-revoke','certificate-revoke','report-resolve','member-block') then
  if char_length(note)<2 or char_length(note)>500 then raise exception 'community:reason_required'; end if;
  if p_action='proof-decide' and p_data->>'decision'='approve' and coalesce(p_data->'checks','[]'::jsonb)<>'[true,true,true]'::jsonb then raise exception 'community:checks_required'; end if;
  if p_action in ('assessment-revoke','member-block') and not exists(select 1 from monc_community.profiles where id=profile_id) then raise exception 'community:not_found'; end if;
  if p_action='assessment-revoke' and not exists(select 1 from monc_community.assessments a join monc_community.profiles p on p.user_id=a.user_id where p.id=profile_id and a.active) then raise exception 'community:already_processed'; end if;
  if p_action='report-resolve' and p_data->>'decision'='hide' then
   select * into report_row from monc_community.reports where id=target for update;
   if report_row.target_type='post' then
    select p.status into prior from monc_community.posts p where p.id=report_row.target_id for update;
    if prior is null or prior='deleted' then raise exception 'community:not_found'; end if;
   elsif report_row.target_type='comment' then
    select c.status into prior from monc_community.comments c where c.id=report_row.target_id for update;
    if prior is null or prior='deleted' then raise exception 'community:not_found'; end if;
   elsif report_row.target_type='study' then
    update monc_community.studies set moderation_previous_status=status where id=report_row.target_id and status<>'hidden';
   end if;
   target:=(p_data->>'id')::uuid;
  end if;
  if nullif(p_data->>'id','') is null then p_data:=p_data-'id'; end if;
  result:=public.community_admin(p_action,p_data);
  label:=coalesce(p_data->>'label',p_action);
 else raise exception 'community:bad_action'; end if;
 if rows is not null then return jsonb_build_object('ok',true,'items',rows,'offset',off,'limit',30); end if;
 insert into monc_community.audit(actor_id,action,target_id,details) values(u,'ops:'||p_action,coalesce(target,profile_id),jsonb_build_object('note',note,'label',left(coalesce(label,''),120),'type',kind,'decision',p_data->>'decision','scope',p_data->>'scope','blocked',p_data->'blocked','level',p_data->'level','skills',p_data->'skills','method',p_data->>'method','date',p_data->>'date','valid_until',p_data->>'valid_until','active',p_data->'active','previous_status',prior));
 return jsonb_build_object('ok',true);
end $$;

create or replace function monc_community.experience_operator_read(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $author_list$
declare
  u uuid := monc_community.actor();
  q text := lower(left(trim(coalesce(p_data->>'q','')),100));
  filter_status text := coalesce(p_data->>'status','');
  filter_kind text := coalesce(p_data->>'kind','');
  skip integer := greatest(0,least(coalesce((p_data->>'offset')::integer,0),100000));
  items jsonb;
begin
  if not monc_community.admin(u) then
    raise exception 'community:forbidden' using errcode='42501';
  end if;

  with page as (
    select p.id,p.title,p.body,p.nickname,p.status,p.created_at,
      nullif(btrim(m.name),'') as author_real_name,
      (m.verified_at is not null and nullif(btrim(m.name),'') is not null) as author_name_verified,
      e.kind,e.airline,e.stage,e.subject,e.recruit_year,e.half
    from monc_community.interview_experiences e
    join monc_community.posts p on p.id=e.post_id
    left join public.members m on m.id=p.user_id
    where (filter_status='' or p.status=filter_status)
      and (filter_kind='' or e.kind=filter_kind)
      and (q='' or strpos(lower(concat_ws(' ',p.title,p.body,p.nickname,e.airline,e.stage,e.subject)),q)>0)
    order by p.created_at desc,p.id desc
    limit 31 offset skip
  )
  select coalesce(jsonb_agg(to_jsonb(page) || jsonb_build_object('votes',(
    select count(*) from monc_community.interview_experience_votes v
    where v.post_id=page.id and v.active
  )) order by page.created_at desc,page.id desc),'[]'::jsonb)
  into items from page;

  return jsonb_build_object('ok',true,'items',items,'limit',30);
end $author_list$;

revoke all on function public.community_operator(text,jsonb) from public,anon;
grant execute on function public.community_operator(text,jsonb) to authenticated;
revoke all on function monc_community.experience_operator_read(jsonb) from public,anon;
grant execute on function monc_community.experience_operator_read(jsonb) to authenticated;
