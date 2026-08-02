-- 회원 보관(archive) — 2026-08-03
--
-- 왜 '삭제'가 아니라 '보관'인가.
--   members 행만 지우면 auth.users 의 로그인 계정이 남는다. handle_new_user 트리거는
--   `after insert on auth.users` 라 **첫 로그인 때 한 번만** 회원 행을 만든다 —
--   그 사람이 다시 로그인해도 프로필이 다시 안 생겨 사이트가 통째로 고장 난 상태가 된다.
--   되돌릴 방법도 관리자에게 없다. 그래서 '연락 안 되는 계정'은 지우는 대신 옆으로 치운다.
--
-- 이 컬럼이 하는 일은 admin 화면에서 안 보이게 하는 것뿐이다.
--   회원 본인 화면·로그인·크레딧·저장한 답변에는 아무 영향이 없다.
--   RLS 는 기존 members_admin_all(관리자 전체 관리) 이 그대로 덮으므로 새 정책이 필요 없다.

alter table public.members
  add column if not exists archived_at timestamptz;

comment on column public.members.archived_at is
  '보관 처리 시각(관리자 전용). null 이면 정상. admin 목록에서만 숨기고 회원 화면에는 영향이 없다.';

-- 목록은 늘 "보관 안 된 회원"을 최신 가입순으로 읽는다.
create index if not exists members_archived_created_idx
  on public.members (archived_at, created_at desc);
