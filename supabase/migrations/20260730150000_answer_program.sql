-- =============================================================================
-- MONC 매일 답변 프로그램 — 스키마 전체 (2026-07-30 · 브랜치 airline-interview-program-mvp)
-- =============================================================================
-- "매일 한 문제씩, 내 경험으로 완성하는 항공사 면접답변 프로그램"
-- 스펙: docs/monc-answer-program/product-spec.md · data-model.md
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행(전부 적용 완료): 20260703120000(members·is_admin·set_updated_at)
--   · 20260705120000(answers·questions) · 20260725140000(answers 자유 글)
--
-- 설계 핵심
--   1. **기출은 기존 questions 에 넣지 않는다** — 그 표의 RLS 는 로그인 회원 전체
--      읽기라 유료 기출이 무료로 샌다. interview_questions 는 비공개(RLS)이고
--      등록 회원에게는 ap_program_view() RPC 가 공개된 일차의 문제만 내보낸다.
--   2. **모든 버전은 answer_versions 에 append-only** — 학생 초안·AI 두 버전·연구원
--      수정·최종까지 한 세션 밑에 시간순으로 쌓인다(추후 학습 데이터의 원장).
--   3. **상태 전이는 DB 트리거가 심판**(errcode MC003) — 브라우저·중계 함수 어느
--      길로 와도 한 곳에서 막힌다(중복 신청 가드 MC002와 같은 방식).
--   4. **AI가 지어낸 사실은 저장 단계에서 걸러진다** — 중계 함수(answer-program)가
--      문장별 근거 ref 를 검증해 unsupported 플래그를 붙인다. DB 는 그 결과를
--      meta 에 그대로 보존한다(조용히 버리지 않는다).
--
-- ⚠️ 미적용이어도 사이트는 정상 — 신규 페이지가 PGRST205 를 감지해 '준비 중'으로
--    degrade 한다. 기존 테이블은 단 한 행도 건드리지 않는다(전부 신규 객체).
-- 롤백: 파일 맨 아래 주석 블록(신규 객체 drop 만으로 완전 복구).
-- =============================================================================

create extension if not exists pgcrypto;

-- set_updated_at 이 없는 환경 방어(기존과 동일 동작)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

-- KST 오늘 — 공개일 계산의 기준. UTC 로 두면 한국 오전 9시에 다음 문제가 열린다.
create or replace function public.ap_kst_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Seoul')::date;
$$;

-- =============================================================================
-- 1. researchers — 연구원 명단 + is_researcher()
-- =============================================================================
-- members.role 의 check('admin','member')를 건드리지 않고 역할을 하나 더 만든다.
-- 기존 role 체크 코드가 두 값을 전제하고 있어, 값 추가는 회귀 범위가 넓다.
create table if not exists public.researchers (
  member_id  uuid primary key references public.members(id) on delete cascade,
  active     boolean not null default true,
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.researchers is
  '연구원 명단. is_researcher() 의 근거. 관리자가 admin 탭에서 지정한다.';

create or replace function public.is_researcher()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.researchers
     where member_id = auth.uid() and active
  );
$$;

comment on function public.is_researcher() is
  '현재 유저가 연구원(또는 관리자)인지. RLS 재귀 방지 SECURITY DEFINER.';

-- 연구원은 검수 화면에서 학생 이름을 봐야 한다(누구의 글인지 모르면 검수가 안 된다).
-- ⚠️ RLS 는 행 단위라 이름만 여는 컬럼 제한은 불가 — 연구원은 내부 인력이라는 전제로 연다.
--    (privacy-and-consent.md 에 접근 권한으로 문서화. 연구원 지정은 admin 탭에서만.)
drop policy if exists members_select_researcher on public.members;
create policy members_select_researcher on public.members
  for select to authenticated using (public.is_researcher());

alter table public.researchers enable row level security;
drop policy if exists researchers_admin_all on public.researchers;
drop policy if exists researchers_select_own on public.researchers;
create policy researchers_admin_all on public.researchers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy researchers_select_own on public.researchers
  for select to authenticated using (member_id = auth.uid());

