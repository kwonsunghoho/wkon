-- 특강 여러 시간대 합산 신청. 결제 한 건 = applications 한 행을 유지한다.
-- 적용 순서: 이 SQL → verify-payment·portone-webhook 콘솔 배포 → 신청 화면 배포.
-- 기존 단일 slot_id·챌린지 중복 제한·결제 ID 유니크·환불 상태 기준은 유지한다.
begin;

alter table public.applications add column if not exists slot_ids uuid[];
comment on column public.applications.slot_ids is '한 결제로 신청한 특강 시간대. 구 단일 신청은 slot_id를 읽는다.';

create or replace function public.monc_application_slots(p_slots uuid[], p_slot uuid)
returns uuid[] language sql immutable as $$
  select case when cardinality(p_slots) > 0 then p_slots
    when p_slot is not null then array[p_slot] else array[]::uuid[] end
$$;

create or replace function public.applications_duplicate_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_phone text; v_label text; v_slots uuid[];
begin
  -- 웹훅과 브라우저가 같은 결제를 동시에 저장해도 MC002로 오환불하지 않는다.
  if new.payment_id is not null then
    perform pg_advisory_xact_lock(hashtext('monc_pay:' || new.payment_id));
    if exists (select 1 from public.applications where payment_id = new.payment_id) then
      raise exception 'duplicate payment' using errcode = '23505';
    end if;
  end if;
  v_phone := public.monc_norm_phone(new.phone);
  if v_phone is null and new.member_id is null then return new; end if;
  if v_phone is not null then perform pg_advisory_xact_lock(hashtext('monc_dup_p:' || v_phone)); end if;
  if new.member_id is not null then perform pg_advisory_xact_lock(hashtext('monc_dup_m:' || new.member_id::text)); end if;
  v_slots := public.monc_application_slots(new.slot_ids, new.slot_id);
  if new.lecture_id is not null then
    select coalesce(l.title, '특강') into v_label
      from public.applications a left join public.special_lectures l on l.id = new.lecture_id
     where a.lecture_id = new.lecture_id and public.monc_app_live(a.refunded, a.payment_status)
       and ((v_phone is not null and public.monc_norm_phone(a.phone) = v_phone)
         or (new.member_id is not null and a.member_id = new.member_id))
       and (cardinality(v_slots) = 0
         or cardinality(public.monc_application_slots(a.slot_ids, a.slot_id)) = 0
         or public.monc_application_slots(a.slot_ids, a.slot_id) && v_slots)
     limit 1;
  end if;
  if v_label is null and jsonb_typeof(new.challenges) = 'array' then
    select case ne->>'challenge' when 'voice' then '보이스' when 'expression' then '표현력'
      when 'spinning' then '스피닝' when 'answer' then '답변' else ne->>'challenge' end
      || coalesce(' ' || (ne->>'round') || '기', '') into v_label
    from jsonb_array_elements(new.challenges) ne
    where ne->>'challenge' is not null and exists (
      select 1 from public.applications a cross join lateral jsonb_array_elements(
        case when jsonb_typeof(a.challenges) = 'array' then a.challenges else '[]'::jsonb end) ae
      where public.monc_app_live(a.refunded, a.payment_status)
        and ((v_phone is not null and public.monc_norm_phone(a.phone) = v_phone)
          or (new.member_id is not null and a.member_id = new.member_id))
        and ae->>'challenge' = ne->>'challenge' and coalesce(ae->>'round', '') = coalesce(ne->>'round', ''))
    limit 1;
  end if;
  if v_label is not null then
    raise exception 'duplicate_application' using errcode = 'MC002', hint = v_label;
  end if;
  return new;
end $$;

