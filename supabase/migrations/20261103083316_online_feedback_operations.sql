-- 피드백 답변 영업일·사이트 알림·영상 보관. 직접 회원 접근은 허용하지 않는다.
begin;
create table public.online_feedback_holidays(day date primary key, name text not null);
create table public.online_feedback_calendar(year integer primary key);
alter table public.online_course_feedback add column reply_due_at timestamptz;
alter table public.online_feedback_uploads add column cleanup_started_at timestamptz,
 add column deleted_at timestamptz, add column cleanup_error text;
create table public.online_feedback_notifications(
 id uuid primary key default gen_random_uuid(), member_id uuid not null references auth.users(id) on delete cascade,
 feedback_id uuid not null references public.online_course_feedback(id) on delete cascade,
 kind text not null check(kind in ('submitted','received','replied','due','overdue')),
 title text not null, body text not null, admin_only boolean not null default false,
 created_at timestamptz not null default now(), read_at timestamptz,
 email_state text not null default 'pending' check(email_state in ('pending','sending','sent','failed','skipped')),
 email_attempts integer not null default 0, email_claimed_at timestamptz, email_sent_at timestamptz, email_error text,
 unique(member_id,feedback_id,kind)
);
create index online_feedback_notifications_owner on public.online_feedback_notifications(member_id,created_at desc);
create table public.online_feedback_jobs(
 id uuid primary key default gen_random_uuid(), started_at timestamptz not null default now(), finished_at timestamptz,
 deleted integer not null default 0, sent integer not null default 0, error text
);
alter table public.online_feedback_holidays enable row level security;
alter table public.online_feedback_calendar enable row level security;
alter table public.online_feedback_notifications enable row level security;
alter table public.online_feedback_jobs enable row level security;
revoke all on public.online_feedback_holidays,public.online_feedback_calendar,public.online_feedback_notifications,public.online_feedback_jobs from public,anon,authenticated;
grant all on public.online_feedback_holidays,public.online_feedback_calendar,public.online_feedback_notifications,public.online_feedback_jobs to service_role;

create function public.oc_feedback_due(p_at timestamptz) returns timestamptz
language plpgsql stable security invoker set search_path='' as $$
declare d date:=(p_at at time zone 'Asia/Seoul')::date; n integer:=0;
begin
 while n<5 loop
  d:=d+1;
  -- 달력 미등록 연도는 잘못된 날짜를 약속하지 않고 관리자에게 점검 상태로 표시한다.
  if not exists(select 1 from public.online_feedback_calendar where year=extract(year from d)::integer) then return null; end if;
  if extract(isodow from d)<6 and not exists(select 1 from public.online_feedback_holidays where day=d) then n:=n+1; end if;
 end loop;
 return (d+time '23:59:59') at time zone 'Asia/Seoul';
end $$;
create function public.oc_feedback_events() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='INSERT' then
  new.reply_due_at:=public.oc_feedback_due(new.submitted_at);
 end if;
 return new;
end $$;
create trigger oc_feedback_deadline before insert on public.online_course_feedback for each row execute function public.oc_feedback_events();
create function public.oc_feedback_notify() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='INSERT' then
  insert into public.online_feedback_notifications(member_id,feedback_id,kind,title,body)
  values(new.member_id,new.id,'submitted','피드백 요청이 접수됐습니다','제출 다음 날부터 주말·공휴일을 제외한 영업일 5일 이내에 답변드립니다.') on conflict do nothing;
  insert into public.online_feedback_notifications(member_id,feedback_id,kind,title,body,admin_only)
  select id,new.id,'received','새 피드백 요청이 있습니다','제출 내용을 확인하고 답변 예정일까지 피드백을 전달해 주세요.',true from public.members where role='admin' on conflict do nothing;
 elsif old.replied_at is null and new.replied_at is not null then
  insert into public.online_feedback_notifications(member_id,feedback_id,kind,title,body)
  values(new.member_id,new.id,'replied','개별 피드백이 도착했습니다','받은 피드백은 수강 종료 후에도 확인할 수 있습니다. 제출 영상은 답변 전달 후 30일간 보관합니다.') on conflict do nothing;
 end if;
 return new;
