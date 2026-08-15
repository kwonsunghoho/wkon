-- 커뮤니티 오픈채팅 설정 저장소 (2026-08-16)
--   오픈채팅 입장 주소·참여코드를 **로그인 회원에게만** 내려주는 표.
--   ⚠️ 값(insert)은 이 파일에 없다 — 레포가 공개라 주소를 커밋하면 게이트가 무의미해진다.
--     실제 값은 오너가 대화창으로 받은 SQL 을 콘솔에서 실행해 넣는다.
--   기존 site_config 를 안 쓰는 이유: select 정책이 anon 포함 전체 허용이라 비회원도 읽는다.
--   is_admin() / set_updated_at() 은 기존 마이그레이션(20260703120000)에서 생성됨. 재사용.
--   ⚠️ 이 파일은 오너가 Supabase SQL Editor 에서 직접 실행해야 적용된다.
--     (미적용 상태에서도 카드는 "아직 준비 중" 안내로 조용히 동작 — PGRST205 degrade)

create table if not exists public.community_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_community_config_updated on public.community_config;
create trigger trg_community_config_updated before update on public.community_config
  for each row execute function public.set_updated_at();

alter table public.community_config enable row level security;

drop policy if exists community_config_select_members on public.community_config;
drop policy if exists community_config_admin_all      on public.community_config;

-- ⚠️ anon 정책 없음 — 비로그인은 0건. '회원 전용'이 이 표의 존재 이유다. anon select 를 열지 말 것.
create policy community_config_select_members on public.community_config
  for select to authenticated using (true);
create policy community_config_admin_all on public.community_config
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

comment on table public.community_config is
  '커뮤니티 오픈채팅 설정(open_chat: {url, code}). 읽기는 로그인 회원만, 쓰기는 관리자만. 값은 콘솔에서 직접 insert — 레포 커밋 금지.';

-- =============================================================================
-- 적용 확인
-- =============================================================================
-- 1) 비회원 차단: anon apikey 로 GET /rest/v1/community_config?select=* → [] (0건, 200)
--    (표 미생성이면 404 PGRST205 — 그건 이 파일이 아직 안 돈 것)
-- 2) 회원 열람: 값 insert 후 라이브 카드(서가·뉴스·도구 허브 하단)에서
--    로그인 → '입장' → 참여코드·입장 링크 펼침 확인
-- =============================================================================

-- =============================================================================
-- 롤백
-- =============================================================================
-- drop table if exists public.community_config;
-- =============================================================================
