# 배포·적용 시점 상태 (사이트 전반)

> 시점에 따라 바뀌는 상태만 모은다: Edge Function 배포 버전, 마이그레이션 적용 여부, 브랜치, 대기 중인 자산.
> 2026-07-30 CLAUDE.md 다이어트 때 본문 곳곳에 흩어져 있던 기록을 모은 것 — **기준 시점 2026-07-30.** 상태가 바뀌면 이 문서를 갱신한다.
> 답변 프로그램 전용 상태는 `docs/monc-answer-program/implementation-status.md` 가 원장.

## Edge Function 배포 상태

배포 확인은 전부 **anon key 프로브**(결제 생성·DB 쓰기 없음 — 안전). 관리자에게 SQL 을 시키지 말 것.

| 함수 | 기록된 상태(2026-07-30) | 프로브 |
|---|---|---|
| verify-payment | **레포는 `2026-08-10a` — owner 재배포 필요(2026-08-10 작성).** 이 판은 연구실 자료 분기에 계정 대조를 넣었다: 결제 생성 때 실은 `customData.uid` 와 이미 기록된 결제의 `user_id` 를 지급 전에 대조해 다르면 `wrong_account`(HTTP 200 + code). 미배포여도 화면(lab-shelf 복귀 자가 회복)은 그대로 동작한다 — 대조만 빠진다. 배포 확인 이력: **`2026-08-07a` 배포 확인(2026-08-07 프로브 실측 — `version` `2026-08-07a` · `challengePrice` 33000 · `priceFallback` 33000).** 이 배포에 참가비 폴백 30,000→**33,000** 정정과 `FN_VERSION`·버전 프로브가 같이 올라갔다 — 그전까지는 `site_config` 를 못 읽는 순간 화면 33,000 / 서버 30,000 으로 갈렸다. 앞선 이력: 특강 분기 2026-07-24 · creditPack 2026-07-25 · `programId` 2026-07-30 · `resourceId`(연구실 유료 자료) 2026-08-01 | **버전 프로브(2026-08-07 신설, 이것만 쓰면 된다): `POST {"probe":true}` → `version`·`challengePrice`·`priceFallback`** — 한 번으로 배포 여부·DB 참가비·폴백 일치를 다 본다. `bad_request` 가 오면 구버전이다. 아래는 구버전 분기 판정용: 특강 `{paymentId:'probe', lectureId:'00000000-0000-0000-0000-000000000000', applicant:{name:'x',phone:'0'}}` → **`login_required`=로그인 필수 버전**(2026-08-05 — JWT 확인이 특강 조회보다 먼저라 anon 프로브는 여기서 멈춘다), `lecture_not_found`=그 이전, `bad_request`=특강 이전, 404=미배포. 프로그램 `{paymentId:'probe', programId:'00000000-…-0'}` → `not_authenticated`=신버전. 자료 `{paymentId:'probe', resourceId:'00000000-…-0'}` → `not_authenticated`=신버전 |
| cancel-payment | **`2026-08-07a` 배포 확인(2026-08-07 프로브 실측). 레포와 같음.** `FN_VERSION`·버전 프로브만 추가됐고 환불 로직은 2026-07-23 신설분 그대로(환불 실측 확인 2026-07-25) | **버전 프로브(2026-08-07 신설, 권장): `POST {"probe":true}` → `version`.** 구 방식: `{applicationId:'probe', amount:1}` → `unauthorized`(401)=배포됨, 404=미배포 |
| ai-killer (polish·quickfix 겸용) | **`2026-08-04a` 배포 확인(2026-08-04)** — 콘솔 코드 상단 `FN_VERSION` 눈으로 확인. 이 배포에 미니 다듬기(`quickfix`)와 환급 서버 전용화(`refund_server`)가 같이 올라갔다. 레포와 같음 | 로그인 없이 `POST {"probe":true}` → `version`·`features`·`airline_profiles`/`terms` 개수·`has_api_key`. `features` 에 `quickfix` + `quickfix_table` 숫자면 미니 다듬기 살아 있음. **`refund_server` 있으면 환급이 service_role 경로**(없으면 구버전 — 20260804160000 을 실행하면 안 된다). `coach_terms` 0 이면 연구진 자산 미유입. ⚠️ 오너 환경에선 크롬이 콘솔 붙여넣기를 막는다("allow pasting" 을 직접 타이핑해야 한다) — **콘솔 코드 화면에서 `FN_VERSION` 을 눈으로 보는 쪽이 빠르다** |
| sojae-chat | **`2026-08-05a` 배포 확인(2026-08-05 오너 배포·프로브 확인)** — 4문답 상한 + 충분 시 새 질문 금지. playbook `ask_core` 의 '6번'→'4번' SQL 도 같이 실행됨. 레포와 같음 | `POST {probe:true}` → `version`·`playbook_keys`(9)·`has_api_key` |
| answer-program | `2026-07-30b` (프로브 sessions_table:true · questions 99 · programs 1) | 프로브 있음 — 상세는 `docs/monc-answer-program/implementation-status.md` |
| lab-file | **레포는 `2026-08-10a` — owner 재배포 필요(2026-08-10 작성).** 이 판은 관리자(`members.role='admin'`) 무료 열람을 넣었다(`features` 에 `admin_free`). 미배포면 관리자도 유료 자료에 결제창이 뜬다(그 외 동작 동일). 배포 확인 이력: **`2026-08-01f` 배포 확인**(프로브 실측 2026-08-01 — `features` 에 `paid`+`multi_file`) | `POST {"probe":true}` → `version`·`features`·`bucket`. `features` 에 `external_url`=영상 지원, **`paid`=유료 지원(e), `multi_file`=자료 하나에 파일 여러 개(f)**. 404 면 미배포. ⚠️ **`paid` 없는 버전에서 자료에 값을 매기면 무료로 열리고, `multi_file` 없는 버전은 파일이 여럿이어도 첫 파일만 내보낸다**(2026-08-01 실사고 — 마이그레이션과 재배포를 같이 한다) |

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
| `20260805120000_sojae_levels` | **소재 발굴 문제 난이도** — `questions.level`(basic/mid/advanced/deep · 기본 basic) + 체크 제약 + `(level, active)` 인덱스, 오늘 고정 유일 인덱스를 `(scheduled_date, level)` 로 교체 | **실행 완료(2026-08-05 오너 실행)** — ⚠️ 이 세션의 프록시가 supabase.co 로 나가는 길을 막아(403) anon 프로브로 재확인하지 못했다. 의심되면 admin '소재 문제' 탭에서 난이도 칸을 바꿔 본다(저장되면 적용, '마이그레이션 먼저' 안내가 뜨면 미적용). 미적용이면 화면이 모든 문제를 '초급'으로 보고 지금과 똑같이 돈다(진입 화면에서 중급·고급·심화가 0문제, 학생은 초급만 쓴다). admin 은 난이도를 빼고 저장한 뒤 '마이그레이션 먼저' 안내를 띄운다(`42703`/`PGRST204` 판정). 조회는 `select('*')` + 클라이언트 필터라 400 이 안 난다. ⚠️ **옛 유일 인덱스 `questions_scheduled_date_uq` 를 지운다** — 같은 날 난이도마다 하나씩 고정하기 위해서다. 되돌리면 하루에 오늘 문제가 통틀어 하나만 남는다 |
| `20260804140000_recruit_tips` | **채용 캘린더 제보함** — `recruit_tips`(airline·body·source·member_id·status) + 길이·상태 check + **공개 INSERT / 관리자만 SELECT** RLS | **owner 실행 필요(2026-08-04 작성)** — 미적용이면 학생 화면의 '일정 알려주기'가 보내기에서 '제보함 준비가 아직 안 됐어요'로 멈추고(`PGRST205`), admin 제보함은 조용히 접힌다. 캘린더 목록·나머지 화면은 영향 없음. 다른 표를 안 건드리므로 실행 순서 무관. ⚠️ **넣기 전용 창구다** — select 를 회원에게 열지 말 것(검수 전 주장이 사실이 된다) |
| `20260804150000_rls_hardening` | **RLS 하드닝 3종**(2026-08-04 보안 점검) — ① 서버 전용 환급 `refund_credit_for(uuid,text,text)`(service_role 만) ② `applications` INSERT 를 '결제 전 상태'로 제한(paid·payment_status·payment_id·paid_amount·refunded 고정) ③ 콘솔 생성 표 `reviews`·`challenge_rounds` RLS + 정책 + **콘솔에서 손으로 만든 옛 정책 7개 drop** | **실행 완료(2026-08-04 오너 실행)** — 권한표 실측으로 확인. ⚠️ **실측에서 드러난 것**: 콘솔에서 붙인 정책 7개가 남아 있었고 그중 `anyone can apply`(applications INSERT · `with check true`)가 ②의 제한을 **통째로 무효화**하고 있었다(정책은 OR 로 합쳐져 헐거운 쪽이 이긴다). 파일에 drop 을 넣어 정리했다 — **앞으로 정책은 콘솔에서 손으로 만들지 말 것** |
| `20260804160000_refund_credit_lockdown` | 구 `refund_credit(text,text)` 의 `authenticated` 실행 권한 회수 | **실행 완료(2026-08-04 오너 실행)** — 권한표 실측: `refund_credit` authenticated=false, `refund_credit_for` service_role=true. AI킬러 검사 1회로 차감 정상 확인. ⚠️ `refund_credit` 의 **service_role 은 true 로 남는다** — `revoke ... from public` 이 service_role 에 준 권한까지 회수하지는 않는다(정상. service_role 은 브라우저에 안 나간다) |
| `20260805140000_lecture_login_required` | **특강 신청 로그인 필수**(2026-08-05 오너 확정) — `applications_insert_public` 에 `(lecture_id is null or member_id = auth.uid())` 추가. 챌린지는 비회원 신청 유지, 특강만 로그인 본인 | **실행 완료(2026-08-05 오너 실행·자기보고)** — verify-payment 재배포도 같이 완료. ⚠️ **이 세션의 프록시가 supabase.co 를 막아(403) 프로브로 재확인하지 못했다.** 의심되면 둘을 본다: ① 비로그인 프로브 `{paymentId:'probe', lectureId:'0000…'}` → `login_required`=신버전(구버전은 `lecture_not_found`) ② 로그아웃 상태에서 `applications` 에 `lecture_id` 를 넣어 insert → `42501`. 미적용이어도 `lecture.html` 게이트가 이미 막으므로 화면상 증상은 없다 |
| `20260805150000_page_events_guard` | **계측 비콘 보호** — `page_events` 모양 검사 CHECK(`event ^[a-z][a-z0-9_]{2,63}$` · `path` `/` 시작 · `meta` 객체 500자) + 분당 전역 2,000건 상한 트리거 + 보관 정리 `page_events_prune(days)` + `created_at` 인덱스 | **owner 실행 필요(2026-08-05 작성)** — anon INSERT 는 계속 열려 있다(로그아웃 방문자가 측정 대상). 미적용이면 종전대로 아무 값이나 들어갈 뿐 화면은 정상. CHECK 은 `not valid` 라 기존 행을 검사하지 않아 실행이 실패하지 않는다. ⚠️ **새 이벤트명을 규칙 밖으로 지으면 계측이 조용히 안 쌓인다**(비콘은 실패를 무시한다 — 규칙은 `docs/notes/home.md` 맨 위 절). ⚠️ 같은 커밋에서 `program-common.js` 가 `name` 컬럼에 넣던 버그를 고쳤다 — 답변 프로그램 계측(ap_*)이 그동안 한 건도 안 쌓였다 |

