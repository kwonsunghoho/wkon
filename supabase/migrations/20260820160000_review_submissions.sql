-- =============================================================================
-- 챌린지 후기 회원 직접 제출 (2026-08-20 오너 확정 — 보상 없음)
-- =============================================================================
-- 배경: 후기가 전부 admin 대신 업로드 구조라 쌓이는 속도가 오너 손에 묶여 있었다.
--   결제한 참가자가 review-write.html 에서 직접 쓰고, admin 승인(visible 켜기) 후 공개된다.
-- 원칙:
--   - 참가 판정은 DB(is_challenge_participant — 20260820120000)가 한다. 브라우저 검사 아님.
--   - 제출 즉시 공개 불가 — RPC 가 visible=false 를 강제한다(악성·저품질 차단은 admin 승인).
--   - 기수(cohort)도 브라우저를 믿지 않고 신청 기록(applications)에서 서버가 읽는다.
--   - 회원당 같은 챌린지·기수에 1건(유니크 인덱스).
--   - 보상(크레딧) 없음 — 오너 확정. 지급 로직을 넣지 말 것.
--
-- 선행: 20260801180000_reviews_kind(적용 확인 2026-08-20 anon 프로브 — kind 200)
--       20260820120000_challenge_submissions(적용 확인 — is_challenge_participant 존재)
-- ⚠️ 오너가 Supabase SQL Editor 에서 실행해야 반영된다.
-- ⚠️ 미적용 degrade: review-write 는 RPC 404(PGRST202)를 '준비 중' 안내로 삼킨다.
-- =============================================================================


-- ── 1. reviews 에 제출 회원 연결 ────────────────────────────────────────────
-- on delete set null: 탈퇴해도 승인된 후기는 남는다(기존 108건도 계정 무관 — 같은 성격).
alter table public.reviews
  add column if not exists member_id uuid references public.members(id) on delete set null;

comment on column public.reviews.member_id is
  '회원 직접 제출 후기의 작성 계정(2026-08-20). NULL=admin 업로드. 회원 제출은 visible=false 로 들어와 admin 승인 후 공개.';

-- 회원당 같은 챌린지·기수 1건. cohort 미상(null)은 -1 로 접어 한 자리로 센다.
create unique index if not exists reviews_member_submission_uidx
  on public.reviews (member_id, challenge, coalesce(cohort, -1))
  where member_id is not null;


-- ── 2. 제출 RPC — 검증·기수 판정·비공개 삽입을 서버가 한 번에 ────────────────
-- security definer 라 reviews 에 회원 INSERT 정책을 새로 열지 않는다(쓰기는 여전히
-- 관리자 정책 + 이 함수 한 길 — 아무 값이나 넣는 창구를 만들지 않기 위해서다).
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
  select max((c->>'round')::int)::smallint into v_round
    from public.applications a,
         jsonb_array_elements(coalesce(a.challenges, '[]'::jsonb)) c
   where a.member_id = v_uid
     and (a.paid is true or a.payment_status in ('paid', 'free'))
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
  '챌린지 참가자(결제·미환불)의 후기 제출. 검증·기수 판정 후 reviews 에 visible=false 로 삽입 — admin 승인 후 공개.';

revoke all on function public.submit_challenge_review(text, text, text, text) from public, anon;
grant execute on function public.submit_challenge_review(text, text, text, text) to authenticated;


-- ── 3. Storage — reviews 버킷(공개)에 회원 제출 사진 폴더 ───────────────────
-- submissions/<uid>/<파일>.<이미지 확장자> 만, 본인 폴더만. 수정·삭제 정책은 안 연다
-- (제출 후 교체는 없고, 정리는 admin 몫 — 기존 admin 쓰기 정책은 콘솔 생성 그대로).
drop policy if exists reviews_bucket_member_write on storage.objects;
create policy reviews_bucket_member_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'reviews'
    and (storage.foldername(name))[1] = 'submissions'
    and (storage.foldername(name))[2] = auth.uid()::text
    and name ~ '^submissions/[0-9a-f-]+/[0-9A-Za-z_-]+\.(jpg|jpeg|png|webp|gif)$'
  );


-- =============================================================================
-- 검증(실행 후)
-- =============================================================================
-- 1) 컬럼·인덱스: select column_name from information_schema.columns
--      where table_name='reviews' and column_name='member_id';   → 1행
-- 2) anon 프로브(로그인 없이): /rest/v1/rpc/submit_challenge_review → 401 이면 정상
--    (함수 존재 + anon 차단. 404 PGRST202 면 미적용).
-- 3) 화면: 결제한 회원이 review-write.html 에서 제출 → admin 후기 관리에
--    '회원 제출 대기'로 뜨고, 노출을 켜면 reviews-list 에 나온다.
-- =============================================================================
-- 롤백
-- =============================================================================
-- drop policy if exists reviews_bucket_member_write on storage.objects;
-- drop function if exists public.submit_challenge_review(text, text, text, text);
-- drop index if exists public.reviews_member_submission_uidx;
-- alter table public.reviews drop column if exists member_id;
-- =============================================================================
