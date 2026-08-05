-- =============================================================================
-- 승준노트 허브 — 코스 4단계 개편(초급·중급·고급·실전) (2026-08-06)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260805160000(member_course)
--
-- 배경: 코스 4종(비기너·실전·스퍼트·데일리)을 단계형(초급→실전)으로 바꿨다(오너 확정
--       2026-08-06, B안 세로 리스트). 코드값도 단계에 맞게 교체한다.
--         beginner → basic  ·  daily → mid  ·  spurt → advanced  ·  practical 유지
--       (구 코스 화면은 배포된 적이 없어 실데이터는 사실상 null 뿐이지만, 혹시 있을
--        값도 위 대응으로 옮긴다.)
--
-- 미적용 시 degrade: 새 화면에서 [이 코스로 시작하기] 저장이 체크 제약에 걸려 실패하고,
--   화면은 "지금은 코스 저장이 안 돼요"를 말하며 A(선택 전)에 머문다. 조회는
--   select('*') 라 목록이 깨지지 않는다. 결제·크레딧에는 영향 없음.
-- =============================================================================

-- 제약을 먼저 내려야 값 이동이 걸리지 않는다
alter table public.members drop constraint if exists members_course_check;

update public.members set course = case course
  when 'beginner' then 'basic'
  when 'daily'    then 'mid'
  when 'spurt'    then 'advanced'
  else course end
where course in ('beginner','daily','spurt');

alter table public.members add constraint members_course_check
  check (course is null or course in ('basic','mid','advanced','practical'));

comment on column public.members.course is
  '승준노트 허브에서 고른 추천 코스(초급 basic·중급 mid·고급 advanced·실전 practical). null=아직 안 고름. 코드명은 briefing.html COURSES 와 짝 — 바꾸지 말 것.';
