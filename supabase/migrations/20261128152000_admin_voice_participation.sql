-- 운영자 본인이 입장한 보신각 기수만 기록한다. 유료 신청과 좌석·매출 집계는 건드리지 않는다.
create table challenge_room_data.admin_voice_entries (
  member_id uuid not null references public.members(id) on delete cascade,
  round_id uuid not null references public.challenge_rounds(id) on delete cascade,
  primary key(member_id, round_id)
);
alter table challenge_room_data.admin_voice_entries enable row level security;
revoke all on challenge_room_data.admin_voice_entries from public, anon, authenticated;

create function public.admin_voice_participation(p_action text)
returns jsonb language plpgsql security definer set search_path='' as $admin$
declare
  actor uuid:=auth.uid();
  cohort public.challenge_rounds%rowtype;
begin
  if actor is null or not exists(select from public.members where id=actor and role='admin' and agreed_at is not null) then
    if p_action='rounds' then return '[]'::jsonb; end if;
    raise exception 'challenge_room:forbidden' using errcode='42501';
  end if;
  if p_action='rounds' then
    return coalesce((select jsonb_agg(r.round order by r.program_start desc)
      from challenge_room_data.admin_voice_entries e join public.challenge_rounds r on r.id=e.round_id
      where e.member_id=actor and r.weekly_voice),'[]'::jsonb);
  end if;
  if p_action is distinct from 'join' then raise exception 'challenge_room:invalid_input'; end if;
  select r.* into cohort from public.challenge_rounds r where r.weekly_voice and r.challenge='voice'
    and r.program_start=challenge_room_data.first_mission_monday((now() at time zone 'Asia/Seoul')::date);
  if not found then raise exception 'challenge_room:not_ready'; end if;
  insert into challenge_room_data.admin_voice_entries(member_id,round_id) values(actor,cohort.id)
    on conflict(member_id,round_id) do nothing;
  return jsonb_build_object('round',cohort.round,'challenge',cohort.challenge);
end
$admin$;
revoke all on function public.admin_voice_participation(text) from public,anon;
grant execute on function public.admin_voice_participation(text) to authenticated;

create or replace function challenge_room_data.eligible(p_member uuid,p_round uuid)
returns boolean language sql stable set search_path='' as $eligible$
  select exists(
    select from public.challenge_rounds r join public.members m on m.id=p_member and m.agreed_at is not null
    where r.id=p_round and challenge_room_data.supports_challenge(r.challenge) and (
      (r.weekly_voice and m.role='admin' and exists(select from challenge_room_data.admin_voice_entries e
        where e.member_id=m.id and e.round_id=r.id))
      or exists(select from public.applications a where a.member_id=m.id
        and (a.paid is true or a.payment_status in ('paid','free','partial_refunded'))
        and not coalesce(a.refunded,false)
        and coalesce(a.payment_status,'') not in ('refunded','cancelled','canceled','failed')
        and exists(select from jsonb_array_elements(
          case when jsonb_typeof(a.challenges)='array' then a.challenges else '[]'::jsonb end
        ) item where item->>'challenge'=r.challenge and item->>'round'=r.round::text))
    )
  )
$eligible$;
