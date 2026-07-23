-- =============================================================================
-- 특강 카드 디자인 스펙 대응 — special_lectures 에 '항공사'·'잔여석' 항목 추가
-- 적용: Supabase SQL Editor 에 붙여넣고 실행 (idempotent, 재실행 안전)
--   airline    : 항공사 코드(IATA 소문자). 카드의 영문 사명·브랜드 액센트색이 여기서 나온다.
--                'ke'대한항공 'lj'진에어 '7c'제주항공 'tw'티웨이 'ze'이스타 'yp'에어프레미아 'rf'에어로케이
--                NULL = 항공사 무관 일반 특강(영문명 없이 네이비 기본).
--   seats_left : 잔여석. NULL=표시 안 함. 5 이하면 카드에서 강조, 0이면 카드 흐림+신청 마감.
--                (자동 차감 없음 — 운영자가 admin 에서 직접 조정하는 표시/게이트 값)
-- =============================================================================

alter table public.special_lectures
  add column if not exists airline    text,
  add column if not exists seats_left integer;

comment on column public.special_lectures.airline is
  '항공사 코드(ke/lj/7c/tw/ze/yp/rf). 카드 영문명·액센트색 소스. NULL=일반 특강.';
comment on column public.special_lectures.seats_left is
  '잔여석(표시·게이트용, 자동차감 없음). NULL=미표시, <=5 강조, 0=마감.';
