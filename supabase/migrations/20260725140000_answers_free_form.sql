-- =============================================================================
-- MONC 답변노트 확장 — '문제별 답변집' → '내 글 보관함' (2026-07-25)
-- =============================================================================
-- 스펙: docs/superpowers/specs/2026-07-24-ai-killer-design.md (결정 9, ③단계)
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260705120000(answers) · 20260706120000(answers.status)
--
-- 왜 넓히는가
--   지금 answers 는 "우리가 낸 문제에 대한 답변집"이다 — question_id 가 NOT NULL 이고
--   questions 에 FK 로 묶여 있어 **자소서 문항이 들어갈 자리가 없다.**
--   확정본 결정 8(답변노트에 글을 올려야 무료분이 나온다)이 성립하려면 자유 입력 글을
--   받아야 하므로 그릇을 넓힌다.
--
-- ⚠️ 이 마이그레이션은 AI킬러와 **독립적으로 쓸모가 있다** — 먼저 실행해도 된다.
--    (자소서를 답변노트에 모아 두는 것 자체가 기능이다.)
-- =============================================================================

-- =============================================================================
-- 1. question_id 를 nullable 로 — 자유 글이 들어갈 자리
-- =============================================================================
-- ⚠️ unique(member_id, question_id) 제약은 **그대로 둔다.**
--    Postgres 유니크 인덱스는 NULL 을 서로 다른 값으로 취급하므로(기본 NULLS DISTINCT)
--    자유 글(question_id IS NULL)은 여러 개가 들어가고, 문제별 답변은 여전히 회원당 1개다.
--    제약을 건드릴 필요가 없다 — 건드리면 문제별 답변 중복이 열린다.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'answers'
       and column_name = 'question_id' and is_nullable = 'NO'
  ) then
    alter table public.answers alter column question_id drop not null;
  end if;
end $$;

-- =============================================================================
-- 2. title — 자유 글의 문항명 (예: "지원 동기를 기술하시오")
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'answers' and column_name = 'title'
  ) then
    alter table public.answers add column title text;
  end if;
end $$;

comment on column public.answers.title is
  '자유 글(question_id IS NULL)의 문항명. 문제 답변이면 비어 있고 questions.content 가 제목 역할.';

-- =============================================================================
-- 3. 둘 다 없는 행 금지 — 제목도 문제도 없는 유령 글 차단
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'answers_source_check'
  ) then
    alter table public.answers add constraint answers_source_check
      check (question_id is not null or nullif(btrim(coalesce(title,'')), '') is not null);
  end if;
end $$;

-- =============================================================================
-- 4. 자유 글 길이 상한 1,500자
-- =============================================================================
-- ⚠️ 확정본 '1500자 상한은 세 곳에 같은 값으로'(브라우저 입력 / 중계 함수 검증 /
--    답변노트 자유 글 저장) 중 세 번째. 노트가 3,000자를 담을 수 있는데 검사기가 1,500자만
--    받으면 "올린 글을 무료로 검사한다"는 약속이 그 글에서 깨진다.
-- ⚠️ **기존 문제 답변(question_id IS NOT NULL)에는 걸지 않는다** — 이미 저장된 긴 답변이
--    있을 수 있고, 그쪽은 AI킬러 무료분 대상이 아니라 상한을 맞출 이유가 없다.
--    원가 상한을 지키는 진짜 관문은 중계 함수(ai-killer)의 길이 검증이다.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'answers_freeform_len_check'
  ) then
    alter table public.answers add constraint answers_freeform_len_check
      check (question_id is not null or char_length(content) <= 1500);
  end if;
end $$;

-- 자유 글만 빠르게 긁는 조회(마이페이지 '내 글' 탭)
create index if not exists answers_freeform_idx
  on public.answers (member_id, updated_at desc) where question_id is null;

-- =============================================================================
-- 5. RLS 확인 — 기존 정책이 member_id 기준이라 자유 글도 그대로 보호된다.
--    (20260705120000 에서 본인 select/insert/update, 관리자 전체로 이미 설정됨.
--     question_id 를 참조하는 정책이 없으므로 손댈 것이 없다.)
-- =============================================================================

-- =============================================================================
-- 적용 확인 — 3행이 모두 true 면 정상
-- =============================================================================
-- select 'question_id nullable' as 항목,
--        (select is_nullable = 'YES' from information_schema.columns
--          where table_schema='public' and table_name='answers' and column_name='question_id') as 적용됨
-- union all select 'title 컬럼',
--        exists (select 1 from information_schema.columns
--                 where table_schema='public' and table_name='answers' and column_name='title')
-- union all select '둘 다 없는 행 금지',
--        exists (select 1 from pg_constraint where conname='answers_source_check');
--
-- ⚠️ 적용 뒤 확인할 것: 소재발굴(sojae.html)은 저장 시 항상 question_id 를 채우므로 무영향.
--    답변노트를 그리는 화면이 **두 곳**(answers.html · mypage.html#sec-answers)이라
--    "문제 제목이 없으면 title 을 쓴다" 폴백을 **양쪽 다** 넣어야 자유 글이 제목 없이 뜨지 않는다.
-- =============================================================================
