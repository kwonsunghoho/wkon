-- =============================================================================
-- 특강 카드 이미지 보관함 — 'lecture-images' public 버킷 + RLS
-- 적용: Supabase SQL Editor 에 붙여넣고 실행 (idempotent, 재실행 안전)
--
-- 왜 public 인가: 특강 카드/상세는 비로그인 방문자도 보는 화면이라 signed URL 이 필요 없다
-- (recordings 버킷은 회원 개인 녹음이라 private). 저장되는 건 특강 홍보용 사진뿐.
--
-- special_lectures.thumb_url 에는 이 버킷의 **공개 URL 전체**가 들어간다(경로가 아니라).
-- 그래야 admin 에서 외부 이미지 주소를 그대로 붙여넣는 기존 방식도 계속 동작한다.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('lecture-images', 'lecture-images', true)
on conflict (id) do nothing;

drop policy if exists lecture_images_public_read on storage.objects;
drop policy if exists lecture_images_admin_all   on storage.objects;

-- 누구나 읽기(비로그인 방문자가 특강 카드를 본다)
create policy lecture_images_public_read on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'lecture-images');

-- 올리기/바꾸기/지우기는 관리자만
create policy lecture_images_admin_all on storage.objects
  for all
  to authenticated
  using (bucket_id = 'lecture-images' and public.is_admin())
  with check (bucket_id = 'lecture-images' and public.is_admin());
