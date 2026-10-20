-- 비회원 채용 접수. 외부 직접 쓰기 금지, 관리자만 조회·상태 변경.
begin;
create table public.talent_applications (
 id uuid primary key,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '90 days',
 name text not null check(char_length(name) between 1 and 50),
 phone text not null check(phone ~ '^0[0-9]{8,10}$'),
 email text not null check(char_length(email) between 3 and 254),
 experience text not null check(char_length(experience) between 1 and 2000),
 strength text not null check(char_length(strength) between 1 and 500),
 approach text not null check(char_length(approach) between 1 and 500),
 education text not null check(char_length(education) between 1 and 300),
 coaching text not null check(char_length(coaching) between 1 and 1000),
 availability text not null check(char_length(availability) between 1 and 1000),
 feedback text not null check(char_length(feedback) between 1 and 500),
 responsibility text not null check(char_length(responsibility) between 1 and 500),
 consent_at timestamptz not null default now(),
 consent_version text not null check(consent_version='talent-2026-10-17'),
 contact_hash text not null, ip_hash text not null,
 status text not null default 'new' check(status in ('new','reviewing','interview','closed'))
);
alter table public.talent_applications enable row level security;
revoke all on public.talent_applications from anon, authenticated;
grant select on public.talent_applications to authenticated;
grant update(status) on public.talent_applications to authenticated;
grant all on public.talent_applications to service_role;
create policy talent_admin_read on public.talent_applications for select to authenticated using(public.is_admin() and expires_at>now());
create policy talent_admin_update on public.talent_applications for update to authenticated using(public.is_admin() and expires_at>now()) with check(public.is_admin() and expires_at>now());
create index talent_recent on public.talent_applications(created_at desc);
create index talent_expiry on public.talent_applications(expires_at);
create index talent_contact on public.talent_applications(contact_hash,created_at);
create index talent_ip on public.talent_applications(ip_hash,created_at);
-- 서버 함수에서만 호출한다. 기본 PUBLIC 실행 권한을 제거한다.
create function public.submit_talent_application(p_id uuid,p_name text,p_phone text,p_email text,p_experience text,p_strength text,p_approach text,p_education text,p_coaching text,p_availability text,p_feedback text,p_responsibility text,p_contact_hash text,p_ip_hash text)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(710171001);
 if exists(select 1 from public.talent_applications where id=p_id) then
   -- 재시도는 접수번호만 반환하며 개인정보를 반환하지 않는다.
   return p_id;
 end if;
 if (select count(*) from public.talent_applications where created_at>now()-interval '1 hour' and ip_hash=p_ip_hash)>=5
 or (select count(*) from public.talent_applications where created_at>now()-interval '1 day' and contact_hash=p_contact_hash)>=3
 or (select count(*) from public.talent_applications where created_at>now()-interval '1 day')>=200 then
   raise exception 'rate_limited' using errcode='P0001';
 end if;
 insert into public.talent_applications(id,name,phone,email,experience,strength,approach,education,coaching,availability,feedback,responsibility,consent_version,contact_hash,ip_hash)
 values(p_id,p_name,p_phone,p_email,p_experience,p_strength,p_approach,p_education,p_coaching,p_availability,p_feedback,p_responsibility,'talent-2026-10-17',p_contact_hash,p_ip_hash);
 return p_id;
end; $$;
revoke all on function public.submit_talent_application(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_talent_application(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text) to service_role;
-- 보유기간 만료 후 최대 한 시간 이내에 원본과 스팸 방지 해시를 함께 파기한다.
create extension if not exists pg_cron;
select cron.schedule('talent-expiry-hourly','17 * * * *',$job$delete from public.talent_applications where expires_at<=now();$job$);
commit;
