-- 연구원 검수 건수 집계 — 2026-08-03
--
-- 왜 필요한가: 연구원 보수는 '몇 건을 검수했나'로 정산한다. 그런데 answer_sessions 에는
--   누가 잡았는지(reviewed_by)만 있고 **언제 결과를 냈는지**가 없어서, 기간별로 셀 수가 없었다.
--   updated_at 으로 대신 세면 학생이 나중에 글을 고쳐도 그 달로 옮겨가 숫자가 틀어진다.
--
-- ⚠️ 상태 전이 심판(ap_session_guard)은 건드리지 않는다. 돈이 걸린 판정이라 그 함수를 다시
--    쓰다가 한 줄이라도 어긋나면 유료 상품이 멈춘다. 도장만 찍는 트리거를 따로 단다.
--    이름이 answer_sessions_guard 뒤에 오도록(알파벳 순) 지어서 심판이 먼저 돌게 한다 —
--    심판이 막은 전이는 도장도 안 찍힌다.

alter table public.answer_sessions
  add column if not exists reviewed_at timestamptz;

comment on column public.answer_sessions.reviewed_at is
  '연구원이 검수 결과를 낸 시각(승인 또는 수정 요청). 보수 정산용 집계 기준.';

create or replace function public.ap_stamp_reviewed_at()
returns trigger
language plpgsql
as $$
begin
  -- 잡은 순간이 아니라 **결과를 낸 순간**에 찍는다. 다시 검수해 다시 결과를 내면 갱신한다.
  if new.state in ('approved', 'revision_requested')
     and old.state is distinct from new.state then
    new.reviewed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_ap_stamp_reviewed_at on public.answer_sessions;
create trigger trg_ap_stamp_reviewed_at
  before update on public.answer_sessions
  for each row execute function public.ap_stamp_reviewed_at();

create index if not exists answer_sessions_reviewed_idx
  on public.answer_sessions (reviewed_by, reviewed_at desc);
