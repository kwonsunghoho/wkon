# 설계 문서(specs)

**대부분은 설계 시점의 기록이다.** 현행 규칙은 `docs/notes/` 가 원장이고, 값이 다르면 notes 가 맞다.

## 예외 — 지금도 현행 소스오브트루스인 둘

CLAUDE.md '기능별 문서' 표가 이 둘을 직접 가리킨다. 기능을 고치기 전에 읽는다.

- `2026-07-24-ai-killer-design.md` — AI킬러·항공사 프로필
- `2026-07-30-sojae-v2-design.md` — 소재 발굴 v2

## 아직 안 끝난 것

- `2026-07-18-interviewer-rehearsal-design.md` — 실전 모의면접. 코드가 `main` 에 없다(`claude/rehearsal-wip`).

## ⚠️ 파일을 옮기거나 이름을 바꾸지 말 것

여기 문서는 **마이그레이션 SQL 과 코드 주석이 경로로 직접 가리킨다.** `2026-07-24-ai-killer-design.md` 하나만 해도 13곳(CLAUDE.md·`ai-killer.html`·`supabase/functions/ai-killer/index.ts`·마이그레이션 8개)이 참조한다. 실행이 끝난 SQL 은 다시 안 고치므로, 경로가 깨지면 나중에 근거를 못 찾는다.

끝난 **계획서**(plans)는 `docs/archive/plans/` 로 옮겨 뒀다.
