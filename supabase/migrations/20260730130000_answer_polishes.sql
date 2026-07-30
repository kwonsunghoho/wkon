-- =============================================================================
-- MONC 첨삭 — 첨삭 기록 (answer_polishes) + 리허설 단가 선반영 (2026-07-30)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행(전부 적용 완료 확인 2026-07-30): 20260703120000(members·is_admin)
--   · 20260705120000(answers) · 20260725130000(credit_ledger)
--   · 20260725180000(credit_costs — polish 단가 10 · 하루 무료 5)
--
-- 왜 새 테이블인가 (ai_killer_checks 에 섞지 않는 이유)
--   킬러는 '지적 목록'(hits + 등급), 첨삭은 '리포트'(강점·보완점·문장 첨삭)로
--   result 의 모양이 완전히 다르다. 한 표에 섞으면 grade not null 제약이
--   첨삭 행에 거짓 등급을 강요하고, 화면 조회마다 종류 분기가 생긴다.
--   구조는 ai_killer_checks 를 그대로 본떴다(같은 자리, 같은 규칙).
--
-- ⚠️ 미적용이어도 사이트는 정상 — 중계 함수가 이 표를 먼저 만져 보고 없으면
--    차감 전에 '준비 중'으로 답한다(돈이 나가고 기록을 잃는 경로가 없다).
--    킬러·소재 발굴은 영향 없음.
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- 1. answer_polishes — 첨삭 1건
-- =============================================================================
-- ⚠️ **id 는 중계 함수(ai-killer)가 만들어서 넣는다** — ai_killer_checks 와 같은 이유.
--    차감이 저장보다 먼저라 차감 시점에 사용처 id 가 있어야 한다.
-- ⚠️ **첨삭은 재검사 무차감이 없다**(킬러의 MAX_RECHECK 와 다른 점).
--    킬러(3)는 '고치고 다시 확인'이 핵심 루프라 재검사를 무차감으로 열었지만,
--    첨삭(10)은 처방 그 자체가 상품이라 매 회 차감한다. 고친 뒤 확인은
--    킬러(3크레딧)로 하는 것이 설계된 동선이다: 첨삭 → 고침 → 킬러로 확인.
create table if not exists public.answer_polishes (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  source      text not null check (source in ('paste','answer')),
  -- ⚠️ on delete set null — 학생이 답변노트 글을 지워도 첨삭 이력은 본인 것이라 남긴다
  --    (ai_killer_checks 와 동일 — cascade 면 글 하나 지울 때 유료 리포트가 통째로 날아간다).
  answer_id   uuid references public.answers(id) on delete set null,
  content     text not null,
  question    text,          -- 학생이 받은 문항(선택)
  doc_kind    text,          -- interview | essay | null
  airline     text,          -- 지망 항공사 코드 | 'all' | null
  -- 리포트 전체. { strengths:[{quote,note}], improvements:[{note,how}],
  --               rewrites:[{quote,fix,why}] } — 화면이 그대로 다시 그리는 원본.
  result      jsonb not null default '{}'::jsonb,
  char_count  int not null default 0,
  -- 원가 실측 — 첨삭 10크레딧(약 3,300원)이 남는지 확인하는 근거.
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.answer_polishes is
  '첨삭 1건(강점·보완점·문장 첨삭 리포트). answer_id 로 답변노트와 1:N — 킬러 검사와 나란한 구조.';
comment on column public.answer_polishes.result is
  'strengths/improvements/rewrites 리포트 원본. 화면(polish.html?polish=<id>)이 재검사 없이 복원한다.';

create index if not exists answer_polishes_member_idx
  on public.answer_polishes (member_id, created_at desc);
-- 답변노트 이력 — "그 답변의 첨삭들"을 뽑는 조회
create index if not exists answer_polishes_answer_idx
  on public.answer_polishes (answer_id, created_at desc) where answer_id is not null;

-- =============================================================================
-- 2. RLS — ai_killer_checks 와 동일 규칙
-- =============================================================================
alter table public.answer_polishes enable row level security;

drop policy if exists polish_select_own on public.answer_polishes;
drop policy if exists polish_admin_all  on public.answer_polishes;

-- 본인 읽기 + 관리자 전체.
-- ⚠️ **insert/update 정책을 만들지 않는다** — 쓰기는 service role(중계 함수)만.
--    회원 insert 를 열면 돈 안 내고 리포트 행을 위조해 쌓을 수 있다.
create policy polish_select_own on public.answer_polishes
  for select to authenticated using (member_id = auth.uid());
create policy polish_admin_all on public.answer_polishes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- 3. 리허설 단가 선반영 — 3 → 15 (2026-07-30 오너 확정)
-- =============================================================================
-- ⚠️ 리허설(모의면접)은 아직 미구현 상품이라 지금은 아무 영향이 없다. 그런데 구 값 3은
--    하루 무료 5 아래라, **나중에 리허설을 켜는 순간 첫날부터 매일 공짜**가 된다
--    (spend_credit 판정: 쓴양 + 단가 <= 하루무료 → 통과). 첨삭 10 을 하루 무료 5 로
--    잠근 것과 같은 원리로, 켜기 전에 미리 잠가 둔다. 되살릴 때 값을 다시 정하더라도
--    **하루 무료보다 반드시 커야 한다.**
update public.site_config
   set value = coalesce(value, '{}'::jsonb) || '{"rehearsal": 15}'::jsonb
 where key = 'credit_costs';
-- credit_costs 행 자체가 없는 환경(구 원장만 적용) 대비 — 있으면 위 update 가 이미 처리했다.
insert into public.site_config (key, value)
  values ('credit_costs', '{"sojae": 2, "ai_killer": 3, "polish": 10, "rehearsal": 15}')
  on conflict (key) do nothing;

-- =============================================================================
-- 적용 확인 — 2행이 모두 true 면 정상
-- =============================================================================
-- select 'answer_polishes 테이블' as 항목,
--        to_regclass('public.answer_polishes') is not null as 적용됨
-- union all select '리허설 단가 15',
--        (select value->>'rehearsal' = '15' from public.site_config where key = 'credit_costs');
--
-- ⚠️ 첨삭 무료 1회(credit_free_limits.polish = 1)는 20260725180000 이 이미 넣었다 —
--    여기서 다시 만지지 않는다.
-- =============================================================================
