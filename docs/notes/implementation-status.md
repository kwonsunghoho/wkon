# 배포·적용 시점 상태 (사이트 전반)

> 시점에 따라 바뀌는 상태만 모은다: Edge Function 배포 버전, 마이그레이션 적용 여부, 브랜치, 대기 중인 자산.
> 2026-07-30 CLAUDE.md 다이어트 때 본문 곳곳에 흩어져 있던 기록을 모은 것 — **기준 시점 2026-07-30.** 상태가 바뀌면 이 문서를 갱신한다.
> 답변 프로그램 전용 상태는 `docs/monc-answer-program/implementation-status.md` 가 원장.

## Edge Function 배포 상태

배포 확인은 전부 **anon key 프로브**(결제 생성·DB 쓰기 없음 — 안전). 관리자에게 SQL 을 시키지 말 것.

| 함수 | 기록된 상태(2026-07-30) | 프로브 |
|---|---|---|
| verify-payment | 특강 분기 2026-07-24 배포 · creditPack 분기 2026-07-25 · `programId` 분기 2026-07-30 배포 완료 · **`resourceId`(연구실 유료 자료) 분기 2026-08-01 배포 완료**(프로브 실측 — `{paymentId:'probe', resourceId:'0000…'}` → 401 `not_authenticated`) | 특강: `{paymentId:'probe', lectureId:'00000000-0000-0000-0000-000000000000', applicant:{name:'x',phone:'0'}}` → `lecture_not_found`=지원, `bad_request`=구버전, 404=미배포. 프로그램: `{paymentId:'probe', programId:'00000000-…-0'}` → `not_authenticated`=신버전(JWT 확인이 프로그램 조회보다 먼저), `bad_request`=구버전. 자료: `{paymentId:'probe', resourceId:'00000000-…-0'}` → `not_authenticated`=신버전, `bad_request`=구버전 |
| cancel-payment | 배포됨(2026-07-23 신설, 환불 실측 확인 2026-07-25) | `{applicationId:'probe', amount:1}` → `unauthorized`(401)=배포됨, 404=미배포 |
| ai-killer (polish·quickfix 겸용) | **`2026-08-04a` 배포 확인(2026-08-04)** — 콘솔 코드 상단 `FN_VERSION` 눈으로 확인. 이 배포에 미니 다듬기(`quickfix`)와 환급 서버 전용화(`refund_server`)가 같이 올라갔다. 레포와 같음 | 로그인 없이 `POST {"probe":true}` → `version`·`features`·`airline_profiles`/`terms` 개수·`has_api_key`. `features` 에 `quickfix` + `quickfix_table` 숫자면 미니 다듬기 살아 있음. **`refund_server` 있으면 환급이 service_role 경로**(없으면 구버전 — 20260804160000 을 실행하면 안 된다). `coach_terms` 0 이면 연구진 자산 미유입. ⚠️ 오너 환경에선 크롬이 콘솔 붙여넣기를 막는다("allow pasting" 을 직접 타이핑해야 한다) — **콘솔 코드 화면에서 `FN_VERSION` 을 눈으로 보는 쪽이 빠르다** |
| sojae-chat | **`2026-08-04a` 배포 확인(2026-08-04)** — 환급 서버 전용화. 레포와 같음. (v2 카드+뼈대는 그 전 배포) | `POST {probe:true}` → `version`·`playbook_keys`·`features`. **`features` 에 `refund_server` 있으면 새 버전** |
| answer-program | `2026-07-30b` (프로브 sessions_table:true · questions 99 · programs 1) | 프로브 있음 — 상세는 `docs/monc-answer-program/implementation-status.md` |
| lab-file | **`2026-08-01f` 배포 확인**(프로브 실측 2026-08-01 — `features` 에 `paid`+`multi_file`). 레포와 같음 | `POST {"probe":true}` → `version`·`features`·`bucket`. `features` 에 `external_url`=영상 지원, **`paid`=유료 지원(e), `multi_file`=자료 하나에 파일 여러 개(f)**. 404 면 미배포. ⚠️ **`paid` 없는 버전에서 자료에 값을 매기면 무료로 열리고, `multi_file` 없는 버전은 파일이 여럿이어도 첫 파일만 내보낸다**(2026-08-01 실사고 — 마이그레이션과 재배포를 같이 한다) |

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
| `20260731120000_expression_reports` | 미니 다듬기(quickfix) 수집함 | **owner 실행 필요**(마이그레이션만 남았다 — **ai-killer 재배포는 2026-08-04 에 완료**). 미적용이면 위젯이 '준비 중'으로만 뜬다 |
| `20260801120000_lab_resources` | 연구실 자료(비공개 버킷 `lab-files` + `lab_resources`·`lab_downloads` + 목록/집계/비밀번호 RPC) | **실행 완료(2026-08-01)** — anon RPC 프로브로 확인(`lab_shelf_counts`·`lab_resource_list` 정상 응답) |
| `20260801130000_lab_resources_admin` | 위 보완 — `is_admin()` 에게만 자료 전권·열람기록 조회·`lab-files` 버킷·`lab_set_password` 개방 | **실행 완료(2026-08-01)** — anon 프로브로 확인(자료 등록 시도가 RLS 로 거부·`lab_set_password` 42501) |
| `20260801140000_lab_video` | 영상관 유튜브 링크 — `external_url`·`duration_sec` 추가, `storage_path` nullable, 목록 RPC 재생성 | **실행 완료(2026-08-01)** — 영상 등록·조회 확인 |
| `20260801150000_lab_thumbs` | 영상 썸네일 — 목록 RPC 가 `video_id`(유튜브 11자 id) 반환 | **실행 불필요 — 아래 160000 이 같은 정의를 품고 있고 그쪽이 적용됐다**(목록 RPC 프로브에 `video_id` 확인). ⚠️ 이 파일을 지금 실행하면 `price`·`owned` 가 사라져 유료가 무료로 열린다 |
| `20260801160000_lab_paid` | 연구실 **유료 자료**(자료마다 `price`) — `lab_resources.price` · `lab_purchases` · 목록 RPC 에 `price`·`owned` · `lab_my_purchases()` · `lab_sales_summary()` | **실행 완료(2026-08-01)** — 목록 RPC 프로브에 `price`·`owned`·`video_id` 확인. lab-file `2026-08-01e`·verify-payment `resourceId` 분기도 배포 완료. ⚠️ **이 파일이 목록 RPC 의 최종 정의다**(`video_id`+`price`+`owned`). 140000·150000·160000 이 같은 함수를 재생성하므로 **나중에 실행한 쪽이 이긴다.** 이 파일에 150000 의 `video_id` 정의가 그대로 들어 있어 **150000 을 건너뛰고 이것만 실행해도 썸네일까지 켜진다.** 반대로 150000 을 이 파일 뒤에 실행하면 `price`·`owned` 가 사라져 **유료 자료가 전부 무료로 열린다**(그때는 이 파일만 다시 실행하면 복구). 미적용이면 admin 가격 칸이 '마이그레이션 먼저' 안내를 띄운다 |
| `20260801180000_reviews_kind` | **후기 종류 분리** — `reviews.kind`(challenge/consult) + `image_path` not null 완화(글만 있는 후기) + `success_stories`(합격 수기) 표·RLS | **owner 실행 필요(2026-08-01 작성)** — 미적용이면 챌린지 후기 108건은 그대로 뜨고(전부 challenge 취급), 허브에 상담·합격 수기 카드가 안 나온다. admin 은 '글만 후기 추가'·'합격 수기' 칸에서 마이그레이션 안내를 띄운다. lab 쪽 표를 건드리지 않으므로 실행 순서 무관 |
| `20260802100000_signup_credit` | **가입 축하 크레딧** — `site_config.credit_signup_bonus`(15) + `grant_signup_credit()` RPC(회원당 1회·멱등) + 부분 유니크 인덱스 | **적용 완료(2026-08-02 오너 실행)** — 로그인하면 회원당 1회 15크레딧이 들어간다. 지급량은 admin '크레딧' 탭 '가입 축하(1회)' 칸에서 조절(0=중단) |
| `20260801170000_lab_resource_files` | **자료 하나에 파일 여러 개**(상·하편) — `lab_resource_files` 신설 + 기존 `storage_path` 백필 + `source_required` check 해제 + 목록 RPC 에 `file_count` | **실행 완료(2026-08-01)** — 목록 RPC 프로브에 `file_count` 확인, lab-file `2026-08-01f` 배포 확인. ⚠️ **이제 이 파일이 목록 RPC 의 최종 정의다**(`video_id`+`price`+`owned`+`file_count`) — 140000·150000·160000 을 이 뒤에 실행하면 `file_count` 가 사라진다. 미적용이면 파일 1개짜리는 그대로 동작하고, 여러 개를 올리려 하면 admin 이 '마이그레이션 먼저' 안내를 띄운다 |
| `20260803120000_member_archive` | **회원 보관** — `members.archived_at` + 인덱스. 새 RLS 없음(기존 `members_admin_all` 이 덮는다) | **owner 실행 필요(2026-08-03 작성)** — 미적용이면 아무도 보관 상태가 아니고 '보관함' 칩 숫자가 비며, [보관] 을 누르면 admin 이 실행할 파일명을 안내한다(`PGRST204` 판정). 다른 표를 안 건드리므로 실행 순서 무관 |
| `20260803130000_ap_reviewed_at` | **연구원 검수 건수** — `answer_sessions.reviewed_at` + 도장 트리거 `trg_ap_stamp_reviewed_at` + 인덱스 | **owner 실행 필요(2026-08-03 작성)** — 미적용이면 admin 연구원 목록이 '검수 N건'만 쓰고 '이번 달'을 아예 안 쓴다(컬럼 나열 select 가 400 이라 자동으로 한 번 더 부른다). ⚠️ 상태 전이 심판 `ap_session_guard` 는 안 건드린다 — 트리거 이름이 알파벳 순으로 심판 뒤라 심판이 막은 전이엔 도장이 안 찍힌다 |
| `20260804120000_recruit_rounds` | **채용 캘린더 회차** — `recruit_rounds`(airline·title·started_on·stages jsonb·complete·published) + 모양 검사 `recruit_stages_ok()` + 공개 읽기/admin RLS + `lab_shelf_counts()` 에 calendar 합산 + **대한항공 3회차 씨앗**(2025.04·2025.09·2026.02) | **실행 완료(2026-08-04)** — anon 키 프로브 실측: `recruit_rounds` 200·3행(9·11·11단계, key 전부 새 역할 어휘, 구 어휘 잔존 0), `lab_shelf_counts()` 에 `calendar n=3` 확인. 무료·공개 확정(비회원 읽기 200). ⚠️ **`lab_shelf_counts()` 를 재생성한다** — `20260801120000` 을 이 뒤에 다시 실행하면 calendar 합산이 사라져 허브 숫자가 '준비 중'으로 돌아간다(그때는 이 파일만 다시 실행하면 복구). ⚠️ **key 어휘가 14개(대한항공 전형표) → 역할 9개로 바뀌었다.** 구 어휘로 이미 넣은 회차가 있으면 파일 안 `update` 가 검사 추가 **전에** 옮긴다(순서를 바꾸면 실패한다). 씨앗은 `on conflict do nothing` 이라 재실행 안전 |
| `20260804140000_recruit_tips` | **채용 캘린더 제보함** — `recruit_tips`(airline·body·source·member_id·status) + 길이·상태 check + **공개 INSERT / 관리자만 SELECT** RLS | **owner 실행 필요(2026-08-04 작성)** — 미적용이면 학생 화면의 '일정 알려주기'가 보내기에서 '제보함 준비가 아직 안 됐어요'로 멈추고(`PGRST205`), admin 제보함은 조용히 접힌다. 캘린더 목록·나머지 화면은 영향 없음. 다른 표를 안 건드리므로 실행 순서 무관. ⚠️ **넣기 전용 창구다** — select 를 회원에게 열지 말 것(검수 전 주장이 사실이 된다) |
| `20260804150000_rls_hardening` | **RLS 하드닝 3종**(2026-08-04 보안 점검) — ① 서버 전용 환급 `refund_credit_for(uuid,text,text)`(service_role 만) ② `applications` INSERT 를 '결제 전 상태'로 제한(paid·payment_status·payment_id·paid_amount·refunded 고정) ③ 콘솔 생성 표 `reviews`·`challenge_rounds` RLS + 정책 + **콘솔에서 손으로 만든 옛 정책 7개 drop** | **실행 완료(2026-08-04 오너 실행)** — 권한표 실측으로 확인. ⚠️ **실측에서 드러난 것**: 콘솔에서 붙인 정책 7개가 남아 있었고 그중 `anyone can apply`(applications INSERT · `with check true`)가 ②의 제한을 **통째로 무효화**하고 있었다(정책은 OR 로 합쳐져 헐거운 쪽이 이긴다). 파일에 drop 을 넣어 정리했다 — **앞으로 정책은 콘솔에서 손으로 만들지 말 것** |
| `20260804160000_refund_credit_lockdown` | 구 `refund_credit(text,text)` 의 `authenticated` 실행 권한 회수 | **실행 완료(2026-08-04 오너 실행)** — 권한표 실측: `refund_credit` authenticated=false, `refund_credit_for` service_role=true. AI킬러 검사 1회로 차감 정상 확인. ⚠️ `refund_credit` 의 **service_role 은 true 로 남는다** — `revoke ... from public` 이 service_role 에 준 권한까지 회수하지는 않는다(정상. service_role 은 브라우저에 안 나간다) |

