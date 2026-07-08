-- =============================================================================
-- members.major (전공) 추가
-- 목적: 회원 온보딩(onboarding.html)에서 전공을 받아 프로필에 저장.
--       신청 간소화·관리자 참고용. nullable(선택 입력).
-- 적용: Supabase SQL Editor 에서 이 파일을 실행하면 됨(이 레포는 자동 마이그레이션 없음).
--       실행 전엔 onboarding.html 이 전공을 방어적으로 무시하므로 사이트는 정상 동작.
-- =============================================================================
alter table public.members add column if not exists major text;

comment on column public.members.major is
  '회원 전공(온보딩에서 입력). nullable. 식별 키로 쓰지 말 것.';
