-- applications 결제 컬럼 추가 (포트원 카카오페이/카드 결제 연동)
-- 미적용 시: 카드 결제 검증 함수의 insert가 실패하므로, 카드 결제 연동 전 반드시 실행.
alter table public.applications
  add column if not exists pay_method     text,
  add column if not exists payment_id     text,
  add column if not exists payment_status text default 'pending',
  add column if not exists paid_amount    integer;

-- 동일 결제ID로 신청이 중복 저장되는 것을 방지
create unique index if not exists applications_payment_id_key
  on public.applications (payment_id)
  where payment_id is not null;
