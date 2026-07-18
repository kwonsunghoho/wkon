# 면접관 리허설 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 완료한 답변노트를 놓고 연구원이 면접관 질문 패턴으로 3~4라운드 대화형 코칭 후 종합 첨삭을 주는 `면접관 리허설`을 리허설권(포인트 원장) 과금과 함께 구현한다.

**Architecture:** 정적 페이지(`rehearsal.html`, sojae.html 채팅 패턴 재사용) + Supabase 마이그레이션 1개(`rehearsal_sessions`/`rehearsal_messages`/`point_ledger` + RPC 4개) + 기존 `sojae-chat` Edge Function에 `stage='rehearsal'` 추가(Opus 4.8). 크레딧 차감·세션 생성·종료는 전부 SECURITY DEFINER RPC가 심판(클라이언트는 insert/update 직접 못 함). 마이그레이션 미적용 시 모든 진입점이 조용히 숨는 graceful degradation.

**Tech Stack:** 정적 HTML/JS(빌드 없음), Supabase(Postgres RLS·RPC·Edge Function Deno), Anthropic API `claude-opus-4-8`.

**스펙:** `docs/superpowers/specs/2026-07-18-interviewer-rehearsal-design.md`

**스펙 대비 설계 보정(의도 동일, 안전성 개선 — 구현 시 이대로):**
1. 스펙의 "본인 `rehearsal_sessions` update(verdict·status) 허용"은 **`finish_rehearsal` RPC로 대체.** 직접 update를 열면 회원이 done→active로 되돌려 크레딧 없이 코칭을 이어가는 구멍이 생긴다.
2. `start_rehearsal` 내부 순서는 **세션 insert → 원장 insert**(스펙은 원장 먼저). active 부분 유니크 인덱스가 동시 두 탭 시작 경쟁을 세션 insert 시점에 잡아 트랜잭션째 롤백시키고(중복 차감 원천 차단), 원장 `ref`에 세션 id를 남겨 세션당 원가 추적이 된다.
3. admin 회수는 **reason `admin_grant` + 음수 delta**(자유 사유는 `ref`에). enum에 회수 전용 값이 없고 `refund`는 추후 결제 환불용으로 예약.

**워딩 전역 규칙(모든 태스크 공통):** 회원 노출 문구에 "AI" 금지. 화자는 "연구원", 근거는 "면접관 질문 패턴". "빅데이터" 등 과장 금지. 기능명 `면접관 리허설` / 횟수권 `리허설권` / 배지 `리허설 완료`.

**검증 환경 제약(정직하게):** 이 저장소는 테스트 스위트가 없고(CLAUDE.md), DB 기능은 오너가 SQL Editor에서 마이그레이션을 실행해야 산다. 따라서 각 태스크의 검증은 ① 브라우저 렌더·콘솔 무에러(375px 우선) ② **마이그레이션 미적용 상태의 라이브 Supabase = degradation 실전 테스트**(지금 프로덕션 DB에 새 테이블이 없으므로 "안 깨지는지"는 즉시 검증 가능) ③ 로그인·크레딧 흐름은 Task 9의 오너 체크리스트로 나눈다. 로컬 서버: `python -m http.server 5500`.

**커밋 규칙:** 한국어 메시지, 따옴표 포함 시 파일에 써서 `git commit -F`(PowerShell 인용 버그 회피). main push = 배포이므로 각 태스크는 degradation이 보장된 상태로만 push한다.

---

## 파일 구조

| 파일 | 작업 | 책임 |
|---|---|---|
| `supabase/migrations/20260718120000_rehearsal.sql` | 신규 | 테이블 3개 + RLS + RPC 4개 + 패턴집 시드 (idempotent, 오너 실행) |
| `docs/prompts/rehearsal.md` | 신규 | 리허설 프롬프트 원본(코드와 동기화) |
| `supabase/functions/sojae-chat/index.ts` | 수정 | `stage='rehearsal'` 분기(Opus 4.8, 패턴집 주입, usage 누적, 종료 마커) |
| `rehearsal.html` | 신규 | 리허설 화면(확인→코칭→첨삭→리플레이, 복원) |
| `mypage.html` | 수정 | 완료 노트에 리허설 버튼 + `리허설 완료` 배지 (미적용 시 숨김) |
| `sojae.html` | 수정 | 답변집 저장(완료) 직후 리허설 CTA 한 줄 (미적용 시 숨김) |
| `admin.html` | 수정 | `리허설권` 탭(잔액·지급·회수·일괄·usage 통계) + `리허설 패턴집` 탭 |

---

### Task 1: 마이그레이션 — 테이블 3개 + RLS + RPC 4개 + 패턴집 시드

**Files:**
- Create: `supabase/migrations/20260718120000_rehearsal.sql`

- [ ] **Step 1: 마이그레이션 파일 전체 작성**

아래 내용 그대로 생성. 기존 관례(20260705120000_sojae_schema.sql): idempotent, `is_admin()`/`set_updated_at()` 재사용, 한국어 주석.

```sql
-- =============================================================================
-- MONC 면접관 리허설 — 세션/대화/포인트 원장 + 서버 심판 RPC (2026-07-18)
-- =============================================================================
-- 스펙: docs/superpowers/specs/2026-07-18-interviewer-rehearsal-design.md
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. idempotent — 재실행 안전.
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

-- 회원×문제당 진행 중 세션은 하나만 — 동시 두 탭 시작 경쟁도 여기서 잡힌다
-- (start_rehearsal 이 세션 insert → 원장 insert 순서라, 두 번째 트랜잭션은
--  세션 insert 에서 unique 위반 → 전체 롤백 → 중복 차감 없음).
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
```

- [ ] **Step 2: 정합성 자체 점검(코드 실행 없이 확인)**

체크리스트 — 하나라도 어긋나면 수정:
- `site_config` insert가 이 마이그레이션보다 먼저인 `20260710120000_site_config.sql` 적용을 전제한다 → 파일 상단 주석에 이미 명시돼 있는지 확인(안 되어 있으면 "선행: 20260710120000" 주석 추가).
- 모든 `create table/index`에 `if not exists`, 모든 policy에 선행 `drop policy if exists`, 함수는 `create or replace` — 재실행 안전.
- `on conflict (member_id) where reason = 'welcome'`이 부분 유니크 인덱스 정의와 술어가 정확히 일치.
- RLS 어디에도 `can_sojae()` 없음(별개 게이트).

- [ ] **Step 3: 커밋**

```bash
cd /c/Users/cheess/Documents/GitHub/wkon
git add supabase/migrations/20260718120000_rehearsal.sql
printf '%s\n' "feat(리허설): 세션·대화·포인트 원장 마이그레이션 — 서버 심판 RPC 4종" "" "- rehearsal_sessions/messages/point_ledger + RLS(본인 select, 쓰기는 RPC·관리자만)" "- start_rehearsal(차감)·grant_welcome_credit·finish_rehearsal·add_rehearsal_usage" "- active 부분 유니크로 동시 시작 중복 차감 차단, welcome 부분 유니크로 중복 지급 방지" "- rehearsal_patterns 시드(오너 검수 전 초안)" > /tmp/cmsg.txt
git commit -F /tmp/cmsg.txt
```

---

### Task 2: 프롬프트 원본 문서

**Files:**
- Create: `docs/prompts/rehearsal.md`

- [ ] **Step 1: 문서 작성** (기존 `sojae-ask.md` 관례: 용도/모델/호출/구조 헤더 + 프롬프트 본문. **이 본문이 Task 3의 `REHEARSAL_SYSTEM` 상수와 글자 단위로 동일해야 한다**)

