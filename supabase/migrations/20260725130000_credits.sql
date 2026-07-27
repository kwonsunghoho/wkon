-- =============================================================================
-- MONC 공용 크레딧 원장 — 어떤 도구든 쓰는 지갑 (2026-07-25)
-- =============================================================================
-- 스펙: docs/superpowers/specs/2026-07-24-ai-killer-design.md (결정 6, ②단계)
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260703120000(members·is_admin) · 20260705120000(answers) · 20260710120000(site_config)
--
-- 왜 새로 파는가
--   리허설 브랜치(claude/rehearsal-wip)의 point_ledger 는 '리허설권' 전용이었다.
--   AI킬러가 두 번째 유료 도구가 되므로, 검증된 구조(append-only + 서버 심판 RPC +
--   회원 단위 advisory lock)만 가져와 **도구 무관 지갑**으로 일반화한다.
--   모의면접을 되살릴 때 tool='rehearsal' 로 이 원장에 그대로 얹으면 된다.
--
-- 설계 원칙
--   1. **append-only 원장.** 잔액 = sum(delta). 행을 고치지 않는다(취소도 새 행).
--      단 하나의 예외가 free_use 무효화 — 아래 refund_credit 주석 참조.
--   2. **서버가 유일한 심판.** 브라우저는 원장을 select 만 할 수 있다.
--      insert/update/delete 는 SECURITY DEFINER RPC 와 관리자만.
--      ⚠️ 클라이언트에 insert 를 열면 스스로 크레딧을 발행할 수 있다.
--   3. **회원 단위 advisory lock 필수.** 없으면 두 탭에서 동시에 검사를 눌렀을 때
--      각자 잔액을 읽는 순간엔 둘 다 여유가 있어 **1회 크레딧으로 2회를 쓴다.**
--      (특강 정원 가드의 `for update` 와 같은 이유. 실측으로 확인된 구멍이다.)
--   4. **지갑에 들어오는 무료 크레딧은 없다.** 무료분은 delta 0 인 free_use 한 행으로
--      기록된다 — 아래 '왜 free_use 는 delta 0 인가' 참조.
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- 1. credit_ledger
-- =============================================================================
-- reason 별 의미
--   purchase     결제로 충전       delta > 0   ref = 결제 키
--   admin_grant  관리자 지급·회수  delta ≠ 0   ref = 사유(회수는 음수)
--   use          유료 1회 사용     delta = -1  ref = 사용처 id(예: ai_killer_checks.id)
--   free_use     무료 1회 사용     delta =  0  ref = 사용처 id, free_ref = 무료 근거(answers.id)
--   refund       사용 취소 환급    delta = +1  ref = 취소된 사용처 id
--
-- ⚠️ **왜 free_use 는 delta 0 인가 (지급 +1 / 차감 -1 두 행으로 쪼개지 않는 이유)**
--   쪼개 두면 AI 호출이 실패해 환급할 때 +1 이 **지갑에 남아** 무료분이 유료 크레딧으로
--   둔갑한다(무료 2회를 받은 사람이 유료 2회를 얻는 셈). delta 0 한 행이면 지갑은 처음부터
--   움직이지 않으므로 그 사고가 원천적으로 불가능하고, 환급은 그 행을 지우기만 하면 된다.
--   '무료를 몇 번 썼나'는 delta 가 아니라 **행 개수**로 세므로 한도 판정도 그대로 된다.
create table if not exists public.credit_ledger (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  tool        text not null check (tool in ('ai_killer','rehearsal')),
  delta       int  not null,
  reason      text not null check (reason in ('purchase','admin_grant','use','free_use','refund')),
  ref         text,
  free_ref    text,
  created_by  uuid,                -- 관리자 지급 시 관리자 uid
  created_at  timestamptz not null default now(),

  -- reason 과 delta 의 약속을 DB 가 지킨다. 애플리케이션 실수로 free_use 가
  -- 음수/양수로 들어가 지갑을 흔드는 걸 막는다.
  constraint credit_ledger_delta_ck check (
    (reason = 'free_use' and delta = 0 and free_ref is not null)
    or (reason = 'use'      and delta = -1)
    or (reason = 'refund'   and delta =  1)
    or (reason in ('purchase','admin_grant') and delta <> 0)
  )
);