## 브랜치

- `claude/rehearsal-wip` — 모의면접(리허설) 자산 전체. **`rehearsal.html` 은 main 에 없다** — 승준노트 숨김 카드(`display:none`)를 켜기 전에 이 브랜치부터 병합할 것(안 하면 404).
- `airline-interview-program-mvp` — 매일 답변 프로그램. **main 미병합**(테스트 후 병합 예정 — 상세는 `docs/monc-answer-program/implementation-status.md`).

## 대기 중인 자산·데이터

- **항공사 합격 자소서**: 확보 = 제주 3 · 에어프레미아 2 · 이스타 1 · 티웨이 1. **미확보 = 대한항공·진에어·에어로케이 — 대한항공이 우선순위 1번**(지망자 최다인데 0건). 아시아나는 대한항공에, 에어서울·에어부산은 진에어에 통합돼 목록에 없다.
- **필수 기출 30문항 원본**(오너) — 미입력. 받으면 '필수 기출 30일 루틴' 시드를 만든다(그때까지는 seed-demo 공통 10문항·맛보기 5일이 검증용).
- **감점 사전 `origin='coach'` 자산** — 미유입(임시 시드 28건뿐). 프로브 `coach_terms` 0 이면 아직.
- `apply.html` FAQ #3·#6·#7 — 임시 문구.
- GitHub Actions 뉴스 스케줄 — 공개 리포는 **60일간 커밋이 없으면 자동 중지**(메일 통지 후 버튼 재활성).