end $$;
create trigger oc_feedback_notice after insert or update of replied_at on public.online_course_feedback for each row execute function public.oc_feedback_notify();

-- 제출과 정리가 같은 업로드 행을 잠근다. 정리가 시작된 파일은 다시 제출할 수 없다.
create function public.oc_feedback_upload_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.used_at is not null and old.used_at is null and (old.cleanup_started_at is not null or old.deleted_at is not null or old.created_at<=now()-interval '7 days') then
  raise exception 'upload_expired';
 end if;
 return new;
end $$;
create trigger oc_feedback_upload_guard before update on public.online_feedback_uploads for each row execute function public.oc_feedback_upload_guard();
create function public.oc_feedback_cleanup_claim() returns setof public.online_feedback_uploads
language sql security invoker set search_path='' as $$
 update public.online_feedback_uploads u set cleanup_started_at=now(),cleanup_error=null
 where u.id in (
  select x.id from public.online_feedback_uploads x where x.deleted_at is null
  and (x.cleanup_started_at is null or x.cleanup_started_at<now()-interval '10 minutes')
  and ((x.used_at is null and x.created_at<=now()-interval '7 days' and not exists(select 1 from public.online_course_feedback f where f.upload_id=x.id))
   or exists(select 1 from public.online_course_feedback f where f.upload_id=x.id and f.replied_at<=now()-interval '30 days'))
  order by x.created_at for update skip locked limit 20
 ) returning u.*
$$;
create function public.oc_feedback_remind() returns void
language sql security invoker set search_path='' as $$
 insert into public.online_feedback_notifications(member_id,feedback_id,kind,title,body,admin_only)
 select m.id,f.id,case when (f.reply_due_at at time zone 'Asia/Seoul')::date<(now() at time zone 'Asia/Seoul')::date then 'overdue' else 'due' end,
 case when f.reply_due_at<now() then '답변 기한이 지난 피드백이 있습니다' else '오늘 답변할 피드백이 있습니다' end,
 '관리자 제출·피드백에서 확인해 주세요.',true
 from public.online_course_feedback f cross join public.members m
 where m.role='admin' and f.replied_at is null and (f.reply_due_at at time zone 'Asia/Seoul')::date<=(now() at time zone 'Asia/Seoul')::date
 on conflict do nothing
$$;
create function public.oc_feedback_email_claim() returns setof public.online_feedback_notifications
language sql security invoker set search_path='' as $$
 update public.online_feedback_notifications n set email_state='sending',email_claimed_at=now(),email_attempts=email_attempts+1
 where id in(select id from public.online_feedback_notifications where email_state in ('pending','failed','sending')
 and email_attempts<5 and (email_claimed_at is null or email_claimed_at<now()-interval '10 minutes')
 and created_at>now()-interval '23 hours' order by created_at for update skip locked limit 20) returning n.*
$$;
revoke all on function public.oc_feedback_due(timestamptz),public.oc_feedback_events(),public.oc_feedback_notify(),public.oc_feedback_upload_guard(),public.oc_feedback_cleanup_claim(),public.oc_feedback_remind(),public.oc_feedback_email_claim() from public,anon,authenticated;
grant execute on function public.oc_feedback_due(timestamptz),public.oc_feedback_events(),public.oc_feedback_notify(),public.oc_feedback_upload_guard(),public.oc_feedback_cleanup_claim(),public.oc_feedback_remind(),public.oc_feedback_email_claim() to service_role;


