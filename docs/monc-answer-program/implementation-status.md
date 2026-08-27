# 매일 답변 프로그램 — 구현 상태 (2026-07-30 작성 · 구 브랜치 airline-interview-program-mvp — main 병합 완료)

기준: 오너 원본 스펙 `docs/monc-answer-program-spec.md` (참고용 원문 보존본).
**main 병합 완료**(2026-07-30 반영·브랜치 삭제됨 — 정정 2026-08-15). 라이브 배포 전 3가지는 전부 해소(2026-07-30 프로브·코드 확인): ① 마이그레이션 실행 ✅(프로브 sessions_table:true) ② answer-program 함수 배포 ✅(version 2026-07-30b) ③ privacy.html 고지 갱신 ✅(이 브랜치 — 병합 시 반영). 프로브 기준 questions 99개(시드 10 + 오너 등록분) · programs 1개.

## 완료 조건(스펙 28항) 대조

| # | 조건 | 상태 |
|---|---|---|
| 1~2 | 분석·명세·아키텍처 문서 | ✅ docs/monc-answer-program/ 8종 + 원본 스펙 보존 |
| 3 | 마이그레이션 | ✅ `20260730150000_answer_program.sql`(롤백 포함) — **실행 완료**(프로브 sessions_table:true — 현행 시점 상태는 `docs/notes/implementation-status.md`) |
| 4~5 | 프로그램 생성·이용권 연결 | ✅ admin 탭 ②③ + **포트원 결제 구매**(verify-payment `programId` 분기 — 2026-07-30 배포 완료). 체험판·무료 자가 등록 없음(2026-07-30 오너) |
| 6~10 | 오늘 문제·경험 카드·선택·추가 질문·초안 저장 | ✅ 데모 E2E 실측 통과 |
| 11~13 | 확인된 사실만 첨삭·문장-근거 연결·근거 없는 문장 표시 | ✅ 서버 검증(no_evidence/new_number) + 화면 빨간 표시·시트, 버전 선택 시 제외 |
| 14~15 | 두 버전·품질 지표 | ✅ 말투 유지형/전달력 강화형 + 7항목(경험 근거는 서버 측정) |
| 16~17 | 연구원 자료 열람·수정 코드+이유 | ✅ review-desk(2열/모바일 스택) |
| 18~19 | 최종 확정·버전 이력 보존 | ✅ append-only answer_versions + answers 합류 |
| 20~21 | 관리자 기능·3권한 분리 | ✅ admin 탭 6절 + is_researcher() (연구원=검수, 관리자=운영, 학생=본인) |
| 22 | 서비스/모델 개선 동의 분리 | ✅ member_consents(선택·기본 꺼짐·철회 가능) |
| 23~25 | 테스트·린트·타입·빌드 | ✅ node 59/59 + deno check + node --check (빌드는 없음 — 정적 사이트) |
| 26 | 기존 회귀 없음 | ✅ 기존 파일 수정은 briefing 카드·nav 항목·admin 탭 추가뿐(기존 로직 무변경). 라이브 확인은 테스트 계획 3-10 |
| 27 | 모바일·데스크톱 흐름 | ✅ 375px 전 흐름 + 1280px 검수 2열 실측(스크린샷은 프리뷰 제약으로 미첨부 — 텍스트·지오메트리 실측) |
| 28 | 남은 문제 문서화 | ✅ 이 문서 |

## 새 파일 / 수정 파일

- **신규**: `programs.html` `program.html` `experiences.html` `review-desk.html` `program-common.js` `supabase/functions/answer-program/index.ts` `supabase/migrations/20260730150000_answer_program.sql` `scripts/answer-program-tests.mjs` `docs/monc-answer-program-spec.md` `docs/monc-answer-program/*`(9)
- **수정**: `briefing.html`(매일 기출 카드+아이콘) `nav.js`(하위 메뉴·SECTION_OF) `admin.html`(답변 프로그램 탭) `CLAUDE.md`(원칙 절)

