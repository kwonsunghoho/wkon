# 소재 발굴 — 관리자 부여 권한 게이트

날짜: 2026-07-07 · 상태: 설계 확정(구현 착수)

## 배경 / 문제

현재 소재 발굴(sojae)은 **로그인만 하면 누구나** 사용할 수 있다.

- `sojae.html`은 진입 시 `MONC.requireSession()`(로그인 여부)만 확인한다.
- RLS의 `sessions_own / messages_own / answers_own` 정책은 "로그인 본인이면 CRUD 허용"이라 서버에서도 막지 않는다.
- Edge Function `sojae-chat`은 JWT(로그인)만 검증하고 회원별 권한 검사가 없어, 로그인만 하면 Anthropic API 비용이 발생한다.

소재 발굴은 유료 프로그램 회원에게만 제공되어야 하므로, **관리자가 명시적으로 권한을 준 회원만** 이용할 수 있어야 한다.

## 목표

- 관리자가 회원별로 소재 발굴 권한을 켜고 끌 수 있다(개별 + 일괄).
- 권한 없는 회원은 클라이언트·서버·AI 어느 경로로도 소재 발굴을 실행할 수 없다.
- 권한 없는 회원에게도 기능의 존재는 알리되(잠금 카드), 진입은 막는다.

## 확정 결정

- **권한 모델**: `members.sojae_enabled` 회원별 명시적 ON/OFF 플래그. 기수/결제와 독립.
- **부여 주체**: 모든 관리자(role='admin'). 관리자 임명(role)과 달리 일상 운영 작업으로 취급 → 오너 전용 아님.
- **미권한 UX**: 마이페이지 카드는 **보이되 잠금 표시**. sojae.html 직접 접근 시 안내 화면으로 차단.
- **부여 방식**: 개별 토글(회원 상세) + 일괄(체크박스 선택 후 켜기/끄기) 둘 다.
- **관리자는 항상 허용**: 관리자·오너는 `sojae_enabled` 값과 무관하게 테스트 목적으로 사용 가능.
- **기본값 false**: 마이그레이션 적용 즉시 기존 회원 전원 잠금. 필요한 회원은 admin에서 일괄로 켠다.

## 데이터 모델 (마이그레이션 1개 — 오너가 Supabase에서 실행)

파일: `supabase/migrations/20260707120000_sojae_access.sql` · 재실행 안전(idempotent).

```sql
-- 1. 권한 플래그
alter table public.members
  add column if not exists sojae_enabled boolean not null default false;

comment on column public.members.sojae_enabled is
  '소재 발굴 사용 권한. 관리자가 부여. 관리자/오너는 값과 무관하게 항상 허용(can_sojae).';

-- 2. can_sojae(): 현재 유저가 소재 발굴을 쓸 수 있는지. RLS 재귀 방지 위해 SECURITY DEFINER.
create or replace function public.can_sojae()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.members
    where id = auth.uid()
      and (sojae_enabled = true or role = 'admin')
  );
$$;

comment on function public.can_sojae() is
  '소재 발굴 접근 허용 여부(sojae_enabled 또는 관리자). RLS·Edge Function에서 사용.';

-- 3. 기존 own 정책 교체 — can_sojae() 추가. (admin_all 정책은 그대로: 관리자 전체 접근)
drop policy if exists sessions_own on public.discovery_sessions;
create policy sessions_own on public.discovery_sessions
  for all to authenticated
  using (member_id = auth.uid() and public.can_sojae())
  with check (member_id = auth.uid() and public.can_sojae());

drop policy if exists messages_own on public.discovery_messages;
create policy messages_own on public.discovery_messages
  for all to authenticated
  using (member_id = auth.uid() and public.can_sojae())
  with check (member_id = auth.uid() and public.can_sojae());

drop policy if exists answers_own on public.answers;
create policy answers_own on public.answers
  for all to authenticated
  using (member_id = auth.uid() and public.can_sojae())
  with check (member_id = auth.uid() and public.can_sojae());
```

주의:
- `questions`(기출 풀)의 `questions_select_authenticated`(로그인 전원 읽기)는 그대로 둔다 — 개인 데이터가 아니고, 잠금 카드에서 오늘의 문제 텍스트를 보여줄 수 있게 하기 위함(선택).
- `members`의 `sojae_enabled` 수정은 기존 `members_admin_all` 정책으로 모든 관리자가 가능하다. `protect_member_privilege` 트리거는 `role`/`is_owner` 변경만 막으므로 `sojae_enabled` 변경은 통과한다(확인 필요 없음 — 트리거 조건에 sojae_enabled 없음).
- 회원 본인 행 읽기(getMyProfile) 정책은 기존대로 유지 — `sojae_enabled` 컬럼도 함께 읽힌다.

## Edge Function `sojae-chat` (AI 비용 방어)

`supabase/functions/sojae-chat/index.ts` — 로그인 확인(`getUser`) 직후, Anthropic 호출 **전에** 권한을 검사한다. RLS는 DB 쓰기만 막고 AI 호출은 그 전에 일어나므로 별도 검사가 필수다.

