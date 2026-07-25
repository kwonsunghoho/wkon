-- =============================================================================
-- MONC 답변 저장소 — 분류 3종(질문 유형 · 종류 · 항공사) (2026-07-25)
-- =============================================================================
-- 스펙: docs/superpowers/specs/2026-07-24-ai-killer-design.md
-- 목업: outputs/answer-vault-mockup.html
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260705120000(answers·questions) · 20260725140000(answers 자유 글)
--
-- 왜 필요한가 ─────────────────────────────────────────────────────────────────
--   오너 지시(2026-07-25): "답변 목록에서 검색할 수 있는 검색창, 질문 유형별로
--   구분해주는 부분이 필요하다."
--   `answers.html` 에는 검색창과 분류 칩이 **이미 있다.** 그런데 직접 쓴 자유 글
--   (question_id IS NULL)은 분류가 붙을 자리가 없어 **필터에서 통째로 빠진다.**
--   그래서 새 화면을 만드는 게 아니라 **있는 필터가 동작하게** 만드는 작업이다.
--
--   ⚠️ 유형을 새로 만들지 않는다 — 소재 발굴이 이미 쓰는 questions.category 4종을
--      그대로 쓴다. 그래야 소재 발굴로 만든 답변과 직접 쓴 답변이 **한 목록에서
--      같이 걸린다.** 새 분류 체계를 만들면 두 벌이 되어 필터가 반쪽이 된다.
--
-- ⚠️ 미적용이어도 사이트는 정상 — 답변 추가 폼이 분류를 저장하지 못하고
--    (조회는 select('*') 라 안 깨진다) 필터가 소재 발굴 답변만 잡는다.
-- =============================================================================

-- 1. category — 질문 유형 (questions.category 와 같은 4종) ────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'answers' and column_name = 'category'
  ) then
    alter table public.answers add column category text
      check (category in ('experience','values','judgment','company'));
  end if;
end $$;

comment on column public.answers.category is
  'experience=경험 / values=가치관 / judgment=상황판단 / company=회사·직무. questions.category 와 같은 4종. 소재 발굴로 만든 답변은 그 문제에서 물려받고, 직접 쓴 답변은 저장할 때 고른다.';

-- 2. doc_kind — 면접 답변인가 자소서인가 ──────────────────────────────────────
--   ⚠️ ai_killer_checks.doc_kind 와 같은 값이다(20260725160000). 답변에 붙여 두면
--      AI킬러가 그 답변을 불러올 때 **자동으로 채워진다** — 학생이 매번 고르지 않아도 된다.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'answers' and column_name = 'doc_kind'
  ) then
    alter table public.answers add column doc_kind text
      check (doc_kind in ('essay','interview'));
  end if;
end $$;

comment on column public.answers.doc_kind is
  'essay=자소서 문항 / interview=면접 답변 / NULL=미지정. AI킬러가 불러올 때 그대로 쓴다.';

-- 3. airline — 지망 항공사 ────────────────────────────────────────────────────
--   ⚠️ 'all'(만능)은 NULL(아직 안 정함)과 **다른 값**이다(2026-07-25 오너 지시).
--      만능 = 어느 항공사에도 쓰려고 만든 답변이라 첨삭 방향이 "어디에나 통하게"로 가고,
--      NULL = 지망사를 아직 못 정한 상태라 항공사 이야기를 꺼내지 않는다.
--      둘을 한 값으로 합치면 이 구분이 사라진다.
--   코드는 lecture-common.js 의 LEC.AIRLINES 와 같다(ke/lj/7c/tw/ze/yp/rf).
--   ⚠️ check 제약을 걸지 않는다 — 항공사가 늘 때마다 마이그레이션을 또 돌려야 하고,
--      화면이 이미 목록에서만 고르게 한다.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'answers' and column_name = 'airline'
  ) then
    alter table public.answers add column airline text;
  end if;
end $$;

comment on column public.answers.airline is
  '지망 항공사 코드(ke/lj/7c/tw/ze/yp/rf) 또는 all=만능(어디에나 쓰는 답변). NULL=아직 안 정함. ⚠️ all 과 NULL 은 다른 뜻이다.';

-- 4. 기존 답변 백필 — 소재 발굴로 만든 답변은 그 문제에서 물려받는다 ───────────
--   ⚠️ 이걸 안 하면 **이미 쌓인 답변이 전부 '미분류'로 뜬다.** 필터를 켜는 게 목적인데
--      정작 기존 데이터가 안 걸리면 화면이 비어 보인다.
update public.answers a
   set category = q.category
  from public.questions q
 where a.question_id = q.id
   and a.category is null;

-- 우리가 낸 문제에 답한 글은 **면접 답변**이 확실하다(소재 발굴은 면접 문제 풀이다).
-- 자유 글은 알 수 없으므로 건드리지 않는다 — 학생이 고르게 둔다.
update public.answers
   set doc_kind = 'interview'
 where question_id is not null
   and doc_kind is null;

-- 5. 목록 필터 조회용 인덱스 ──────────────────────────────────────────────────
create index if not exists answers_member_category_idx
  on public.answers (member_id, category) where category is not null;

-- =============================================================================
-- 적용 확인 — 3행이 모두 true 면 정상
-- =============================================================================
-- select 'answers.category' as 항목,
--        exists (select 1 from information_schema.columns
--                 where table_schema='public' and table_name='answers' and column_name='category') as 적용됨
-- union all select 'answers.doc_kind',
--        exists (select 1 from information_schema.columns
--                 where table_schema='public' and table_name='answers' and column_name='doc_kind')
-- union all select 'answers.airline',
--        exists (select 1 from information_schema.columns
--                 where table_schema='public' and table_name='answers' and column_name='airline');
--
-- 백필 결과(소재 발굴 답변에 유형이 붙었는지):
-- select category, count(*) from public.answers group by category order by 2 desc;
-- =============================================================================
