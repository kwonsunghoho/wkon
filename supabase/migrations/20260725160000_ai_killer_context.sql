-- =============================================================================
-- MONC AI킬러 — 검사 기록에 '문항(질문)' + '글 종류' 추가 (2026-07-25)
-- =============================================================================
-- 스펙: docs/superpowers/specs/2026-07-24-ai-killer-design.md (결정 11·12)
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260725150000_ai_killer.sql
--
-- ⚠️ 둘 다 **맥락일 뿐 판정 대상이 아니다.** 밑줄 자리·걸린 개수·등급은 규칙이 글 자체만
--    보고 정하므로, 문항·종류가 있든 없든 **숫자는 똑같이 나온다.** 바뀌는 건 AI 가 채우는
--    why/fix 문장뿐이다(결정 11).
--
-- ⚠️ 미적용이어도 검사·결과 반환은 정상이다. 중계 함수가 insert 실패를 감지해
--    두 컬럼을 빼고 한 번 더 저장한다(기록은 남고 맥락만 유실).
-- =============================================================================

-- 1. question — 학생이 받은 문항 ─────────────────────────────────────────────
--   같은 "최선을 다하겠습니다"라도 *지원동기* 문항이면 "왜 하필 이 항공사인지",
--   *갈등 경험* 문항이면 "그때 실제로 한 말"로 고쳐야 한다. 문항을 모르면 AI 가
--   그 갈림길을 못 내고 fix 가 일반론("겪은 장면을 그대로 써 보세요")에 머문다.
--
--   저장하는 이유는 ⑧단계 검수 때문이다 — 붙여넣기(source=paste) 검사는 answer_id 가
--   없어 나중에 "이 답변이 어떤 문항에 대한 것이었는지"를 되짚을 방법이 여기밖에 없다.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ai_killer_checks' and column_name = 'question'
  ) then
    alter table public.ai_killer_checks add column question text;
  end if;
end $$;

comment on column public.ai_killer_checks.question is
  '학생이 받은 문항(선택 입력). 답변노트에서 불러온 글은 questions.content / answers.title 이 자동으로 들어온다. ⚠️ 맥락 전달용 — 판정에는 쓰이지 않는다.';

-- 2. doc_kind — 자소서인가 면접 답변인가 ──────────────────────────────────────
--   ⚠️ 이걸 모르면 지적하는 **말이 반대로 나간다.** 지금 사전 시드의 why 문구가 그 증거다:
--     '첫째'  → "말할 때 이렇게 세는 사람은 없어서, 읽는 순간 외운 원고로 들려요"
--     '더불어' → "문어체 접속부사예요. 말할 때 쓰지 않는 말은 빼는 게 좋아요"
--   전부 **면접 기준**으로 쓰여 있다. 자소서 검사에 그대로 나가면 학생이 "이건 글인데?"
--   하고 신뢰를 잃는다. 첫째·둘째 나열은 자소서에선 허용 범위지만 면접 답변에선 치명적이고,
--   구어체 판정은 두 종류에서 정반대다.
--
--   ⚠️ **지금 갈리는 것은 AI 가 쓰는 why/fix 문장뿐이다.** 사전 표현별 종류 분기
--   (ai_killer_terms.applies_to)와 등급 임계 분리는 ⑧단계 — 오너 자료(감점 표현 20~50개)가
--   와야 근거가 생긴다. 자료 없이 지금 나누면 감으로 정한 숫자가 된다.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ai_killer_checks' and column_name = 'doc_kind'
  ) then
    alter table public.ai_killer_checks add column doc_kind text
      check (doc_kind in ('essay','interview'));
  end if;
end $$;

comment on column public.ai_killer_checks.doc_kind is
  'essay=자소서 문항 / interview=면접 답변 / NULL=미지정(선택 입력). ⚠️ 맥락 전달용 — 등급·걸린 수는 글 자체로만 정해진다.';

-- =============================================================================
-- 적용 확인 — 2행이 모두 true 면 정상
-- =============================================================================
-- select 'ai_killer_checks.question 컬럼' as 항목,
--        exists (select 1 from information_schema.columns
--                 where table_schema='public' and table_name='ai_killer_checks'
--                   and column_name='question') as 적용됨
-- union all select 'ai_killer_checks.doc_kind 컬럼',
--        exists (select 1 from information_schema.columns
--                 where table_schema='public' and table_name='ai_killer_checks'
--                   and column_name='doc_kind');
-- =============================================================================
