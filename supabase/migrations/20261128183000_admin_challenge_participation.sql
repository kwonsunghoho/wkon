-- 관리자 본인이 선택한 무료 참여 기수. 결제·수강생 통계에는 신청 행을 만들지 않는다.
create function public.admin_challenge_participation(p_ids text[] default null)
returns jsonb language plpgsql security definer set search_path='' as $join$
declare
  actor uuid := auth.uid();
  today_kst date := (now() at time zone 'Asia/Seoul')::date;
  kind text;
  chosen uuid;
  joined uuid[] := '{}';
begin
  if not exists (select from public.members where id=actor and role='admin' and agreed_at is not null) then
    if p_ids is null then return '[]'::jsonb; end if;
    raise exception 'challenge_room:forbidden' using errcode='42501';
  end if;
  if p_ids is not null then
    if cardinality(p_ids) not between 1 and 5 then raise exception 'challenge_room:invalid_input'; end if;
    for kind in select distinct x from unnest(p_ids) ids(x) order by x loop
      if kind is null or kind not in ('voice','answer','expression','spinning','culture') then
        raise exception 'challenge_room:invalid_input';
      end if;
      select r.id into chosen from public.challenge_rounds r where r.challenge=kind and (
        (kind='voice' and r.weekly_voice and r.program_start=challenge_room_data.first_mission_monday(today_kst))
        or (kind<>'voice' and (r.recruit_start is null or r.recruit_start<=today_kst)
          and (r.recruit_end is null or r.recruit_end>=today_kst)))
        order by r.recruit_end asc nulls last,r.round desc limit 1;
      if chosen is null then raise exception 'challenge_room:not_open'; end if;
      joined := array_append(joined,chosen);
    end loop;
    insert into challenge_room_data.admin_challenge_entries(member_id,round_id)
      select actor,id from unnest(joined) rounds(id) order by id on conflict do nothing;
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('challenge',r.challenge,'round',r.round,
    'mission_room',challenge_room_data.supports_challenge(r.challenge) and exists(
      select from challenge_room_data.missions m where m.round_id=r.id)) order by r.round desc,r.challenge),'[]'::jsonb)
    from challenge_room_data.admin_challenge_entries e join public.challenge_rounds r on r.id=e.round_id
    where e.member_id=actor and (p_ids is null or e.round_id=any(joined)));
end
$join$;
revoke all on function public.admin_challenge_participation(text[]) from public,anon;
grant execute on function public.admin_challenge_participation(text[]) to authenticated;

-- 공식 과제의 제출 자격에도 본인의 관리자 참여 기록을 반영한다.
create or replace function public.is_challenge_participant(p_challenge text)
returns boolean language sql stable security definer set search_path='' as $access$
  select exists (
    select from public.applications a where a.member_id=auth.uid()
      and (a.paid is true or a.payment_status in ('paid','free','partial_refunded'))
      and coalesce(a.refunded,false)=false and coalesce(a.payment_status,'')<>'refunded'
      and exists(select from jsonb_array_elements(coalesce(a.challenges,'[]'::jsonb)) c
        where c->>'challenge'=p_challenge)
  ) or exists (
    select from challenge_room_data.admin_challenge_entries e
      join public.members m on m.id=e.member_id and m.role='admin' and m.agreed_at is not null
      join public.challenge_rounds r on r.id=e.round_id
      where e.member_id=auth.uid() and r.challenge=p_challenge
  )
$access$;
