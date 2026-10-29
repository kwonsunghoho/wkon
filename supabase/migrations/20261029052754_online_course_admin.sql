-- 관리자 편집은 권한 재확인·충돌 검사·이력을 한 트랜잭션으로 처리한다.
begin;
alter table public.online_courses add column revision integer not null default 1;
alter table public.online_lessons add column revision integer not null default 1;
alter table public.online_lessons add column video_name text, add column material_name text;
create table public.online_course_edits (
 id bigint generated always as identity primary key,
 actor_id uuid references auth.users(id) on delete set null,
 course_id text not null references public.online_courses(id),
 action text not null, target_id text not null, changed_fields text[] not null,
 created_at timestamptz not null default now()
);
alter table public.online_course_edits enable row level security;
revoke all on public.online_course_edits from public,anon,authenticated;
grant all on public.online_course_edits to service_role;
grant usage,select on sequence public.online_course_edits_id_seq to service_role;

create function public.oc_admin_save(p_actor uuid,p_course text,p_action text,p jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.online_courses; l public.online_lessons; fields text[];
begin
 if not exists(select 1 from public.members where id=p_actor and role='admin'
  and agreed_at is not null and terms_version='2026-10-05') then
  return jsonb_build_object('ok',false,'error','forbidden'); end if;
 select * into c from public.online_courses where id=p_course for update;
 if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
 if p_action='course' then
  if c.revision is distinct from (p->>'revision')::integer then return jsonb_build_object('ok',false,'error','edit_conflict'); end if;
  if nullif(trim(p->>'title'),'') is null or length(p->>'title')>100
   or length(coalesce(p->>'description',''))>2000 or length(coalesce(p->>'purchase_notice',''))>10000
   or ((p->>'price') is not null and (p->>'price')::bigint not between 1 and 100000000)
   or (p->>'access_days') is null or (p->>'access_days')::integer not between 1 and 730 then
   return jsonb_build_object('ok',false,'error','invalid_fields'); end if;
  if coalesce((p->>'sale_open')::boolean,false) and (not coalesce((p->>'published')::boolean,false)
   or (p->>'price') is null or nullif(trim(p->>'purchase_notice'),'') is null
   or not exists(select 1 from public.online_lessons where course_id=c.id and published)
   or exists(select 1 from public.online_lessons where course_id=c.id and published and (video_path is null or duration_seconds<1))) then
   return jsonb_build_object('ok',false,'error','sale_not_ready'); end if;
  update public.online_courses set title=trim(p->>'title'),description=coalesce(p->>'description',''),
   price=(p->>'price')::integer,access_days=(p->>'access_days')::integer,
   published=coalesce((p->>'published')::boolean,false),sale_open=coalesce((p->>'sale_open')::boolean,false),
   purchase_notice=nullif(trim(p->>'purchase_notice'),''),revision=revision+1 where id=c.id returning * into c;
  fields=array['title','description','price','access_days','published','sale_open','purchase_notice'];
  insert into public.online_course_edits(actor_id,course_id,action,target_id,changed_fields) values(p_actor,c.id,p_action,c.id,fields);
  return jsonb_build_object('ok',true,'course',to_jsonb(c));
 elsif p_action='add' then
  insert into public.online_lessons(course_id,position,chapter,title)
   select c.id,coalesce(max(position),0)+1,'기본 구성','새 강의' from public.online_lessons where course_id=c.id returning * into l;
 elsif p_action='lesson' then
  select * into l from public.online_lessons where id=(p->>'id')::uuid and course_id=c.id for update;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if l.revision is distinct from (p->>'revision')::integer then return jsonb_build_object('ok',false,'error','edit_conflict'); end if;
  if nullif(trim(p->>'title'),'') is null or length(p->>'title')>150 or nullif(trim(p->>'chapter'),'') is null
   or length(p->>'chapter')>100 or (p->>'position') is null or (p->>'position')::integer not between 1 and 10000
   or (p->>'duration_seconds') is null or (p->>'duration_seconds')::integer not between 0 and 86400 then
   return jsonb_build_object('ok',false,'error','invalid_fields'); end if;
  if exists(select 1 from public.online_lessons where course_id=c.id and id<>l.id and position=(p->>'position')::integer) then
   return jsonb_build_object('ok',false,'error','position_taken'); end if;
  if coalesce((p->>'published')::boolean,false) and (nullif(p->>'video_path','') is null or (p->>'duration_seconds')::integer<1) then
   return jsonb_build_object('ok',false,'error','lesson_not_ready'); end if;
  if c.sale_open and not coalesce((p->>'published')::boolean,false) and not exists(select 1 from public.online_lessons where course_id=c.id and id<>l.id and published) then
   return jsonb_build_object('ok',false,'error','last_published_lesson'); end if;
  update public.online_lessons set title=trim(p->>'title'),chapter=trim(p->>'chapter'),position=(p->>'position')::integer,
   duration_seconds=(p->>'duration_seconds')::integer,published=coalesce((p->>'published')::boolean,false),
   video_path=nullif(p->>'video_path',''),material_path=nullif(p->>'material_path',''),
   video_name=nullif(p->>'video_name',''),material_name=nullif(p->>'material_name',''),revision=revision+1
   where id=l.id returning * into l;
 else return jsonb_build_object('ok',false,'error','unknown_action'); end if;
 insert into public.online_course_edits(actor_id,course_id,action,target_id,changed_fields)
  values(p_actor,c.id,p_action,l.id::text,array['title','chapter','position','duration_seconds','published','video_path','material_path']);
 return jsonb_build_object('ok',true,'lesson',to_jsonb(l));
end $$;
revoke execute on function public.oc_admin_save(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.oc_admin_save(uuid,text,text,jsonb) to service_role;
commit;
