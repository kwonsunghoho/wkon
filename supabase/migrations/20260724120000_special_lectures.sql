-- =============================================================================
-- 특강(special_lectures) — 주기적으로 여는 단발성 특강. 챌린지(challenge_rounds)와
-- 달리 상세페이지를 코드로 만들지 않고, admin '특강' 탭에서 등록한 한 행을
-- lecture.html?id=<id> 템플릿이 읽어 그린다. 신청·결제는 챌린지와 동일하게
-- applications 테이블 + verify-payment(포트원) 를 재사용한다.
-- 적용: Supabase SQL Editor 에 전체 붙여넣고 실행(이 레포는 자동 마이그레이션 없음, idempotent).
-- ⚠️ verify-payment Edge Function 재배포 전에 먼저 실행할 것(특강 결제 시 이 테이블에서
--    금액을 서버가 재확인하므로 테이블이 먼저 있어야 한다).
-- =============================================================================

create table if not exists public.special_lectures (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  title         text not null,               -- 특강 제목
  subtitle      text,                         -- 한 줄 소개(카드·히어로)
  description   text,                         -- 상세 본문(여러 문단, 줄바꿈 구분)
  highlights    jsonb,                        -- 핵심 포인트 ["...","..."] (선택)
  recruit_start date,                         -- 신청(모집) 시작
  recruit_end   date,                         -- 신청(모집) 마감 → 이 날짜로 모집중/예정/마감 판정
  lecture_date  date,                         -- 특강 진행일(표시·정렬)
  schedule_text text,                         -- 시간·장소·방식 자유 표기(예: "오후 2시 · Zoom · 90분")
  instructor    text,                         -- 강사명(선택)
  price         integer not null default 0,   -- 참가비(원). 0이면 무료 신청
  capacity      integer,                      -- 정원(선택, 표시용)
  thumb_url     text,                         -- 카드 썸네일 이미지 URL(선택)
  visible       boolean not null default true,-- 공개 여부(false=숨김, 관리자만 조회)
  sort_order    integer not null default 0    -- 정렬(작을수록 앞)
);

comment on table public.special_lectures is
  '특강(단발성). 공개 페이지는 visible=true 만 조회. 신청은 applications 재사용(lecture_id).';

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.special_lectures enable row level security;

drop policy if exists special_lectures_read_public on public.special_lectures;
drop policy if exists special_lectures_admin_all   on public.special_lectures;

-- 공개 읽기: 노출(visible=true) 특강만. 비회원(anon)·회원(authenticated) 모두.
create policy special_lectures_read_public on public.special_lectures
  for select
  to anon, authenticated
  using (visible = true);

-- 관리자: 숨김 포함 전체 조회·추가·수정·삭제 (admin '특강' 탭). is_admin() 은 membership 스키마 정의.
create policy special_lectures_admin_all on public.special_lectures
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── applications 에 특강 연결 컬럼 ────────────────────────────────────────────
-- 특강 신청도 applications 에 저장한다(관리자 신청자 현황 한곳에서 관리). challenges jsonb 엔
-- [{type:'lecture', lecture_id, name, price}] 를 담고, 아래 컬럼으로 직접 참조·필터한다.
alter table public.applications
  add column if not exists lecture_id uuid references public.special_lectures(id) on delete set null;
