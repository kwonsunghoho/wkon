-- =============================================================================
-- MONC 소재 발굴 — answers.status ('draft' 작성 중 / 'final' 완료)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run.
--
-- 목적: 되묻기 시작부터 답변을 'draft'(작성 중)로 자동 저장하고, "답변집에 저장(완료)"
--       버튼으로 'final'(완료)로 승격한다. 마이페이지 답변노트가 이 값으로 그룹을 나눈다.
--
-- 안전(idempotent): 컬럼이 없을 때만 추가 + 제약. 재실행하면 통째로 건너뜀.
--   기본값을 'final' 로 둔 이유: 앱은 저장 시 status 를 항상 명시(draft/final)하므로 기본값은
--   ① 컬럼 추가 시점의 기존 답변, ② 마이그레이션~신코드 배포 사이 구코드가 저장한 답변에만 적용된다.
--   둘 다 '완성된 답변'이므로 'final' 이 맞고, 실행 순서와 무관하게 오분류가 없다. 별도 백필 불필요.
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'answers' and column_name = 'status'
  ) then
    alter table public.answers add column status text not null default 'final';
    alter table public.answers add constraint answers_status_check check (status in ('draft','final'));
  end if;
end $$;

comment on column public.answers.status is 'draft(작성 중) / final(완료). 되묻기 시작 시 draft 자동 생성, 완료 저장 시 final.';
