# 소재 발굴 — "작성 중 / 완료" 자동 이어쓰기 (서버 단일 원천)

날짜: 2026-07-06 · 상태: 설계 확정(구현 착수)

## 배경 / 문제

되묻기 대화로 뼈대를 잡은 뒤 **그 자리에서 최종 답변을 쓰지 않으면 전부 사라진다.** 특히:

1. 이어쓰기 복원 키가 "오늘의 문제 id"에 묶여 있어, **날짜가 바뀌면 오늘의 문제가 자동 순환으로 바뀌며 어제 세션이 고아**가 된다. sojae.html은 항상 "오늘 문제"만 열어 과거 세션을 다시 열 방법이 없다.
2. 미완성(뼈대만) 상태는 영구 저장(`answers`)에 안 들어가 서버에 남는 게 없다.
3. 답변노트는 최종 답변만 보여줘 뼈대·진행 상태가 안 보인다.

## 목표

미완성이 절대 날아가지 않게. 되묻기 시작부터 자동으로 서버에 "작성 중"으로 남고, 마이페이지 답변노트에서 **언제든(다른 날·다른 기기) 다시 열어 뼈대·쓰던 내용 그대로 이어쓰기.**

## 확정 결정

- **자동 임시저장 + 이어쓰기** (명시 버튼 X — 되묻기 시작부터 자동).
- **작성 중 / 완료 2단계** (`answers.status`).
- **sojae.html 로그인 필수** (`requireSession`). 반쪽 비로그인 경로 제거.
- **서버 단일 원천** — localStorage 하이브리드 전부 제거. 저장 장소는 서버뿐.

## 데이터 모델 (마이그레이션 1개 — 오너가 Supabase에서 실행)

`answers`에 `status` 컬럼 추가. 컬럼 최초 추가 시점의 기존 답변은 `final`로 백필(그전 답변 = 완료로 간주). 재실행 안전.

```sql
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='answers' and column_name='status') then
    alter table public.answers add column status text not null default 'draft';
    alter table public.answers add constraint answers_status_check check (status in ('draft','final'));
    update public.answers set status = 'final';
  end if;
end $$;
```

되묻기 대화·뼈대는 이미 `discovery_sessions`/`discovery_messages`에 저장됨 — 그대로 재사용.

## sojae.html

- **진입 가드**: `MONC.requireSession()`. 미로그인 → login 으로.
- **문제 선택**: URL `?q=<id>` 있으면 그 문제(id로 조회, active 무관 — 비활성돼도 이어쓰기 가능), 없으면 오늘의 문제.
- **localStorage 전부 제거**: `persistLocal`, `DRAFT_PREFIX`, `_draftKey`, restore의 localStorage 분기 삭제.
- **자동 저장(서버)**:
  - 대화·뼈대 → `discovery_sessions`/`discovery_messages` (`syncServer`, 기존 로직 유지).
  - 답변 초안 → `answers` upsert `{member_id, question_id, content, status:'draft'}` (`onConflict: member_id,question_id`). 첫 되묻기 전송 시 행 생성(내용 ''), 최종칸 입력마다 디바운스(800ms) 갱신. `_answerStatus`가 이미 `final`이면 `final` 유지(다운그레이드 방지).
- **복원(`restoreSession`)**: 진입 시 그 문제의 discovery 세션+메시지 → 대화·뼈대 재현, `answers` 초안 → 최종칸 채움. 세션 stage가 write/done 이거나 초안 내용이 있으면 최종작성 모드로 복원. 오늘 문제든 `?q=`든 동일.
- **완성(saveBtn)**: `answers` upsert `status:'final'` 승격. 문구 "답변집에 저장됐어요."
- writeMode 카피: 자동 저장 안내("작성 중인 내용은 자동 저장돼요") + 버튼은 "답변집에 저장(완료)".

## mypage.html — 답변노트

- 쿼리: `answers.select('content, status, updated_at, question_id, questions(content, category)')`.
- **작성 중**(status=draft) 카드: 배지 + 질문 + (내용 있으면 미리보기, 없으면 "아직 작성 전") + **"이어서 작성 →"** → `sojae.html?q=<question_id>`.
- **완료**(status=final) 카드: 지금처럼 `<details>` 펼쳐보기.
- 작성 중 그룹 위 / 완료 아래.

## 제약 / 주의

- **`status` 컬럼 마이그레이션은 오너가 먼저 실행해야** draft/완료가 동작. 미실행 시 `answers` upsert(status 포함)가 실패 → 저장 안 됨(에러 메시지로 드러남). 배포 전 반드시 실행.
- sojae는 로그인 필수가 됨. 오늘의 소재 발굴 카드는 그대로 `sojae.html`(오늘 문제).

## 성공 기준 (검증)

1. 로그인 상태에서 되묻기 → 뼈대 → 나가기 → 마이페이지 답변노트에 "작성 중" 카드가 뜬다.
2. "이어서 작성"으로 다시 열면 대화·뼈대·쓰던 내용이 그대로 복원된다(다음 날에도).
3. 최종 작성 후 저장 → "완료" 카드로 이동, 최종 답변 펼쳐보기 가능.
4. 미로그인으로 sojae 직접 접근 → login 으로 리다이렉트.
5. 새로고침해도 서버에서 복원(로딩 후 대화 유지).
