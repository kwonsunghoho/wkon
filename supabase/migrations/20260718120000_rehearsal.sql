-- =============================================================================
-- MONC 면접관 리허설 — 세션/대화/포인트 원장 + 서버 심판 RPC (2026-07-18)
-- =============================================================================
-- 스펙: docs/superpowers/specs/2026-07-18-interviewer-rehearsal-design.md
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
-- 선행: 20260703120000(members·is_admin·set_updated_at) · 20260705120000(questions·answers)
--       · 20260706120000(answers.status) · 20260710120000(site_config — 패턴집 시드에 필요)
--
-- 설계 원칙
--   - 리허설은 소재 발굴 권한(sojae_enabled)과 **별개 게이트** — 크레딧으로만 제어.
--     (RLS 에 can_sojae() 를 넣지 않는다. 나중에 단독 판매 가능한 구조.)
--   - 서버가 유일한 심판: 세션 생성(차감)·종료·usage 누적은 전부 SECURITY DEFINER RPC.
--     클라이언트는 rehearsal_sessions 를 insert/update 할 수 없다(본인 select 만).
--     ⚠️ 본인 update 를 직접 열면 status 를 done→active 로 되돌려 크레딧 없이
--     코칭을 이어가는 구멍이 생긴다 — finish_rehearsal RPC 로만 종료.
--   - point_ledger 는 append-only 원장. 잔액 = sum(delta). 본인 insert 금지
--     (지급·차감은 RPC/관리자만) — 클라이언트가 스스로 크레딧을 만들 수 없다.
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- 1. rehearsal_sessions — 리허설 세션 (재리허설마다 새 행. (member,question) unique 아님)
-- =============================================================================
create table if not exists public.rehearsal_sessions (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.members(id)   on delete cascade,
  question_id     uuid not null references public.questions(id) on delete cascade,
  -- 시작 시점 답변 원문 동결 — 이후 답변을 고쳐도 코칭·총평 맥락 유지.
  -- RPC 가 복사하므로 Edge Function 은 answers 를 다시 읽지 않는다
  -- (소재 발굴 권한 회수와 무관하게 세션은 완주 가능).
  answer_snapshot text not null,
  status          text not null default 'active' check (status in ('active','done')),
  verdict         text,                       -- 종합 첨삭 리포트(완료 시 저장)
  -- 원가 실측: Edge Function 이 호출마다 응답 usage 를 누적 → 세션당 실원가,
  -- 충전 가격 책정 근거(admin 리허설권 탭에서 평균 조회).
  -- input_tokens 에는 캐시 생성/읽기 토큰도 합산한다(단가는 다르지만 규모 파악 목적).
  input_tokens    int not null default 0,
  output_tokens   int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.rehearsal_sessions is
  '면접관 리허설 세션. status=active(진행)/done(종합 첨삭 완료). 재리허설마다 새 행.';

-- 회원×문제당 진행 중 세션은 하나만. 동시 시작 직렬화의 1차 방어는
-- start_rehearsal 의 회원 단위 advisory lock — 이 부분 유니크는 그 불변식을
-- DB 레벨에서 못박는 백스톱(락을 우회하는 경로가 생겨도 중복 active 불가).
create unique index if not exists rehearsal_sessions_active_uq
  on public.rehearsal_sessions (member_id, question_id) where status = 'active';

create index if not exists rehearsal_sessions_member_q_idx
  on public.rehearsal_sessions (member_id, question_id, created_at desc);

drop trigger if exists trg_rehearsal_sessions_updated_at on public.rehearsal_sessions;
create trigger trg_rehearsal_sessions_updated_at
  before update on public.rehearsal_sessions
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 2. rehearsal_messages — 리허설 대화 로그
-- =============================================================================
create table if not exists public.rehearsal_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.rehearsal_sessions(id) on delete cascade,
  member_id   uuid not null references public.members(id)            on delete cascade,
  role        text not null check (role in ('interviewer','user')),
  content     text not null,
  created_at  timestamptz not null default now()
);

comment on table public.rehearsal_messages is
  '리허설 대화. role=interviewer(연구원의 면접관 질문 패턴 코칭)/user(회원). 다시 보기 재료.';

