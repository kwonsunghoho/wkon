-- 워터마크 사본 자동 정리. 콘솔 Vault에 기존 service_role 키를
-- monc_lab_cleanup_service_role 이름으로 저장한 뒤 실행한다. 키 본문은 SQL에 넣지 않는다.
-- 먼저 lab-file 2026-10-06a와 lab-storage-cleanup 2026-10-06e 이상을 배포한다.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.lab_storage_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  mode text not null check (mode in ('manual', 'scheduled')),
  cutoff timestamptz not null,
  version text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  candidates integer not null default 0,
  candidate_mb numeric not null default 0,
  deleted integer not null default 0,
  code text
);
alter table public.lab_storage_cleanup_runs enable row level security;
revoke all on public.lab_storage_cleanup_runs from anon, authenticated;
grant select, insert, update, delete on public.lab_storage_cleanup_runs to service_role;
create index if not exists lab_storage_cleanup_runs_started_idx
  on public.lab_storage_cleanup_runs(started_at desc);

create or replace function public.monc_run_lab_storage_cleanup()
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  service_key text;
  request_id bigint;
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets where name = 'monc_lab_cleanup_service_role';
  if service_key is null or service_key = '' then
    raise exception 'lab cleanup credential missing';
  end if;

  -- 이 작업의 실행 기록만 30일 보존한다. 학생·결제 데이터에는 접근하지 않는다.
  delete from public.lab_storage_cleanup_runs where started_at < now() - interval '30 days';
  delete from cron.job_run_details
    where jobid in (select jobid from cron.job where jobname = 'lab-watermark-cleanup-daily')
      and end_time < now() - interval '30 days';

  select net.http_post(
    url := 'https://apzwauiumhmsvrgffjis.supabase.co/functions/v1/lab-storage-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key
    ),
    body := '{"scheduled":true}'::jsonb,
    timeout_milliseconds := 120000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function public.monc_run_lab_storage_cleanup() from public, anon, authenticated;
grant execute on function public.monc_run_lab_storage_cleanup() to service_role;

-- UTC 19:00 = 한국 시간 다음 날 오전 04:00. 같은 이름으로 재실행해도 중복 생성되지 않는다.
select cron.schedule('lab-watermark-cleanup-daily', '0 19 * * *',
  'select public.monc_run_lab_storage_cleanup();');

-- 즉시 시험: select public.monc_run_lab_storage_cleanup();
-- 기록 확인: select * from public.lab_storage_cleanup_runs order by started_at desc limit 10;
-- 중지: select cron.alter_job((select jobid from cron.job where jobname = 'lab-watermark-cleanup-daily'), active := false);