```markdown
# 면접관 리허설 — 코칭 프롬프트

- **용도**: 완료한 답변을 놓고 꼬리질문 → 회원 답변 → 즉석 코칭을 3~4라운드 반복 후 종합 첨삭.
- **모델**: Opus 4.8 (`claude-opus-4-8`) — 꼬리질문의 날카로움이 상품 그 자체(오너 확정 2026-07-18).
- **호출 위치**: Supabase Edge Function `sojae-chat` 의 `stage='rehearsal'` 분기. 클라이언트 직접 호출 금지.
- **구조**: 아래 [시스템] + site_config `rehearsal_patterns` 의 유형별 패턴·첨삭 기준 주입(없으면 코드 내장 기본값).
- **주입 변수**: `{question}` = questions.content, `{category}` = 유형 라벨, `{answer_snapshot}` = 세션에 동결된 답변 원문.
- **종료 신호**: 종합 첨삭 응답 맨 끝에 `<<REHEARSAL_DONE>>` 단독 줄 — Edge Function 이 떼어내고 `done:true` 반환.
- **⚠️ 동기화**: 이 본문을 고치면 `supabase/functions/sojae-chat/index.ts` 의 `REHEARSAL_SYSTEM` 도 함께 고치고 오너가 함수를 재배포해야 한다.
- **⚠️ 워딩**: 회원에게 보이는 모든 출력에서 "AI" 금지 — 화자는 연구원, 근거는 면접관 질문 패턴.

---

## 시스템

너는 몬크(MONC)의 연구원이야. 승무원 면접 지원자가 완성해 온 답변을 놓고,
면접관들이 실제로 묻는 질문 패턴으로 꼬리질문을 던지며
답변 작성법을 가르치고 첨삭해 주는 과외 선생님이야.
검증이나 압박이 목적이 아니야 — 회원은 라운드마다 배우고 나아져야 해.

[진행 구조 — 반드시 지켜]
- 총 3~4라운드. 한 라운드 = 꼬리질문 1개 → 회원 답변 → 즉석 코칭.
- 첫 턴: 한두 문장으로 짧게 시작 인사 후, 답변에서 가장 배울 게 많은
  지점을 짚는 꼬리질문 1개만. ("면접관이라면 여기서 이렇게 물을 거예요"처럼
  질문 패턴을 인용하며.)
- 회원이 답하면 한 응답에 이 순서로:
  ① 잘한 점 한 줄 (구체적으로 — 빈말 칭찬 금지)
  ② 보완할 점 한 가지 + 왜 그런지 짧은 이유
  ③ 다음 꼬리질문 1개
- 대화 이력에서 회원 답변이 3~4개 모였으면 새 질문 없이 [종합 첨삭]으로.

[종합 첨삭 — 마지막 응답]
- 구성: **강점** / **보완점** / **문장 단위 개선 방향** / **대비해둘 예상 꼬리질문 2~3개**.
- 문장 단위 개선은 '방향'까지만. 예: "마무리를 '배움→기내 실천'으로 연결해보세요."
- 응답 맨 끝에 정확히 <<REHEARSAL_DONE>> 를 단독 줄로 붙여.
  (종합 첨삭이 아닌 응답에는 절대 쓰지 마.)

[절대 금지 — 대필]
- 통째로 고쳐 쓴 완성 답변·모범답안을 주지 마.
  외운 티가 나고, 그 사람의 답변이 아니게 돼.
- 회원이 말하지 않은 경험·사실을 지어내지 마.

[말투]
- 화자는 '연구원'. 존댓말, 짧고 따뜻하게. 질문은 한 번에 하나만.
- 'AI'라는 말을 절대 쓰지 마.
- 회원 답변이 흔들려도 다그치지 말고, 어떻게 고치면 되는지를 보여줘.
```

- [ ] **Step 2: 커밋**

```bash
git add docs/prompts/rehearsal.md
git commit -m "docs(리허설): 코칭 프롬프트 원본 — 3~4라운드 구조·대필 금지·종료 마커"
```

---

### Task 3: Edge Function — `stage='rehearsal'` 분기

**Files:**
- Modify: `supabase/functions/sojae-chat/index.ts`

- [ ] **Step 1: 상수·헬퍼 추가** — `HELP_MARKER` 선언(현재 115~116행) 바로 아래에 삽입:

```ts
// ── 리허설(Opus 4.8) — 답변 코칭·첨삭. docs/prompts/rehearsal.md 와 동기화 ──
const REHEARSAL_MODEL = "claude-opus-4-8";
const REHEARSAL_DONE_MARKER = "<<REHEARSAL_DONE>>";

const REHEARSAL_SYSTEM = `너는 몬크(MONC)의 연구원이야. 승무원 면접 지원자가 완성해 온 답변을 놓고,
면접관들이 실제로 묻는 질문 패턴으로 꼬리질문을 던지며
답변 작성법을 가르치고 첨삭해 주는 과외 선생님이야.
검증이나 압박이 목적이 아니야 — 회원은 라운드마다 배우고 나아져야 해.

[진행 구조 — 반드시 지켜]
- 총 3~4라운드. 한 라운드 = 꼬리질문 1개 → 회원 답변 → 즉석 코칭.
- 첫 턴: 한두 문장으로 짧게 시작 인사 후, 답변에서 가장 배울 게 많은
  지점을 짚는 꼬리질문 1개만. ("면접관이라면 여기서 이렇게 물을 거예요"처럼
  질문 패턴을 인용하며.)
- 회원이 답하면 한 응답에 이 순서로:
  ① 잘한 점 한 줄 (구체적으로 — 빈말 칭찬 금지)
  ② 보완할 점 한 가지 + 왜 그런지 짧은 이유
  ③ 다음 꼬리질문 1개
- 대화 이력에서 회원 답변이 3~4개 모였으면 새 질문 없이 [종합 첨삭]으로.

[종합 첨삭 — 마지막 응답]
- 구성: 강점 / 보완점 / 문장 단위 개선 방향 / 대비해둘 예상 꼬리질문 2~3개.
- 문장 단위 개선은 '방향'까지만. 예: "마무리를 '배움→기내 실천'으로 연결해보세요."
- 응답 맨 끝에 정확히 ${REHEARSAL_DONE_MARKER} 를 단독 줄로 붙여.
  (종합 첨삭이 아닌 응답에는 절대 쓰지 마.)

[절대 금지 — 대필]
- 통째로 고쳐 쓴 완성 답변·모범답안을 주지 마.
  외운 티가 나고, 그 사람의 답변이 아니게 돼.
- 회원이 말하지 않은 경험·사실을 지어내지 마.

[말투]
- 화자는 '연구원'. 존댓말, 짧고 따뜻하게. 질문은 한 번에 하나만.
- 'AI'라는 말을 절대 쓰지 마.
- 회원 답변이 흔들려도 다그치지 말고, 어떻게 고치면 되는지를 보여줘.`;

// 유형별 패턴·첨삭 기준 내장 기본값 — site_config 'rehearsal_patterns' 미설정 시 폴백.
// ⚠️ 마이그레이션 20260718120000 의 시드 JSON 과 동기화할 것.
type RehearsalPattern = { patterns?: string[]; criteria?: string[] };
const DEFAULT_REHEARSAL_PATTERNS: Record<string, RehearsalPattern> = {
  experience: {
    patterns: [
      "행동이 뭉뚱그려져 있으면 구체적 동작을 다시 묻는다 — 그때 정확히 어떻게 했어요?",
      "결과가 \"좋아졌다\"로 끝나면 증거를 묻는다 — 상대가 뭐라고 했나요? 무엇이 달라졌나요?",
      "경험을 기내로 잇는 다리를 묻는다 — 같은 일이 기내에서 벌어지면 어떻게 할래요?",
      "주어가 \"우리\"로 흐리면 본인 몫을 묻는다 — 그중 지원자님이 직접 한 건 뭐예요?",
    ],
    criteria: [
      "장면이 구체적인가(언제·어디서·누구와) — 뭉뚱그린 답변은 초반 30초에 신뢰를 잃는다",
      "무게가 행동(A)에 있는가 — 상황 설명이 절반을 넘으면 구조를 뒤집어야 한다",
      "마무리가 승무원 직무로 연결되는가 — \"배웠다\"로 끝나면 절반짜리",
      "외운 문어체가 아닌가 — 자기 말이어야 꼬리질문에 무너지지 않는다",
    ],
  },
  values: {
    patterns: [
      "그 가치와 충돌하는 상황을 던져 우선순위를 묻는다 — 두 가치가 부딪히면 뭘 지킬래요?",
      "근거 경험이 하나뿐이면 다른 장면을 하나 더 묻는다 — 그 가치가 드러난 다른 순간은요?",
      "가치를 직무와 잇는다 — 그 가치가 기내에서는 어떤 행동으로 나타날까요?",
    ],
    criteria: [
      "사전적 정의가 아니라 자기 경험에 뿌리내린 가치인가",
      "가치를 지키느라 치른 비용(손해·갈등)이 있는가 — 있어야 진짜로 들린다",
      "직무 장면으로 번역되는가",
    ],
  },
  judgment: {
    patterns: [
      "전제를 하나 바꿔 다시 묻는다 — 승객이 이미 화가 난 상태라면요?",
      "안전과 서비스가 충돌하는 변형을 던진다 — 규정을 따르면 승객이 불쾌해질 때는요?",
      "모르는 상황의 행동을 묻는다 — 규정을 모르는 상황이면 어떻게 할래요?",
      "후속까지 묻는다 — 그 다음, 동료·선임에게는 뭘 공유할래요?",
    ],
    criteria: [
      "판단 기준(안전·규정·승객 마음)을 먼저 말하는가",
      "대처 순서가 현실적인가 — 말로만 이상적인 답은 변형 질문에 무너진다",
      "혼자 끝내지 않는가 — 보고·공유·재확인이 붙어야 완성",
    ],
  },
  company: {
    patterns: [
      "정보의 개인적 의미를 묻는다 — 그게 왜 지원자님에게 특별해요?",
      "비교를 시킨다 — 다른 항공사가 아니라 왜 여기예요?",
      "회사의 약점을 아는지 묻는다 — 이 회사가 아쉬운 점은 뭐라고 봐요?",
    ],
    criteria: [
      "정보 나열이 아니라 자기 해석이 있는가",
      "지원자 강점과 회사 방향의 접점이 구체적인가",
      "정보가 최신인가 — 낡은 정보는 준비 부족으로 읽힌다",
    ],
  },
};

// 패턴집 → 프롬프트 텍스트. site_config 값이 이상해도(배열 아님 등) 조용히 기본값으로.
function rehearsalPatternText(category: string, cfg: unknown): string {
  let entry: RehearsalPattern | undefined;
  if (cfg && typeof cfg === "object") {
    entry = (cfg as Record<string, RehearsalPattern>)[category];
  }
  const base = DEFAULT_REHEARSAL_PATTERNS[category] || DEFAULT_REHEARSAL_PATTERNS.experience;
  const patterns = (entry && Array.isArray(entry.patterns) && entry.patterns.length)
    ? entry.patterns : (base.patterns || []);
  const criteria = (entry && Array.isArray(entry.criteria) && entry.criteria.length)
    ? entry.criteria : (base.criteria || []);
  return "[이 유형의 면접관 꼬리질문 패턴 — 여기서 골라 변주해]\n"
    + patterns.map((p) => "- " + String(p).slice(0, 300)).join("\n")
    + "\n\n[연구진 첨삭 기준 — 잘한 점·보완점 판정의 잣대]\n"
    + criteria.map((c) => "- " + String(c).slice(0, 300)).join("\n");
}

// 리허설 대화 이력 → messages. 첫 턴은 항상 합성 user(이력의 첫 interviewer 를 살리기 위해).
function toRehearsalMessages(history: unknown): Array<{ role: string; content: string }> {
  const msgs: Array<{ role: string; content: string }> = [
    { role: "user", content: "(리허설을 시작합니다. 첫 꼬리질문을 해주세요.)" },
  ];
  const items = (Array.isArray(history) ? history : []).slice(-MAX_HISTORY_ITEMS);
  for (const h of items) {
    if (!h || typeof h.content !== "string" || !h.content.trim()) continue;
    const content = h.content.slice(0, MAX_MSG_CHARS);
    if (h.role === "user") msgs.push({ role: "user", content });
    else if (h.role === "interviewer") msgs.push({ role: "assistant", content });
  }
  return msgs;
}
```

