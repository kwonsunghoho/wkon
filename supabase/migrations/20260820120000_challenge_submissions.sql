-- =============================================================================
-- 챌린지 처음/끝 학생 직접 제출 (2026-08-20 오너 확정)
-- =============================================================================
-- 배경: Before/After(recordings)·일차 기록(daily_records)이 전부 admin 수동 입력이라
--       오너 일이 많았다. 산출물 입력 주체를 학생 본인으로 바꾼다.
--   - 보신각(voice)·스피닝(spinning) = 음성, 영합각(expression) = 영상.
--   - 승자각(answer)은 파일이 아니라 답변집(answers) 연동 — 이 표에 넣지 않는다(check 로 배제).
--   - 일차 기록은 화면에서만 정리한다 — 이 파일에 daily_records drop 없음(데이터 보존).
--
-- 왜 recordings 확장이 아니라 새 표인가:
--   recordings 는 unique(member_id, type)라 챌린지 구분이 없고, admin 업로드가
--   onConflict 'member_id,type' 으로 그 제약을 물고 있다. 제약을 갈아끼우면 미적용
--   환경에서 admin 업로드가 깨진다. 순수 추가형이면 미적용이어도 아무것도 안 깨진다.
--
-- ⚠️ 오너가 Supabase SQL Editor 에서 실행해야 반영된다.
-- ⚠️ 미적용 상태 degrade: 화면은 PGRST205(표 없음)를 '준비 중' 안내로 삼킨다.
-- =============================================================================


-- ── 1. 참가 판정 — 결제 완료(또는 무료·재학생) + 미환불 + 그 챌린지 신청 ──────
-- 브라우저 검사로 대체하지 않는다: 돈·신뢰가 걸린 판정은 DB 가 한다.
-- 비회원 신청(전화 매칭)은 대상이 아니다 — member_id 로 연동된 신청만 본다
-- (전화번호 조회 창구를 만들지 않는 원칙 + 프로필 번호를 바꿔 남 행세하는 구멍 차단).
create or replace function public.is_challenge_participant(p_challenge text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.applications a
     where a.member_id = auth.uid()
       and (a.paid is true or a.payment_status in ('paid', 'free'))
       and coalesce(a.refunded, false) = false
       and coalesce(a.payment_status, '') <> 'refunded'
       and exists (
         select 1
           from jsonb_array_elements(coalesce(a.challenges, '[]'::jsonb)) c
          where c->>'challenge' = p_challenge
       )
  );
$$;

comment on function public.is_challenge_participant(text) is
  '현재 로그인 회원이 해당 챌린지의 결제 완료(무료 포함)·미환불 참가자인지. challenge_submissions RLS 와 storage 정책이 쓴다.';

revoke all on function public.is_challenge_participant(text) from public, anon;
grant execute on function public.is_challenge_participant(text) to authenticated;


-- ── 2. 제출물 표 ─────────────────────────────────────────────────────────────
create table if not exists public.challenge_submissions (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.members(id) on delete cascade,
  challenge    text not null check (challenge in ('voice', 'expression', 'spinning')),
  round        smallint,                          -- 신청 시점 기수(표시용). NULL=미상
  type         text not null check (type in ('before', 'after')),
  storage_path text not null,                     -- recordings 버킷 경로: <uid>/<challenge>-<type>.<ext>
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (member_id, challenge, type)             -- 화면 upsert 의 onConflict 대상
);

comment on table public.challenge_submissions is
  '챌린지 처음/끝 제출물(학생 본인 업로드). voice·spinning=음성, expression=영상. answer(승자각)는 답변집(answers) 연동이라 여기 없음.';
comment on column public.challenge_submissions.storage_path is
  'recordings 비공개 버킷 경로. 본인 폴더(<uid>/) 강제 — 재생은 signed URL.';

drop trigger if exists trg_challenge_submissions_updated_at on public.challenge_submissions;
create trigger trg_challenge_submissions_updated_at
  before update on public.challenge_submissions
  for each row execute function public.set_updated_at();

alter table public.challenge_submissions enable row level security;

