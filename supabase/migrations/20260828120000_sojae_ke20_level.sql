-- =============================================================================
-- 소재 발굴 — KE20 섹션 추가 (2026-08-28)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260805120000(sojae_levels)
--
-- 배경: 대한항공 대비 프로젝트용 문항 묶음(KE20)을 소재 발굴에 별도 섹션으로 연다
--       (오너 지시 2026-08-28). 난이도와 같은 축(questions.level)에 'ke20' 코드를
--       더한다 — 순환·오늘 고정·필터가 기존 로직 그대로 굴러간다.
--
-- 미적용 시 degrade: 학생 화면은 KE20 칸이 '0문제'로 뜰 뿐 지금과 똑같이 동작한다.
--   admin 에서 KE20 문항 저장만 제약 위반으로 막히고, 화면이 이 마이그레이션을
--   실행하라고 안내한다. 결제·크레딧에는 영향 없음.
-- =============================================================================

-- 체크 제약을 'ke20' 포함으로 교체.
-- ⚠️ 코드명을 바꾸지 말 것 — 화면(sojae-common.js LEVELS·LEVEL_LABEL)과 짝이다.
alter table public.questions drop constraint if exists questions_level_check;
alter table public.questions add constraint questions_level_check
  check (level in ('basic','mid','advanced','deep','ke20'));

comment on column public.questions.level is
  'basic/mid/advanced/deep + ke20(대한항공 대비 프로젝트 섹션). 학생이 고르는 갈래 — 오늘의 문제 순환이 이 값으로 갈린다.';
