# 면접관 리허설 — 답변노트 개편 1단계 설계

날짜: 2026-07-18 · 상태: 오너 검토 대기

## 배경과 목표

마이페이지 '내 답변노트'는 소재 발굴로 쓴 답변이 쌓이기만 하는 수동적 저장고다.
오너 목표: **노트가 회원을 능동적으로 돕는 기능**을 만들어 회원 모집의 간판으로 세운다.

브레인스토밍에서 확정한 전체 로드맵(이 스펙은 1단계만 다룬다):

1. **면접관 리허설 (이 스펙)** — 완료한 답변을 면접관 질문 패턴이 꼬리질문으로 검증
2. 기출문제 은행 열기 — 오늘의 문제 외에도 골라 풀기 + 커버리지 맵
3. 답변노트 정리 도구 — 필터·검색·즐겨찾기
4. 홈 랜딩 모집 섹션 — 기능이 실제로 돌아간 뒤 홍보

보류함: B 망각곡선 복습 루틴, C 연구진 기준 첨삭 — 1~4단계 이후.

## 이름·워딩 규칙 (오너 확정)

- 기능명: **면접관 리허설**. 횟수권: **리허설권**. 노트 배지: **리허설 완료**.
- **"AI"라는 단어를 회원 노출 문구에 쓰지 않는다.** 화자는 "면접관 질문 패턴",
  근거는 "몬크 연구진 데이터". MONC 브랜드에서 오는 신뢰가 핵심.
- **과장 금지(법적 리스크):** "빅데이터" 같은 문구는 실제 데이터 자산(연구진 검수를
  거친 꼬리질문 패턴집)이 갖춰지기 전엔 쓰지 않는다. 그 전까지는
  "연구진의 면접관 질문 패턴" 수준으로 표현한다.

## 회원 경험

1. **진입** — 마이페이지 완료 노트 카드에 "면접관 리허설" 버튼 +
   sojae.html 답변집 저장(완료) 직후 CTA 한 줄. 대상은 `status='final'` 답변만.
2. **시작 확인** — 잔여 리허설권 표시. "리허설권 1개를 사용합니다" 확인 후 시작.
   잔여 0이면 충전 안내(현재: 수강생 혜택/관리자 문의 안내 → 토스 연결 시 충전 버튼).
3. **세션** — 꼬리질문 **3개를 하나씩**. 내 답변(스냅샷)의 빈틈을 파고드는 질문에
   내가 답해야 다음 질문이 나온다. 대화는 저장되어 중단 후 이어하기 가능.
4. **총평** — 3번째 답변 뒤: 잘 버틴 지점 / 뚫린 지점 / 원답변에 반영할 제안.
   "답변 보완하러 가기" → `sojae.html?q=<question_id>`.
5. **노트에 남는 것** — 완료 노트에 **리허설 완료 배지** + 리허설 대화 다시 보기.
   재리허설 가능(새 리허설권 소모, 세션이 하나 더 쌓인다).

## 화면 — `rehearsal.html` (신규)

`sojae.html`의 채팅 패턴(말풍선·자동저장·복원·권한 안내 화면)을 재사용한 별도 페이지.

- 진입: `rehearsal.html?q=<question_id>` (answers는 member×question unique라 이걸로 특정).
- 스텝바: `질문 1 › 2 › 3 › 총평`.
- 상단에 검증 대상 답변(스냅샷)을 접이식으로 보여준다 — 회원이 뭘 방어 중인지 안 잊게.
- 진행 상태 복원: active 세션이 있으면 확인 화면 없이 바로 대화 복원(추가 차감 없음).
- 완료(done) 세션으로 진입하면 읽기 전용 리플레이 + "다시 리허설(리허설권 1개)" 버튼.

## 데이터 — 마이그레이션 1개 (idempotent, 오너가 SQL Editor 실행)

```
rehearsal_sessions
  id uuid PK, member_id FK, question_id FK,
  answer_snapshot text        -- 시작 시점 답변 원문 동결(이후 답변을 고쳐도 총평 맥락 유지)
  status text 'active'|'done', verdict text null,
  input_tokens int default 0, output_tokens int default 0,
  -- ↑ 원가 실측: Edge Function이 호출마다 응답 usage를 누적 → 세션당 실원가 측정,
  --   충전 가격 책정의 근거 데이터(admin에서 평균 조회)
  created_at, updated_at
  -- (member, question) unique 아님: 재리허설마다 새 행

rehearsal_messages
  id, session_id FK, member_id FK, role 'interviewer'|'user', content, created_at

point_ledger                  -- append-only 원장. 잔액 = sum(delta)
  id, member_id FK, delta int, reason text
    ('welcome'|'admin_grant'|'rehearsal'|'purchase'|'refund'),
  ref text null, created_by uuid null, created_at
  -- 부분 유니크: (member_id) where reason='welcome'  → 무료 1회 중복 지급 방지
```

- RLS: 세 테이블 모두 본인 select, 관리자 전체. 추가로 본인에게
  `rehearsal_messages` insert, `rehearsal_sessions` update(verdict·status 저장용) 허용.
  세션 insert는 RPC만(차감 우회 방지), 원장은 아래 규칙.
  `point_ledger`는 **본인 insert 금지**(지급·차감은 RPC/관리자만) — 클라이언트가
  스스로 크레딧을 만들 수 없다.
- **소재 발굴 권한(sojae_enabled)과 별개 게이트.** 리허설은 크레딧으로만 제어 —
  나중에 단독 판매 가능한 구조. (대상 답변 자체가 소재 발굴 산출물이므로
  현재 실사용자는 사실상 수강생이지만, 스키마는 묶지 않는다.)

