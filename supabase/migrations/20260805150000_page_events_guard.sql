-- =============================================================================
-- 계측 비콘 보호 — 모양 검사 · 폭주 상한 · 보관 기간 (2026-08-05)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260712120000_page_events.sql
--
-- 왜
--   `page_events` 는 **비회원 비콘**이라 anon INSERT 를 열어 둘 수밖에 없다
--   (측정 대상이 로그아웃 방문자의 히어로 도달률이다 — 로그인 필수로 만들면 기능이 죽는다).
--   그 대신 '무엇을·얼마나' 넣을 수 있는지를 좁힌다.
--
-- ⚠️ 솔직한 한계: RLS 로는 **방문자별 속도 제한이 불가능하다**(anon 은 신원이 없고
--    IP 는 정책에서 못 본다). 아래 상한은 전역이라, 실제로 누가 작정하고 들이부으면
--    '테이블이 커지는 것'은 막아도 '그동안 정상 계측이 거절되는 것'은 못 막는다.
--    그 수준의 공격이 실제로 오면 답은 DB 가 아니라 **Edge Function 비콘 + IP 제한**이다.
--    지금 규모에서 거기까지 갈 이유는 없다고 보고 여기서 멈춘다.
--
-- 개인정보 없음: 이벤트명·경로·뷰포트 구분뿐(SELECT 는 이미 관리자만).
-- =============================================================================


-- =============================================================================
-- 1. 집계·정리용 인덱스 — 아래 상한 검사와 prune 이 이걸 탄다
-- =============================================================================
create index if not exists idx_page_events_created
  on public.page_events (created_at desc);


-- =============================================================================
-- 2. 모양 검사 — 쓰레기 payload 차단
-- =============================================================================
-- ⚠️ RLS 가 아니라 **CHECK 제약**에 둔다. RLS 는 service_role 을 통과시키지만 CHECK 은
--    누구도 못 지나가고, 무엇보다 규칙이 한 곳에만 있어 RLS 와 어긋날 일이 없다.
--    (anon INSERT 정책은 `with check (true)` 그대로 둔다 — 모양은 여기서 본다.)
-- ⚠️ `not valid` — 기존 행은 검사하지 않는다. 신규 INSERT·UPDATE 에는 그대로 적용된다.
--    지금까지 들어온 행에 규칙 밖 값이 있어도 이 마이그레이션이 실패하지 않게 하려는 것.
--
-- 현재 쓰는 이벤트명은 전부 소문자+밑줄이다(intro_view·hero_reached·sojae_*·quickfix_*·ap_*).
-- ⚠️ **새 이벤트를 만들 때 이 규칙 안에서 짓는다** — 벗어나면 계측이 조용히 안 쌓인다
--    (비콘은 실패를 무시하도록 짜여 있어 화면에 아무 표시가 없다).
alter table public.page_events drop constraint if exists page_events_shape_ck;
alter table public.page_events add constraint page_events_shape_ck check (
  event ~ '^[a-z][a-z0-9_]{2,63}$'
  and path ~ '^/[A-Za-z0-9/_.-]{0,127}$'
  and (meta is null or (jsonb_typeof(meta) = 'object' and length(meta::text) <= 500))
) not valid;


-- =============================================================================
-- 3. 폭주 상한 — 분당 전역 2,000건
-- =============================================================================
-- 정상 트래픽과는 자릿수가 다르다: 첫 방문 1명당 최대 2건이라 2,000건/분 =
-- 분당 첫 방문 1,000명(시간당 6만)이다. 인스타 유입이 크게 터져도 닿지 않는 값이고,
-- 스크립트로 들이붓는 경우에만 걸린다. 좁히고 싶으면 이 숫자만 바꾼다.
-- ⚠️ 거절은 예외로 던진다 — 비콘 호출부는 전부 실패를 조용히 무시하므로 화면 영향 없음.
create or replace function public.page_events_rate_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_recent int;
begin
  select count(*) into v_recent
    from public.page_events
   where created_at > now() - interval '1 minute';

  if v_recent >= 2000 then
    raise exception 'page_events_rate_limited'
      using errcode = 'MC010', hint = '계측 비콘 분당 상한(2000)을 넘었습니다.';
  end if;
  return new;
