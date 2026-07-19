-- =============================================================================
-- MONC 소재 발굴 — answers_history (답변 수정 이력 자동 보관)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. (재실행 안전)
-- 선행: 20260705120000(answers) — status 컬럼(20260706120000)은 미적용이어도
--       아래에서 같은 방식으로 보강하므로 순서 무관.
--
-- 목적: answers 는 문제당 1행 upsert 라 회원이 답변을 고치면 이전 버전이 사라진다.
--       이 마이그레이션 후에는 내용이 바뀌는 UPDATE 마다 직전 버전이 자동으로
--       answers_history 에 남는다(성장 추적·연구 원천 데이터 — 오너 확정 2026-07-19).
--       클라이언트 코드 변경 불필요 — DB 트리거가 전부 처리한다.
--
-- 개인정보: member_id 가 members 를 cascade 참조하므로 회원 탈퇴(delete_my_account)
--       시 이력도 함께 파기된다. 조회는 관리자만(RLS) — 회원 화면에는 노출하지 않는다.
-- =============================================================================

-- 0) answers.status 보강(20260706120000 과 동일 — 미적용 프로젝트에서 트리거가 깨지지 않게)
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

-- 1) 이력 테이블
create table if not exists public.answers_history (
  id           bigint generated always as identity primary key,
  answer_id    uuid not null,   -- answers.id (FK 없음 — 원본 행 식별용 값만 보관)
  member_id    uuid not null references public.members(id) on delete cascade,
  question_id  uuid not null,
  content      text not null,
  status       text,
  saved_at     timestamptz,     -- 그 버전이 저장돼 있던 시각(= 덮어쓰기 직전 updated_at)
  archived_at  timestamptz not null default now()
);

comment on table public.answers_history is
  '답변집 수정 이력. answers UPDATE 시 트리거가 직전 버전을 자동 보관. 관리자 조회 전용, 회원 탈퇴 시 cascade 파기.';

create index if not exists answers_history_member_q_idx
  on public.answers_history (member_id, question_id, archived_at desc);

-- 2) 보관 트리거 — 내용·상태가 실제로 바뀔 때만(동일 내용 재저장은 기록하지 않음)
create or replace function public.archive_answer_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.content is distinct from new.content
     or old.status is distinct from new.status then
    insert into public.answers_history (answer_id, member_id, question_id, content, status, saved_at)
    values (old.id, old.member_id, old.question_id, old.content, old.status, old.updated_at);
  end if;
  return new;
end $$;

comment on function public.archive_answer_version() is
  'answers BEFORE UPDATE: 직전 버전을 answers_history 에 보관(security definer — RLS 우회 insert).';

drop trigger if exists trg_answers_archive_version on public.answers;
create trigger trg_answers_archive_version
  before update on public.answers
  for each row execute function public.archive_answer_version();

-- 3) RLS — 조회는 관리자만, 쓰기는 정책 없음(트리거만 쓴다)
alter table public.answers_history enable row level security;

drop policy if exists ans_hist_admin_select on public.answers_history;
create policy ans_hist_admin_select on public.answers_history
  for select to authenticated using (public.is_admin());
