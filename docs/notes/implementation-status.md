# 배포·적용 시점 상태 (사이트 전반)

> 시점에 따라 바뀌는 상태만 모은다: Edge Function 배포 버전, 마이그레이션 적용 여부, 브랜치, 대기 중인 자산.
> 2026-07-30 CLAUDE.md 다이어트 때 본문 곳곳에 흩어져 있던 기록을 모은 것 — **기준 시점 2026-07-30.** 상태가 바뀌면 이 문서를 갱신한다.
> 답변 프로그램 전용 상태는 `docs/monc-answer-program/implementation-status.md` 가 원장.

## Edge Function 배포 상태

배포 확인은 전부 **anon key 프로브**(결제 생성·DB 쓰기 없음 — 안전). 관리자에게 SQL 을 시키지 말 것.

| 함수 | 기록된 상태(2026-07-30) | 프로브 |
|---|---|---|
| verify-payment | 특강 분기 2026-07-24 배포 · creditPack 분기 2026-07-25 · `programId` 분기 2026-07-30 배포 완료 | 특강: `{paymentId:'probe', lectureId:'00000000-0000-0000-0000-000000000000', applicant:{name:'x',phone:'0'}}` → `lecture_not_found`=지원, `bad_request`=구버전, 404=미배포. 프로그램: `{paymentId:'probe', programId:'00000000-…-0'}` → `not_authenticated`=신버전(JWT 확인이 프로그램 조회보다 먼저), `bad_request`=구버전 |
| cancel-payment | 배포됨(2026-07-23 신설, 환불 실측 확인 2026-07-25) | `{applicationId:'probe', amount:1}` → `unauthorized`(401)=배포됨, 404=미배포 |
| ai-killer (polish 겸용) | 2026-07-25 확인 `2026-07-25d`·프로필 4곳·사전 28개 → polish 추가 후 `2026-07-30b`(`coach_terms` 주입). **레포는 `2026-07-31a`** — deno check 타입 표기 정리만이라 동작 동일, 재배포 급하지 않음(다음 실변경 배포 때 자연 반영) | 로그인 없이 `POST {"probe":true}` → `version`·`features`·`airline_profiles`/`terms` 개수·`has_api_key`. `coach_terms` 0 이면 연구진 자산 미유입 |
| sojae-chat | v2(카드+뼈대) 배포. **크레딧 차감은 재배포된 버전부터 동작** — 재배포 전엔 화면 안내만 바뀌고 차감 안 됨 | `POST {probe:true}` → `version`·`playbook_keys` |
| answer-program | `2026-07-30b` (프로브 sessions_table:true · questions 99 · programs 1) | 프로브 있음 — 상세는 `docs/monc-answer-program/implementation-status.md` |

## 마이그레이션 적용 현황 (기록 기준)

"owner 실행 필요/표기"는 구 CLAUDE.md 에 그렇게 적혀 있던 것이다 — 실제 적용 여부가 의심되면 프로브·실동작으로 확인한다. 전부 미적용 graceful degrade 가 설계돼 있다.

| migration | 내용 | 기록된 상태 |
|---|---|---|
| `20260708120000_member_major` | members.major | owner 실행 표기(미적용 시 major 만 방어적 무시) |
| `20260710130000_reviews_classify` | 후기 분류 컬럼 + 기존 108건 백필 | owner 실행 표기 |
| `20260711120000_applications_rls` | applications RLS | owner 실행 표기 |
| `20260715120000_member_consent` | agreed_at·terms_version + `delete_my_account()` | owner 실행 표기(미적용 시 계정별 로컬 폴백 + 추후 백필) |
| `20260717120000_applications_payment` | 결제 컬럼 4종 | 적용(결제 운영 중) |
| `20260721120000_news_board` | news_articles | 실행 완료 |
| `20260723120000_payment_refunds` | refunds·refunded_amount | **실행 완료 — 다시 실행 안내 금지** |
| `20260724120000_special_lectures` | special_lectures + applications.lecture_id | owner 실행 필요 표기(특강이 운영 중이면 적용된 것) |
| `20260724130000` | 특강 airline·seats_left 컬럼 | 미적용 시 브랜딩만 빠짐 |
| `20260724140000_lecture_images_bucket` | Storage `lecture-images` 버킷 | **실행 완료(2026-07-24) — 다시 실행 안내 금지** |
| `20260724150000_lecture_seat_counting` | 잔여석 트리거(MC001) | owner 실행 필요 표기 |
| `20260724160000_lecture_slots` | 특강 시간대 | owner 실행 필요 표기 |
| `20260725120000_duplicate_application_guard` | 중복 신청 트리거(MC002) | owner 실행 필요 표기 |
| `20260725160000_ai_killer_context` | 검사 기록 문항·종류 컬럼 | 실행 대기(킬러 스펙 '오너 할 일' 기준 — 미적용이어도 검사 정상) |
| `20260725170000`·`180000`·`190000` | 크레딧 분류 3종·단가·하루 무료·팩 3종 | **전부 적용 완료(2026-07-25)** |
| `20260725200000` + `20260725210000` | airline_profiles(+티웨이) | 적용 완료 |
| `20260730120000_challenge_waitlist` | 오픈 알림 명단 | **owner 실행 필요** |
| `20260730130000_answer_polishes` | 첨삭 기록 + 리허설 단가 15 선반영 | **owner 실행 필요** 표기(단 `credit_free_limits.polish` 는 'DB 적용 완료'로 기록 — 어긋나 보이면 프로브 `polish_table` 로 확인) |
| `20260730150000_answer_program` | 답변 프로그램 전체(롤백 포함) | 실행 완료(프로브 확인) |

## 브랜치

- `claude/rehearsal-wip` — 모의면접(리허설) 자산 전체. **`rehearsal.html` 은 main 에 없다** — 승준노트 숨김 카드(`display:none`)를 켜기 전에 이 브랜치부터 병합할 것(안 하면 404).
- `airline-interview-program-mvp` — 매일 답변 프로그램. **main 미병합**(테스트 후 병합 예정 — 상세는 `docs/monc-answer-program/implementation-status.md`).

## 대기 중인 자산·데이터

- **항공사 합격 자소서**: 확보 = 제주 3 · 에어프레미아 2 · 이스타 1 · 티웨이 1. **미확보 = 대한항공·진에어·에어로케이 — 대한항공이 우선순위 1번**(지망자 최다인데 0건). 아시아나는 대한항공에, 에어서울·에어부산은 진에어에 통합돼 목록에 없다.
- **필수 기출 30문항 원본**(오너) — 미입력. 받으면 '필수 기출 30일 루틴' 시드를 만든다(그때까지는 seed-demo 공통 10문항·맛보기 5일이 검증용).
- **감점 사전 `origin='coach'` 자산** — 미유입(임시 시드 28건뿐). 프로브 `coach_terms` 0 이면 아직.
- `apply.html` FAQ #3·#6·#7 — 임시 문구.
- GitHub Actions 뉴스 스케줄 — 공개 리포는 **60일간 커밋이 없으면 자동 중지**(메일 통지 후 버튼 재활성).
