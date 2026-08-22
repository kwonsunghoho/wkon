-- =============================================================================
-- 숨김(visible=false) 특강·프로그램 — 신청·등록한 본인에게는 계속 보이게 (2026-08-22 감사 수리 #5)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260724120000(special_lectures) · 20260730150000(answer_program).
--
-- 왜 필요한가 ─────────────────────────────────────────────────────────────────
--   두 표의 select 정책이 visible=true 만 허용해서, 오너가 판매 종료로 숨기는 순간
--   **이미 신청·수강 중인 본인**의 화면까지 조용히 깨진다(에러 없는 0행):
--     · 특강: 신청자 mypage '다가오는 일정' 카드가 사라진다.
--     · 프로그램: programs 허브에 수강 중인 비공개 프로그램 카드가 안 그려지고,
--       mypage 이용권 접이는 제목 조회가 0행이라 '일문일답' 폴백만 남는다.
--   ap_program_view() RPC 는 이미 `visible or 등록자 or 스태프` 로 판정한다 — DB 안에서
--   규칙이 갈려 있던 것이므로, 테이블 정책을 RPC 와 같은 기준으로 맞춘다.
--
-- 방식 — 판정 함수(definer) + 정책의 or 한 줄 ─────────────────────────────────
--   정책 식 안에서 applications·program_enrollments 를 직접 서브쿼리하면 그 표의
--   RLS 를 다시 타므로, 본인 여부만 확인하는 definer 함수로 감싼다(can_sojae 류의
--   '기능 게이트'가 아니라 auth.uid() 본인 행 존재 확인 — 남의 정보는 안 샌다).
-- =============================================================================

-- 1. 본인이 신청한 특강인가 (환불돼도 true — 신청·결제 내역 표시가 목적이라 이력 기준)
create or replace function public.monc_applied_lecture(p_lecture uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.applications a
     where a.lecture_id = p_lecture and a.member_id = auth.uid()
  );
$$;

comment on function public.monc_applied_lecture(uuid) is
  '현재 로그인 회원이 이 특강에 신청 이력이 있는지. 숨김 특강을 신청자 본인에게 보여주는 select 정책용.';

-- 2. 본인이 등록된 프로그램인가 (ap_program_view 의 v_enr 판정과 같은 기준 — active 만)
-- ⚠️ status='active' 로 좁힌다 — 전 상태를 인정하면 만료·환불 회원의 숨김 프로그램이
--    허브에 카드로 뜨는데 RPC(active 만)는 not_found 를 돌려줘 막다른 카드가 된다.
--    대가로 만료 이용권의 mypage 제목 조회는 숨김 프로그램에서 '일문일답' 폴백으로
--    떨어진다 — 막다른 CTA 보다 낫다(제목 폴백은 원래 있는 방어).
create or replace function public.monc_enrolled_program(p_program uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.program_enrollments e
     where e.program_id = p_program and e.member_id = auth.uid()
       and e.status = 'active'
  );
$$;

comment on function public.monc_enrolled_program(uuid) is
  '현재 로그인 회원이 이 답변 프로그램의 active 이용권 소유자인지(ap_program_view 와 같은 기준). 숨김 프로그램을 수강생 본인에게 보여주는 select 정책용.';

-- 정책 평가 때 조회자 권한으로 실행되므로 anon 에도 EXECUTE 가 있어야 한다
-- (anon 은 auth.uid() null → 항상 false — 숨김이 비회원에게 열리지 않는다).
grant execute on function public.monc_applied_lecture(uuid)  to anon, authenticated;
grant execute on function public.monc_enrolled_program(uuid) to anon, authenticated;

-- 3. select 정책 교체 — 공개이거나, 본인이 신청·등록한 것 -----------------------
drop policy if exists special_lectures_read_public on public.special_lectures;
create policy special_lectures_read_public on public.special_lectures
  for select
  to anon, authenticated
  using (visible = true or public.monc_applied_lecture(id));

drop policy if exists ap_programs_public_select on public.answer_programs;
create policy ap_programs_public_select on public.answer_programs
  for select to anon, authenticated
  using (visible = true or public.monc_enrolled_program(id));

-- =============================================================================
-- 적용 확인 — 두 정책의 qual 에 monc_*(id) 가 붙어 있으면 정상
-- =============================================================================
-- select tablename, policyname, qual from pg_policies
--  where schemaname = 'public'
--    and policyname in ('special_lectures_read_public', 'ap_programs_public_select');
--
-- 실동작 확인: 신청자 있는 특강을 admin 에서 숨김 → 그 신청자 mypage '다가오는 일정'
-- 카드가 그대로 남아 있으면 정상(비로그인·미신청자에게는 계속 안 보인다).
-- =============================================================================
