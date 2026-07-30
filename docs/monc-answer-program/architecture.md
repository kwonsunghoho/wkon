# 매일 답변 프로그램 — 아키텍처 (2026-07-30)

## 전체 그림

```
브라우저(정적 HTML)                Supabase
┌──────────────────┐   RLS 직결   ┌──────────────────────────┐
│ programs.html     │────────────▶│ answer_programs(공개 목록) │
│ program.html      │   RPC       │ ap_program_view() ────────│─ 등록·공개일 판정 후
│ experiences.html  │────────────▶│   interview_questions     │  열린 일차의 문제만 반환
│ review-desk.html  │             │ answer_sessions(트리거 심판)│
│ admin.html(탭)    │             │ answer_versions(append-only)│
└───────┬──────────┘             │ experience_cards/facts     │
        │ functions.invoke        │ program_enrollments        │
        ▼                        └──────────────────────────┘
┌──────────────────┐  service role ▲        ▲ 재사용
│ Edge Fn           │──────────────┘        │ ai_killer_terms(감점 사전)
│ answer-program    │───── api.anthropic.com│ airline_profiles(항공사 자산)
│ (한 파일)          │                       │ answers(확정본 합류)
└──────────────────┘                       │ page_events(계측)
```

## 데이터 접근 규칙

- **기출 서빙은 `ap_program_view()` RPC 하나** — SECURITY DEFINER 로 등록·공개일을 판정하고 잠긴 일차의 질문은 응답에 싣지 않는다. `interview_questions` 직접 SELECT 는 관리자·연구원만.
- 학생 쓰기는 전부 본인 행 RLS + **세션 상태는 DB 트리거(`ap_session_guard`)가 심판**: 학생/연구원/service 별 허용 전이 표, 위반 시 errcode `MC003`(bad_state_transition), 잠긴 일차 세션 생성 `MC004`, 미등록 `MC005`.
- `answer_versions` 는 append-only(회원·연구원에 update/delete 정책 없음). 학생은 student 계열 kind 만, 연구원은 researcher_edit 만 insert 가능(위조 차단 with check).
- AI 버전 기록·세션의 ai_revised 전환은 중계 함수(service role)만 한다.

## 중계 함수 answer-program (ai-killer 관례 승계)

- 한 파일(콘솔 배포) · `{probe:true}` 로 버전/기능/개수 확인 · 사용자 오류는 HTTP 200 + code · JWT→anon 클라이언트로 본인 확인, 쓰기는 service role.
- 액션: `recommend`(Haiku) / `followup`(Haiku) / `revise`(Opus 5·effort high·구조화 출력) / `speak`(Sonnet 5).
- 원가 상한: 이용권 포함 상품이므로 크레딧 차감 대신 **서버 상한** — revise 3회/일/세션, speak 3회/일/세션, followup 8문답/세션, 자료 6,000자, 초안 2,000자.

## 근거 추적 (fact_anchoring 구현)

1. 서버가 근거 소스 목록을 만든다: 초안(draft) · 문답(qa n) · 카드 필드(c n:field) · 확인된 사실(f n). **INFERRED/분쟁/기각 사실은 소스에서 제외.**
2. AI는 모든 문장에 소스 id(ev)를 달아야 한다(구조화 출력 스키마 강제).
3. 서버 검증(`apValidateSentences`): 지어낸 id 제거 → 근거 0개면 `no_evidence`, 소스에 없는 숫자가 나오면 `new_number` → `unsupported` 플래그.
4. unsupported 문장은 조용히 통과하지 않는다 — 학생 화면 빨간 밑줄 + "그대로 쓰지 마세요", 연구원 화면 경고, '이 버전으로 다듬기'는 근거 있는 문장만 가져온다.
5. 버전 meta 에 sources 스냅샷·문장별 ev 가 저장돼 나중에도 추적 가능.

## 동기가 필요한 세 곳 (한 식을 세 벌로 유지)

공개일 계산(`daily`: `max(1, min(total, 오늘−시작+1))`)이 SQL(`ap_unlocked_max`) · 중계 함수(`apUnlockedMax`) · 화면(`AP.unlockedMax`)에 있다.
**고치면 셋을 같이 고치고 `node scripts/answer-program-tests.mjs`** — 테스트가 서버 파일에서 함수를 직접 잘라 실행하고, SQL 은 식 형태를 문자 검사한다.

## 데모 모드 (목업 어댑터 · working principle 13)

`program-common.js` 의 `AP.store` 가 실서버/데모 두 구현을 같은 인터페이스로 제공.
`?demo=1` → localStorage 저장소 + 규칙 기반 가짜 AI(문장·근거 구조는 실서버와 동일 모양, 근거 없는 문장 시연 포함).
마이그레이션·함수 배포·로그인 없이 학생·연구원 전체 흐름을 검증하는 용도이며, 화면에 체험 모드 배너가 항상 뜬다.

## 기존 자산 재사용 지점

| 재사용 | 어떻게 |
|---|---|
| `answers`(답변노트) | 확정 시 자유 글로 insert(title=문항, category=유형 매핑, doc_kind=interview, airline) → AI킬러(3cr)·첨삭(10cr)·마이페이지가 무수정으로 동작 |
| `ai_killer_terms` | revise/speak 의 self-check + coach 기준 프롬프트 주입(사전 이원화 금지) |
| `airline_profiles` | 프로그램 항공사의 문체·고유 소재를 참고자료로 주입(레퍼런스≠정답 규칙 포함) |
| `page_events` | ap_* 이벤트 계측(실패 무시) |
| nav.js/nav.css·tokens.css·바텀시트·프로브 관례 | 그대로 |
