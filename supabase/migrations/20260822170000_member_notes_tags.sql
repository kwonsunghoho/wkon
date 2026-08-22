-- =============================================================================
-- 회원 메모·태그 (2026-08-22 오너 "체계적으로 관리할 수는 없니")
-- =============================================================================
-- 배경: admin 어디에도 **내가 아는 것을 적을 칸이 없었다.** 통화 내용, 지망 항공사,
--       면접 일정처럼 시스템이 모르는 사실이 오너 머릿속에만 남아 있었다.
--       회원 관리의 절반이 이 자리다(스펙 docs/superpowers/specs/2026-08-22-admin-members-crm-design.md).
--
-- ⚠️ **관리자 전용이다. 회원 본인도 못 읽는다.**
--    상담 메모에는 회원에게 보이면 안 되는 판단이 들어간다("환불 요청 잦음" 같은).
--    authenticated 에 select 를 열지 말 것 — 여는 순간 본인이 자기 메모를 읽는다.
--
-- ⚠️ 이 표의 **내용은 개인정보다.** 값 insert 를 레포에 커밋하지 않는다
--    (CLAUDE.md '개인정보·학원 자산 반입 금지').
--
-- ⚠️ 오너가 Supabase SQL Editor 에서 실행해야 반영된다.
-- ⚠️ 미적용 상태 degrade: admin 이 PGRST205 를 '아직 안 켜짐' 안내로 삼킨다.
--    회원 관리 탭의 나머지(현황·분포·타임라인)는 이 표 없이도 그대로 돈다.
-- =============================================================================


-- ── 1. 메모 — 한 회원에 여러 줄, 시간순 ──────────────────────────────────────
create table if not exists public.member_notes (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id) on delete cascade,
  body       text not null check (length(btrim(body)) > 0),
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.member_notes is
  '회원 상담 메모(관리자 전용). 회원 본인에게 노출 금지 — RLS 에 authenticated 정책 없음.';

create index if not exists member_notes_member_idx
  on public.member_notes (member_id, created_at desc);


-- ── 2. 태그 — 한 회원에 여러 개, 같은 태그는 한 번만 ─────────────────────────
create table if not exists public.member_tags (
  member_id  uuid not null references public.members(id) on delete cascade,
  tag        text not null check (length(btrim(tag)) between 1 and 20),
  created_at timestamptz not null default now(),
  primary key (member_id, tag)
);

comment on table public.member_tags is
  '회원 태그(관리자 전용). 자유 입력 — 오타로 갈라지면 그때 고정 목록으로 좁힌다.';

-- 태그로 거르는 것이 이 표의 유일한 용도다(3단계 세그먼트가 쓴다)
create index if not exists member_tags_tag_idx on public.member_tags (tag);


-- ── 3. RLS — 관리자만. is_admin() 은 20260703120000_membership_schema.sql 에서 만들었다 ──
alter table public.member_notes enable row level security;
alter table public.member_tags  enable row level security;

-- ⚠️ authenticated 용 정책을 만들지 말 것. 정책이 하나도 없으면 아무도 못 읽는 것이 기본이고,
--    아래 admin 정책 하나만 두면 관리자만 통과한다. 회원 본인 select 를 여는 순간
--    학생이 자기 상담 메모를 읽는다.
drop policy if exists member_notes_admin on public.member_notes;
create policy member_notes_admin on public.member_notes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists member_tags_admin on public.member_tags;
create policy member_tags_admin on public.member_tags
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