-- =============================================================================
-- 2. interview_questions — 항공사별 기출 은행 (유료 콘텐츠 · 비공개)
-- =============================================================================
-- ⚠️ RLS: 일반 회원은 직접 읽을 수 없다(ai_killer_terms 와 같은 '자산' 취급).
--    등록 회원에게는 ap_program_view() 가 **공개된 일차의 문제만** 내보낸다.
create table if not exists public.interview_questions (
  id          uuid primary key default gen_random_uuid(),
  airline     text,                              -- 코드(ke/lj/7c/tw/ze/yp/rf) 또는 null=공통
  stage       text,                              -- 전형(서류/1차/2차/임원 등 자유 표기)
  content     text not null,                     -- 질문 원문
  -- 질문 유형 10종 — 유형별 답변 구조가 다르다(전부 STAR 로 강제하지 않는 근거)
  qtype       text not null default 'experience' check (qtype in
              ('experience','values','motivation','mistake','weakness',
               'conflict','situation','company','job','opinion')),
  intent      text,                              -- 질문 의도(학생에게 보여준다)
  competencies jsonb not null default '[]'::jsonb, -- 핵심 평가 역량 ["침착함","우선순위 판단"]
  needed_facts jsonb not null default '[]'::jsonb, -- 답변에 필요한 사실 ["실제 한 행동","결과"]
  good_exp_types jsonb not null default '[]'::jsonb, -- 적합한 경험 유형 ["서비스 알바","팀 활동"]
  avoid       text,                              -- 피해야 할 접근
  common_mistakes text,                          -- 자주 나오는 실수
  cliche_watch text,                             -- 이 질문에서 특히 잦은 상투 표현
  structure_hint text,                           -- 권장 답변 구조(유형별 기본값을 덮을 때만)
  rec_len     text,                              -- 권장 분량(예: "400~600자")
  rec_seconds int,                               -- 예상 답변 시간(초)
  followups   jsonb not null default '[]'::jsonb, -- 예상 꼬리질문 ["그때 상대는 뭐라고 했나요?"]
  similar_qs  jsonb not null default '[]'::jsonb, -- 유사 질문 문장들
  difficulty  int check (difficulty between 1 and 5),
  -- 출처 신뢰도 — 기출은 제보 기반이라 확실성이 갈린다. 화면이 구분해 표시한다.
  source_confidence text not null default 'reported'
              check (source_confidence in ('verified','reported','estimated')),
  asked_at    text,                              -- 출제 시기(예: "2025 하반기")
  active      boolean not null default true,
  admin_memo  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.interview_questions is
  '항공사별 면접·자소서 기출 은행. ⚠️ 비공개(유료 콘텐츠) — 회원 서빙은 ap_program_view() RPC 만.';
comment on column public.interview_questions.qtype is
  '질문 유형 10종. 유형마다 권장 답변 구조가 다르다(program-common.js 의 QTYPES 가 화면 라벨·구조 원장).';

drop trigger if exists trg_interview_questions_updated on public.interview_questions;
create trigger trg_interview_questions_updated before update on public.interview_questions
  for each row execute function public.set_updated_at();

create index if not exists interview_questions_airline_idx
  on public.interview_questions (airline, active);

alter table public.interview_questions enable row level security;
drop policy if exists iq_admin_all on public.interview_questions;
drop policy if exists iq_researcher_select on public.interview_questions;
create policy iq_admin_all on public.interview_questions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy iq_researcher_select on public.interview_questions
  for select to authenticated using (public.is_researcher());

-- =============================================================================
-- 3. answer_programs — 항공사별 프로그램 상품
-- =============================================================================
create table if not exists public.answer_programs (
  id          uuid primary key default gen_random_uuid(),
  -- 코드(ke/…) 또는 **null=공통(항공사 무관)**. 1차 상품이 '필수 기출 30'(전 항공사
  -- 공통 — 2026-07-30 오너 확정 "항공사 세부는 지금 안 다룬다")이라 null 이 첫 프로그램이다.
  airline     text,
  title       text not null,                     -- 예: "제주항공 20일 답변 루틴"
  subtitle    text,
  description text,
  total_days  int not null default 20 check (total_days between 1 and 60),
  -- 공개 방식: daily=하루 한 문제(기본) / all=전체 공개 / by_date=일차별 지정 날짜
  reveal_policy text not null default 'daily' check (reveal_policy in ('daily','all','by_date')),
  -- ⚠️ null=지급 전용(관리자가 이용권을 넣는다) / >0=유료 판매(verify-payment 의
  --    programId 분기가 결제 검증 후 지급). **체험판·무료 자가 등록은 없다**(2026-07-30
  --    오너 "체험판 없이 바로 유료"). 0 은 판매 대상이 아니다 — 무료로 줘야 하면 admin 지급.
  price       int check (price is null or price >= 0),
  visible     boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.answer_programs is
  '매일 답변 프로그램 상품. airline null=공통(필수 기출). price null=지급 전용 / 양수=유료 판매(verify-payment programId 분기). 체험판 없음.';

drop trigger if exists trg_answer_programs_updated on public.answer_programs;
create trigger trg_answer_programs_updated before update on public.answer_programs
  for each row execute function public.set_updated_at();

alter table public.answer_programs enable row level security;
drop policy if exists ap_programs_public_select on public.answer_programs;
drop policy if exists ap_programs_admin_all on public.answer_programs;
-- 상품 소개는 마케팅 정보라 공개한다(기출 내용은 이 표에 없다)
create policy ap_programs_public_select on public.answer_programs
  for select to anon, authenticated using (visible = true);
create policy ap_programs_admin_all on public.answer_programs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- 4. answer_program_days — 일차별 질문 배치
-- =============================================================================
-- 같은 질문을 여러 프로그램에 재사용할 수 있다(질문은 은행, 배치는 여기).
create table if not exists public.answer_program_days (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.answer_programs(id) on delete cascade,
  day_no      int not null check (day_no between 1 and 60),
  -- 질문 삭제 시 배치가 남아 '문제 없는 일차'가 되지 않게 set null + 화면에서 경고
  question_id uuid references public.interview_questions(id) on delete set null,
  unlock_date date,                              -- reveal_policy='by_date' 일 때만 사용
  note        text,                              -- 일차 안내문(선택)
  created_at  timestamptz not null default now(),
  unique (program_id, day_no)
);

comment on table public.answer_program_days is
  '프로그램 일차 → 기출 배치. 회원 서빙은 ap_program_view() — 잠긴 일차의 문제는 서버가 안 내보낸다.';

alter table public.answer_program_days enable row level security;
drop policy if exists ap_days_admin_all on public.answer_program_days;
drop policy if exists ap_days_researcher_select on public.answer_program_days;
create policy ap_days_admin_all on public.answer_program_days
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy ap_days_researcher_select on public.answer_program_days
  for select to authenticated using (public.is_researcher());

-- =============================================================================
-- 5. program_enrollments — 이용권(등록)
-- =============================================================================
create table if not exists public.program_enrollments (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.answer_programs(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  started_at  date not null default public.ap_kst_today(),   -- 1일차의 기준일
  source      text not null default 'admin' check (source in ('admin','purchase','promo')),
  payment_id  text,                              -- 추후 포트원 결제 연동 자리(지금은 null)
  status      text not null default 'active' check (status in ('active','paused','expired','refunded')),
  created_at  timestamptz not null default now(),
  unique (program_id, member_id)
);

comment on table public.program_enrollments is
  '프로그램 이용권. started_at 이 공개일 계산의 기준(1일차). 생기는 길은 둘뿐 — 결제(verify-payment, source=purchase) 또는 admin 지급.';

create index if not exists program_enrollments_member_idx
  on public.program_enrollments (member_id, created_at desc);

alter table public.program_enrollments enable row level security;
drop policy if exists ap_enroll_select_own on public.program_enrollments;
drop policy if exists ap_enroll_researcher_select on public.program_enrollments;
drop policy if exists ap_enroll_admin_all on public.program_enrollments;
create policy ap_enroll_select_own on public.program_enrollments
  for select to authenticated using (member_id = auth.uid());
-- ⚠️ 회원 INSERT 정책이 **일부러 없다**(2026-07-30 오너 "체험판 없이 바로 유료").
--    이용권은 verify-payment(service role, 결제 검증 후)와 관리자만 만든다.
--    무료 자가 등록 정책을 되살리면 유료 상품이 공짜로 열린다.
create policy ap_enroll_researcher_select on public.program_enrollments
  for select to authenticated using (public.is_researcher());
create policy ap_enroll_admin_all on public.program_enrollments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- 6. experience_cards — 경험 창고 (학생별 경험 카드)
-- =============================================================================
-- 하나의 긴 자소서가 아니라 **경험별 카드**로 쪼갠다. 필수는 제목뿐 — 나머지는
-- 추가 질문(중계 함수)이 채워 간다. 빈칸이 많은 카드도 카드다.
create table if not exists public.experience_cards (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  title       text not null,                     -- 예: "카페 마감 알바에서 컴플레인 처리"
  exp_type    text,                              -- 알바/동아리/봉사/학업/직장/여행/기타(자유)
  period_text text,                              -- 시기(예: "2025년 여름")
  duration_text text,                            -- 기간(예: "8개월")
  place_type  text,                              -- 장소 유형(카페/병원/학교…)
  role        text,                              -- 당시 역할
  people      text,                              -- 함께한 사람
  situation   text,                              -- 시작 상황
  problem     text,                              -- 발생한 문제
  action      text,                              -- 학생이 실제로 한 행동
  action_reason text,                            -- 그 행동을 고른 이유
  alternatives text,                             -- 고려했던 다른 방법
  hardest     text,                              -- 가장 어려웠던 지점
  result      text,                              -- 실제 결과
  others_reaction text,                          -- 상대방의 실제 반응
  feeling     text,                              -- 느낀 점
  change_after text,                             -- 이후 바뀐 행동
  strengths   text,                              -- 학생이 생각하는 강점
  usable_qtypes jsonb not null default '[]'::jsonb, -- 활용 가능한 질문 유형 ["experience","conflict"]
  status      text not null default 'draft' check (status in
              ('draft','needs_check','verified_student','verified_researcher','archived')),
  has_pii     boolean not null default false,    -- 실명·매장명 등 직접 식별자 포함 여부(학생 표시)
  origin      text not null default 'student' check (origin in ('student','sojae','ai')),
  use_count   int not null default 0,            -- 답변에 쓰인 횟수(중복 사용 경고 근거)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.experience_cards is
  '학생별 경험 카드(경험 창고). 필수는 제목뿐 — 빈칸은 추가 질문이 채운다. origin=ai 는 AI 정리본(학생 확인 필요).';

drop trigger if exists trg_experience_cards_updated on public.experience_cards;
create trigger trg_experience_cards_updated before update on public.experience_cards
  for each row execute function public.set_updated_at();

create index if not exists experience_cards_member_idx
  on public.experience_cards (member_id, updated_at desc);

alter table public.experience_cards enable row level security;
drop policy if exists exp_cards_own on public.experience_cards;
drop policy if exists exp_cards_researcher_select on public.experience_cards;
drop policy if exists exp_cards_admin_all on public.experience_cards;
create policy exp_cards_own on public.experience_cards
  for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy exp_cards_researcher_select on public.experience_cards
  for select to authenticated using (public.is_researcher());
create policy exp_cards_admin_all on public.experience_cards
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- 7. experience_facts — 사실 단위 (경험 카드의 원자)
-- =============================================================================
-- ⚠️ 학생이 직접 말한 것과 AI 가 정리·추론한 것을 **행 단위로** 구분한다.
--    status='inferred' 인 사실은 최종 답변의 근거로 쓸 수 없다(중계 함수가 거른다).
create table if not exists public.experience_facts (
  id          uuid primary key default gen_random_uuid(),
  card_id     uuid not null references public.experience_cards(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  content     text not null,
  fact_type   text not null default 'other' check (fact_type in
              ('when','where','role','people','action','quote','reason','result','reaction','change','other')),
  source      text not null default 'student' check (source in ('student','voice','ai','followup')),
  status      text not null default 'user_stated' check (status in
              ('user_stated','user_confirmed','researcher_confirmed','inferred','disputed','rejected')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.experience_facts is
  '경험의 사실 단위. ⚠️ status=inferred(AI 추론)는 최종 답변 근거로 못 쓴다 — 추가 질문으로 확인해야 승격.';

drop trigger if exists trg_experience_facts_updated on public.experience_facts;
create trigger trg_experience_facts_updated before update on public.experience_facts
  for each row execute function public.set_updated_at();

create index if not exists experience_facts_card_idx
  on public.experience_facts (card_id, created_at);

alter table public.experience_facts enable row level security;
drop policy if exists exp_facts_own on public.experience_facts;
drop policy if exists exp_facts_researcher_select on public.experience_facts;
drop policy if exists exp_facts_admin_all on public.experience_facts;
create policy exp_facts_own on public.experience_facts
  for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy exp_facts_researcher_select on public.experience_facts
  for select to authenticated using (public.is_researcher());
create policy exp_facts_admin_all on public.experience_facts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- 8. member_tone_profiles — 말투 프로필 (회원당 1행, jsonb)
-- =============================================================================
create table if not exists public.member_tone_profiles (
  member_id  uuid primary key references public.members(id) on delete cascade,
  -- { endings:[], avoid_words:[], formality:1~5, emotion:1~5, target_seconds:60,
  --   liked:[문장], disliked:[문장] } — 화면·중계 함수가 같은 키를 쓴다
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.member_tone_profiles is
  '학생 말투 프로필. 목적은 복제가 아니라 "학생이 실제로 말할 수 있는 범위"의 유지.';

drop trigger if exists trg_member_tone_updated on public.member_tone_profiles;
create trigger trg_member_tone_updated before update on public.member_tone_profiles
  for each row execute function public.set_updated_at();

alter table public.member_tone_profiles enable row level security;
drop policy if exists tone_own on public.member_tone_profiles;
drop policy if exists tone_researcher_select on public.member_tone_profiles;
drop policy if exists tone_admin_all on public.member_tone_profiles;
create policy tone_own on public.member_tone_profiles
  for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy tone_researcher_select on public.member_tone_profiles
  for select to authenticated using (public.is_researcher());
create policy tone_admin_all on public.member_tone_profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- 9. member_consents — 목적별 동의 (서비스 동의와 별개)
-- =============================================================================
-- 서비스 이용 동의는 members.agreed_at(가입 시 1회). 여기는 **모델 개선(학습) 활용**
-- 같은 선택 동의만 담는다. 미동의 데이터도 서비스 제공에는 쓰이지만 학습 셋에서 빠진다.
create table if not exists public.member_consents (
  member_id  uuid not null references public.members(id) on delete cascade,
  kind       text not null check (kind in ('model_training')),
  granted    boolean not null default false,
  decided_at timestamptz not null default now(),
  primary key (member_id, kind)
);

comment on table public.member_consents is
  '선택 동의(모델 학습 활용 등). ⚠️ 사전 체크 금지 — 학생이 직접 켠 것만 granted=true.';

alter table public.member_consents enable row level security;
drop policy if exists consents_own on public.member_consents;
drop policy if exists consents_admin_select on public.member_consents;
create policy consents_own on public.member_consents
  for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy consents_admin_select on public.member_consents
  for select to authenticated using (public.is_admin());

-- =============================================================================
-- 10. answer_sessions — 하루 작성 세션 (상태 기계)
-- =============================================================================
create table if not exists public.answer_sessions (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.members(id) on delete cascade,
  program_id   uuid not null references public.answer_programs(id) on delete cascade,
  day_no       int not null,
  question_id  uuid references public.interview_questions(id) on delete set null,
  state        text not null default 'not_started' check (state in
               ('not_started','experience_selecting','fact_gathering','student_drafting',
                'ai_revised','student_editing','review_requested','researcher_reviewing',
                'revision_requested','approved','finalized')),
  selected_cards jsonb not null default '[]'::jsonb,  -- 고른 경험 카드 id 배열
  draft        text,                                  -- 자동 저장되는 학생 초안(현재본)
  -- 추가 질문 문답 [{q, a, at}] — a 는 "기억나지 않아요"도 유효한 답이다
  followup_qa  jsonb not null default '[]'::jsonb,
  chosen_version text check (chosen_version in ('ai_tone','ai_delivery')),
  answer_id    uuid references public.answers(id) on delete set null,  -- 확정 시 답변노트 행
  review_requested_at timestamptz,
  reviewed_by  uuid references public.members(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (member_id, program_id, day_no)
);

comment on table public.answer_sessions is
  '하루 한 문제 작성 세션. 상태 전이는 트리거(MC003)가 심판. 확정본은 answers 로 합류(answer_id).';

drop trigger if exists trg_answer_sessions_updated on public.answer_sessions;
create trigger trg_answer_sessions_updated before update on public.answer_sessions
  for each row execute function public.set_updated_at();

create index if not exists answer_sessions_member_idx
  on public.answer_sessions (member_id, program_id, day_no);
-- 연구원 검수 대기열 조회용
create index if not exists answer_sessions_review_idx
  on public.answer_sessions (state, review_requested_at)
  where state in ('review_requested','researcher_reviewing');

-- ── 상태 전이 심판 트리거 ────────────────────────────────────────────────────
-- 행위자: service(중계 함수·콘솔, auth.uid() 가 null) / admin / researcher / student.
-- ⚠️ 학생이 넘을 수 없는 선: AI 완료(ai_revised)로 스스로 점프, 승인(approved) 자가 부여.
create or replace function public.ap_session_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_actor text;
  v_prog  public.answer_programs%rowtype;
  v_enr   public.program_enrollments%rowtype;
  v_max   int;
  v_day   public.answer_program_days%rowtype;
  v_ok    boolean := false;
begin
  if v_uid is null then v_actor := 'service';
  elsif public.is_admin() then v_actor := 'admin';
  elsif public.is_researcher() then v_actor := 'researcher';
  else v_actor := 'student';
  end if;

  -- ── INSERT: 학생은 잠긴 일차에 세션을 만들 수 없다 ──────────────────────
  if tg_op = 'INSERT' then
    if v_actor in ('service','admin') then return new; end if;
    if new.state not in ('not_started','experience_selecting') then
      raise exception using errcode = 'MC003', message = 'bad_state_transition';
    end if;
    select * into v_prog from public.answer_programs where id = new.program_id;
    if v_prog is null then
      raise exception using errcode = 'MC005', message = 'not_enrolled';
    end if;
    select * into v_enr from public.program_enrollments
      where program_id = new.program_id and member_id = new.member_id and status = 'active';
    if v_enr is null then
      raise exception using errcode = 'MC005', message = 'not_enrolled';
    end if;
    if v_prog.reveal_policy = 'by_date' then
      select * into v_day from public.answer_program_days
        where program_id = new.program_id and day_no = new.day_no;
      if v_day is null or v_day.unlock_date is null or v_day.unlock_date > public.ap_kst_today() then
        raise exception using errcode = 'MC004', message = 'day_locked';
      end if;
    else
      v_max := case when v_prog.reveal_policy = 'all' then v_prog.total_days
                    else greatest(1, least(v_prog.total_days,
                         (public.ap_kst_today() - v_enr.started_at) + 1)) end;
      if new.day_no < 1 or new.day_no > v_max then
        raise exception using errcode = 'MC004', message = 'day_locked';
      end if;
    end if;
    return new;
  end if;

  -- ── UPDATE ──────────────────────────────────────────────────────────────
  -- 정체성 컬럼은 아무도 못 바꾼다(세션을 다른 사람·다른 날로 옮기는 길 차단)
  if new.member_id <> old.member_id or new.program_id <> old.program_id
     or new.day_no <> old.day_no then
    raise exception using errcode = 'MC003', message = 'bad_state_transition';
  end if;
  if new.state = old.state then return new; end if;   -- 상태 외 컬럼만 갱신(초안 저장 등)

  if v_actor in ('service','admin') then return new; end if;  -- 중계 함수·관리자는 자유

  if v_actor = 'student' then
    v_ok := (old.state, new.state) in (
      ('not_started','experience_selecting'),
      ('experience_selecting','fact_gathering'),
      ('experience_selecting','student_drafting'),
      ('fact_gathering','student_drafting'),
      ('fact_gathering','experience_selecting'),
      ('student_drafting','experience_selecting'),
      ('student_drafting','fact_gathering'),
      ('ai_revised','student_editing'),
      ('ai_revised','student_drafting'),
      ('student_editing','review_requested'),
      ('student_editing','finalized'),
      ('student_editing','student_drafting'),
      ('revision_requested','student_editing'),
      ('revision_requested','fact_gathering'),
      ('approved','finalized'),
      ('finalized','student_editing')          -- 확정 후 재수정(버전은 남는다)
    );
  elsif v_actor = 'researcher' then
    v_ok := (old.state, new.state) in (
      ('review_requested','researcher_reviewing'),
      ('researcher_reviewing','approved'),
      ('researcher_reviewing','revision_requested'),
      ('researcher_reviewing','review_requested')   -- 검수 반납(대기열 복귀)
    );
  end if;

  if not v_ok then
    raise exception using errcode = 'MC003', message = 'bad_state_transition';
  end if;
  if new.state = 'review_requested' and old.state <> 'review_requested' then
    new.review_requested_at := now();
  end if;
  if v_actor = 'researcher' and new.state = 'researcher_reviewing' then
    new.reviewed_by := v_uid;
  end if;
  return new;
end $$;

drop trigger if exists answer_sessions_guard on public.answer_sessions;
create trigger answer_sessions_guard
  before insert or update on public.answer_sessions
  for each row execute function public.ap_session_guard();

alter table public.answer_sessions enable row level security;
drop policy if exists ap_sessions_own on public.answer_sessions;
drop policy if exists ap_sessions_researcher on public.answer_sessions;
drop policy if exists ap_sessions_admin_all on public.answer_sessions;
create policy ap_sessions_own on public.answer_sessions
  for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());
-- 연구원: 조회 전체 + 갱신(트리거가 전이를 좁힌다). 삭제는 못 한다.
create policy ap_sessions_researcher on public.answer_sessions
  for select to authenticated using (public.is_researcher());
drop policy if exists ap_sessions_researcher_update on public.answer_sessions;
create policy ap_sessions_researcher_update on public.answer_sessions
  for update to authenticated
  using (public.is_researcher()) with check (public.is_researcher());
create policy ap_sessions_admin_all on public.answer_sessions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- 11. answer_versions — 모든 버전의 원장 (append-only)
-- =============================================================================
-- 학생 초안 → AI 사실 정리 → AI 두 버전 → 학생 수정 → 연구원 수정 → 말하기용 → 최종.
-- meta 에 문장별 근거(sentences[].evidence)·품질 지표·모델·프롬프트 버전이 실린다.
-- ⚠️ update/delete 정책이 없다(관리자 제외) — 원장은 고치지 않고 쌓는다.
create table if not exists public.answer_versions (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.answer_sessions(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  kind        text not null check (kind in
              ('student_draft','fact_summary','ai_tone','ai_delivery',
               'student_edit','researcher_edit','speaking','final')),
  content     text not null default '',
  -- { sentences:[{text, evidence:[{src:'fact'|'qa'|'draft'|'card', id, quote}], unsupported}],
  --   scores:{...7항목}, cliches:[], model, prompt_version, usage, codes:[{code,reason,quote}] }
  meta        jsonb not null default '{}'::jsonb,
  author      text not null check (author in ('student','ai','researcher')),
  author_id   uuid,                              -- 연구원 수정 시 연구원 uid
  created_at  timestamptz not null default now()
);

comment on table public.answer_versions is
  '답변 버전 원장(append-only). 학습 사례 1건 = 한 session_id 의 전 버전. 근거·수정코드는 meta 에.';

create index if not exists answer_versions_session_idx
  on public.answer_versions (session_id, created_at);

alter table public.answer_versions enable row level security;
drop policy if exists ap_versions_select_own on public.answer_versions;
drop policy if exists ap_versions_insert_student on public.answer_versions;
drop policy if exists ap_versions_researcher_select on public.answer_versions;
drop policy if exists ap_versions_insert_researcher on public.answer_versions;
drop policy if exists ap_versions_admin_all on public.answer_versions;
create policy ap_versions_select_own on public.answer_versions
  for select to authenticated using (member_id = auth.uid());
-- 학생은 자기 세션에 학생 종류만 쌓을 수 있다(AI·연구원 버전 위조 차단)
create policy ap_versions_insert_student on public.answer_versions
  for insert to authenticated
  with check (
    member_id = auth.uid() and author = 'student'
    and kind in ('student_draft','student_edit','final')
    and exists (select 1 from public.answer_sessions s
                 where s.id = session_id and s.member_id = auth.uid())
  );
create policy ap_versions_researcher_select on public.answer_versions
  for select to authenticated using (public.is_researcher());
create policy ap_versions_insert_researcher on public.answer_versions
  for insert to authenticated
  with check (public.is_researcher() and author = 'researcher' and kind = 'researcher_edit'
              and author_id = auth.uid());
create policy ap_versions_admin_all on public.answer_versions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- 12. correction_codes — 연구원 수정 코드 (관리자 편집 가능)
-- =============================================================================
create table if not exists public.correction_codes (
  code        text primary key,
  label       text not null,                     -- 화면 라벨(한국어)
  description text,
  category    text not null check (category in ('question','experience','sentence','speaking')),
  active      boolean not null default true,
  sort_order  int not null default 0
);

comment on table public.correction_codes is
  '연구원 첨삭 수정 코드. 학생 화면에도 라벨이 보인다(읽기 공개). 관리자가 추가·비활성.';

alter table public.correction_codes enable row level security;
drop policy if exists codes_select_auth on public.correction_codes;
drop policy if exists codes_admin_all on public.correction_codes;
create policy codes_select_auth on public.correction_codes
  for select to authenticated using (active);
create policy codes_admin_all on public.correction_codes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.correction_codes (code, label, category, sort_order, description) values
  -- 질문 관련
  ('QUESTION_INTENT_MISMATCH','질문 의도와 어긋남','question',10,'질문이 묻는 것과 다른 이야기를 하고 있다'),
  ('ANSWER_NOT_CLEAR','답이 분명하지 않음','question',11,'무엇을 답했는지 한 문장으로 안 잡힌다'),
  ('QUESTION_NOT_ANSWERED','질문에 답하지 않음','question',12,'질문의 핵심 요구가 빠졌다'),
  ('AIRLINE_CONNECTION_WEAK','항공사 연결 약함','question',13,'이 항공사여야 하는 이유가 없다'),
  ('AIRLINE_CONNECTION_FORCED','항공사 연결 억지','question',14,'경험과 회사 가치를 무리하게 붙였다'),
  ('JOB_CONNECTION_EXCESSIVE','직무 연결 과잉','question',15,'모든 문장을 승무원으로 끝맺는다'),
  -- 경험 관련
  ('EXPERIENCE_TOO_ABSTRACT','경험이 추상적','experience',20,'장면이 없고 주장만 있다'),
  ('SITUATION_MISSING','상황 누락','experience',21,'언제 어디서였는지가 없다'),
  ('OWN_ACTION_MISSING','본인 행동 누락','experience',22,'팀이 한 일만 있고 본인이 한 일이 없다'),
  ('JUDGMENT_MISSING','판단 이유 누락','experience',23,'왜 그렇게 했는지가 없다'),
  ('RESULT_EXAGGERATED','결과 과장','experience',24,'행동 대비 결과가 부풀려졌다'),
  ('FACT_UNCLEAR','사실 불명확','experience',25,'확인되지 않은 내용이 사실처럼 쓰였다'),
  ('EXPERIENCE_DUPLICATED','경험 중복 사용','experience',26,'다른 답변과 같은 경험을 또 썼다'),
  ('FOLLOWUP_RISK','꼬리질문 위험','experience',27,'파고들면 무너질 서술이 있다'),
  ('FACT_CONFLICT','사실 충돌','experience',28,'다른 답변·경험 카드와 내용이 어긋난다'),
  -- 문장 관련
  ('OPENING_WEAK','첫 문장 약함','sentence',30,'첫 문장이 답을 말하지 않는다'),
  ('SENTENCE_TOO_LONG','문장이 너무 긺','sentence',31,'한 호흡에 말할 수 없는 길이다'),
  ('REPETITIVE_EXPRESSION','표현 반복','sentence',32,'같은 단어·어미가 반복된다'),
  ('CLICHE_EXPRESSION','상투 표현','sentence',33,'감점 사전에 있는 상투 표현이다'),
  ('UNNATURAL_WORDING','부자연스러운 표현','sentence',34,'실제로 이렇게 말하는 사람이 없다'),
  ('TONE_MISMATCH','말투 불일치','sentence',35,'학생의 평소 말투와 동떨어졌다'),
  ('WRITTEN_LANGUAGE_STYLE','문어체','sentence',36,'글말이라 소리 내면 어색하다'),
  ('EMOTION_EXCESSIVE','감정 과잉','sentence',37,'감정 표현이 사실을 덮는다'),
  ('TOO_PERFECT','너무 완벽함','sentence',38,'사람 말 같지 않게 매끈하다'),
  ('UNNECESSARY_CONCLUSION','불필요한 맺음','sentence',39,'교훈·포부 맺음이 답을 흐린다'),
  -- 말하기 관련
  ('ANSWER_TOO_LONG','답변이 너무 긺','speaking',40,'권장 시간을 크게 넘는다'),
  ('BREATHING_DIFFICULT','호흡이 어려움','speaking',41,'끊어 읽을 자리가 없다'),
  ('KEY_POINT_BURIED','핵심이 묻힘','speaking',42,'핵심이 답변 뒤쪽에 숨었다'),
  ('COMPLEX_ORDER','순서가 복잡','speaking',43,'말하는 순서가 꼬여 따라가기 어렵다'),
  ('HARD_TO_MEMORIZE','외우기 어려움','speaking',44,'구조가 없어 기억이 안 된다'),
  ('LOW_SPEAKING_PERSUASION','말 설득력 낮음','speaking',45,'글로는 되는데 말로는 힘이 없다')
on conflict (code) do nothing;

-- =============================================================================
-- 13. RPC — ap_program_view(): 등록 확인 + 공개일 계산 + 열린 일차의 문제만 반환
-- =============================================================================
-- ⚠️ 이 함수가 기출 서빙의 **유일한** 회원 통로다. 잠긴 일차의 질문 내용은 아예
--    응답에 실리지 않는다(화면 잠금이 아니라 서버 잠금).
create or replace function public.ap_unlocked_max(p_policy text, p_total int, p_started date)
returns int language sql stable as $$
  select case p_policy
    when 'all'   then p_total
    when 'daily' then greatest(1, least(p_total, (public.ap_kst_today() - p_started) + 1))
    else 0   -- by_date 는 일차별 unlock_date 로 판정
  end;
$$;

create or replace function public.ap_program_view(p_program_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_prog  public.answer_programs%rowtype;
  v_enr   public.program_enrollments%rowtype;
  v_staff boolean := false;
  v_max   int := 0;
  v_days  jsonb;
begin
  select * into v_prog from public.answer_programs where id = p_program_id;
  if v_prog.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_uid is not null then
    v_staff := public.is_admin() or public.is_researcher();
    select * into v_enr from public.program_enrollments
      where program_id = p_program_id and member_id = v_uid and status = 'active';
  end if;

  if not (v_prog.visible or v_staff or v_enr.id is not null) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_staff then
    v_max := v_prog.total_days;
  elsif v_enr.id is not null then
    v_max := public.ap_unlocked_max(v_prog.reveal_policy, v_prog.total_days, v_enr.started_at);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'day_no', t.day_no,
           'unlocked', t.unlocked,
           'note', t.note,
           'has_question', t.question_id is not null,
           'session', t.session,
           'question', t.question
         ) order by t.day_no), '[]'::jsonb)
    into v_days
  from (
    select d.day_no, d.note, d.question_id,
      case
        when v_staff then true
        when v_enr.id is null then false
        when v_prog.reveal_policy = 'by_date'
          then (d.unlock_date is not null and d.unlock_date <= public.ap_kst_today())
        else d.day_no <= v_max
      end as unlocked,
      (select jsonb_build_object('id', s.id, 'state', s.state,
                                 'answer_id', s.answer_id, 'updated_at', s.updated_at)
         from public.answer_sessions s
        where s.program_id = p_program_id and s.day_no = d.day_no and s.member_id = v_uid
      ) as session,
      case when (v_staff or (v_enr.id is not null and (
                  case when v_prog.reveal_policy = 'by_date'
                       then (d.unlock_date is not null and d.unlock_date <= public.ap_kst_today())
                       else d.day_no <= v_max end)))
                and d.question_id is not null then
        (select jsonb_build_object(
            'id', q.id, 'content', q.content, 'qtype', q.qtype, 'stage', q.stage,
            'intent', q.intent, 'competencies', q.competencies, 'needed_facts', q.needed_facts,
            'good_exp_types', q.good_exp_types, 'avoid', q.avoid,
            'common_mistakes', q.common_mistakes, 'cliche_watch', q.cliche_watch,
            'structure_hint', q.structure_hint, 'rec_len', q.rec_len,
            'rec_seconds', q.rec_seconds, 'followups', q.followups,
            'source_confidence', q.source_confidence, 'asked_at', q.asked_at)
           from public.interview_questions q
          where q.id = d.question_id and q.active)
      else null end as question
    from public.answer_program_days d
    where d.program_id = p_program_id
  ) t;

  return jsonb_build_object(
    'ok', true,
    'program', jsonb_build_object(
      'id', v_prog.id, 'airline', v_prog.airline, 'title', v_prog.title,
      'subtitle', v_prog.subtitle, 'description', v_prog.description,
      'total_days', v_prog.total_days, 'reveal_policy', v_prog.reveal_policy,
      'price', v_prog.price),
    'enrolled', v_enr.id is not null,
    'staff', v_staff,
    'started_at', v_enr.started_at,
    'unlocked_max', v_max,
    'days', v_days
  );
end $$;

comment on function public.ap_program_view(uuid) is
  '프로그램 대시보드 한 번에: 등록 여부 + 공개일 계산 + 열린 일차의 기출만. 잠긴 문제는 응답에 없다.';

revoke all on function public.ap_kst_today() from public;
revoke all on function public.ap_unlocked_max(text, int, date) from public;
revoke all on function public.ap_program_view(uuid) from public;
grant execute on function public.ap_kst_today() to anon, authenticated;
grant execute on function public.ap_unlocked_max(text, int, date) to anon, authenticated;
grant execute on function public.ap_program_view(uuid) to anon, authenticated;
grant execute on function public.is_researcher() to authenticated;

-- =============================================================================
-- 적용 확인 — 전부 true 면 정상
-- =============================================================================
-- select 'interview_questions' as 항목, to_regclass('public.interview_questions') is not null as 적용됨
-- union all select 'answer_programs',      to_regclass('public.answer_programs') is not null
-- union all select 'answer_program_days',  to_regclass('public.answer_program_days') is not null
-- union all select 'program_enrollments',  to_regclass('public.program_enrollments') is not null
-- union all select 'experience_cards',     to_regclass('public.experience_cards') is not null
-- union all select 'experience_facts',     to_regclass('public.experience_facts') is not null
-- union all select 'answer_sessions',      to_regclass('public.answer_sessions') is not null
-- union all select 'answer_versions',      to_regclass('public.answer_versions') is not null
-- union all select 'correction_codes 시드', (select count(*) >= 31 from public.correction_codes)
-- union all select 'ap_program_view RPC',  to_regprocedure('public.ap_program_view(uuid)') is not null
-- union all select 'is_researcher()',      to_regprocedure('public.is_researcher()') is not null;

-- =============================================================================
-- 롤백(전체 되돌리기) — 신규 객체만 지우므로 기존 데이터 무영향
-- =============================================================================
-- drop function if exists public.ap_program_view(uuid);
-- drop function if exists public.ap_unlocked_max(text, int, date);
-- drop table if exists public.answer_versions;
-- drop table if exists public.answer_sessions;
-- drop function if exists public.ap_session_guard();
-- drop table if exists public.correction_codes;
-- drop table if exists public.member_consents;
-- drop table if exists public.member_tone_profiles;
-- drop table if exists public.experience_facts;
-- drop table if exists public.experience_cards;
-- drop table if exists public.program_enrollments;
-- drop table if exists public.answer_program_days;
-- drop table if exists public.answer_programs;
-- drop table if exists public.interview_questions;
-- drop function if exists public.is_researcher();
-- drop table if exists public.researchers;
-- drop function if exists public.ap_kst_today();
-- =============================================================================
