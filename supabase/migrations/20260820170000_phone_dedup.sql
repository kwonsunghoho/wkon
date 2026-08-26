-- =============================================================================
-- 전화번호 중복 가입 차단 — save_my_profile RPC (2026-08-20 오너 확정)
--
-- 배경: 카카오 로그인은 이메일을 아예 안 받아(KOE205 회피 — profile_nickname 만)
--   구글 계정과 같은 사람인지 서버가 대조할 재료가 없다. 그래서 같은 사람이
--   구글·카카오로 각각 가입해 회원이 이중 생성된다(가입 축하 크레딧도 이중 지급).
--   유일한 공통 식별자인 전화번호(온보딩 입력)를 저장 시점에 대조해 막는다.
--
-- 구조(오너 승인 2026-08-20):
--   1. 프로필(이름·전화·전공) 저장은 이 RPC 한 곳 — 온보딩·마이페이지가 함께 쓴다.
--   2. 같은 정규화 번호의 다른 회원이 있으면 저장을 막고
--      { code:'dup_phone', provider, me_fresh } 를 돌려준다.
--      provider = 기존 계정의 로그인 수단(구글/카카오 안내 — 오너 승인,
--      "전화번호로 남을 조회할 창구 금지" 규칙의 예외. 아래 시도 제한이 짝이다).
--      me_fresh = 지금 계정이 방금(60분 내) 만들어졌는지 — 화면이 '방금 계정 삭제 후
--      기존 계정으로 로그인' 흐름을 태울지 판단하는 재료.
--   3. 조회 남용(남의 번호 스캔) 방지 — 계정당 24시간 10회 시도 제한.
--   4. 문자 본인인증은 없다(가라 번호는 못 잡는다 — 오너 인지). 나중에 붙일 때
--      이 RPC 앞단에 끼운다.
--
-- 미적용 시: supabase-config.js 의 saveMyProfile() 이 RPC 부재(PGRST202)를 감지해
--   기존 직접 update 로 조용히 폴백한다(대조 없이 저장 — 사이트는 안 멈춘다).
--
-- ⚠️ members 의 유니크 인덱스는 일부러 안 건다 — 이미 들어간 중복 번호 데이터가
--   있으면 생성이 실패하고, 기존 중복 회원의 다른 컬럼 수정까지 막힌다.
--   판정은 이 RPC 한 곳으로 충분하다(경합은 advisory lock 직렬화).
--
-- 적용 확인(SQL Editor):
--   select 'save_my_profile' as 항목, to_regproc('public.save_my_profile') is not null as 적용됨
--   union all select 'phone_save_attempts', to_regclass('public.phone_save_attempts') is not null;
--
-- 기존 중복 현황 조회(참고 — 적용과 무관):
--   select public.monc_norm_phone(phone) as 번호, count(*) as 계정수,
--          array_agg(coalesce(name,'(이름없음)') || ' / ' || coalesce(email,'(이메일없음)')) as 계정들
--     from public.members where public.monc_norm_phone(phone) is not null
--    group by 1 having count(*) > 1 order by 2 desc;
-- =============================================================================

-- members.phone 은 레포 마이그레이션이 아니라 콘솔에서 만들어진 컬럼이다.
-- 이 파일 하나로도 성립하도록 안전하게 보강한다(있으면 아무 일 없음).
alter table public.members add column if not exists phone text;
alter table public.members add column if not exists major text;   -- 20260708120000 과 동일(미적용 환경 대비)

-- 전화번호 정규화 — 20260725120000_duplicate_application_guard.sql 과 동일 정의.
-- (그 마이그레이션 미적용 환경에서도 이 파일이 홀로 성립하도록 재선언. 정의를 바꾸지 말 것 —
--  신청 중복 방지 트리거가 같은 함수를 쓴다.)
create or replace function public.monc_norm_phone(p text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '')
$$;

-- 대조 조회용 인덱스(유니크 아님 — 위 주석 참조)
create index if not exists members_phone_norm_idx
  on public.members (public.monc_norm_phone(phone));

-- ── 시도 기록(조회 남용 방지) ────────────────────────────────────────────────
-- 클라이언트 접근 전면 차단: RLS ON + 정책 없음. security definer RPC 만 쓴다.
create table if not exists public.phone_save_attempts (
  id         bigint generated always as identity primary key,
  member_id  uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists phone_save_attempts_member_idx
  on public.phone_save_attempts (member_id, created_at);

alter table public.phone_save_attempts enable row level security;

comment on table public.phone_save_attempts is
  '프로필(전화번호) 저장 시도 기록 — save_my_profile 의 24시간 10회 제한 재료. 클라이언트 직접 접근 없음.';

-- ── 저장 RPC ────────────────────────────────────────────────────────────────
create or replace function public.save_my_profile(p_name text, p_phone text, p_major text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_phone    text := public.monc_norm_phone(p_phone);
  v_other    uuid;
  v_provider text;
  v_fresh    boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
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
  '프로필(이름·전화·전공) 저장 + 전화번호 중복 가입 차단(2026-08-20). 온보딩·마이페이지 공용. 본인 대상, 24시간 10회 제한.';

revoke all on function public.save_my_profile(text, text, text) from public, anon;
grant execute on function public.save_my_profile(text, text, text) to authenticated;
