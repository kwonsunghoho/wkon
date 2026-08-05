-- =============================================================================
-- 총량 무료 폴백 정리 — AI킬러 첫 2회가 공짜로 나가던 자리 (2026-08-06)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260725130000_credits · 20260725180000_credit_costs
--
-- 문제: `credit_free_limit(p_tool)` 은 site_config `credit_free_limits` 에 그 도구 키가
--   **없으면** 함수 안 폴백을 돌려준다. 폴백이 `ai_killer → 2` 라, 20260725180000 이
--   설정에서 ai_killer 를 뺐는데도 한도가 0 이 아니라 2 였다.
--   (프로덕션 실측 2026-08-06: credit_free_limits = {"polish": 1})
--
--   spend_credit 은 `v_free_lim > 0` 만 보고 총량 무료 분기를 열고 free_ref 를
--   `coalesce(nullif(p_free_ref,''), p_ref)` 로 채우므로, 함수를 `p_free_ref: null` 로
--   불러도 막히지 않는다. 결과적으로 회원마다 AI킬러 **첫 2회가 총량 무료**로 나가고
--   그 위에 하루 무료 5가 또 붙었다 — 20260725180000 주석이 "하루 무료와 총량 무료를
--   둘 다 받아 첫 이틀이 공짜가 된다"며 막으려던 상황 그대로다.
--
-- 고침: 폴백을 현행 정책과 같은 모양으로 맞춘다 — 총량 무료는 첨삭 1회뿐.
--   ⚠️ 폴백은 '설정이 깨졌을 때의 안전값'이지 지급량 조절값이 아니다. 무료를 늘리려면
--      admin '크레딧' 탭(설정)이나 grant_credit 일괄 지급을 쓴다. 여기에 도구를 추가하지 말 것.
--
-- 미적용 시: AI킬러 무료가 지금처럼 회원당 2회 더 나간다(검사 3크레딧 × 2 = 6크레딧).
--   기능은 정상이고 돈만 더 나간다.
-- 적용 뒤 이미 무료로 나간 분은 되돌리지 않는다(원장은 사실 기록 — 지우지 말 것).
-- =============================================================================

create or replace function public.credit_free_limit(p_tool text)
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select nullif(value ->> p_tool, '')::int
       from public.site_config where key = 'credit_free_limits'),
    case p_tool when 'polish' then 1 else 0 end
  );
$$;

-- 확인용(선택) — 적용 뒤 0 · 1 · 0 이 나와야 한다.
--   select public.credit_free_limit('ai_killer') as killer,
--          public.credit_free_limit('polish')    as polish,
--          public.credit_free_limit('sojae')     as sojae;
