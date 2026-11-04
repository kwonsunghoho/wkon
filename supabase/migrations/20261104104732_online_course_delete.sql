begin;
-- 실제 파일은 기존 정리 대기열과 Storage API로 삭제한다.
create function public.oc_admin_delete_course(p_actor uuid,p_course text,p_revision integer,p_title text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.online_courses; removed integer;
begin
 if not exists(select 1 from public.members where id=p_actor and role='admin'
  and agreed_at is not null and terms_version='2026-10-05') then
  return jsonb_build_object('ok',false,'error','forbidden'); end if;
 select * into c from public.online_courses where id=p_course for update;
 if not found then return jsonb_build_object('ok',true,'deleted',true); end if;
 if c.revision is distinct from p_revision or c.title is distinct from p_title then
  return jsonb_build_object('ok',false,'error','edit_conflict'); end if;
 if c.published or c.sale_open then return jsonb_build_object('ok',false,'error','course_is_public'); end if;
 if exists(select 1 from public.online_orders where course_id=p_course)
  or exists(select 1 from public.online_enrollments where course_id=p_course)
  or exists(select 1 from public.online_course_feedback where course_id=p_course)
  or exists(select 1 from public.online_feedback_uploads where course_id=p_course) then
  return jsonb_build_object('ok',false,'error','course_has_history'); end if;
 perform pg_advisory_xact_lock(74291029);
 -- 소유한 경로만 예약한다. 다른 강의가 참조하는 파일은 정리 함수가 보존한다.
 insert into public.online_video_cleanup(path)
 select name from storage.objects where bucket_id='online-course-assets'
  and starts_with(name,p_course||'/') and p_course ~ '^[a-zA-Z0-9_-]+$'
 union
 select p from public.online_lessons l cross join lateral unnest(array[l.video_path,l.material_path]) p
  where l.course_id=p_course and starts_with(p,p_course||'/') and p_course ~ '^[a-zA-Z0-9_-]+$'
 on conflict do nothing;
 delete from public.online_course_edits where course_id=p_course;
 delete from public.online_lessons where course_id=p_course;
 get diagnostics removed = row_count;
 delete from public.online_courses where id=p_course;
 return jsonb_build_object('ok',true,'deleted',true,'lessons',removed);
end $$;
revoke all on function public.oc_admin_delete_course(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.oc_admin_delete_course(uuid,text,integer,text) to service_role;
commit;
