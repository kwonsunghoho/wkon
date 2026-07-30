# 미니 다듬기(quickfix) — 무료 한 구간 고침 + 표현 수집 창구

> 2026-07-31 신설. 결정 기록: `docs/superpowers/specs/2026-07-31-quickfix-collector-design.md`
> 관련 파일: `quickfix.js`(공용 위젯) · `supabase/functions/ai-killer/index.ts`(`mode:'quickfix'` 분기)
> · `supabase/migrations/20260731120000_expression_reports.sql` · admin '감점 사전' 탭 '회원 제보'

## 무엇인가

"AI 느낌이 나는 구간(300자), 붙여넣으면 다듬어드려요" — 회원 무료, 하루 3회.
사용자에겐 미니 도구지만 실체는 **"사용자가 AI 같다고 느낀 표현"을 모으는 수집 창구**다
(오너 지시: *"대놓고 모집하기보단 … 자연스럽게 녹여져야 해"*). 서버가 고침과 함께
`spotted [{term, kind, why}]` 를 뽑아 `expression_reports` 에 쌓고, admin '감점 사전' 탭의
**'회원 제보'가 표현별 빈도 순위**로 집계한다 — 위로 올라올수록 학생들이 공통으로 싫어하는 표현이다.

- 고객의 소리(VoC) 위젯은 같은 회의에서 **오너가 삭제 지시** — 되살리려면 별도 확정부터.
- kind 는 사전 분류 3종(cliche/structure/context)을 그대로 쓴다 — 새 체계를 만들지 말 것.

## 화면 — quickfix.js (자기 주입 공용 컴포넌트, waitlist.js 패턴)

쓰는 법: `<div id="quickfix-mount" data-source="…"></div>` + `<script src="quickfix.js" defer></script>`.
티저 한 줄 → 탭하면 바텀시트(입력 → 결과 '지금/이렇게' + 짚은 표현 + 퍼널 링크).

- **싣는 곳 3**: `answers.html`(addbar 아래) · `ai-killer.html`(**입력 화면 안** — 결과 화면은 dock 이
  주인공이라 안 싣는다) · `sojae.html`(composer 끝, **`data-compact`** 글자 링크형).
  ⚠️ sojae 는 100svh 앱셸이라 카드형 티저를 넣으면 채팅 영역이 눌린다 — compact 유지.
- ⚠️ **시트 등장에서 투명도를 애니메이션하지 말 것** — waitlist.js 에서 실측으로 두 번 밟은 자리
  (백그라운드 탭이면 첫 프레임(투명)에 멈춰 안 보인다). 배경막은 처음부터 불투명, 움직임은 상자 위치만.
- ⚠️ **수집 고지 한 줄**("남긴 문장은 몬크 연구진이 검사 기준을 다듬는 데 써요")을 지우지 말 것 —
  제출물을 2차 활용하는 데 대한 고지다. 12px 하한.
- 결과의 (괄호 빈칸)은 sojae·polish 와 같은 규칙 — 학생이 제 사실로 채울 자리(`markBlanks`).
- 퍼널 링크는 현재 페이지로 가는 것을 뺀다(killer 에선 첨삭만, 나머지에선 킬러+첨삭).
- 한국어 줄바꿈은 `word-break: keep-all`(티저·제목·리드) — 낱말 중간이 갈라진다.
- 계측: `page_events` path `/quickfix` — `quickfix_open` / `quickfix_done`(meta.source·spotted·remaining).

## 서버 — 별 함수가 아니라 ai-killer 함수의 `mode:'quickfix'` 분기

polish 와 같은 이유: 인증·감점 사전 로드·프롬프트 재료가 전부 같다. Haiku 4.5
(`claude-haiku-4-5`) + 구조화 출력. coach 사전을 system 에 주입(상한 80 — polish 와 동일).

