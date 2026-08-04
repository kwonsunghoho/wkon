-- =============================================================================
-- RLS 하드닝 — 환급 RPC 서버 전용화 · 신청 위조 차단 · 콘솔 생성 표 2개 (2026-08-04)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 이 파일 하나로는 아무것도 깨지지 않는다(기존 함수·정책을 없애지 않는다).
--
-- ⚠️ 실행 순서가 있다. 어기면 학생 크레딧이 사라진다.
--   ① 이 파일 실행            ← 지금
--   ② ai-killer · sojae-chat 재배포(콘솔) — 프로브 features 에 refund_server 확인
--   ③ 20260804160000_refund_credit_lockdown.sql 실행 (구 RPC 회수)
--   ②를 건너뛰고 ③을 먼저 하면 AI 호출이 실패했을 때 환급이 안 돼 학생이 크레딧을 잃는다.
--
-- 배경(2026-08-04 보안 점검에서 확인한 것)
--   1. refund_credit 이 authenticated 에 열려 있어 **브라우저에서 직접 호출**됐다.
--      학생이 유료 기능을 쓰고 결과를 받은 뒤 REST RPC 로 환급을 불러 크레딧을 되찾을
--      수 있었다(차감 키는 본인 credit_ledger 를 select 하면 그대로 보인다).
--      → 대상 회원을 인자로 받는 service_role 전용 refund_credit_for 로 옮긴다.
--   2. applications INSERT 정책이 member_id 만 검사해, 누구나 paid=true 인 행을 넣어
--      **입금 완료로 위장**할 수 있었다. 특강이면 정원까지 먹는다.
--   3. reviews · challenge_rounds 는 콘솔에서 만든 표라 레포에 RLS 선언이 없었다
--      (applications 가 2026-07-11 에 같은 이유로 하드닝된 전례).
-- =============================================================================


