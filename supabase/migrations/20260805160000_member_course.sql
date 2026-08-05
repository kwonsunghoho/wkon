-- =============================================================================
-- 승준노트 허브 — 회원이 고른 코스 (2026-08-05)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260703120000(membership_schema)
--
-- 배경: 승준노트 허브를 코스형으로 바꾸면서(설계 문서
--       docs/superpowers/specs/2026-08-05-briefing-course-hub-design.md) 학생이 고른
--       코스를 계정에 저장한다. 폰에서 고르고 PC 에서 들어와도 같은 화면이어야 해서
--       기기(localStorage)가 아니라 계정에 둔다.
--
-- 미적용 시 degrade: 허브는 '코스 선택 전' 화면만 보여준다. [이 코스로 시작하기] 를
--   누르면 저장 실패를 화면에 말하고(조용히 무시하지 않는다) 그 자리에 머무른다.
--   조회는 select('*') 라 목록이 깨지지 않는다. 결제·크레딧에는 영향 없음.
--
-- 권한: 기존 members_update_own 정책(id = auth.uid())이 그대로 적용된다 —
--       새 정책이 필요 없다. 회원은 자기 행의 course 만 바꾼다.
-- =============================================================================

alter table public.members
  add column if not exists course text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.members'::regclass and conname = 'members_course_check'
  ) then
    alter table public.members add constraint members_course_check
      check (course is null or course in ('beginner','practical','spurt','daily'));
  end if;
end $$;

comment on column public.members.course is
  '승준노트 허브에서 고른 추천 코스. null=아직 안 고름. 코드명은 briefing.html COURSES 와 짝 — 바꾸지 말 것.';
