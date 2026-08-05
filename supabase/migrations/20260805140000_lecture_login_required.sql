-- =============================================================================
-- 특강 신청 로그인 필수 (2026-08-05 오너 확정)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260804150000_rls_hardening.sql (applications_insert_public 정책이 이미 있어야 한다)
--
-- 무엇을 바꾸나
--   챌린지는 비회원 신청을 유지하되, **특강(lecture_id 가 있는 신청)은 로그인한 본인만**
--   브라우저에서 넣을 수 있게 INSERT 정책을 좁힌다. 특강 정원을 비회원이 대량으로
--   먹어 실제 신청을 막는 걸 방지한다(2026-08-04 점검에서 '남는 구멍'으로 남겨 뒀던 자리).
--
-- 방어는 세 겹이다
--   ① 화면: lecture.html 이 비로그인에게 신청 폼 대신 '로그인하고 신청하기' 를 그린다.
--   ② 서버: verify-payment 가 lectureId 결제에 JWT 를 요구한다(비로그인 결제는 전액 환불).
--   ③ DB(이 파일): applications INSERT 정책 — 이 정책이 최종 방어다.
--
-- ⚠️ 카드 결제 특강 신청은 verify-payment 가 service_role 로 넣으므로 이 정책의 영향을
--    받지 않는다(service_role 은 RLS 통과). 이 정책이 거르는 건 lecture.html 의 직접 insert
--    (무료 신청·계좌이체) 뿐이고, 그쪽은 이미 로그인 회원만 member_id 를 달아 넣는다.
-- ⚠️ 챌린지 신청(lecture_id 가 NULL)은 종전 그대로 — 비회원도 넣는다.
-- =============================================================================

drop policy if exists applications_insert_public on public.applications;
create policy applications_insert_public on public.applications
  for insert
  to anon, authenticated
  with check (
    (member_id is null or member_id = auth.uid())
    and coalesce(paid, false) = false
    and coalesce(refunded, false) = false
    and coalesce(refunded_amount, 0) = 0
    and payment_id is null
    and paid_amount is null
    and coalesce(payment_status, 'pending') = 'pending'
    -- ⚠️ 특강(lecture_id 있음)은 로그인한 본인만. anon 은 auth.uid() 가 NULL 이라
    --    member_id = auth.uid() 가 참이 될 수 없어 자동으로 걸러진다. 챌린지는 NULL 이라 통과.
    and (lecture_id is null or member_id = auth.uid())
  );

comment on table public.applications is
  '챌린지·특강 신청. 챌린지는 비회원 INSERT 허용, 특강(lecture_id)은 로그인 본인만. '
  'SELECT 는 관리자·본인만, 결제 행은 verify-payment 가 service_role 로 넣는다(2026-08-05).';


-- =============================================================================
-- 적용 확인
-- =============================================================================
-- 1) 특강 신청이 비로그인에서 막히는지 — 로그아웃 상태(시크릿 창)에서 42501 이어야 한다
-- curl -s -X POST "https://apzwauiumhmsvrgffjis.supabase.co/rest/v1/applications" \
--   -H "apikey: <anon key>" -H "Content-Type: application/json" \
--   -d '{"name":"rls테스트","phone":"01000000000","lecture_id":"00000000-0000-0000-0000-000000000000"}'
--   → {"code":"42501", ...} 이면 정상. 201 이면 정책이 안 걸린 것이다.
--
-- 2) 챌린지 신청은 비로그인에서 여전히 되는지 — apply.html 에서 계좌이체 신청 1건(비회원).
--
-- 3) 특강 신청은 로그인 회원이 정상 접수되는지 — lecture.html 에서 무료/계좌이체 특강 1건.
--
-- 4) 정책 본문 확인
-- select policyname, cmd, roles, with_check
--   from pg_policies
--  where schemaname='public' and tablename='applications' and policyname='applications_insert_public';
-- =============================================================================


-- =============================================================================
-- 롤백 (특강도 비회원 신청을 다시 허용해야 할 때)
-- =============================================================================
-- drop policy if exists applications_insert_public on public.applications;
-- create policy applications_insert_public on public.applications
--   for insert to anon, authenticated
--   with check (
--     (member_id is null or member_id = auth.uid())
--     and coalesce(paid, false) = false
--     and coalesce(refunded, false) = false
--     and coalesce(refunded_amount, 0) = 0
--     and payment_id is null
--     and paid_amount is null
--     and coalesce(payment_status, 'pending') = 'pending'
--   );
-- =============================================================================
