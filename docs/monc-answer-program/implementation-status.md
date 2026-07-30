# 매일 답변 프로그램 — 구현 상태 (2026-07-30 · 브랜치 airline-interview-program-mvp)

기준: 오너 원본 스펙 `docs/monc-answer-program-spec.md` (참고용 원문 보존본).
⚠️ **main 미푸시** — 테스트 후 병합 예정. 라이브 배포 전 필요한 3가지: ① 마이그레이션 실행 ② answer-program 함수 콘솔 배포 ③ privacy.html 고지 갱신.

## 완료 조건(스펙 28항) 대조

| # | 조건 | 상태 |
|---|---|---|
| 1~2 | 분석·명세·아키텍처 문서 | ✅ docs/monc-answer-program/ 8종 + 원본 스펙 보존 |
| 3 | 마이그레이션 | ✅ `20260730150000_answer_program.sql`(롤백 포함) — **owner 실행 대기** |
| 4~5 | 프로그램 생성·이용권 연결 | ✅ admin 탭 ②③ + **포트원 결제 구매**(verify-payment `programId` 분기 — owner 재배포 필요). 체험판·무료 자가 등록 없음(2026-07-30 오너) |
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
| 결제(유료 프로그램) | ✅ 구현으로 전환(2026-07-30 오너 "체험판 없이 바로 유료") — verify-payment `programId` 분기(JWT 지급·DB 금액 재확인·중복/지급실패 전액 환불) + program.html 구매 패널. **owner 재배포 필요** |
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
4. **privacy.html 미갱신** — 라이브 전 필수(privacy-and-consent.md 하단).
5. 데모 모드 흔적 — localStorage 기반이라 실배포에 위험은 없지만, 정식 오픈 시 허브의 '체험 모드' 진입 문구를 유지할지 오너 결정.

## 다음 개발 우선순위(제안)

0. **정규반 교재에서 필수 기출 30+ 추출·입력**(2026-07-30 오너: 교재가 기출 소스, 난이도 조립은 오너가 admin '일차 배치'로. ⚠️ 교재 내용은 공개 리포 커밋 금지 — SQL 은 대화창 전달)
1. 라이브 검증(테스트 계획 3절 — verify-payment 재배포 포함)
2. 소재발굴(sojae) 대화 → 경험 카드 승격 버튼(재료가 이미 discovery_messages 에 있다)
3. 검수 완료 알림(현재는 학생이 화면에서 확인)
4. 분석 집계 화면(원자료는 쌓이는 중)
