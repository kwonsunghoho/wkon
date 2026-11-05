-- 운영 관리자와 모집자의 스터디 관리 권한을 구분하고 처리 이력을 남긴다.
begin;
alter table monc_community.audit add column if not exists details jsonb not null default '{}'::jsonb;
create or replace function monc_community.study_contact(p_study uuid,p_user uuid,p_viewer uuid)
returns jsonb language sql stable set search_path=public,monc_community,pg_temp as $$
 select jsonb_build_object('name',m.name,'phone',m.phone) from public.members m
 where m.id=p_user and monc_community.admin(p_viewer) and (exists(select 1 from monc_community.applications a where a.study_id=p_study and a.user_id=p_user) or exists(select 1 from monc_community.study_members sm where sm.study_id=p_study and sm.user_id=p_user))
 union all
 select jsonb_build_object('name',m.name,'phone',m.phone)
 from monc_community.study_contact_consents c
 join monc_community.studies s on s.id=c.study_id
 join public.members m on m.id=c.user_id
 where not monc_community.admin(p_viewer) and c.study_id=p_study and c.user_id=p_user and s.owner_id=p_viewer
 and c.owner_id=s.owner_id and s.status in ('open','closed')
 and exists(select 1 from monc_community.profiles p where p.user_id=p_viewer and not p.blocked)
 and (exists(select 1 from monc_community.applications a where a.study_id=s.id and a.user_id=c.user_id and a.status='pending')
 or exists(select 1 from monc_community.study_members sm where sm.study_id=s.id and sm.user_id=c.user_id))
$$;
revoke all on function monc_community.study_contact(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function monc_community.profile(p_uid uuid,p_viewer uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform monc_community.actor(p_viewer);
  select jsonb_build_object('id',p.id,'nickname',p.nickname,'goals',p.goals,'bio',p.bio,'schedule',p.schedule,'mode',p.mode,'improve',p.improve,'skills',p.skills,
    'sample_scope',p.sample_scope,'mine',p.user_id=p_viewer,'blocked',p.blocked,
    'certificates',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'airline',c.airline,'year',c.recruit_year,'stage',c.stage,'verified_at',c.verified_at) order by c.verified_at desc) from monc_community.certificates c where c.user_id=p.user_id and c.active),'[]'::jsonb),
    'assessment',(select jsonb_build_object('level',a.level,'skills',a.confirmed_skills,'method',a.method,'date',a.assessed_at,'valid_until',a.valid_until) from monc_community.assessments a where a.user_id=p.user_id and a.active and (a.valid_until is null or a.valid_until>=(now() at time zone 'Asia/Seoul')::date)),
    'samples',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'kind',s.kind,'scope',s.scope,'can_read',p.user_id=p_viewer or s.scope='members' or (s.scope='organizer' and monc_community.admin(p_viewer)) or (s.scope='organizer' and exists(select 1 from monc_community.applications ap join monc_community.studies st on st.id=ap.study_id where ap.user_id=p.user_id and st.owner_id=p_viewer and ap.status in ('pending','accepted')))) order by s.created_at desc) from monc_community.assets s where s.user_id=p.user_id and s.kind<>'proof' and s.state='ready' and (s.expires_at is null or s.expires_at>now()) and (p.user_id=p_viewer or s.scope='members' or (s.scope='organizer' and monc_community.admin(p_viewer)) or (s.scope='organizer' and exists(select 1 from monc_community.applications ap join monc_community.studies st on st.id=ap.study_id where ap.user_id=p.user_id and st.owner_id=p_viewer and ap.status in ('pending','accepted'))))),'[]'::jsonb)) into result
    from monc_community.profiles p where p.user_id=p_uid and (not p.blocked or p.user_id=p_viewer or monc_community.admin(p_viewer));
  return result;
