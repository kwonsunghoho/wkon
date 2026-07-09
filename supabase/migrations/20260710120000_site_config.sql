-- 홈 커뮤니티 섹션 설정 저장소 (2026-07-10)
--   index.html #community 섹션의 집계 지표·롤링 문구·후기 카드를
--   관리자 페이지(admin.html '홈 커뮤니티' 탭)에서 수정할 수 있게 하는 key-value 테이블.
--   value 는 jsonb — 키별 형태는 하단 seed 참고.
--   is_admin() / set_updated_at() 은 기존 마이그레이션(20260703120000)에서 생성됨. 재사용.
--   ⚠️ 이 파일은 오너가 Supabase SQL 편집기에서 직접 실행해야 적용된다.
--     (미적용 상태여도 홈은 index.html의 하드코딩 기본값으로 정상 동작)

create table if not exists public.site_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_site_config_updated on public.site_config;
create trigger trg_site_config_updated before update on public.site_config
  for each row execute function public.set_updated_at();

alter table public.site_config enable row level security;

drop policy if exists site_config_select_all on public.site_config;
drop policy if exists site_config_admin_all  on public.site_config;

-- 홈은 anon 키로 읽으므로 모두 읽기 허용, 쓰기는 관리자만
create policy site_config_select_all on public.site_config
  for select to anon, authenticated using (true);
create policy site_config_admin_all on public.site_config
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 초기값 — 이미 값이 있으면 덮어쓰지 않음
insert into public.site_config (key, value) values
  ('community_stats',   '{"participants":190,"completionRate":90,"verifications":165}'),
  ('community_phrases', '["매일 하니까 습관이 잡혔어요","피드백이 구체적이라 도움됐어요","혼자였으면 못 했을 거예요"]'),
  ('community_reviews', '[
    {"name":"김O연","tag":"영합각","quote":"세 번 하고 나니까 카메라 앞에서 덜 떨려요.","captureUrl":""},
    {"name":"이O수","tag":"보신각","quote":"말끝이 흔들리는 습관이 있었는데 잡혔어요.","captureUrl":""},
    {"name":"최O진","tag":"스피닝","quote":"매일 하니까 말투가 확실히 달라졌어요.","captureUrl":""}
  ]')
on conflict (key) do nothing;

comment on table public.site_config is
  '홈(index.html) 커뮤니티 섹션 설정 — community_stats(집계 지표) / community_phrases(롤링 문구) / community_reviews(후기 카드). admin.html 홈 커뮤니티 탭에서 수정.';
