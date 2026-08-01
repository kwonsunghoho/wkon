-- ============================================================================
-- 연구실 자료 — 유료 자료집(자료마다 금액) (2026-08-01)
-- ============================================================================
-- 오너 확정: **자료 하나하나에 금액을 설정한다.** 항공사 묶음 상품이 아니라,
-- 무료 자료와 유료 자료가 같은 서가에 섞여 있고 값은 price 한 칸이 정한다(0=무료).
-- 결제는 현금 단건(포트원 V2 + verify-payment) — 크레딧으로 열지 않는다.
--   (하루 무료 5크레딧이 저가 자료를 매일 공짜로 여는 구멍이 된다 · credits.md)
--
-- 앞 마이그레이션 위에 얹는다: 20260801120000(lab_resources) ·
--   20260801130000(admin 정책) · 20260801140000(외부 링크) · 20260801150000(영상 썸네일)
--
-- ⚠️⚠️ **이 파일을 마지막에 실행한다.** 140000·150000·이 파일이 전부 같은
--    lab_resource_list() 를 drop 후 재생성한다 — **나중에 실행한 쪽이 이긴다.**
--    이 파일이 셋을 합친 최종 정의(video_id + price + owned)라 마지막이어야 한다.
--    150000(썸네일)을 이 파일 뒤에 실행하면 price·owned 가 사라져
--    **유료 자료가 전부 무료로 열린다.** 그때는 이 파일만 다시 실행하면 복구된다.
--
-- ⚠️ 자료 테이블을 새로 만들지 않는다. 이미 있는 lab_resources 에 값만 붙인다 —
--    새 표를 만들면 자료가 두 곳으로 갈라지고 admin·목록·Edge Function 이 전부 두 벌이 된다.
-- ⚠️ lab_purchases 에 회원 자가 INSERT 정책을 만들지 말 것. 구매 기록은
--    verify-payment(service_role)와 admin 만 넣는다 — 자가 INSERT 를 열면 결제를
--    건너뛴 무료 구매 경로가 생긴다(program_enrollments 와 같은 원칙).
-- ⚠️ 유료 판정은 price > 0 하나로 한다. access(member/password)는 '어떻게 여는가'라
--    축이 다르다 — 유료 자료에 비밀번호까지 걸면 구매자가 또 막히니 admin 에서 같이
--    켜지 않는다(화면에서 안내한다).
-- ============================================================================

-- ── 0. 선행 보장 ────────────────────────────────────────────────────────────
-- ⚠️ 20260801140000(영상관 링크)이 아직 미적용일 수 있다. 아래 목록 RPC 가
--    external_url·duration_sec 을 읽으므로, 없으면 이 파일 전체가 실패한다.
--    같은 구문을 다시 실행해도 안전하니(idempotent) 여기서 한 번 더 보장한다.
alter table public.lab_resources alter column storage_path drop not null;
alter table public.lab_resources add column if not exists external_url text;
alter table public.lab_resources add column if not exists duration_sec integer;
alter table public.lab_resources drop constraint if exists lab_resources_source_required;
alter table public.lab_resources add constraint lab_resources_source_required
  check (storage_path is not null or external_url is not null);


-- ── 1. 값 ───────────────────────────────────────────────────────────────────
alter table public.lab_resources
  add column if not exists price integer not null default 0;

alter table public.lab_resources drop constraint if exists lab_resources_price_nonneg;
alter table public.lab_resources add constraint lab_resources_price_nonneg check (price >= 0);

comment on column public.lab_resources.price is
  '원 단위 정수. 0 이면 무료(로그인만). admin 에서 언제든 수정 — 이미 구매한 사람의 결제액은 lab_purchases.amount 가 보존한다.';


-- ── 2. 구매 기록 ────────────────────────────────────────────────────────────
create table if not exists public.lab_purchases (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.lab_resources(id) on delete restrict,
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      integer not null,   -- 결제 '시점' 금액. 나중에 price 를 올려도 과거 영수증은 그대로다
  payment_id  text,               -- 포트원 결제 id
  created_at  timestamptz not null default now(),
  unique (resource_id, user_id)   -- ★ 중복 구매의 최종 방어. 위반 시 verify-payment 가 전액 환불한다
);

comment on table public.lab_purchases is
  '연구실 자료 구매 기록. INSERT 는 verify-payment(service_role)와 admin 만 — 회원 자가 INSERT 정책을 만들지 말 것.';

create unique index if not exists lab_purchases_payment_uq
  on public.lab_purchases (payment_id) where payment_id is not null;
create index if not exists lab_purchases_user_idx
  on public.lab_purchases (user_id, created_at desc);
create index if not exists lab_purchases_res_idx
  on public.lab_purchases (resource_id);

alter table public.lab_purchases enable row level security;

drop policy if exists lab_purchases_select_own on public.lab_purchases;
drop policy if exists lab_purchases_admin_all  on public.lab_purchases;

