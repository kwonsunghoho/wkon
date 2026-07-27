-- =============================================================================
-- MONC 크레딧 — 도구별 단가 + 하루 무료 리셋 (2026-07-25)
-- =============================================================================
-- 스펙: docs/superpowers/specs/2026-07-24-ai-killer-design.md
-- 목업: outputs/answer-vault-mockup.html
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260725130000_credits.sql
--
-- 무엇이 바뀌나 ───────────────────────────────────────────────────────────────
--   구: 무엇을 하든 **1회 = 1크레딧**, 무료는 **회원당 총 2회**(답변노트 글에만)
--   신: **도구마다 단가가 다르고**, 무료는 **하루 5크레딧 리셋**
--
--     소재 발굴  2크레딧      ┐
--     KILL AI    3크레딧      ├ 하루 무료 5 = 소재 1회 + 킬러 1회 (딱 맞는다)
--     첨삭      10크레딧      ┘ 하루 5로는 못 모은다 → 자연히 유료
--
--   ⚠️ **가격은 원가가 아니라 가치를 따른다.** 첨삭 원가는 킬러의 두 배쯤인데 단가는
--      세 배다 — 학생이 돈을 내는 이유가 진단이 아니라 처방이기 때문이다.
--      진단이 싸야 자주 쓰고, 자주 써야 처방이 팔린다. 원가 비율로 되돌리지 말 것.
--
--   ⚠️ **무료는 쌓이지 않는다(하루 리셋).** 적립을 허용하면 한 달을 모아 한 번에
--      쏟아붓는 사용이 생겨 상한이 사라진다. 그리고 이 '리셋'이 곧 첨삭 잠금이다 —
--      하루 5로는 10을 못 모으므로 **별도 free/paid 구분이 필요 없다.**
--
--   ⚠️ 첨삭만은 **가입 후 총 1회** 무료다(credit_free_limits). 한 번은 봐야 값어치를
--      알고, 안 보면 만 원을 결제할 이유가 생기지 않는다. 일일 무료와는 다른 통이다.
--
-- ⚠️ 미적용이어도 사이트는 정상 — 구 원장(1회=1크레딧, 총 2회 무료)으로 돈다.
-- =============================================================================

-- =============================================================================
-- 1. tool 확대 + cost 컬럼
-- =============================================================================
-- 구 제약은 ai_killer / rehearsal 둘뿐이라 소재 발굴·첨삭을 넣을 수 없다.
alter table public.credit_ledger drop constraint if exists credit_ledger_tool_check;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'credit_ledger_tool_ck'
  ) then
    alter table public.credit_ledger add constraint credit_ledger_tool_ck
      check (tool in ('ai_killer','rehearsal','sojae','polish'));
  end if;
end $$;

-- cost — 이 한 줄이 몇 크레딧짜리였는지.
--   ⚠️ free_use 는 delta 0 이라 **delta 만으로는 하루 무료 사용량을 셀 수 없다.**
--      그래서 무료 행에도 cost 를 남긴다(delta 0, cost 3 처럼). 이 컬럼이 없으면
--      "오늘 5크레딧 중 얼마 썼나"를 알 방법이 없어 일일 무료가 성립하지 않는다.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'credit_ledger' and column_name = 'cost'
  ) then
    alter table public.credit_ledger add column cost int;
  end if;
end $$;

comment on column public.credit_ledger.cost is
  '이 사용이 몇 크레딧이었는지. use 는 delta=-cost, free_use 는 delta=0 이고 cost 만 남는다(하루 무료 집계용).';

-- 기존 행 백필 — 구 원장은 전부 1크레딧짜리였다
update public.credit_ledger set cost = 1
 where cost is null and reason in ('use','free_use','refund');

-- delta 제약 재정의 ───────────────────────────────────────────────────────────
--   구: use = -1 / refund = +1 고정, free_use 는 free_ref 필수
--   신: 단가가 다르므로 부호만 본다. free_ref 는 **더 이상 필수가 아니다** —
--       일일 무료는 '답변노트 글'이라는 근거 없이 하루 한도로만 판정하기 때문이다.
alter table public.credit_ledger drop constraint if exists credit_ledger_delta_ck;
alter table public.credit_ledger add constraint credit_ledger_delta_ck check (
  (reason = 'free_use' and delta = 0)
  or (reason = 'use'    and delta < 0)
  or (reason = 'refund' and delta > 0)
  or (reason in ('purchase','admin_grant') and delta <> 0)
);

