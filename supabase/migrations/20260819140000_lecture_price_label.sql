-- =============================================================================
-- 특강 참가비 0원 표시 문구 — special_lectures.price_label
-- 적용: Supabase SQL Editor 에 붙여넣고 실행 (idempotent, 재실행 안전)
--   price_label : 참가비가 0원일 때 '무료' 대신 보여줄 문구('상담 시 안내' 등).
--                 NULL/빈값 = 지금처럼 '무료'.
--                 ⚠️ 0원일 때만 쓴다 — 값이 있는 특강의 금액을 문구로 가리면
--                    금액을 안 보고 결제하게 되므로, 화면이 price > 0 이면 무시한다.
-- 배경: 가격을 상담에서 정하는 특강이 '무료'로 떠서 오해를 산다(오너 요청 2026-08-19).
-- =============================================================================

alter table public.special_lectures
  add column if not exists price_label text;

comment on column public.special_lectures.price_label is
  '참가비 0원일 때 표시 문구(예: 상담 시 안내). NULL=무료 표기. price>0 이면 화면이 무시.';
