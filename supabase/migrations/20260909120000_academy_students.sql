-- =============================================================================
-- 재학생 무료 참여 (2026-09-09 오너 "재학생들은 챌린지 신청할때 무료로")
-- =============================================================================
-- 설계: docs/superpowers/specs/2026-09-09-academy-student-free-design.md
--
-- 학원 재학생을 **전화번호 명단**으로 등록해 두면, 그 번호로 본인인증한 회원이
-- 챌린지·특강·연구실 자료를 화면에서 0원으로 접수한다. 크레딧 충전은 대상이 아니다
-- (AI 원가가 매번 나가는 값 — 오너 확정).
--
-- ⚠️ 포트원을 부르지 않으므로 Edge Function 이 아니라 DB 함수로 둔다. 판정·기록이 전부
--    한 트랜잭션 안에서 끝나고, 배포도 이 파일을 SQL Editor 에서 실행하는 것으로 끝난다.
-- ⚠️ **명단의 번호는 개인정보다 — 레포에 insert 문을 커밋하지 않는다.** 등록은 admin
--    '회원 관리' 탭의 '재학생 명단'에서 한다(CLAUDE.md '개인정보' 절).
-- ⚠️ 원장은 여전히 `applications.payment_status='free'` 하나다. 자동(이 함수)·수동(admin
--    토글)을 구분하는 컬럼을 만들지 말 것 — 미입금 판정 두 곳과 CSV '재학생' 칸이
--    전부 이 값 하나를 본다.
-- ⚠️ 미적용 상태 degrade: 화면이 `my_student_status()` 를 못 찾으면 조용히 '재학생 아님'
--    으로 떨어져 지금과 똑같은 유료 화면이 된다(무료가 열리는 방향으로 실패하지 않는다).
--
-- 실행: Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260820170000(monc_norm_phone) · 20260826150000(members.verified_at) ·
--       20260725120000(중복 신청 트리거) · 20260801160000(lab_purchases)
-- =============================================================================


-- ── 1. 명단 ─────────────────────────────────────────────────────────────────
-- 키가 정규화 번호인 이유: 화면에 어떻게 적어 넣든(하이픈·공백·+82) 한 사람은 한 줄이다.
create table if not exists public.academy_students (
  phone_norm  text primary key,
  name        text,                    -- 오너 확인용. 판정에는 쓰지 않는다(오너 확정 2026-09-09)
  valid_until date not null,           -- 이 날짜까지 무료(당일 포함)
  memo        text,
  created_by  uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.academy_students is
  '학원 재학생 명단(관리자 전용). 이 번호로 본인인증한 회원이 챌린지·특강·자료를 무료로 접수한다. 번호 = 개인정보 — 값 insert 를 레포에 커밋하지 말 것.';
comment on column public.academy_students.name is
  '오너 확인용 표시 이름. 무료 판정은 번호만 본다 — 개명·표기 차이로 무료가 막히지 않게(오너 확정 2026-09-09).';
comment on column public.academy_students.valid_until is
  '무료 종료일(당일 포함). 지난 줄은 지우지 않는다 — 판정에서만 빠진다.';

alter table public.academy_students enable row level security;

-- 관리자만. 회원에게 열지 말 것 — 번호 목록 자체가 개인정보다.
-- 회원 본인의 '나는 재학생인가'는 아래 my_student_status() 가 대신 답한다.
drop policy if exists academy_students_admin on public.academy_students;
create policy academy_students_admin on public.academy_students
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ── 2. 판정 ─────────────────────────────────────────────────────────────────
-- ⚠️ **본인인증(verified_at)을 요구하는 것이 이 설계의 문지기다.** 프로필 전화번호는
--    save_my_profile 이 '다른 계정과 겹치는가'만 보므로, 아직 아무도 안 쓴 남의 번호는
--    적어 넣을 수 있다. 인증 번호(verify-identity 가 서버에서 적는다)만 믿는다.
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
       and s.valid_until >= current_date
  );
$$;

comment on function public.monc_is_student() is
  '지금 로그인한 회원이 재학생(무료 대상)인가. 인증 번호 + academy_students + 기간. 화면 값을 믿지 않고 무료 접수 함수들이 각자 다시 부른다.';

-- 화면용 — 명단은 노출하지 않고 '나'에 대한 답만 준다.
create or replace function public.my_student_status()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('student', true, 'until', s.valid_until)
       from public.members m
       join public.academy_students s
         on s.phone_norm = public.monc_norm_phone(m.phone)
      where m.id = auth.uid()
        and m.verified_at is not null
        and s.valid_until >= current_date
      limit 1),
    jsonb_build_object('student', false, 'until', null)
  );
$$;

