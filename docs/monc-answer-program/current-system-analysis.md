# 매일 답변 프로그램 — 기존 시스템 분석 (2026-07-30)

브랜치: `claude/airline-interview-program-mvp-4c7671` (main 미푸시 — 테스트 후 병합).

## 1. 현재 구조 요약

| 항목 | 실체 |
|---|---|
| 프론트엔드 | 빌드 없는 정적 HTML/CSS/JS. 페이지별 인라인 스타일·스크립트 + 공용 파일(`tokens.css`, `nav.css`/`nav.js`, `supabase-config.js`, `sojae-common.js`, `lecture-common.js`) |
| 백엔드 | Supabase(Postgres + RLS + Edge Functions). 서버 코드는 Edge Function 4개(`ai-killer`, `sojae-chat`, `verify-payment`, `cancel-payment`) — **전부 콘솔 붙여넣기 배포라 한 파일 강제** |
| ORM | 없음. supabase-js 직접 호출. 마이그레이션은 `supabase/migrations/*.sql`을 오너가 SQL Editor에서 수동 실행 — **미적용 시 graceful degrade가 관례** |
| 인증 | 구글·카카오 OAuth → `members`(id=auth.users.id). 가드: `MONC.requireSession()`/`requireConsent()`/`requireAdmin()` |
| 권한 | `members.role`('admin'/'member') + `is_admin()` SECURITY DEFINER. **연구원 역할은 없음(신설 필요)** |
| 회원 | `members`: name, email, phone, cohort_id, role, agreed_at, terms_version, major |
| 상품·결제 | ① 챌린지: `challenge_rounds`+`applications`(포트원 verify-payment) ② 특강: `special_lectures`+슬롯 ③ AI 도구: `credit_ledger`(spend_credit/refund_credit RPC, 도구별 단가, 하루 무료 5) |
| 답변 첨삭 | `ai-killer` 함수의 `mode:'polish'` 분기(Opus 5, 구조화 출력, 상투어 self-check, `answer_polishes` 기록) |
| 답변 저장소 | `answers`(member_id, question_id nullable, title, content, category 4종, doc_kind, airline). `answers.html`+`mypage.html#sec-answers` |
| 기출문제 | `questions`(소재발굴용): content, category 4종, airline, scheduled_date. **RLS가 로그인 회원 전체 읽기** — 유료 기출을 담기엔 부적합 |
| 경험 재료 | `discovery_sessions`/`discovery_messages`(소재발굴 되묻기 대화). **구조화된 경험 카드는 없음(신설 필요)** |
| AI 연동 | Edge Function → api.anthropic.com 직접 fetch. `ANTHROPIC_API_KEY`는 프로젝트 공용 시크릿(새 함수도 자동 사용 가능). 구조화 출력(`output_config.format`) + self-check 재생성 + 프로브(`{probe:true}` → version/features) 관례 |
| 상투어 사전 | `ai_killer_terms`(admin '감점 사전' 탭, origin coach/general). 서버가 매 요청 읽어 재배포 없이 반영 |
| 항공사 자산 | `airline_profiles`(code=ke/lj/7c/tw/ze/yp/rf, questions/style/keywords/notes). RLS 비공개(서비스롤+관리자만) |
| 관리자 | `admin.html` 단일 페이지, `.tabbtn`/`.tab-panel(#panel-<tab>)` 탭 10개, `.round-form`/`.round-item` 폼·목록 관례 |
| 계측 | `page_events`(name, meta) 직접 insert, 실패 무시 |
| 테스트 | 프레임워크 없음. 관례: node 검증 스크립트(`scripts/ai-killer-dryrun.mjs` 등) + 브라우저 375px 실측 |
| 개인정보 | 가입 시 1회 동의(`agreed_at`), 거부 시 즉시 파기(`delete_my_account`), 계정별 로컬 캐시. **모델 학습 동의는 없음(신설 필요)** |

## 2. 재사용하는 것 (복제 금지)

- **인증·동의 게이트**: `MONC.requireSession()`+`requireConsent()` 그대로.
- **크레딧 원장**: 프로그램 안 AI 호출은 이용권(등록)에 포함시키되, 서버 횟수 상한으로 원가를 잠근다. `spend_credit` 구조는 건드리지 않음.
- **상투어 사전 `ai_killer_terms`**: 프로그램 AI의 self-check와 감점 기준으로 그대로 주입(사전 이원화 금지).
- **항공사 프로필 `airline_profiles`**: 첨삭 방향 근거로 동일하게 사용(레퍼런스≠정답 규칙 포함).
- **답변 저장소 `answers`**: 프로그램에서 확정한 최종 답변을 자유 글(question_id NULL, title=기출 문항)로 저장 → 기존 AI킬러(3cr)·첨삭(10cr)·답변노트가 **추가 개발 없이** 그 답변에 붙는다. 이것이 기존 첨삭 상품과의 연결점.
- **Edge Function 관례**: 프로브, FN_VERSION, HTTP 200+code, JWT→anon client, service role 쓰기, 구조화 출력, self-check, 실패 시 환급/미차감.
- **admin 관례**: 탭·폼·목록 클래스, init 시퀀스, `select('*')` 방어.
- **페이지 관례**: tokens.css+nav 2줄, sticky 서브 nav(top 67/57px), 바텀시트(`.sheet`), 9대 원칙(12px+/44px/4.5:1), 375px 우선.