- [ ] **Step 2: 핸들러 분기** — `Deno.serve` 안에서 두 가지를 바꾼다.

(a) 현재 "소재 발굴 권한 확인" 블록(`const { data: me } = await supa…403`)보다 **앞**으로 body 파싱을 끌어올리고 stage 판정을 확장한다. 기존:

```ts
    const body = await req.json();
    const stage = body.stage === "refine" ? "refine" : "ask";
```

를 (권한 확인 블록 위로 이동시키며) 다음으로 교체:

```ts
    const body = await req.json();
    const stage = body.stage === "refine" ? "refine"
      : body.stage === "rehearsal" ? "rehearsal" : "ask";

    // ── 리허설 — 소재 발굴 권한(sojae_enabled)과 별개 게이트. ─────────────────
    //    본인 소유 active 세션 존재(=start_rehearsal 로 크레딧 차감 완료)가 유일한 관문.
    //    canned 폴백 없음(스펙): 실패는 그대로 오류로 — 클라이언트가 재시도 안내.
    if (stage === "rehearsal") {
      const sessionId = typeof body.session_id === "string" ? body.session_id : "";
      if (!sessionId) return json({ error: "session_id가 필요합니다" }, 400);
      // RLS(select own) 하에서 조회 — 남의 세션이면 빈 결과 → 403 (크레딧 우회 불가)
      const { data: sess } = await supa
        .from("rehearsal_sessions")
        .select("question_id, answer_snapshot, status")
        .eq("id", sessionId)
        .eq("status", "active")
        .maybeSingle();
      if (!sess) return json({ error: "진행 중인 리허설 세션이 없습니다" }, 403);

      // 문제는 세션의 question_id 로 서버에서 조회(신뢰 원천)
      let qContent = "";
      let category = "experience";
      const { data: q } = await supa
        .from("questions")
        .select("content, category")
        .eq("id", sess.question_id)
        .single();
      if (q) {
        qContent = q.content;
        if (ASK_TYPES[q.category]) category = q.category;
      }

      // 패턴집: site_config 'rehearsal_patterns' → 없거나 깨졌으면 내장 기본값
      let patternsCfg: unknown = null;
      try {
        const { data: pc } = await supa
          .from("site_config").select("value")
          .eq("key", "rehearsal_patterns").maybeSingle();
        if (pc) patternsCfg = pc.value;
      } catch (_) { /* site_config 미적용 등 — 기본값 사용 */ }

      const snapshot = String(sess.answer_snapshot || "").slice(0, MAX_MATERIALS_CHARS);
      const system = [
        // 안정 프리픽스: 시스템 + 유형 패턴집까지 캐시(세션·문제와 무관하게 동일)
        { type: "text", text: REHEARSAL_SYSTEM },
        {
          type: "text",
          text: rehearsalPatternText(category, patternsCfg),
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: `문제: ${qContent}\n문제 유형: ${CAT_LABEL[category]}\n` +
            `회원이 완성해 온 답변(이걸 놓고 코칭한다):\n${snapshot}`,
        },
      ];
      const messages = toRehearsalMessages(body.history);

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: REHEARSAL_MODEL, max_tokens: 8192, system, messages,
        }),
      });
      if (!res.ok) {
        console.error("anthropic error(rehearsal)", res.status, await res.text());
        return json({ error: "코칭 응답을 받지 못했어요" }, 502);
      }
      const data = await res.json();

      // 원가 실측 — usage 누적(캐시 생성·읽기 포함 총 입력 규모). 실패해도 대화는 계속.
      try {
        const u = data.usage || {};
        await supa.rpc("add_rehearsal_usage", {
          p_session_id: sessionId,
          p_input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) +
            (u.cache_read_input_tokens || 0),
          p_output: u.output_tokens || 0,
        });
      } catch (e) { console.error("usage 누적 실패", e); }

      let text = (data.content || [])
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text)
        .join("\n")
        .trim();
      if (!text) return json({ error: "빈 응답" }, 502);

      // 종합 첨삭 종료 마커 → done. 마커는 회원에게 보이지 않게 제거.
      let done = false;
      if (text.includes(REHEARSAL_DONE_MARKER)) {
        done = true;
        text = text.split(REHEARSAL_DONE_MARKER).join("").trim();
      }
      return json({ message: text, done }, 200);
    }
```

(b) 기존 "소재 발굴 권한 확인" 블록(`// 소재 발굴 권한 확인 …` 주석부터 403 반환까지)은 위 리허설 분기 **다음**에 그대로 두되, 주석에 한 줄 추가: `// (rehearsal 은 위에서 이미 분기 — 이 검사는 ask/refine 전용)`. 그 아래 기존 `let qContent = ""` 이후 ask/refine 흐름은 무변경.

- [ ] **Step 3: 검증 — Deno 문법 체크**

```bash
deno check /c/Users/cheess/Documents/GitHub/wkon/supabase/functions/sojae-chat/index.ts
```
Expected: 에러 없음. (deno 미설치면 `node --input-type=module` 검사 불가하므로 최소한 괄호·중복 선언을 재검토하고, Task 9 오너 배포 시 콘솔 배포 화면의 문법 오류 표시로 최종 확인.)

- [ ] **Step 4: 커밋**

```bash
git add supabase/functions/sojae-chat/index.ts
printf '%s\n' "feat(리허설): sojae-chat에 stage=rehearsal 분기 — Opus 4.8 코칭" "" "- active 세션 없으면 403(크레딧 우회 불가), 소재 발굴 권한과 별개 게이트" "- site_config rehearsal_patterns 주입(없으면 내장 기본값), 시스템+패턴 프리픽스 캐시" "- usage 누적(add_rehearsal_usage), 종료 마커 <<REHEARSAL_DONE>> → done:true" "- canned 폴백 없음(스펙) — 실패는 오류로 반환" > /tmp/cmsg.txt
git commit -F /tmp/cmsg.txt
```

---

### Task 4: `rehearsal.html` 신규 페이지

**Files:**
- Create: `rehearsal.html`

- [ ] **Step 1: 페이지 전체 작성**

