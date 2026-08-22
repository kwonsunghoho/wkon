-- =============================================================================
-- 특강 잔여석·정원 — 환불·취소 신청을 자리에서 뺀다 (2026-08-22 감사 수리 #4)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260725120000(monc_app_live) — 없으면 아래 가드가 명시적으로 멈춘다.
--
-- 왜 필요한가 ─────────────────────────────────────────────────────────────────
--   잔여석·정원 판정 함수 4곳이 전부 상태 무관 count(*) 였다. 그 뒤 만든 환불
--   흐름(cancel-payment·admin [환불])은 행을 지우지 않고 payment_status 만 바꾸므로:
--     · 환불된 좌석이 영영 안 돌아온다 — 실제론 빈 자리인데 가짜 만석(MC001)으로
--       다음 학생이 결제 승인 뒤 자동 환불로 튕길 수 있다(경고 없는 매출 손실).
--     · 재계산 트리거가 `update of lecture_id, slot_id` 라 상태 변경으로는 아예 안 돈다.
--     · 중복 가드(monc_app_live)는 환불 건을 '자리 비운 것'으로 쳐 재신청을 허용하는데,
--       좌석 카운트는 두 행을 다 세서 정원이 이중으로 준다 — 같은 시기 설계끼리 모순.
--
-- 무엇을 하나 ─────────────────────────────────────────────────────────────────
--   좌석을 세는 모든 자리(특강 재계산·슬롯 재계산·정원 가드·특강 seats_init)에
--   monc_app_live(refunded, payment_status) 필터를 넣는다 — 중복 가드와 **한 기준**.
--   재계산 트리거를 payment_status·refunded 변경에도 돌게 넓히고, 마지막에 전체
--   재계산으로 이미 환불된 좌석을 즉시 돌려준다.
--
-- ⚠️ 부분 환불(partial_refunded)도 '자리 비움'이다 — monc_app_live·재신청 허용과 같은
--    기준. 부분 환불인데 수강을 유지시키고 싶으면 환불 대신 memo 로 조정할 것.
--    (챌린지 제출 판정 is_challenge_participant 는 반대로 부분 환불을 참가 유지로
--    본다 — 좌석은 '미래의 자리', 제출은 '이미 참가한 사실'이라 기준이 다른 게 맞다.)
-- ⚠️ 이 파일이 좌석 함수·트리거의 **최종 정의**다. 구 20260724150000·160000 을 이
--    뒤에 다시 실행하면 환불 필터(150000·160000)와 슬롯 검사(150000)가 사라진다 —
--    의심되면 이 파일만 다시 실행하면 복구된다.
-- =============================================================================

-- 0. 선행 확인 — monc_app_live 없이 돌리면 좌석 판정이 통째로 죽으므로 먼저 멈춘다
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'monc_app_live') then
    raise exception '선행 마이그레이션 20260725120000(중복 신청 가드 · monc_app_live)을 먼저 실행하세요';
  end if;
end $$;

