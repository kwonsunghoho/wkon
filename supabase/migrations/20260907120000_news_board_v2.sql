-- =============================================================================
-- 항공 뉴스 게시판 + 회원 스크랩 — v2 재생성(2026-09-07 오너 "뉴스 스크랩 기능을 다시 사용하려고한다")
-- 스펙: docs/superpowers/specs/2026-09-07-news-scrap-v2-design.md
--
-- 2026-08-28 폐지 때 20260828130000_drop_news.sql 로 두 표를 드롭했다(오너 실행 완료 —
-- 2026-09-07 anon 프로브 PGRST205 실측). 이 파일은 같은 구조를 다시 만들고 summary 열만 더한다.
--
-- ⚠️ summary 는 언론사가 공유용으로 공개한 og:description 한두 문장(또는 네이버 검색 API 발췌문)
--    이다. 기사 본문을 긁어 넣지 말 것 — 저작권 경계다(스펙 3절). 사진(og:image)도 저장하지 않는다.
-- ⚠️ 기사는 90일 뒤 수집기가 지운다. 단 스크랩된 기사는 남긴다(cascade 로 회원 재료함이 날아간다).
--
-- 적용: Supabase SQL Editor 에서 이 파일 실행(이 레포는 자동 마이그레이션 없음).
-- 검증(실행 후): 시크릿 창에서
--   curl -s "https://apzwauiumhmsvrgffjis.supabase.co/rest/v1/news_articles?select=id&limit=1" \
--     -H "apikey: <anon key>"   →  200 []   (실행 전에는 404 PGRST205)
-- =============================================================================

create table if not exists public.news_articles (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  url          text not null unique,     -- 중복 수집 방지의 핵심
  source       text,                      -- 언론사명(og:site_name → 없으면 호스트명)
  summary      text,                      -- og:description ≤300자. 본문 금지(위 주석)
  published_at timestamptz,
  airline      text,                      -- 슬러그(kal/asiana/...), 미분류 null
  topic        text,                      -- 슬러그(recruit/route/biz/service/policy), 미분류 null
  created_at   timestamptz not null default now()
);

-- 구 v1 표가 남아 있는 환경(드롭을 안 한 경우) 대비 — 열만 더한다
alter table public.news_articles add column if not exists summary text;

comment on table public.news_articles is
  '항공 뉴스(네이버 뉴스 검색 API 자동수집). 제목+링크+요약(og:description)만 저장. 본문·사진 금지. 쓰기는 수집기(service role)만.';

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
  tag        text,                        -- 자유 입력 태그(단일)
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