## 2026-08-02 UX·UI 진단 반영 — 배포 현황

전체 진단서(실측 6종 + 업계 벤치마크 3종 + 적대적 검증 + 원칙 재평가)는 대화로 전달했고,
지적 79건 중 상위 16건을 코드에 대고 검증해 15건 확인·1건 기각했다. 그 15건 + 파생 항목을
A~D 등급으로 나눠 전부 반영했다.

| 등급 | 건수 | 상태 | 문서 |
|---|---|---|---|
| A 돈이 새는 자리 | 4 | ✅ 배포 | apply-and-payment.md · pages.md |
| B 신뢰와 법 | 4 | ✅ 배포 | auth-consent.md · credits.md |
| C 길찾기·전환 | 10 | ✅ 배포 | nav.md · pages.md · credits.md |
| D 접근성·일관성 | 12 | ✅ 배포(2건은 '앞으로만' 규칙) | design-principles.md |

**신설 공용 파일 4개**: `challenge-sticky.js`(상세 가격·CTA 바 + 코치진) ·
`pay-return.js`(결제 복귀 대기 화면) · `draft-keep.js`(긴 글 임시 보관) ·
`.sr-only`/`.skip-link`(tokens.css·nav.css).

**오너 확인이 필요한 것 2개**
1. **약관 제5조(크레딧) 정책** — 유효기간 없음 · 미사용 7일 내 전액 환불로 써 두었다.
   다르게 가려면 terms.html 제5조와 mypage 충전 칸 안내를 **같이** 고친다.
2. **챌린지별 담당 코치** — `challenge-sticky.js` 는 지금 '전직 승무원·전문 코치진'까지만
   말하고 챌린지별 배정은 하지 않는다(코드가 모르는 것을 추측하면 허위 표시).
   배정이 정해지면 그 파일에서 갈라 쓴다.

**일괄 수정을 일부러 안 한 것 2개**(design-principles.md '일괄 수정 금지 목록')
- 라운드 하드코딩 18종 · 학생 대면 `alert()` 84곳(돈이 오가는 apply 는 처리 완료).
  375px 전수 재검증 비용이 이득보다 커서 '그 파일을 어차피 손볼 때' 규칙으로 돌린다.
