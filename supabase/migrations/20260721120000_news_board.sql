-- =============================================================================
-- 항공 뉴스 게시판 + 회원 스크랩
-- 스펙: docs/superpowers/specs/2026-07-21-aviation-news-board-design.md
--   news_articles — 구글뉴스 RSS 자동수집(GitHub Actions, service role이 씀).
--                   제목+링크만 저장(본문 없음 — 저작권·용량 회피). 읽기는 누구나.
--   news_scraps   — 회원의 '면접 답변 재료함'. note = 활용 메모, tag = 자유 입력 분류.
--                   본인만 CRUD.
-- 적용: Supabase SQL Editor에서 이 파일 실행(이 레포는 자동 마이그레이션 없음).
-- 검증(실행 후):
--   1) 시크릿 창: curl -s "https://apzwauiumhmsvrgffjis.supabase.co/rest/v1/news_articles?select=id&limit=1" \
--        -H "apikey: <anon key>"  →  200 [] (읽기 공개)
--   2) 같은 anon key로 POST → 401/403 (쓰기 차단 = service role 전용)
-- =============================================================================

create table if not exists public.news_articles (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  url          text not null unique,     -- 중복 수집 방지의 핵심
  source       text,                      -- 언론사명
  published_at timestamptz,
  airline      text,                      -- 슬러그(kal/asiana/... 스펙 §2), 미분류 null
  topic        text,                      -- 슬러그(recruit/route/biz/service/policy), 미분류 null
  created_at   timestamptz not null default now()
);

comment on table public.news_articles is
  '항공 뉴스(구글뉴스 RSS 자동수집). 제목+링크만 저장. 쓰기는 수집기(service role)만.';

create index if not exists news_articles_published_idx on public.news_articles (published_at desc);
create index if not exists news_articles_airline_idx   on public.news_articles (airline);
create index if not exists news_articles_topic_idx     on public.news_articles (topic);

alter table public.news_articles enable row level security;

drop policy if exists news_articles_select_all on public.news_articles;

-- SELECT: 비회원 포함 공개(게시판은 유입 장치). INSERT/UPDATE/DELETE 정책 없음 = service role만.
create policy news_articles_select_all on public.news_articles
  for select to anon, authenticated using (true);

create table if not exists public.news_scraps (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id) on delete cascade,
  article_id uuid not null references public.news_articles(id) on delete cascade,
  note       text,                        -- 활용 메모("신규 취항 → 지원동기에 연결" 등)
  tag        text,                        -- 자유 입력 태그("지원동기 재료" 등, 단일 — 저사용 시 제거 가능한 실험 기능)
  created_at timestamptz not null default now(),
  unique (member_id, article_id)          -- 같은 기사 중복 스크랩 방지
);

comment on table public.news_scraps is
  '회원 뉴스 스크랩(면접 답변 재료함). note = 활용 메모, tag = 자유 입력 분류. RLS로 본인만.';

create index if not exists news_scraps_member_idx on public.news_scraps (member_id);

alter table public.news_scraps enable row level security;

drop policy if exists news_scraps_own on public.news_scraps;

-- 본인 것만 SELECT/INSERT/UPDATE(메모·태그 수정)/DELETE
create policy news_scraps_own on public.news_scraps
  for all to authenticated
  using (member_id = auth.uid())
  with check (member_id = auth.uid());
