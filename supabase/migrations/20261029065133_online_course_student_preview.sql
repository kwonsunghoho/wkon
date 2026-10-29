-- 판매·결제 없이 기존 관리자만 학생 화면과 진도를 확인한다.
begin;
alter table public.online_enrollments alter column payment_id drop not null;
alter table public.online_enrollments add column admin_preview boolean not null default false;
alter table public.online_enrollments add constraint online_enrollment_origin check (
 (admin_preview and payment_id is null) or (not admin_preview and payment_id is not null));
create unique index online_admin_preview_unique on public.online_enrollments(member_id,course_id) where admin_preview and revoked_at is null;
create function public.oc_admin_preview(p_actor uuid,p_course text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.online_courses; e public.online_enrollments;
begin
 if not exists(select 1 from public.members where id=p_actor and role='admin' and agreed_at is not null and terms_version='2026-10-05') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
 select * into c from public.online_courses where id=p_course for update;
 if not found or c.access_days is null then return jsonb_build_object('ok',false,'error','not_ready'); end if;
 select * into e from public.online_enrollments where member_id=p_actor and course_id=p_course and admin_preview and revoked_at is null;
 if found and e.expires_at<=now() then
  update public.online_enrollments set revoked_at=now() where id=e.id;
  e.id:=null;
 end if;
 if e.id is null then
  insert into public.online_enrollments(member_id,course_id,access_days,admin_preview)
  values(p_actor,p_course,c.access_days,true) returning * into e;
 end if;
 return jsonb_build_object('ok',true,'enrollmentId',e.id);
end $$;
revoke all on function public.oc_admin_preview(uuid,text) from public,anon,authenticated;
grant execute on function public.oc_admin_preview(uuid,text) to service_role;
create or replace function public.oc_start(p_member uuid,p_enrollment uuid,p_lesson uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.online_enrollments;
begin
 select * into e from public.online_enrollments where id=p_enrollment and member_id=p_member for update;
 if not found or e.revoked_at is not null or e.expires_at<=now() then return jsonb_build_object('ok',false,'error','access_expired'); end if;
 if e.admin_preview and not exists(select 1 from public.members where id=p_member and role='admin' and agreed_at is not null and terms_version='2026-10-05') then return jsonb_build_object('ok',false,'error','not_enrolled'); end if;
 if not exists(select 1 from public.online_lessons where id=p_lesson and course_id=e.course_id and (published or e.admin_preview) and nullif(video_path,'') is not null) then
  return jsonb_build_object('ok',false,'error','lesson_unavailable'); end if;
 if e.started_at is null then
  update public.online_enrollments set started_at=now(),expires_at=now()+make_interval(days=>e.access_days) where id=e.id returning * into e;
 end if;
 return jsonb_build_object('ok',true,'startedAt',e.started_at,'expiresAt',e.expires_at,'serverNow',now());
end $$;

create or replace function public.oc_save_progress(p_member uuid,p_enrollment uuid,p_lesson uuid,p_position integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.online_enrollments; l public.online_lessons;
begin
 select * into e from public.online_enrollments where id=p_enrollment and member_id=p_member for share;
 if not found or e.started_at is null or e.revoked_at is not null or e.expires_at<=now() then return jsonb_build_object('ok',false,'error','access_expired'); end if;
 if e.admin_preview and not exists(select 1 from public.members where id=p_member and role='admin' and agreed_at is not null and terms_version='2026-10-05') then return jsonb_build_object('ok',false,'error','not_enrolled'); end if;
 select * into l from public.online_lessons where id=p_lesson and course_id=e.course_id and (published or e.admin_preview);
 if not found or p_position is null or p_position<0 then return jsonb_build_object('ok',false,'error','bad_progress'); end if;
 insert into public.online_progress(enrollment_id,lesson_id,position_seconds,completed)
 values(e.id,l.id,least(p_position,l.duration_seconds),l.duration_seconds>0 and p_position>=l.duration_seconds*.95)
 on conflict(enrollment_id,lesson_id) do update set position_seconds=excluded.position_seconds,
 completed=public.online_progress.completed or excluded.completed,updated_at=now();
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.oc_prepare_order(p_member uuid,p_course text,p_amount integer,p_days integer,p_accepted boolean)
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
 if exists(select 1 from public.online_enrollments where member_id=p_member and course_id=c.id and not admin_preview and revoked_at is null and (expires_at is null or expires_at>now())) then
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
create or replace function public.oc_settle(p_payment text,p_amount integer,p_paid_at timestamptz)
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
 or exists(select 1 from public.online_enrollments where member_id=o.member_id and course_id=o.course_id and not admin_preview and revoked_at is null and (expires_at is null or expires_at>now())) then
  update public.online_orders set state='refund_required' where payment_id=p_payment;
  return jsonb_build_object('ok',false,'error','refund_required'); end if;
 update public.online_orders set state='paid',paid_at=p_paid_at where payment_id=p_payment;
 insert into public.online_enrollments(payment_id,member_id,course_id,access_days)
 values(o.payment_id,o.member_id,o.course_id,o.access_days) returning * into e;
 return jsonb_build_object('ok',true,'enrollmentId',e.id);
end $$;


commit;
