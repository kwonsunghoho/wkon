-- =============================================================================
-- 특강 잔여석 '보이기/숨기기' 스위치 — special_lectures.show_seats
-- 적용: Supabase SQL Editor 에 붙여넣고 실행 (idempotent, 재실행 안전)
--   show_seats : 신청자 화면(카드·상세·시간대 목록)에 남은 자리 수를 보여줄지 여부.
--                true(기본)=지금까지처럼 '잔여 N석' 표시, false=숫자를 감춘다.
--                ⚠️ 표시 스위치일 뿐이다 — 정원 초과 차단(트리거 MC001)·잔여석 계산은
--                   그대로 돈다. 숨겨도 자리가 다 차면 '정원 마감'은 계속 나온다.
-- 배경: 신청이 저조하면 잔여석이 안 줄어 그 숫자가 그대로 노출된다(오너 요청 2026-08-19).
-- =============================================================================

alter table public.special_lectures
  add column if not exists show_seats boolean not null default true;

comment on column public.special_lectures.show_seats is
  '잔여석 노출 여부(표시 전용). true=잔여 N석 표시, false=숨김. 정원 마감 문구·초과 차단은 무관하게 유지.';