-- 공휴일: https://github.com/hyunbinseo/holidays-kr (월력요항 가공 자료, 2026-11-03 확인).
insert into public.online_feedback_calendar values (2026);
insert into public.online_feedback_holidays values ('2026-01-01','1월 1일');
insert into public.online_feedback_holidays values ('2026-02-16','설날 전날');
insert into public.online_feedback_holidays values ('2026-02-17','설날');
insert into public.online_feedback_holidays values ('2026-02-18','설날 다음 날');
insert into public.online_feedback_holidays values ('2026-03-01','3ㆍ1절');
insert into public.online_feedback_holidays values ('2026-03-02','대체공휴일(3ㆍ1절)');
insert into public.online_feedback_holidays values ('2026-05-01','노동절');
insert into public.online_feedback_holidays values ('2026-05-05','어린이날');
insert into public.online_feedback_holidays values ('2026-05-24','부처님 오신 날');
insert into public.online_feedback_holidays values ('2026-05-25','대체공휴일(부처님 오신 날)');
insert into public.online_feedback_holidays values ('2026-06-03','전국동시지방선거');
insert into public.online_feedback_holidays values ('2026-06-06','현충일');
insert into public.online_feedback_holidays values ('2026-07-17','제헌절');
insert into public.online_feedback_holidays values ('2026-08-15','광복절');
insert into public.online_feedback_holidays values ('2026-08-17','대체공휴일(광복절)');
insert into public.online_feedback_holidays values ('2026-09-24','추석 전날');
insert into public.online_feedback_holidays values ('2026-09-25','추석');
insert into public.online_feedback_holidays values ('2026-09-26','추석 다음 날');
insert into public.online_feedback_holidays values ('2026-10-03','개천절');
insert into public.online_feedback_holidays values ('2026-10-05','대체공휴일(개천절)');
insert into public.online_feedback_holidays values ('2026-10-09','한글날');
insert into public.online_feedback_holidays values ('2026-12-25','기독탄신일');
insert into public.online_feedback_calendar values (2027);
insert into public.online_feedback_holidays values ('2027-01-01','1월 1일');
insert into public.online_feedback_holidays values ('2027-02-06','설날 전날');
insert into public.online_feedback_holidays values ('2027-02-07','설날');
insert into public.online_feedback_holidays values ('2027-02-08','설날 다음 날');
insert into public.online_feedback_holidays values ('2027-02-09','대체공휴일(설날)');
insert into public.online_feedback_holidays values ('2027-03-01','3ㆍ1절');
insert into public.online_feedback_holidays values ('2027-05-01','노동절');
insert into public.online_feedback_holidays values ('2027-05-03','대체공휴일(노동절)');
insert into public.online_feedback_holidays values ('2027-05-05','어린이날');
insert into public.online_feedback_holidays values ('2027-05-13','부처님 오신 날');
insert into public.online_feedback_holidays values ('2027-06-06','현충일');
insert into public.online_feedback_holidays values ('2027-07-17','제헌절');
insert into public.online_feedback_holidays values ('2027-07-19','대체공휴일(제헌절)');
insert into public.online_feedback_holidays values ('2027-08-15','광복절');
insert into public.online_feedback_holidays values ('2027-08-16','대체공휴일(광복절)');
insert into public.online_feedback_holidays values ('2027-09-14','추석 전날');
insert into public.online_feedback_holidays values ('2027-09-15','추석');
insert into public.online_feedback_holidays values ('2027-09-16','추석 다음 날');
insert into public.online_feedback_holidays values ('2027-10-03','개천절');
insert into public.online_feedback_holidays values ('2027-10-04','대체공휴일(개천절)');
insert into public.online_feedback_holidays values ('2027-10-09','한글날');
insert into public.online_feedback_holidays values ('2027-10-11','대체공휴일(한글날)');
insert into public.online_feedback_holidays values ('2027-12-25','기독탄신일');
insert into public.online_feedback_holidays values ('2027-12-27','대체공휴일(기독탄신일)');
update public.online_course_feedback set reply_due_at=public.oc_feedback_due(submitted_at) where replied_at is null;

commit;
