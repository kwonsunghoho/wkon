-- =============================================================================
-- 같은 프로그램 중복 신청 차단 (오너 지시 2026-07-25)
-- 적용: Supabase SQL Editor 에 전체 붙여넣고 실행 (idempotent, 재실행 안전)
--
-- 배경: 관리자 '신청자 현황'에 같은 사람(같은 전화·같은 계정)이 같은 챌린지·같은 기수를
--       6분 간격으로 두 번 신청한 행이 그대로 쌓였다.
--
-- 왜 브라우저가 아니라 DB 트리거인가
--   신청이 들어오는 길이 다섯이다 — 챌린지(계좌이체·토스결제) / 특강(무료·계좌이체·토스결제).
--   전부 applications INSERT 로 수렴하므로 트리거 하나면 다섯 경로가 다 막힌다. 반대로
--   브라우저 검사만 두면 ①비회원은 RLS 때문에 사전 조회가 불가능하고 ②두 번 연속 탭·
--   두 탭 동시 신청처럼 검사와 저장 사이의 틈이 늘 남는다.
--
-- 규칙
--   챌린지 — 같은 사람 + 같은 challenge + 같은 기수(round) 가 이미 있으면 차단.
--            기수가 다르면(4기 → 5기) 정상 재신청이므로 허용한다.
--   특강   — 같은 사람 + 같은 lecture_id 가 이미 있으면 차단.
--            ⚠️ 시간대(slot)가 달라도 차단한다 — 시간대는 '같은 내용을 여는 다른 타임'이라
--               두 번 들을 이유가 없다. 정말 두 자리가 필요하면 관리자가 대신 넣어주면 된다.
--   같은 사람 — 전화번호(숫자만) 일치 또는 member_id 일치. 비회원으로 한 번, 로그인해서
--            또 한 번 넣는 경우까지 잡는다.
--   환불·취소된 건은 세지 않는다 → 환불 뒤 재신청은 정상 동작.
--
-- 클라이언트 대응(이미 반영됨)
--   apply.html   — 회원은 이미 신청한 기수 카드가 '신청완료'로 잠긴다.
--   lecture.html — 회원은 신청 폼 대신 '이미 신청한 특강' 안내가 뜬다.
--   verify-payment — 결제 승인 뒤 이 트리거에 막히면 전액 자동 환불(errcode MC002 감지).
--
-- 미적용 시 degrade: 브라우저 사전 검사(회원 한정)만 남아 비회원 중복이 통과한다.
--
-- ⚠️ 예외를 넣어야 할 때(오너가 한 사람 이름으로 두 자리를 대신 접수해 주는 등)
--    service role·콘솔 insert 도 트리거를 통과하지 못한다. 잠깐 끄고 넣은 뒤 반드시 다시 켠다:
--      alter table public.applications disable trigger applications_duplicate;
--      -- insert …
--      alter table public.applications enable  trigger applications_duplicate;
-- =============================================================================

-- ── 공용 판정 함수 ────────────────────────────────────────────────────────────
-- 전화번호 정규화: '010-2253-9269' · '010 2253 9269' 를 같은 값으로 본다.
create or replace function public.monc_norm_phone(p text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '')
$$;

comment on function public.monc_norm_phone(text) is
  '전화번호에서 숫자만 남긴다(중복 신청 판정용). 빈 값은 NULL.';

-- '살아있는' 신청인지 — 환불·취소된 건은 자리를 비운 것이므로 재신청을 허용한다.
create or replace function public.monc_app_live(p_refunded boolean, p_status text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_refunded, false) = false
     and coalesce(p_status, 'pending')
         not in ('refunded', 'partial_refunded', 'cancelled', 'canceled', 'failed')
$$;

comment on function public.monc_app_live(boolean, text) is
  '중복 판정에서 셀 신청인지. 환불·취소 건은 false(재신청 허용).';