sojae.html 의 채팅 패턴(말풍선·자동 성장 textarea·복원)을 재사용. 아래 코드 그대로 생성.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="color-scheme" content="light" />
  <title>MONC · 면접관 리허설</title>
  <link rel="stylesheet" href="tokens.css">
  <style>
    /* 다크모드 단말에서 입력칸이 브라우저 기본 다크로 렌더되는 것 차단 (sojae.html 과 동일) */
    html { color-scheme: light; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Pretendard', 'Apple SD Gothic Neo', -apple-system, sans-serif;
      background: var(--bg); color: var(--text);
      height: 100vh; height: 100svh; display: flex; flex-direction: column;
      max-width: 480px; margin: 0 auto; line-height: 1.5;
    }

    .appbar { display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; gap: 10px; flex: 0 0 auto; }
    .appbar .back { display: inline-flex; align-items: center; gap: 6px;
      font-size: 16px; font-weight: 700; color: var(--text); text-decoration: none;
      min-height: 44px; }
    .appbar .back svg { width: 18px; height: 18px; }
    .badge { display: inline-flex; align-items: center; background: var(--accent-tint);
      color: var(--accent-ink); font-size: 12px; font-weight: 700; padding: 5px 11px; border-radius: 999px; }

    .stepbar { display: flex; align-items: center; gap: 6px; padding: 0 16px 10px;
      font-size: 12px; color: var(--text-muted); flex: 0 0 auto; flex-wrap: wrap; }
    .stepbar .on { color: var(--action); font-weight: 700; }
    .stepbar .sep { opacity: .5; }

    /* 검증 대상 답변(스냅샷) — 접이식. 회원이 뭘 방어 중인지 안 잊게 */
    .snap { margin: 0 16px 10px; border: 1px solid var(--border-soft); border-radius: 12px;
      background: var(--surface); flex: 0 0 auto; }
    .snap summary { list-style: none; cursor: pointer; padding: 10px 14px; min-height: 44px;
      display: flex; align-items: center; justify-content: space-between;
      font-size: 13px; font-weight: 700; color: var(--accent-ink); }
    .snap summary::-webkit-details-marker { display: none; }
    .snap summary .arr { transition: transform .2s; }
    .snap[open] summary .arr { transform: rotate(180deg); }
    .snap-body { padding: 0 14px 12px; font-size: 13px; line-height: 1.6;
      color: var(--text-muted); white-space: pre-wrap; max-height: 180px; overflow-y: auto; }

    .chat { flex: 1 1 auto; overflow-y: auto; padding: 4px 16px 8px;
      display: flex; flex-direction: column; gap: 12px; }
    .who { display: flex; align-items: center; gap: 6px; font-size: 12px;
      color: var(--accent-ink); font-weight: 700; margin-bottom: 5px; }
    .ava { width: 20px; height: 20px; border-radius: 50%; background: var(--accent-ink);
      color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }
    .bub { max-width: 84%; font-size: 15px; line-height: 1.55; padding: 11px 13px; border-radius: 16px; }
    .bub b { font-weight: 700; }
    .ai { align-self: flex-start; background: var(--surface); border: 1px solid var(--border-soft);
      border-bottom-left-radius: 6px; color: var(--text); }
    .me { align-self: flex-end; background: var(--action); color: var(--action-ink);
      border-bottom-right-radius: 6px; }

    .composer { flex: 0 0 auto; padding: 8px 16px calc(12px + env(safe-area-inset-bottom));
      background: var(--bg); border-top: 1px solid var(--border-soft); }
    .retry-row { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-bottom: 10px; }
    .retry-note { font-size: 12px; color: var(--text-muted); text-align: center; }
    .pill { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700;
      border-radius: 999px; padding: 10px 18px; min-height: 44px; cursor: pointer;
      background: var(--surface); color: var(--accent-ink); border: 1.5px solid var(--accent-dark);
      color-scheme: light; }
    .field { display: flex; align-items: center; gap: 8px; background: var(--bg2);
      border: 1px solid var(--border-soft); border-radius: 18px; padding: 8px 8px 8px 14px;
      color-scheme: light; }
    .field textarea { flex: 1; border: none; outline: none; background: var(--bg2); color: var(--text);
      resize: none; overflow: hidden; font-family: inherit; font-size: 15px; line-height: 1.6;
      min-height: 26px; max-height: 132px; padding: 3px 0; color-scheme: light; }
    .field textarea::placeholder { color: var(--text-dim); }
    .snd { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; border: 1px solid var(--border);
      background: var(--surface); color: var(--text-dim); display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: background .15s, color .15s, transform .1s; color-scheme: light; }
    .snd svg { width: 20px; height: 20px; }
    .snd.on { background: var(--action); color: var(--action-ink); border-color: transparent; }
    .snd:active { transform: scale(.94); }
    .foot { text-align: center; margin-top: 8px; font-size: 12px; color: var(--text-muted); }

    /* 시작 확인 / 안내 게이트 */
    .gate { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
      text-align: center; padding: 32px 24px; gap: 13px; }
    .gate h1 { font-size: 19px; font-weight: 800; line-height: 1.4; }
    .gate p { font-size: 14px; color: var(--text-muted); line-height: 1.65; }
    .gate .gq { font-size: 14px; font-weight: 700; line-height: 1.5; background: var(--surface);
      border: 1px solid var(--border-soft); border-radius: 12px; padding: 12px 16px; max-width: 340px; }
    .gate .credit { font-size: 13px; font-weight: 700; color: var(--accent-ink);
      background: var(--accent-tint); border-radius: 999px; padding: 6px 14px; }
    .gate .go { display: inline-flex; align-items: center; justify-content: center;
      background: var(--action); color: var(--action-ink); font-weight: 700; font-size: 15px;
      border: 0; border-radius: 14px; padding: 14px 24px; min-height: 48px; cursor: pointer; }
    .gate .go:disabled { opacity: .6; cursor: default; }
    .gate .sub { font-size: 12px; color: var(--text-dim); }
    .gate .ghost { display: inline-flex; align-items: center; justify-content: center;
      color: var(--accent-ink); font-weight: 700; font-size: 14px; text-decoration: none;
      border: 1.5px solid var(--accent-dark); border-radius: 14px; padding: 12px 22px;
      min-height: 44px; background: var(--surface); }

    /* 완료(종합 첨삭) 하단 액션 */
    .done-actions { flex: 0 0 auto; padding: 10px 16px calc(14px + env(safe-area-inset-bottom));
      border-top: 1px solid var(--border-soft); background: var(--bg);
      display: flex; flex-direction: column; gap: 8px; }
    .done-actions a, .done-actions button { display: block; width: 100%; text-align: center;
      border-radius: 13px; padding: 13px; font-size: 14px; font-weight: 700; min-height: 44px;
      text-decoration: none; cursor: pointer; }
    .da-fix { background: var(--action); color: var(--action-ink); border: 0; }
    .da-retry { background: transparent; color: var(--action); border: 1.5px solid var(--action); }
  </style>
