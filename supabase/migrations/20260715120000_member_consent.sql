-- =============================================================================
-- members.agreed_at / terms_version (약관·개인정보 동의 기록)
-- 목적: 로그인할 때마다 "만 14세 이상 + 약관·개인정보" 체크를 다시 받던 구조를
--       "가입 시 1회"로 바꾼다(2026-07-15 오너 피드백). OAuth 는 로그인 전에
--       사용자를 식별할 수 없으므로, 최초 로그인 직후 동의 게이트(login.html)에서
--       명시 동의를 받아 그 시각·약관 버전을 회원 행에 남긴다. 기록이 있으면
--       이후 어떤 기기·브라우저에서 로그인해도 다시 묻지 않는다.
-- 법적: 동의는 여전히 '명시적'이다(사전 체크·간주 동의 아님). 달라진 건 '언제 한 번'
--       받느냐이며, 오히려 동의 시각·약관 버전이 서버에 남아 입증이 가능해진다.
--       (지금까지는 체크박스가 클라이언트에만 있어 동의 기록이 아예 없었다.)
-- 적용: Supabase SQL Editor 에서 이 파일을 실행(이 레포는 자동 마이그레이션 없음).
--       실행 전에도 사이트는 동작한다 — 컬럼이 없으면 login.html 이 조회 실패를 감지해
--       localStorage(monc_consent_v1) 기기 기억으로 폴백하고, 나중에 컬럼이 생기면
--       hasConsented() 가 그 기록을 서버로 백필한다.
-- =============================================================================
alter table public.members add column if not exists agreed_at timestamptz;
alter table public.members add column if not exists terms_version text;

comment on column public.members.agreed_at is
  '이용약관·개인정보 수집·이용에 명시 동의한 시각(가입 시 1회). null = 미동의 → 로그인 시 동의 게이트로 보냄.';
comment on column public.members.terms_version is
  '동의 당시 약관 버전(supabase-config.js 의 TERMS_VERSION). 약관 개정 시 재동의 대상 판별에 사용.';

-- -----------------------------------------------------------------------------
-- delete_my_account() — 동의 거부 시 즉시 파기
-- 왜 필요한가: OAuth 로 로그인하는 순간 handle_new_user() 트리거가 members(이름·이메일) 행을
--   만든다. 즉 동의 게이트가 뜨는 시점엔 이미 개인정보가 서버에 있다. 여기서 사용자가
--   '동의하지 않고 나가기'(만 14세 미만 포함)를 누르면 그 개인정보를 남겨선 안 된다
--   (개인정보 보호법상 미동의 수집·아동 개인정보 보관). 로그아웃만으론 행이 남는다.
-- 동작: 호출자 본인(auth.uid())의 auth.users 행만 삭제. members.id 가
--   'references auth.users(id) on delete cascade' 이므로 members 와 그 하위(daily_records 등)까지
--   연쇄 삭제된다. anon 은 실행 불가(authenticated 에만 grant).
-- 미적용 시: login.html 이 RPC 실패를 감지해 members 의 name·email 을 즉시 null 로 비운다(차선).
-- -----------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = public, auth
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  '본인 계정 즉시 파기(auth.users 삭제 → members 연쇄 삭제). 동의 게이트 거부 시 login.html 이 호출.';