## 스펙에서 의도적으로 조정·보류한 것 (왜)

| 스펙 항목 | 결정 |
|---|---|
| airlines/interview_stages 별도 테이블 | 사이트 전역이 코드 상수(LEC.AIRLINES)라 컬럼으로 통일 — 테이블 이원화가 오히려 충돌 |
| 음성 답변 입력 | 보류(구조는 experience_facts.source='voice' 자리) — 업로드·전사 인프라가 사이트에 없음 |
| 결제(유료 프로그램) | ✅ 구현으로 전환(2026-07-30 오너 "체험판 없이 바로 유료") — verify-payment `programId` 분기(JWT 지급·DB 금액 재확인·중복/지급실패 전액 환불) + program.html 구매 패널. **2026-07-30 배포 완료** |
| 이력서 대조 일관성 검사 | 이력서 데이터 자체가 없음 — 경험 중복(use_count)·사실 충돌(conflicts)만 구현 |
| 분석 대시보드 | 원자료는 전부 쌓임(세션 상태·버전·page_events ap_*) — 집계 화면은 admin ⑥ 진행률 최소판 |
| 연구원 화면 3패널 | 2패널(자료/편집)로 — 720~1080px 현실 폭에서 3열은 각 열이 9대 원칙 활자 하한을 깨뜨림. 근거·경고는 자료 패널에 인라인 |
| 가상 학생 2명 시드 | auth 계정은 SQL 로 못 만든다 — 데모 모드(체험 회원)가 그 역할. DB 시드는 기출·프로그램만 |
| 상태명 | 스펙 대문자 → 사이트 관례 snake_case(의미 동일) |

## 남은 위험

0. **프로그램 구매 환불은 아직 수동** — 구매 건은 `applications` 가 아니라 admin [환불] 버튼 대상이 아니다. 환불이 필요하면 포트원 콘솔에서 결제 취소 + admin '이용권 지급' 목록에서 회수. (자동 환불은 중복 구매·지급 실패 두 경우만 서버가 처리.) 원클릭 환불 버튼은 후속.

1. **Opus 실응답 품질 미검증** — 근거 검증기는 어떤 응답이 와도 unsupported 를 붙이지만, 두 버전의 품질 차·점수 타당성은 라이브 스팟체크(테스트 계획 3-5·9) 필요. 프롬프트 조정 시 PROMPT_VERSION 올릴 것.
2. **연구원의 members 열람 범위** — 행 단위 RLS 한계로 이름 외 컬럼도 열린다(내부 인력 전제). 민감하면 후속으로 이름 전용 뷰 교체.
3. **revise 원가** — effort high + 20k max_tokens. 실측(meta.usage) 후 상한·effort 조정 여지.
4. ~~privacy.html 미갱신~~ → **2026-07-30 갱신 완료**(수집 항목·이용 목적·보유 기간·Anthropic 위탁·국외 이전 + 선택 동의 고지). 오너 최종 확인만 남음(privacy-and-consent.md 하단).
5. 데모 모드 흔적 — localStorage 기반이라 실배포에 위험은 없지만, 정식 오픈 시 허브의 '체험 모드' 진입 문구를 유지할지 오너 결정.

## 다음 개발 우선순위(제안)

