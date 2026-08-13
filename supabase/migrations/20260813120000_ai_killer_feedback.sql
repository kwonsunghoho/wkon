-- =============================================================================
-- MONC AI킬러 — 판정 피드백(만족/보통/불만족) (2026-08-13)
-- =============================================================================
-- 목적: 2026-08-12 종합 판정 교체 직후, 지적(밑줄)마다 누른 만족/보통/불만족을 모아
--       새 판정이 어디서 헛짚는지 본다. admin 'AI킬러' 탭(구 감점 사전) 상단 계기판이 읽는다.
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260703120000(members·is_admin·set_updated_at) · 20260725150000(ai_killer_checks)
--
-- ⚠️ 미적용이어도 사이트는 정상 — 화면이 첫 오류(PGRST205)에서 피드백 줄을 숨긴다.
-- ⚠️ expression_reports 와 달리 **회원 직접 insert 를 연다** — 이 표는 관리자 화면에서
--    끝나는 참고 데이터라 오염이 판정·첨삭 프롬프트로 번지지 않는다. 대신
--    unique + hit_n 상한 + 소유 검증 세 겹으로 묶는다(계획서 '왜 직접 insert' 절).
-- ⚠️ 자동 반영 금지(2026-08-13 오너 합의): 만족도에는 '지적이 틀렸다'와 '쓴소리라
--    싫었다'가 섞인다 — 지침(KILLER_VOICE) 수정은 이 표를 보고 사람이 정한다.
create table if not exists public.ai_killer_feedback (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id) on delete cascade,
  check_id   uuid not null references public.ai_killer_checks(id) on delete cascade,
  -- 지적 번호(밑줄 n). 서버 상한(MAX_FINDINGS=10)과 같다 — 상한을 올리면 여기도 올린다.
  hit_n      int  not null check (hit_n between 1 and 10),
  -- good=만족 / neutral=보통 / bad=불만족 (2026-08-13 오너 확정 3단계)
  verdict    text not null check (verdict in ('good','neutral','bad')),
  -- 조회 편의용 사본(원장은 ai_killer_checks.result 의 그 지적) — 관리자 목록이 조인 없이 읽는다.
  quote      text,
  kind       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, check_id, hit_n)
);

comment on table public.ai_killer_feedback is
  'AI킬러 지적별 만족/보통/불만족. 관리자 참고용 — 판정·프롬프트에 자동 반영되지 않는다.';

create index if not exists ai_killer_feedback_recent_idx
  on public.ai_killer_feedback (created_at desc);

drop trigger if exists trg_ai_killer_feedback_updated on public.ai_killer_feedback;
create trigger trg_ai_killer_feedback_updated before update on public.ai_killer_feedback
  for each row execute function public.set_updated_at();

alter table public.ai_killer_feedback enable row level security;

drop policy if exists aik_fb_select_own on public.ai_killer_feedback;
drop policy if exists aik_fb_insert_own on public.ai_killer_feedback;
drop policy if exists aik_fb_update_own on public.ai_killer_feedback;
drop policy if exists aik_fb_admin_all  on public.ai_killer_feedback;

create policy aik_fb_select_own on public.ai_killer_feedback
  for select to authenticated using (member_id = auth.uid());
-- 본인 검사에만 남긴다 — check_id 소유 검증이 없으면 남의 검사 id 에 행을 붙일 수 있다.
create policy aik_fb_insert_own on public.ai_killer_feedback
  for insert to authenticated with check (
    member_id = auth.uid()
    and exists (select 1 from public.ai_killer_checks c
                where c.id = check_id and c.member_id = auth.uid())
  );
-- 마음 바꾸기(만족 ↔ 보통 ↔ 불만족) — 화면 upsert 가 이 정책을 쓴다.
create policy aik_fb_update_own on public.ai_killer_feedback
  for update to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy aik_fb_admin_all on public.ai_killer_feedback
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 적용 확인 — true 1행이면 정상
-- select to_regclass('public.ai_killer_feedback') is not null as 적용됨;
