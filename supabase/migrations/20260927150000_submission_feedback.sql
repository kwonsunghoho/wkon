-- =============================================================================
-- 챌린지 제출물 코치 피드백 (2026-09-27 오너 "파일 올린 걸 피드백해 주고, 마이페이지에도 기록이 남게")
-- =============================================================================
-- 제출물(challenge_submissions) 행마다 코치 피드백 한 벌 — 칸(파일) 하나에 피드백 하나, 다시 쓰면 덮는다.
--   feedback          본문(NULL = 아직 없음)
--   feedback_at       남긴 시각            ┐
--   feedback_by       남긴 관리자(members) │ 셋 다 트리거가 채운다 — 화면은 feedback 만 보낸다
--   feedback_file_at  피드백 당시 파일의 updated_at ┘ (학생이 그 뒤 다시 올렸는지 화면이 알아본다)
--
-- 화면은 보신각(voice)·영합각(expression)만 피드백 칸을 그린다(오너 "일단 영합각 보신각만").
-- 표는 챌린지를 제한하지 않는다 — 스피닝으로 넓힐 때 SQL 없이 화면만 열면 된다.
--
-- ⚠️ 학생은 자기 제출물 행을 insert/update 할 수 있다(chsub_insert_own·chsub_update_own — 재업로드 upsert).
--    RLS 는 컬럼을 가리지 못하므로 트리거로 막는다: admin 이 아닌 세션이 피드백 컬럼을 넣거나 바꾸면 거부.
--    학생의 재업로드 upsert 는 피드백 컬럼을 보내지 않아(insert 단계 NULL · update 단계 old=new) 통과한다.
-- ⚠️ 피드백 저장은 파일 시각(updated_at)을 건드리지 않는다 — set_updated_at 트리거(trg_challenge_submissions_updated_at)가
--    먼저 돌아 updated_at 을 now() 로 올려 두는데, 이 트리거가 이름순으로 뒤에 돌면서 되돌린다.
--    (mypage 의 '○○ 올림' 날짜와 '그 뒤 다시 올린 파일' 판정이 updated_at 을 본다.)
-- ⚠️ 오너가 Supabase SQL Editor 에서 실행해야 반영된다.
-- ⚠️ 미적용 degrade: mypage 는 select('*') 라 컬럼이 없으면 피드백 칸을 안 그린다.
--    admin 은 받은 행에 feedback 키가 없으면 '마이그레이션 적용 전' 안내만 그린다(저장 버튼 없음).
-- =============================================================================

alter table public.challenge_submissions
  add column if not exists feedback         text,
  add column if not exists feedback_at      timestamptz,
  add column if not exists feedback_by      uuid references public.members(id) on delete set null,
  add column if not exists feedback_file_at timestamptz;

comment on column public.challenge_submissions.feedback is
  '코치 피드백 본문(2026-09-27). 칸(파일) 하나에 하나 — 다시 쓰면 덮는다. 쓰기는 admin 만(트리거 chsub_guard_feedback).';
comment on column public.challenge_submissions.feedback_file_at is
  '피드백을 남길 때의 파일 updated_at. 학생 화면이 "그 뒤에 다시 올린 파일"을 알아보는 기준.';

-- ── 피드백 컬럼 보호 + 서버가 시각·작성자·파일 기준 시각을 채운다 ────────────────
create or replace function public.chsub_guard_feedback()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_admin boolean := public.is_admin();
begin
  if tg_op = 'INSERT' then
    -- 학생이 첫 업로드에 피드백을 끼워 넣지 못하게. admin 은 insert 하지 않는다(대리 업로드 없음).
    if not v_admin and (new.feedback is not null or new.feedback_at is not null
                        or new.feedback_by is not null or new.feedback_file_at is not null) then
      raise exception 'feedback columns are admin-only' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.feedback is distinct from old.feedback
     or new.feedback_at is distinct from old.feedback_at
     or new.feedback_by is distinct from old.feedback_by
     or new.feedback_file_at is distinct from old.feedback_file_at then
    if not v_admin then
      raise exception 'feedback columns are admin-only' using errcode = '42501';
    end if;
    if new.feedback is distinct from old.feedback then
      if new.feedback is null or length(btrim(new.feedback)) = 0 then
        new.feedback := null; new.feedback_at := null; new.feedback_by := null; new.feedback_file_at := null;
      else
        new.feedback_at := now();
        new.feedback_by := auth.uid();
        new.feedback_file_at := old.updated_at;   -- 이 피드백이 가리키는 파일의 시각
      end if;
    end if;
    -- 피드백만 바뀐 저장은 파일 시각을 그대로 둔다(위 set_updated_at 이 올려 둔 값을 되돌린다)
    if new.storage_path is not distinct from old.storage_path then
      new.updated_at := old.updated_at;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.chsub_guard_feedback() is
  '제출물 피드백 컬럼은 admin 만 쓴다 + 저장 시 feedback_at/by/file_at 을 서버가 채운다(2026-09-27). trg_challenge_submissions_updated_at 뒤에 돈다(이름순).';

drop trigger if exists trg_chsub_guard_feedback on public.challenge_submissions;
create trigger trg_chsub_guard_feedback
  before insert or update on public.challenge_submissions
  for each row execute function public.chsub_guard_feedback();
