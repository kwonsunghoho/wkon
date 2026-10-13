-- 먼저 community-file을 배포한다. 기존 워터마크 정리와 같은 Vault 자격 증명을 사용한다.
-- 파일 경로는 community-private 버킷의 정리 대상만 서버에서 조회한다.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create or replace function public.monc_run_community_cleanup() returns bigint
language plpgsql security definer set search_path='' as $$
declare service_key text; request_id bigint;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name='monc_lab_cleanup_service_role';
  if nullif(service_key,'') is null then raise exception 'community cleanup credential missing'; end if;
  select net.http_post(
    url:='https://apzwauiumhmsvrgffjis.supabase.co/functions/v1/community-file',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||service_key,'apikey',service_key),
    body:='{"action":"cleanup"}'::jsonb,timeout_milliseconds:=120000
  ) into request_id;
  return request_id;
end $$;
revoke all on function public.monc_run_community_cleanup() from public,anon,authenticated;
grant execute on function public.monc_run_community_cleanup() to service_role;
select cron.schedule('community-private-cleanup-hourly','20 * * * *','select public.monc_run_community_cleanup();');
commit;
