-- ============================================================================
-- 후기 종류 분리 — 챌린지 후기 · 상담 후기 · 합격 수기 (2026-08-01)
-- ============================================================================
-- 오너 확정: 후기를 허브 + 종류별 목록으로 나눈다.
--   reviews.html(허브) · reviews-list.html?kind=(챌린지·상담) · stories/story.html(합격 수기)
--
-- 왜 표를 새로 안 만드나(챌린지·상담):
--   둘 다 '스크린샷 또는 짧은 글' 한 장짜리로 성격이 같다. 표를 나누면 admin·목록·
--   업로드가 두 벌이 되고, 나중에 종류를 옮기려면 행을 옮겨야 한다. 컬럼 하나로 가른다.
--
-- 왜 합격 수기는 표를 나누나:
--   긴 본문·제목·항공사·상세 페이지가 필요하다. reviews 에 넣으면 컬럼이 반쯤 비고,
--   image_path 중심으로 짜인 목록·라이트박스와 렌더가 아예 다르다.
--
-- ⚠️ 오너가 Supabase SQL Editor 에서 실행해야 반영된다.
-- ⚠️ 미적용 상태에서도 화면은 그대로 돈다: 목록은 select('*') 라 kind 가 없으면
--    전부 챌린지 후기로 취급하고, 합격 수기는 PGRST205(표 없음)를 빈 목록으로 삼킨다.
-- ============================================================================


-- ── 1. reviews 종류 컬럼 ────────────────────────────────────────────────────
-- 기존 108건은 default 로 자동 'challenge' 가 된다(백필 update 불필요).
alter table public.reviews
  add column if not exists kind text not null default 'challenge';

alter table public.reviews drop constraint if exists reviews_kind_chk;
alter table public.reviews add constraint reviews_kind_chk
  check (kind in ('challenge', 'consult'));

comment on column public.reviews.kind is
  'challenge=챌린지 후기(기본) / consult=상담 후기. 합격 수기는 이 표가 아니라 success_stories 다.';

create index if not exists reviews_kind_idx on public.reviews (kind, visible);


-- ── 2. 글만 있는 후기 허용 ──────────────────────────────────────────────────
-- 상담 후기는 캡처도 있고 텍스트로 정리된 것도 있다(오너 확인). 지금 admin 업로드는
-- 스토리지에 올린 뒤 image_path 를 넣는 경로뿐이라, 글만 있는 후기를 넣을 수 없다.
-- ⚠️ 둘 다 비어 있는 행은 화면에 그릴 게 없으므로 check 로 막는다
--    (목록 코드도 .filter(i => i.url || i.quote) 로 한 번 더 거른다).
alter table public.reviews alter column image_path drop not null;

alter table public.reviews drop constraint if exists reviews_body_required;
alter table public.reviews add constraint reviews_body_required
  check (image_path is not null or nullif(btrim(quote), '') is not null);


-- ── 3. 합격 수기 ────────────────────────────────────────────────────────────
-- body 는 평문(마크다운 아님) — 화면에서 빈 줄 기준으로 문단을 나눠 그린다.
-- 렌더러가 textContent 로 넣으므로 HTML 을 넣어도 태그로 해석되지 않는다(XSS 차단).
create table if not exists public.success_stories (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,
  author_name  text,                -- 표시용 이름. 비우면 화면에서 '익명'
  airline      text,                -- 합격 항공사(자유 입력 — 표를 따로 두지 않는다)
  cohort       smallint,            -- 참여 기수. NULL=미상
  thumb_path   text,                -- reviews 버킷의 대표 이미지 경로(선택)
  published_at date,
  visible      boolean not null default false,   -- ★ 기본 비공개. 검토 후 켠다
  sort_order   integer not null default 0,       -- 클수록 앞. 같으면 최신순
  created_at   timestamptz not null default now()
);

comment on table public.success_stories is
  '합격 수기(긴 글). stories.html 목록 · story.html?id= 상세. 짧은 한줄 후기는 reviews 로.';
comment on column public.success_stories.visible is
  '기본 false — 올린 즉시 공개되지 않는다. admin 에서 검토 후 켠다.';
comment on column public.success_stories.body is
  '평문. 빈 줄이 문단 구분. 화면은 textContent 로 그리므로 HTML 태그는 글자 그대로 보인다.';

create index if not exists success_stories_pub_idx
  on public.success_stories (visible, sort_order desc, published_at desc);

alter table public.success_stories enable row level security;

drop policy if exists success_stories_read_public on public.success_stories;
drop policy if exists success_stories_admin_all   on public.success_stories;

-- 공개된 수기는 비회원도 읽는다(챌린지 후기와 같은 기준 — 검색 유입이 목적).
create policy success_stories_read_public on public.success_stories
  for select to anon, authenticated
  using (visible);

create policy success_stories_admin_all on public.success_stories
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ============================================================================
-- 롤백
-- ============================================================================
-- drop table if exists public.success_stories;
-- alter table public.reviews drop constraint if exists reviews_body_required;
-- alter table public.reviews drop constraint if exists reviews_kind_chk;
-- alter table public.reviews drop column if exists kind;
-- (image_path 의 not null 은 되돌리지 않는다 — 글만 있는 행이 이미 들어갔을 수 있다)