create or replace function public.applications_lecture_capacity_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_slots uuid[]; v_id uuid; v_capacity integer; v_taken integer; v_price integer; v_title text; v_count integer;
begin
  if new.lecture_id is null then
    if new.slot_id is not null or cardinality(new.slot_ids) > 0 then
      raise exception 'invalid_lecture_selection' using errcode = 'MC003';
    end if;
    return new;
  end if;
  v_slots := public.monc_application_slots(new.slot_ids, new.slot_id);
  v_count := cardinality(v_slots);
  if array_ndims(v_slots) > 1
    or exists (select 1 from unnest(v_slots) s where s is null)
    or v_count <> (select count(distinct s) from unnest(v_slots) s)
    or (new.slot_id is not null and not (new.slot_id = any(v_slots)))
    or (v_count = 0 and exists (select 1 from public.lecture_slots where lecture_id = new.lecture_id))
    or (select count(*) from public.lecture_slots where lecture_id = new.lecture_id and id = any(v_slots)) <> v_count then
    raise exception 'invalid_lecture_selection' using errcode = 'MC003';
  end if;
  -- 슬롯은 UUID 정렬 순서로 모두 잠근 뒤 특강을 잠근다. 선택 순서가 달라도 교착되지 않는다.
  for v_id in select unnest(v_slots) order by 1 loop
    select capacity into v_capacity from public.lecture_slots where id = v_id for update;
    if v_capacity is not null then
      select count(*) into v_taken from public.applications a
       where v_id = any(public.monc_application_slots(a.slot_ids, a.slot_id))
         and public.monc_app_live(a.refunded, a.payment_status);
      if v_taken >= v_capacity then raise exception 'lecture_full' using errcode = 'MC001'; end if;
    end if;
  end loop;
  select capacity, price, title into v_capacity, v_price, v_title
    from public.special_lectures where id = new.lecture_id for update;
  if not found then raise exception 'invalid_lecture_selection' using errcode = 'MC003'; end if;
  if v_capacity is not null then
    select coalesce(sum(greatest(cardinality(public.monc_application_slots(a.slot_ids, a.slot_id)), 1)), 0)
      into v_taken from public.applications a where a.lecture_id = new.lecture_id
      and public.monc_app_live(a.refunded, a.payment_status);
    if v_taken + greatest(v_count, 1) > v_capacity then
      raise exception 'lecture_full' using errcode = 'MC001';
    end if;
  end if;
  -- 금액과 일정 내역은 DB 원본에서 확정한다.
  if coalesce(new.payment_status, 'pending') = 'free' then v_price := 0; end if;
  if new.total_price is distinct from coalesce(v_price, 0) * greatest(v_count, 1) then
    raise exception 'invalid_lecture_selection' using errcode = 'MC003';
  end if;
  new.slot_ids := v_slots;
  new.slot_id := case when v_count = 1 then v_slots[1] else null end;
  if v_count = 0 then
    new.challenges := jsonb_build_array(jsonb_build_object('type', 'lecture', 'lecture_id', new.lecture_id, 'name', v_title, 'price', coalesce(v_price, 0)));
  else
    select jsonb_agg(jsonb_build_object('type', 'lecture', 'lecture_id', new.lecture_id,
      'name', v_title, 'price', coalesce(v_price, 0), 'slot_id', s.id,
      'slot', coalesce(nullif(concat_ws(' ', s.slot_date::text, substring(s.start_time::text from 1 for 5)), ''), s.label))
      order by s.sort_order, s.slot_date, s.start_time, s.id) into new.challenges
    from public.lecture_slots s where s.id = any(v_slots);
  end if;
  return new;
end $$;

