-- 전역 상한을 2GB로 올려도 기존 저장소는 종전의 50MB 제한을 유지한다.
begin;
update storage.buckets set file_size_limit=52428800
where id <> 'online-course-assets' and file_size_limit is null;
update storage.buckets set file_size_limit=2147483648
where id='online-course-assets' and public=false;
commit;
