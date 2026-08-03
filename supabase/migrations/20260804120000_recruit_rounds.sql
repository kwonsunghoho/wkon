-- ============================================================================
-- 연구실 04 서가 '채용 캘린더' — 공채 회차 (2026-08-04)
-- ============================================================================
-- 오너 확정(2026-08-04): **무료 공개**. 값을 붙이지 않는다 — 검색으로 들어오는 문이고,
-- 유료는 항공사 자료실(기출·자료)이 이미 맡고 있다.
--
-- ⚠️ 이 자료를 lab_resources 에 넣지 않는다. 그 표는 '파일'이 원장이라 storage_path 가
--    필수인데, 채용 타임라인은 파일이 아니라 날짜다. PDF 로 올리면 단계 사이 날수·
--    반복 패턴을 계산할 수 없어 화면이 그냥 사진 한 장이 된다.
-- ⚠️ 회차 단위로 쌓는다 — '연도 → 상/하반기' 칸을 미리 만들지 않는다. 대한항공은 연 2회라
--    맞아떨어지지만 LCC 는 연 3~4회 뽑는 해도, 한 번도 안 뽑는 해도 있다. 빈 칸이 생기면
--    '채용이 없었다'인지 '아직 안 채웠다'인지 구분되지 않는다(원칙: 상태를 단정하지 않기).
--    정렬·간격 계산의 기준은 started_on(접수 시작일) 하나다.
-- ⚠️ 단계는 자식 표가 아니라 stages jsonb 배열이다. 손으로 관리하는 자료라 회차 하나를
--    한 번에 저장하는 편이 admin 이 훨씬 단순하고, 순서가 배열 그대로 남는다.
--    자료량이 회차 수십 개 규모라 집계는 브라우저가 한다(돈이 걸린 판정이 아니다).
-- ⚠️ **항공사마다 전형 방법·횟수가 다르다**(오너 지적 2026-08-04). 배열이라 7단계든
--    13단계든 그냥 들어가고 이름도 자유지만, key 어휘는 '전형 이름'이 아니라 **역할** 9개로
--    잡는다 — 아래 recruit_stages_ok() 주석. 대한항공 전형표를 그대로 어휘로 옮기면
--    아시아나 2차 실무면접·에어프레미아 AI역량검사가 전부 etc 로 밀려 계산에서 빠진다.
-- ============================================================================

