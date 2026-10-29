-- 온라인 강의: 모든 쓰기와 유료 자산 조회는 인증된 Edge Function을 경유한다.
begin;
create table public.online_courses (
 id text primary key, title text not null, description text not null default '',
 price integer check (price > 0), access_days integer check (access_days between 1 and 730),
 published boolean not null default false, sale_open boolean not null default false, purchase_notice text,
 created_at timestamptz not null default now(),
 check (not sale_open or (published and price is not null and access_days is not null and nullif(trim(purchase_notice),'') is not null))
);
create table public.online_lessons (
 id uuid primary key default gen_random_uuid(), course_id text not null references public.online_courses(id),
 position integer not null check(position > 0), chapter text not null, title text not null,
 duration_seconds integer not null default 0 check(duration_seconds >= 0),
 video_path text, material_path text, published boolean not null default false,
 unique(course_id,position)
);
create table public.online_orders (
 payment_id text primary key, member_id uuid references auth.users(id) on delete set null,
 course_id text not null references public.online_courses(id), title text not null,
 amount integer not null check(amount > 0), access_days integer not null check(access_days > 0), purchase_notice text not null,
 state text not null default 'pending' check(state in ('pending','paid','cancelled','refund_required','refunded')),
 accepted_at timestamptz not null default now(), paid_at timestamptz,
 refunded_amount integer not null default 0 check(refunded_amount >= 0),
 created_at timestamptz not null default now()
);
create index online_orders_member_idx on public.online_orders(member_id,course_id);
create table public.online_enrollments (
 id uuid primary key default gen_random_uuid(), payment_id text not null unique references public.online_orders(payment_id),
 member_id uuid not null references auth.users(id) on delete cascade,
 course_id text not null references public.online_courses(id), access_days integer not null,
 started_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
 created_at timestamptz not null default now(),
 check ((started_at is null and expires_at is null) or (started_at is not null and expires_at > started_at))
);
create index online_enrollments_member_idx on public.online_enrollments(member_id,course_id);
create table public.online_progress (
 enrollment_id uuid not null references public.online_enrollments(id) on delete cascade,
 lesson_id uuid not null references public.online_lessons(id),
 position_seconds integer not null default 0 check(position_seconds >= 0),
 completed boolean not null default false, updated_at timestamptz not null default now(),
 primary key(enrollment_id,lesson_id)
);
alter table public.online_courses enable row level security;
alter table public.online_lessons enable row level security;
alter table public.online_orders enable row level security;
alter table public.online_enrollments enable row level security;
alter table public.online_progress enable row level security;
revoke all on public.online_courses,public.online_lessons,public.online_orders,public.online_enrollments,public.online_progress from public,anon,authenticated;
grant all on public.online_courses,public.online_lessons,public.online_orders,public.online_enrollments,public.online_progress to service_role;

-- 금액·기간 확인, 동의, 중복 수강·미결 주문은 서버에서 한 번에 판정한다.
create function public.oc_prepare_order(p_member uuid,p_course text,p_amount integer,p_days integer,p_accepted boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.online_courses; o public.online_orders;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_member::text||':'||p_course,0));
 if not exists(select 1 from public.members where id=p_member and agreed_at is not null and terms_version='2026-10-05') then
  return jsonb_build_object('ok',false,'error','consent_required'); end if;
 if p_accepted is distinct from true then return jsonb_build_object('ok',false,'error','purchase_consent_required'); end if;
 select * into c from public.online_courses where id=p_course;
 if not found or not c.sale_open or not c.published or c.price is null or c.access_days is null then
  return jsonb_build_object('ok',false,'error','not_for_sale'); end if;
 if p_amount is distinct from c.price or p_days is distinct from c.access_days then
  return jsonb_build_object('ok',false,'error','offer_changed'); end if;
 if not exists(select 1 from public.online_lessons where course_id=c.id and published)
 or exists(select 1 from public.online_lessons where course_id=c.id and published and (nullif(video_path,'') is null or duration_seconds<=0)) then
  return jsonb_build_object('ok',false,'error','content_not_ready'); end if;
 if exists(select 1 from public.online_enrollments where member_id=p_member and course_id=c.id and revoked_at is null and (expires_at is null or expires_at>now())) then
  return jsonb_build_object('ok',false,'error','already_enrolled'); end if;
 -- 미결 주문이 있으면 재검증부터 한다. 다른 결제를 추가로 열지 않는다.
 select * into o from public.online_orders where member_id=p_member and course_id=c.id and state in ('pending','refund_required') order by created_at desc limit 1;
 if found then
  if o.state='refund_required' then return jsonb_build_object('ok',false,'error','refund_required'); end if;
  return jsonb_build_object('ok',true,'reused',true,'paymentId',o.payment_id,'amount',o.amount,'accessDays',o.access_days,'title',o.title,'courseId',o.course_id);
 end if;
 insert into public.online_orders(payment_id,member_id,course_id,title,amount,access_days,purchase_notice)
 values ('monc-course-'||gen_random_uuid(),p_member,c.id,c.title,c.price,c.access_days,c.purchase_notice) returning * into o;
 return jsonb_build_object('ok',true,'paymentId',o.payment_id,'amount',o.amount,'accessDays',o.access_days,'title',o.title,'courseId',o.course_id);
end $$;