| `20260805160000_member_course` | **승준노트 허브 코스** — `members.course`(beginner/practical/spurt/daily · null=미선택) + 체크 제약. 새 RLS 없음(기존 `members_update_own` 이 덮는다) | **실행 완료(2026-08-05 오너 실행·자기보고)** — 화면도 2026-08-06 에 main 배포 완료(아래 브랜치 절). 이 마이그레이션의 체크 제약은 뒤이은 `20260806090000_member_course_levels` 가 교체했다 |
| `20260806090000_member_course_levels` | **코스 4단계 개편(초급~실전)** — 체크 제약을 `basic/mid/advanced/practical` 로 교체 + 구 값 이동(beginner→basic·daily→mid·spurt→advanced) | **실행 완료(2026-08-06 오너 실행)** — 제약 실측으로 확인: `pg_get_constraintdef` 가 `course = ANY (ARRAY['basic','mid','advanced','practical'])` 를 돌려준다. 미적용이었다면 [이 코스로 시작하기] 가 코드 23514 로 실패한다(성공한 척 넘어가지 않는다). ⚠️ **다시 확인할 일이 생기면 오너 기억에 묻지 말고 제약을 직접 읽어라** — `select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.members'::regclass and conname='members_course_check'`. 이 파일은 재실행해도 안전하다(drop if exists → update → add) |
| `20260805130000_answer_revisions` | **답변 수정 이력** — `answer_revisions`(answer_id·member_id·content) + `answers` UPDATE 트리거 `trg_answers_revision`(본문이 바뀔 때 **이전 본문**을 스냅샷) + 본인 읽기·지우기 RLS | **실행 완료(2026-08-05 오너 실행)** — anon 프로브로 확인(`/rest/v1/answer_revisions` → HTTP 200 `[]`. 미생성이면 404 `PGRST205` 다). 미적용이면 답변노트 카드에 '수정 이력' 접이가 안 뜨고 나머지는 그대로 돈다(조회 실패를 조용히 삼킨다). ⚠️ **10분 묶기가 핵심이다** — 소재 발굴이 0.8초 디바운스로 자동 저장해서, 묶지 않으면 한 번 고쳐 쓰는 동안 이력이 수백 개로 불어난다. 답변당 20개 상한. ⚠️ 트리거로 남기는 이유는 본문을 고치는 곳이 넷이고(소재 발굴·AI킬러 저장·첨삭 반영·답변 프로그램 확정) **AI킬러·첨삭은 서버 함수가 service role 로 직접 update** 하기 때문 — 브라우저 코드로는 못 잡는다 |
| `20260806170000_challenge_rounds_fcfs` | **챌린지 선착순 모드** — `challenge_rounds.start_mode`('scheduled'/'fcfs' · 기본 scheduled) + 체크 제약 + `recruit_end` nullable | **owner 실행 필요(2026-08-06 작성)** — 미적용이면 화면은 전부 기존 그대로 돈다(조회는 `select('*')` 라 400 없음, `fcfs=false` 로 떨어짐). admin 저장은 '개강일 지정'이면 `start_mode` 없이 재시도해 계속 되고, **선착순만** '마이그레이션 먼저' 안내로 멈춘다. 다른 표를 안 건드리므로 실행 순서 무관. 상세는 `docs/notes/apply-and-payment.md` '선착순 기수' 절 |
| `20260806120000_credit_free_limit_fallback` | **총량 무료 폴백 정리** — `credit_free_limit()` 의 폴백을 `ai_killer→2` 에서 `polish→1, 그 외 0` 으로 | **⚠️ 실행 보류(2026-08-06 오너 결정: "일단 둘게, 비용관련된건 나중에 한번에 대대적으로 잡자") — 임의로 실행하지 말 것.** 지금 상태: 회원마다 AI킬러 **첫 2회가 총량 무료**로 나가고 그 위에 하루 무료 5가 또 붙는다(검사 3크레딧 × 2 = 회원당 6크레딧). 20260725180000 이 설정에서 `ai_killer` 를 뺐지만 함수 안 폴백이 대신 2를 돌려주기 때문이다(프로덕션 실측: `credit_free_limits` = `{"polish": 1}`). `spend_credit` 은 `v_free_lim > 0` 만 보고 분기를 열어 `p_free_ref: null` 로도 안 막힌다. **기능은 정상이고 돈만 더 나간다** — 그래서 급하지 않다. 원인·조치 상세는 `docs/notes/credits.md` '총량 무료 폴백' 절 |

