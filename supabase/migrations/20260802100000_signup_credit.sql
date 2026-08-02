-- =============================================================================
-- MONC 크레딧 — 가입 축하 크레딧 (2026-08-02)
--
-- 오너 확정: "상품구조는 우리가 손해보지 않는선에서 어느정도 맛보기로 사용해볼 수
--            있도록 하고싶긴하다." → 하루 무료를 올리는 대신 **회원당 1회 15크레딧**.
--
-- ⚠️ 왜 하루 무료(credit_daily_free)를 안 올리는가
--   spend_credit 의 판정이 `오늘 쓴양 + 단가 <= 하루무료` 라서, 하루 무료가 첨삭
--   단가(10) 이상이 되는 순간 **첨삭이 매일 공짜**가 된다(만원짜리 주력 상품 소멸).
--   하루 무료 5는 지급량 조절값이 아니라 첨삭 잠금장치다 — 이 값은 건드리지 않는다.
--   반면 가입 축하는 **인당 1회로 비용 상한이 고정**돼 매일 반복되지 않는다.
--
-- 왜 15인가(오너 확정)
--   하루 무료 5 + 축하 15 + 첨삭 첫 1회 무료(credit_free_limits.polish) 조합이면
--   첫날에 **자소서 한 문항을 끝까지** 무료로 완성할 수 있다
--   (소재 2 + 킬러 3 + 킬러 재검사 3 + 첨삭 10 ≒ 18 — 하루 무료와 합쳐 커버).
--   상품 가치를 통째로 한 번 경험시키는 것이 목적이라, 값을 낮추면 중간에 끊긴다.
--
-- ⚠️ 단가(소재 2·킬러 3·첨삭 10)는 그대로 둔다. 단가 인하는 나중에 되돌릴 때
--    "요금 인상"으로 보이지만, 축하 지급은 언제든 조용히 멈출 수 있다.
--
-- 멱등: 회원당 1행만 들어간다(부분 유니크 인덱스가 최종 방어). 로그인마다 호출해도
--       두 번 지급되지 않으므로, 호출부는 '동의 완료 후 매번 호출'로 단순하게 둔다.
--       이미 가입해 있던 회원도 다음 로그인 때 한 번 받는다(초기 회원 보상 겸용).
--
-- 적용 확인
--   select 'signup_credit 함수' as 항목, to_regproc('public.grant_signup_credit') is not null as 적용됨
--   union all select '지급량 설정', (select value::text from public.site_config where key = 'credit_signup_bonus');
-- =============================================================================

-- 1. 지급량 — 재배포 없이 바꾼다(0 이면 지급 중단). admin 크레딧 탭에서 편집.
insert into public.site_config (key, value) values ('credit_signup_bonus', '15')
on conflict (key) do nothing;

-- 2. 멱등 보장 — reason='admin_grant' + ref='signup' 은 회원당 한 행뿐.
--    ⚠️ 이 인덱스가 최종 방어다. 함수 안의 exists 검사와 insert 사이에는 틈이 있다.
create unique index if not exists credit_ledger_signup_uq
  on public.credit_ledger (member_id) where reason = 'admin_grant' and ref = 'signup';

-- 3. 지급 RPC — 본인이 부른다(관리자 지급 grant_credit 과 달리 is_admin 검사 없음).
--    security definer 라 RLS 를 통과하지만, 대상은 언제나 auth.uid() 다
--    (지급 대상을 인자로 받지 않는다 — 남에게 지급시킬 방법이 없어야 한다).
create or replace function public.grant_signup_credit()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_amount int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'no_session'); end if;

  v_amount := coalesce(
    (select nullif(value::text, '')::int from public.site_config where key = 'credit_signup_bonus'), 15);
  if v_amount <= 0 then return jsonb_build_object('ok', true, 'granted', 0, 'code', 'disabled'); end if;

  -- 회원 단위 직렬화 — 두 탭이 동시에 로그인해도 한 번만 들어간다(인덱스와 이중 방어)
  perform pg_advisory_xact_lock(hashtext('credit:' || v_uid::text));

  if exists (select 1 from public.credit_ledger
              where member_id = v_uid and reason = 'admin_grant' and ref = 'signup') then
    return jsonb_build_object('ok', true, 'granted', 0, 'code', 'already');
  end if;

  -- ⚠️ 동의를 마친 회원에게만 준다 — 동의 게이트에서 '거부'하고 나간 사람에게
  --    크레딧이 남으면 파기(delete_my_account) 대상과 원장이 어긋난다.
  if not exists (select 1 from public.members where id = v_uid and agreed_at is not null) then
    return jsonb_build_object('ok', true, 'granted', 0, 'code', 'not_agreed');
  end if;

  insert into public.credit_ledger (member_id, tool, delta, reason, ref)
    values (v_uid, 'ai_killer', v_amount, 'admin_grant', 'signup')
  on conflict do nothing;

  return jsonb_build_object(
    'ok', true, 'granted', v_amount, 'code', 'granted',
    'balance', (select coalesce(sum(delta), 0)::int from public.credit_ledger where member_id = v_uid));
end $$;

comment on function public.grant_signup_credit() is
  '가입 축하 크레딧(회원당 1회, site_config.credit_signup_bonus). 본인만 호출, 멱등.';

revoke all on function public.grant_signup_credit() from public, anon;
grant execute on function public.grant_signup_credit() to authenticated;
