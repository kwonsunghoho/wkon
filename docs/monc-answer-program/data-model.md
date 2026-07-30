# 매일 답변 프로그램 — 데이터 모델 (2026-07-30)

마이그레이션: `supabase/migrations/20260730150000_answer_program.sql` (**owner 실행 필요**, idempotent).
전부 신규 객체 — 기존 행을 한 줄도 건드리지 않는다. 롤백 SQL은 파일 하단 주석(신규 drop 만으로 복구).
데모 시드: `docs/monc-answer-program/seed-demo.sql` (마이그레이션 후 선택 실행).

## 테이블 관계

```
answer_programs 1 ─── n answer_program_days n ─── 1 interview_questions
      │ 1                                              (비공개 기출 은행)
      └── n program_enrollments (이용권, member 별 1)
      └── n answer_sessions (member×program×day 유일) ── n answer_versions (append-only)
                 │ selected_cards[] ──▶ experience_cards 1 ─── n experience_facts
                 │ answer_id ──▶ answers (기존 답변노트, 확정 시 합류)
members ── researchers(is_researcher) · member_tone_profiles · member_consents
correction_codes (연구원 수정 코드, 시드 31종)
```

## 핵심 컬럼 요약

- `interview_questions`: content · airline(코드/NULL=공통) · stage · **qtype 10종**(experience/values/motivation/mistake/weakness/conflict/situation/company/job/opinion) · intent · competencies/needed_facts/good_exp_types(jsonb) · avoid · common_mistakes · cliche_watch · structure_hint · rec_len · rec_seconds · followups(jsonb) · difficulty · **source_confidence**(verified/reported/estimated) · asked_at · active · admin_memo.
- `answer_programs`: airline · title · total_days(1~60) · reveal_policy(daily/all/by_date) · **price**(NULL=지급 전용 / 0=자가 등록 / 양수=유료 예약) · visible.
- `program_enrollments`: started_at(1일차 기준) · source(admin/purchase/promo) · payment_id(후속 결제 자리) · status. unique(program, member).
- `experience_cards`: 필수는 title 뿐. 장면 필드 16종 + usable_qtypes(jsonb) + **status**(draft/needs_check/verified_student/verified_researcher/archived) + has_pii + origin(student/sojae/ai) + use_count.
- `experience_facts`: content · fact_type · source(student/voice/ai/followup) · **status**(user_stated/user_confirmed/researcher_confirmed/**inferred**/disputed/rejected). ⚠️ inferred·disputed·rejected 는 첨삭 근거로 쓰이지 않는다(서버가 소스에서 제외).
- `answer_sessions`: state(11종) · selected_cards(jsonb) · draft(자동 저장) · followup_qa(jsonb [{q,a,at}]) · chosen_version · answer_id · review_requested_at · reviewed_by. unique(member, program, day).
- `answer_versions`: kind(student_draft/fact_summary/ai_tone/ai_delivery/student_edit/researcher_edit/speaking/final) · content · **meta**(sentences[].ev·unsupported, scores, flags, sources 스냅샷, model, prompt_version, usage, codes[]) · author(student/ai/researcher) · author_id.
- `member_consents`: kind='model_training' · granted · decided_at. **사전 체크 금지** — 학생이 직접 켠 것만 true.

## 상태 기계 (answer_sessions.state — 트리거 `ap_session_guard` 가 심판)

```
not_started → experience_selecting ⇄ fact_gathering → student_drafting
student_drafting ──(service: revise)──▶ ai_revised → student_editing
student_editing → review_requested → researcher_reviewing → approved → finalized
                                   └→ revision_requested → student_editing
student_editing → finalized ⇄ (finalized → student_editing 재수정, 이력 보존)
```
- 학생이 못 하는 것: ai_revised 로 점프(AI 완료 위조), approved 자가 부여, 초안에서 검수요청 직행.
- 연구원이 못 하는 것: finalized 직접 부여(확정은 학생 몫).
- service(중계 함수)·관리자는 제한 없음(복구용).
- errcode: `MC003` bad_state_transition / `MC004` day_locked(INSERT 시 잠긴 일차) / `MC005` not_enrolled.

## RLS 요약

| 테이블 | 학생 | 연구원 | 관리자 |
|---|---|---|---|
| interview_questions | ✗ (RPC로만) | select | all |
| answer_programs | visible select(anon 포함) | 〃 | all |
| answer_program_days | ✗ (RPC로만) | select | all |
| program_enrollments | 본인 select · **무료 프로그램만** self insert(promo) | select | all |
| experience_cards/facts | 본인 all | select | all |
| answer_sessions | 본인 all(트리거 제한) | select+update(트리거 제한) | all |
| answer_versions | 본인 select · student kind 만 insert | select · researcher_edit 만 insert | all |
| correction_codes | active select | 〃 | all |
| member_tone_profiles / member_consents | 본인 all(consents 는 본인+관리자 select) | tone select | all |
| members (+기존 정책) | 본인 | **select 추가**(검수에 이름 필요 — 내부 인력 전제) | all |

## 마이그레이션 위험·롤백

- 위험: 없음(신규 객체만). `members` 에는 정책 1개만 추가(컬럼 변경 없음).
- 미적용 degrade: 화면이 PGRST205 를 감지해 '준비 중' + 체험 모드 안내. 중계 함수는 차감·기록 없이 `not_ready`.
- 롤백: 마이그레이션 파일 하단 주석 블록 실행(모든 신규 객체 drop — 기존 데이터 무영향).

## 학습 사례 연결 (data_capture)

한 세션(session_id)에 다음이 전부 시간순으로 묶인다: 기출(question_id→은행 메타 전체) · 선택 경험(selected_cards→카드+사실) · 문답(followup_qa) · 학생 초안(student_draft) · AI 사실 정리/두 버전(meta.sentences·scores·flags·sources·model·prompt_version·usage) · 학생 수정(student_edit) · 연구원 수정(researcher_edit + meta.codes[{code,label,reason}]) · 말하기(speaking) · 최종(final) · 학생 선택(chosen_version). 학습 셋 추출 시 `member_consents.model_training=true` 회원만 + 직접 식별자 제거는 privacy-and-consent.md 절차를 따른다.