revoke all on function public.monc_is_student()   from public, anon;
revoke all on function public.my_student_status() from public, anon;
grant execute on function public.monc_is_student()   to authenticated;
grant execute on function public.my_student_status() to authenticated;


-- ── 3. 무료 접수 ① 챌린지 ───────────────────────────────────────────────────
-- ⚠️ 브라우저는 **챌린지 id 배열만** 보낸다. 기수·이름·금액은 서버가 정한다 —
--    기수를 브라우저가 정하면 마감된 기수에 무료로 끼어들 수 있다.
-- ⚠️ 중복 신청(MC002)·기수 판정은 기존 트리거가 그대로 한다. 여기서 다시 구현하지 말 것.
create or replace function public.apply_free_challenges(p_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text;
  v_phone text;
  v_id    text;
  v_ids   text[];
  v_round int;
  v_items jsonb := '[]'::jsonb;
  v_hint  text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_authenticated'); end if;
  if not public.monc_is_student() then return jsonb_build_object('ok', false, 'code', 'not_student'); end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('ok', false, 'code', 'no_selection');
  end if;
  if array_length(p_ids, 1) > 10 then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;

  -- 신청자 정보도 브라우저가 아니라 계정에서 읽는다(무료는 로그인 회원만이라 언제나 있다).
  select m.name, m.phone into v_name, v_phone from public.members m where m.id = v_uid;
  if coalesce(btrim(v_name), '') = '' or coalesce(btrim(v_phone), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'profile_missing');
  end if;

  -- 같은 챌린지를 두 번 담아 보내도 한 번만 접수한다(중복 트리거는 다른 신청 건끼리만 본다).
  select array_agg(distinct x) into v_ids from unnest(p_ids) x where coalesce(btrim(x), '') <> '';
  if v_ids is null then return jsonb_build_object('ok', false, 'code', 'no_selection'); end if;

  foreach v_id in array v_ids
  loop
    -- 모집 중(recruit_start 지났고 recruit_end 안 지난) 기수만. 선착순 기수는 recruit_end 가 없다.
    select r.round into v_round
      from public.challenge_rounds r
     where r.challenge = v_id
       and (r.recruit_start is null or r.recruit_start <= current_date)
       and (r.recruit_end   is null or r.recruit_end   >= current_date)
     order by r.recruit_end asc nulls last
     limit 1;

    if v_round is null then
      return jsonb_build_object('ok', false, 'code', 'not_open', 'challenge', v_id);
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'challenge', v_id,
      -- 표시 이름 — apply.html CHALLENGES 의 fullName 과 같은 문자열. 화면 표시용이라
      -- 판정에는 쓰이지 않는다(admin 은 id 로 라벨을 붙인다).
      'name', case v_id
                when 'voice'      then '보.신.각(보이스) - 목소리 챌린지'
                when 'answer'     then '승.자.각(답변) - 답변 챌린지'
                when 'expression' then '영.합.각(표현력) - 영상면접 표현력 챌린지'
                when 'spinning'   then '스.피.닝(스피치) - 말 맛 챌린지'
                when 'culture'    then '댄.특.완(대한항공 특화 답변 완성) - 기업분석 챌린지'
                else v_id
              end,
      'round', v_round,
      'price', 0
    ));
  end loop;

  insert into public.applications (name, phone, challenges, total_price, payment_status, paid, member_id)
  values (v_name, v_phone, v_items, 0, 'free', false, v_uid);

  return jsonb_build_object('ok', true, 'items', v_items);
exception
  -- 중복 신청 — 트리거(MC002)가 막았다. hint 에 '무엇이' 중복인지 들어 있다.
  when sqlstate 'MC002' then
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'code', 'duplicate', 'program', v_hint);
end;
$$;

comment on function public.apply_free_challenges(text[]) is
  '재학생 무료 챌린지 접수. 기수·이름·금액은 서버가 정하고 payment_status=free 로 남긴다(원장은 수동 무료와 같은 값).';