```ts
const { data: { user } } = await supa.auth.getUser();
if (!user) return json({ error: "로그인이 필요합니다" }, 401);

// 소재 발굴 권한 확인 (sojae_enabled 또는 관리자). RLS 하에서 본인 행만 읽힘.
const { data: me } = await supa
  .from("members")
  .select("sojae_enabled, role")
  .eq("id", user.id)
  .single();
if (!me || (!me.sojae_enabled && me.role !== "admin")) {
  return json({ error: "소재 발굴 권한이 없습니다" }, 403);
}
```

> ⚠️ Edge Function은 오너가 Supabase 콘솔에서 새 버전으로 재배포해야 반영된다(`docs/sojae-ai-setup.md`).

## supabase-config.js

- `getMyProfile()`의 select에 `sojae_enabled` 추가.
- 공용 판정 헬퍼 노출: `MONC.hasSojaeAccess(profile)` → `!!profile && (profile.sojae_enabled || profile.role === 'admin')`. mypage·sojae 양쪽에서 동일 기준 사용.

## sojae.html (직접 URL 접근 방어)

진입 IIFE의 `requireSession()` 직후 프로필을 조회해 권한을 확인한다.

- 권한 있음 → 기존 흐름(문제 확정 → 복원/첫 되묻기) 그대로.
- 권한 없음 → 문제·AI 로드를 하지 않고, `<body>`(또는 chat 영역)를 **안내 화면**으로 교체:
  - 자물쇠 아이콘 + "아직 소재 발굴 권한이 없어요"
  - 보조 문구: "관리자 승인 후 이용할 수 있어요."
  - "마이페이지로" 버튼(`mypage.html`).
- 클라이언트 폴백(canned 응답) 특성상 화면 차단이 없으면 미권한자도 UI를 볼 수 있으므로, **문제 로드 전에** 차단해야 한다.

## mypage.html (잠금 카드)

마이페이지는 이미 프로필을 조회해 소속 기수를 표시한다. 같은 프로필로 카드 상태를 분기한다.

- 권한 있음(`MONC.hasSojaeAccess`) → 지금처럼 `<a href="sojae.html">` 클릭 가능 카드.
- 권한 없음 → 동일 카드 자리에 **잠금 상태**:
  - 링크(`<a>`)가 아닌 비활성 요소(클릭 불가).
  - 자물쇠 아이콘 + 흐린(muted) 스타일.
  - "관리자 승인 후 이용 가능" 문구.
  - 오늘의 문제 텍스트는 티저로 노출하거나 생략(구현 시 결정 — 기능적으로 무관).
- 답변노트 섹션: 미권한자는 답변이 없고 RLS로 조회도 막히므로 기존 "빈 상태" 메시지가 자연스럽게 표시된다.

## admin.html (개별 + 일괄)

### 개별 토글
회원 상세 "회원 정보" 패널(`권한` 필드 근처)에 "소재 발굴" ON/OFF 토글 버튼을 추가한다.

- 모든 관리자 사용 가능(오너 전용 아님).
- 클릭 시 `members.update({ sojae_enabled: !현재값 })`, 낙관적 갱신 + 목록 배지 갱신.
- 실패 시 alert + 원복.

### 일괄
상단 bulk-bar(전체 선택 · 미배정만 · 기수 배정 옆)에 "소재 발굴 켜기 / 끄기" 버튼 2개(또는 토글)를 추가한다.

- 체크된 회원(`selected` Set)에 대해 `members.update({ sojae_enabled }).in('id', [...selected])`.
- 완료 토스트 + 목록·상세 갱신.

### 목록 배지
회원 목록 행에 권한 ON이면 작은 배지(예: "소재")를 표시해 한눈에 파악(선택적, 관리자/오너 배지와 동일 스타일).

## 영향 / 리스크

- **적용 즉시 전원 잠금**(기본값 false). 승인됨 — 초기라 실사용자 거의 없음. 필요 회원은 admin 일괄 켜기로 처리.
- Edge Function은 재배포 전까지 구버전이 동작(권한 검사 없음). 재배포 필요 — 배포 전에도 RLS가 DB 쓰기를 막으므로 데이터 유출은 없고, AI 호출 비용만 재배포 전까지 방어 안 됨.
- 기존 소재 발굴 사용 데이터가 있던 회원은 권한을 꺼두면 자기 답변도 조회 불가(SELECT까지 게이트). 초기라 무해, 필요 시 켜주면 즉시 복구.

## 파일 변경 요약

| 파일 | 변경 |
|---|---|
| `supabase/migrations/20260707120000_sojae_access.sql` | 신규 — 플래그·can_sojae()·RLS 3개 정책 교체 |
| `supabase/functions/sojae-chat/index.ts` | 권한 검사(403) 추가 — **재배포 필요** |
| `supabase-config.js` | getMyProfile에 sojae_enabled, `hasSojaeAccess` 헬퍼 |
| `sojae.html` | 진입 권한 가드 + 안내 화면 |
| `mypage.html` | 소재 발굴 카드 잠금 분기 |
| `admin.html` | 개별 토글 + 일괄 버튼 + 목록 배지 |