-- ── 중복 신청 차단 ───────────────────────────────────────────────────────────
-- SECURITY DEFINER 필수: 비회원(anon)이 신청할 때도 트리거 안에서 applications 전체를
-- 훑어야 한다. invoker 로 두면 RLS 가 남의 행을 가려 중복이 늘 통과한다.
create or replace function public.applications_duplicate_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_label text;
begin
  v_phone := public.monc_norm_phone(new.phone);
  if v_phone is null and new.member_id is null then
    return new;                                   -- 누구인지 알 수 없으면 판정 불가
  end if;

  -- ⚠️ 같은 사람의 신청끼리만 잠깐 직렬화한다. 두 건이 동시에 들어오면 서로 아직 커밋
  --    전이라 아래 select 에 안 잡혀 둘 다 통과한다(버튼 두 번 탭·두 탭 동시 신청).
  if v_phone is not null then
    perform pg_advisory_xact_lock(hashtext('monc_dup_p:' || v_phone));
  end if;
  if new.member_id is not null then
    perform pg_advisory_xact_lock(hashtext('monc_dup_m:' || new.member_id::text));
  end if;

  -- 1) 특강 — 같은 특강을 이미 신청했는지(시간대 무관)
  if new.lecture_id is not null then
    select coalesce(l.title, '특강')
      into v_label
      from public.applications a
      left join public.special_lectures l on l.id = new.lecture_id
     where a.lecture_id = new.lecture_id
       and public.monc_app_live(a.refunded, a.payment_status)
       and ( (v_phone is not null and public.monc_norm_phone(a.phone) = v_phone)
          or (new.member_id is not null and a.member_id = new.member_id) )
     limit 1;
  end if;

  -- 2) 챌린지 — 같은 챌린지 + 같은 기수를 이미 신청했는지
  --    (신청 1건에 챌린지 여러 개를 담을 수 있으므로 요소별로 대조한다)
  if v_label is null and jsonb_typeof(new.challenges) = 'array' then
    select case ne->>'challenge'
             when 'voice'      then '보이스'
             when 'expression' then '표현력'
             when 'spinning'   then '스피닝'
             when 'answer'     then '답변'
             else ne->>'challenge'
           end || coalesce(' ' || (ne->>'round') || '기', '')
      into v_label
      from jsonb_array_elements(new.challenges) ne
     where ne->>'challenge' is not null
       and exists (
         select 1
           from public.applications a
                cross join lateral jsonb_array_elements(
                  case when jsonb_typeof(a.challenges) = 'array' then a.challenges else '[]'::jsonb end
                ) ae
          where public.monc_app_live(a.refunded, a.payment_status)
            and ( (v_phone is not null and public.monc_norm_phone(a.phone) = v_phone)
               or (new.member_id is not null and a.member_id = new.member_id) )
            and ae->>'challenge' = ne->>'challenge'
            and coalesce(ae->>'round', '') = coalesce(ne->>'round', '')
       )
     limit 1;
  end if;

  if v_label is not null then
    -- errcode MC002 로 던져 브라우저·Edge Function 이 '중복 신청'을 구분한다.
    -- (verify-payment 는 이 코드를 보고 이미 승인된 결제를 전액 자동 환불한다)
    -- hint 에 프로그램 이름을 실어 보내 사용자에게 "무엇이" 중복인지 알려준다.
    raise exception 'duplicate_application'
      using errcode = 'MC002',
            hint = v_label;
  end if;
  return new;
end;
$$;

comment on function public.applications_duplicate_guard() is
  '같은 사람(전화·계정)이 같은 프로그램(챌린지+기수 / 특강)을 두 번 신청하는 것을 차단. errcode MC002.';

-- 트리거 이름은 정원 가드(applications_lecture_capacity)보다 알파벳 순서가 앞이라
-- 중복 판정이 먼저 돈다(중복이면 자리 계산까지 갈 필요가 없다).
-- ⚠️ 회원 연결 트리거(trg_link_application_member)는 순서상 이 가드보다 뒤에 돈다 →
--    비회원 신청은 가드 시점에 new.member_id 가 아직 비어 있다. 전화번호로도 판정하므로
--    문제되지 않지만, 계정 기준만 보도록 바꾸면 비회원 중복이 통과한다.
drop trigger if exists applications_duplicate on public.applications;
create trigger applications_duplicate
  before insert on public.applications
  for each row execute function public.applications_duplicate_guard();

-- ── 이미 쌓인 중복 확인용 조회 ────────────────────────────────────────────────
-- 이 트리거는 '앞으로 들어올' 중복만 막는다. 그 전에 쌓인 행은 관리자가 골라 지워야 하며,
-- admin '신청자 현황' 카드에 '중복' 배지가 붙어 바로 눈에 띈다.
-- SQL 로 확인하려면(가장 오래된 1건을 원본으로 보고 그 뒤 건을 나열):
--   select public.monc_norm_phone(a.phone) as phone, ae->>'challenge' as challenge,
--          ae->>'round' as round, count(*), min(a.created_at), array_agg(a.id)
--     from public.applications a
--          cross join lateral jsonb_array_elements(
--            case when jsonb_typeof(a.challenges) = 'array' then a.challenges else '[]'::jsonb end) ae
--    where public.monc_app_live(a.refunded, a.payment_status)
--      and ae->>'challenge' is not null
--    group by 1, 2, 3 having count(*) > 1;

-- ── 적용 확인 ────────────────────────────────────────────────────────────────
-- 마지막 문장이라 SQL Editor 결과창에 그대로 뜬다.
-- ⚠️ applications_duplicate 가 목록에 있어야 적용된 것이다(없으면 위에서 에러가 난 것).
select tgname as "트리거", tgenabled as "활성"
  from pg_trigger
 where tgrelid = 'public.applications'::regclass and not tgisinternal
 order by tgname;
