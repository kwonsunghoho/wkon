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
-- 후기 RPC 의 기수 조회도 같은 기준으로 — 안 맞추면 참가 판정은 통과하는데
-- 기수 조회만 부분 환불 행을 건너뛰어 후기가 '기수 미상(null)'으로 저장된다
-- (review-write 픽커는 같은 행에서 'N기'를 보여 줘 화면과 저장이 갈린다).
-- 원판 20260820160000 과 기수 조회 필터 한 줄만 다르다.
-- =============================================================================
create or replace function public.submit_challenge_review(
  p_challenge  text,                 -- 챌린지 id: voice / expression / spinning / answer
  p_quote      text,                 -- 후기 본문(한줄평 — 카드 앞면에 뜨는 글)
  p_name       text default null,    -- 표시 이름(비우면 이름 없이 게시)
  p_image_path text default null     -- reviews 버킷 경로(선택) — submissions/<uid>/ 만 허용
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_ch_kr text;
  v_round smallint;
  v_quote text := nullif(btrim(coalesce(p_quote, '')), '');
  v_name  text := left(nullif(btrim(coalesce(p_name, '')), ''), 40);
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'auth');
  end if;

  -- 챌린지 id → reviews.challenge 한글값(RV_CH_OPTS·data-challenge 와 같은 네 글자)
  v_ch_kr := case p_challenge
    when 'voice' then '보신각' when 'expression' then '영합각'
    when 'spinning' then '스피닝' when 'answer' then '승자각' end;
  if v_ch_kr is null then
    return jsonb_build_object('ok', false, 'code', 'bad_challenge');
  end if;

  if v_quote is null or length(v_quote) < 10 then
    return jsonb_build_object('ok', false, 'code', 'quote_short');
  end if;
  if length(v_quote) > 500 then
    return jsonb_build_object('ok', false, 'code', 'quote_long');
  end if;

  if not public.is_challenge_participant(p_challenge) then
    return jsonb_build_object('ok', false, 'code', 'not_participant');
  end if;

  -- 사진은 본인 제출 폴더만 — 남의 파일·아무 경로나 가리키는 것 차단
  if p_image_path is not null
     and p_image_path not like ('submissions/' || v_uid::text || '/%') then
    return jsonb_build_object('ok', false, 'code', 'bad_image');
  end if;

  -- 기수는 결제된 신청 기록에서(같은 챌린지 여러 기수면 최신). 못 찾으면 미상(null).
  -- ⚠️ 부분 환불 포함 — is_challenge_participant 와 한 기준(2026-08-22).
  select max((c->>'round')::int)::smallint into v_round
    from public.applications a,
         jsonb_array_elements(coalesce(a.challenges, '[]'::jsonb)) c
   where a.member_id = v_uid
     and (a.paid is true or a.payment_status in ('paid', 'free', 'partial_refunded'))
     and coalesce(a.refunded, false) = false
     and c->>'challenge' = p_challenge
     and (c->>'round') ~ '^[0-9]+$';

  begin
    insert into public.reviews
      (kind, challenge, cohort, reviewer_name, review_date, quote, image_path,
       visible, sort_order, member_id)
    values
      ('challenge', v_ch_kr, v_round, v_name, current_date, v_quote, p_image_path,
       false, 0, v_uid);                       -- ★ visible=false 강제 — 승인 전 비공개
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'already');
  end;

  return jsonb_build_object('ok', true);
end;
$$;

-- =============================================================================
-- 적용 확인 — 두 정의 모두에 'partial_refunded' 가 보이면 정상
-- =============================================================================
-- select pg_get_functiondef('public.is_challenge_participant(text)'::regprocedure);
-- select pg_get_functiondef('public.submit_challenge_review(text,text,text,text)'::regprocedure);
--
-- 실동작 확인: 부분 환불된 참가자 계정으로 mypage 제출 카드에서 파일 업로드 → 성공.
-- =============================================================================