create index if not exists rehearsal_messages_session_idx
  on public.rehearsal_messages (session_id, created_at);

-- =============================================================================
-- 3. point_ledger — 리허설권 원장 (append-only. 잔액 = sum(delta))
-- =============================================================================
create table if not exists public.point_ledger (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  delta       int  not null,
  reason      text not null check (reason in ('welcome','admin_grant','rehearsal','purchase','refund')),
  ref         text,                -- rehearsal: 세션 id / admin_grant: 지급·회수 사유 / purchase: 결제 키(추후)
  created_by  uuid,                -- 관리자 지급 시 관리자 uid
  created_at  timestamptz not null default now()
);

comment on table public.point_ledger is
  '리허설권 원장(append-only). 잔액=sum(delta). 회수는 admin_grant 의 음수 delta(사유는 ref).';

create index if not exists point_ledger_member_idx on public.point_ledger (member_id);

-- 무료 1회(welcome) 중복 지급 방지 — 회원당 welcome 행은 하나만
create unique index if not exists point_ledger_welcome_uq
  on public.point_ledger (member_id) where reason = 'welcome';

-- =============================================================================
-- 4. RLS — 본인 select / 관리자 전체. 쓰기는 RPC(정의자 권한)와 관리자만.
-- =============================================================================
alter table public.rehearsal_sessions enable row level security;
alter table public.rehearsal_messages enable row level security;
alter table public.point_ledger       enable row level security;

drop policy if exists rh_sessions_select_own on public.rehearsal_sessions;
drop policy if exists rh_sessions_admin_all  on public.rehearsal_sessions;
drop policy if exists rh_messages_select_own on public.rehearsal_messages;
drop policy if exists rh_messages_insert_own on public.rehearsal_messages;
drop policy if exists rh_messages_admin_all  on public.rehearsal_messages;
drop policy if exists ledger_select_own      on public.point_ledger;
drop policy if exists ledger_admin_all       on public.point_ledger;

-- 세션: 본인 읽기만(생성=start_rehearsal, 종료=finish_rehearsal, usage=add_rehearsal_usage)
create policy rh_sessions_select_own on public.rehearsal_sessions
  for select to authenticated using (member_id = auth.uid());
create policy rh_sessions_admin_all on public.rehearsal_sessions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 대화: 본인 읽기 + 본인 세션에 한해 본인 insert (다시 보기·복원용 저장)
create policy rh_messages_select_own on public.rehearsal_messages
  for select to authenticated using (member_id = auth.uid());
create policy rh_messages_insert_own on public.rehearsal_messages
  for insert to authenticated
  with check (
    member_id = auth.uid()
    and exists (select 1 from public.rehearsal_sessions s
                where s.id = session_id and s.member_id = auth.uid())
  );
create policy rh_messages_admin_all on public.rehearsal_messages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 원장: 본인 읽기(잔액 계산). insert 는 관리자(지급·회수)와 RPC 만.
create policy ledger_select_own on public.point_ledger
  for select to authenticated using (member_id = auth.uid());
create policy ledger_admin_all on public.point_ledger
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- 5. RPC — 서버가 유일한 심판
-- =============================================================================

