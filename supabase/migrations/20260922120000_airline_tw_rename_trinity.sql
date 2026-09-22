-- =============================================================================
-- 티웨이항공 → 트리니티항공 사명 변경 반영 (2026-09-22 · 오너 지시 "자료실이랑 홈페이지 모든 내용에서")
-- =============================================================================
-- 배경: 티웨이항공이 2026-09-10 부터 '트리니티항공(TRINITY AIRWAYS)'으로 사명을 바꿨다.
-- 코드·슬러그(`tw` · `twayair`)는 그대로 둔다 — 화면 라벨 표·저장된 기사·특강·자료의 키다.
-- 바꾸는 것은 사람이 읽는 글자뿐. 화면 쪽 라벨 표(lecture-common.js 등)는 같은 커밋에서 바꿨다.
-- ⚠️ 멱등 — 여러 번 실행해도 결과가 같다(replace 는 없으면 그대로).
-- =============================================================================

-- 1. 항공사 프로필(AI킬러·첨삭 프롬프트에 실리는 이름·문항·소재)
update public.airline_profiles set
  name      = '트리니티항공',
  questions = replace(questions::text, '티웨이항공', '트리니티항공')::jsonb,
  style     = replace(replace(style::text, '티웨이 항공', '트리니티항공'), '티웨이', '트리니티항공')::jsonb,
  keywords  = replace(keywords::text, '티웨이', '트리니티항공')::jsonb,
  notes     = replace(replace(coalesce(notes, ''), '티웨이항공', '트리니티항공'), '티웨이', '트리니티항공'),
  updated_at = now()
where code = 'tw';

-- 2. 연구실 자료실(제목·요약) — r/*.html 미리보기 안내판은 이 값으로 1시간마다 다시 만들어진다
update public.lab_resources set
  title   = replace(title, '티웨이항공', '트리니티항공'),
  summary = replace(summary, '티웨이항공', '트리니티항공')
where title like '%티웨이항공%' or summary like '%티웨이항공%';
update public.lab_resources set
  title   = replace(title, '티웨이', '트리니티항공'),
  summary = replace(summary, '티웨이', '트리니티항공')
where title like '%티웨이%' or summary like '%티웨이%';

-- 3. 특강(제목·부제·본문)
update public.special_lectures set
  title       = replace(title, '티웨이항공', '트리니티항공'),
  subtitle    = replace(subtitle, '티웨이항공', '트리니티항공'),
  description = replace(description, '티웨이항공', '트리니티항공')
where title like '%티웨이항공%' or subtitle like '%티웨이항공%' or description like '%티웨이항공%';
update public.special_lectures set
  title       = replace(title, '티웨이', '트리니티항공'),
  subtitle    = replace(subtitle, '티웨이', '트리니티항공'),
  description = replace(description, '티웨이', '트리니티항공')
where title like '%티웨이%' or subtitle like '%티웨이%' or description like '%티웨이%';

-- 4. 답변 프로그램 기출 은행(질문 원문·의도·유사 질문)
update public.interview_questions set
  content    = replace(content, '티웨이항공', '트리니티항공'),
  intent     = replace(intent, '티웨이항공', '트리니티항공'),
  similar_qs = replace(similar_qs::text, '티웨이항공', '트리니티항공')::jsonb
where content like '%티웨이%' or intent like '%티웨이%' or similar_qs::text like '%티웨이%';
update public.interview_questions set
  content    = replace(content, '티웨이', '트리니티항공'),
  intent     = replace(intent, '티웨이', '트리니티항공'),
  similar_qs = replace(similar_qs::text, '티웨이', '트리니티항공')::jsonb
where content like '%티웨이%' or intent like '%티웨이%' or similar_qs::text like '%티웨이%';

-- 확인: 0건이어야 한다
-- select 'airline_profiles' t, count(*) from public.airline_profiles where (name||questions::text||style::text||keywords::text||coalesce(notes,'')) like '%티웨이%'
-- union all select 'lab_resources', count(*) from public.lab_resources where (title||coalesce(summary,'')) like '%티웨이%'
-- union all select 'special_lectures', count(*) from public.special_lectures where (title||coalesce(subtitle,'')||coalesce(description,'')) like '%티웨이%'
-- union all select 'interview_questions', count(*) from public.interview_questions where (content||coalesce(intent,'')||similar_qs::text) like '%티웨이%';
