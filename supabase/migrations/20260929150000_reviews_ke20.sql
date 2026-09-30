-- =============================================================================
-- KE20 후기 — 종류 추가 + 회원 직접 제출 (2026-09-29 오너 지시)
-- =============================================================================
-- 오너: "우리 후기에 KE20 후기칸도 만들어줘 · KE20은 후기 닉네임을 따로 작성할 수 있도록 ·
--        후기 작성하는 링크도" / "500자 말고 1500자로" / "소제목처럼 딱 알아볼 수 있게"
--
-- 바뀌는 것 둘:
--   1) reviews.kind 에 'ke20' 추가 — 체크 제약 교체(drop → add · 재실행 안전)
--   2) submit_ke20_review() 신설 — review-write.html?ch=ke20 이 부른다
--
-- 챌린지 후기(submit_challenge_review)와 다른 점:
--   - **참가 판정이 없다.** KE20(대한항공 대비 프로젝트)은 사이트 결제 상품이 아니라 applications 에
--     기록이 없다(2026-09-29 실측 — challenge_rounds·special_lectures 어디에도 없음). 로그인한 회원이면
--     쓸 수 있고, 거르는 것은 admin 승인이다(visible=false 로 들어오고, admin 카드에 작성 회원의
--     이름·전화가 뜬다 — admin.md '후기 관리 — 작성자 줄').
--   - **1,500자까지.** 글은 quote 한 칸 그대로다 — 소제목은 줄 맨 앞의 [소제목] 글자로 들어오고
--     화면(review-rich.js)이 그 줄을 소제목으로 그린다. 컬럼을 늘리지 않는다.
--   - 최소 10자는 **소제목을 뺀 본문**으로 센다(소제목만 눌러 놓고 제출하는 것 차단).
--   - **회원당 1건**(kind='ke20' 기준). 화면은 폼을 열기 전에 빈 글로 한 번 불러 본다 —
--     이미 썼으면 'already', 아니면 'quote_short' 가 돌아온다(1,500자를 다 쓴 뒤에 막히지 않게).
--
-- ⚠️ 오너가 Supabase SQL Editor 에서 실행해야 반영된다.
-- ⚠️ 미실행 degrade: 허브·목록은 KE20 이 0건이라 카드가 안 뜰 뿐이고, review-write.html?ch=ke20 은
--    RPC 404(PGRST202)를 '준비 중' 화면으로 삼킨다. admin 에서 종류를 'KE20 후기'로 바꾸는 저장만
--    제약 위반(23514)으로 막힌다.
-- 선행: 20260801180000_reviews_kind(kind 컬럼) · 20260820160000_review_submissions(member_id ·
--       reviews 버킷의 submissions/<uid>/ 쓰기 정책 — 사진은 그 정책을 그대로 쓴다)
-- =============================================================================


-- ── 1. 종류에 ke20 ──────────────────────────────────────────────────────────
alter table public.reviews drop constraint if exists reviews_kind_chk;
alter table public.reviews add constraint reviews_kind_chk
  check (kind in ('challenge', 'consult', 'ke20'));

comment on column public.reviews.kind is
  'challenge=챌린지 후기(기본) / consult=상담 후기 / ke20=KE20 후기(2026-09-29). 합격 수기는 이 표가 아니라 success_stories 다.';


-- ── 2. 제출 RPC ─────────────────────────────────────────────────────────────
-- security definer — reviews 에 회원 INSERT 정책을 열지 않는다(쓰기는 관리자 정책 + RPC 두 길).
create or replace function public.submit_ke20_review(
  p_quote      text,                 -- 후기 글(줄 맨 앞의 [소제목] 포함) — 1,500자까지
  p_name       text default null,    -- 닉네임(비우면 이름 없이 게시)
  p_image_path text default null     -- reviews 버킷 경로(선택) — submissions/<uid>/ 만 허용
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_quote text := nullif(btrim(replace(coalesce(p_quote, ''), E'\r', ''), E' \n\t'), '');
  v_name  text := left(nullif(btrim(coalesce(p_name, '')), ''), 40);
  v_line  text;
  v_body  integer := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'auth');
  end if;

  -- 회원당 1건. 글 검사보다 앞에 둔다 — 화면의 사전 확인(빈 글 호출)이 여기서 답을 받는다.
  if exists (select 1 from public.reviews where member_id = v_uid and kind = 'ke20') then
    return jsonb_build_object('ok', false, 'code', 'already');
  end if;

  -- 본문 글자 수 — 줄 맨 앞의 [소제목](20자 이하)은 빼고 센다. 화면(review-rich.js)과 같은 규칙.
  if v_quote is not null then
    foreach v_line in array string_to_array(v_quote, E'\n') loop
      v_body := v_body + length(btrim(regexp_replace(v_line, '^\s*\[[^][]{1,20}\]', ''), E' \t'));
    end loop;
  end if;
  if v_body < 10 then
    return jsonb_build_object('ok', false, 'code', 'quote_short');
  end if;
  if length(v_quote) > 1500 then
    return jsonb_build_object('ok', false, 'code', 'quote_long');
  end if;

  -- 사진은 본인 제출 폴더만 — 남의 파일·아무 경로나 가리키는 것 차단
  if p_image_path is not null
     and p_image_path not like ('submissions/' || v_uid::text || '/%') then
    return jsonb_build_object('ok', false, 'code', 'bad_image');
  end if;

  begin
    insert into public.reviews
      (kind, challenge, cohort, reviewer_name, review_date, quote, image_path,
       visible, sort_order, member_id)
    values
      ('ke20', 'KE20', null, v_name, current_date, v_quote, p_image_path,
       false, 0, v_uid);                       -- ★ visible=false 강제 — 승인 전 비공개
  exception when unique_violation then         -- 동시에 두 번 눌렀을 때(reviews_member_submission_uidx)
    return jsonb_build_object('ok', false, 'code', 'already');
  end;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.submit_ke20_review(text, text, text) is
  'KE20 후기 제출(로그인 회원 · 회원당 1건 · 1,500자). 참가 판정 없음 — reviews 에 visible=false 로 넣고 admin 승인 후 공개.';

revoke all on function public.submit_ke20_review(text, text, text) from public, anon;
grant execute on function public.submit_ke20_review(text, text, text) to authenticated;


-- =============================================================================
-- 적용 확인
-- =============================================================================
-- 1) anon 프로브(로그인 없이): POST /rest/v1/rpc/submit_ke20_review → 401 이면 정상
--    (함수 존재 + anon 차단. 404 PGRST202 면 미적용).
-- 2) 화면: 로그인한 회원이 review-write.html?ch=ke20 에서 제출 → admin '후기 관리'의
--    '승인 대기'에 뜨고, [승인]을 누르면 reviews-list.html?kind=ke20 과 허브에 나온다.
-- =============================================================================
-- 롤백
-- =============================================================================
-- drop function if exists public.submit_ke20_review(text, text, text);
-- update public.reviews set kind = 'challenge' where kind = 'ke20';   -- 남은 행을 먼저 옮긴 뒤에
-- alter table public.reviews drop constraint if exists reviews_kind_chk;
-- alter table public.reviews add constraint reviews_kind_chk check (kind in ('challenge', 'consult'));
-- =============================================================================
