-- =============================================================================
-- 신청자 블랙리스트 (2026-08-24 오너 "신청자 중에 블랙리스트 체크할 수 있게, 우리만 알아볼 수 있게")
-- =============================================================================
-- 배경: 문제를 일으킨 신청자를 다음 신청 때 알아볼 방법이 없었다. admin 신청자 현황에서
--       [블랙 등록]을 누르면 여기 쌓이고, 같은 전화번호의 신청 행마다 '블랙' 라벨이 붙는다.
--       열쇠는 전화번호 숫자만 — 회원·비회원 신청을 같은 기준으로 맞춰 본다.
--
-- ⚠️ **관리자 전용이다 — 본인 포함 누구도 못 읽는다.** RLS 는 is_admin() 하나뿐.
--    authenticated·anon 에 select 를 열지 말 것 — 여는 순간 누구나 번호로
--    '내가(남이) 블랙인지'를 조회할 창구가 된다(전화번호 조회 창구 금지 원칙과 같은 이유).
-- ⚠️ 표시는 admin 화면뿐이다. 신청·결제를 막지 않는다(자동 차단은 오너가 시키면 그때 설계).
-- ⚠️ 사유(reason)는 개인정보·내부 판단이다 — 값 insert 를 레포에 커밋하지 않는다.
-- ⚠️ 오너가 Supabase SQL Editor 에서 실행해야 반영된다.
--    미적용 degrade: admin 이 PGRST205 를 '아직 안 켜짐'으로 삼키고 라벨 없이 그대로 돈다.
-- =============================================================================

create table if not exists public.blacklist (
  id         uuid primary key default gen_random_uuid(),
  -- 전화번호 숫자만(하이픈 제거) — admin 이 넣기 전에 정리해서 넣는다
  phone      text not null unique check (phone ~ '^[0-9]{8,15}$'),
  name       text,      -- 등록 시점 참고용 이름(신청서의 이름)
  reason     text,      -- 사유(선택) — 관리자만 본다
  created_at timestamptz not null default now()
);

comment on table public.blacklist is
  '신청자 블랙리스트(관리자 전용). 전화번호(숫자만) 열쇠 — admin 신청자 현황에만 표시, 신청·결제는 막지 않는다.';

-- is_admin() 은 20260703120000_membership_schema.sql 에서 만들었다
alter table public.blacklist enable row level security;

-- ⚠️ 정책이 하나도 없으면 아무도 못 읽는 것이 기본 — admin 정책 하나만 둔다.
drop policy if exists blacklist_admin on public.blacklist;
create policy blacklist_admin on public.blacklist
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