## ⏸ 비용 일괄 점검 — 나중에 한 번에(오너 결정 2026-08-06)

오너 지시: *"일단 둘게, 비용관련된건 나중에 한번에 대대적으로 잡자"*.
**비용·과금 관련 수정은 모아 뒀다가 한 번에 본다** — 하나씩 고치면 무료 정책이 조각나고,
그때마다 학생이 받는 양이 달라진다. 아래가 그때 같이 볼 목록이다(발견되면 여기에 더한다).

- `20260806120000_credit_free_limit_fallback` — AI킬러 총량 무료 2회가 아직 나간다(위 표).
- `credit_free_limit()` 폴백에 `rehearsal → 1` 도 남아 있다. 리허설은 아직 출시 전이라
  지금은 무해하지만, 켤 때 같이 정리하지 않으면 같은 방식으로 새 나간다.

## Pages 배포(라이브 반영) — 2026-08-06 사고 기록

**현행: GitHub 자동 배포 하나뿐이다**(`pages build and deployment` — 레포에 파일 없음, Settings → Pages 의 Source 가 `main` 브랜치). 푸시가 곧 배포다.

**⚠️ 원인은 GitHub 전역 장애였다 — 레포(코드·워크플로)에서 고칠 수 있는 게 없었다.** GitHub 이 2026-08-06 **15:22(UTC) 에 'Incident with Actions' 를 등급 critical 로 공식 등록**했고, **16:33(UTC) 에 Actions·Pages 가 둘 다 `major_outage`** 가 됐다. 원인은 러너에 이미 무효가 된 작업이 배정되면서 큐가 밀린 것이고, 복구는 8/7 새벽 큐가 빠지면서 이뤄졌다. 증상은 빌드는 초 단위 성공, 배포만 `deployment_queued` 로 10분 → 타임아웃이었다. **공식 공지(15:22)보다 우리 쪽 실패(11:33)가 먼저였다** — 공지가 없다고 해서 전역 장애가 아니라고 볼 수 없다. 이날 11:33(UTC) 부터 배포가 전부 실패했다. **마지막 성공은 `8a5f1f5` 10:28→10:33**(그 전까지는 30초~5분에 끝났다). 그 뒤 `5157df5`·`1504530`·`3f5db5e`·`6e6ec59`·`05fd8f4`·`6842915`·`13f6041` 이 예외 없이 **10분 내내 `deployment_queued` 에 머물다 취소**됐다. 배포기를 자동 배포 하나로 줄인 뒤(`13f6041`)에도 같은 자리에서 같은 시간에 끊겼다 — **배포기 충돌은 상황을 악화시킨 요인이지 원인이 아니다.** 큐가 배포를 집어가지 않는 것이라 기다렸다 **새 커밋으로 재시도**하는 것 외에 방법이 없다.