comment on table public.credit_ledger is
  '공용 크레딧 원장(append-only). 잔액=sum(delta). tool 은 어디에 썼는지 기록이며 지갑은 도구 공용.';
comment on column public.credit_ledger.free_ref is
  '무료 사용의 근거 id(AI킬러는 answers.id). 같은 글로 두 번 무료를 받지 못하게 하는 키.';

create index if not exists credit_ledger_member_idx on public.credit_ledger (member_id, created_at desc);

-- 같은 사용처로 두 번 차감되지 않게(중계 함수 재시도 방어)
create unique index if not exists credit_ledger_use_uq
  on public.credit_ledger (member_id, tool, ref) where reason in ('use','free_use');

-- ⚠️ 같은 글로는 한 번만 무료 (확정본 '무료 2회' 규칙).
--   고쳐서 다시 검사하는 것은 유료 — 그래서 free_ref 기준으로 막는다.
create unique index if not exists credit_ledger_free_uq
  on public.credit_ledger (member_id, tool, free_ref) where reason = 'free_use';

-- =============================================================================
-- 2. RLS — 본인 읽기 / 관리자 전체. 쓰기는 RPC(정의자 권한)와 관리자만.
-- =============================================================================
alter table public.credit_ledger enable row level security;

drop policy if exists credit_select_own on public.credit_ledger;
drop policy if exists credit_admin_all  on public.credit_ledger;

create policy credit_select_own on public.credit_ledger
  for select to authenticated using (member_id = auth.uid());
create policy credit_admin_all on public.credit_ledger
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- 3. 무료 한도 설정 — site_config 로 빼서 재배포 없이 바꾼다
-- =============================================================================
insert into public.site_config (key, value)
  values ('credit_free_limits', '{"ai_killer": 2, "rehearsal": 1}')
on conflict (key) do nothing;

-- 설정이 없거나 깨져 있어도 동작해야 하므로 폴백을 함수 안에 둔다.
create or replace function public.credit_free_limit(p_tool text)
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select nullif(value ->> p_tool, '')::int
       from public.site_config where key = 'credit_free_limits'),
    case p_tool when 'ai_killer' then 2 when 'rehearsal' then 1 else 0 end
  );
$$;

-- =============================================================================
-- 4. RPC — 서버가 유일한 심판
-- =============================================================================

-- 4-1. 잔액 조회. 브라우저가 화면에 남은 횟수를 그릴 때 쓴다(신뢰 원천은 아니다 —
--      실제 차감 판정은 spend_credit 안에서 lock 을 잡고 다시 한다).
create or replace function public.credit_balance()
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(delta), 0)::int
    from public.credit_ledger where member_id = auth.uid();
$$;

comment on function public.credit_balance() is '본인 크레딧 잔액(도구 공용 지갑).';

-- 4-2. 무료 사용 현황 — 화면에 "무료 2회 남음"을 그리기 위한 조회.
create or replace function public.credit_free_used(p_tool text)
returns int
language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.credit_ledger
    where member_id = auth.uid() and tool = p_tool and reason = 'free_use';
$$;