-- 5-1. 시작: 완료 답변 확인 → active 재사용 → 잔액 확인 → 세션+차감 (한 트랜잭션)
create or replace function public.start_rehearsal(p_question_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_answer  text;
  v_sid     uuid;
  v_balance int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- 회원 단위 직렬화 — 서로 다른 문제를 동시에 시작해 잔액 검사(TOCTOU)를
  -- 우회하는 이중 차감 차단. 같은 문제 동시 시작도 여기서 직렬화되어
  -- 두 번째 호출은 active 재사용 경로로 들어간다(부분 유니크 인덱스는 백스톱).
  perform pg_advisory_xact_lock(hashtext('rehearsal:' || v_uid::text));

  -- 이미 진행 중이면 그 세션 재사용(추가 차감 없음 — 이어하기)
  select id into v_sid from public.rehearsal_sessions
    where member_id = v_uid and question_id = p_question_id and status = 'active'
    limit 1;
  if v_sid is not null then return v_sid; end if;

  -- 본인 완료(final) 답변만 대상
  select content into v_answer from public.answers
    where member_id = v_uid and question_id = p_question_id and status = 'final';
  if v_answer is null then raise exception 'no_final_answer'; end if;

  -- 잔액 확인
  select coalesce(sum(delta), 0) into v_balance
    from public.point_ledger where member_id = v_uid;
  if v_balance < 1 then raise exception 'no_credit'; end if;

  -- 세션 먼저(active 부분 유니크가 동시 시작 경쟁을 잡는다) → 원장 차감(ref=세션 id)
  insert into public.rehearsal_sessions (member_id, question_id, answer_snapshot)
    values (v_uid, p_question_id, v_answer)
    returning id into v_sid;
  insert into public.point_ledger (member_id, delta, reason, ref)
    values (v_uid, -1, 'rehearsal', v_sid::text);
  return v_sid;
end $$;

comment on function public.start_rehearsal(uuid) is
  '리허설 시작(리허설권 1 차감). active 있으면 재사용(무차감). 예외: no_final_answer / no_credit.';

-- 5-2. 웰컴 크레딧: 원장에 행이 하나도 없는 회원에게 1회 +1. 반환 = 현재 잔액.
--      rehearsal.html 진입 시 lazy 호출 — RPC 미존재 에러가 "미적용" 감지 프로브 역할도 한다.
create or replace function public.grant_welcome_credit()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_balance int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.point_ledger where member_id = v_uid) then
    insert into public.point_ledger (member_id, delta, reason)
      values (v_uid, 1, 'welcome')
    on conflict (member_id) where reason = 'welcome' do nothing;   -- 동시 호출 방어
  end if;
  select coalesce(sum(delta), 0) into v_balance
    from public.point_ledger where member_id = v_uid;
  return v_balance;
end $$;

comment on function public.grant_welcome_credit() is
  '무료 리허설권 1회 지급(원장이 빈 회원만) + 현재 잔액 반환. 부분 유니크가 재실행 방어.';