create or replace function public.lecture_seats_recount(p_lecture uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.special_lectures l set seats_left = greatest(l.capacity - (
    select coalesce(sum(greatest(cardinality(public.monc_application_slots(a.slot_ids, a.slot_id)), 1)), 0)
    from public.applications a where a.lecture_id = p_lecture and public.monc_app_live(a.refunded, a.payment_status)), 0)
  where l.id = p_lecture and l.capacity is not null;
end $$;

create or replace function public.lecture_slot_seats_recount(p_slot uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.lecture_slots s set seats_left = greatest(s.capacity - (
    select count(*) from public.applications a where p_slot = any(public.monc_application_slots(a.slot_ids, a.slot_id))
      and public.monc_app_live(a.refunded, a.payment_status)), 0)
  where s.id = p_slot and s.capacity is not null;
end $$;

create or replace function public.applications_lecture_seats_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_slots uuid[] := array[]::uuid[]; v_id uuid;
begin
  if tg_op <> 'INSERT' then v_slots := v_slots || public.monc_application_slots(old.slot_ids, old.slot_id); end if;
  if tg_op <> 'DELETE' then v_slots := v_slots || public.monc_application_slots(new.slot_ids, new.slot_id); end if;
  for v_id in select distinct s from unnest(v_slots) s order by 1 loop
    perform 1 from public.lecture_slots where id = v_id for update;
  end loop;
  for v_id in select distinct s from unnest(v_slots) s order by 1 loop perform public.lecture_slot_seats_recount(v_id); end loop;
  if tg_op <> 'INSERT' then perform public.lecture_seats_recount(old.lecture_id); end if;
  if tg_op <> 'DELETE' then perform public.lecture_seats_recount(new.lecture_id); return new; end if;
  return old;
end $$;

drop trigger if exists applications_lecture_seats on public.applications;
create trigger applications_lecture_seats after insert or delete or update of lecture_id, slot_id, slot_ids, payment_status, refunded
  on public.applications for each row execute function public.applications_lecture_seats_sync();

create or replace function public.special_lectures_seats_init()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.capacity is not null then
    new.seats_left := greatest(new.capacity - (select coalesce(sum(greatest(cardinality(public.monc_application_slots(a.slot_ids, a.slot_id)), 1)), 0)
      from public.applications a where a.lecture_id = new.id and public.monc_app_live(a.refunded, a.payment_status)), 0);
  end if;
  return new;
end $$;

create or replace function public.apply_free_lecture_slots(p_lecture uuid, p_slots uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_name text; v_phone text; v_hint text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_authenticated'); end if;
  if not public.monc_is_student() then return jsonb_build_object('ok', false, 'code', 'not_student'); end if;
  select name, phone into v_name, v_phone from public.members where id = v_uid;
  if coalesce(btrim(v_name), '') = '' or coalesce(btrim(v_phone), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'profile_missing');
  end if;
  if not exists (select 1 from public.special_lectures where id = p_lecture and visible) then
    return jsonb_build_object('ok', false, 'code', 'lecture_not_found');
  end if;
  if cardinality(p_slots) is null or cardinality(p_slots) = 0 then return jsonb_build_object('ok', false, 'code', 'slot_not_found'); end if;
  insert into public.applications(name, phone, member_id, lecture_id, slot_ids, challenges, total_price, payment_status, paid)
    values(v_name, v_phone, v_uid, p_lecture, p_slots, '[]'::jsonb, 0, 'free', false);
  return jsonb_build_object('ok', true);
exception
  when sqlstate 'MC001' then return jsonb_build_object('ok', false, 'code', 'lecture_full');
  when sqlstate 'MC002' then
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'code', 'duplicate', 'program', v_hint);
  when sqlstate 'MC003' then return jsonb_build_object('ok', false, 'code', 'slot_not_found');
end $$;
revoke all on function public.apply_free_lecture_slots(uuid, uuid[]) from public, anon;
grant execute on function public.apply_free_lecture_slots(uuid, uuid[]) to authenticated;

create or replace function public.lecture_multislot_ready()
returns boolean language sql stable as $$ select true $$;
grant execute on function public.lecture_multislot_ready() to anon, authenticated;

do $$ declare r record; begin
  for r in select id from public.lecture_slots order by id loop perform public.lecture_slot_seats_recount(r.id); end loop;
  for r in select id from public.special_lectures order by id loop perform public.lecture_seats_recount(r.id); end loop;
end $$;
notify pgrst, 'reload schema';
commit;
