-- =============================================================================
-- 챌린지 DAY 문항을 admin 에서 고칠 수 있게 (2026-08-24 오너 "고칠 수 있게 해줘")
-- =============================================================================
-- 배경: 승자각 DAY1~10 문항이 HTML 세 곳에 손으로 적혀 있었다
--       (challenge-answer.html 커리큘럼 · apply.html 커리큘럼 요약 · mypage.html ANSWER_DAYS).
--       한 곳만 고치면 화면마다 다른 문항이 뜬다. 표 하나를 단일 소스로 만든다.
--
-- 읽는 곳(전부 비회원도 읽는다 — 상세·신청 페이지는 공개다):
--   · challenge-answer.html — 커리큘럼 10줄(제목 + 설명)
--   · apply.html            — 커리큘럼 요약(제목만)
--   · mypage.html           — 내 챌린지 제출의 승자각 문항 목록 + 작성 판정
--
-- ⚠️ 오너가 Supabase SQL Editor 에서 실행해야 반영된다.
-- ⚠️ 미적용 상태 degrade: 세 화면 모두 **지금 HTML 에 적힌 값 그대로** 나온다
--    (조회 실패면 덮어쓰지 않는다). 아무것도 안 깨진다.
-- =============================================================================


-- ── 1. 표 ────────────────────────────────────────────────────────────────────
create table if not exists public.challenge_lessons (
  id          uuid primary key default gen_random_uuid(),
  challenge   text     not null,                       -- voice·expression·spinning·answer
  day_no      smallint not null check (day_no between 1 and 30),
  title       text     not null,                       -- 'DAY 3. 장점/단점' 의 '장점/단점' 부분
  summary     text,                                    -- 상세 페이지 설명 한 줄(신청·마이페이지는 안 쓴다)
  match_words text[]   not null default '{}',          -- 작성 판정용 낱말(비면 title 에서 만든다)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (challenge, day_no)
);

comment on table public.challenge_lessons is
  '챌린지 DAY 문항 단일 소스. 상세·신청·마이페이지가 같이 읽는다. admin 챌린지 탭에서 고친다.';
comment on column public.challenge_lessons.title is
  '문항 이름만 넣는다(''DAY 3.'' 같은 머리는 화면이 붙인다).';
comment on column public.challenge_lessons.match_words is
  '학생이 답변 제목을 고쳐도 같은 문항으로 알아보게 하는 낱말. 비우면 화면이 title 로 만든다(mypage dayNoOf).';

drop trigger if exists trg_challenge_lessons_updated_at on public.challenge_lessons;
create trigger trg_challenge_lessons_updated_at
  before update on public.challenge_lessons
  for each row execute function public.set_updated_at();


-- ── 2. RLS — 커리큘럼은 공개 정보다(비회원도 읽는다). 쓰기는 admin 만 ────────
alter table public.challenge_lessons enable row level security;

drop policy if exists chles_read_all  on public.challenge_lessons;
drop policy if exists chles_admin_all on public.challenge_lessons;

create policy chles_read_all on public.challenge_lessons
  for select to anon, authenticated using (true);

create policy chles_admin_all on public.challenge_lessons
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ── 3. 승자각 현재 문항 심기 (2026-07-12 오너 확정 커리큘럼 그대로) ─────────
-- 이미 있으면 건드리지 않는다(on conflict do nothing) — 재실행해도 고친 값이 안 덮인다.
insert into public.challenge_lessons (challenge, day_no, title, summary, match_words) values
  ('answer',  1, '자기소개',    '나를 한 문장으로 기억시키는 자기소개를 만듭니다. 흔한 소개가 아니라 면접관의 기억에 남는 대표 문장을 완성합니다.', '{자기소개}'),
  ('answer',  2, '지원동기',    '나의 경험과 승무원 직무를 연결하는 지원동기를 작성합니다. 막연한 동경이 아니라 나만의 이유가 들리는 답변을 만듭니다.', '{지원동기,지원이유,지원한이유}'),
  ('answer',  3, '장점/단점',   '장점은 행동으로 증명하고, 단점은 개선 과정으로 표현합니다. 나를 솔직하면서도 신뢰감 있게 보여줍니다.', '{장점,단점}'),
  ('answer',  4, '가치관',      '추상적인 가치관을 내 경험으로 설득력 있게 풀어냅니다. 말뿐인 가치관이 아니라 나다운 기준을 드러냅니다.', '{가치관}'),
  ('answer',  5, '마지막 할 말', '부탁이 아닌 확신을 남기는 마무리 답변을 만듭니다. 면접의 끝을 나에 대한 인상으로 정리합니다.', '{마지막할말,마지막으로}'),
  ('answer',  6, '서비스 경험',  '내가 생각하는 좋은 서비스와 실제 경험을 연결합니다. 서비스에 대한 나만의 기준이 보이는 답변을 만듭니다.', '{서비스경험,서비스}'),
  ('answer',  7, '갈등 해결',   '갈등 상황을 길게 설명하기보다 나의 해결 태도가 보이는 답변을 만듭니다. 문제를 대하는 나의 방식을 드러냅니다.', '{갈등}'),
  ('answer',  8, '팀워크',      '팀 안에서 나의 역할이 드러나는 답변을 구성합니다. 협업 속에서 내가 어떤 사람인지 보여줍니다.', '{팀워크,협업}'),
  ('answer',  9, '실패 경험',   '실패 자체보다 배운 점과 달라진 행동을 중심으로 정리합니다. 성장하는 사람이라는 인상을 남깁니다.', '{실패}'),
  ('answer', 10, '체력관리',    '승무원 직무에 맞는 자기관리 습관을 표현합니다. 꾸준함과 성실함이 드러나는 답변으로 마무리합니다.', '{체력}')
on conflict (challenge, day_no) do nothing;


-- =============================================================================
-- 검증(실행 후)
-- =============================================================================
-- 1) select day_no, title from public.challenge_lessons
--     where challenge='answer' order by day_no;   → 10줄
-- 2) 비회원 읽기: anon 키로 GET /rest/v1/challenge_lessons?challenge=eq.answer
--                → 200 + 10줄(0줄이면 정책 확인)
-- 3) 화면: admin '챌린지' 탭 아래 '승자각 DAY 문항' 10줄이 채워져 보이는지,
--          고쳐 저장하면 challenge-answer / apply / mypage 에 같이 반영되는지.
-- =============================================================================
-- 롤백
-- =============================================================================
-- drop table if exists public.challenge_lessons;
-- (화면은 표가 없으면 HTML 에 적힌 값으로 되돌아간다 — 따로 되돌릴 코드가 없다)
-- =============================================================================
