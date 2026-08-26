-- =============================================================================
-- 휴대폰 본인인증(KG이니시스 통합인증 · 포트원 경유) — 2026-08-26
--
-- 배경: 20260820170000_phone_dedup 이 "문자 본인인증은 후속 — RPC 앞단에 끼운다"로
--   남겨 둔 그 후속. 온보딩에서 번호를 손으로 치는 대신 포트원 본인인증창을 거치고,
--   서버(verify-identity Edge Function)가 포트원 API 로 결과를 재조회해 이 파일의
--   apply_identity_verification() 으로만 저장한다. 가라 번호가 원천 차단된다.
--
-- 구조(오너 승인 2026-08-26 · 설계: docs/superpowers/specs/2026-08-26-identity-verification-design.md):
--   1. members 에 ci·di·birth_date·verified_at 추가. ⚠️ 공용 getMyProfile() 셀렉트에
--      넣지 말 것(미적용 환경 400 — major 전례). 화면은 별도 방어 조회.
--   2. identity_verifications 감사 표 — 절대 원칙 7(원문·결과 저장)의 인증판.
--      verification_id UNIQUE 가 같은 인증 건을 다른 계정에 재사용하는 것도 막는다.
--   3. apply_identity_verification() — service_role 전용(Edge Function 만 부른다).
--      authenticated 에 열면 화면이 인증 없이 아무 실명·CI 나 넣는다(refund_credit_for
--      를 잠근 것과 같은 이유 — 절대 grant 하지 말 것).
--   4. save_my_profile() 재정의 — 인증(verified_at)된 회원은 name·phone 입력을 무시하고
--      major 만 갱신(phone_locked:true). 인증으로 확정된 실명·번호를 화면 저장이 덮으면 안 된다.
--
-- 중복 판정은 CI 우선(같은 사람이면 번호를 바꿔도 잡힌다) + 전화번호 대조 유지.
-- 유니크 인덱스는 phone 과 같은 이유로 안 건다(기존 데이터·NULL 다수 — 판정은 RPC 한 곳,
-- 경합은 advisory lock 직렬화). verification_id 만 UNIQUE(새 표라 기존 데이터가 없다).
--
-- 미적용 시: verify-identity 가 RPC 부재(PGRST202)를 감지해 not_ready 를 돌려주고
--   온보딩은 기존 직접 입력 폼으로 조용히 폴백한다(사이트는 안 멈춘다).
--
-- 적용 확인(SQL Editor):
--   select 'apply_identity_verification' as 항목, to_regproc('public.apply_identity_verification') is not null as 적용됨
--   union all select 'identity_verifications', to_regclass('public.identity_verifications') is not null
--   union all select 'members.ci', exists (select 1 from information_schema.columns
--     where table_schema='public' and table_name='members' and column_name='ci');
-- =============================================================================

-- ── 선행분 재선언(이 파일 하나로도 성립 — 20260820170000 과 같은 원칙) ──────────
alter table public.members add column if not exists phone text;
alter table public.members add column if not exists major text;

create or replace function public.monc_norm_phone(p text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '')
$$;

create index if not exists members_phone_norm_idx
  on public.members (public.monc_norm_phone(phone));

