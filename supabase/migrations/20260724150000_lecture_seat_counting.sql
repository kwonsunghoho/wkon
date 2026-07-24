-- =============================================================================
-- 특강 잔여석 자동 카운팅 — 신청이 들어오면 DB가 스스로 잔여석을 다시 센다
-- 적용: Supabase SQL Editor 에 전체 붙여넣고 실행 (idempotent, 재실행 안전)
-- ⚠️ verify-payment Edge Function 재배포 전에 먼저 실행할 것(정원 마감 차단 코드를
--    함수가 잡아 자동 환불하므로, 트리거가 먼저 있어야 한다).
--
-- 설계
--   capacity(정원)   = 원장. 관리자가 입력하는 유일한 값.
--   seats_left(잔여석) = 파생 캐시. `정원 − 신청 건수` 로 매번 '재계산'된다.
--   ⚠️ 차감(-1)이 아니라 재계산인 이유: 값이 어긋나도 언제든 진실로 복구되고,
--      관리자가 신청을 지우면 자리가 자동으로 돌아온다.
--   ⚠️ capacity 가 NULL 인 특강은 트리거가 손대지 않는다(구 수동 운영 그대로).
--
-- 왜 브라우저가 아니라 DB 트리거인가
--   특강 신청 경로가 셋이다 — 무료 직접 insert / 계좌이체 직접 insert /
--   토스결제 → verify-payment(service role) insert. 전부 applications insert 로
--   수렴하므로 트리거 하나면 세 경로가 다 커버된다. 반대로 브라우저에서 잔여석을
--   UPDATE 하게 하려면 special_lectures 쓰기 정책을 열어야 하는데, 그러면 누구나
--   잔여석을 조작할 수 있다(현재 쓰기는 is_admin() 만).
-- =============================================================================

-- 선행 마이그레이션(20260724130000)이 아직 안 돌았어도 이 파일만으로 완결되게 한다
alter table public.special_lectures
  add column if not exists seats_left integer;

-- ── 재계산 ────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER: anon(비회원)이 신청해도 트리거 안에서 special_lectures 를
-- 갱신하고 applications 전체를 세야 하므로 RLS 를 우회해야 한다.
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

  select count(*) into v_taken from public.applications where lecture_id = p_lecture;

  update public.special_lectures
     set seats_left = greatest(v_capacity - v_taken, 0)
   where id = p_lecture;
end;
$$;

comment on function public.lecture_seats_recount(uuid) is
  '특강 잔여석 재계산(정원 − 신청건수). 정원 NULL 이면 아무것도 하지 않는다.';

-- ── applications 변경 → 잔여석 동기화 ─────────────────────────────────────────
create or replace function public.applications_lecture_seats_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.lecture_seats_recount(old.lecture_id);
    return old;
  end if;

  perform public.lecture_seats_recount(new.lecture_id);
  -- 신청을 다른 특강으로 옮긴 경우 원래 특강의 자리도 돌려준다
  if tg_op = 'UPDATE' and old.lecture_id is distinct from new.lecture_id then
    perform public.lecture_seats_recount(old.lecture_id);
  end if;
  return new;
end;
$$;

drop trigger if exists applications_lecture_seats on public.applications;
create trigger applications_lecture_seats
  after insert or delete or update of lecture_id on public.applications
  for each row execute function public.applications_lecture_seats_sync();

-- ── 정원 초과 차단 ────────────────────────────────────────────────────────────
-- ⚠️ `for update` 행 잠금이 핵심이다. 없으면 마지막 한 자리를 두 사람이 동시에
--    통과해 정원을 넘긴다(각자 count 를 세는 순간엔 둘 다 여유가 있으므로).
--    잠금은 같은 특강 신청끼리만 잠깐 직렬화하고 트랜잭션이 끝나면 풀린다.
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
  if new.lecture_id is null then return new; end if;

  select capacity into v_capacity
    from public.special_lectures where id = new.lecture_id
    for update;
  if not found or v_capacity is null then return new; end if;   -- 정원 미설정 = 무제한

  select count(*) into v_taken from public.applications where lecture_id = new.lecture_id;
  if v_taken >= v_capacity then
    -- 코드 MC001 로 던져 클라이언트/Edge Function 이 '정원 마감'을 구분한다.
    -- (verify-payment 는 이 코드를 보고 이미 승인된 결제를 전액 자동 환불한다)
    raise exception 'lecture_full'
      using errcode = 'MC001',
            hint = '정원이 모두 찼습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists applications_lecture_capacity on public.applications;
create trigger applications_lecture_capacity
  before insert on public.applications
  for each row execute function public.applications_lecture_capacity_guard();

-- ── 특강 등록·정원 수정 시 잔여석 즉시 채우기 ─────────────────────────────────
-- 신규 특강은 신청이 0건이라 applications 트리거가 영영 안 돌아 잔여석이 비어 있다.
-- ⚠️ AFTER 에서 UPDATE 하면 자기 자신을 다시 부르므로 BEFORE 에서 NEW 를 고친다.
create or replace function public.special_lectures_seats_init()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 정원을 비우면 자동 계산 중단(관리자가 넣은 잔여석 값을 그대로 존중)
  if new.capacity is null then return new; end if;

  new.seats_left := greatest(
    new.capacity - (select count(*) from public.applications a where a.lecture_id = new.id),
    0);
  return new;
end;
$$;

drop trigger if exists special_lectures_seats_init on public.special_lectures;
create trigger special_lectures_seats_init
  before insert or update of capacity on public.special_lectures
  for each row execute function public.special_lectures_seats_init();

-- ── 기존 데이터 정리 ──────────────────────────────────────────────────────────
do $$
declare r record;
begin
  -- 정원 없이 잔여석만 손으로 관리하던 특강은 '정원 = 잔여석 + 현재 신청수'로
  -- 승격시켜 자동 계산에 편입한다(관리자가 보던 잔여석 숫자가 그대로 유지된다).
  update public.special_lectures l
     set capacity = l.seats_left
                  + (select count(*) from public.applications a where a.lecture_id = l.id)
   where l.capacity is null and l.seats_left is not null;

  for r in select id from public.special_lectures loop
    perform public.lecture_seats_recount(r.id);
  end loop;
end $$;

comment on column public.special_lectures.seats_left is
  '잔여석(자동 계산 · 파생값). capacity − 신청건수 를 트리거가 재계산한다. '
  'NULL=정원 미설정이라 미표시, <=5 강조, 0=마감. 직접 수정하지 말고 capacity 를 조정할 것.';
comment on column public.special_lectures.capacity is
  '정원(원장). 이 값이 있으면 잔여석이 자동 계산되고 정원 초과 신청이 DB 에서 차단된다.';