-- 1. 특강 잔여석 재계산 — 살아있는 신청만 센다 --------------------------------
create or replace function public.lecture_seats_recount(p_lecture uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_taken    integer;
begin
  if p_lecture is null then return; end if;

  select capacity into v_capacity from public.special_lectures where id = p_lecture;
  if not found or v_capacity is null then return; end if;   -- 정원 미설정 = 자동 계산 대상 아님

  select count(*) into v_taken
    from public.applications a
   where a.lecture_id = p_lecture
     and public.monc_app_live(a.refunded, a.payment_status);

  update public.special_lectures
     set seats_left = greatest(v_capacity - v_taken, 0)
   where id = p_lecture;
end;
$$;

comment on function public.lecture_seats_recount(uuid) is
  '특강 잔여석 재계산(정원 − 살아있는 신청건수 · 환불/취소 제외 — monc_app_live 기준). 정원 NULL 이면 무시.';

-- 2. 슬롯(시간대) 잔여석 재계산 — 동일 기준 ------------------------------------
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

  select count(*) into v_taken
    from public.applications a
   where a.slot_id = p_slot
     and public.monc_app_live(a.refunded, a.payment_status);

  update public.lecture_slots
     set seats_left = greatest(v_capacity - v_taken, 0)
   where id = p_slot;
end;
$$;

-- 3. 신청 변경 → 슬롯·특강 재계산 ---------------------------------------------
-- ⚠️ 잠금 순서는 반드시 **슬롯 → 특강**이다(구 20260724160000 판은 특강→슬롯이었다 —
--    이 트리거가 환불(payment_status 변경)에도 돌게 되면서, 정원 가드(슬롯 for update →
--    특강 for update)와 순서가 어긋나면 환불과 신규 결제가 겹칠 때 교착이 난다.
--    2026-08-22 검증에서 실 DB 재현 — 순서를 가드와 맞춰 해소).
create or replace function public.applications_lecture_seats_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.lecture_slot_seats_recount(old.slot_id);
    perform public.lecture_seats_recount(old.lecture_id);
    return old;
  end if;

  perform public.lecture_slot_seats_recount(new.slot_id);
  perform public.lecture_seats_recount(new.lecture_id);

  if tg_op = 'UPDATE' then
    if old.slot_id is distinct from new.slot_id then
      perform public.lecture_slot_seats_recount(old.slot_id);
    end if;
    if old.lecture_id is distinct from new.lecture_id then
      perform public.lecture_seats_recount(old.lecture_id);
    end if;
  end if;
  return new;
end;
$$;

-- ⚠️ payment_status·refunded 를 감시 목록에 넣는 게 이번 수리의 핵심이다 —
--    환불(상태 변경)이 나야 자리가 돌아온다. seats_left 는 special_lectures 쪽이라 재귀 없음.
drop trigger if exists applications_lecture_seats on public.applications;
create trigger applications_lecture_seats
  after insert or delete or update of lecture_id, slot_id, payment_status, refunded
  on public.applications
  for each row execute function public.applications_lecture_seats_sync();

-- 4. 정원 초과 차단 — 가드도 같은 기준으로 세야 환불로 빈 자리가 팔린다 ---------
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
  -- ① 시간대를 고른 신청은 그 타임의 정원으로 막는다(잠금 순서: 슬롯 → 특강).
  if new.slot_id is not null then
    select capacity into v_capacity from public.lecture_slots where id = new.slot_id for update;
    if found and v_capacity is not null then
      select count(*) into v_taken
        from public.applications a
       where a.slot_id = new.slot_id
         and public.monc_app_live(a.refunded, a.payment_status);
      if v_taken >= v_capacity then
        raise exception 'lecture_full'
          using errcode = 'MC001', hint = '이 시간대의 정원이 모두 찼습니다.';
      end if;
    end if;
  end if;

  -- ② 특강 전체 정원 — 슬롯 없는 특강의 본 검사이자, 슬롯 특강의 백스톱.
  if new.lecture_id is null then return new; end if;

  select capacity into v_capacity
    from public.special_lectures where id = new.lecture_id
    for update;
  if not found or v_capacity is null then return new; end if;

  select count(*) into v_taken
    from public.applications a
   where a.lecture_id = new.lecture_id
     and public.monc_app_live(a.refunded, a.payment_status);
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

-- 5. 특강 등록·정원 수정 시 잔여석 즉시 채우기 — 같은 기준 ----------------------
create or replace function public.special_lectures_seats_init()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.capacity is null then return new; end if;

  new.seats_left := greatest(
    new.capacity - (select count(*) from public.applications a
                     where a.lecture_id = new.id
                       and public.monc_app_live(a.refunded, a.payment_status)),
    0);
  return new;
end;
$$;

drop trigger if exists special_lectures_seats_init on public.special_lectures;
create trigger special_lectures_seats_init
  before insert or update of capacity on public.special_lectures
  for each row execute function public.special_lectures_seats_init();

-- 6. 전체 재계산 — 이미 환불된 좌석을 지금 돌려준다 ----------------------------
do $$
declare r record;
begin
  for r in select id from public.special_lectures loop
    perform public.lecture_seats_recount(r.id);
  end loop;
  for r in select id from public.lecture_slots loop
    perform public.lecture_slot_seats_recount(r.id);
  end loop;
end $$;

-- =============================================================================
-- 적용 확인 — 환불 건이 있는 특강의 잔여석이 그만큼 늘어 있으면 정상
-- =============================================================================
-- select l.title, l.capacity, l.seats_left,
--        count(*) filter (where monc_app_live(a.refunded, a.payment_status)) as 산_자리,
--        count(*) filter (where not monc_app_live(a.refunded, a.payment_status)) as 뺀_자리
--   from public.special_lectures l
--   left join public.applications a on a.lecture_id = l.id
--  group by l.id order by l.created_at desc;
-- =============================================================================
