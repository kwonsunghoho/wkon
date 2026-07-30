-- =============================================================================
-- 소재 발굴 v2 — BEI 5유형 + 소재 서랍 + playbook (2026-07-30)
-- =============================================================================
-- 스펙: docs/superpowers/specs/2026-07-30-sojae-v2-design.md
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260705120000(sojae_schema) · 20260703120000(is_admin) · 20260725170000(answers.category)
--
-- ⚠️ 이 파일에는 스키마만 있다. 교재 노하우(sojae_playbook 내용)와 문항 풀(questions 시드)은
--    공개 레포에 올리지 않는다 — 별도 SQL 로 대화창에서 전달해 콘솔에서 실행한다(확정 8).
-- 미적용 시 degrade: personal 문항 시드만 막히고, 카드 저장만 생략되고, 서버는
-- 내장 축소 프롬프트로 동작한다. 챌린지·결제·크레딧에는 영향 없음.
-- =============================================================================

-- ── 1. 유형 체크 확장: 4종 → 5종 (personal 신설) ────────────────────────────
-- 코드 4종(experience/values/judgment/company)은 유지, personal 만 추가.
-- 라벨은 화면(sojae-common.js)이 바꾼다 — DB 는 코드만 안다.
-- ⚠️ 제약 이름이 환경마다 다를 수 있어(자동 명명) 이름으로 지우지 않고
--    두 테이블의 category 체크 제약을 찾아서 지운 뒤 다시 단다.
do $$
declare r record;
begin
  for r in
    select con.conname, rel.relname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname in ('questions', 'answers')
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%category%'
  loop
    execute format('alter table public.%I drop constraint %I', r.relname, r.conname);
  end loop;
end $$;

alter table public.questions add constraint questions_category_check
  check (category in ('experience','values','judgment','company','personal'));

-- answers.category 는 nullable — NULL 은 체크를 통과한다(직접 쓴 답변의 '유형 미선택').
-- ⚠️ answers.category 컬럼 자체는 20260725170000 이 만든다. 미적용 환경이면 이 블록만 건너뛴다.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'answers' and column_name = 'category') then
    alter table public.answers add constraint answers_category_check
      check (category in ('experience','values','judgment','company','personal'));
  end if;
end $$;

comment on column public.questions.category is
  'experience(과거경험검증)/values(직무핵심역량)/judgment(상황대처)/company(기업관심도)/personal(개인신상). 교재 BEI 5유형. 되묻기 방식 분기에 사용.';

-- ── 2. sojae_materials (소재 서랍) ──────────────────────────────────────────
-- 다듬기가 자동 생성하는 소재 카드. 문제당 1카드 upsert(unique member+question).
-- ⚠️ 쓰기는 서버(service role)가 하지만, 학생이 서랍에서 직접 수정·삭제할 수 있어야
--    하므로 본인 CRUD 를 연다(답변 저장소와 같은 관습).
create table if not exists public.sojae_materials (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.members(id)   on delete cascade,
  question_id      uuid references public.questions(id)          on delete set null,
  title            text not null,                 -- 경험 한 줄 제목
  one_line         text,                          -- 요약 한 줄
  scene            text,                          -- 핵심 장면
  actions          text,                          -- 행동·판단
  competencies     jsonb not null default '[]'::jsonb,  -- 역량 태그(한국어 명칭 배열)
  reinterpretation text,                          -- 역량 재해석 문장
  status           text not null default 'active' check (status in ('active','archived')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.sojae_materials is
  '소재 서랍 — 다듬기(AI)가 자동 생성하는 소재 카드. 문제당 1카드 upsert. 학생이 수정·삭제 가능.';

-- 문제당 1카드. ⚠️ 부분 인덱스(where question_id is not null)로 두면 PostgREST upsert 의
-- ON CONFLICT (member_id, question_id) 가 인덱스를 못 찾아 카드 저장이 전부 실패한다
-- (2026-07-30 배포 검증에서 실측). 전체 유니크로 둔다 — question_id 가 NULL 인 행은
-- 기본 규칙(NULLS DISTINCT)상 여러 개 허용되므로 의도(문제 없는 카드 자유)도 그대로다.
drop index if exists sojae_materials_member_question_uq;
create unique index sojae_materials_member_question_uq
  on public.sojae_materials (member_id, question_id);

drop trigger if exists trg_sojae_materials_updated_at on public.sojae_materials;
create trigger trg_sojae_materials_updated_at
  before update on public.sojae_materials
  for each row execute function public.set_updated_at();

alter table public.sojae_materials enable row level security;
drop policy if exists sojae_materials_own       on public.sojae_materials;
drop policy if exists sojae_materials_admin_all on public.sojae_materials;
create policy sojae_materials_own on public.sojae_materials
  for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy sojae_materials_admin_all on public.sojae_materials
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── 3. sojae_playbook (연구진 노하우 — 비공개) ──────────────────────────────
-- 되묻기·다듬기 프롬프트 본문. 서버(sojae-chat, service role)가 매 요청 읽어 조립한다.
-- ⚠️ RLS: 일반 회원은 읽을 수 없다(ai_killer_terms 와 같은 이유 — 경쟁사 복제 방지).
--    관리자와 service role 만. 내용 수정은 SQL Editor 에서(재배포 불필요, 즉시 반영).
create table if not exists public.sojae_playbook (
  key        text primary key,     -- ask_core / ask_experience / ask_values / ask_judgment
                                   -- / ask_company / ask_personal / refine_core
                                   -- / competency_dict / cabin_knowledge
  content    text not null,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.sojae_playbook is
  '소재 발굴 프롬프트 원본(교재 노하우). ⚠️ 비공개 — 일반 회원 조회 불가. 내용은 레포에 없다(SQL 로 별도 시드).';

drop trigger if exists trg_sojae_playbook_updated_at on public.sojae_playbook;
create trigger trg_sojae_playbook_updated_at
  before update on public.sojae_playbook
  for each row execute function public.set_updated_at();

alter table public.sojae_playbook enable row level security;
drop policy if exists sojae_playbook_admin on public.sojae_playbook;
create policy sojae_playbook_admin on public.sojae_playbook
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- 끝. 다음 순서(오너): ① playbook 시드 SQL(대화창 전달) ② questions 문항 시드 SQL(대화창 전달)
--                    ③ sojae-chat 함수 재배포 ④ 프로브 확인
-- =============================================================================