create table if not exists public.phone_save_attempts (
  id         bigint generated always as identity primary key,
  member_id  uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists phone_save_attempts_member_idx
  on public.phone_save_attempts (member_id, created_at);
alter table public.phone_save_attempts enable row level security;

-- ── 1. members 인증 컬럼 ────────────────────────────────────────────────────
alter table public.members add column if not exists ci          text;
alter table public.members add column if not exists di          text;
alter table public.members add column if not exists birth_date  date;
alter table public.members add column if not exists verified_at timestamptz;

comment on column public.members.ci is
  '본인인증 연계정보(암호화된 이용자 확인값) — privacy.html 고지 항목. 중복 가입 판정의 1차 키.';
comment on column public.members.di is
  '본인인증 중복가입확인정보 — privacy.html 고지 항목.';
comment on column public.members.verified_at is
  '휴대폰 본인인증 완료 시각. 값이 있으면 save_my_profile 이 name·phone 을 잠근다.';

create index if not exists members_ci_idx on public.members (ci) where ci is not null;

-- ── 2. 감사 표(재사용 차단 겸) — service_role 만 ────────────────────────────
create table if not exists public.identity_verifications (
  id              bigint generated always as identity primary key,
  member_id       uuid not null references public.members(id) on delete cascade,
  verification_id text not null unique,   -- 포트원 identityVerificationId — 다른 계정 재사용 차단
  name            text,
  phone           text,
  birth_date      date,
  ci              text,
  di              text,
  created_at      timestamptz not null default now()
);
create index if not exists identity_verifications_member_idx
  on public.identity_verifications (member_id, created_at);

alter table public.identity_verifications enable row level security;
-- 정책 없음 = 클라이언트 전면 차단(service_role 은 RLS 를 통과한다). 본인 조회 창구도 안 연다.

comment on table public.identity_verifications is
  '휴대폰 본인인증 감사 원장(2026-08-26) — verify-identity Edge Function 만 기록. 개인정보 표 — 값 조회 창구 없음.';

-- ── 3. 인증 결과 반영 RPC — service_role 전용 ───────────────────────────────
create or replace function public.apply_identity_verification(
  p_member uuid, p_verification_id text, p_name text, p_phone text,
  p_birth date, p_ci text, p_di text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digits   text := public.monc_norm_phone(p_phone);
  v_canon    text;
  v_other    uuid;
  v_provider text;
  v_fresh    boolean;
  v_prev     record;
begin
  if p_member is null or coalesce(trim(p_verification_id), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'bad_request');
  end if;

  -- 휴대전화 형식 — save_my_profile 과 같은 규칙(가라 번호는 인증사가 걸렀지만 형은 우리가 확정)
  if v_digits is null or v_digits !~ '^(010[0-9]{8}|01[16789][0-9]{7,8})$' then
    return jsonb_build_object('ok', false, 'code', 'bad_phone');
  end if;
  -- 하이픈 표준형(010-1234-5678) — 화면 표시·문자 발송과 한 형(saveMyProfile canonical 과 동일)
  v_canon := case when length(v_digits) = 11
                  then substr(v_digits,1,3) || '-' || substr(v_digits,4,4) || '-' || substr(v_digits,8,4)
                  else substr(v_digits,1,3) || '-' || substr(v_digits,4,3) || '-' || substr(v_digits,7,4) end;

  -- 동시 인증 경합 직렬화 — CI·번호 두 키 모두(phone_dedup 과 같은 방식)
  perform pg_advisory_xact_lock(hashtext('monc_member_ci:' || coalesce(p_ci, v_digits)));
  perform pg_advisory_xact_lock(hashtext('monc_member_phone:' || v_digits));

  -- 같은 인증 건 재사용 — 같은 회원의 재호출(복귀 중복)은 멱등 통과, 다른 계정이면 차단
  select member_id into v_prev from public.identity_verifications
   where verification_id = p_verification_id limit 1;
  if found then
    if v_prev.member_id = p_member then
      return jsonb_build_object('ok', true, 'already', true, 'name', p_name, 'phone', v_canon);
    end if;
    return jsonb_build_object('ok', false, 'code', 'verification_used');
  end if;

  -- CI 중복 — 같은 사람이 이미 다른 계정으로 가입돼 있다(번호를 바꿔도 잡힌다)
  if coalesce(trim(p_ci), '') <> '' then
    select m.id into v_other from public.members m
     where m.id <> p_member and m.ci = p_ci
     order by m.created_at desc limit 1;
  end if;

  -- 전화번호 중복 — CI 미적재 시절 회원·CI 미제공 인증사 대비(기존 판정 유지)
  if v_other is null then
    select m.id into v_other from public.members m
     where m.id <> p_member and public.monc_norm_phone(m.phone) = v_digits
     order by m.created_at desc limit 1;
  end if;

  if v_other is not null then
    select u.raw_app_meta_data->>'provider' into v_provider from auth.users u where u.id = v_other;
    select (m.created_at > now() - interval '60 minutes') into v_fresh
      from public.members m where m.id = p_member;
    return jsonb_build_object('ok', false, 'code', 'dup_phone',
      'provider', v_provider, 'me_fresh', coalesce(v_fresh, false));
  end if;

  update public.members
     set name        = coalesce(nullif(trim(p_name), ''), name),   -- 인증 실명이 원장
         phone       = v_canon,
         birth_date  = coalesce(p_birth, birth_date),
         ci          = coalesce(nullif(trim(p_ci), ''), ci),
         di          = coalesce(nullif(trim(p_di), ''), di),
         verified_at = now()
   where id = p_member;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'member_not_found');
  end if;

  insert into public.identity_verifications
    (member_id, verification_id, name, phone, birth_date, ci, di)
  values
    (p_member, p_verification_id, nullif(trim(p_name), ''), v_canon, p_birth,
     nullif(trim(p_ci), ''), nullif(trim(p_di), ''));

  return jsonb_build_object('ok', true, 'name', nullif(trim(p_name), ''), 'phone', v_canon);
end $$;

comment on function public.apply_identity_verification(uuid, text, text, text, date, text, text) is
  '본인인증 결과 반영(2026-08-26) — verify-identity Edge Function(service_role) 전용. CI·번호 중복 판정 후 members 갱신 + 감사 기록. authenticated 에 절대 grant 금지.';

revoke all on function public.apply_identity_verification(uuid, text, text, text, date, text, text)
  from public, anon, authenticated;
-- service_role 은 기본 실행 권한 + RLS 통과로 충분(별도 grant 불요하지만 명시해 둔다)
grant execute on function public.apply_identity_verification(uuid, text, text, text, date, text, text)
  to service_role;

-- ── 4. save_my_profile 재정의 — 인증 회원은 name·phone 잠금 ──────────────────
-- 20260820170000 정의 + 맨 앞 verified 가드 한 단. 이 파일이 최종 정의다 —
-- ⚠️ 20260820170000 을 이 파일 뒤에 다시 실행하면 잠금이 사라진다(동명 함수 재실행 경고,
--    implementation-status.md '동명 함수 재실행 경고' 절에 등재).
create or replace function public.save_my_profile(p_name text, p_phone text, p_major text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_phone    text := public.monc_norm_phone(p_phone);
  v_locked   boolean;
  v_other    uuid;
  v_provider text;
  v_fresh    boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;

  -- 본인인증 완료 회원 — 실명·번호는 인증이 원장이라 화면 저장이 못 덮는다. 전공만 갱신.
  select (verified_at is not null) into v_locked from public.members where id = v_uid;
  if coalesce(v_locked, false) then
    update public.members
       set major = coalesce(nullif(trim(p_major), ''), major)
     where id = v_uid;
    return jsonb_build_object('ok', true, 'phone_locked', true);
  end if;

  -- 형식 최종 검사 — phone-check.js 와 같은 규칙(010 은 11자리, 01x 구 국번은 10~11자리)
  if v_phone is null or v_phone !~ '^(010[0-9]{8}|01[16789][0-9]{7,8})$' then
    return jsonb_build_object('ok', false, 'code', 'bad_phone');
  end if;

  -- 조회 남용 방지 — 계정당 24시간 10회(정상 사용은 한두 번이면 끝난다)
  insert into public.phone_save_attempts (member_id) values (v_uid);
  if (select count(*) from public.phone_save_attempts
       where member_id = v_uid and created_at > now() - interval '24 hours') > 10 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  -- 같은 번호 동시 저장 경합 직렬화(신청 중복 방지와 같은 방식)
  perform pg_advisory_xact_lock(hashtext('monc_member_phone:' || v_phone));

  select m.id into v_other
    from public.members m
   where m.id <> v_uid
     and public.monc_norm_phone(m.phone) = v_phone
   order by m.created_at desc
   limit 1;

  if v_other is not null then
    -- 기존 계정의 로그인 수단(구글/카카오) — 화면이 "어디로 돌아갈지"를 바로 알려 준다
    select u.raw_app_meta_data->>'provider' into v_provider
      from auth.users u where u.id = v_other;
    -- 지금 계정이 방금 만들어진 빈 계정인지(60분) — 화면의 '방금 계정 삭제' 흐름 판단 재료.
    -- 전화번호 가드가 회원 기능을 막고 있어, 번호 없는 계정에는 도구 기록이 쌓일 수 없다.
    select (m.created_at > now() - interval '60 minutes') into v_fresh
      from public.members m where m.id = v_uid;
    return jsonb_build_object('ok', false, 'code', 'dup_phone',
      'provider', v_provider, 'me_fresh', coalesce(v_fresh, false));
  end if;

  -- name·major 는 빈 값이면 기존 값 유지(마이페이지는 번호만 보낸다)
  update public.members
     set name  = coalesce(nullif(trim(p_name), ''), name),
         phone = nullif(trim(p_phone), ''),
         major = coalesce(nullif(trim(p_major), ''), major)
   where id = v_uid;

  return jsonb_build_object('ok', true);
end $$;

comment on function public.save_my_profile(text, text, text) is
  '프로필(이름·전화·전공) 저장 + 전화번호 중복 가입 차단(2026-08-20) + 본인인증 회원 잠금(2026-08-26). 온보딩·마이페이지 공용. 본인 대상, 24시간 10회 제한.';

revoke all on function public.save_my_profile(text, text, text) from public, anon;
grant execute on function public.save_my_profile(text, text, text) to authenticated;
