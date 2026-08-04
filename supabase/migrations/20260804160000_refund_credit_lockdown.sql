-- =============================================================================
-- 구 환급 RPC 회수 — refund_credit 을 브라우저에서 못 부르게 한다 (2026-08-04)
-- =============================================================================
-- ⚠️ **마지막에 실행한다.** 앞의 두 단계가 끝난 뒤가 아니면 실행하지 말 것.
--   ① 20260804150000_rls_hardening.sql 실행 (refund_credit_for 생성)
--   ② ai-killer · sojae-chat 재배포 — 두 함수가 refund_credit_for 를 쓰도록 바뀐 버전
--   ③ 이 파일                                     ← 여기
--
-- 왜 나눠 실행하나
--   에지 함수는 AI 호출이 실패하면 차감을 되돌린다. ②를 건너뛰고 이걸 먼저 실행하면
--   그 환급이 권한 없음으로 실패해 **학생이 결과도 못 받고 크레딧만 잃는다.**
--
-- ② 확인 방법 — 로그인 없이 프로브(안전, DB 안 건드림)
--   POST https://apzwauiumhmsvrgffjis.supabase.co/functions/v1/ai-killer   {"probe":true}
--   POST https://apzwauiumhmsvrgffjis.supabase.co/functions/v1/sojae-chat  {"probe":true}
--   두 응답의 features 에 **refund_server** 가 있으면 새 버전이다. 없으면 아직 구버전.
--
-- 무엇을 막는가
--   refund_credit(text,text) 은 대상을 auth.uid() 로 정하므로 로그인한 회원이면 누구나
--   REST RPC 로 부를 수 있었다. 유료 기능을 쓰고 결과를 받은 뒤 자기 차감을 되돌리면
--   (차감 키는 본인 credit_ledger 조회로 그대로 보인다) 유료 기능이 사실상 무료가 된다.
--   서버는 이제 refund_credit_for 를 쓰므로 이 함수는 아무도 부를 필요가 없다.
-- =============================================================================

revoke execute on function public.refund_credit(text, text) from authenticated;
revoke all    on function public.refund_credit(text, text) from public, anon;

comment on function public.refund_credit(text, text) is
  '[사용 중지] 구 환급 RPC. 대상이 auth.uid() 라 브라우저에서 스스로 환급할 수 있었다(2026-08-04 회수). 서버는 refund_credit_for(uuid,text,text) 를 쓴다.';


-- =============================================================================
-- 적용 확인
-- =============================================================================
-- 1) 권한표 — refund_credit 의 authenticated 가 false, refund_credit_for 의
--    service_role 만 true 여야 한다
-- select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as 실행가능
--   from pg_proc p, pg_namespace n, pg_roles r
--  where p.pronamespace=n.oid and n.nspname='public'
--    and p.proname in ('refund_credit','refund_credit_for')
--    and r.rolname in ('anon','authenticated','service_role')
--  order by p.proname, r.rolname;
--
-- 2) 실동작 — 로그인한 회원 계정으로 AI킬러 검사 1회.
--    ① 크레딧이 정상 차감되는가(spend_credit 은 그대로 열려 있다)
--    ② 결과가 정상으로 나오는가
--    브라우저 콘솔에서 아래를 부르면 이제 거부돼야 한다(회수 확인):
--    await MONC.sb.rpc('refund_credit', { p_tool:'ai_killer', p_ref:'아무값' })
--      → error 42501(permission denied for function refund_credit)
-- =============================================================================


-- =============================================================================
-- 롤백 (에지 함수를 구버전으로 되돌려야 할 때만)
-- =============================================================================
-- grant execute on function public.refund_credit(text, text) to authenticated;
-- =============================================================================
