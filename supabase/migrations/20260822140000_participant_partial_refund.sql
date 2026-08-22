-- =============================================================================
-- 챌린지 참가 판정 — 부분 환불(중도 해지) 참가자를 배제하지 않는다 (2026-08-22 감사 수리 #2)
-- =============================================================================
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260820120000(challenge_submissions — 이 함수의 원판).
--
-- 왜 필요한가 ─────────────────────────────────────────────────────────────────
--   is_challenge_participant() 원판은 `paid is true or payment_status in ('paid','free')`
--   만 통과시킨다. 간편결제 신청 행은 verify-payment·웹훅이 boolean paid 를 안 채우고
--   payment_status='paid' 만 넣으므로, admin 부분 환불(중도 해지 공식: 결제액×잔여일수÷14)
--   이 payment_status 를 'partial_refunded' 로 바꾸는 순간 두 조건 다 탈락한다. 그런데
--   화면 두 곳(mypage 제출 카드·review-write 후기 폼 — 둘 다 2026-08-20 오너 확정)은
--   부분 환불을 참가자로 취급해 문을 열어 준다. 결과:
--     · 부분 환불 회원이 제출 버튼까지 가서 업로드가 42501, 후기 RPC 가 not_participant.
--     · 한 신청 행에 챌린지 2개를 담아 결제한 뒤 하나만 환불받으면, 행 단위 상태 때문에
--       정당하게 유지 중인 나머지 챌린지 제출까지 막힌다.
--   부분 환불은 '참가했던 사실'을 지우지 않는다 — 제출·후기 판정은 화면과 같은 기준으로
--   맞춘다(전액 환불만 배제). ⚠️ 특강 좌석(20260822130000)은 반대로 부분 환불을 '자리
--   비움'으로 본다 — 좌석은 미래의 자리, 제출은 과거의 참가라 기준이 다른 게 맞다.
-- =============================================================================

create or replace function public.is_challenge_participant(p_challenge text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.applications a
     where a.member_id = auth.uid()
       -- 부분 환불(중도 해지)은 참가 유지 — mypage·review-write 화면 판정과 한 기준.
       and (a.paid is true or a.payment_status in ('paid', 'free', 'partial_refunded'))
       -- 전액 환불만 배제한다.
       and coalesce(a.refunded, false) = false
       and coalesce(a.payment_status, '') <> 'refunded'
       and exists (
         select 1
           from jsonb_array_elements(coalesce(a.challenges, '[]'::jsonb)) c
          where c->>'challenge' = p_challenge
       )
  );
$$;

comment on function public.is_challenge_participant(text) is
  '현재 로그인 회원이 해당 챌린지의 결제 완료(무료·부분 환불 포함)·전액 미환불 참가자인지. '
  'challenge_submissions RLS·storage 정책·submit_challenge_review 가 쓴다. 부분 환불=참가 유지(2026-08-22).';

-- =============================================================================
-- 적용 확인 — 정의에 'partial_refunded' 가 보이면 정상
-- =============================================================================
-- select pg_get_functiondef('public.is_challenge_participant(text)'::regprocedure);
--
-- 실동작 확인: 부분 환불된 참가자 계정으로 mypage 제출 카드에서 파일 업로드 → 성공.
-- =============================================================================