</head>
<body>
  <div class="appbar">
    <a class="back" href="mypage.html">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
      면접관 리허설
    </a>
    <span class="badge" id="catBadge">경험 발굴형</span>
  </div>

  <div class="stepbar" id="stepbar" style="display:none;">
    <span class="on" id="rs1">코칭 1</span><span class="sep">›</span>
    <span id="rs2">2</span><span class="sep">›</span>
    <span id="rs3">3</span><span class="sep">›</span>
    <span id="rs4">종합 첨삭</span>
  </div>

  <details class="snap" id="snapBox" style="display:none;">
    <summary><span>리허설 중인 내 답변 보기</span><span class="arr">▾</span></summary>
    <div class="snap-body" id="snapBody"></div>
  </details>

  <div class="gate" id="gate"><p>불러오는 중…</p></div>

  <div class="chat" id="chat" style="display:none;"></div>

  <div class="composer" id="composer" style="display:none;">
    <div class="retry-row" id="retryRow" style="display:none;">
      <span class="retry-note" id="retryNote"></span>
      <button class="pill" id="retryBtn">코칭 다시 받기</button>
    </div>
    <div class="field">
      <textarea id="ta" rows="1" placeholder="면접장이라고 생각하고 답해보세요"></textarea>
      <button class="snd" id="snd" aria-label="전송">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
      </button>
    </div>
    <div class="foot">Enter 전송 · Shift+Enter 줄바꿈</div>
  </div>

  <div class="done-actions" id="doneActions" style="display:none;">
    <a class="da-fix" id="fixLink" href="#">답변 보완하러 가기</a>
    <button class="da-retry" id="retryRehearsal">다시 리허설 (리허설권 1개)</button>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="supabase-config.js"></script>
  <script src="sojae-common.js"></script>
  <script>
    const CAT_LABEL = window.SOJAE.CAT_LABEL;
    let _uid = null, qid = null, question = null;
    let sessionRow = null;         // rehearsal_sessions 현재 행
    let transcript = [];           // [{role:'interviewer'|'user', content}]
    let _busy = false, _done = false, _balance = 0;

    const chat = document.getElementById('chat');
    const gate = document.getElementById('gate');
    function esc(s){ return (s==null?'':String(s)).replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
    function show(id, on){ document.getElementById(id).style.display = on ? '' : 'none'; }

    // ── 렌더 (sojae.html 패턴) ──
    function bubble(cls, html){
      const d = document.createElement('div');
      d.className = 'bub ' + cls; d.innerHTML = html;
      chat.appendChild(d); chat.scrollTop = chat.scrollHeight;
      return d;
    }
    function interviewer(html){
      bubble('ai', '<div class="who"><span class="ava">R</span>연구원</div>' + html);
    }
    function me(text){ bubble('me', esc(text)); }
    function aiPending(){
      const d = document.createElement('div');
      d.className = 'bub ai';
      d.innerHTML = '<div class="who"><span class="ava">R</span>연구원</div><span style="color:var(--text-muted);">생각 중…</span>';
      chat.appendChild(d); chat.scrollTop = chat.scrollHeight;
      return d;
    }

    // ── 스텝바: 회원 답변 수 기준. 0~1개=코칭1, 2개=2, 3개=3, done=종합 첨삭 ──
    function updateSteps(){
      const n = transcript.filter(t => t.role === 'user').length;
      const ids = ['rs1','rs2','rs3','rs4'];
      ids.forEach(i => document.getElementById(i).classList.remove('on'));
      if (_done) { ids.forEach(i => document.getElementById(i).classList.add('on')); return; }
      const step = Math.min(Math.max(n, 1), 3);   // 1~3
      for (let i = 0; i < step; i++) document.getElementById(ids[i]).classList.add('on');
    }

    // ── 서버 저장 (메시지는 생길 때마다 즉시 insert — 복원은 그대로 읽기만) ──
    async function saveMsg(role, content){
      try {
        await MONC.sb.from('rehearsal_messages').insert(
          { session_id: sessionRow.id, member_id: _uid, role, content });
      } catch (_) {}   // 저장 실패해도 대화는 계속(다음 메시지에서 다시 시도되는 구조는 아님 — 로그 성격)
    }

    async function callCoach(){
      const { data, error } = await MONC.sb.functions.invoke('sojae-chat', {
        body: { stage: 'rehearsal', session_id: sessionRow.id, history: transcript },
      });
      if (error || !data || !data.message) throw (error || new Error('빈 응답'));
      return data;   // { message, done }
    }

    function showRetry(note){
      document.getElementById('retryNote').textContent = note;
      show('retryRow', true);
    }
    function hideRetry(){ show('retryRow', false); }

    // ── 코칭 응답 받기(첫 질문·답변 후·재시도 공통). canned 폴백 없음(스펙) ──
    async function requestCoach(){
      if (_busy || _done) return;
      _busy = true; hideRetry();
      const p = aiPending();
      try {
        const data = await callCoach();
        const html = esc(data.message).replace(/\n/g, '<br>');
        p.innerHTML = '<div class="who"><span class="ava">R</span>연구원</div>' + html;
        chat.scrollTop = chat.scrollHeight;
        transcript.push({ role: 'interviewer', content: data.message });
        saveMsg('interviewer', data.message);
        if (data.done) await finishSession(data.message);
        updateSteps();
      } catch (_) {
        p.remove();
        // 차감은 세션 시작 시 1회뿐 — 재시도에 추가 비용 없음(스펙 명시 문구)
        showRetry('연구원 연결이 잠시 원활하지 않아요. 다시 받아도 리허설권이 더 들지 않아요.');
      }
      _busy = false;
    }

    // ── 종료: verdict 저장 + done UI ──
    async function finishSession(report){
      _done = true;
      try { await MONC.sb.rpc('finish_rehearsal', { p_session_id: sessionRow.id, p_verdict: report }); }
      catch (_) {}
      enterDoneUI();
    }
    function enterDoneUI(){
      show('composer', false);
      show('doneActions', true);
      document.getElementById('fixLink').href = 'sojae.html?q=' + encodeURIComponent(qid);
      updateSteps();
    }

    // ── 입력/전송 ──
    const ta = document.getElementById('ta'), snd = document.getElementById('snd');
    function grow(){ ta.style.height='auto'; ta.style.height = Math.min(ta.scrollHeight,132)+'px'; }
    function toggle(){ ta.value.trim() ? snd.classList.add('on') : snd.classList.remove('on'); }
    function send(){
      const v = ta.value.trim(); if(!v || _busy || _done) return;
      me(v); ta.value=''; grow(); toggle();
      transcript.push({ role: 'user', content: v });
      saveMsg('user', v);
      updateSteps();
      requestCoach();
    }
    ta.addEventListener('input', ()=>{ grow(); toggle(); });
    ta.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } });
    snd.addEventListener('click', send);
    document.getElementById('retryBtn').addEventListener('click', requestCoach);

    // ── 게이트 화면들 ──
    function showGate(html){ gate.innerHTML = html; show('gate', true); }
    function hideGate(){ show('gate', false); }
    function showNotReady(){
      showGate('<h1>면접관 리허설이 아직 준비 중이에요</h1>'
        + '<p>곧 만나요. 그동안 답변노트는 마이페이지에서 볼 수 있어요.</p>'
        + '<a class="ghost" href="mypage.html">마이페이지로</a>');
    }
    function showNoAnswer(){
      showGate('<h1>완성한 답변이 있어야 리허설할 수 있어요</h1>'
        + '<p>소재 발굴에서 이 문제의 답변을 <b>답변집에 저장(완료)</b>한 뒤 다시 와주세요.</p>'
        + '<a class="ghost" href="sojae.html?q=' + encodeURIComponent(qid) + '">답변 완성하러 가기</a>');
    }
    function showConfirmStart(){
      _done = false;
      show('doneActions', false); show('composer', false); show('chat', false);
      show('stepbar', false); show('snapBox', false);
      const qHtml = question ? '<div class="gq">' + esc(question.content) + '</div>' : '';
      if (_balance < 1) {
        showGate('<h1>리허설권이 없어요</h1>' + qHtml
          + '<p>리허설권은 챌린지 수강생 혜택으로 지급돼요.<br>'
          + '지급받지 못했다면 관리자에게 문의해 주세요.</p>'
          + '<span class="credit">남은 리허설권 0개</span>'
          + '<a class="ghost" href="mypage.html">마이페이지로</a>');
        return;
      }
      showGate('<h1>면접관 리허설을 시작할까요?</h1>' + qHtml
        + '<p>연구원이 면접관 질문 패턴으로 꼬리질문을 던지고,<br>'
        + '라운드마다 코칭한 뒤 마지막에 종합 첨삭을 드려요.</p>'
        + '<span class="credit">남은 리허설권 ' + _balance + '개</span>'
        + '<button class="go" id="startBtn">리허설권 1개 사용하고 시작</button>'
        + '<span class="sub">중간에 나가도 이어할 수 있어요 (추가 차감 없음)</span>');
      document.getElementById('startBtn').addEventListener('click', startRehearsal);
    }

    async function startRehearsal(){
      const btn = document.getElementById('startBtn');
      if (btn) { btn.disabled = true; btn.textContent = '시작하는 중…'; }
      const { data: sid, error } = await MONC.sb.rpc('start_rehearsal', { p_question_id: qid });
      if (error) {
        const msg = String(error.message || '');
        if (msg.includes('no_credit')) { _balance = 0; showConfirmStart(); return; }
        if (msg.includes('no_final_answer')) { showNoAnswer(); return; }
        showGate('<h1>시작하지 못했어요</h1><p>' + esc(msg) + '</p>'
          + '<a class="ghost" href="mypage.html">마이페이지로</a>');
        return;
      }
      const { data: s } = await MONC.sb.from('rehearsal_sessions')
        .select('*').eq('id', sid).single();
      sessionRow = s;
      await enterSession();
    }

    // ── 세션 진입(active=이어하기 / done=읽기 전용 리플레이) ──
    async function enterSession(){
      hideGate();
      transcript = []; chat.innerHTML = '';
      _done = sessionRow.status === 'done';
      show('stepbar', true); show('chat', true);
      // 스냅샷(시작 시점 답변 원문 — answers 가 아니라 세션에서)
      document.getElementById('snapBody').textContent = sessionRow.answer_snapshot || '';
      show('snapBox', true);
      // 저장된 대화 복원
      const { data: msgs } = await MONC.sb.from('rehearsal_messages')
        .select('role, content').eq('session_id', sessionRow.id)
        .order('created_at', { ascending: true });
      (msgs || []).forEach(m => {
        transcript.push({ role: m.role, content: m.content });
        if (m.role === 'user') me(m.content);
        else interviewer(esc(m.content).replace(/\n/g, '<br>'));
      });
      updateSteps();
      if (_done) { enterDoneUI(); return; }
      show('composer', true);
      if (!transcript.length) {
        requestCoach();                                    // 새 세션 — 첫 꼬리질문 받기
      } else if (transcript[transcript.length - 1].role === 'user') {
        // 답변은 보냈는데 코칭 응답을 못 받고 나간 경우 — 재시도 버튼으로 복구
        showRetry('받지 못한 코칭이 있어요. 다시 받아주세요 (리허설권 추가 차감 없음).');
      }
    }

    // 다시 리허설 — 새 세션(새 리허설권). 확인 화면부터 다시.
    document.getElementById('retryRehearsal').addEventListener('click', async () => {
      try { const { data: bal } = await MONC.sb.rpc('grant_welcome_credit'); _balance = bal ?? 0; }
      catch (_) {}
      showConfirmStart();
    });

    // ── 진입: 로그인·동의 → 문제 확정 → 준비 확인(웰컴 크레딧 lazy) → 세션 라우팅 ──
    (async () => {
      const session = await MONC.requireSession();
      if (!session) return;
      if (!(await MONC.requireConsent())) return;
      _uid = session.user.id;
      qid = new URLSearchParams(location.search).get('q');
      if (!qid) { location.replace('mypage.html'); return; }

      try {
        const { data: q } = await MONC.sb.from('questions').select('*').eq('id', qid).maybeSingle();
        question = q || null;
      } catch (_) {}
      if (question && CAT_LABEL[question.category])
        document.getElementById('catBadge').textContent = CAT_LABEL[question.category];

      // 준비 확인 + 무료 1회 lazy 지급 — RPC 미존재(마이그레이션 미적용)면 준비 중 안내
      const { data: bal, error: balErr } = await MONC.sb.rpc('grant_welcome_credit');
      if (balErr) { showNotReady(); return; }
      _balance = bal ?? 0;

      // 이 문제의 세션들: active 우선, 없으면 최신 done 리플레이, 둘 다 없으면 시작 확인
      const { data: sess } = await MONC.sb.from('rehearsal_sessions')
        .select('*').eq('member_id', _uid).eq('question_id', qid)
        .order('created_at', { ascending: false });
      const active = (sess || []).find(s => s.status === 'active');
      const latest = (sess || [])[0] || null;
      if (active)      { sessionRow = active; await enterSession(); }   // 확인 화면 없이 즉시 복원(스펙)
      else if (latest) { sessionRow = latest; await enterSession(); }   // done — 읽기 전용 리플레이
      else showConfirmStart();
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: 렌더 검증 (375px + degradation 실전)**

1. `preview_start` 로 `wkon-static` 서버 실행(launch.json 정의됨), `resize_window` 375×812.
2. `rehearsal.html?q=test` 접속 → 미로그인이므로 login.html 로 리다이렉트되는지 확인(콘솔에 리다이렉트 이전 JS 문법 오류가 없어야 함 — `read_console_messages` 로 SyntaxError 0건 확인).
3. 게이트 화면 마크업 검증은 로그인 없이 불가 → JS 검사로 대체: `javascript_tool` 로 `typeof showConfirmStart` 등은 리다이렉트 때문에 불가하므로, **파일을 `?q=` 없이 열지 말고** 정적 검사(콘솔 무에러)로 종결. 로그인 흐름은 Task 9 오너 체크리스트.

- [ ] **Step 3: 커밋**

```bash
git add rehearsal.html
printf '%s\n' "feat(리허설): rehearsal.html — 시작 확인·코칭 대화·종합 첨삭·리플레이" "" "- sojae 채팅 패턴 재사용, 스텝바(코칭 1›2›3›종합 첨삭), 답변 스냅샷 접이식" "- active 세션 즉시 복원(추가 차감 없음), done 세션 읽기 전용 + 다시 리허설" "- 잔액 0 충전 안내(수강생 혜택/관리자 문의), 실패 시 canned 없이 재시도 버튼" "- 마이그레이션 미적용 시 '준비 중' 안내로 degradation" > /tmp/cmsg.txt
git commit -F /tmp/cmsg.txt
```

---

### Task 5: mypage.html — 완료 노트 리허설 진입점 + 배지

**Files:**
- Modify: `mypage.html` (`loadAnswerNotes` 함수와 `<style>` 블록)

- [ ] **Step 1: CSS 추가** — 스타일 블록의 `.note-draft .note-more { … }` 규칙(133행 부근) 아래에:

```css
    /* 면접관 리허설 (완료 노트 전용) */
    .note-rh-badge { display: inline-block; background: #eaf6ec; color: #1a7f37; font-size: 11px;
      font-weight: 700; padding: 3px 9px; border-radius: 999px; margin-left: 6px; white-space: nowrap; }
    .note-rh-btn { display: inline-flex; align-items: center; justify-content: center; margin: 10px 14px 14px;
      min-height: 44px; padding: 10px 18px; border-radius: 999px; font-size: 13px; font-weight: 700;
      color: var(--accent-ink); background: var(--surface); border: 1.5px solid var(--accent-dark);
      text-decoration: none; }
```

- [ ] **Step 2: `loadAnswerNotes` 수정** — 함수 안에서 두 군데.

(a) `const drafts = data.filter(…)` 줄 **앞**에 리허설 세션 조회 추가(마이그레이션 미적용이면 조용히 전부 숨김 — graceful degradation):

```js
        // 리허설 세션 — 테이블 미적용(마이그레이션 전)이면 rhOk=false → 버튼·배지 전부 숨김
        let rhOk = false; const rhDone = new Set(), rhActive = new Set();
        try {
          const { data: rh, error: rhErr } = await MONC.sb.from('rehearsal_sessions')
            .select('question_id, status').eq('member_id', memberId);
          if (!rhErr && rh) {
            rhOk = true;
            rh.forEach(s => (s.status === 'done' ? rhDone : rhActive).add(s.question_id));
          }
        } catch (_) {}
```

(b) `finalCard` 를 다음으로 교체(배지는 제목 줄, 버튼은 펼친 본문 아래):

```js
        const finalCard = a => {
          const q = a.questions || {};
          const badge = rhDone.has(a.question_id) ? '<span class="note-rh-badge">리허설 완료</span>' : '';
          const rhLabel = rhActive.has(a.question_id) ? '리허설 이어하기 →'
            : rhDone.has(a.question_id) ? '리허설 다시 보기 →' : '면접관 리허설 →';
          const rhBtn = rhOk
            ? `<a class="note-rh-btn" href="rehearsal.html?q=${encodeURIComponent(a.question_id)}">${rhLabel}</a>`
            : '';
          return `<details class="note">
            <summary>
              <div class="note-top"><span class="note-cat">${esc(catOf(q))}</span><span class="note-date">${fmt(a.updated_at)}</span></div>
              <div class="note-q">${esc(q.content || '(문제 정보 없음)')}${badge}</div>
              <span class="note-more">답변 보기 ▾</span>
            </summary>
            <div class="note-a">${esc(a.content)}</div>${rhBtn}
          </details>`;
        };
```

- [ ] **Step 3: 검증** — 지금 프로덕션 DB에는 `rehearsal_sessions` 가 없으므로 이 상태가 degradation 실전 테스트다. 375px 로 mypage 접속(미로그인 리다이렉트 전 콘솔 SyntaxError 0건). 로그인 상태 확인(버튼 미노출·기존 노트 정상)은 Task 9 오너 체크리스트로.

- [ ] **Step 4: 커밋**

```bash
git add mypage.html
git commit -m "feat(리허설): 마이페이지 완료 노트에 리허설 버튼·배지 — 마이그레이션 미적용 시 자동 숨김"
```

---

### Task 6: sojae.html — 저장(완료) 직후 리허설 CTA

**Files:**
- Modify: `sojae.html` (saveBtn 핸들러와 그 아래)

- [ ] **Step 1: CTA 함수 추가** — `// ── 답변집 저장 …` 주석(444행 부근) 위에 삽입:

```js
    // ── 저장(완료) 직후 리허설 CTA — 테이블 미적용이면 조용히 생략(graceful) ──
    async function showRehearsalCta(){
      if (!currentQuestion || document.getElementById('rehearsalCta')) return;
      try {
        const { error } = await MONC.sb.from('rehearsal_sessions')
          .select('id', { count: 'exact', head: true });
        if (error) return;                       // 마이그레이션 미적용 → CTA 숨김
      } catch (_) { return; }
      const a = document.createElement('a');
      a.id = 'rehearsalCta';
      a.href = 'rehearsal.html?q=' + encodeURIComponent(currentQuestion.id);
      a.textContent = '이 답변, 면접관 리허설로 점검받기 →';
      a.style.cssText = 'display:flex;align-items:center;justify-content:center;margin-top:10px;'
        + 'min-height:44px;border:1.5px solid var(--accent-dark);border-radius:13px;'
        + 'color:var(--accent-ink);font-size:14px;font-weight:700;text-decoration:none;background:var(--surface);';
      document.getElementById('saveFoot').after(a);
    }
```

- [ ] **Step 2: 저장 성공 시 호출** — saveBtn 핸들러의 성공 분기, `syncServer('done');` 바로 다음 줄에:

```js
          showRehearsalCta();   // 완료 답변에만 노출(스펙: status='final' 대상)
```

- [ ] **Step 3: 검증** — sojae.html 접속 시 콘솔 SyntaxError 0건(미로그인 리다이렉트 전). 저장 흐름은 Task 9.

- [ ] **Step 4: 커밋**

```bash
git add sojae.html
git commit -m "feat(리허설): 소재 발굴 저장(완료) 직후 리허설 CTA 한 줄 — 미적용 시 자동 생략"
```

---

### Task 7: admin.html — 리허설권 관리 탭

**Files:**
- Modify: `admin.html` (탭 버튼·패널·JS·초기 로드)

- [ ] **Step 1: 탭 버튼 추가** — `#tabs` 안 `기출문제` 버튼 다음에:

```html
    <button class="tabbtn" data-tab="rehearsal">리허설권</button>
```

- [ ] **Step 2: 패널 마크업 추가** — `#panel-questions` 닫는 `</div>` 다음에:

```html
  <div class="tab-panel" id="panel-rehearsal">
    <div class="cm-wrap">
      <div class="rv-hint">회원별 <b>리허설권</b>(면접관 리허설 횟수권) 잔액을 보고 지급·회수합니다.
        잔액은 원장(point_ledger)의 합계 — 지급·회수는 새 행을 추가하는 방식이라 이력이 전부 남아요.
        아래 <b>세션 통계</b>는 충전 가격 책정용 실측 원가 데이터입니다(토큰 수 × 모델 단가).</div>
      <div class="cm-block" id="rhStats"><div class="loading">불러오는 중…</div></div>
      <div class="cm-block">
        <div class="rv-section-title">일괄 지급 — 특정 기수 전원 +N (챌린지 신청 혜택)</div>
        <div class="prow">
          <div class="field"><label>기수</label><select id="rhBulkCohort"><option value="">기수 선택…</option></select></div>
          <div class="field"><label>지급 개수</label><input id="rhBulkN" type="number" value="3" min="1" style="width:80px"></div>
          <div class="field" style="flex:1;min-width:140px;"><label>사유</label><input id="rhBulkNote" placeholder="예: 3기 신청 혜택"></div>
          <button class="btn btn-action" id="rhBulkGrant">기수 전원 지급</button>
        </div>
      </div>
      <div class="cm-block">
        <div class="rv-section-title">회원별 잔액 · 지급/회수</div>
        <input class="search" id="rhSearch" placeholder="이름·이메일 검색">
        <div class="round-list" id="rhList"><div class="loading">불러오는 중…</div></div>
      </div>
    </div>
  </div>
```

- [ ] **Step 3: JS 추가** — `// ── 기출문제(questions) CRUD ──` 주석 위에 삽입:

```js
    // ── 리허설권(point_ledger) 관리 ──
    // 마이그레이션(20260718120000) 미적용이면 탭 안에 안내만 표시(다른 탭은 무영향).
    let _ledger = [];                       // 전체 원장(관리자 RLS)
    function rhBalanceMap() {
      const map = {};
      _ledger.forEach(r => { map[r.member_id] = (map[r.member_id] || 0) + r.delta; });
      return map;
    }
    async function loadRehearsalAdmin() {
      const listEl = document.getElementById('rhList');
      const { data, error } = await sb().from('point_ledger')
        .select('member_id, delta, reason, ref, created_at')
        .order('created_at', { ascending: false });
      if (error) {
        document.getElementById('rhStats').innerHTML = '';
        listEl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;line-height:1.7;padding:8px;">
          불러오기 실패: ${esc(error.message)}<br><br>
          <b>리허설 테이블이 아직 없다면</b> 저장소의
          <b>supabase/migrations/20260718120000_rehearsal.sql</b> 을
          SQL Editor에서 실행한 뒤 이 탭을 다시 열어주세요.</div>`;
        return;
      }
      _ledger = data || [];
      // 기수 셀렉트(일괄 지급)
      const bulkSel = document.getElementById('rhBulkCohort');
      const keep = bulkSel.value;
      bulkSel.innerHTML = '<option value="">기수 선택…</option>' +
        cohorts.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
      bulkSel.value = keep;
      renderRhStats();
      renderRhList();
    }

    async function renderRhStats() {
      const el = document.getElementById('rhStats');
      const { data, error } = await sb().from('rehearsal_sessions')
        .select('status, input_tokens, output_tokens');
      if (error) { el.innerHTML = ''; return; }
      const all = data || [];
      const done = all.filter(s => s.status === 'done');
      const avg = (arr, f) => arr.length ? Math.round(arr.reduce((s, x) => s + (f(x) || 0), 0) / arr.length) : 0;
      el.innerHTML = `<div class="rv-section-title">세션 통계 (원가 실측)</div>
        <div style="font-size:14px;line-height:2;">
          세션 <b>${all.length}</b>개 (완료 ${done.length} · 진행 중 ${all.length - done.length})<br>
          완료 세션 평균 — 입력 <b>${avg(done, s => s.input_tokens).toLocaleString()}</b> 토큰 ·
          출력 <b>${avg(done, s => s.output_tokens).toLocaleString()}</b> 토큰
          <span style="font-size:12px;color:var(--text-muted);">(캐시 포함 총 입력 — 단가를 곱해 세션당 실원가 산출)</span>
        </div>`;
    }

    function renderRhList() {
      const listEl = document.getElementById('rhList');
      const q = (document.getElementById('rhSearch').value || '').trim().toLowerCase();
      const bal = rhBalanceMap();
      const list = members.filter(m => !q
        || (m.name && m.name.toLowerCase().includes(q))
        || (m.email && m.email.toLowerCase().includes(q))).slice(0, 30);
      if (!list.length) { listEl.innerHTML = '<div style="color:var(--text-dim);font-size:13px;padding:8px;">일치하는 회원이 없습니다.</div>'; return; }
      listEl.innerHTML = list.map(m => `
        <div class="round-item" data-mid="${m.id}">
          <div>
            <div class="ri-main">${esc(m.name || '(이름 없음)')} · <b style="color:var(--action-dark)">${bal[m.id] || 0}개</b></div>
            <div class="ri-sub">${esc(m.email || '이메일 없음')}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-end;">
            <input class="rh-n" type="number" value="1" min="1" style="width:56px;padding:6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:13px;">
            <input class="rh-note" placeholder="사유" style="width:110px;padding:6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:13px;">
            <button class="ri-del rh-give" style="color:#1a7f37;border-color:#1a7f37;">지급</button>
            <button class="ri-del rh-take">회수</button>
            <button class="ri-del rh-log">내역</button>
          </div>
        </div>
        <div class="rh-ledger" data-for="${m.id}" style="display:none;font-size:12px;color:var(--text-muted);padding:4px 14px 10px;"></div>`).join('');

      // 지급/회수 — reason 은 admin_grant 고정(회수=음수 delta), 자유 사유는 ref 에.
      const grant = async (mid, delta, note) => {
        const { error } = await sb().from('point_ledger').insert(
          { member_id: mid, delta, reason: 'admin_grant', ref: note || null, created_by: myProfile.id });
        if (error) { alert('실패: ' + error.message); return; }
        toast((delta > 0 ? '+' : '') + delta + '개 반영됨');
        loadRehearsalAdmin();
      };
      listEl.querySelectorAll('.rh-give').forEach(b => b.addEventListener('click', () => {
        const row = b.closest('.round-item');
        const n = Math.max(1, parseInt(row.querySelector('.rh-n').value, 10) || 1);
        grant(row.dataset.mid, n, row.querySelector('.rh-note').value.trim());
      }));
      listEl.querySelectorAll('.rh-take').forEach(b => b.addEventListener('click', () => {
        const row = b.closest('.round-item');
        const n = Math.max(1, parseInt(row.querySelector('.rh-n').value, 10) || 1);
        const m = members.find(x => x.id === row.dataset.mid);
        if (!confirm(`${(m && m.name) || '이 회원'} 님에게서 ${n}개를 회수할까요? (잔액이 음수가 될 수 있어요)`)) return;
        grant(row.dataset.mid, -n, row.querySelector('.rh-note').value.trim() || '관리자 회수');
      }));
      // 내역 토글
      listEl.querySelectorAll('.rh-log').forEach(b => b.addEventListener('click', () => {
        const mid = b.closest('.round-item').dataset.mid;
        const box = listEl.querySelector(`.rh-ledger[data-for="${mid}"]`);
        if (box.style.display !== 'none') { box.style.display = 'none'; return; }
        const rows = _ledger.filter(r => r.member_id === mid);
        const RSN = { welcome: '무료 1회', admin_grant: '관리자', rehearsal: '리허설 사용', purchase: '구매', refund: '환불' };
        box.innerHTML = rows.length ? rows.map(r =>
          `${new Date(r.created_at).toLocaleDateString('ko-KR')} · ${r.delta > 0 ? '+' : ''}${r.delta} · ${RSN[r.reason] || r.reason}${r.ref ? ' · ' + esc(r.ref) : ''}`
        ).join('<br>') : '내역 없음';
        box.style.display = '';
      }));
    }

    document.getElementById('rhSearch').addEventListener('input', renderRhList);
    document.getElementById('rhBulkGrant').addEventListener('click', async () => {
      const cohortId = document.getElementById('rhBulkCohort').value;
      const n = Math.max(1, parseInt(document.getElementById('rhBulkN').value, 10) || 1);
      const note = document.getElementById('rhBulkNote').value.trim();
      if (!cohortId) { alert('기수를 선택하세요.'); return; }
      const targets = members.filter(m => m.cohort_id === cohortId);
      if (!targets.length) { alert('이 기수에 배정된 회원이 없습니다.'); return; }
      const cohort = cohorts.find(c => c.id === cohortId);
      if (!confirm(`「${(cohort && cohort.name) || ''}」 ${targets.length}명 전원에게 리허설권 ${n}개를 지급할까요?`)) return;
      const rows = targets.map(m => (
        { member_id: m.id, delta: n, reason: 'admin_grant', ref: note || '기수 일괄 지급', created_by: myProfile.id }));
      const { error } = await sb().from('point_ledger').insert(rows);
      if (error) { alert('지급 실패: ' + error.message); return; }
      toast(targets.length + '명에게 ' + n + '개씩 지급됨');
      loadRehearsalAdmin();
    });
