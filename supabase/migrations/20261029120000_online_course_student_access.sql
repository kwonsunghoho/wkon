begin;
alter table public.online_enrollments add column academy_free boolean not null default false;
alter table public.online_enrollments drop constraint online_enrollment_origin;
alter table public.online_enrollments add constraint online_enrollment_origin check (
 (admin_preview and not academy_free and payment_id is null) or
 (academy_free and not admin_preview and payment_id is null) or
 (not admin_preview and not academy_free and payment_id is not null));
create unique index online_academy_free_unique on public.online_enrollments(member_id,course_id) where academy_free;
create function public.oc_course_access(p_member uuid,p_course text,p_claim boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.online_enrollments; c public.online_courses; student boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_member::text||':'||p_course,0));
 if not exists(select 1 from public.members where id=p_member and agreed_at is not null and terms_version='2026-10-05') then return jsonb_build_object('ok',false,'error','consent_required'); end if;
 select * into e from public.online_enrollments where member_id=p_member and course_id=p_course and not admin_preview and revoked_at is null and (expires_at is null or expires_at>now()) order by created_at desc limit 1;
 if found then return jsonb_build_object('ok',true,'enrollmentId',e.id,'kind','enrolled'); end if;
 select exists(select 1 from public.members m join public.academy_students s on s.phone_norm=public.monc_norm_phone(m.phone) where m.id=p_member and m.verified_at is not null and s.status='approved' and s.valid_until>=current_date) into student;
 if not student then return jsonb_build_object('ok',true,'kind','purchase'); end if;
 select * into e from public.online_enrollments where member_id=p_member and course_id=p_course and academy_free;
 if found then return jsonb_build_object('ok',true,'kind','expired'); end if;
 select * into c from public.online_courses where id=p_course and published;
 if not found or c.access_days is null then return jsonb_build_object('ok',false,'error','not_published'); end if;
 if not p_claim then return jsonb_build_object('ok',true,'kind','student'); end if;
 insert into public.online_enrollments(member_id,course_id,access_days,academy_free) values(p_member,p_course,c.access_days,true) returning * into e;
 return jsonb_build_object('ok',true,'kind','enrolled','enrollmentId',e.id);
end $$;
revoke all on function public.oc_course_access(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.oc_course_access(uuid,text,boolean) to service_role;
commit;