그 10분을 늘려 보려고 자체 워크플로 `.github/workflows/pages.yml` 을 만들었는데, 아래 두 가지가 사실과 달라 상황이 더 나빠졌다. **같은 시도를 다시 하지 말 것.**

- **⚠️ `actions/deploy-pages` 의 `timeout` 은 10분을 못 넘긴다.** 소스에 `MAX_TIMEOUT = 600000` 이 있고 `Math.min(입력, MAX_TIMEOUT)` 으로 자른다. `timeout: 1800000`(30분)을 줘도 실행 로그에 `timeout value is greater than the allowed maximum - timeout set to the maximum of 600000 milliseconds` 경고만 찍히고 10분에 끊긴다(2026-08-06 실측). **대기 한도를 늘려서 푸는 방법은 없다** — 필요하면 재시도 로직을 따로 짜야 한다.
  - **⚠️ `v5` 로 올려도 똑같다**(2026-08-06 소스 확인 — v4·v5 둘 다 `MAX_TIMEOUT = 600000`, 기본값도 `600000` 그대로). 같은 날 다른 세션이 "v4 가 timeout 을 무시한다"고 보고 v4→v5 로 올렸는데(`6842915`), 무시한 게 아니라 **상한이 있는 것**이라 버전을 올려도 안 바뀐다. 이 커밋은 워크플로를 지우면서 같이 사라졌다.
