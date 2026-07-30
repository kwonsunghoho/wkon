# 매일 답변 프로그램 — AI 파이프라인 (2026-07-30)

서버: `supabase/functions/answer-program/index.ts` (한 파일 · 콘솔 배포 · FN_VERSION 프로브).
프롬프트 버전: `PROMPT_VERSION` 상수 — 모든 AI 버전 meta 에 기록된다(모델·usage 포함).

## 구성 요소 대응 (ai_architecture 의 명칭 → 구현 위치)

| 스펙 명칭 | 구현 |
|---|---|
| QuestionIntentAnalyzer | 관리자 입력(intent 등 은행 메타) + revise 의 fit_check(경험-질문 적합 판정) |
| ExperienceRetriever | `recommend` 액션(Haiku) — 본인 카드 20장 내 랭킹, AI가 지어낸 card_id 는 서버가 버림 |
| FactGapAnalyzer + FollowupQuestionGenerator | `followup` 액션(Haiku) — 1~2개씩, 유도 금지·중복 금지·모순 확인 우선, 8문답 상한 |
| StudentDraftAnalyzer + EvidenceGroundedRewriter + ToneAdapter | `revise` 액션(Opus 5, effort high) 한 호출 — 사실 정리 → 적합성 → 두 버전(문장별 ev) → 점수 |
| ClicheDetector | `ai_killer_terms` 재사용 — ① coach 기준 프롬프트 주입 ② 출력 self-check(걸리면 1회 재생성) |
| ConsistencyChecker | 사실 충돌은 모델 fact_summary.conflicts + 경험 중복은 서버(use_count) — 자동 수정하지 않고 표시만 |
| AnswerQualityEvaluator | scores 6항목은 모델, **경험 근거 25점은 서버 측정**(근거 커버리지) |
| SpeakingVersionGenerator | `speak` 액션(Sonnet 5) — 내용 불변·호흡 단위 분할, 새 숫자 나오면 실패 처리 |

## revise 처리 순서

1. 세션 소유 확인(JWT) → 초안 60~2,000자 검증 → 하루 3회 상한(ai_tone 버전 수, KST)
2. 근거 소스 조립: draft / qa n / c n:field / f n — **INFERRED·disputed·rejected 사실 제외**, 총 6,000자 상한
3. 감점 사전 로드(coach 80개 프롬프트 주입) + 항공사 프로필 참고자료(정답 아님 명시) + 말투 프로필
4. Opus 5 구조화 출력 1회 → self-check(상투어) 걸리면 재생성 1회
5. **서버 근거 검증**: ev id 실존 확인 + 새 숫자 탐지 → unsupported(no_evidence/new_number)
6. 점수 확정(evidence=커버리지×25, 나머지 clamp) + 플래그(남은 상투어·경험 과다 사용·충돌·적합성)
7. 버전 3건 저장(fact_summary/ai_tone/ai_delivery, meta 에 sources 스냅샷) + 세션 ai_revised 전환 + 응답

## 금지 행동을 막는 장치 (prohibited_ai_behavior → 검증 가능한 수단)

| 금지 | 장치 |
|---|---|
| 없는 성과·수치 추가 | new_number 서버 탐지(소스+질문 원문에 없는 숫자 → unsupported) |
| 없는 칭찬·감정·반응 추가 | 문장별 ev 필수(스키마) + no_evidence 플래그 + 프롬프트 선 |
| 합격자 문장 복제 | airline_profiles 주입 규칙(관찰만, 문장 인용 금지) — ai-killer 와 동일 |
| 전원 같은 구조/첫 문장 | 유형별 구조 '참고하되 강제 금지' + 말투 프로필 반영 + 상투어 self-check |
| 교훈·포부 억지 맺음 | 프롬프트 선("사실이 끝나는 곳에서 끝내라") + 연구원 수정 코드 UNNECESSARY_CONCLUSION |
| 학생 입력 속 지시 실행 | [자료] 블록 규칙 + 구조화 출력(자유 텍스트 자리 없음) |
| 경험 없는데 있는 척 | 초안 60자 미만 거절(대필 방지) + fit_check(억지 매칭 거절) + missing 표시 |

## 원가·상한

- revise: Opus 5 effort high, max_tokens 20,000(thinking 합산) — 실측은 answer_versions.meta.usage 로.
- recommend/followup: Haiku 4.5(건당 수 원). speak: Sonnet 5.
- 상한 상수(파일 상단): MAX_REVISE_PER_DAY 3 · MAX_SPEAK_PER_DAY 3 · MAX_FOLLOWUP_PAIRS 8 · MAX_RECOMMEND_PER_DAY 10(예약) · MAX_SOURCE_CHARS 6,000 · MAX_DRAFT_CHARS 2,000.
- 크레딧 차감 없음(이용권 포함) — 유료 결제가 붙을 때도 차감이 아니라 상한으로 관리(구매 단위가 '프로그램'이므로).

## 검증

`node scripts/answer-program-tests.mjs` — 서버 파일에서 순수 함수를 그대로 잘라 실행(59 케이스).
프롬프트·상한·근거 검증 식을 고치면 반드시 재실행. 배포 후에는 `POST {probe:true}` 로 버전 확인.
