-- =============================================================================
-- MONC 미니 다듬기(quickfix) — 회원 제보 수집함 (2026-07-31)
-- =============================================================================
-- 스펙: docs/superpowers/specs/2026-07-31-quickfix-collector-design.md
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260703120000(members·is_admin)
--
-- 무엇인가: 회원이 "AI 느낌이 나는 구간"을 붙여넣으면 Haiku 가 무료로 다듬어 주는
--   미니 도구(quickfix.js 바텀시트)의 접수함. 사용자는 고침을 받고, 우리는
--   "사용자가 AI 같다고 느낀 표현" 데이터를 얻는다 — 감점 사전(ai_killer_terms)의
--   재료가 admin '감점 사전' 탭의 '회원 제보' 집계로 쌓인다.
--
-- ⚠️ 미적용이어도 사이트는 정상 — 위젯이 프로브 게이트에서 '준비 중'으로 degrade.
-- =============================================================================

create extension if not exists pgcrypto;

-- ⚠️ id 는 서버(ai-killer 함수 quickfix 분기)가 만들어 넣는다. default 는 수동 검증용.
create table if not exists public.expression_reports (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members(id) on delete cascade,
  -- 어느 화면에서 냈나(퍼널 판단용) — 'killer' / 'answers' / 'sojae'. 서버가 화이트리스트.
  page          text,
  -- 회원이 붙여넣은 원문 구간(300자 이내 — 서버가 재검증)
  content       text not null,
  -- Haiku 가 고쳐 준 문장
  fixed         text not null,
  -- ⚠️ 수집의 핵심 — AI 가 짚은 표현을 구조화해 쌓는다. [{term, kind, why}]
  --    kind 는 사전 분류 3종(cliche/structure/context)과 같은 체계.
  --    term 은 원문에 실제로 등장하는 문자열만(서버가 includes 로 검증 — 오염 방지).
  spotted       jsonb not null default '[]'::jsonb,
  -- 원가 실측(Haiku 4.5 — 건당 몇 원 미만이어야 정상)
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  created_at    timestamptz not null default now()
);

comment on table public.expression_reports is
  '미니 다듬기(quickfix) 접수함. 회원이 AI 같다고 느낀 구간 + AI가 짚은 표현(spotted). '
  '자주 나온 표현은 admin 감점 사전 탭에서 검수 후 ai_killer_terms(coach)로 승격한다.';

-- 하루 한도(서울 자정 기준 3회) 판정용 — 서버가 member+created_at 로 센다
create index if not exists expression_reports_member_idx
  on public.expression_reports (member_id, created_at desc);
-- admin 집계는 최근순으로 읽는다
create index if not exists expression_reports_created_idx
  on public.expression_reports (created_at desc);

-- =============================================================================
-- RLS — 감점 사전과 같은 급의 비공개
-- =============================================================================
-- ⚠️ 회원 정책을 만들지 않는다. 쓰기는 service role(중계 함수)만 — 회원 insert 를
--    열면 하루 한도를 화면 밖에서 우회해 채울 수 있고, 가짜 spotted 를 심어
--    사전 후보를 오염시킬 수 있다. 읽기도 관리자만(제보 원문에 남의 글이 담긴다).
alter table public.expression_reports enable row level security;

drop policy if exists expr_reports_admin_all on public.expression_reports;
create policy expr_reports_admin_all on public.expression_reports
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