-- ── 4. 무료 접수 ② 특강 ─────────────────────────────────────────────────────
-- 좌석은 기존 트리거가 센다 — monc_app_live() 가 'free' 를 '살아있는 자리'로 보므로
-- 무료 접수도 정원을 정확히 한 자리 줄인다(20260822130000).
create or replace function public.apply_free_lecture(p_lecture uuid, p_slot uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text;
  v_phone text;
  v_lec   record;
  v_slot  record;
  v_entry jsonb;
  v_hint  text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_authenticated'); end if;
  if not public.monc_is_student() then return jsonb_build_object('ok', false, 'code', 'not_student'); end if;

  select m.name, m.phone into v_name, v_phone from public.members m where m.id = v_uid;
  if coalesce(btrim(v_name), '') = '' or coalesce(btrim(v_phone), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'profile_missing');
  end if;

  select l.id, l.title, l.visible into v_lec
    from public.special_lectures l where l.id = p_lecture;
  if not found or v_lec.visible is not true then
    return jsonb_build_object('ok', false, 'code', 'lecture_not_found');
  end if;

  v_entry := jsonb_build_object('type', 'lecture', 'lecture_id', v_lec.id, 'name', v_lec.title, 'price', 0);

  -- ⚠️ 브라우저가 보낸 시간대가 정말 이 특강의 것인지 확인한다(verify-payment 와 같은 검사).
  if p_slot is not null then
    select s.id, s.slot_date, s.start_time, s.label into v_slot
      from public.lecture_slots s where s.id = p_slot and s.lecture_id = v_lec.id;
    if not found then return jsonb_build_object('ok', false, 'code', 'slot_not_found'); end if;
    -- 표기는 verify-payment 와 같은 모양('2026-09-20 14:00' · 없으면 label).
    v_entry := v_entry || jsonb_build_object(
      'slot_id', v_slot.id,
      'slot', coalesce(
        nullif(concat_ws(' ', v_slot.slot_date::text, substring(v_slot.start_time::text from 1 for 5)), ''),
        v_slot.label)
    );
  end if;

  insert into public.applications
    (name, phone, challenges, total_price, payment_status, paid, member_id, lecture_id, slot_id)
  values
    (v_name, v_phone, jsonb_build_array(v_entry), 0, 'free', false, v_uid, v_lec.id, p_slot);

  return jsonb_build_object('ok', true, 'lecture', v_lec.title);
exception
  when sqlstate 'MC001' then          -- 정원 마감 — 접수하는 사이 마지막 자리가 나갔다
    return jsonb_build_object('ok', false, 'code', 'lecture_full');
  when sqlstate 'MC002' then
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'code', 'duplicate', 'program', v_hint);
end;
$$;

comment on function public.apply_free_lecture(uuid, uuid) is
  '재학생 무료 특강 접수. 좌석·중복은 기존 트리거가 판정한다(무료 행도 자리를 한 칸 차지한다).';


-- ── 5. 무료 접수 ③ 연구실 자료 ──────────────────────────────────────────────
-- ⚠️ **lab_purchases 에 회원 자가 INSERT 정책을 만들지 말 것**(20260801160000 경고).
--    이 security definer 함수만 0원 기록을 넣는다.
create or replace function public.claim_free_resource(p_resource uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_res record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_authenticated'); end if;
  if not public.monc_is_student() then return jsonb_build_object('ok', false, 'code', 'not_student'); end if;

  select r.id, r.title, r.price, r.published into v_res
    from public.lab_resources r where r.id = p_resource;
  if not found or v_res.published is not true then
    return jsonb_build_object('ok', false, 'code', 'resource_not_found');
  end if;
  -- 0원 자료는 애초에 구매 대상이 아니다(로그인만으로 열린다) — 기록을 만들지 않는다.
  if coalesce(v_res.price, 0) <= 0 then
    return jsonb_build_object('ok', true, 'free_already', true, 'resource', v_res.title);
  end if;

  insert into public.lab_purchases (resource_id, user_id, amount, payment_id)
  values (v_res.id, v_uid, 0, null);

  return jsonb_build_object('ok', true, 'resource', v_res.title);
exception
  when unique_violation then     -- 이미 가진 자료 — 실패가 아니다
    return jsonb_build_object('ok', true, 'already', true, 'resource', v_res.title);
end;
$$;

comment on function public.claim_free_resource(uuid) is
  '재학생 무료 자료 받기. lab_purchases 에 0원 기록(자가 INSERT 정책 대신 이 함수만).';


-- ── 6. 실행 권한 ────────────────────────────────────────────────────────────
-- anon 에는 주지 않는다 — 무료는 로그인·본인인증 회원만이다.
revoke all on function public.apply_free_challenges(text[]) from public, anon;
revoke all on function public.apply_free_lecture(uuid, uuid) from public, anon;
revoke all on function public.claim_free_resource(uuid)     from public, anon;
grant execute on function public.apply_free_challenges(text[]) to authenticated;
grant execute on function public.apply_free_lecture(uuid, uuid) to authenticated;
grant execute on function public.claim_free_resource(uuid)     to authenticated;


-- =============================================================================
-- 적용 확인
--   select public.my_student_status();                 -- 관리자 계정이면 {"student":false,…}
--   select count(*) from public.academy_students;      -- 0 (명단은 admin 화면에서 넣는다)
-- 롤백
--   drop function if exists public.apply_free_challenges(text[]);
--   drop function if exists public.apply_free_lecture(uuid, uuid);
--   drop function if exists public.claim_free_resource(uuid);
--   drop function if exists public.my_student_status();
--   drop function if exists public.monc_is_student();
--   drop table if exists public.academy_students;
-- =============================================================================