end $$;
create or replace function public.community_asset_access(p_actor uuid,p_id uuid,p_delete boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a monc_community.assets%rowtype;
begin
  perform monc_community.actor(p_actor);
  select * into a from monc_community.assets where id=p_id and state='ready';
  if not found or a.user_id is null or (a.expires_at is not null and a.expires_at<=now()) then raise exception 'community:not_found'; end if;
  if a.kind<>'proof' and a.user_id<>p_actor and not monc_community.admin(p_actor) and exists(select 1 from monc_community.profiles where user_id=a.user_id and blocked) then raise exception 'community:forbidden'; end if;
  if p_delete then
    if a.user_id<>p_actor then raise exception 'community:forbidden'; end if;
  elsif a.kind='proof' then
    if a.user_id<>p_actor and not monc_community.admin(p_actor) then raise exception 'community:forbidden'; end if;
  elsif a.user_id<>p_actor and not (a.scope='members' or (a.scope='organizer' and monc_community.admin(p_actor)) or (a.scope='organizer' and exists(select 1 from monc_community.applications ap join monc_community.studies s on s.id=ap.study_id where ap.user_id=a.user_id and s.owner_id=p_actor and ap.status in ('pending','accepted')))) then raise exception 'community:forbidden'; end if;
  return jsonb_build_object('id',a.id,'path',a.storage_path,'mime',a.mime,'kind',a.kind,'title',a.title);
end $$;
create or replace function public.community_member(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=monc_community.actor(); target uuid:=(p_data->>'id')::uuid; profile_row monc_community.profiles%rowtype; st monc_community.studies%rowtype; ap monc_community.applications%rowtype; po monc_community.posts%rowtype; asset monc_community.assets%rowtype; result jsonb; ids text[]; target_user uuid; is_operator boolean:=monc_community.admin(u); management_action boolean; note text:=trim(coalesce(p_data->>'note','')); lim integer:=30; page_offset integer:=greatest(0,least(100000,coalesce((p_data->>'offset')::integer,0)));
begin
  if p_action='study-save-custom' then p_action:='study-save'; end if;
  management_action:=p_action in ('application-decide','study-guide','study-remove-member','study-transfer','study-close','study-reopen','study-end') or (p_action='study-save' and target is not null);
  if is_operator and management_action then
    if char_length(note) not between 2 and 500 then raise exception 'community:reason_required'; end if;
    insert into monc_community.audit(actor_id,action,target_id,details) values(u,'ops:'||p_action,target,jsonb_build_object('note',note,'decision',p_data->>'decision'));
  end if;
  if p_action='study-manage-list' then
    if not is_operator then raise exception 'community:forbidden'; end if;
    select coalesce(jsonb_agg(t.item order by t.created_at desc,t.id desc),'[]'::jsonb) into result from (
      select s.id,s.created_at,monc_community.study_json(s.id)||jsonb_build_object('owner_nickname',p.nickname,'pending_count',(select count(*) from monc_community.applications a where a.study_id=s.id and a.status='pending')) as item
      from monc_community.studies s left join monc_community.profiles p on p.user_id=s.owner_id
      where (coalesce(p_data->>'status','')='' or s.status=p_data->>'status')
      and (coalesce(p_data->>'q','')='' or strpos(lower(s.title||' '||coalesce(p.nickname,'')),lower(left(p_data->>'q',120)))>0)
      order by s.created_at desc,s.id desc limit lim+1 offset page_offset
    )t;
    return jsonb_build_object('ok',true,'items',result,'limit',lim);
  end if;
  select * into profile_row from monc_community.profiles where user_id=u;
  if p_action='profile' then
    target_user:=case when target is null then u else (select user_id from monc_community.profiles where id=target) end;
    return jsonb_build_object('ok',true,'item',monc_community.profile(target_user,u));
  elsif p_action='profile-save' then
    if coalesce(profile_row.blocked,false) then raise exception 'community:blocked'; end if;
    select coalesce(array_agg(distinct v),'{}') into ids from jsonb_array_elements_text(coalesce(p_data->'skills','[]')) v;
    if not monc_community.skills_valid(ids) then raise exception 'community:bad_skills'; end if;
    insert into monc_community.profiles(user_id,nickname,goals,bio,schedule,mode,improve,skills,sample_scope)
    values(u,trim(p_data->>'nickname'),trim(coalesce(p_data->>'goals','')),trim(coalesce(p_data->>'bio','')),trim(coalesce(p_data->>'schedule','')),trim(coalesce(p_data->>'mode','')),trim(coalesce(p_data->>'improve','')),ids,coalesce(p_data->>'sample_scope','organizer'))
    on conflict(user_id) do update set nickname=excluded.nickname,goals=excluded.goals,bio=excluded.bio,schedule=excluded.schedule,mode=excluded.mode,improve=excluded.improve,skills=excluded.skills,sample_scope=excluded.sample_scope,updated_at=now();
    return jsonb_build_object('ok',true,'item',monc_community.profile(u,u));
  elsif p_action='notices' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]'::jsonb) into result from(select id,kind,title,target_id,read_at,created_at from monc_community.notices where user_id=u order by created_at desc limit 50)t;
    return jsonb_build_object('ok',true,'items',result);
  elsif p_action='notice-read' then
    update monc_community.notices set read_at=now() where user_id=u and (target is null or id=target);
    return jsonb_build_object('ok',true);
  elsif p_action='activity' then
    return jsonb_build_object('ok',true,
      'posts',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'status',p.status,'created_at',p.created_at) order by p.created_at desc) from monc_community.posts p where user_id=u and status<>'deleted'),'[]'::jsonb),
      'comments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'excerpt',left(c.body,100)) order by c.created_at desc) from monc_community.comments c join monc_community.posts p on p.id=c.post_id where c.user_id=u and c.status='published' and p.status='published'),'[]'::jsonb),
      'bookmarks',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title)) from monc_community.bookmarks b join monc_community.posts p on p.id=b.post_id where b.user_id=u and p.status='published'),'[]'::jsonb),
      'applications',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'study_id',a.study_id,'title',s.title,'status',a.status,'created_at',a.created_at) order by a.created_at desc) from monc_community.applications a join monc_community.studies s on s.id=a.study_id where a.user_id=u),'[]'::jsonb),
      'studies',coalesce((select jsonb_agg(monc_community.study_json(m.study_id)||jsonb_build_object('role',m.role)) from monc_community.study_members m where m.user_id=u),'[]'::jsonb),
      'proofs',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'airline',r.airline,'year',r.recruit_year,'stage',r.stage,'status',r.status,'note',r.note,'created_at',r.created_at,'reviewed_at',r.reviewed_at) order by r.created_at desc) from monc_community.proof_requests r where r.user_id=u),'[]'::jsonb));
  elsif p_action='thread-state' then
    return jsonb_build_object('ok',true,'mine',exists(select 1 from monc_community.posts where id=target and user_id=u),'saved',exists(select 1 from monc_community.bookmarks where user_id=u and post_id=target),
      'own_comments',coalesce((select jsonb_agg(id) from monc_community.comments where post_id=target and user_id=u),'[]'::jsonb));
  elsif p_action in ('study-contact-self','study-contact-consent') then
    select * into st from monc_community.studies where id=target for update;
    if not found or st.status not in ('open','closed') then raise exception 'community:study_closed'; end if;
    if profile_row.blocked then raise exception 'community:blocked'; end if;
    if p_action='study-contact-consent' then
      if not exists(select 1 from monc_community.study_members where study_id=target and user_id=u)
      and not exists(select 1 from monc_community.applications where study_id=target and user_id=u and status='pending') then raise exception 'community:forbidden'; end if;
    if p_data->>'contact_consent' is distinct from 'true' then raise exception 'community:contact_consent_required'; end if;
    if p_data->>'contact_owner' is distinct from st.owner_id::text then raise exception 'community:contact_owner_changed'; end if;
    if not exists(select 1 from public.members where id=u and length(trim(coalesce(name,'')))>=2 and regexp_replace(coalesce(phone,''),'[^0-9]','','g') ~ '^01[0-9]{8,9}$') then raise exception 'community:contact_incomplete'; end if;
    insert into monc_community.study_contact_consents(study_id,user_id,owner_id) values(target,u,st.owner_id)
    on conflict(study_id,user_id) do update set owner_id=excluded.owner_id,consented_at=now(),version='2026-11-03';
    end if;
    return jsonb_build_object('ok',true,'contact',(select jsonb_build_object('name',name,'phone',phone) from public.members where id=u),'owner_id',st.owner_id,'owner_nickname',(select nickname from monc_community.profiles where user_id=st.owner_id));
  elsif p_action='study-state' then
    select * into st from monc_community.studies where id=target and (status<>'hidden' or is_operator);
    if not found then raise exception 'community:not_found'; end if;
    return jsonb_build_object('ok',true,'owner',st.owner_id=u,'can_manage',st.owner_id=u or is_operator,'administrator',is_operator,'item',monc_community.study_json(target),'joined',exists(select 1 from monc_community.study_members where study_id=target and user_id=u),'eligible',monc_community.eligible(target,u),
      'contact_shared',exists(select 1 from monc_community.study_contact_consents where study_id=target and user_id=u and owner_id=st.owner_id),
      'member_guide',case when is_operator or exists(select 1 from monc_community.study_members where study_id=target and user_id=u) then st.member_guide else null end,
      'application',(select jsonb_build_object('id',id,'status',status) from monc_community.applications where study_id=target and user_id=u),
      'members',coalesce((select jsonb_agg(jsonb_build_object('profile',monc_community.profile(m.user_id,u),'role',m.role,'contact',monc_community.study_contact(target,m.user_id,u))) from monc_community.study_members m where m.study_id=target),'[]'::jsonb),
      'applications',case when st.owner_id=u or is_operator then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'message',a.message,'status',a.status,'created_at',a.created_at,'profile',monc_community.profile(a.user_id,u),'contact',monc_community.study_contact(target,a.user_id,u)) order by a.created_at desc,a.id desc) from monc_community.applications a where a.study_id=target and a.status='pending'),'[]'::jsonb) else '[]'::jsonb end);
  end if;
  if not (is_operator and management_action) and p_action not in ('post-delete','comment-delete','application-withdraw','study-leave','study-close','asset-delete','proof-withdraw') then
    if profile_row.user_id is null then raise exception 'community:profile_required'; end if;
    if profile_row.blocked then raise exception 'community:blocked'; end if;
  end if;
  if p_action in ('post-save','comment-save','study-save','apply','proof-submit','report') then perform monc_community.rate(u,p_action,case when p_action='post-save' then 15 else 40 end); end if;
  if p_action='post-save' then
    if target is null then
      insert into monc_community.posts(user_id,nickname,category,topic,title,body,airline,recruit_year,stage,source_url)
      values(u,profile_row.nickname,p_data->>'category',coalesce(nullif(p_data->>'topic',''),case when p_data->>'category'='free' then 'free' else 'prep' end),trim(p_data->>'title'),trim(p_data->>'body'),trim(coalesce(p_data->>'airline','')),(p_data->>'year')::integer,trim(coalesce(p_data->>'stage','')),trim(coalesce(p_data->>'source_url',''))) returning id into target;
    else
      update monc_community.posts set title=trim(p_data->>'title'),body=trim(p_data->>'body'),category=p_data->>'category',topic=coalesce(nullif(p_data->>'topic',''),topic),airline=trim(coalesce(p_data->>'airline','')),recruit_year=(p_data->>'year')::integer,stage=trim(coalesce(p_data->>'stage','')),source_url=trim(coalesce(p_data->>'source_url','')),updated_at=now() where id=target and user_id=u and status<>'deleted';
      if not found then raise exception 'community:forbidden'; end if;
    end if;
    return jsonb_build_object('ok',true,'id',target);
  elsif p_action='post-delete' then
    update monc_community.posts set title='삭제된 글',body='삭제된 글입니다.',status='deleted',source_url='',airline='',stage='',recruit_year=null,updated_at=now() where id=target and user_id=u;
    if not found then raise exception 'community:forbidden'; end if;
  elsif p_action='comment-save' then
    select * into po from monc_community.posts where id=(p_data->>'post_id')::uuid and status='published' for share;
    if not found then raise exception 'community:not_found'; end if;
    if p_data->>'parent_id' is not null and not exists(select 1 from monc_community.comments where id=(p_data->>'parent_id')::uuid and post_id=po.id and status='published') then raise exception 'community:bad_parent'; end if;
    insert into monc_community.comments(post_id,user_id,nickname,body,parent_id) values(po.id,u,profile_row.nickname,trim(p_data->>'body'),(p_data->>'parent_id')::uuid) returning id into target;
    if po.user_id<>u then perform monc_community.notify(po.user_id,'thread','내 글에 새 댓글이 달렸어요',po.id); end if;
    select user_id into target_user from monc_community.comments where id=(p_data->>'parent_id')::uuid;
    if target_user<>u and target_user is distinct from po.user_id then perform monc_community.notify(target_user,'thread','내 댓글에 답글이 달렸어요',po.id); end if;
    return jsonb_build_object('ok',true,'id',target);
  elsif p_action='comment-delete' then
    update monc_community.comments set body='삭제된 댓글입니다.',status='deleted' where id=target and user_id=u;
    if not found then raise exception 'community:forbidden'; end if;
  elsif p_action='bookmark' then
    if not exists(select 1 from monc_community.posts where id=target and status='published') then raise exception 'community:not_found'; end if;
    if coalesce((p_data->>'saved')::boolean,true) then insert into monc_community.bookmarks(user_id,post_id) values(u,target) on conflict do nothing;
    else delete from monc_community.bookmarks where user_id=u and post_id=target; end if;
  elsif p_action='study-save' then
    select coalesce(array_agg(distinct v),'{}') into ids from jsonb_array_elements_text(coalesce(p_data->'required_skills','[]')) v;
    if not monc_community.skills_valid(ids) then raise exception 'community:bad_skills'; end if;
    if target is not null then
      select * into st from monc_community.studies where id=target for update;
      if st.owner_id is distinct from u and not is_operator then raise exception 'community:forbidden'; end if;
      if st.status not in ('open','closed') then raise exception 'community:study_closed'; end if;
      if (p_data->>'capacity')::integer<(select count(*) from monc_community.study_members where study_id=target) then raise exception 'community:study_full'; end if;
      update monc_community.studies set title=trim(p_data->>'title'),goals=trim(coalesce(p_data->>'goals','')),mode=p_data->>'mode',location=trim(coalesce(p_data->>'location','')),schedule=trim(p_data->>'schedule'),description=trim(p_data->>'description'),capacity=(p_data->>'capacity')::integer,min_level=coalesce((p_data->>'min_level')::integer,0),require_experience=coalesce((p_data->>'require_experience')::boolean,false),required_skills=ids,updated_at=now() where id=target;
      if exists(select 1 from monc_community.study_members m where m.study_id=target and not monc_community.eligible(target,m.user_id)) then raise exception 'community:not_eligible'; end if;
      update monc_community.studies set
        recruitment_conditions=case when p_data ? 'recruitment_conditions' then monc_community.study_texts(p_data->'recruitment_conditions',10,200) else recruitment_conditions end,
        tags=case when p_data ? 'tags' then monc_community.study_texts(p_data->'tags',5,20) else tags end
      where id=target;
      return jsonb_build_object('ok',true,'id',target);
    end if;
    insert into monc_community.studies(owner_id,title,goals,mode,location,schedule,description,capacity,min_level,require_experience,required_skills)
    values(u,trim(p_data->>'title'),trim(coalesce(p_data->>'goals','')),p_data->>'mode',trim(coalesce(p_data->>'location','')),trim(p_data->>'schedule'),trim(p_data->>'description'),(p_data->>'capacity')::integer,coalesce((p_data->>'min_level')::integer,0),coalesce((p_data->>'require_experience')::boolean,false),ids) returning id into target;
    if not monc_community.eligible(target,u) then raise exception 'community:not_eligible'; end if;
    insert into monc_community.study_members(study_id,user_id,role) values(target,u,'owner');
    update monc_community.studies set
        recruitment_conditions=case when p_data ? 'recruitment_conditions' then monc_community.study_texts(p_data->'recruitment_conditions',10,200) else recruitment_conditions end,
        tags=case when p_data ? 'tags' then monc_community.study_texts(p_data->'tags',5,20) else tags end
      where id=target;
      return jsonb_build_object('ok',true,'id',target);
  elsif p_action='study-guide' then
    update monc_community.studies set member_guide=trim(coalesce(p_data->>'guide','')),updated_at=now() where id=target and (owner_id=u or is_operator) and status in ('open','closed');
    if not found then raise exception 'community:forbidden'; end if;
  elsif p_action='apply' then
    select * into st from monc_community.studies where id=target for update;
    if not found or st.status<>'open' then raise exception 'community:study_closed'; end if;
    if exists(select 1 from monc_community.study_members where study_id=target and user_id=u) then raise exception 'community:already_joined'; end if;
    if not monc_community.eligible(target,u) then raise exception 'community:not_eligible'; end if;
    if (select count(*) from monc_community.study_members where study_id=target)>=st.capacity then raise exception 'community:study_full'; end if;
    select * into ap from monc_community.applications where study_id=target and user_id=u;
    if ap.status='pending' then return jsonb_build_object('ok',true,'id',ap.id,'duplicate',true); end if;
    if p_data->>'contact_consent' is distinct from 'true' then raise exception 'community:contact_consent_required'; end if;
    if p_data->>'contact_owner' is distinct from st.owner_id::text then raise exception 'community:contact_owner_changed'; end if;
    if not exists(select 1 from public.members where id=u and length(trim(coalesce(name,'')))>=2 and regexp_replace(coalesce(phone,''),'[^0-9]','','g') ~ '^01[0-9]{8,9}$') then raise exception 'community:contact_incomplete'; end if;
    insert into monc_community.study_contact_consents(study_id,user_id,owner_id) values(target,u,st.owner_id)
    on conflict(study_id,user_id) do update set owner_id=excluded.owner_id,consented_at=now(),version='2026-11-03';
    insert into monc_community.applications(study_id,user_id,message) values(target,u,trim(p_data->>'message'))
    on conflict(study_id,user_id) do update set message=excluded.message,status='pending',created_at=now(),updated_at=now() returning id into target;
    perform monc_community.notify(st.owner_id,'study','스터디에 새 지원이 들어왔어요',st.id);
    return jsonb_build_object('ok',true,'id',target);
  elsif p_action='application-decide' then
    select study_id into target_user from monc_community.applications where id=target;
    select * into st from monc_community.studies where id=target_user for update;
    if st.owner_id is distinct from u and not is_operator then raise exception 'community:forbidden'; end if;
    select * into ap from monc_community.applications where id=target for update;
    if ap.status<>'pending' then raise exception 'community:already_processed'; end if;
    if st.status<>'open' then raise exception 'community:study_closed'; end if;
    if p_data->>'decision'='accept' then
      if not monc_community.eligible(st.id,ap.user_id) then raise exception 'community:not_eligible'; end if;
      if (select count(*) from monc_community.study_members where study_id=st.id)>=st.capacity then raise exception 'community:study_full'; end if;
      insert into monc_community.study_members(study_id,user_id,role) values(st.id,ap.user_id,'member');
      update monc_community.applications set status='accepted',updated_at=now() where id=ap.id;
      perform monc_community.notify(ap.user_id,'study','스터디 참여가 승인됐어요',st.id);
    elsif p_data->>'decision'='reject' then
      update monc_community.applications set status='rejected',updated_at=now() where id=ap.id;
      perform monc_community.notify(ap.user_id,'study','스터디 지원 결과를 확인해 주세요',st.id);
    else raise exception 'community:bad_action'; end if;
  elsif p_action='application-withdraw' then
    select study_id into target_user from monc_community.applications where id=target and user_id=u;
    perform 1 from monc_community.studies where id=target_user for update;
    update monc_community.applications set status='withdrawn',updated_at=now() where id=target and user_id=u and status='pending';
    if not found then raise exception 'community:already_processed'; end if;
  elsif p_action='study-leave' then
    select * into st from monc_community.studies where id=target for update;
    if st.owner_id=u then raise exception 'community:transfer_required'; end if;
    delete from monc_community.study_members where study_id=target and user_id=u;
    if found and st.status='closed' then perform monc_community.notify(st.owner_id,'study','빈자리가 생겼어요. 다시 모집할 수 있어요.',target); end if;
    update monc_community.applications set status='withdrawn',updated_at=now() where study_id=target and user_id=u and status='accepted';
  elsif p_action='study-remove-member' then
    select * into st from monc_community.studies where id=target for update;
    if st.owner_id is distinct from u and not is_operator then raise exception 'community:forbidden'; end if;
    select user_id into target_user from monc_community.profiles where id=(p_data->>'profile_id')::uuid;
    if target_user is null or target_user=st.owner_id then raise exception 'community:bad_member'; end if;
    delete from monc_community.study_members where study_id=target and user_id=target_user and role='member';
    if not found then raise exception 'community:bad_member'; end if;
    update monc_community.applications set status='removed',updated_at=now() where study_id=target and user_id=target_user and status='accepted';
    insert into monc_community.audit(actor_id,action,target_id) values(u,'study-remove-member',target);
    if st.status='closed' then perform monc_community.notify(st.owner_id,'study','빈자리가 생겼어요. 다시 모집할 수 있어요.',target); end if;
    perform monc_community.notify(target_user,'study','스터디 참여가 종료됐어요',target);
  elsif p_action='study-transfer' then
    select * into st from monc_community.studies where id=target for update;
    if st.owner_id is distinct from u and not is_operator then raise exception 'community:forbidden'; end if;
    select user_id into target_user from monc_community.profiles where id=(p_data->>'profile_id')::uuid;
    if target_user is null or target_user=st.owner_id or not exists(select 1 from monc_community.study_members where study_id=target and user_id=target_user) then raise exception 'community:bad_member'; end if;
    update monc_community.study_members set role='member' where study_id=target and user_id=st.owner_id;
    update monc_community.study_members set role='owner' where study_id=target and user_id=target_user;
    update monc_community.studies set owner_id=target_user,updated_at=now() where id=target;
    perform monc_community.notify(target_user,'study','스터디 모집자 역할을 인계받았어요',target);
  elsif p_action='study-reopen' then
    select * into st from monc_community.studies where id=target for update;
    if st.owner_id is distinct from u and not is_operator then raise exception 'community:forbidden'; end if;
    if st.status<>'closed' then raise exception 'community:study_closed'; end if;
    if (select count(*) from monc_community.study_members where study_id=target)>=st.capacity then raise exception 'community:study_full'; end if;
    if not monc_community.eligible(target,st.owner_id) then raise exception 'community:not_eligible'; end if;
    update monc_community.studies set status='open',updated_at=now() where id=target;
    insert into monc_community.audit(actor_id,action,target_id) values(u,'study-reopen',target);
  elsif p_action in ('study-close','study-end') then
    select * into st from monc_community.studies where id=target for update;
    if st.owner_id is distinct from u and not is_operator then raise exception 'community:forbidden'; end if;
    if st.status not in ('open','closed') or (p_action='study-close' and st.status<>'open') then raise exception 'community:study_closed'; end if;
    update monc_community.studies set status=case when p_action='study-end' then 'ended' else 'closed' end,updated_at=now() where id=target;
    for target_user in select user_id from monc_community.applications where study_id=target and status='pending' loop perform monc_community.notify(target_user,'study','지원한 스터디의 모집이 마감됐어요',target); end loop;
    update monc_community.applications set status='closed',updated_at=now() where study_id=target and status='pending';
    for target_user in select user_id from monc_community.study_members where study_id=target and user_id<>u loop
      perform monc_community.notify(target_user,'study',case when p_action='study-end' then '스터디 활동이 종료됐어요' else '모집이 마감됐어요. 기존 참여는 유지돼요.' end,target);
    end loop;
    insert into monc_community.audit(actor_id,action,target_id) values(u,p_action,target);
  elsif p_action='asset-scope' then
    update monc_community.assets set scope=p_data->>'scope' where id=target and user_id=u and kind<>'proof' and state='ready';
    if not found then raise exception 'community:forbidden'; end if;
  elsif p_action='asset-delete' then
    update monc_community.assets set expires_at=now() where id=target and user_id=u and state='ready';
    if not found then raise exception 'community:forbidden'; end if;
    update monc_community.proof_requests set status='withdrawn',reviewed_at=now() where asset_id=target and status='pending';
  elsif p_action='proof-submit' then
    select * into asset from monc_community.assets where id=(p_data->>'asset_id')::uuid and user_id=u and kind='proof' and state='ready' and (expires_at is null or expires_at>now()) for update;
    if not found then raise exception 'community:bad_asset'; end if;
    insert into monc_community.proof_requests(user_id,airline,recruit_year,stage,asset_id) values(u,trim(p_data->>'airline'),(p_data->>'year')::integer,trim(p_data->>'stage'),asset.id) returning id into target;
    update monc_community.assets set expires_at=null where id=asset.id;
    return jsonb_build_object('ok',true,'id',target);
  elsif p_action='proof-withdraw' then
    update monc_community.proof_requests set status='withdrawn',reviewed_at=now() where id=target and user_id=u and status='pending' returning asset_id into target_user;
    if not found then raise exception 'community:already_processed'; end if;
    update monc_community.assets set expires_at=now() where id=target_user;
  elsif p_action='report' then
    if p_data->>'type'='post' and not exists(select 1 from monc_community.posts where id=target and status='published') then raise exception 'community:not_found';
    elsif p_data->>'type'='comment' and not exists(select 1 from monc_community.comments where id=target and status='published') then raise exception 'community:not_found';
    elsif p_data->>'type'='study' and not exists(select 1 from monc_community.studies where id=target and status<>'hidden') then raise exception 'community:not_found'; end if;
    insert into monc_community.reports(user_id,target_type,target_id,reason) values(u,p_data->>'type',target,trim(p_data->>'reason')) on conflict(user_id,target_type,target_id) do nothing;
  else raise exception 'community:bad_action'; end if;
  return jsonb_build_object('ok',true);
end $$;


commit;
