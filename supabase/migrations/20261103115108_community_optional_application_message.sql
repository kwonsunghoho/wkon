-- 지원 이유는 빈 문자열도 허용하며 기존 1500자 상한은 유지한다.
begin;
alter table monc_community.applications
  drop constraint applications_message_check,
  add constraint applications_message_check check (char_length(message) <= 1500);
commit;
