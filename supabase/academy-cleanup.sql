-- 운영자가 UI 승인·마이그레이션·함수 배포·삭제 대상 확인 후 SQL Editor에서 실행한다.
-- Vault: monc_media_cleanup_secret(함수 MEDIA_CLEANUP_SECRET과 동일), monc_anon_jwt(legacy anon JWT).
-- 비밀값은 Supabase 콘솔에서 등록한다. 레포나 스케줄 본문에 넣지 않는다.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='monc_media_cleanup_secret')
    or not exists(select 1 from vault.decrypted_secrets where name='monc_anon_jwt') then
    raise exception 'Vault에 정리 작업용 비밀값 두 개를 먼저 등록하세요.';
  end if;
end $$;
select cron.unschedule(jobid) from cron.job where jobname='monc-media-cleanup';
select cron.schedule('monc-media-cleanup','*/10 * * * *', $job$
  select net.http_post(
    url:='https://apzwauiumhmsvrgffjis.supabase.co/functions/v1/academy-media',
    headers:=jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='monc_anon_jwt' limit 1),
      'x-cleanup-secret',(select decrypted_secret from vault.decrypted_secrets where name='monc_media_cleanup_secret' limit 1)
    ),body:='{"action":"cleanup"}'::jsonb,timeout_milliseconds:=60000
  );
$job$);
commit;
-- 완료 기준: cron.job active=true, net._http_response 해당 요청 status_code=200.
-- 중단: select cron.unschedule(jobid) from cron.job where jobname='monc-media-cleanup';
-- 중단으로 삭제 파일은 복원되지 않는다. 글·첨삭·제출 행은 삭제하지 않는다.
