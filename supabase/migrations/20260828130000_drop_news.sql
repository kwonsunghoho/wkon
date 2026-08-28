-- 항공 뉴스 기능 전체 폐지(2026-08-28 오너 "뉴스 스크랩만 빼자는게 아니라 뉴스 자체글 빼자고")
-- news_scraps(회원 스크랩) → news_articles(기사) 순서로 지운다(스크랩이 기사를 참조).
-- ⚠️ 회원 스크랩·기사 데이터가 지워진다(복구 불가). 실행 시점은 오너가 정한다 — 안 지워도 문제 없다
--    (화면·수집기·GitHub Actions 는 이 날 배포에서 전부 제거돼 아무도 안 읽는 표로 남을 뿐).
-- ⚠️ 순서: 이 날 main 배포가 라이브에 나간 뒤에 실행한다.
drop table if exists public.news_scraps;
drop table if exists public.news_articles;