-- ⚠️ 구 유니크 인덱스 credit_ledger_free_uq(member, tool, free_ref) 는 **그대로 둔다.**
--    free_ref 가 NULL 인 행끼리는 유니크가 걸리지 않으므로(NULLS DISTINCT) 일일 무료는
--    여러 번 들어가고, free_ref 를 쓰는 경로(총량 무료)는 계속 중복이 막힌다.

-- 하루 무료 집계용 인덱스 — 오늘 것만 훑는다
create index if not exists credit_ledger_free_day_idx
  on public.credit_ledger (member_id, created_at) where reason = 'free_use';

-- =============================================================================
-- 2. 설정 — 단가·하루 한도·총량 무료 (재배포 없이 admin 에서 조절)
-- =============================================================================
insert into public.site_config (key, value) values
  ('credit_costs', '{"sojae": 2, "ai_killer": 3, "polish": 10, "rehearsal": 3}')
on conflict (key) do nothing;

insert into public.site_config (key, value) values ('credit_daily_free', '5')
on conflict (key) do nothing;

-- ⚠️ credit_free_limits 의 뜻이 바뀐다 — 구: '회원당 총 무료 횟수'(ai_killer 2회)
--    신: **총량 무료가 필요한 도구만** 남긴다. 첨삭은 가입 후 1회.
--    ai_killer 는 이제 하루 무료로 대체되므로 목록에서 뺀다(남겨 두면 하루 무료와
--    총량 무료를 둘 다 받아 첫 이틀이 공짜가 된다).
update public.site_config
   set value = '{"polish": 1}'::jsonb
 where key = 'credit_free_limits'
   and value ? 'ai_killer';          -- 이미 새 값이면 건드리지 않는다(재실행 안전)

-- =============================================================================
-- 3. 조회 함수
-- =============================================================================
-- 도구 단가. 설정이 없거나 깨져 있어도 동작하도록 폴백을 함수 안에 둔다.
create or replace function public.credit_cost(p_tool text)
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select (value ->> p_tool)::int
       from public.site_config where key = 'credit_costs'),
    case p_tool when 'sojae' then 2 when 'polish' then 10 else 3 end
  );
$$;

comment on function public.credit_cost(text) is
  '도구 1회 단가(크레딧). site_config.credit_costs 가 원장이고 폴백은 소재2/첨삭10/그외3.';

-- 하루 무료 한도
create or replace function public.credit_daily_free()
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce((select value::text::int from public.site_config where key = 'credit_daily_free'), 5);
$$;