- **⚠️⚠️ 프로브 게이트를 지우지 말 것** — 구버전 함수는 mode 를 몰라 요청이 **킬러 검사로
  흘러가 3크레딧이 깎인다**(polish 와 같은 함정). quickfix.js 가 시트를 열 때
  `features.includes('quickfix')` + `quickfix_table !== null` 을 확인하고, 아니면 입력칸 자체를
  안 보여준다('준비 중'). 통과 기록은 sessionStorage(`monc_qf_ready`) — 양성만 캐시.
- **⚠️ 분기 위치는 킬러의 길이 검증·자동 저장(2-2)보다 앞** — 뒤로 옮기면 300자 조각이
  답변 저장소에 쌓이고, 100자 미만 구간이 `too_short` 로 죽는다.
- **⚠️ 300자 상한 + 하루 3회는 한 쌍의 우회 방지 장치.** 글을 쪼개 넣어 킬러(1,500자·3크레딧)를
  공짜로 돌리려면 하루 한도에 먼저 걸린다. 둘 중 하나만 풀어도 무료 우회로가 열린다.
  하루 경계는 **서울 자정**(UTC 로 두면 한국 오전 9시 리셋 — 크레딧 하루 무료와 같은 함정).
- **⚠️ 크레딧과 무관**(spend_credit 안 부름). 실패 문구에 "크레딧을 돌려드렸다"를 쓰면 거짓 —
  catch 의 quickfix 분기가 따로 있다. 예상 실패(too_short/too_long/daily_limit/not_ready)는
  전부 **HTTP 200 + code**.
- **⚠️ `expression_reports` count 실패(마이그레이션 미적용) 시 호출 전에 `not_ready`** —
  진행하면 한도를 못 세는 채로 저장까지 실패한다(polish p-1 과 같은 게이트).
- **⚠️ spotted 는 원문에 실제로 등장(`includes`)하는 표현만 저장** — AI 가 지어낸 문자열이
  쌓이면 사전 후보(자산)가 오염된다. fixed 는 자기 출력 재검사(상투어 사전, 1회 재생성) +
  '고침의 선'(없는 사실 금지·괄호 빈칸) — polish 와 같은 고삐.
- **⚠️ Haiku 에 `output_config.effort` 를 넣지 말 것** — 미지원 400(sojae 되묻기 실측).
  `format`(구조화 출력)은 지원.
- 저장 실패는 결과를 막지 않는다(무료 기능 — 제보 한 건 유실이 사용자 실패보다 낫다).

## 데이터·admin

- `expression_reports`: member_id·page·content·fixed·spotted(jsonb)·토큰. RLS 는
  **쓰기 service role 만·읽기 관리자만** — 회원 insert 를 열면 하루 한도를 화면 밖에서
  우회하고 가짜 spotted 로 사전 후보를 오염시킬 수 있다. 회원 정책을 만들지 말 것.
- admin '감점 사전' 탭 하단 '회원 제보': 최근 500건을 브라우저에서 집계(표현별 제보 수·회원 수·
  종류 최빈값) — **이 규모에 서버 집계를 만들지 말 것.** 원문 보기 토글로 content→fixed 확인.
- **⚠️ [사전 등록]은 자동 insert 가 아니라 위 폼 채우기다** — 어미를 공통 어간으로 다듬을
  기회를 남긴다("최선을 다하겠습니다" 그대로 넣으면 변형이 안 잡힌다). 사전(coach)은 첨삭
  프롬프트에도 주입되므로 검수 없이 승격하면 오염이 두 도구로 번진다.
- 테이블 미생성 판정은 `PGRST205`(waitlist 실측 — `42P01` 만 보면 분기를 영영 못 탄다).

## 배포·degrade

- migration `20260731120000_expression_reports.sql` — **owner 실행 필요.**
- ai-killer 함수 재배포 필요 — `FN_VERSION 2026-07-31b`(a 는 타입 정리만). 프로브
  `POST {probe:true}` 의 `features` 에 `quickfix`, `quickfix_table` 숫자면 완료.
- 미배포/미적용 degrade: 시트가 '준비 중'으로만 뜬다 — 페이지·킬러·첨삭·소재 영향 없음.