- **⚠️ `actions/configure-pages` 는 Source 를 못 바꾼다.** `build_type: 'workflow'` 는 **Pages 사이트가 아예 없을 때 새로 만들면서만** 넣는다(`if (!pageObject && enablement)`). 이미 있는 사이트의 설정은 읽기만 한다. Source 전환은 **Settings → Pages 에서 손으로** 해야 한다.
- 그래서 Source 가 브랜치 배포인 채 **배포기가 둘**이 됐다. 배포 ID 가 커밋 SHA 그대로라 둘이 같은 ID 를 두고 서로 취소시킨다(자동 워크플로도 같이 실패했다).
- **2026-08-06 오너 결정: `pages.yml` 삭제, 자동 배포로 복귀.** 자체 워크플로에 이점이 없다(한도가 똑같이 10분인데 충돌만 는다).

⚠️ **한 번 취소된 커밋 SHA 는 재시도해도 안 올라간다**(배포 ID 가 SHA 라 `Deployment cancelled.` 로 즉시 되받는다). 그 커밋을 살리려면 **새 커밋**을 만들어야 한다(빈 커밋도 된다).

**복구 완료 — 2026-08-07 00:05(UTC).** `c834389` 의 `pages build and deployment` 가 **33초 만에 성공**했다(장애 전 소요시간대로 복귀). 그 직전 신호로 스케줄 워크플로 `항공 뉴스 수집` 이 8/6 23:54(UTC) 에 성공했다(16:43 은 실패). 학생 화면에 빠진 변경은 없었다 — 라이브에 안 올라간 건 문서 커밋 2건(`c12a6cf`·`ff866cc`)뿐이고, 눈에 보이는 변경은 장애 전 `8a5f1f5` 에 이미 반영돼 있었다.

