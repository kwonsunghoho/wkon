-- =============================================================================
-- MONC 소재 발굴 권한 게이트 잔재 제거 — 답변집 저장 RLS 사고 수리 (2026-08-21)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 되돌리는 대상: 20260707120000_sojae_access (라이브에 적용된 채 남아 있다)
--
-- 왜 필요한가 ─────────────────────────────────────────────────────────────────
--   sojae_enabled 권한 스위치는 2026-07-27 폐지됐다(소재는 크레딧으로 통제 —
--   admin 토글·mypage 잠금·sojae 차단 화면·sojae-chat 검사 전부 삭제). 그런데
--   20260707120000 이 깔아 둔 RLS 정책 3개를 되돌리는 마이그레이션이 없어
--   라이브 DB 에 그대로 남았다. 정책이 `member_id = auth.uid() and can_sojae()` 이고
--   can_sojae() = (sojae_enabled=true 또는 admin) 이라서, 플래그가 꺼진 회원은
--   (폐지 뒤 가입한 회원은 켜 줄 수단 자체가 없다 — 기본값 false)
--     · 답변집(answers) 쓰기 전부 실패 — 소재 발굴 저장 버튼(sojae.html)·
--       직접 쓰기(answers.html)·답변 프로그램 확정본(program-common.js)이 42501
--       "new row violates row-level security policy for table "answers""
--       (2026-08-21 학생 실증 화면 — 저장 버튼이 계속 이 문구로 실패)
--     · 답변집 읽기도 실패 — answers.html·mypage 목록이 빈 화면
--     · 소재 발굴 대화 저장(discovery_sessions/messages)도 조용히 실패
--   2026-08-19 신고("대화가 저장이 안 된다"·"내 답변으로 저장이 안 된다")도 같은
--   원인일 가능성이 높다 — 그때 넣은 자유 글 폴백도 결국 같은 정책에 막힌다.
--   (AI킬러·첨삭의 자동 저장은 service role 이라 이 정책과 무관하게 정상이었다.)
--
-- 무엇을 하나 ─────────────────────────────────────────────────────────────────
--   1) 세 표의 _own 정책을 원래 정의(20260705120000 — 본인 행이면 CRUD)로 되돌린다.
--   2) can_sojae() 함수와 members.sojae_enabled 컬럼을 지운다 — 권한 플래그 방식
--      부활 차단(CLAUDE.md '절대 되살리면 안 되는 것'). 이 컬럼을 참조하는 곳은
--      can_sojae() 뿐이라(뷰 없음 — 2026-08-21 전수 확인) 순서대로 지우면 안전하다.
-- =============================================================================

-- 1. own 정책 원복 — can_sojae() 조건 제거 ------------------------------------
--    admin_all 정책(관리자 전체 접근)은 안 건드린다.
drop policy if exists sessions_own on public.discovery_sessions;
create policy sessions_own on public.discovery_sessions
  for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());

drop policy if exists messages_own on public.discovery_messages;
create policy messages_own on public.discovery_messages
  for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());

drop policy if exists answers_own on public.answers;
create policy answers_own on public.answers
  for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());

-- 2. 게이트 자체 제거 — 함수를 참조하던 정책이 위에서 전부 교체됐으므로 안전 ----
drop function if exists public.can_sojae();
alter table public.members drop column if exists sojae_enabled;

-- =============================================================================
-- 적용 확인 — ① 세 정책에 can_sojae 가 없고 ② 함수·컬럼이 사라졌으면 정상
-- =============================================================================
-- select tablename, policyname, qual, with_check
--   from pg_policies
--  where schemaname = 'public'
--    and policyname in ('sessions_own', 'messages_own', 'answers_own');
-- -- → 세 행 모두 (member_id = auth.uid()) 만 남아 있어야 한다
--
-- select exists (select 1 from pg_proc where proname = 'can_sojae')  as "함수 잔존(false 정상)",
--        exists (select 1 from information_schema.columns
--                 where table_schema = 'public' and table_name = 'members'
--                   and column_name = 'sojae_enabled')               as "컬럼 잔존(false 정상)";
--
-- 실동작 확인: 저장이 안 되던 학생이 sojae.html 에서 [답변집에 저장] 을 다시 누르면
-- 바로 저장된다(쓴 글은 화면에 남아 있다 — 재로그인 불필요).
-- =============================================================================
