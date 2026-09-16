-- =============================================================================
-- 재학생 자가 신청 → 관리자 승인 (2026-09-16 오너 "재학생들이 따로 신청하면 내가 등업")
-- =============================================================================
-- 배경: 재학생이 많아 번호를 admin 에 미리 넣는 방식이 버겁다. 학생이 마이페이지에서
--   [재학생 신청]을 누르면 명단에 '승인 대기'로 올라오고, 오너가 종료일을 정해 승인한다.
--   판정·무료 접수 함수(20260909120000)는 그대로 — 명단 줄에 status 만 더한다.
-- ⚠️ 신청은 **본인인증(verified_at)한 회원만** 받는다. 인증 번호가 곧 판정 기준이라
--    미인증 상태로 대기줄에 올라가면 승인해도 무료가 안 된다(오너가 헛승인하게 된다).
-- ⚠️ 미적용 상태 degrade: 마이페이지 신청 버튼이 `not_ready` 를 받아 안내로 멈추고,
--    admin 은 status 컬럼 없이도 목록을 그린다(select('*') · status 없으면 전부 승인 취급).
-- 실행: Supabase SQL Editor 에 전체 붙여넣고 Run. idempotent. 선행: 20260909120000.
-- =============================================================================

-- ── 1. 명단에 상태·신청자 연결 ──────────────────────────────────────────────
alter table public.academy_students
  add column if not exists status       text not null default 'approved',
  add column if not exists member_id    uuid references public.members(id) on delete set null,
  add column if not exists requested_at timestamptz;

do $$ begin
  alter table public.academy_students
    add constraint academy_students_status_check check (status in ('pending', 'approved'));
exception when duplicate_object then null; end $$;

-- 대기 줄은 종료일이 아직 없다 — 승인할 때 오너가 정한다
alter table public.academy_students alter column valid_until drop not null;

comment on column public.academy_students.status is
  'pending = 학생이 신청했고 승인 대기 · approved = 무료 적용(valid_until 까지). 판정은 approved 만 본다.';

-- ── 2. 판정 — approved + 종료일 있음 + 기간 안 ──────────────────────────────
create or replace function public.monc_is_student()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.members m
      join public.academy_students s
        on s.phone_norm = public.monc_norm_phone(m.phone)
     where m.id = auth.uid()
       and m.verified_at is not null
       and s.status = 'approved'
       and s.valid_until is not null
       and s.valid_until >= current_date
  );
$$;

-- 화면용 — student(무료 적용 중) · status(approved/pending/null) · until · verified
-- pending 이면 student=false 지만 status 로 '대기 중'을 보여 줄 수 있다.
create or replace function public.my_student_status()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object(
              'student',  s.status = 'approved' and s.valid_until is not null and s.valid_until >= current_date,
              'status',   case when s.status = 'approved' and (s.valid_until is null or s.valid_until < current_date)
                               then 'expired' else s.status end,
              'until',    s.valid_until,
              'verified', true)
       from public.members m
       join public.academy_students s
         on s.phone_norm = public.monc_norm_phone(m.phone)
      where m.id = auth.uid()
        and m.verified_at is not null
      limit 1),
    jsonb_build_object(
      'student', false, 'status', null, 'until', null,
      'verified', exists (select 1 from public.members m where m.id = auth.uid() and m.verified_at is not null))
  );
$$;

-- ── 3. 학생 신청 — 인증 번호로 '승인 대기' 줄을 만든다 ───────────────────────
create or replace function public.request_student_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text;
  v_phone text;
  v_norm  text;
  v_row   record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_authenticated'); end if;

  select m.name, m.phone into v_name, v_phone
    from public.members m where m.id = v_uid and m.verified_at is not null;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_verified'); end if;
  v_norm := public.monc_norm_phone(v_phone);
  if v_norm is null then return jsonb_build_object('ok', false, 'code', 'not_verified'); end if;

  select * into v_row from public.academy_students s where s.phone_norm = v_norm;
  if found then
    if v_row.status = 'pending' then
      return jsonb_build_object('ok', true, 'code', 'pending');
    end if;
    if v_row.valid_until is not null and v_row.valid_until >= current_date then
      return jsonb_build_object('ok', true, 'code', 'already', 'until', v_row.valid_until);
    end if;
    -- 기간이 끝난 줄 — 재신청으로 대기줄에 다시 올린다(오너가 종료일을 새로 정한다)
    update public.academy_students
       set status = 'pending', requested_at = now(), member_id = v_uid,
           name = coalesce(name, v_name)
     where phone_norm = v_norm;
    return jsonb_build_object('ok', true, 'code', 'pending');
  end if;

  insert into public.academy_students (phone_norm, name, valid_until, status, member_id, requested_at)
  values (v_norm, v_name, null, 'pending', v_uid, now());
  return jsonb_build_object('ok', true, 'code', 'pending');
end;
$$;

comment on function public.request_student_status() is
  '회원이 재학생 무료를 신청한다(마이페이지). 인증 회원만 · 승인 대기 줄 생성. 승인은 admin 이 status/valid_until 을 바꿔서.';

revoke all on function public.request_student_status() from public, anon;
grant execute on function public.request_student_status() to authenticated;

-- =============================================================================
-- 롤백
--   drop function if exists public.request_student_status();
--   (monc_is_student · my_student_status 는 20260909120000 판으로 다시 만든다)
--   alter table public.academy_students drop column if exists status, drop column if exists member_id,
--     drop column if exists requested_at;
-- =============================================================================
