-- =============================================================================
-- MONC 소재 발굴 시스템 — 핵심 루프 스키마 (questions / sessions / messages / answers)
-- =============================================================================
-- 실행 방법: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run (또는 supabase db push)
--
-- 설계 원칙 (기존 membership_schema.sql 관례 그대로)
--   - 회원 식별 키 = auth.users.id (members.id). 모든 회원 데이터 RLS ON + 본인 것만.
--   - is_admin() / set_updated_at() 는 기존 마이그레이션에서 생성됨. 여기선 재사용.
--   - 재실행해도 안전(idempotent).
--
-- 제품 루프(1차): "오늘의 공통 문제 1개" — 전원 같은 문제. questions.scheduled_date 로 지정.
-- 포인트는 별도 마이그레이션에서 추가 예정(이 파일엔 없음).
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- set_updated_at() 가 없을 수도 있으니 안전하게 재정의(기존과 동일 동작) ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;


-- =============================================================================
-- 1. questions (기출문제 풀)
-- =============================================================================
-- category 코드: experience(경험발굴형) / values(가치관형) / judgment(상황판단형) / company(정보·기업분석형)
create table if not exists public.questions (
  id             uuid primary key default gen_random_uuid(),
  content        text not null,
  category       text not null check (category in ('experience','values','judgment','company')),
  airline        text,                                   -- 관련 항공사(없으면 null)
  scheduled_date date,                                   -- 이 날(KST 기준) 오늘의 문제로 노출. null=대기
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

comment on table public.questions is '면접 기출문제 풀. 오늘의 공통 문제는 scheduled_date 로 지정한다.';
comment on column public.questions.category is 'experience/values/judgment/company. 되묻기 방식 분기에 사용.';

-- 하루에 오늘의 문제는 하나만(중복 지정 방지). null 은 제외.
create unique index if not exists questions_scheduled_date_uq
  on public.questions (scheduled_date) where scheduled_date is not null;


-- =============================================================================
-- 2. discovery_sessions (회원 × 문제 되묻기 세션 — 문제당 하나, 재개 가능)
-- =============================================================================
create table if not exists public.discovery_sessions (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.members(id)   on delete cascade,
  question_id  uuid not null references public.questions(id) on delete cascade,
  stage        text not null default 'ask' check (stage in ('ask','refine','write','done')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (member_id, question_id)
);

comment on table public.discovery_sessions is '회원이 한 문제를 푸는 되묻기 세션. stage 로 진행 단계(되묻기→다듬기→최종작성→완료).';

drop trigger if exists trg_discovery_sessions_updated_at on public.discovery_sessions;
create trigger trg_discovery_sessions_updated_at
  before update on public.discovery_sessions
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 3. discovery_messages (되묻기 대화 = 소재 재료)
-- =============================================================================
-- member_id 를 직접 들고 있어 RLS 를 단순화(세션 조인 없이 본인 확인).
create table if not exists public.discovery_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.discovery_sessions(id) on delete cascade,
  member_id   uuid not null references public.members(id)           on delete cascade,
  role        text not null check (role in ('researcher','user','help')),
  content     text not null,
  created_at  timestamptz not null default now()
);

comment on table public.discovery_messages is '되묻기 대화 로그. role=researcher(AI 연구원)/user(지원자)/help(도움모드). 소재 발굴 재료.';


-- =============================================================================
-- 4. answers (최종 답변집 — 문제당 하나, 다시 열어 수정 가능)
-- =============================================================================
create table if not exists public.answers (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.members(id)   on delete cascade,
  question_id  uuid not null references public.questions(id) on delete cascade,
  content      text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (member_id, question_id)
);

comment on table public.answers is '문제별 최종 답변(답변집). 마이페이지에서 다시 열어 수정 가능.';

drop trigger if exists trg_answers_updated_at on public.answers;
create trigger trg_answers_updated_at
  before update on public.answers
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 5. RLS
-- =============================================================================
alter table public.questions          enable row level security;
alter table public.discovery_sessions enable row level security;
alter table public.discovery_messages enable row level security;
alter table public.answers            enable row level security;

drop policy if exists questions_select_authenticated on public.questions;
drop policy if exists questions_admin_all            on public.questions;
drop policy if exists sessions_own                   on public.discovery_sessions;
drop policy if exists sessions_admin_all             on public.discovery_sessions;
drop policy if exists messages_own                   on public.discovery_messages;
drop policy if exists messages_admin_all             on public.discovery_messages;
drop policy if exists answers_own                    on public.answers;
drop policy if exists answers_admin_all              on public.answers;

-- questions: 로그인 유저 누구나 읽기, 관리자만 쓰기 ---------------------------
create policy questions_select_authenticated on public.questions
  for select to authenticated using (true);
create policy questions_admin_all on public.questions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- discovery_sessions: 본인 것만 전체 CRUD, 관리자 전체 -------------------------
create policy sessions_own on public.discovery_sessions
  for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy sessions_admin_all on public.discovery_sessions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- discovery_messages: 본인 것만, 관리자 전체 ---------------------------------
create policy messages_own on public.discovery_messages
  for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy messages_admin_all on public.discovery_messages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- answers: 본인 것만, 관리자 전체 --------------------------------------------
create policy answers_own on public.answers
  for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy answers_admin_all on public.answers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());


-- =============================================================================
-- 6. 시드 (테이블이 비어 있을 때만) — 오늘의 문제 1개 포함, 나머지는 예시
--    실제 기출 50개는 관리자가 추가. scheduled_date 로 매일 오늘의 문제 지정.
-- =============================================================================
insert into public.questions (content, category, airline, scheduled_date, active)
select v.content, v.category, v.airline, v.scheduled_date, true
from (values
  ('예상치 못한 문제를 침착하게 해결했던 경험', 'experience', '대한항공', current_date),
  ('본인이 가장 중요하게 생각하는 가치는 무엇인가요?', 'values', null, null),
  ('팀원과 의견이 크게 부딪혔을 때 어떻게 조율했나요?', 'judgment', null, null),
  ('우리 항공사에 지원한 이유를 말해보세요.', 'company', '아시아나항공', null),
  ('힘든 상황에서도 끝까지 책임졌던 경험이 있나요?', 'experience', null, null)
) as v(content, category, airline, scheduled_date)
where not exists (select 1 from public.questions);

-- =============================================================================
-- 끝. 실행 후: 이후 슬라이스에서 sojae.html 의 저장/재개를 이 테이블에 연결한다.
--   다음 마이그레이션 예정: point_ledger + 서버권한 차감 RPC(문제당 1P).
-- =============================================================================
