-- =============================================================================
-- 특강 시간대(lecture_slots) — 같은 특강을 여러 날·여러 타임으로 열고, 정원·잔여석·
-- 마감을 타임마다 따로 센다.
-- 적용: Supabase SQL Editor 에 전체 붙여넣고 실행 (idempotent, 재실행 안전)
-- ⚠️ 20260724150000_lecture_seat_counting.sql 을 먼저 실행할 것(그 트리거 위에 얹힌다).
-- ⚠️ verify-payment Edge Function 재배포 전에 먼저 실행할 것(유료 특강 시간대 신청).
--
-- 설계 — 기존 코드를 안 건드리는 롤업 방식
--   특강(special_lectures)은 소개·사진·가격·항공사를 갖고, 시간대별 정원은 슬롯이 갖는다.
--   슬롯이 하나라도 있으면 특강의 `capacity`(정원)와 `lecture_date`(진행일)를 트리거가
--   **슬롯 합계·최초 날짜로 자동으로 채운다**. 덕분에 카드·정렬·마감판정·잔여석 표시 같은
--   기존 코드가 그대로 동작하고(특강 잔여석 = 전체 합), 슬롯이 없는 특강은 종전과 100% 동일.
--   ⚠️ 그래서 슬롯이 있는 특강의 정원은 admin 에서 직접 입력하지 않는다(합계가 덮어쓴다).
-- =============================================================================

