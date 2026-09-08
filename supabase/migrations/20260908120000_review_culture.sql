-- =============================================================================
-- 회원 직접 후기 제출에 댄특완(culture) 합류 (2026-09-08)
-- =============================================================================
-- 배경: 회원 직접 제출(20260820160000)은 2026-08-20, 댄특완은 2026-09-04 신설이라
--   RPC 의 챌린지 id → 한글값 매핑에서 빠져 있었다. 시작일 조건이 아니라 누락이다.
--   (참가 판정 is_challenge_participant 는 챌린지를 가리지 않아 그대로 쓴다.)
-- 바뀌는 것은 case 한 줄뿐 — 검증·기수 판정·visible=false 강제·유니크는 그대로다.
-- ⚠️ 오너가 Supabase SQL Editor 에서 실행해야 반영된다.
-- ⚠️ 미실행 degrade: 댄특완 후기 제출이 bad_challenge 로 떨어진다(화면은 '제출하지
--    못했어요'). 나머지 네 챌린지는 영향 없음.
-- 원판: 20260822140000(부분 환불 반영본) — 여기서 case 한 줄만 늘렸다. 그 migration 의
--   기수 조회 기준(partial_refunded 포함)을 그대로 들고 온다. ⚠️ 20260820160000 원문을
--   베껴 오면 부분 환불 참가자의 후기가 다시 '기수 미상'으로 저장된다.
-- =============================================================================

create or replace function public.submit_challenge_review(
  p_challenge  text,                 -- 챌린지 id: voice / expression / spinning / answer / culture
  p_quote      text,                 -- 후기 본문(한줄평 — 카드 앞면에 뜨는 글)
  p_name       text default null,    -- 닉네임(비우면 이름 없이 게시)
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
    when 'spinning' then '스피닝' when 'answer' then '승자각'
    when 'culture' then '댄특완' end;                  -- ★ 2026-09-08 추가
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

comment on function public.submit_challenge_review(text, text, text, text) is
  '챌린지 참가자(결제·미환불)의 후기 제출. 검증·기수 판정 후 reviews 에 visible=false 로 삽입 — admin 승인 후 공개. 2026-09-08 댄특완(culture) 합류.';

revoke all on function public.submit_challenge_review(text, text, text, text) from public, anon;
grant execute on function public.submit_challenge_review(text, text, text, text) to authenticated;

comment on column public.reviews.challenge is
  '정규화 챌린지: 보신각/영합각/스피닝/승자각/댄특완 (분류값, admin 수정 가능)';

-- =============================================================================
-- 적용 확인 — 정의에 '댄특완' 이 보이면 정상
-- =============================================================================
-- select pg_get_functiondef('public.submit_challenge_review(text,text,text,text)'::regprocedure);
--
-- 실동작 확인: 댄특완 결제 계정으로 review-write.html?ch=culture → 픽커에 '댄.특.완' →
--   제출 성공(admin '후기 관리'에 승인 대기로 뜬다).
-- =============================================================================