```

- [ ] **Step 4: 초기 로드 연결** — 진입 IIFE 의 `loadQuestions();` 다음 줄에 `loadRehearsalAdmin();` 추가.

- [ ] **Step 5: 검증** — admin.html 접속 시 콘솔 SyntaxError 0건. 프로덕션 DB 미적용 상태이므로 탭을 열면 마이그레이션 안내가 떠야 정상(관리자 로그인 필요 — Task 9). 최소한 렌더 시 다른 탭이 깨지지 않는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add admin.html
printf '%s\n' "feat(리허설): admin 리허설권 탭 — 잔액·지급·회수·기수 일괄·usage 통계" "" "- 잔액=원장 합계, 회수는 admin_grant 음수 delta(사유는 ref)" "- 세션 통계(평균 토큰)로 충전 가격 책정 근거 제공" "- 미적용 시 탭 안 안내만(다른 탭 무영향)" > /tmp/cmsg.txt
git commit -F /tmp/cmsg.txt
```

---

### Task 8: admin.html — 리허설 패턴집 편집 탭

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: 탭 버튼** — `리허설권` 버튼 다음에:

```html
    <button class="tabbtn" data-tab="patterns">리허설 패턴집</button>
```

- [ ] **Step 2: 패널 마크업** — `#panel-rehearsal` 닫는 `</div>` 다음에:

