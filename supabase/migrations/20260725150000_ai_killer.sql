-- =============================================================================
-- MONC AI킬러 — 검사 기록 + 감점 표현 사전 (2026-07-25)
-- =============================================================================
-- 스펙: docs/superpowers/specs/2026-07-24-ai-killer-design.md (③단계)
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260703120000(members·is_admin·set_updated_at) · 20260705120000(answers)
--       · 20260725130000(credit_ledger — 차감 ref 가 ai_killer_checks.id 다)
--       · 20260725140000(answers 자유 글 — 무료분 근거)
--
-- ⚠️ 미적용이어도 사이트는 정상 — 브리핑룸 AI킬러 카드가 뜨지 않게 graceful degrade.
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- 1. ai_killer_checks — 검사 1건
-- =============================================================================
-- ⚠️ **id 는 중계 함수(ai-killer)가 만들어서 넣는다.** 확정본 서버 순서상 차감(3번)이
--    저장(7번)보다 먼저라, 차감할 때 이미 사용처 id 가 있어야 한다
--    (credit_ledger.ref = 이 id). 그래서 Edge Function 이 crypto.randomUUID() 로
--    먼저 만들고 → spend_credit(ref) → AI 호출 → 이 id 로 insert 하는 순서다.
--    default 는 남겨 두되(수동 검증용) 실제 경로에서는 서버가 지정한다.
--
-- ⚠️ **"답변에 결과를 붙여 저장"은 answers 에 컬럼을 더하는 게 아니라 answer_id 로 잇는다.**
--    한 답변을 고쳐가며 여러 번 검사하는 게 정상 사용이라 1:N 이어야 하고,
--    답변노트 화면은 그 답변의 **최신 검사 1건**만 조회해 배지로 보여준다.
create table if not exists public.ai_killer_checks (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  source      text not null check (source in ('paste','answer')),
  -- ⚠️ on delete set null — 학생이 답변노트 글을 지워도 검사 이력은 본인 것이라 남긴다.
  --    cascade 로 두면 글 하나 지울 때 그 글의 검사 기록이 통째로 날아간다.
  answer_id   uuid references public.answers(id) on delete set null,
  content     text not null,
  -- 지적 목록. [{n, kind, quote, why, fix, start, end}] — 화면이 밑줄과 카드를 그리는 원본.
  result      jsonb not null default '[]'::jsonb,
  -- 확정본 결정 5 — 100점 지수가 아니라 3단계. 100자당 밀도로 판정한다.
  grade       text not null check (grade in ('human','slight','heavy')),
  hit_count   int  not null default 0,
  -- 밀도 재현용. 임계값(⑤단계 연구진 검수에서 조정)이 바뀌어도 과거 등급을 다시 계산할 수 있다.
  char_count  int  not null default 0,
  -- 원가 실측 — 충전 가격(10회 9,900원)이 남는지 확인하는 근거.
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.ai_killer_checks is
  'AI킬러 검사 1건. answer_id 로 답변노트와 1:N 연결(같은 글을 고쳐가며 여러 번 검사).';
comment on column public.ai_killer_checks.grade is
  'human=사람 같음 / slight=조금 티남 / heavy=AI 티 많이 남. 100자당 밀도 기준(확정본 참조).';

create index if not exists ai_killer_checks_member_idx
  on public.ai_killer_checks (member_id, created_at desc);
-- 답변노트 배지 — "그 답변의 최신 검사 1건"을 뽑는 조회
create index if not exists ai_killer_checks_answer_idx
  on public.ai_killer_checks (answer_id, created_at desc) where answer_id is not null;

-- =============================================================================
-- 2. ai_killer_terms — 감점 표현 사전 (2단: 연구진 / 일반)
-- =============================================================================
-- ⚠️ **이 테이블이 이 도구의 유일한 자산이다.** 규칙 검사를 브라우저가 아니라 서버에
--    둔 이유가 바로 이것 — 목록이 공개되면 경쟁사가 그대로 베낀다(확정본 '왜 서버인가').
--    그래서 아래 RLS 는 **일반 회원에게 읽기를 열지 않는다.** 관리자와 service role 만.
create table if not exists public.ai_killer_terms (
  id          uuid primary key default gen_random_uuid(),
  term        text not null,
  -- 화면에 보여줄 지적 종류. 구체성(vague)은 사전이 아니라 판정 로직이라 여기 없다.
  kind        text not null check (kind in ('cliche','structure','context')),
  -- 사전 2단 — coach=연구진 감점 표현(오너 자료 1) / general=일반 AI 상투어
  origin      text not null default 'general' check (origin in ('coach','general')),
  -- 왜 별로인지 한 줄. 비어 있으면 중계 함수가 AI 에게 칸을 채우게 한다.
  why         text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.ai_killer_terms is
  'AI킬러 감점 표현 사전. ⚠️ 비공개 — 일반 회원은 읽을 수 없다(경쟁사 복제 방지).';

create unique index if not exists ai_killer_terms_uq on public.ai_killer_terms (term, kind);
create index if not exists ai_killer_terms_active_idx on public.ai_killer_terms (active) where active;

drop trigger if exists trg_ai_killer_terms_updated on public.ai_killer_terms;
create trigger trg_ai_killer_terms_updated before update on public.ai_killer_terms
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 3. RLS
-- =============================================================================
alter table public.ai_killer_checks enable row level security;
alter table public.ai_killer_terms  enable row level security;

drop policy if exists aik_checks_select_own on public.ai_killer_checks;
drop policy if exists aik_checks_admin_all  on public.ai_killer_checks;
drop policy if exists aik_terms_admin_all   on public.ai_killer_terms;

-- 검사 기록: 본인 읽기 + 관리자 전체.
-- ⚠️ **insert/update 정책을 만들지 않는다** — 쓰기는 service role(중계 함수)만.
--    회원 insert 를 열면 등급·걸린 수를 위조한 기록을 스스로 만들 수 있다.
create policy aik_checks_select_own on public.ai_killer_checks
  for select to authenticated using (member_id = auth.uid());
create policy aik_checks_admin_all on public.ai_killer_checks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 사전: 관리자만(읽기 포함). 중계 함수는 service role 이라 RLS 를 통과한다.
create policy aik_terms_admin_all on public.ai_killer_terms
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- 4. 일반 AI 상투어 시드 — ④단계가 오너 자료 없이 먼저 동작하게
-- =============================================================================
-- ⚠️ 전부 origin='general' 초안이다. 오너 자료 1(연구진 감점 표현)이 오면
--    origin='coach' 로 들어가고, 그쪽이 우선한다. why 문구는 ⑧단계 말투 조련에서
--    연구진 첨삭 문장으로 교체된다 — 지금 것은 자리 표시다.
-- ⚠️ 합격자 레퍼런스로 오탐을 걸러내기 전까지는 **멀쩡한 표현에 밑줄을 긋는 사고**가
--    난다. 규칙 기반 검사기가 망하는 건 못 잡아서가 아니라 그것 때문이다(확정본 결정 10).
insert into public.ai_killer_terms (term, kind, origin, why) values
  ('다양한 경험',        'cliche','general','무엇을 했는지가 하나도 안 남는 말이라, 면접관이 이어서 물어볼 게 없어요.'),
  ('많은 경험',          'cliche','general','"많은"이 숫자를 대신하지 못해요. 몇 번인지 적는 편이 훨씬 세게 들려요.'),
  ('이를 통해',          'cliche','general','원인과 결과를 뭉개는 연결어라, 정확히 무엇 덕분에 늘었는지가 사라져요.'),
  ('을 통해',            'cliche','general','원인과 결과를 뭉개는 연결어예요. 겪은 순서대로 풀어 쓰는 편이 좋아요.'),
  ('최선을 다하겠습니다','cliche','general','지원자 대부분이 쓰는 맺음말이라 마지막 인상이 남지 않아요.'),
  ('열심히 하겠습니다',  'cliche','general','각오만 있고 계획이 없어요. 무엇을 어떻게 할지가 빠졌어요.'),
  ('소중한 경험',        'cliche','general','경험을 평가하는 말일 뿐 내용이 없어요. 무엇이 남았는지를 쓰세요.'),
  ('밑거름이 되었습니다','cliche','general','자소서에서 너무 자주 쓰여 문장이 통째로 익숙하게 읽혀요.'),
  ('역량을 발휘',        'cliche','general','어떤 역량인지, 어떻게 발휘했는지가 없으면 빈 말로 들려요.'),
  ('책임감을 가지고',    'cliche','general','누구나 쓰는 말이라 변별이 안 돼요. 책임을 진 장면 하나가 낫습니다.'),
  ('열정을 가지고',      'cliche','general','열정은 말로 증명되지 않아요. 열정 때문에 치른 비용을 쓰세요.'),
  ('긍정적인 마인드',    'cliche','general','성격 설명은 면접관이 안 믿어요. 그 성격이 드러난 행동을 쓰세요.'),
  ('서비스 마인드',      'cliche','general','업계 용어를 쓴다고 준비된 사람으로 보이지 않아요. 장면으로 보여주세요.'),
  ('고객의 니즈',        'cliche','general','예시집에 그대로 실려 있는 표현이라 본인 목소리로 안 들려요.'),
  ('원활한 소통',        'cliche','general','"원활한"은 결과 평가일 뿐이에요. 어떻게 말을 걸었는지가 궁금해요.'),
  ('소통 능력',          'cliche','general','능력 이름을 붙이는 대신 대화 한 토막을 그대로 옮기는 게 세요.'),
  ('팀워크의 중요성',    'cliche','general','깨달음으로 끝나는 문장이에요. 그래서 다음에 뭘 다르게 했는지를 쓰세요.'),
  ('어릴 적부터',        'context','general','승무원 자소서에서 가장 흔한 도입이라 첫 문장부터 인상이 흐려져요.'),
  ('하늘을 동경',        'context','general','동경은 지원 동기가 못 돼요. 왜 지금 이 직무인지로 바꾸세요.'),
  ('항상 밝은 미소',     'context','general','면접장에서 증명되는 것이라 글로 주장하면 오히려 약해져요.'),
  ('귀사',               'context','general','회사 이름을 그대로 부르는 편이 준비한 사람처럼 읽혀요.'),
  ('위기를 기회로',      'cliche','general','관용구라 무슨 일이 있었는지가 전혀 안 남아요.'),
  ('첫째',               'structure','general','말할 때 이렇게 세는 사람은 없어서, 읽는 순간 외운 원고로 들려요.'),
  ('둘째',               'structure','general','나열은 글의 형식이지 말의 형식이 아니에요.'),
  ('셋째',               'structure','general','셋 중 가장 강한 하나만 남기고 그 장면을 길게 말하는 편이 좋아요.'),
  ('또한',               'structure','general','접속부사가 잦으면 문장이 기계적으로 이어 붙은 느낌이 나요.'),
  ('더불어',             'structure','general','문어체 접속부사예요. 말할 때 쓰지 않는 말은 빼는 게 좋아요.'),
  ('나아가',             'structure','general','글을 매끄럽게 하려는 장치인데, 말로 하면 어색하게 들려요.')
on conflict (term, kind) do nothing;

-- =============================================================================
-- 적용 확인 — 3행이 모두 true 면 정상
-- =============================================================================
-- select 'ai_killer_checks 테이블' as 항목,
--        to_regclass('public.ai_killer_checks') is not null as 적용됨
-- union all select 'ai_killer_terms 테이블',
--        to_regclass('public.ai_killer_terms') is not null
-- union all select '사전 시드(20건 이상)',
--        (select count(*) >= 20 from public.ai_killer_terms);
--
-- ⚠️ 사전은 관리자만 읽을 수 있다. 일반 계정으로 select 하면 0행이 나오는 게 정상이다
--    (에러가 아니라 RLS 가 걸러낸 것 — 이게 이 테이블의 존재 이유다).
-- =============================================================================
