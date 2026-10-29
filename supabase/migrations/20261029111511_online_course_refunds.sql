begin;
create table public.online_refunds (
 id uuid primary key, payment_id text not null references public.online_orders(payment_id),
 actor_id uuid not null references auth.users(id), amount integer not null check(amount>0),
 base_refunded integer not null check(base_refunded>=0), reason text not null check(length(reason) between 1 and 300),
 state text not null default 'pending' check(state in ('pending','succeeded')),
 created_at timestamptz not null default now(), completed_at timestamptz
);
create unique index online_refunds_pending on public.online_refunds(payment_id) where state='pending';
alter table public.online_refunds enable row level security;
revoke all on public.online_refunds from public,anon,authenticated;
grant all on public.online_refunds to service_role;
create function public.oc_begin_refund(p_actor uuid,p_payment text,p_request uuid,p_amount integer,p_base integer,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.online_orders; r public.online_refunds;
begin
 if not exists(select 1 from public.members where id=p_actor and role='admin' and agreed_at is not null and terms_version='2026-10-05') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
 select * into o from public.online_orders where payment_id=p_payment for update;
 if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
 select * into r from public.online_refunds where id=p_request;
 if found then
  if r.payment_id<>p_payment or r.amount<>p_amount or r.reason<>p_reason then return jsonb_build_object('ok',false,'error','refund_request_mismatch'); end if;
  return jsonb_build_object('ok',true,'refund',to_jsonb(r));
 end if;
 if exists(select 1 from public.online_refunds where payment_id=p_payment and state='pending') then return jsonb_build_object('ok',false,'error','refund_in_progress'); end if;
 if o.state<>'paid' or p_amount is null or p_amount<>o.amount or p_base is distinct from 0 or o.refunded_amount<>0
  or p_reason is null or length(trim(p_reason)) not between 1 and 300 then return jsonb_build_object('ok',false,'error','refund_amount_invalid'); end if;
 perform 1 from public.online_enrollments where payment_id=p_payment for update;
 if exists(select 1 from public.online_enrollments where payment_id=p_payment and started_at is not null) then return jsonb_build_object('ok',false,'error','already_started'); end if;
 insert into public.online_refunds(id,payment_id,actor_id,amount,base_refunded,reason) values(p_request,p_payment,p_actor,p_amount,p_base,p_reason) returning * into r;
 return jsonb_build_object('ok',true,'refund',to_jsonb(r));
end $$;
create function public.oc_finish_refund(p_request uuid,p_refunded integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.online_refunds; result jsonb;
begin
 -- 주문 → 환불 순서로 잠금을 맞춘다.
 select * into r from public.online_refunds where id=p_request;
 if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
 perform 1 from public.online_orders where payment_id=r.payment_id for update;
 select * into r from public.online_refunds where id=p_request for update;
 if p_refunded is null or p_refunded<r.base_refunded+r.amount then return jsonb_build_object('ok',false,'error','refund_not_confirmed'); end if;
 result:=public.oc_revoke(r.payment_id,p_refunded);
 if not coalesce((result->>'ok')::boolean,false) then return result; end if;
 update public.online_refunds set state='succeeded',completed_at=coalesce(completed_at,now()) where id=p_request;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.oc_begin_refund(uuid,text,uuid,integer,integer,text),public.oc_finish_refund(uuid,integer) from public,anon,authenticated;
grant execute on function public.oc_begin_refund(uuid,text,uuid,integer,integer,text),public.oc_finish_refund(uuid,integer) to service_role;
create or replace function public.oc_start(p_member uuid,p_enrollment uuid,p_lesson uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.online_enrollments;
begin
 -- 환불과 동일한 주문 → 수강권 잠금 순서로 첫 재생과 환불의 경합을 막는다.
 select * into e from public.online_enrollments where id=p_enrollment and member_id=p_member;
 if e.payment_id is not null then
  perform 1 from public.online_orders where payment_id=e.payment_id for update;
  if exists(select 1 from public.online_refunds where payment_id=e.payment_id and state='pending') then return jsonb_build_object('ok',false,'error','refund_in_progress'); end if;
 end if;
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

commit;