### 이 사고에서 남길 교훈 3개

1. **배포가 막히면 남의 사례 검색보다 `githubstatus.com` API 확인이 먼저다.** `curl -s https://www.githubstatus.com/api/v2/summary.json` 로 Actions·Pages 컴포넌트 상태와 열린 사건을 본다. 8/6 에는 이 확인을 건너뛰고 증상이 비슷한 community 글 하나(#200809)만 보고 '이 레포만 잠긴 것'으로 단정했는데, 실제로는 전역 장애였다. 사례 하나는 근거가 못 된다.
2. **장애 공지가 열려 있는 동안 Support 티켓을 내면 자동 응답만 온다.** 티켓을 낼 시점은 **복구 공지가 뜬 뒤에도 우리 배포만 계속 실패할 때**다. 그때 넣을 내용: 레포명 + 시작 시각 + run ID + "builds succeed, deployments stuck in deployment_queued".
3. **Settings → Pages 의 Source 를 'GitHub Actions' 로 바꾸는 것과 워크플로 파일은 한 쌍이다.** 파일만 지우면 배포를 집어갈 주체가 없어 **배포가 영영 안 된다**(자동 배포기는 Source 가 브랜치일 때만 돈다). 8/6 에 실제로 이 상태로 몇 시간 방치됐고, 오너가 Source 를 'Deploy from a branch' + `main` + `/(root)` 로 되돌려 해소했다. 워크플로를 지울 때는 Source 를 같이 되돌린다.

## 브랜치

- ~~`claude/briefing-course-hub`~~ / `claude/content-discovery-feature-a4bfdf` — **승준노트 허브 코스형 개편. 2026-08-06 오너 지시로 main 병합·배포 완료.** (2026-08-05 에는 배포 보류였다 — 한 번 올렸다 되돌린 이력 `7d0edec`→`83fcb26`. 되살릴 일이 있으면 revert **뒤** 커밋으로 병합해야 한다. 옛 커밋으로 되돌려 병합하면 git 이 '이미 합쳐졌다'고 보아 아무것도 안 바뀐다.)
  최종형: **세로 리스트 4단계(초급·중급·고급·실전) + 펼친 줄 아래 아코디언 + 챌린지 추천 칸 + 큰 사각 버튼 박스 안 라인 아이콘.** 사진·엠보스 원판은 폐지. ⚠️ '판 없는 아이콘'(C안)은 오너가 정정해 기각했다 — "그 네모 버튼 박스를 만들라니까"(상세는 `docs/notes/briefing.md` 자유 선택 도구 절).
  마이그레이션 `20260806090000_member_course_levels` 는 **2026-08-06 실행 완료**(제약 실측 확인 — 위 표).
  ⚠️ **남은 것**: 코스 문구·스텝 구성 확정(현재 가안 — 초급 서브만 오너 원문).
- `claude/rehearsal-wip` — 모의면접(리허설) 자산 전체. **`rehearsal.html` 은 main 에 없다** — 리허설을 켤 때 이 브랜치부터 병합할 것(안 하면 404). ⚠️ 승준노트의 숨김 카드는 코스형 브랜치에서 마크업째 삭제됐다 — 그 브랜치가 배포되면 서클·코스 스텝에 새로 넣는다.
- `airline-interview-program-mvp` — 매일 답변 프로그램. **main 미병합**(테스트 후 병합 예정 — 상세는 `docs/monc-answer-program/implementation-status.md`).

## 대기 중인 자산·데이터

- **항공사 합격 자소서**: 확보 = 제주 3 · 에어프레미아 2 · 이스타 1 · 티웨이 1. **미확보 = 대한항공·진에어·에어로케이 — 대한항공이 우선순위 1번**(지망자 최다인데 0건). 아시아나는 대한항공에, 에어서울·에어부산은 진에어에 통합돼 목록에 없다.
- **필수 기출 30문항 원본**(오너) — 미입력. 받으면 '필수 기출 30일 루틴' 시드를 만든다(그때까지는 seed-demo 공통 10문항·맛보기 5일이 검증용).
- **감점 사전 `origin='coach'` 자산** — 미유입(임시 시드 28건뿐). 프로브 `coach_terms` 0 이면 아직.
- **`site_config.challenge_list_price`(취소선 정가) — 오너 입력 대기(2026-08-07).** 마이그레이션이
  아니라 **admin '챌린지' 탭 '정가(취소선 표시용)' 칸에 49,000 을 넣고 [참가비 저장]** 을 누르면
  켜진다(오너 확정 정가 49,000원 → 33% 할인). 넣기 전까지는 앵커가 **아예 안 그려지고** 화면은
  지금과 똑같다(참가비 33,000원만 표시) — 미입력이 깨진 상태가 아니다. 정가는 표시 전용이라
  **verify-payment 재배포와 무관**하고 청구 금액도 안 바뀐다. 규칙은
  `docs/notes/apply-and-payment.md` '정가 앵커' 절.
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