-- 5-3. 종료: 본인 active 세션에 verdict 저장 + done. (직접 update 를 열지 않는 이유는 상단 주석)
create or replace function public.finish_rehearsal(p_session_id uuid, p_verdict text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.rehearsal_sessions
    set status = 'done', verdict = left(coalesce(p_verdict, ''), 20000)
    where id = p_session_id and member_id = auth.uid() and status = 'active';
  if not found then raise exception 'no_active_session'; end if;
end $$;

comment on function public.finish_rehearsal(uuid, text) is
  '리허설 종료 — 종합 첨삭(verdict) 저장 + status=done. 본인 active 세션만.';

-- 5-4. usage 누적: Edge Function 이 호출마다 응답 usage 를 더한다(원가 실측).
create or replace function public.add_rehearsal_usage(p_session_id uuid, p_input int, p_output int)
returns void
language sql security definer set search_path = public
as $$
  update public.rehearsal_sessions
    set input_tokens  = input_tokens  + greatest(coalesce(p_input, 0), 0),
        output_tokens = output_tokens + greatest(coalesce(p_output, 0), 0)
    where id = p_session_id and member_id = auth.uid();
$$;

comment on function public.add_rehearsal_usage(uuid, int, int) is
  '리허설 AI 호출 usage 누적(본인 세션만). Edge Function 전용.';

-- 함수 실행 권한 — 로그인 회원만 (기존 관례: 20260715120000 delete_my_account 와 동일)
revoke all on function public.start_rehearsal(uuid)                  from public, anon;
revoke all on function public.grant_welcome_credit()                 from public, anon;
revoke all on function public.finish_rehearsal(uuid, text)           from public, anon;
revoke all on function public.add_rehearsal_usage(uuid, int, int)    from public, anon;
grant execute on function public.start_rehearsal(uuid)               to authenticated;
grant execute on function public.grant_welcome_credit()              to authenticated;
grant execute on function public.finish_rehearsal(uuid, text)        to authenticated;
grant execute on function public.add_rehearsal_usage(uuid, int, int) to authenticated;

-- =============================================================================
-- 6. 패턴집 시드 — site_config key 'rehearsal_patterns' (이미 있으면 덮지 않음)
--    ⚠️ 초안: 오너·연구진 검수 전. 검수 후에만 모집 문구에 "면접관 데이터" 계열 표현 사용.
--    구조: { <category>: { patterns: [꼬리질문 패턴…], criteria: [첨삭 기준…] } }
--    Edge Function(sojae-chat)의 DEFAULT_REHEARSAL_PATTERNS 와 동기화할 것.
-- =============================================================================
insert into public.site_config (key, value) values ('rehearsal_patterns', '{
  "experience": {
    "patterns": [
      "행동이 뭉뚱그려져 있으면 구체적 동작을 다시 묻는다 — 그때 정확히 어떻게 했어요?",
      "결과가 \"좋아졌다\"로 끝나면 증거를 묻는다 — 상대가 뭐라고 했나요? 무엇이 달라졌나요?",
      "경험을 기내로 잇는 다리를 묻는다 — 같은 일이 기내에서 벌어지면 어떻게 할래요?",
      "주어가 \"우리\"로 흐리면 본인 몫을 묻는다 — 그중 지원자님이 직접 한 건 뭐예요?"
    ],
    "criteria": [
      "장면이 구체적인가(언제·어디서·누구와) — 뭉뚱그린 답변은 초반 30초에 신뢰를 잃는다",
      "무게가 행동(A)에 있는가 — 상황 설명이 절반을 넘으면 구조를 뒤집어야 한다",
      "마무리가 승무원 직무로 연결되는가 — \"배웠다\"로 끝나면 절반짜리",
      "외운 문어체가 아닌가 — 자기 말이어야 꼬리질문에 무너지지 않는다"
    ]
  },
  "values": {
    "patterns": [
      "그 가치와 충돌하는 상황을 던져 우선순위를 묻는다 — 두 가치가 부딪히면 뭘 지킬래요?",
      "근거 경험이 하나뿐이면 다른 장면을 하나 더 묻는다 — 그 가치가 드러난 다른 순간은요?",
      "가치를 직무와 잇는다 — 그 가치가 기내에서는 어떤 행동으로 나타날까요?"
    ],
    "criteria": [
      "사전적 정의가 아니라 자기 경험에 뿌리내린 가치인가",
      "가치를 지키느라 치른 비용(손해·갈등)이 있는가 — 있어야 진짜로 들린다",
      "직무 장면으로 번역되는가"
    ]
  },
  "judgment": {
    "patterns": [
      "전제를 하나 바꿔 다시 묻는다 — 승객이 이미 화가 난 상태라면요?",
      "안전과 서비스가 충돌하는 변형을 던진다 — 규정을 따르면 승객이 불쾌해질 때는요?",
      "모르는 상황의 행동을 묻는다 — 규정을 모르는 상황이면 어떻게 할래요?",
      "후속까지 묻는다 — 그 다음, 동료·선임에게는 뭘 공유할래요?"
    ],
    "criteria": [
      "판단 기준(안전·규정·승객 마음)을 먼저 말하는가",
      "대처 순서가 현실적인가 — 말로만 이상적인 답은 변형 질문에 무너진다",
      "혼자 끝내지 않는가 — 보고·공유·재확인이 붙어야 완성"
    ]
  },
  "company": {
    "patterns": [
      "정보의 개인적 의미를 묻는다 — 그게 왜 지원자님에게 특별해요?",
      "비교를 시킨다 — 다른 항공사가 아니라 왜 여기예요?",
      "회사의 약점을 아는지 묻는다 — 이 회사가 아쉬운 점은 뭐라고 봐요?"
    ],
    "criteria": [
      "정보 나열이 아니라 자기 해석이 있는가",
      "지원자 강점과 회사 방향의 접점이 구체적인가",
      "정보가 최신인가 — 낡은 정보는 준비 부족으로 읽힌다"
    ]
  }
}')
on conflict (key) do nothing;

-- =============================================================================
-- 끝. 적용 후: sojae-chat Edge Function 을 rehearsal 분기 포함 버전으로 재배포해야
--   리허설 대화가 동작한다(미배포 시 rehearsal.html 이 오류 안내만 표시).
-- =============================================================================