-- 본인 구매 내역만(마이페이지 '구매한 자료'). INSERT 정책은 만들지 않는다.
create policy lab_purchases_select_own on public.lab_purchases
  for select to authenticated
  using (user_id = auth.uid());

create policy lab_purchases_admin_all on public.lab_purchases
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ── 3. 목록 RPC 재생성 — price·owned 추가 ───────────────────────────────────
-- 반환 컬럼이 늘어 create or replace 로는 안 바뀐다(반환 타입 변경 불가) — drop 후 생성.
-- owned: 로그인한 사람이 이미 산 자료인지. 비회원은 auth.uid() 가 null 이라 늘 false.
-- ⚠️ 여기서도 storage_path·password_hash·external_url 은 반환하지 않는다(앞 설계 유지).
drop function if exists public.lab_resource_list(text, text);

create or replace function public.lab_resource_list(
  p_shelf text default 'airline',
  p_airline text default null
)
returns table (
  id uuid, shelf text, airline text, title text, summary text, doc_type text,
  file_ext text, file_size bigint, needs_password boolean, delivery text,
  is_link boolean, duration_sec integer, video_id text,
  price integer, owned boolean,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.shelf, r.airline, r.title, r.summary, r.doc_type,
         r.file_ext, r.file_size, (r.access = 'password'), r.delivery,
         (r.external_url is not null), r.duration_sec,
         -- 영상 썸네일용 id(20260801150000_lab_thumbs 와 같은 정의를 그대로 옮겼다).
         -- ⚠️ 이 줄을 빼면 이 파일을 나중에 실행하는 순간 영상관 썸네일이 사라진다.
         coalesce(
           substring(r.external_url from '[?&]v=([A-Za-z0-9_-]{11})'),
           substring(r.external_url from 'youtu\.be/([A-Za-z0-9_-]{11})'),
           substring(r.external_url from '/embed/([A-Za-z0-9_-]{11})'),
           substring(r.external_url from '/shorts/([A-Za-z0-9_-]{11})'),
           substring(r.external_url from '/live/([A-Za-z0-9_-]{11})')
         ),
         r.price,
         exists (
           select 1 from public.lab_purchases p
           where p.resource_id = r.id and p.user_id = auth.uid()
         ),
         coalesce(r.published_at, r.created_at)
  from public.lab_resources r
  where r.published
    and r.shelf = p_shelf
    and (p_airline is null or r.airline = p_airline)
  order by coalesce(r.published_at, r.created_at) desc
$$;

grant execute on function public.lab_resource_list(text, text) to anon, authenticated;


-- ── 4. 내 구매 목록 ─────────────────────────────────────────────────────────
-- 마이페이지 '구매한 자료' 줄. 자료 제목이 필요한데 lab_resources 에는 회원 읽기
-- 정책이 없으므로(비밀번호 해시·경로가 있다) definer 함수로 제목만 내보낸다.
create or replace function public.lab_my_purchases()
returns table (
  resource_id uuid, shelf text, title text, amount integer, purchased_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.resource_id, r.shelf, r.title, p.amount, p.created_at
  from public.lab_purchases p
  join public.lab_resources r on r.id = p.resource_id
  where p.user_id = auth.uid()
  order by p.created_at desc
$$;

grant execute on function public.lab_my_purchases() to authenticated;


-- ── 5. 관리자 집계 — 자료별 구매 수·매출 ────────────────────────────────────
-- ⚠️ join 두 개로 묶지 말 것 — 구매×열람기록 카티전 곱이 나서 sum(amount) 가
--    열람 수만큼 부풀려진다(매출이 몇 배로 보인다). 스칼라 서브쿼리로 센다.
create or replace function public.lab_sales_summary()
returns table (
  resource_id uuid, title text, shelf text, price integer,
  purchase_count bigint, revenue bigint, download_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.title, r.shelf, r.price,
         (select count(*) from public.lab_purchases p where p.resource_id = r.id),
         (select coalesce(sum(p.amount), 0) from public.lab_purchases p where p.resource_id = r.id),
         (select count(*) from public.lab_downloads d
           where d.resource_id = r.id and d.kind in ('download','view'))
  from public.lab_resources r
  where public.is_admin()          -- ★ 관리자가 아니면 한 행도 안 나간다(정의자 권한 함수의 가드)
  order by r.created_at desc
$$;

revoke all on function public.lab_sales_summary() from public, anon;
grant execute on function public.lab_sales_summary() to authenticated;


-- ============================================================================
-- 롤백 (판매 시작 후에는 쓰지 말 것 — 구매 기록이 사라진다)
-- ============================================================================
-- drop function if exists public.lab_sales_summary();
-- drop function if exists public.lab_my_purchases();
-- drop table if exists public.lab_purchases;
-- alter table public.lab_resources drop column if exists price;
-- (목록 RPC 는 20260801140000 의 정의로 되돌린다)