0. **정규반 교재에서 필수 기출 30+ 추출·입력**(2026-07-30 오너: 교재가 기출 소스, 난이도 조립은 오너가 admin '일차 배치'로. ⚠️ 교재 내용은 공개 리포 커밋 금지 — SQL 은 대화창 전달)
1. 라이브 검증(테스트 계획 3절 — verify-payment 재배포 포함)
2. ~~소재발굴(sojae) 대화 → 경험 카드 승격 버튼~~ → **2026-08-16 구현 완료(재배포 대기)** — sojae [소재 창고에 담기](처음엔 대화 꼬리 칩·다듬기와 같은 시점 → **2026-08-19 저장 완료 패널의 글줄 버튼으로 이사** — 대화 도중 이탈·유실 사고) → answer-program `card_from_chat` 액션이 학생 발화의 사실만 추려 `origin='sojae'` 카드로 저장(무과금·하루 10회 상한·MODEL_SPEAK) → 소재 창고 `?edit=<id>` 수정 폼이 바로 열리며 확인 안내. 같은 날 초안 단계에 **[내가 쓴 사실 불러와 시작하기]**(카드·문답 문장을 유형 흐름 순서로 초안 칸에 붓는 클라이언트 전용 버튼 — AI 생성 0, `ap_draft_seed` 계측)도 추가. **2026-08-16 오너 재배포 완료** — 프로브 실측 FN_VERSION `2026-08-16b`·features `card_from_chat` 포함(재배포 전이면 화면이 '준비 중' 안내로 degrade 하는 설계였다 — 무과금이라 오차감 위험 없음)
3. 검수 완료 알림(현재는 학생이 화면에서 확인)
4. 분석 집계 화면(원자료는 쌓이는 중)


## CLAUDE.md 이관 메모 (2026-07-30 시점)

> 아래는 CLAUDE.md 다이어트(2026-07-30) 때 원문 그대로 옮긴 운영 기록이다. 위 본문과 겹치면 아래(더 최근 기록)가 우선.
> ⚠️ 2026-08-15 정정: 아래 원문의 'main 미병합'·'owner 실행 필요'는 옛 상태다 — 2026-07-30 main 반영, 마이그레이션·verify-payment `programId` 분기 모두 적용·배포 완료. 원문은 기록이라 그대로 둔다(현행 시점 상태는 `docs/notes/implementation-status.md`).

### 오너 지시 원문 — 제품 목표·작업 방식 (2026-08-27 CLAUDE.md 2차 다이어트 이관)

> 절대 원칙 10개는 CLAUDE.md '매일 답변 프로그램' 절에 그대로 남아 있다. 아래는 같은 오너 지시(2026-07-30)의 나머지 원문이다.

**제품 목표**

항공사별 기출문제를 매일 작성하며 학생의 실제 경험을 바탕으로
개인화된 면접답변을 완성하는 프로그램을 개발한다.

상세 요구사항은 다음 문서를 따른다.

`docs/monc-answer-program-spec.md`

**작업 방식**

- 먼저 기존 저장소 구조를 분석한다.
- 저장소에서 확인 가능한 내용은 사용자에게 다시 묻지 않는다.
- 구현 계획만 작성하고 종료하지 않는다.
- 기능을 작은 수직 단위로 구현하고 검증한다.
- 완료하지 못한 내용은 정확하게 기록한다.

