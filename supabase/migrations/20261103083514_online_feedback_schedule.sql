-- 기존 Vault 서버 키를 재사용한다. 비밀값은 코드나 클라이언트로 내보내지 않는다.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create or replace function public.monc_run_feedback_operations()
returns bigint language plpgsql security definer set search_path='' as $$
declare k text; request_id bigint;
begin
 select decrypted_secret into k from vault.decrypted_secrets where name='monc_lab_cleanup_service_role';
 if k is null or k='' then raise exception 'feedback schedule credential missing'; end if;
 select net.http_post(url:='https://apzwauiumhmsvrgffjis.supabase.co/functions/v1/online-course-feedback',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||k,'apikey',k),
 body:='{"action":"scheduled"}'::jsonb,timeout_milliseconds:=120000) into request_id;
 return request_id;
end $$;
revoke all on function public.monc_run_feedback_operations() from public,anon,authenticated;
grant execute on function public.monc_run_feedback_operations() to service_role;
select cron.schedule('online-feedback-operations','*/15 * * * *','select public.monc_run_feedback_operations();');