-- ── 회차 ────────────────────────────────────────────────────────────────────
create table if not exists public.recruit_rounds (
  id          uuid primary key default gen_random_uuid(),
  -- 항공사 슬러그 — news.html·lab_resources 와 같은 값을 쓴다(kal·asiana·jinair…).
  -- ⚠️ check 로 목록을 고정하지 않는다. 새 항공사가 생길 때 마이그레이션을 또 돌려야 한다.
  airline     text not null,
  -- 화면에 그대로 뜨는 회차 이름. 접수 시작 월로 부른다 — '2026년 2월 공채'.
  title       text not null,
  -- 접수 시작일. 정렬 기준이자 '지난 공채와 며칠 간격이었나'의 기준점.
  started_on  date not null,
  -- 단계 배열. 자세한 모양은 아래 recruit_stages_ok() 주석 참조.
  stages      jsonb not null default '[]'::jsonb,
  -- 더 채울 단계가 없다고 연구진이 확인한 회차. false 면 화면에 '기록 진행 중'.
  -- ⚠️ '채용이 끝났다'가 아니라 '우리 기록이 끝났다'는 뜻이다 — 둘을 섞지 말 것.
  complete    boolean not null default false,
  -- 출처 메모(공고 화면·합격자 제보 등). 화면에 그대로 노출하지 않는다 — 검증용 기록.
  source      text,
  -- 회차 메모(모집 직군·특이사항). 화면 하단에 한 줄로 붙일 수 있다.
  note        text,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 같은 항공사가 같은 날 접수를 두 번 시작하지 않는다 — 중복 입력 방지이자 재실행 안전장치.
create unique index if not exists recruit_rounds_uniq
  on public.recruit_rounds (airline, started_on);
create index if not exists recruit_rounds_pub_idx
  on public.recruit_rounds (published, started_on desc);
create index if not exists recruit_rounds_air_idx
  on public.recruit_rounds (airline, started_on desc);

drop trigger if exists trg_recruit_rounds_updated_at on public.recruit_rounds;
create trigger trg_recruit_rounds_updated_at
  before update on public.recruit_rounds
  for each row execute function public.set_updated_at();

-- ── 단계 배열 모양 검사 ─────────────────────────────────────────────────────
-- stages 원소 하나 = 단계 하나.
--   key   단계의 **역할**(아래 9개). ⚠️ 화면의 자동 배지·평균 계산이 name 이 아니라 이 값을
--         본다. 그래서 어휘를 '전형 이름'이 아니라 역할로 잡는다 — 항공사마다 전형 방법과
--         횟수가 달라서, 대한항공 전형표(서류결과·임원·최종…)를 그대로 어휘로 쓰면
--         아시아나 2차 실무면접·에어프레미아 AI역량검사가 전부 etc 로 밀려 계산에서 빠진다.
--   name  화면에 뜨는 이름 — 여기가 항공사 표기를 그대로 담는 자리다
--         ('서류 접수' · '2차 실무면접' · 'AI역량검사' · '수영·신체검사')
--   start 시작일 YYYY-MM-DD (필수)
--   end   종료일 YYYY-MM-DD (하루짜리 단계면 생략)
--   time  '오후 4시 마감' 같은 시각 문구(자유 문장 — 항공사 표기를 그대로 옮긴다)
--   note  '11/10(월) · 11/11(화) · 11/13(금)' 처럼 날짜가 띄엄띄엄일 때 실제 날짜를 적는다.
--         ⚠️ 이때 start·end 는 처음·마지막 날이라 사이가 다 면접일인 것은 아니다 — note 가 원장이다.
--
--   key 어휘(9개):
--     apply     서류 접수
--     screen    온라인 검사 — AI역량검사 · 인적성 · 어학
--     video     영상(비대면) 면접 — 마감 시각이 있고 준비 성격이 달라 면접과 따로 둔다
--     interview 대면 면접 — 1차 · 2차 · 실무 · 임원 · 최종 전부 여기. 몇 차인지는 name 이 말한다
--     health    신체 관련 — 수영 · 신체검사 · 체력검정
--     result    발표 — ⚠️ '무엇의 발표인가'는 **배열 순서**가 말한다(바로 앞 단계의 결과다).
--               서류결과·1차결과·최종결과를 따로 두지 않는 이유 = 전형 수가 항공사마다 다르다
--     pass      최종 합격
--     intake    입과
--     etc       그 외(어디에도 안 맞을 때만. 늘어나면 어휘를 늘릴 때다)
--
--   ⚠️ 이 어휘 덕분에 자동 배지가 항공사를 안 가린다 — '서류 결과 당일 영상면접 시작'이
--      아니라 **'발표 당일 다음 전형 시작'**(result 다음 단계의 start 가 같은 날)으로 잰다.
create or replace function public.recruit_stages_ok(p jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p) = 'array'
     and not exists (
       select 1
       from jsonb_array_elements(p) e
       where jsonb_typeof(e) <> 'object'
          or coalesce(e->>'name', '') = ''
          or coalesce(e->>'key', '') not in (
               'apply','screen','video','interview','health','result','pass','intake','etc')
          or coalesce(e->>'start', '') !~ '^\d{4}-\d{2}-\d{2}$'
          -- end 는 없어도 된다(하루짜리 단계). 있으면 모양과 순서를 본다.
          -- ⚠️ jsonb 의 ? 연산자를 쓰지 않는다 — 물음표를 자리표시자로 읽는 도구가 있다.
          or ((e->>'end') is not null and (e->>'end') !~ '^\d{4}-\d{2}-\d{2}$')
          or ((e->>'end') is not null and (e->>'end') < (e->>'start'))
     )
$$;

-- 구 어휘(대한항공 전형표를 그대로 옮겼던 14개)로 이미 넣은 회차가 있으면 역할로 옮긴다.
-- ⚠️ 반드시 아래 add constraint 보다 먼저 돈다 — 순서를 바꾸면 구 자료가 검사에 걸려 실패한다.
-- 아직 아무것도 안 넣었으면 0행이라 아무 일도 일어나지 않는다.
alter table public.recruit_rounds drop constraint if exists recruit_rounds_stages_ok;

update public.recruit_rounds
set stages = (
  select coalesce(jsonb_agg(
    case
      when e->>'key' in ('apply_result','video_result','interview1_result','exec_result','final_result')
        then jsonb_set(e, '{key}', '"result"')
      when e->>'key' in ('interview1','exec','final')
        then jsonb_set(e, '{key}', '"interview"')
      else e
    end
    order by ord
  ), '[]'::jsonb)
  from jsonb_array_elements(stages) with ordinality t(e, ord)
)
where exists (
  select 1 from jsonb_array_elements(stages) e
  where e->>'key' in ('apply_result','video_result','interview1','interview1_result',
                      'exec','exec_result','final','final_result')
);

alter table public.recruit_rounds
  add constraint recruit_rounds_stages_ok check (public.recruit_stages_ok(stages));

-- ── 권한 ────────────────────────────────────────────────────────────────────
-- 무료·공개 자료다. 비밀번호도 파일 경로도 없어 감출 것이 없으므로 표를 그대로 읽힌다
-- (lab_resources 처럼 RPC 뒤에 숨길 이유가 없다 — 그 표는 password_hash·storage_path 때문이다).
-- ⚠️ 다만 published 가 false 인 회차는 안 보여야 한다. 작성 중인 회차가 그대로 노출되면
--    반쯤 채운 날짜가 사실처럼 읽힌다.
alter table public.recruit_rounds enable row level security;

drop policy if exists recruit_rounds_public_read on public.recruit_rounds;
create policy recruit_rounds_public_read on public.recruit_rounds
  for select
  to anon, authenticated
  using (published);

-- admin.html 의 관리자도 service_role 이 아니라 그냥 로그인한 사용자다 — is_admin() 으로 연다.
drop policy if exists recruit_rounds_admin_all on public.recruit_rounds;
create policy recruit_rounds_admin_all on public.recruit_rounds
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.recruit_rounds is
  '항공사 공채 회차 — 연구실 04 채용 캘린더. 무료 공개. 단계는 stages jsonb 배열.';

-- ── 서가 숫자 ───────────────────────────────────────────────────────────────
-- 허브(lab.html) 목차·원장(lab-archive.html) 스트립·서가 머리의 숫자가 여기서 나온다.
-- 채용 캘린더는 이제 파일이 아니라 회차라 lab_resources 만 세면 계속 '준비 중'이 뜬다.
-- ⚠️ 반환 타입(shelf, n, last_at)을 바꾸지 않는다 — 바꾸면 함수를 drop 해야 하고,
--    오너가 SQL 을 돌릴 때까지 세 화면의 숫자가 동시에 사라진다.
-- ⚠️ calendar 서가에 파일 자료를 올려 둔 것이 있어도 같이 세도록 union 뒤에 합산한다.
create or replace function public.lab_shelf_counts()
returns table (shelf text, n bigint, last_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.shelf, sum(s.n)::bigint, max(s.last_at)
  from (
    select r.shelf, count(*)::bigint as n, max(coalesce(r.published_at, r.created_at)) as last_at
    from public.lab_resources r
    where r.published
    group by r.shelf
    union all
    select 'calendar'::text, count(*)::bigint, max(rr.started_on)::timestamptz
    from public.recruit_rounds rr
    where rr.published
    having count(*) > 0
  ) s
  group by s.shelf
$$;

grant execute on function public.lab_shelf_counts() to anon, authenticated;

-- ============================================================================
-- 씨앗 자료 — 대한항공 3회차 (오너 제공 공고 이미지 값 그대로)
-- ============================================================================
-- ⚠️ 날짜·시각 문구를 임의로 다듬지 않았다. '오후 6시 경'처럼 '경'이 붙은 것은 공고가
--    그렇게 쓴 것이고, 그 애매함까지가 사실이다.
-- ⚠️ 임원 면접·입과처럼 날짜가 띄엄띄엄인 단계는 start·end 가 처음·마지막 날일 뿐이다 —
--    실제 날짜는 note 에 적혀 있다. 사이 날을 면접일로 읽지 말 것.
-- 재실행해도 안전하다(airline+started_on 유일 인덱스 + on conflict do nothing).

insert into public.recruit_rounds (airline, title, started_on, complete, source, note, published, stages)
values
-- ── 2025년 4월 공채 (11단계 전부) ──────────────────────────────────────────
('kal', '2025년 4월 공채', date '2025-04-01', true, '채용 공고', '객실승무원', true, $json$[
  {"key":"apply",     "name":"서류 접수",      "start":"2025-04-01","end":"2025-04-18","time":"오후 6시 마감"},
  {"key":"result",    "name":"서류 결과",      "start":"2025-04-30",                   "time":"오후 4시 경"},
  {"key":"video",     "name":"영상 면접",      "start":"2025-04-30","end":"2025-05-07","time":"오후 2시 마감"},
  {"key":"result",    "name":"영상 결과",      "start":"2025-05-19",                   "time":"오후 6시 경"},
  {"key":"interview", "name":"임원 면접",      "start":"2025-05-26","end":"2025-05-29", "note":"5/26(월) · 5/27(화) · 5/29(목)"},
  {"key":"result",    "name":"임원 결과",      "start":"2025-06-05",                   "time":"오후 5시 경"},
  {"key":"interview", "name":"최종 면접",      "start":"2025-06-16","end":"2025-06-17"},
  {"key":"result",    "name":"최종 결과",      "start":"2025-06-23",                   "time":"오후 6시 경"},
  {"key":"health",    "name":"수영 · 신체검사","start":"2025-07-01","end":"2025-07-03"},
  {"key":"pass",      "name":"최종 합격",      "start":"2025-08-11",                   "time":"오전 11시 경"},
  {"key":"intake",    "name":"입과",           "start":"2025-08-18","end":"2025-09-08", "note":"1차 8/18(월) · 2차 9/8(월)"}
]$json$::jsonb),

-- ── 2025년 9월 공채 (11단계 전부) ──────────────────────────────────────────
('kal', '2025년 9월 공채', date '2025-09-22', true, '채용 공고', '객실승무원', true, $json$[
  {"key":"apply",     "name":"서류 접수",      "start":"2025-09-22","end":"2025-10-13","time":"오후 6시 마감"},
  {"key":"result",    "name":"서류 결과",      "start":"2025-10-23",                   "time":"오전 9시 경"},
  {"key":"video",     "name":"영상 면접",      "start":"2025-10-23","end":"2025-10-27","time":"오후 6시 마감"},
  {"key":"result",    "name":"영상 결과",      "start":"2025-11-06",                   "time":"오후 7시 경"},
  {"key":"interview", "name":"임원 면접",      "start":"2025-11-10","end":"2025-11-13", "note":"11/10(월) · 11/11(화) · 11/12(수) · 11/13(금)"},
  {"key":"result",    "name":"임원 결과",      "start":"2025-11-20",                   "time":"오후 6시 경"},
  {"key":"interview", "name":"최종 면접",      "start":"2025-11-27","end":"2025-11-28"},
  {"key":"result",    "name":"최종 결과",      "start":"2025-12-03",                   "time":"오후 6시 경"},
  {"key":"health",    "name":"수영 · 신체검사","start":"2025-12-08","end":"2025-12-11"},
  {"key":"pass",      "name":"최종 합격",      "start":"2026-01-08",                   "time":"오전 10시 경"},
  {"key":"intake",    "name":"입과",           "start":"2026-01-14","end":"2026-02-04", "note":"1차 1/14(수) · 2차 2/4(수)"}
]$json$::jsonb),

-- ── 2026년 2월 공채 (⑨까지 확인 · ⑩⑪ 미확인이라 complete=false) ───────────
('kal', '2026년 2월 공채', date '2026-02-09', false, '채용 공고', '객실승무원', true, $json$[
  {"key":"apply",     "name":"서류 접수",      "start":"2026-02-09","end":"2026-02-24","time":"오후 4시 마감"},
  {"key":"result",    "name":"서류 결과",      "start":"2026-03-06",                   "time":"오후 6시 경"},
  {"key":"video",     "name":"영상 면접",      "start":"2026-03-06","end":"2026-03-10","time":"오후 5시 마감"},
  {"key":"result",    "name":"영상 결과",      "start":"2026-03-20",                   "time":"오후 5시 경"},
  {"key":"interview", "name":"임원 면접",      "start":"2026-03-27","end":"2026-03-31"},
  {"key":"result",    "name":"임원 결과",      "start":"2026-04-06",                   "time":"오후 5시 경"},
  {"key":"interview", "name":"최종 면접",      "start":"2026-04-10","end":"2026-04-13"},
  {"key":"result",    "name":"최종 결과",      "start":"2026-04-17",                   "time":"오후 5시 경"},
  {"key":"health",    "name":"수영 · 신체검사","start":"2026-04-21","end":"2026-04-27"}
]$json$::jsonb)

on conflict (airline, started_on) do nothing;
