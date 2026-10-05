-- 환불 대상은 서버가 신청 원본에서 복사한다. 기존 이력은 추정하여 채우지 않는다.
alter table public.refunds add column if not exists items jsonb;

-- 회원에게 포트원 응답·관리자 메모·처리자 식별자는 공개하지 않는다.
create or replace function public.application_refund_history(p_application_ids uuid[])
returns table (id uuid, application_id uuid, amount integer, items jsonb, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select r.id, r.application_id, r.amount, r.items, r.created_at
  from public.refunds r
  join public.applications a on a.id = r.application_id
  where a.id = any(p_application_ids)
    and (a.member_id = auth.uid() or public.is_admin())
  order by r.created_at desc, r.id;
$$;
revoke all on function public.application_refund_history(uuid[]) from public, anon;
grant execute on function public.application_refund_history(uuid[]) to authenticated;