### RPC — 서버가 유일한 심판

`start_rehearsal(p_question_id uuid) returns uuid` (SECURITY DEFINER):

1. 본인 `answers`(status=final) 존재 확인 → 없으면 예외
2. 이미 active 세션이 있으면 그 id 반환(중복 차감 방지)
3. 잔액(sum) ≥ 1 확인 → 부족하면 예외 `'no_credit'`
4. `point_ledger`에 delta −1, reason 'rehearsal' insert
5. 세션 insert(answer_snapshot에 답변 원문 복사) → id 반환

2~4는 한 트랜잭션. answer_snapshot을 RPC가 복사하므로 이후 Edge Function은
answers 테이블을 다시 읽지 않는다(권한 회수와 무관하게 세션은 완주 가능).

`grant_welcome_credit() returns int`: 원장에 행이 하나도 없는 회원에게 'welcome' +1
1회 지급(부분 유니크가 재실행 방어). rehearsal.html 진입 시 lazy 호출.

## AI — `sojae-chat` Edge Function에 `stage='rehearsal'` 추가

- 모델: **Opus 4.8** (`claude-opus-4-8`). 꼬리질문의 날카로움("이 답변의 진짜 빈틈이 어디인가"를
  짚는 판단력)이 상품 그 자체라 최고 모델을 쓴다. 원가 세션당 약 200원(호출 4~5회,
  프롬프트 캐싱 적용 시) — 유료 리허설권 판매가 대비 무시 가능. 오너 확정 2026-07-18.
- 요청: `{ stage:'rehearsal', session_id, history }`. 함수는 본인 소유
  active `rehearsal_sessions` 행을 확인(없으면 403 — 크레딧 우회 불가)하고
  question·category·answer_snapshot을 세션에서 읽는다.
- 프롬프트: 시스템 = 리허설 지침 + **유형별 꼬리질문 패턴집**(아래) 주입.
  모델은 답변 스냅샷과 대화 이력을 보고 다음 꼬리질문 1개를 낸다.
  3번째 사용자 답변 뒤에는 총평을 내고 종료 신호 마커를 붙인다 →
  클라이언트가 verdict 저장 + status='done'.
- 실패 처리: canned 폴백 **없음**(가짜 꼬리질문은 상품 신뢰를 깎는다).
  정중한 오류 + 재시도 안내. 차감은 세션 시작 시 1회뿐이므로 재시도에 추가 비용 없다.
- 프롬프트 원본: `docs/prompts/rehearsal.md` 신설(기존 관례대로 코드와 동기화).

## 꼬리질문 패턴집 — 몬크 데이터 자산

- `site_config` key `rehearsal_patterns` (JSON: category → 패턴 목록·평가 관점).
  Edge Function이 조회해 프롬프트에 주입, 없으면 내장 기본값 폴백.
- admin에 편집 탭 추가 — 연구진이 재배포 없이 다듬는다.
- 초안은 구현 시 작성하되, **오너·연구진 검수 후에만** 모집 문구에
  "면접관 데이터" 계열 표현을 쓴다(워딩 규칙 참조).

## admin 추가

- **리허설권 관리 탭**: 회원 검색 → 잔액 표시, 지급/회수(사유 입력, 원장 insert).
  일괄 지급(예: 특정 기수 전원 +N).
- **패턴집 편집 탭**: `rehearsal_patterns` JSON 편집(기존 site_config 편집 패턴 재사용).

## 결제 연결(추후, 이 스펙 범위 밖)

토스 간편결제 승인 시 confirm Edge Function이 `point_ledger`에
`purchase` +N 한 줄을 넣는 것으로 끝 — 스키마·화면 구조 변경 없음.
rehearsal.html의 "충전 안내" 자리가 그때 충전 버튼으로 바뀐다.

**가격 정책 방향(오너 확정 2026-07-18): 수강생 포인트 + 충전식 병행.**
① 챌린지 신청 시 리허설권 N회 지급(admin_grant — 모집 간판 혜택),
② 부족하면 충전식 묶음 구매(예: 1만원=N회). 정확한 N·가격은
**usage 실측(rehearsal_sessions.input/output_tokens)으로 세션당 실원가를
확인한 뒤** 확정한다. 추정 원가: 대화 7~9왕복 기준 세션당 약 250~400원
(캐싱 적용) — 개당 판매 체감가는 원가의 2배 이상 유지.
"무제한" 상품은 금지(원가가 사용량 비례라 뚜껑 없는 상품은 원가 폭주 위험).

## 범위 밖 (명시)

- 기출 은행·정리 도구·홈 모집 섹션(로드맵 2~4단계), 복습·첨삭(보류함)
- 리허설 결과 점수화/등급(총평 텍스트만 — 점수는 근거 없이 붙이면 신뢰 리스크)
- 푸시/알림, 구독제

## 검증 계획

- 375px 우선 렌더 확인(모바일 99%), 채팅 UI는 sojae.html과 동일 회귀 포인트.
- 크레딧: 잔액 0 시작 차단 / 시작 시 1 차감 / 이어하기 무차감 / welcome 중복 방지
  / active 세션 중복 시작 방지 — 수동 체크리스트.
- RLS: 타인 세션·원장 접근 불가(브라우저 콘솔에서 타 uid 조회 시 빈 결과).
- Edge Function: 세션 없이 stage='rehearsal' 호출 → 403.
- 미적용 마이그레이션 상태에서 기존 페이지(마이페이지·sojae)가 깨지지 않는지
  (graceful degradation — 리허설 버튼만 숨김).