create table if not exists public.lecture_slots (
  id          uuid primary key default gen_random_uuid(),
  lecture_id  uuid not null references public.special_lectures(id) on delete cascade,
  slot_date   date not null,               -- 진행 날짜
  start_time  time,                         -- 시작 시각(선택)
  end_time    time,                         -- 종료 시각(선택)
  label       text,                         -- 자유 표기(예: '오전반', '줌 링크 별도 안내')
  capacity    integer,                      -- 이 타임의 정원(NULL=무제한)
  seats_left  integer,                      -- 파생 캐시 — 트리거가 '정원 − 신청건수'로 재계산
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

comment on table  public.lecture_slots is
  '특강 시간대. 정원·잔여석은 타임 단위. 특강의 capacity/lecture_date 는 여기서 롤업된다.';
comment on column public.lecture_slots.seats_left is
  '잔여석(자동 계산 · 파생값). 직접 수정하지 말고 capacity 를 조정할 것.';

create index if not exists lecture_slots_lecture_idx
  on public.lecture_slots (lecture_id, slot_date, start_time);

-- 신청이 어느 타임인지
alter table public.applications
  add column if not exists slot_id uuid references public.lecture_slots(id) on delete set null;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.lecture_slots enable row level security;

drop policy if exists lecture_slots_read_public on public.lecture_slots;
drop policy if exists lecture_slots_admin_all   on public.lecture_slots;

-- 공개 읽기: 노출된 특강의 시간대만 (특강이 숨김이면 시간대도 안 보인다)
create policy lecture_slots_read_public on public.lecture_slots
  for select to anon, authenticated
  using (exists (
    select 1 from public.special_lectures l
     where l.id = lecture_slots.lecture_id and l.visible = true));

create policy lecture_slots_admin_all on public.lecture_slots
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── 슬롯 잔여석 재계산 ────────────────────────────────────────────────────────
create or replace function public.lecture_slot_seats_recount(p_slot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_taken    integer;
begin
  if p_slot is null then return; end if;

  select capacity into v_capacity from public.lecture_slots where id = p_slot;
  if not found or v_capacity is null then return; end if;   -- 정원 미설정 = 무제한

  select count(*) into v_taken from public.applications where slot_id = p_slot;

  update public.lecture_slots
     set seats_left = greatest(v_capacity - v_taken, 0)
   where id = p_slot;
end;
$$;

-- ── 특강 롤업(정원 합계 · 최초 진행일) ────────────────────────────────────────
create or replace function public.lecture_rollup_from_slots(p_lecture uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt  integer;
  v_cap  integer;
  v_date date;
begin
  if p_lecture is null then return; end if;

  select count(*), sum(capacity), min(slot_date)
    into v_cnt, v_cap, v_date
    from public.lecture_slots where lecture_id = p_lecture;

  -- 슬롯이 없는 특강은 종전 방식(관리자가 넣은 정원) 그대로 둔다
  if v_cnt = 0 then return; end if;

  -- capacity 를 SET 에 넣으면 special_lectures_seats_init(BEFORE) 가 걸려
  -- 특강 전체 잔여석(= 합계 정원 − 전체 신청건수)까지 같이 채워준다.
  update public.special_lectures
     set capacity     = v_cap,
         -- 슬롯이 전부 무제한이면 특강도 잔여석 미표시로 되돌린다
         seats_left   = case when v_cap is null then null else seats_left end,
         lecture_date = coalesce(v_date, lecture_date)
   where id = p_lecture;
end;
$$;

-- ── 슬롯 변경 → 슬롯 재계산 + 특강 롤업 ───────────────────────────────────────
create or replace function public.lecture_slots_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.lecture_rollup_from_slots(old.lecture_id);
    return old;
  end if;

  perform public.lecture_slot_seats_recount(new.id);
  perform public.lecture_rollup_from_slots(new.lecture_id);
  if tg_op = 'UPDATE' and old.lecture_id is distinct from new.lecture_id then
    perform public.lecture_rollup_from_slots(old.lecture_id);
  end if;
  return new;
end;
$$;

-- ⚠️ `update of capacity, lecture_id, slot_date` 로 좁히는 게 핵심이다.
--    그냥 `update` 로 두면 위 함수가 seats_left 를 쓰는 순간 자기 자신이 다시 불려
--    무한 재귀에 빠진다(값이 같아도 Postgres 는 트리거를 또 쏜다).
drop trigger if exists lecture_slots_sync on public.lecture_slots;
create trigger lecture_slots_sync
  after insert or delete or update of capacity, lecture_id, slot_date
  on public.lecture_slots
  for each row execute function public.lecture_slots_sync();

-- ── 신청 변경 → 슬롯·특강 양쪽 재계산 (기존 트리거 확장) ──────────────────────
create or replace function public.applications_lecture_seats_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.lecture_seats_recount(old.lecture_id);
    perform public.lecture_slot_seats_recount(old.slot_id);
    return old;
  end if;

  perform public.lecture_seats_recount(new.lecture_id);
  perform public.lecture_slot_seats_recount(new.slot_id);

  -- 신청을 다른 특강/시간대로 옮긴 경우 원래 자리도 돌려준다
  if tg_op = 'UPDATE' then
    if old.lecture_id is distinct from new.lecture_id then
      perform public.lecture_seats_recount(old.lecture_id);
    end if;
    if old.slot_id is distinct from new.slot_id then
      perform public.lecture_slot_seats_recount(old.slot_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists applications_lecture_seats on public.applications;
create trigger applications_lecture_seats
  after insert or delete or update of lecture_id, slot_id on public.applications
  for each row execute function public.applications_lecture_seats_sync();

-- ── 정원 초과 차단 (시간대 우선, 특강 합계는 백스톱) ──────────────────────────
create or replace function public.applications_lecture_capacity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_taken    integer;
begin
  -- ① 시간대를 고른 신청은 그 타임의 정원으로 막는다.
  --    ⚠️ 잠금 순서는 항상 '슬롯 → 특강'(교착 방지). 롤업 함수도 같은 순서다.
  if new.slot_id is not null then
    select capacity into v_capacity from public.lecture_slots where id = new.slot_id for update;
    if found and v_capacity is not null then
      select count(*) into v_taken from public.applications where slot_id = new.slot_id;
      if v_taken >= v_capacity then
        raise exception 'lecture_full'
          using errcode = 'MC001', hint = '이 시간대의 정원이 모두 찼습니다.';
      end if;
    end if;
  end if;

  -- ② 특강 전체 정원 — 슬롯이 없는 특강의 본 검사이자, 슬롯 특강의 백스톱.
  --    슬롯 특강에선 합계 정원이라, 모든 타임이 꽉 찼을 때만 여기서 걸린다.
  if new.lecture_id is null then return new; end if;

  select capacity into v_capacity
    from public.special_lectures where id = new.lecture_id
    for update;
  if not found or v_capacity is null then return new; end if;

  select count(*) into v_taken from public.applications where lecture_id = new.lecture_id;
  if v_taken >= v_capacity then
    raise exception 'lecture_full'
      using errcode = 'MC001', hint = '정원이 모두 찼습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists applications_lecture_capacity on public.applications;
create trigger applications_lecture_capacity
  before insert on public.applications
  for each row execute function public.applications_lecture_capacity_guard();

-- ── 기존 특강 정합성 맞추기(슬롯이 생긴 뒤 재실행해도 안전) ───────────────────
do $$
declare r record;
begin
  for r in select distinct lecture_id from public.lecture_slots loop
    perform public.lecture_rollup_from_slots(r.lecture_id);
  end loop;
end $$;