```html
  <div class="tab-panel" id="panel-patterns">
    <div class="cm-wrap">
      <div class="rv-hint">면접관 리허설이 쓰는 <b>유형별 꼬리질문 패턴 + 연구진 첨삭 기준</b>입니다.
        저장하면 다음 리허설부터 바로 반영돼요(재배포 불필요).
        형식: <code>{"experience":{"patterns":["…"],"criteria":["…"]}, "values":…, "judgment":…, "company":…}</code>
        — 유형 키 4개(experience/values/judgment/company)를 유지하세요.</div>
      <div class="cm-block">
        <textarea id="rhPatterns" rows="20" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:13px;line-height:1.7;font-family:ui-monospace,Consolas,monospace;resize:vertical;"></textarea>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;">
          <button class="btn btn-action" id="rhPatternsSave">패턴집 저장</button>
          <span id="rhPatternsMsg" style="font-size:13px;color:var(--text-muted);"></span>
        </div>
      </div>
    </div>
  </div>
```

- [ ] **Step 3: JS 추가** — Task 7 에서 넣은 리허설 JS 블록 바로 아래에:

```js
    // ── 리허설 패턴집(site_config.rehearsal_patterns) 편집 ──
    async function loadRehearsalPatterns() {
      const ta = document.getElementById('rhPatterns');
      const msg = document.getElementById('rhPatternsMsg');
      const { data, error } = await sb().from('site_config')
        .select('value').eq('key', 'rehearsal_patterns').maybeSingle();
      if (error) { msg.textContent = '불러오기 실패: ' + error.message + ' (site_config 마이그레이션 확인)'; return; }
      if (!data) { msg.textContent = '아직 값이 없어요 — 마이그레이션 20260718120000 을 실행하면 초안이 들어갑니다.'; return; }
      ta.value = JSON.stringify(data.value, null, 2);
    }
    document.getElementById('rhPatternsSave').addEventListener('click', async () => {
      const ta = document.getElementById('rhPatterns');
      const msg = document.getElementById('rhPatternsMsg');
      let obj;
      try { obj = JSON.parse(ta.value); }
      catch (e) { msg.textContent = 'JSON 문법 오류: ' + e.message; return; }
      const cats = ['experience', 'values', 'judgment', 'company'];
      for (const c of cats) {
        const v = obj[c];
        if (!v || !Array.isArray(v.patterns) || !Array.isArray(v.criteria)) {
          msg.textContent = `형식 오류: "${c}" 에 patterns/criteria 배열이 필요해요.`; return;
        }
      }
      if (await cmSave('rehearsal_patterns', obj, '패턴집 저장됨')) msg.textContent = '저장됐어요. 다음 리허설부터 반영.';
    });
```