-- =============================================================================
-- 1. 환급 — service_role(에지 함수) 전용 함수
-- =============================================================================
-- 기존 refund_credit(text,text) 은 auth.uid() 로 대상을 정하므로 반드시 사용자 권한으로
-- 불러야 했고, 그래서 브라우저에도 열려 있었다. 대상을 인자로 받으면 그럴 이유가 없다.
-- ⚠️ 이 함수는 '누가 부르는지'를 검사하지 않는다 — 호출 권한 자체를 service_role 로
--    좁히는 것이 방어다. authenticated 에 grant 하지 말 것(그 순간 원래 구멍으로 돌아간다).
create or replace function public.refund_credit_for(p_member uuid, p_tool text, p_ref text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_reason text;
  v_cost   int;
  v_bal    int;
begin
  if p_member is null then raise exception 'bad_member'; end if;
  if p_tool is null or p_tool = '' then raise exception 'bad_tool'; end if;
  if p_ref  is null or p_ref  = '' then raise exception 'bad_ref';  end if;

  -- 회원 단위 직렬화 — spend_credit 과 같은 키를 잡는다(차감·환급이 섞이지 않게).
  perform pg_advisory_xact_lock(hashtext('credit:' || p_member::text));

  select reason, coalesce(cost, 1) into v_reason, v_cost
    from public.credit_ledger
   where member_id = p_member and tool = p_tool and ref = p_ref
     and reason in ('use','free_use')
   limit 1;

  -- 차감 기록이 없으면 되돌릴 것도 없다(재시도 방어 — 예외 대신 조용히 통과).
  if v_reason is null then
    select coalesce(sum(delta),0)::int into v_bal
      from public.credit_ledger where member_id = p_member;
    return jsonb_build_object('ok', true, 'refunded', false, 'balance', v_bal);
  end if;

  if v_reason = 'free_use' then
    -- ⚠️ 이 원장의 유일한 delete. free_use 는 delta 0 이라 refund 행을 더해도 되돌아가지
    --    않고, 행이 남으면 오늘 한도를 이미 쓴 것으로 세어져 실패한 검사 때문에 무료
    --    기회를 잃는다(refund_credit 과 같은 이유·같은 동작).
    delete from public.credit_ledger
      where member_id = p_member and tool = p_tool and ref = p_ref and reason = 'free_use';
  else
    -- 같은 사용처를 두 번 환급하지 않는다(중복 호출·재시도 방어).
    if not exists (select 1 from public.credit_ledger
                     where member_id = p_member and tool = p_tool and ref = p_ref
                       and reason = 'refund') then
      insert into public.credit_ledger (member_id, tool, delta, reason, ref, cost)
        values (p_member, p_tool, v_cost, 'refund', p_ref, v_cost);
    end if;
  end if;

  select coalesce(sum(delta),0)::int into v_bal
    from public.credit_ledger where member_id = p_member;
  return jsonb_build_object('ok', true, 'refunded', true, 'balance', v_bal);
end $$;

comment on function public.refund_credit_for(uuid, text, text) is
  '차감 취소(서버 전용). 대상을 인자로 받아 service_role 만 부른다 — 브라우저에서 스스로 환급하는 길을 막기 위한 분리. 동작은 refund_credit 과 같다.';

revoke all on function public.refund_credit_for(uuid, text, text) from public, anon, authenticated;
grant execute on function public.refund_credit_for(uuid, text, text) to service_role;


-- =============================================================================
-- 2. applications — 브라우저가 넣는 신청은 언제나 '결제 전' 상태
-- =============================================================================
-- 비회원 신청 때문에 anon INSERT 는 계속 열어 둔다. 대신 결제 관련 컬럼을 못 쓰게 한다.
-- ⚠️ 카드 결제 행은 verify-payment 가 service_role 로 넣으므로 이 정책의 영향을 받지
--    않는다(service_role 은 RLS 를 통과). apply.html·lecture.html 이 보내는 payload 는
--    name·phone·challenges·total_price·member_id·lecture_id·slot_id 뿐이라 그대로 통과한다.
-- ⚠️ payment_status 는 기본값 'pending' 이 채워진 뒤에 검사된다(RLS 는 최종 행을 본다).
drop policy if exists applications_insert_public on public.applications;
create policy applications_insert_public on public.applications
  for insert
  to anon, authenticated
  with check (
    (member_id is null or member_id = auth.uid())
    and coalesce(paid, false) = false
    and coalesce(refunded, false) = false
    and coalesce(refunded_amount, 0) = 0
    and payment_id is null
    and paid_amount is null
    and coalesce(payment_status, 'pending') = 'pending'
  );

comment on table public.applications is
  '챌린지·특강 신청(비회원 포함). 이름·전화 = 개인정보. SELECT 는 관리자·본인만, 브라우저 INSERT 는 결제 전 상태만(결제 행은 verify-payment 가 service_role 로 넣는다).';


-- =============================================================================
-- 3. reviews — 콘솔 생성 표. 공개 읽기는 visible 인 것만, 쓰기는 관리자만
-- =============================================================================
-- reviewer_name(실명)이 들어 있고, 홈·후기 목록이 비회원에게도 보여야 한다.
-- 화면들은 이미 .eq('visible', true) 로 거르므로 using (visible) 이 보이는 결과를 바꾸지 않는다.
alter table public.reviews enable row level security;

drop policy if exists reviews_read_public on public.reviews;
drop policy if exists reviews_admin_all   on public.reviews;

create policy reviews_read_public on public.reviews
  for select to anon, authenticated
  using (visible);

create policy reviews_admin_all on public.reviews
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- =============================================================================
-- 4. challenge_rounds — 콘솔 생성 표. 모집일정 단일 소스
-- =============================================================================
-- 비회원이 상세 페이지에서 모집 기간을 읽어야 하므로 SELECT 는 전체 공개.
-- 쓰기가 열려 있으면 홈에 뜨는 모집일정이 바뀌므로 관리자만.
-- admin '챌린지' 탭은 upsert(insert+update)·delete 를 쓴다 → for all 하나로 덮는다.
alter table public.challenge_rounds enable row level security;

drop policy if exists challenge_rounds_read_public on public.challenge_rounds;
drop policy if exists challenge_rounds_admin_all   on public.challenge_rounds;

create policy challenge_rounds_read_public on public.challenge_rounds
  for select to anon, authenticated
  using (true);

create policy challenge_rounds_admin_all on public.challenge_rounds
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- =============================================================================
-- 적용 확인
-- =============================================================================
-- ⚠️ 이 파일은 **이름이 다른 기존 정책을 지우지 못한다.** reviews·challenge_rounds 는
--    콘솔에서 만든 표라 손으로 붙인 정책이 남아 있을 수 있고, 그게 더 헐거우면
--    (정책은 OR 로 합쳐진다) 여기서 조인 제한이 무의미해진다. 아래 2번으로 확인하고
--    모르는 정책이 있으면 drop 한다.
--
-- 1) 표별 RLS 상태 — rls_켜짐 이 false 인 줄이 없어야 한다
-- select c.relname as 테이블, c.relrowsecurity as rls_켜짐,
--        (select count(*) from pg_policies p
--          where p.schemaname='public' and p.tablename=c.relname) as 정책수
--   from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='public' and c.relkind='r'
--  order by c.relrowsecurity, c.relname;
--
-- 2) 이번에 손댄 표의 정책 목록 — 아래 5개 외에 다른 게 있으면 확인 후 drop
--    applications_insert_public / applications_select_own / applications_admin_all
--    reviews_read_public / reviews_admin_all
--    challenge_rounds_read_public / challenge_rounds_admin_all
-- select tablename, policyname, cmd, roles, qual, with_check
--   from pg_policies
--  where schemaname='public' and tablename in ('reviews','challenge_rounds','applications')
--  order by tablename, policyname;
--
-- 3) 환급 함수가 서버 전용인지 — refund_credit_for 에 authenticated 가 없어야 한다
-- select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as 실행가능
--   from pg_proc p, pg_namespace n, pg_roles r
--  where p.pronamespace=n.oid and n.nspname='public'
--    and p.proname in ('refund_credit','refund_credit_for')
--    and r.rolname in ('anon','authenticated','service_role')
--  order by p.proname, r.rolname;
--
-- 4) 위조 신청이 막혔는지 — 로그아웃 상태(시크릿 창)에서 401/403 이어야 한다
-- curl -s -X POST "https://apzwauiumhmsvrgffjis.supabase.co/rest/v1/applications" \
--   -H "apikey: <anon key>" -H "Content-Type: application/json" \
--   -d '{"name":"rls테스트","phone":"01000000000","paid":true}'
--   → {"code":"42501", ...} 이면 정상. 201 이면 정책이 안 걸린 것이다.
--
-- 5) 정상 신청은 그대로 되는지 — apply.html 에서 계좌이체 신청 1건, lecture.html 1건.
--
-- 6) 이 파일이 손대지 않는 것 — Storage 정책은 콘솔에서 만든 그대로다. `reviews` 버킷
--    (후기 이미지·공개)은 admin 이 브라우저에서 업로드하므로 쓰기 정책이 있을 텐데,
--    그게 is_admin() 을 보는지 확인해 둔다. 아무나 쓰기면 공개 버킷에 파일을 부을 수 있다.
-- select policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname='storage' and tablename='objects'
--  order by policyname;
-- =============================================================================


-- =============================================================================
-- 롤백 (되돌릴 일이 생기면)
-- =============================================================================
-- drop policy if exists challenge_rounds_read_public on public.challenge_rounds;
-- drop policy if exists challenge_rounds_admin_all   on public.challenge_rounds;
-- alter table public.challenge_rounds disable row level security;
-- drop policy if exists reviews_read_public on public.reviews;
-- drop policy if exists reviews_admin_all   on public.reviews;
-- alter table public.reviews disable row level security;
-- drop policy if exists applications_insert_public on public.applications;
-- create policy applications_insert_public on public.applications
--   for insert to anon, authenticated
--   with check (member_id is null or member_id = auth.uid());
-- drop function if exists public.refund_credit_for(uuid, text, text);
-- =============================================================================