### 매일 답변 프로그램 (2026-07-30 신설 · 브랜치 airline-interview-program-mvp — main 미병합)
**"매일 한 문제씩, 내 경험으로 완성하는 항공사 면접답변 프로그램."** 오너 원본 요구사항은 `docs/monc-answer-program-spec.md`(참고용 원문), 구현 원장은 `docs/monc-answer-program/`(analysis·spec·architecture·data-model·ai-pipeline·privacy·admin-guide·test-plan·implementation-status). 페이지: `programs.html`(허브)·`program.html`(작성 흐름)·`experiences.html`(경험 창고)·`review-desk.html`(연구원 검수 — ⚠️ `reviews.html` 후기와 다른 파일) + admin '답변 프로그램' 탭 + 승준노트 카드 '매일 기출'. 서버: `supabase/functions/answer-program/index.ts`(한 파일·프로브 있음), migration `20260730150000_answer_program.sql`(**owner 실행 필요** — 미적용 시 전부 '준비 중' degrade).
- **원칙은 바로 위 'MONC 답변 프로그램 개발 원칙'(오너 지시 원문)이 원장이다.** 이 프로그램 코드를 고칠 때 절대 원칙 10개를 먼저 읽을 것. 자체 검수 명령: `node scripts/answer-program-tests.mjs` + `deno check supabase/functions/answer-program/index.ts` + 브라우저 375px 실측.
- **⚠️ 1차 상품 = 필수 기출(전 항공사 공통 — 2026-07-30 오너 "항공사 세부는 지금 안 다룬다. 필수 기출 30개를 먼저 작성하는 느낌으로").** `answer_programs.airline`/`interview_questions.airline` 의 **null=공통**이고 첫 프로그램이 이것이다. 항공사별 프로그램은 구조만 있고 후속. **오너의 필수 기출 30문항 원본은 아직 미입력** — 받으면 '필수 기출 30일 루틴' 시드를 만든다(그때까지는 seed-demo 의 공통 10문항·맛보기 5일이 검증용).
- **⚠️ 근거 검증이 이 상품의 심장** — 서버(`apValidateSentences`)가 AI 문장의 근거 id 실존 + **자료에 없는 숫자**를 검사해 unsupported 를 붙인다. 근거 없는 문장은 조용히 통과하지 않는다(화면 빨간 표시, '이 버전으로 다듬기'에서 제외). 이 검증을 우회하는 코드를 넣지 말 것.
- **⚠️ 기출은 기존 `questions`(소재발굴)에 넣지 않는다** — 그 표는 로그인 회원 전체 읽기 RLS 라 유료 기출이 샌다. `interview_questions` 는 비공개이고 회원 서빙은 `ap_program_view()` RPC 하나(잠긴 일차의 문제는 응답에 안 실린다).
- **⚠️ 확정본은 `answers` 자유 글로 합류**(title=문항·doc_kind=interview) — 그래서 AI킬러·첨삭·답변노트가 무수정으로 붙는다. 이 연결을 끊지 말 것.
- **⚠️ 세션 상태는 DB 트리거가 심판**(errcode MC003/MC004/MC005). 학생은 ai_revised 점프·approved 자가 부여 불가. 공개일 식은 SQL·index.ts·program-common.js **세 벌 동기** — 고치면 셋 다 고치고 테스트 스크립트로 확인.
- **⚠️ 크레딧 차감 없음(이용권 포함 상품)** — 대신 서버 상한(revise 3/일/세션 등)이 원가 잠금. 상투어는 `ai_killer_terms` 재사용(사전 이원화 금지).
- **⚠️ 체험판·무료 등록 없음(2026-07-30 오너 "체험판 없이 바로 유료").** 이용권이 생기는 길은 둘뿐 — ① **verify-payment 의 `programId` 분기**: 지급 대상은 body 가 아니라 **JWT**, 금액은 `answer_programs.price` 를 서버가 재확인, 이미 이용권 보유면 **전액 자동 환불**(`already_enrolled`), 지급 실패도 전액 환불(`grant_failed`) — 둘 다 HTTP 200(브라우저가 환불 안내를 띄워야 하므로). ② admin '이용권 지급'. **이 분기는 owner 가 verify-payment 를 재배포해야 동작**(콘솔 — **2026-07-30 배포 완료**. 프로브: anon key 로 `{paymentId:'probe', programId:'00000000-…-0'}` → `not_authenticated`=신버전(JWT 확인이 프로그램 조회보다 먼저다), `bad_request`=구버전). ⚠️ `program_enrollments` 에 회원 자가 INSERT 정책이 **일부러 없다** — 되살리면 유료 상품이 공짜로 열린다. 데모(`?demo=1`)는 공개 화면에서 진입 링크를 뺐다(내부 QA 전용). 시드 기본가 99,000원(구 총량제 30개 확정가 기준 — admin 에서 수정).
- **⚠️ 기출 소스 = 정규반 교재 PDF(오너 PC).** 교재의 기출·가이던스는 학원 자산이라 **공개 리포에 커밋 금지**(airline_profiles 원문과 같은 규칙) — 비공개 표(`interview_questions`)에만 넣고, SQL 은 대화창으로 전달한다.
- 데모 모드(`?demo=1`) = 로그인·DB·API 키 없이 전체 흐름 검증하는 목업 어댑터(program-common.js). 화면에 체험 배너가 항상 뜬다.
