-- =============================================================================
-- MONC 답변노트 — 수정 이력 (2026-08-05)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260705120000(answers) · 20260725140000(answers 자유 글)
--
-- 왜 필요한가 ─────────────────────────────────────────────────────────────────
--   오너 지시(2026-08-05): "수정한 답변들은 휘발되는 게 아니라 수정 히스토리를 남겨서
--   언제든 다시 볼 수 있도록." 지금은 answers.content 를 덮어쓰면 이전 글이 사라진다.
--
-- ⚠️ 왜 트리거인가 — 본문을 고치는 곳이 **네 군데**다.
--      ① 소재 발굴 저장(sojae.html)  ② AI킬러 '고친 답변 저장'(ai-killer 함수)
--      ③ 첨삭 반영(ai-killer 함수 polish)  ④ 답변 프로그램 확정본(program-common.js)
--    ②③ 은 서버 함수가 service role 로 직접 update 한다 — 브라우저 코드에 스냅샷을
--    심는 방식으로는 못 잡는다. 한 곳(트리거)에서 남겨야 빠지는 경로가 없다.
--
-- ⚠️ 미적용이어도 사이트는 정상 — 조회가 조용히 실패하고 '수정 이력' 접이만 안 뜬다
--    (answers.html 이 ai_killer_checks·answer_polishes 에 쓰는 방어와 같은 규칙).
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- =============================================================================
-- 1. answer_revisions — 덮어쓰기 직전 본문의 스냅샷
-- =============================================================================
-- member_id 를 직접 들고 있어 RLS 를 단순화한다(answers 조인 없이 본인 확인).
-- discovery_messages 와 같은 관례.
create table if not exists public.answer_revisions (
  id          uuid primary key default gen_random_uuid(),
  answer_id   uuid not null references public.answers(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  content     text not null,
  created_at  timestamptz not null default now()
);

comment on table public.answer_revisions is
  '답변 본문을 덮어쓰기 직전의 스냅샷. answers UPDATE 트리거가 남긴다(사람이 INSERT 하지 않는다).';
comment on column public.answer_revisions.content is
  '바뀌기 **전**의 본문. 즉 이 행의 시각은 "이때까지 이 글이었다"는 뜻이다.';

-- 목록은 답변별 최신순 — 화면이 그렇게만 읽는다.
create index if not exists answer_revisions_answer_idx
  on public.answer_revisions (answer_id, created_at desc);

-- =============================================================================
-- 2. 스냅샷 트리거
-- =============================================================================
-- ⚠️ 10분 묶기 — 소재 발굴은 **0.8초 디바운스로 자동 저장**한다(sojae.html finalTa).
--    묶지 않으면 한 번 고쳐 쓰는 동안 이력이 수백 개로 불어나 목록이 못 쓰게 된다.
--    마지막 이력이 10분 이내면 남기지 않으므로, 결과적으로 남는 것은
--    **"고치기 시작하기 직전의 원본"** 한 벌이다 — 학생이 되짚고 싶은 것도 그것이다.
-- ⚠️ 답변당 20개 상한 — 오래 쓰는 답변 하나가 테이블을 무한정 키우지 않게.
create or replace function public.snapshot_answer_revision()
returns trigger
language plpgsql
security definer                 -- RLS 를 지나 INSERT 한다(회원에게 INSERT 정책을 주지 않으려고)
set search_path = public
as $$
declare
  last_at timestamptz;
begin
  -- 본문이 그대로면 남길 것이 없다(제목·분류만 고친 경우 포함).
  if new.content is not distinct from old.content then
    return new;
  end if;
  -- 빈 글에서 처음 써 넣은 것은 '수정'이 아니라 '작성'이다.
  if nullif(btrim(coalesce(old.content, '')), '') is null then
    return new;
  end if;

  select max(created_at) into last_at
    from public.answer_revisions where answer_id = old.id;
  if last_at is not null and last_at > now() - interval '10 minutes' then
    return new;
  end if;

  insert into public.answer_revisions (answer_id, member_id, content)
  values (old.id, old.member_id, old.content);

  delete from public.answer_revisions r
   where r.answer_id = old.id
     and r.id not in (
       select id from public.answer_revisions
        where answer_id = old.id
        order by created_at desc
        limit 20
     );

  return new;
end $$;

comment on function public.snapshot_answer_revision() is
  'answers 본문이 바뀔 때 이전 본문을 answer_revisions 에 남긴다. 10분 묶기 + 답변당 20개 상한.';

drop trigger if exists trg_answers_revision on public.answers;
create trigger trg_answers_revision
  before update on public.answers
  for each row execute function public.snapshot_answer_revision();

-- =============================================================================
-- 3. RLS — 본인 읽기·지우기만. INSERT 정책은 일부러 없다(트리거만 쓴다).
-- =============================================================================
alter table public.answer_revisions enable row level security;

drop policy if exists answer_revisions_own       on public.answer_revisions;
drop policy if exists answer_revisions_own_del   on public.answer_revisions;
drop policy if exists answer_revisions_admin_all on public.answer_revisions;

create policy answer_revisions_own on public.answer_revisions
  for select to authenticated using (member_id = auth.uid());
create policy answer_revisions_own_del on public.answer_revisions
  for delete to authenticated using (member_id = auth.uid());
create policy answer_revisions_admin_all on public.answer_revisions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- 적용 확인 — 2행이 모두 true 면 정상
-- =============================================================================
-- select 'answer_revisions 테이블' as 항목,
--        exists (select 1 from information_schema.tables
--                 where table_schema='public' and table_name='answer_revisions') as 적용됨
-- union all select '스냅샷 트리거',
--        exists (select 1 from pg_trigger where tgname='trg_answers_revision');
-- =============================================================================