-- 포트원 재조회 결과만 전달한다. 브라우저에는 실행 권한이 없다.
create function public.oc_settle(p_payment text,p_amount integer,p_paid_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.online_orders; e public.online_enrollments;
begin
 select * into o from public.online_orders where payment_id=p_payment;
 if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
 perform pg_advisory_xact_lock(hashtextextended(o.member_id::text||':'||o.course_id,0));
 select * into o from public.online_orders where payment_id=p_payment for update;
 if p_amount is distinct from o.amount then return jsonb_build_object('ok',false,'error','amount_mismatch'); end if;
 if o.state='refunded' then return jsonb_build_object('ok',false,'error','refunded','terminal',true); end if;
 if o.state='paid' then return jsonb_build_object('ok',true,'already',true); end if;
 if o.state='refund_required' then return jsonb_build_object('ok',false,'error','refund_required'); end if;
 if o.member_id is null or p_paid_at is null or p_paid_at < o.created_at - interval '5 minutes'
 or exists(select 1 from public.online_enrollments where member_id=o.member_id and course_id=o.course_id and revoked_at is null and (expires_at is null or expires_at>now())) then
  update public.online_orders set state='refund_required' where payment_id=p_payment;
  return jsonb_build_object('ok',false,'error','refund_required'); end if;
 update public.online_orders set state='paid',paid_at=p_paid_at where payment_id=p_payment;
 insert into public.online_enrollments(payment_id,member_id,course_id,access_days)
 values(o.payment_id,o.member_id,o.course_id,o.access_days) returning * into e;
 return jsonb_build_object('ok',true,'enrollmentId',e.id);
end $$;

create function public.oc_revoke(p_payment text,p_refunded integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.online_orders;
begin
 select * into o from public.online_orders where payment_id=p_payment for update;
 if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
 if p_refunded<=0 or p_refunded>o.amount then return jsonb_build_object('ok',false,'error','refund_amount_invalid'); end if;
 update public.online_orders set state='refunded',refunded_amount=greatest(refunded_amount,p_refunded) where payment_id=p_payment;
 update public.online_enrollments set revoked_at=coalesce(revoked_at,now()) where payment_id=p_payment;
 return jsonb_build_object('ok',true);
end $$;

-- 재생 버튼을 누른 뒤, 영상 서명 URL 발급 성공 시에만 최초 기간을 확정한다.
create function public.oc_start(p_member uuid,p_enrollment uuid,p_lesson uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.online_enrollments;
begin
 select * into e from public.online_enrollments where id=p_enrollment and member_id=p_member for update;
 if not found or e.revoked_at is not null or e.expires_at<=now() then return jsonb_build_object('ok',false,'error','access_expired'); end if;
 if not exists(select 1 from public.online_lessons where id=p_lesson and course_id=e.course_id and published and nullif(video_path,'') is not null) then
  return jsonb_build_object('ok',false,'error','lesson_unavailable'); end if;
 if e.started_at is null then
  update public.online_enrollments set started_at=now(),expires_at=now()+make_interval(days=>e.access_days) where id=e.id returning * into e;
 end if;
 return jsonb_build_object('ok',true,'startedAt',e.started_at,'expiresAt',e.expires_at,'serverNow',now());
end $$;

create function public.oc_save_progress(p_member uuid,p_enrollment uuid,p_lesson uuid,p_position integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.online_enrollments; l public.online_lessons;
begin
 select * into e from public.online_enrollments where id=p_enrollment and member_id=p_member for share;
 if not found or e.started_at is null or e.revoked_at is not null or e.expires_at<=now() then return jsonb_build_object('ok',false,'error','access_expired'); end if;
 select * into l from public.online_lessons where id=p_lesson and course_id=e.course_id and published;
 if not found or p_position is null or p_position<0 then return jsonb_build_object('ok',false,'error','bad_progress'); end if;
 insert into public.online_progress(enrollment_id,lesson_id,position_seconds,completed)
 values(e.id,l.id,least(p_position,l.duration_seconds),l.duration_seconds>0 and p_position>=l.duration_seconds*.95)
 on conflict(enrollment_id,lesson_id) do update set position_seconds=excluded.position_seconds,
 completed=public.online_progress.completed or excluded.completed,updated_at=now();
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.oc_prepare_order(uuid,text,integer,integer,boolean),public.oc_settle(text,integer,timestamptz),public.oc_revoke(text,integer),public.oc_start(uuid,uuid,uuid),public.oc_save_progress(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.oc_prepare_order(uuid,text,integer,integer,boolean),public.oc_settle(text,integer,timestamptz),public.oc_revoke(text,integer),public.oc_start(uuid,uuid,uuid),public.oc_save_progress(uuid,uuid,uuid,integer) to service_role;

-- 첫 재생일부터 10일. 가격·실제 강의·구매 안내 확정 전에는 판매 불가.
insert into public.online_courses(id,title,description,access_days) values('expression-advanced','영합각 심화','승무원 영상면접을 위한 심화 온라인 강의. 영상과 연습 자료로 혼자 학습합니다.',10);
insert into storage.buckets(id,name,public) values('online-course-assets','online-course-assets',false) on conflict(id) do nothing;
do $$ begin
 if exists(select 1 from storage.buckets where id='online-course-assets' and public) then raise exception '온라인 강의 버킷은 비공개여야 합니다'; end if;
end $$;
create policy online_course_assets_private on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id<>'online-course-assets') with check(bucket_id<>'online-course-assets');
commit;