-- 4-3. 차감 — 이 함수가 이 원장의 심장이다.
--   p_ref      사용처 id (AI킬러는 ai_killer_checks.id). 재시도해도 두 번 안 깎이게 하는 키.
--   p_free_ref 무료 근거 id. 넘기면 '무료 우선', null 이면 곧바로 유료.
--              AI킬러는 answers.id — **본인 답변인지 이 함수가 직접 확인한다**(아래 참조).
--   반환 jsonb {ok, used:'free'|'paid', balance, free_left}
--
-- ⚠️ 무료 판정과 차감이 **한 트랜잭션·같은 lock 안**에 있어야 한다. 나누면 동시 요청
--    두 개가 각자 무료를 받아 2회가 4회가 된다(확정본 서버 순서 3번 경고).
--    plpgsql 함수 본문은 호출자 트랜잭션 안에서 돌므로 이 파일 구조로 보장된다.
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
  v_balance   int;
  v_free_used int;
  v_free_lim  int;
  v_ok_free   boolean := false;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_tool is null or p_tool = '' then raise exception 'bad_tool'; end if;
  if p_ref  is null or p_ref  = '' then raise exception 'bad_ref';  end if;

  -- ⚠️ 회원 단위 직렬화. 이게 없으면 두 탭 동시 요청이 같은 잔액을 읽고 각자 차감한다.
  perform pg_advisory_xact_lock(hashtext('credit:' || v_uid::text));

  -- 이미 차감된 사용처면 그대로 통과시킨다(중계 함수 재시도·네트워크 재전송 방어).
  -- 여기서 막지 않으면 유니크 인덱스가 예외를 던져 사용자에게 실패로 보인다.
  if exists (select 1 from public.credit_ledger
               where member_id = v_uid and tool = p_tool and ref = p_ref
                 and reason in ('use','free_use')) then
    select coalesce(sum(delta),0)::int into v_balance
      from public.credit_ledger where member_id = v_uid;
    return jsonb_build_object('ok', true, 'used', 'already', 'balance', v_balance,
                              'free_left', greatest(public.credit_free_limit(p_tool)
                                                    - public.credit_free_used(p_tool), 0));
  end if;

  -- ── 무료 판정 ────────────────────────────────────────────────────────────
  if p_free_ref is not null and p_free_ref <> '' then
    v_free_lim := public.credit_free_limit(p_tool);
    select count(*) into v_free_used from public.credit_ledger
      where member_id = v_uid and tool = p_tool and reason = 'free_use';

    -- ⚠️ AI킬러 무료분은 '답변노트에 올린 내 글'에만 붙는다(확정본 결정 8).
    --    중계 함수가 이미 확인하지만 여기서도 본다 — RPC 는 어디서든 호출될 수 있고,
    --    남의 answers.id 를 넣어 무료를 타는 길을 DB 가 직접 막는 게 맞다.
    if v_free_used < v_free_lim
       and (p_tool <> 'ai_killer'
            or exists (select 1 from public.answers a
                         where a.id::text = p_free_ref and a.member_id = v_uid))
       -- 같은 글로 이미 무료를 썼으면 유료로 넘어간다(유니크 인덱스의 사전 확인)
       and not exists (select 1 from public.credit_ledger
                         where member_id = v_uid and tool = p_tool
                           and reason = 'free_use' and free_ref = p_free_ref)
    then
      v_ok_free := true;
    end if;
  end if;

  if v_ok_free then
    insert into public.credit_ledger (member_id, tool, delta, reason, ref, free_ref)
      values (v_uid, p_tool, 0, 'free_use', p_ref, p_free_ref);
    select coalesce(sum(delta),0)::int into v_balance
      from public.credit_ledger where member_id = v_uid;
    return jsonb_build_object('ok', true, 'used', 'free', 'balance', v_balance,
                              'free_left', greatest(public.credit_free_limit(p_tool)
                                                    - public.credit_free_used(p_tool), 0));
  end if;

  -- ── 유료 차감 ────────────────────────────────────────────────────────────
  select coalesce(sum(delta),0)::int into v_balance
    from public.credit_ledger where member_id = v_uid;
  if v_balance < 1 then raise exception 'no_credit'; end if;

  insert into public.credit_ledger (member_id, tool, delta, reason, ref)
    values (v_uid, p_tool, -1, 'use', p_ref);

  return jsonb_build_object('ok', true, 'used', 'paid', 'balance', v_balance - 1,
                            'free_left', greatest(public.credit_free_limit(p_tool)
                                                  - public.credit_free_used(p_tool), 0));
end $$;

comment on function public.spend_credit(text, text, text) is
  '크레딧 1회 차감(무료분 우선). 같은 ref 재호출은 통과(used=already). 예외: no_credit.';