- [ ] **Step 4: 초기 로드 연결** — 진입 IIFE 의 `loadRehearsalAdmin();` 다음 줄에 `loadRehearsalPatterns();` 추가.

- [ ] **Step 5: 검증** — 콘솔 SyntaxError 0건. 나머지는 Task 9.

- [ ] **Step 6: 커밋**

```bash
git add admin.html
git commit -m "feat(리허설): admin 패턴집 편집 탭 — rehearsal_patterns JSON 검증 후 저장, 재배포 없이 반영"
```

---

### Task 9: 배포·오너 체크리스트 + push

- [ ] **Step 1: 전체 회귀 렌더 확인** — 로컬 서버에서 index/mypage/sojae/admin/rehearsal 각각 열어 콘솔 에러 0건(375px). 기존 페이지가 마이그레이션 미적용 상태에서 그대로 동작하는지가 핵심(스펙 검증 계획의 graceful degradation 항목).

- [ ] **Step 2: push (= GitHub Pages 배포)**

```bash
git push origin main
```
미적용 상태에서도 모든 진입점이 숨김/안내로 degradation 하므로 push 가 먼저여도 안전.

- [ ] **Step 3: 오너 안내문 전달** — 아래를 그대로 오너에게 전한다(순서 중요):

```
[면접관 리허설 켜는 순서]
1. Supabase SQL Editor 에서 supabase/migrations/20260718120000_rehearsal.sql 전체 실행
   (재실행 안전. site_config 마이그레이션(20260710120000)이 선행돼 있어야 함 — 이미 적용됨)
2. Edge Functions > sojae-chat 에 저장소의 supabase/functions/sojae-chat/index.ts
   최신 내용을 붙여넣고 새 버전 배포 (ANTHROPIC_API_KEY 시크릿은 기존 그대로)
3. admin > 리허설권 탭에서 수강생에게 지급(개별 또는 기수 일괄)
   ※ 전 회원 무료 1회(welcome)는 rehearsal.html 첫 진입 시 자동 지급됨
4. admin > 리허설 패턴집 탭에서 초안 검수·수정 (연구진 검수 전까지
   모집 문구에 "면접관 데이터" 계열 표현 금지 — 스펙 워딩 규칙)
```

- [ ] **Step 4: 오너 실행 후 수동 검증 체크리스트** (스펙 '검증 계획' 그대로 — 오너 또는 테스트 계정으로):

크레딧:
- [ ] 잔액 0 회원: 시작 화면에서 충전 안내가 뜨고 시작 불가
- [ ] 시작 시 정확히 1 차감(admin 원장에서 rehearsal −1 행 + ref=세션 id 확인)
- [ ] 진행 중 나갔다 재진입 → 확인 화면 없이 대화 복원, 추가 차감 없음
- [ ] 신규 회원 첫 진입 시 welcome +1 이 딱 한 번(재진입해도 중복 지급 없음)
- [ ] 두 탭에서 동시에 시작해도 세션 1개·차감 1회

흐름:
- [ ] 첫 진입 → 첫 꼬리질문 자동 수신 → 답변 → 즉석 코칭(잘한 점+보완+다음 질문)
- [ ] 3~4라운드 후 종합 첨삭 수신 → 스텝바 전체 점등 → '답변 보완하러 가기'가 sojae.html?q= 로
- [ ] 완료 세션 재진입 → 읽기 전용 리플레이 + '다시 리허설' → 새 세션·새 차감
- [ ] 마이페이지 완료 노트에 '리허설 완료' 배지 + 버튼 라벨 3종(시작/이어하기/다시 보기)
- [ ] 종합 첨삭에 통째 완성 답변이 없는지(대필 금지 — 있으면 프롬프트 보완)

보안:
- [ ] 브라우저 콘솔에서 타인 uid 로 rehearsal_sessions/point_ledger 조회 → 빈 결과
- [ ] 콘솔에서 point_ledger insert 시도 → RLS 거부
- [ ] 세션 없이(또는 남의 session_id 로) stage='rehearsal' 호출 → 403
- [ ] 콘솔에서 rehearsal_sessions update 시도(status 되돌리기) → RLS 거부

원가:
- [ ] 완료 세션의 input/output_tokens 가 0 이 아님(admin 통계에 평균 표시)

- [ ] **Step 5: 체크리스트 통과 후** — 실패 항목이 있으면 superpowers:systematic-debugging 으로 원인부터. 전부 통과하면 완료 보고.

---

## Self-Review 결과 (계획 작성 시 수행)

- 스펙 전 항목 ↔ 태스크 대응 확인: 진입 2곳(T5·T6)/시작 확인·충전 안내(T4)/코칭·첨삭·대필 금지(T2·T3)/배지·리플레이·재리허설(T4·T5)/스키마·RLS·RPC(T1)/403·usage·no-canned(T3)/패턴집+admin 편집(T1·T3·T8)/리허설권 관리·일괄·통계(T7)/검증 계획(T9). 범위 밖(기출 은행·점수화·푸시·결제)은 미포함 유지.
- 타입·이름 일관성: `start_rehearsal(p_question_id)`·`grant_welcome_credit()`·`finish_rehearsal(p_session_id,p_verdict)`·`add_rehearsal_usage(p_session_id,p_input,p_output)` — T1 정의와 T3(함수)·T4(페이지) 호출부 서명 일치. role 값 `interviewer|user` 3곳(T1 check·T3 변환·T4 저장) 일치. 마커 `<<REHEARSAL_DONE>>` 2곳(T2·T3) 일치.
- 플레이스홀더 없음(모든 코드 스텝에 실코드).
