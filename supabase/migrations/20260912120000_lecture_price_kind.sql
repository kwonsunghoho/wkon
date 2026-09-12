-- =============================================================================
-- 특강 금액 이름(참가비 / 예약금) — special_lectures.price_kind
-- 적용: Supabase SQL Editor 에 붙여넣고 실행 (idempotent, 재실행 안전)
--   price_kind : 'fee'(참가비 · 기본) | 'deposit'(예약금).
--                예약금이면 카드·상세·신청 폼의 금액 라벨이 '예약금'이 되고
--                상세·신청 폼에 '잔금은 별도로 안내드려요' 한 줄이 붙는다.
--                ⚠️ 라벨만 바꾼다 — 청구·서버 검증 금액은 그대로 price 다.
--                미적용 환경에서는 컬럼이 없어 화면이 지금처럼 '참가비'로 동작한다.
-- 배경: 잔금을 상담·현장에서 받는 특강을 '참가비'로만 적을 수 없다(오너 요청 2026-09-12).
-- =============================================================================

alter table public.special_lectures
  add column if not exists price_kind text not null default 'fee';

alter table public.special_lectures
  drop constraint if exists special_lectures_price_kind_check;
alter table public.special_lectures
  add constraint special_lectures_price_kind_check check (price_kind in ('fee', 'deposit'));

comment on column public.special_lectures.price_kind is
  '금액 이름: fee=참가비(기본), deposit=예약금(잔금 별도 안내 문구 표시). 청구 금액은 price 그대로.';