## 3. 새로 만드는 것

- 테이블 10종(마이그레이션 1파일): `interview_questions`(유료 기출 은행 — 기존 `questions`와 분리, 아래 4-1), `answer_programs`, `answer_program_days`, `program_enrollments`, `experience_cards`, `experience_facts`, `answer_sessions`(상태기계 트리거), `answer_versions`(append-only), `correction_codes`, `researchers`(+`is_researcher()`), `member_consents`(모델 학습 동의), `member_tone_profiles`.
- RPC: `ap_program_view()`(등록 확인+공개일 계산+오늘의 문제 반환 — 잠긴 문제는 서버가 안 내보냄).
- Edge Function `answer-program`(한 파일): recommend/followup/revise/speak + probe.
- 페이지 4개: `programs.html`(허브), `program.html`(대시보드+작성 흐름), `experiences.html`(경험 창고), `review-desk.html`(연구원 검수 — `reviews.html`(후기)과 이름 충돌 회피).
- admin '답변 프로그램' 탭, 승준노트 카드 1장, nav 하위 항목 1개.
- 데모 모드(`program-common.js`): 로그인·DB·API 키 없이 localStorage로 전체 흐름 검증(원칙 13의 목업 어댑터).

## 4. 설계 결정과 근거

1. **기출을 기존 `questions`에 넣지 않는다.** ① 그 테이블 RLS가 로그인 회원 전체 읽기라 유료 기출이 무료로 새고 ② 소재발굴 '오늘의 문제' 순환 풀이 오염되며 ③ 의도·평가기준 등 컬럼 확장이 소재발굴 조회를 무겁게 한다. 대신 `interview_questions`는 RLS 비공개 + 등록자 전용 RPC로만 서빙(감점 사전과 같은 '자산' 취급). 최종 답변은 `answers` 자유 글로 합류하므로 FK 문제도 없다.
2. **결제는 MVP에서 관리자 지급(이용권).** `program_enrollments.source='admin'`. 포트원 연결은 verify-payment에 `programId` 분기를 추가하면 되는 구조로 열어 두되(enrollments에 payment_id 자리 있음), 라이브 결제 함수를 이 브랜치에서 건드리지 않는다(돈 걸린 파일).
3. **연구원 = `researchers` 테이블 + `is_researcher()`.** members.role 확장(check 제약 변경)보다 안전 — 기존 role 체크 코드('admin'/'member' 전제)를 안 건드린다.
4. **AI 버전은 전부 `answer_versions` append-only 한 표.** 학습 사례 연결(data_capture)은 session_id 하나로 전 과정이 묶인다.
5. **상태 전이는 DB 트리거가 심판**(중복 신청 가드 MC002와 같은 방식, errcode `MC003`). 브라우저·중계 함수 어느 길로 와도 한 곳에서 막힌다.
6. **문장-근거 연결은 서버가 검증한다.** AI가 낸 evidence ref가 실제 전달한 사실 id인지, 인용문이 원 자료에 실제로 있는지 서버가 확인 — 없으면 그 문장에 unsupported 플래그(ai-killer의 context_extra 검증과 같은 철학).

## 5. 데이터 마이그레이션 위험

- 전부 **신규 테이블/함수** — 기존 행 UPDATE/백필 없음. 기존 데이터 파괴 위험 0.
- 롤백: 신규 객체 drop만으로 완전 복구(문서 data-model.md에 롤백 SQL 포함).
- 미적용 degrade: 각 페이지가 `PGRST205`(테이블 없음)를 감지해 '준비 중' 안내. 기존 기능 무영향.
- 프로덕션 Supabase에 먼저 적용해도 안전: 새 테이블은 페이지가 브랜치에만 있어 라이브 사용자가 닿을 수 없다.

## 6. 기술 부채·충돌 가능성

- `answers` unique(member_id, question_id)는 소재발굴 전용 — 프로그램 답변은 question_id NULL이라 무관.
- 소재발굴(`sojae.html`)과 경험 수집이 겹쳐 보일 수 있음 → 소재발굴은 '기초 쌓기'(무료 되묻기), 프로그램은 '항공사 기출 완성'(유료)으로 문구 구분. 소재발굴 대화를 경험 카드로 승격하는 연결은 후속 과제.
- 리허설(`claude/rehearsal-wip`)과 브랜치 병합 순서 무관(파일 겹침 없음).
- Edge Function 신규 배포 필요(오너 콘솔) — 배포 전에도 데모 모드로 화면 검증 가능, 실 모드는 프로브 게이트가 '준비 중'으로 막는다.

## 7. 구현 우선순위 (수직 슬라이스)

1. 마이그레이션 + 시드 → 2. `answer-program` 함수 → 3. 학생 흐름(programs→program→experiences) → 4. 연구원(review-desk) → 5. admin 탭 → 6. 데모 모드 E2E + 검증 스크립트 → 7. 문서.
