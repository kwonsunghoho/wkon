-- 랜딩 계측 이벤트 저장소 (2026-07-12)
--   창문 인트로의 첫 방문자 이탈률(히어로 #home 도달률)을 재기 위한 가벼운 비콘 테이블.
--   index.html이 첫 방문 세션에서 intro_view(로드) / hero_reached(#home 진입)를 insert.
--   러웨이(390/340) 축소 여부는 이 수치를 보고 논의한다 — 감으로 조정 금지.
--   is_admin() 은 기존 마이그레이션(20260703120000)에서 생성됨. 재사용.
--   ⚠️ 이 파일은 오너가 Supabase SQL 편집기에서 직접 실행해야 적용된다.
--     (미적용 상태여도 비콘 insert 실패는 조용히 무시되어 홈은 정상 동작)

create table if not exists public.page_events (
  id         bigint generated always as identity primary key,
  event      text not null,        -- 'intro_view' | 'hero_reached' (추후 이벤트 추가 가능)
  path       text not null default '/',
  meta       jsonb,                -- {viewport:'mobile'|'desktop'} 등 부가 정보
  created_at timestamptz not null default now()
);

-- 도달률 집계용 (event별 count)
create index if not exists idx_page_events_event_created
  on public.page_events (event, created_at);

alter table public.page_events enable row level security;

drop policy if exists page_events_insert_anon on public.page_events;
drop policy if exists page_events_admin_select on public.page_events;

-- 비콘은 anon 키로 insert만 — 읽기·수정·삭제는 관리자만 (개인정보 없음: 이벤트명·뷰포트 구분뿐)
create policy page_events_insert_anon on public.page_events
  for insert to anon, authenticated with check (true);
create policy page_events_admin_select on public.page_events
  for select to authenticated using (public.is_admin());

comment on table public.page_events is
  '랜딩 계측 비콘 — intro_view 대비 hero_reached 비율로 창문 인트로의 첫 방문자 히어로 도달률을 측정. index.html에서 첫 방문 세션만 기록.';