-- 오늘(KST) 쓴 무료 크레딧 합.
--   ⚠️ 기준 시각은 **Asia/Seoul 자정**이다. UTC 자정으로 두면 한국 시간 오전 9시에
--      한도가 초기화돼 "아침에 갑자기 늘었다 줄었다" 하는 것처럼 보인다.
create or replace function public.credit_daily_used()
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(coalesce(cost, 1)), 0)::int
    from public.credit_ledger
   where member_id = auth.uid()
     and reason = 'free_use'
     and (created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date;
$$;

-- 화면이 한 번에 받아 가는 지갑 상태.
--   ⚠️ 화면은 **무료를 크레딧이 아니라 행위로** 보여준다("오늘 검사 1회 남음").
--      그래서 남은 무료 크레딧과 단가를 같이 준다 — 나눗셈은 화면이 한다.
create or replace function public.credit_wallet()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_bal  int;
  v_used int;
  v_free int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select coalesce(sum(delta),0)::int into v_bal from public.credit_ledger where member_id = v_uid;
  v_used := public.credit_daily_used();
  v_free := public.credit_daily_free();
  return jsonb_build_object(
    'balance',     v_bal,
    'daily_free',  v_free,
    'daily_used',  v_used,
    'daily_left',  greatest(v_free - v_used, 0),
    'costs',       coalesce((select value from public.site_config where key = 'credit_costs'),
                            '{"sojae":2,"ai_killer":3,"polish":10}'::jsonb),
    -- 총량 무료가 남은 도구(첨삭 첫 1회 등)
    'polish_free_left', greatest(public.credit_free_limit('polish')
                                 - public.credit_free_used('polish'), 0)
  );
end $$;

comment on function public.credit_wallet() is
  '잔액 + 오늘 남은 무료 크레딧 + 도구 단가. 화면이 한 번에 받아 간다.';

-- =============================================================================
-- 4. 차감 — 총량 무료 → 하루 무료 → 유료 순
-- =============================================================================
-- 인자
--   p_tool     'sojae' | 'ai_killer' | 'polish' | 'rehearsal'
--   p_ref      사용처 id. **같은 ref 로 다시 부르면 차감하지 않는다**(used='already').
--              ⚠️ AI킬러는 여기에 **answers.id 를 넣는다** — 그래야 같은 답변 재검사가
--                 자연히 무차감이 된다. 2회 상한은 중계 함수가 ai_killer_checks 를 세어
--                 ref 를 '<answer_id>#<n>' 으로 바꾸는 방식으로 건다(여기는 범용으로 둔다).
--   p_free_ref 총량 무료의 근거 id(중복 방지 키). 하루 무료에는 쓰지 않는다.
-- 반환 {ok, used:'free'|'free_daily'|'paid'|'already', cost, balance, daily_left}
create or replace function public.spend_credit(
  p_tool     text,
  p_ref      text,
  p_free_ref text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_cost      int;
  v_balance   int;
  v_free_used int;
  v_free_lim  int;
  v_day_used  int;
  v_day_free  int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_tool is null or p_tool = '' then raise exception 'bad_tool'; end if;
  if p_ref  is null or p_ref  = '' then raise exception 'bad_ref';  end if;

  -- ⚠️ 회원 단위 직렬화. 없으면 두 탭 동시 요청이 같은 잔액·같은 하루 한도를 읽고
  --    각자 차감해 5크레딧으로 10크레딧어치를 쓴다.
  perform pg_advisory_xact_lock(hashtext('credit:' || v_uid::text));

  v_cost := public.credit_cost(p_tool);

  -- 이미 차감된 사용처면 그대로 통과(재시도·네트워크 재전송 방어).
  -- AI킬러에서는 이 분기가 **같은 답변 재검사 = 무차감**을 만든다.
  if exists (select 1 from public.credit_ledger
               where member_id = v_uid and tool = p_tool and ref = p_ref
                 and reason in ('use','free_use')) then
    select coalesce(sum(delta),0)::int into v_balance
      from public.credit_ledger where member_id = v_uid;
    return jsonb_build_object('ok', true, 'used', 'already', 'cost', 0,
                              'balance', v_balance,
                              'daily_left', greatest(public.credit_daily_free()
                                                     - public.credit_daily_used(), 0));
  end if;

  -- ── ① 총량 무료 (첨삭 가입 첫 1회) ────────────────────────────────────────
  --    하루 무료보다 먼저 본다. 첨삭은 10크레딧이라 하루 5로는 절대 안 되므로,
  --    순서를 뒤집으면 첫 1회가 영영 쓰이지 않는다.
  v_free_lim := public.credit_free_limit(p_tool);
  if v_free_lim > 0 then
    select count(*) into v_free_used from public.credit_ledger
      where member_id = v_uid and tool = p_tool and reason = 'free_use' and free_ref is not null;
    if v_free_used < v_free_lim then
      insert into public.credit_ledger (member_id, tool, delta, reason, ref, free_ref, cost)
        values (v_uid, p_tool, 0, 'free_use', p_ref, coalesce(nullif(p_free_ref,''), p_ref), v_cost);
      select coalesce(sum(delta),0)::int into v_balance
        from public.credit_ledger where member_id = v_uid;
      return jsonb_build_object('ok', true, 'used', 'free', 'cost', v_cost,
                                'balance', v_balance,
                                'daily_left', greatest(public.credit_daily_free()
                                                       - public.credit_daily_used(), 0));
    end if;
  end if;

  -- ── ② 하루 무료 ───────────────────────────────────────────────────────────
  v_day_free := public.credit_daily_free();
  v_day_used := public.credit_daily_used();
  if v_day_used + v_cost <= v_day_free then
    -- free_ref 는 NULL — 하루 무료는 '근거 글' 없이 한도로만 판정한다.
    insert into public.credit_ledger (member_id, tool, delta, reason, ref, cost)
      values (v_uid, p_tool, 0, 'free_use', p_ref, v_cost);
    select coalesce(sum(delta),0)::int into v_balance
      from public.credit_ledger where member_id = v_uid;
    return jsonb_build_object('ok', true, 'used', 'free_daily', 'cost', v_cost,
                              'balance', v_balance,
                              'daily_left', greatest(v_day_free - v_day_used - v_cost, 0));
  end if;

  -- ── ③ 유료 ────────────────────────────────────────────────────────────────
  select coalesce(sum(delta),0)::int into v_balance
    from public.credit_ledger where member_id = v_uid;
  if v_balance < v_cost then raise exception 'no_credit'; end if;

  insert into public.credit_ledger (member_id, tool, delta, reason, ref, cost)
    values (v_uid, p_tool, -v_cost, 'use', p_ref, v_cost);

  return jsonb_build_object('ok', true, 'used', 'paid', 'cost', v_cost,
                            'balance', v_balance - v_cost,
                            'daily_left', greatest(v_day_free - v_day_used, 0));
end $$;

comment on function public.spend_credit(text, text, text) is
  '크레딧 차감(총량무료 → 하루무료 → 유료). 단가는 credit_cost(tool). 같은 ref 재호출은 무차감(used=already). 예외: no_credit.';

-- =============================================================================
-- 5. 환급 — 단가만큼 되돌린다
-- =============================================================================
--   ⚠️ 구 버전은 refund delta 를 +1 로 고정했다. 단가가 다른 지금 그대로 두면
--      첨삭(10) 실패에 1만 돌려주고 9를 삼킨다.
create or replace function public.refund_credit(p_tool text, p_ref text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_reason text;
  v_cost   int;
  v_bal    int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform pg_advisory_xact_lock(hashtext('credit:' || v_uid::text));

  select reason, coalesce(cost, 1) into v_reason, v_cost
    from public.credit_ledger
   where member_id = v_uid and tool = p_tool and ref = p_ref
     and reason in ('use','free_use')
   limit 1;

  if v_reason is null then
    select coalesce(sum(delta),0)::int into v_bal
      from public.credit_ledger where member_id = v_uid;
    return jsonb_build_object('ok', true, 'refunded', false, 'balance', v_bal);
  end if;

  if v_reason = 'free_use' then
    -- ⚠️ 이 원장의 유일한 delete. free_use 는 delta 0 이라 refund 행을 더해도 되돌아가지
    --    않고, 행이 남으면 **오늘 한도를 이미 쓴 것으로 세어져** 실패한 검사 때문에
    --    무료 기회를 잃는다. 감사 이력은 ai_killer_checks 가 남긴다.
    delete from public.credit_ledger
      where member_id = v_uid and tool = p_tool and ref = p_ref and reason = 'free_use';
  else
    if not exists (select 1 from public.credit_ledger
                     where member_id = v_uid and tool = p_tool and ref = p_ref and reason = 'refund') then
      insert into public.credit_ledger (member_id, tool, delta, reason, ref, cost)
        values (v_uid, p_tool, v_cost, 'refund', p_ref, v_cost);
    end if;
  end if;

  select coalesce(sum(delta),0)::int into v_bal
    from public.credit_ledger where member_id = v_uid;
  return jsonb_build_object('ok', true, 'refunded', true, 'balance', v_bal);
end $$;

comment on function public.refund_credit(text, text) is
  '차감 취소. 유료는 그 사용의 cost 만큼 refund 행 추가, 무료는 free_use 행 삭제(한도 복구).';

-- =============================================================================
-- 적용 확인 — 4행이 모두 true 면 정상
-- =============================================================================
-- select 'cost 컬럼' as 항목,
--        exists (select 1 from information_schema.columns
--                 where table_schema='public' and table_name='credit_ledger' and column_name='cost') as 적용됨
-- union all select 'credit_costs 설정',
--        exists (select 1 from public.site_config where key='credit_costs')
-- union all select 'KILL AI 단가 3',  (select public.credit_cost('ai_killer') = 3)
-- union all select '첨삭 단가 10',     (select public.credit_cost('polish')    = 10);
--
-- 로그인한 회원으로 지갑 확인:
-- select public.credit_wallet();
-- =============================================================================