-- 4-4. 환급 — AI 호출이 실패했는데 이미 깎인 경우.
--   ⚠️ 유료(use)는 append-only 를 지켜 refund 행을 더한다.
--      무료(free_use)는 **그 행을 지운다** — 이 원장의 유일한 delete 다.
--      이유: free_use 는 delta 0 이라 refund 행을 더해도 지갑이 그대로여서 환급이 안 되고,
--      더 중요하게 그 행이 남아 있으면 **한도 2회를 이미 쓴 것으로 세어져**
--      실패한 검사 때문에 무료 기회를 잃는다. 감사 이력은 ai_killer_checks 가 남긴다.
create or replace function public.refund_credit(p_tool text, p_ref text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_reason text;
  v_bal    int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform pg_advisory_xact_lock(hashtext('credit:' || v_uid::text));

  select reason into v_reason from public.credit_ledger
    where member_id = v_uid and tool = p_tool and ref = p_ref
      and reason in ('use','free_use')
    limit 1;

  if v_reason is null then
    -- 차감된 적이 없으면 조용히 넘어간다(중계 함수가 실패 경로에서 무조건 부르므로)
    select coalesce(sum(delta),0)::int into v_bal
      from public.credit_ledger where member_id = v_uid;
    return jsonb_build_object('ok', true, 'refunded', false, 'balance', v_bal);
  end if;

  if v_reason = 'free_use' then
    delete from public.credit_ledger
      where member_id = v_uid and tool = p_tool and ref = p_ref and reason = 'free_use';
  else
    -- 이미 환급했으면 두 번 넣지 않는다
    if not exists (select 1 from public.credit_ledger
                     where member_id = v_uid and tool = p_tool and ref = p_ref and reason = 'refund') then
      insert into public.credit_ledger (member_id, tool, delta, reason, ref)
        values (v_uid, p_tool, 1, 'refund', p_ref);
    end if;
  end if;

  select coalesce(sum(delta),0)::int into v_bal
    from public.credit_ledger where member_id = v_uid;
  return jsonb_build_object('ok', true, 'refunded', true, 'balance', v_bal);
end $$;

comment on function public.refund_credit(text, text) is
  '차감 취소(AI 호출 실패 등). 유료는 refund 행 추가, 무료는 free_use 행 삭제(한도 복구).';

-- 4-5. 관리자 지급·회수. 회수는 음수 delta.
--   ⚠️ 회수로 잔액이 음수가 되지 않게 막는다 — 음수 잔액은 다음 충전분을 조용히 먹는다.
create or replace function public.grant_credit(
  p_member_id uuid,
  p_tool      text,
  p_amount    int,
  p_note      text default null
)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_bal int;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_amount = 0 then raise exception 'bad_amount'; end if;

  perform pg_advisory_xact_lock(hashtext('credit:' || p_member_id::text));

  select coalesce(sum(delta),0)::int into v_bal
    from public.credit_ledger where member_id = p_member_id;
  if v_bal + p_amount < 0 then raise exception 'would_go_negative'; end if;

  insert into public.credit_ledger (member_id, tool, delta, reason, ref, created_by)
    values (p_member_id, coalesce(p_tool,'ai_killer'), p_amount, 'admin_grant',
            nullif(p_note,''), auth.uid());
  return v_bal + p_amount;
end $$;

comment on function public.grant_credit(uuid, text, int, text) is
  '관리자 크레딧 지급(양수)·회수(음수). 잔액이 음수가 되는 회수는 거부. 반환=지급 후 잔액.';

-- 실행 권한 — 로그인 회원만 (기존 관례: 20260715120000 delete_my_account 와 동일)
revoke all on function public.credit_balance()                      from public, anon;
revoke all on function public.credit_free_limit(text)               from public, anon;
revoke all on function public.credit_free_used(text)                from public, anon;
revoke all on function public.spend_credit(text, text, text)        from public, anon;
revoke all on function public.refund_credit(text, text)             from public, anon;
revoke all on function public.grant_credit(uuid, text, int, text)   from public, anon;
grant execute on function public.credit_balance()                    to authenticated;
grant execute on function public.credit_free_limit(text)             to authenticated;
grant execute on function public.credit_free_used(text)              to authenticated;
grant execute on function public.spend_credit(text, text, text)      to authenticated;
grant execute on function public.refund_credit(text, text)           to authenticated;
grant execute on function public.grant_credit(uuid, text, int, text) to authenticated;

-- =============================================================================
-- 적용 확인 — 아래를 실행해 4행이 모두 true 면 정상
-- =============================================================================
-- select 'credit_ledger 테이블'  as 항목,
--        to_regclass('public.credit_ledger') is not null as 적용됨
-- union all select 'spend_credit RPC',
--        to_regprocedure('public.spend_credit(text,text,text)') is not null
-- union all select 'refund_credit RPC',
--        to_regprocedure('public.refund_credit(text,text)') is not null
-- union all select '무료 한도 설정',
--        exists (select 1 from public.site_config where key = 'credit_free_limits');
--
-- 내 잔액 확인:   select public.credit_balance();
-- 특정 회원 지급: select public.grant_credit('<member uuid>', 'ai_killer', 10, '테스트 지급');
-- =============================================================================
