-- 영상 안의 구간 목차와 회원 본인만 읽고 쓰는 강의 필기.
begin;
create function public.oc_valid_chapters(p jsonb,p_duration integer) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb; previous integer:=-1; seconds integer;
begin
 if p is null or jsonb_typeof(p)<>'array' or jsonb_array_length(p)>60 then return false; end if;
 for item in select * from jsonb_array_elements(p) loop
  if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'title') is distinct from 'string' or jsonb_typeof(item->'seconds') is distinct from 'number'
   or nullif(trim(item->>'title'),'') is null or length(item->>'title')>100
   or (item->>'seconds')::numeric<>trunc((item->>'seconds')::numeric) then return false; end if;
  seconds:=(item->>'seconds')::integer;
  if seconds<=previous or seconds<0 or seconds>=p_duration then return false; end if;
  previous:=seconds;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function public.oc_valid_chapters(jsonb,integer) from public,anon,authenticated;
grant execute on function public.oc_valid_chapters(jsonb,integer) to service_role;
alter table public.online_lessons add column chapters jsonb not null default '[]';
alter table public.online_lessons add constraint online_chapters_valid check(public.oc_valid_chapters(chapters,duration_seconds));

create table public.online_course_notes (
 member_id uuid not null references auth.users(id) on delete cascade,
 lesson_id uuid not null references public.online_lessons(id) on delete cascade,
 body text not null default '' check(length(body)<=12000),
 revision integer not null default 0,
 updated_at timestamptz not null default now(),
 primary key(member_id,lesson_id)
);
alter table public.online_course_notes enable row level security;
revoke all on public.online_course_notes from public,anon,authenticated;
grant all on public.online_course_notes to service_role;
create function public.oc_save_note(p_member uuid,p_lesson uuid,p_body text,p_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare n public.online_course_notes;
begin
 if not exists(select 1 from public.members where id=p_member and agreed_at is not null and terms_version='2026-10-05') then return jsonb_build_object('ok',false,'error','consent_required'); end if;
 if p_body is null or length(p_body)>12000 or p_revision is null or p_revision<0 then return jsonb_build_object('ok',false,'error','invalid_note'); end if;
 -- 기존 필기는 수강 종료 뒤에도 본인이 고칠 수 있다. 새 필기는 본인 수강 이력이 필요하다.
 if not exists(select 1 from public.online_course_notes where member_id=p_member and lesson_id=p_lesson)
  and not exists(select 1 from public.online_enrollments e join public.online_lessons l on l.course_id=e.course_id
   where e.member_id=p_member and l.id=p_lesson
    and (not e.admin_preview or exists(select 1 from public.members m where m.id=p_member and m.role='admin'))
    and (l.published or e.admin_preview)) then return jsonb_build_object('ok',false,'error','not_enrolled'); end if;
 insert into public.online_course_notes(member_id,lesson_id) values(p_member,p_lesson) on conflict do nothing;
 select * into n from public.online_course_notes where member_id=p_member and lesson_id=p_lesson for update;
 if n.revision<>p_revision then
  -- 응답이 유실된 같은 저장 요청을 다시 보내도 중복 충돌로 막지 않는다.
  if n.body=p_body then return jsonb_build_object('ok',true,'note',to_jsonb(n)); end if;
  return jsonb_build_object('ok',false,'error','note_conflict'); end if;
 update public.online_course_notes set body=p_body,revision=revision+1,updated_at=now()
  where member_id=p_member and lesson_id=p_lesson returning * into n;
 return jsonb_build_object('ok',true,'note',to_jsonb(n));
end $$;
revoke all on function public.oc_save_note(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.oc_save_note(uuid,uuid,text,integer) to service_role;
create or replace function public.oc_admin_save(p_actor uuid,p_course text,p_action text,p jsonb)
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
  if not public.oc_valid_chapters(coalesce(p->'chapters',l.chapters),(p->>'duration_seconds')::integer) then return jsonb_build_object('ok',false,'error','invalid_chapters'); end if;
  update public.online_lessons set chapters=coalesce(p->'chapters',l.chapters),title=trim(p->>'title'),chapter=trim(p->>'chapter'),position=(p->>'position')::integer,
   duration_seconds=(p->>'duration_seconds')::integer,published=coalesce((p->>'published')::boolean,false),
   video_path=nullif(p->>'video_path',''),material_path=nullif(p->>'material_path',''),
   video_name=nullif(p->>'video_name',''),material_name=nullif(p->>'material_name',''),revision=revision+1
   where id=l.id returning * into l;
 else return jsonb_build_object('ok',false,'error','unknown_action'); end if;
 insert into public.online_course_edits(actor_id,course_id,action,target_id,changed_fields)
  values(p_actor,c.id,p_action,l.id::text,array['title','chapter','position','duration_seconds','published','video_path','material_path','chapters']);
 return jsonb_build_object('ok',true,'lesson',to_jsonb(l));
end $$;

commit;