end $$;

comment on function public.page_events_rate_guard() is
  '계측 비콘 폭주 상한(분당 2000). 전역 상한이라 방문자별 제한은 아니다 — 한계는 파일 머리말 참조.';

drop trigger if exists trg_page_events_rate on public.page_events;
create trigger trg_page_events_rate
  before insert on public.page_events
  for each row execute function public.page_events_rate_guard();


-- =============================================================================
-- 4. 보관 기간 — 오래된 계측은 지운다
-- =============================================================================
-- 도달률·전환율은 최근 몇 주를 본다. 1년 전 비콘은 자리만 차지한다.
-- ⚠️ 서버 전용(service_role). SQL Editor 는 함수 소유자 권한으로 도니 그냥 실행된다.
create or replace function public.page_events_prune(p_days int default 180)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_n bigint;
begin
  if p_days is null or p_days < 7 then raise exception 'bad_days'; end if;
  delete from public.page_events where created_at < now() - make_interval(days => p_days);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.page_events_prune(int) is
  '계측 비콘 보관 기간 정리. 기본 180일 이전 행 삭제, 반환=지운 행 수. 최소 7일(실수로 전부 지우는 것 방지).';

revoke all on function public.page_events_prune(int) from public, anon, authenticated;
grant execute on function public.page_events_prune(int) to service_role;


-- =============================================================================
-- 5. (선택) 자동 정리 — pg_cron 을 켠 경우에만
-- =============================================================================
-- 대시보드 > Database > Extensions 에서 pg_cron 을 켠 뒤 아래를 한 번 실행하면
-- 매일 새벽 4시(UTC)에 180일 지난 행을 지운다. 안 켜도 무방하다 —
-- 생각날 때 `select public.page_events_prune();` 를 손으로 돌리면 된다.
--
-- select cron.schedule('page-events-prune', '0 4 * * *',
--                      $$select public.page_events_prune(180)$$);
--
-- 해제: select cron.unschedule('page-events-prune');


comment on table public.page_events is
  '랜딩·도구 계측 비콘(개인정보 없음). anon INSERT 는 열려 있고 — 로그아웃 방문자가 측정 대상이라 닫을 수 없다 — '
  '대신 모양은 page_events_shape_ck, 폭주는 trg_page_events_rate, 보관은 page_events_prune() 가 맡는다. SELECT 는 관리자만.';


-- =============================================================================
-- 적용 확인
-- =============================================================================
-- 1) 정상 비콘은 그대로 들어가는지 — 홈을 새 시크릿 창으로 열고 아래가 늘어나면 정상
-- select event, count(*) from public.page_events
--  where created_at > now() - interval '10 minutes' group by event order by 2 desc;
--
-- 2) 쓰레기 값이 막히는지 — 세 줄 모두 오류(23514 check violation)여야 한다
-- insert into public.page_events (event, path) values ('대문자AndLong!!', '/');
-- insert into public.page_events (event, path) values ('ok_event', 'http://evil.example');
-- insert into public.page_events (event, path, meta) values ('ok_event', '/', '"문자열"'::jsonb);
--
-- 3) 보관 정리가 도는지(지울 게 없으면 0)
-- select public.page_events_prune(180);
--
-- 4) 제약·트리거가 붙었는지
-- select conname from pg_constraint where conrelid = 'public.page_events'::regclass;
-- select tgname  from pg_trigger    where tgrelid  = 'public.page_events'::regclass and not tgisinternal;
-- =============================================================================


-- =============================================================================
-- 롤백
-- =============================================================================
-- drop trigger if exists trg_page_events_rate on public.page_events;
-- drop function if exists public.page_events_rate_guard();
-- alter table public.page_events drop constraint if exists page_events_shape_ck;
-- drop function if exists public.page_events_prune(int);
-- =============================================================================