drop policy if exists chsub_select_own on public.challenge_submissions;
drop policy if exists chsub_insert_own on public.challenge_submissions;
drop policy if exists chsub_update_own on public.challenge_submissions;
drop policy if exists chsub_delete_own on public.challenge_submissions;
drop policy if exists chsub_admin_all  on public.challenge_submissions;

create policy chsub_select_own on public.challenge_submissions
  for select to authenticated
  using (member_id = auth.uid());

-- 본인 + 참가자 + 본인 폴더 경로일 때만 쓴다. upsert(insert…on conflict update)라
-- insert·update 둘 다 같은 조건이 필요하다.
create policy chsub_insert_own on public.challenge_submissions
  for insert to authenticated
  with check (
    member_id = auth.uid()
    and public.is_challenge_participant(challenge)
    and storage_path like auth.uid()::text || '/%'
  );

create policy chsub_update_own on public.challenge_submissions
  for update to authenticated
  using (member_id = auth.uid())
  with check (
    member_id = auth.uid()
    and public.is_challenge_participant(challenge)
    and storage_path like auth.uid()::text || '/%'
  );

create policy chsub_delete_own on public.challenge_submissions
  for delete to authenticated
  using (member_id = auth.uid());

create policy chsub_admin_all on public.challenge_submissions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ── 3. Storage — recordings 버킷에 본인 폴더 쓰기 허용 ──────────────────────
-- 기존: 본인 폴더 읽기(recordings_bucket_read_own) + 관리자 전체(recordings_bucket_admin_all).
-- 추가: 본인 폴더 쓰기. 파일명은 <uid>/<challenge>-<type>.<ext> 패턴만 받고,
--       파일명의 challenge 로 참가 판정까지 건다 — 비참가 회원이 버킷을 창고로 쓰지 못하게.
--       (admin 대리 업로드는 기존 admin_all 정책으로 이 제약과 무관하게 통과한다.)
drop policy if exists recordings_bucket_write_own  on storage.objects;
drop policy if exists recordings_bucket_update_own on storage.objects;
drop policy if exists recordings_bucket_delete_own on storage.objects;

create policy recordings_bucket_write_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-f-]+/(voice|expression|spinning)-(before|after)\.[A-Za-z0-9]{1,8}$'
    and public.is_challenge_participant(split_part(storage.filename(name), '-', 1))
  );

create policy recordings_bucket_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-f-]+/(voice|expression|spinning)-(before|after)\.[A-Za-z0-9]{1,8}$'
    and public.is_challenge_participant(split_part(storage.filename(name), '-', 1))
  );

-- 확장자가 바뀌는 재업로드가 옛 파일을 지울 수 있어야 고아 파일이 안 남는다.
-- 본인 폴더 한정이라 남의 파일은 못 지운다(legacy before.mp3 등 본인 것은 지울 수 있지만
-- 본인 산출물이라 문제없다).
create policy recordings_bucket_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 업로드 상한 50MB — 영합각 영상 안내 문구("1~2분, 50MB 이하")와 한 쌍.
update storage.buckets set file_size_limit = 52428800 where id = 'recordings';


-- =============================================================================
-- 검증(실행 후)
-- =============================================================================
-- 1) 표·정책 확인:
--    select policyname, cmd from pg_policies
--     where schemaname='public' and tablename='challenge_submissions' order by 1;
--    → chsub_admin_all / chsub_delete_own / chsub_insert_own / chsub_select_own / chsub_update_own
-- 2) 비참가 회원 insert 가 막히는지(로그인 세션에서):
--    insert 시도 → 42501 이면 정상.
-- 3) 화면: 결제한 회원 mypage 에 '내 챌린지 제출' 카드가 뜨고 업로드·재생이 되는지.
-- =============================================================================
-- 롤백
-- =============================================================================
-- drop policy if exists recordings_bucket_write_own  on storage.objects;
-- drop policy if exists recordings_bucket_update_own on storage.objects;
-- drop policy if exists recordings_bucket_delete_own on storage.objects;
-- drop table if exists public.challenge_submissions;
-- drop function if exists public.is_challenge_participant(text);
-- (버킷 file_size_limit 은 되돌릴 필요 없으면 그대로 둔다)
-- =============================================================================
