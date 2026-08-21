// =============================================================================
// Supabase Edge Function: ai-killer — 자소서·답변의 'AI 문체' 검사 (2026-07-25)
//                         + 첨삭(mode:'polish') — 강점·보완점·문장 첨삭 (2026-07-30)
//                         + 미니 다듬기(mode:'quickfix') — 무료 한 구간 고침 + 표현 수집 (2026-07-31)
// =============================================================================
// 스펙: docs/superpowers/specs/2026-07-24-ai-killer-design.md (④⑤단계)
//
// ⚠️ 첨삭이 **별 함수가 아니라 이 함수의 분기**인 이유: 필요한 맥락(항공사 프로필·
//    문항 매칭·답변 소유 확인·크레딧 차감·자동 저장)이 킬러와 전부 같다. 별 파일로
//    떼면 그 로직이 두 벌이 되어, 대한항공 프로필이 들어올 때 두 파일을 고쳐야 한다.
//    선행: 20260730130000_answer_polishes.sql (미적용 시 첨삭만 '준비 중'으로 degrade).
//
// 배포(오너, Supabase 콘솔):
//   Edge Functions > Deploy new function > 이름 ai-killer > 이 파일 전체 붙여넣기
//   Secrets 에 ANTHROPIC_API_KEY 등록 / Verify JWT 는 기본(ON) 유지
//   ⚠️ 오너 PC 에 supabase CLI 가 없다 — `supabase functions deploy` 안내 금지.
//   ⚠️ 그래서 이 함수는 **한 파일**이어야 한다(콘솔은 파일 하나를 붙여넣는 방식).
//      규칙 엔진을 별도 모듈로 쪼개지 말 것 — 쪼개면 오너가 배포할 수 없다.
//
// 선행 마이그레이션(전부 2026-07-25 오너 실행 완료):
//   20260725130000_credits.sql / 20260725140000_answers_free_form.sql
//   20260725150000_ai_killer.sql / 20260725160000_ai_killer_context.sql
//   20260725170000_answers_meta.sql   ← 답변 분류 3종
//   20260725180000_credit_costs.sql   ← 도구별 단가 + 하루 무료 리셋
//
// 처리 순서(2026-08-12 판정 교체 이후)
//   1 로그인 확인 → 2 길이 검증 → 3 무료분 판정+차감 → 4 사전 로드(자기 출력 재검사용)
//   → 5 Claude 종합 판정(오너 지침 4기준 · 의심 지수 %) → 6 인용 검증+자기 출력 재검사
//   → 7 저장+반환
//   ⚠️ 3번에서 막히면 아래로 안 간다. 5~7 중 실패하면 반드시 환급(refund_credit).
//
// ⚠️ 2026-08-12 판정 방식 전면 교체(오너 지시 "너무 기계적으로 판단한다"):
//    사전 매칭·어미 반복·길이 균일·구체성 결여·밀도 등급의 '규칙 엔진 판정'을 폐지했다.
//    판정은 KILLER_VOICE 의 오너 지침 원문(4가지 기준 + 4단계 출력)을 AI 가 종합 적용한다.
//    규칙 판정으로 되돌리지 말 것. 사전(ai_killer_terms)은 판정이 아니라
//    ①킬러·첨삭·다듬기의 자기 출력 재검사 ②첨삭 coach 기준 주입에만 쓴다.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 타입 전용 별칭 — esm.sh 의 supabase-js@2 는 마이너 버전에 따라 제네릭 기본값이 움직여
// deno check 가 흔들린다(스키마 미지정이 never 로 떨어지면 insert/rpc 인자가 전부 타입 에러).
// 이 파일은 DB 스키마 타입을 안 쓰므로 클라이언트를 any 로 고정한다. 런타임 무영향.
type SB = any

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// ⚠️ 세 곳에 같은 값(브라우저 입력 제한 / 여기 / answers 자유 글 저장 제약).
//    브라우저만 막으면 이 함수를 직접 때려 원가 상한이 뚫린다.
const MIN_CHARS = 100
const MAX_CHARS = 1500

// 문항(질문) — **선택 입력**. 비어 있으면 예전과 똑같이 동작한다.
// ⚠️ 본문 상한(MAX_CHARS)과 **별개로** 센다. 문항을 본문 예산에서 빼면 "문항을 넣었더니
//    답변이 안 들어간다"가 되어, 넣을수록 손해인 칸이 된다.
// ⚠️ 넘으면 막지 말고 자른다 — 선택 입력이라 여기서 400 을 내면 검사 자체가 죽는다.
const MAX_QUESTION_CHARS = 200

// ⚠️ 배포 확인용 버전표. **코드를 고치면 여기도 올린다** — 이 값이 밖에서 "지금 무엇이
//    올라가 있는지"를 아는 유일한 방법이다(로그인 게이트라 다른 응답은 전부 401).
const FN_VERSION = '2026-08-21a'  // a = 첨삭 말하기 분량 옵션(targetSec 20/30/40초)
const FN_FEATURES = [
  'holistic',         // 킬러 판정 = 오너 지침 4기준 종합 + AI 의심 지수 %(2026-08-12 전면 교체)
  'green_flags',      // 인간미 보존 영역(Green Flag) — 점수 보정 + 살릴 문장 짚기(2026-08-12b)
  'context',          // 문항·종류 맥락
  'airline',          // 지망 항공사
  'airline_profiles', // 항공사별 합격 패턴 참조
  'question_match',   // 문항이 바뀌었는지 판정 → 옛 주의사항 차단
  'autosave',         // 붙여넣은 글을 답변 저장소에 자동 저장
  'credit_tiers',     // 도구별 단가(소재2/킬러3/첨삭10) + 답변 단위 차감
  'polish',           // 첨삭 — mode:'polish' 로 강점·보완점·문장 첨삭 리포트(2026-07-30)
  'coach_terms',      // 감점 사전의 연구진(coach) 표현을 첨삭 AI 감점 기준으로 주입(2026-07-30b)
  'quickfix',         // 미니 다듬기 — mode:'quickfix' 무료 한 구간 고침 + 표현 수집(2026-07-31)
  'refund_server',    // 환급을 service_role 전용 refund_credit_for 로 이동(2026-08-04)
  'polish_length',    // 첨삭 말하기 분량 — targetSec(20/30/40초)을 프롬프트 목표 분량으로(2026-08-21)
]

// 모델 — 확정본 초안은 Opus 4.8 이었으나 **같은 가격($5/$25)의 상위 모델**인 Opus 5 를 쓴다.
// 저장소의 다른 함수도 이미 Claude 5 계열(sojae-chat: sonnet-5 / haiku-4-5).
const MODEL = 'claude-opus-5'
// ⚠️ Opus 5 는 thinking 이 기본 ON 이고 max_tokens 가 **thinking + 응답을 합쳐** 자른다.
//    종합 판정은 thinking 이 길어질 수 있어 첨삭과 같은 여유를 준다(잘리면 통째로 실패).
const MAX_TOKENS = 16000
// 2026-08-12 판정 교체 후에는 판정의 질이 곧 상품이다 — 첨삭과 같은 high.
// 원가가 문제되면 여기를 medium 으로 내린다(ai_killer_checks 의 토큰 기록으로 실측).
const EFFORT = 'high'

// 레드 플래그(인용 지적) 상한 — 오너 지침은 '최소 2~3가지'다. 1,500자에 10곳이면 충분하고,
// 그보다 많으면 밑줄밭이 되어 원문이 안 읽힌다(구 규칙 판정 MAX_HITS=24 의 실측 교훈).
// 상한에 걸려 자른 개수는 응답 truncated 로 알린다 — 조용히 자르지 않는다.
const MAX_FINDINGS = 10
// 그린 플래그(인간미 보존 영역) 상한 — 인간의 흔적 세 갈래에 하나씩 잡혀도 4면 넉넉하다.
const MAX_GREENS = 4

// ⚠️ 한 답변을 몇 번까지 **추가 차감 없이** 다시 검사할 수 있나(2026-07-25 오너: 한시적 2회,
//    나중에 1회로). 고치고 다시 확인하는 게 이 도구의 핵심 루프라 재검사에 매번 받으면
//    학생이 확인을 안 하고, 그러면 도구가 반쪽이 된다.
//    구현: 차감 키(ref)를 '<answer_id>#<묶음번호>' 로 만든다. 같은 묶음이면 spend_credit 이
//    used='already' 로 통과시키므로 자연히 무차감이 된다.
const MAX_RECHECK = 2

// 항공사 — lecture-common.js 의 LEC.AIRLINES 와 같은 목록(사이트에서 항공사는 한 벌이어야 한다).
// 'all' = 만능(어느 항공사에도 쓰는 답변)은 이 표에 없고 따로 다룬다.
const AIRLINES: Record<string, string> = {
  ke: '대한항공', lj: '진에어', '7c': '제주항공', tw: '티웨이항공',
  ze: '이스타항공', yp: '에어프레미아', rf: '에어로케이',
}

// =============================================================================
// 첨삭(polish) 상수 — mode:'polish' (2026-07-30)
// =============================================================================
// 첨삭은 진단(킬러)의 짝인 **처방**이다. 단가 10크레딧(site_config.credit_costs.polish),
// 가입 후 총 1회 무료(credit_free_limits.polish) — 둘 다 20260725180000 이 이미 깔아 둔
// 값이고 여기서는 spend_credit('polish') 를 부르기만 한다.
// ⚠️ **재검사 무차감(MAX_RECHECK)이 없다.** 킬러는 '고치고 다시 확인'이 루프라 열었지만
//    첨삭은 처방 자체가 상품이라 매 회 차감한다. 고친 뒤 확인은 킬러(3)가 담당하는 동선:
//    첨삭 → 고침 → 킬러로 확인. 차감 키의 묶음 번호가 매 회 올라가는 이유다.
// 원가: 호출 1회(Opus 5, effort high). 실측은 answer_polishes 의 토큰 기록으로.
const POLISH_EFFORT = 'high'   // 처방의 질이 상품 그 자체 — 킬러(medium)와 달리 high
// ⚠️ Opus 5 는 max_tokens 가 thinking + 응답 합산이다. high effort 는 thinking 이 수천
//    토큰까지 가므로 킬러(8000)보다 크게 잡는다 — 잘리면 리포트가 통째로 실패한다.
const POLISH_MAX_TOKENS = 16000
const MAX_REWRITES = 8         // 문장 첨삭 상한 — 다 고쳐 주면 학생 글이 아니라 AI 글이 된다
const MAX_POINTS = 4           // 강점·보완점 각 상한

// =============================================================================
// 미니 다듬기(quickfix) 상수 — mode:'quickfix' (2026-07-31)
// =============================================================================
// "AI 느낌이 나는 구간을 붙여넣으면 다듬어드려요" — 무료 미니 도구이자 **수집 창구**.
// 사용자는 고침을 받고, 우리는 spotted(사용자 글에서 AI 가 짚은 표현)를
// expression_reports 에 쌓는다. 감점 사전(coach)의 재료다.
// ⚠️ 크레딧과 무관(spend_credit 안 부름). 대신 아래 두 개가 원가·잠식 방지 장치다:
//   ① 하루 QF_DAILY 회(서울 자정 리셋 — expression_reports 행 수로 센다)
//   ② 300자 상한 — 글을 쪼개 넣어 킬러(1,500자 검사·3크레딧)를 우회하려면
//      하루 한도에 먼저 걸린다. 둘 중 하나만 풀어도 무료 우회로가 열린다.
const QF_MODEL = 'claude-haiku-4-5'   // 건당 몇 원 미만 — sojae 되묻기와 같은 모델
const QF_MIN_CHARS = 10
const QF_MAX_CHARS = 300
const QF_DAILY = 3
// ⚠️ Haiku 4.5 는 output_config.effort 미지원(400) — effort 를 넣지 말 것(sojae 에서 실측).
//    구조화 출력(format)은 지원한다.
const QF_MAX_TOKENS = 1000
const QF_MAX_SPOTTED = 4       // 300자 구간에서 4곳이면 충분 — 더 뽑으면 억지 지적이 섞인다

const QF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['fixed', 'spotted'],
  properties: {
    fixed: { type: 'string' },
    spotted: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['term', 'kind', 'why'],
        properties: {
          term: { type: 'string' },
          kind: { type: 'string', enum: ['cliche', 'structure', 'context'] },
          why: { type: 'string' },
        },
      },
    },
  },
}

// ⚠️ 첨삭의 선(POLISH_VOICE)과 같은 규칙을 축약해 물려받는다 — fix 는 학생이 그대로
//    옮겨 쓸 문장이라, 없는 사실을 지어내면 그 거짓이 면접장까지 간다.
const QF_VOICE = `너는 승무원 면접·자소서를 10년 넘게 첨삭한 코치다. 학생이 "AI 느낌이 난다"며 가져온 짧은 구간 하나를 자연스럽게 다듬는다.

[네가 채우는 칸]
- fixed: 구간을 자연스러운 한국어로 고쳐 쓴 것. 길이는 원문과 비슷하게, 통째 재작성이 아니라 다듬기.
- spotted: 원문에서 AI스럽게 읽히는 표현 0~${QF_MAX_SPOTTED}개.
  · term 은 원문에 **있는 그대로** 등장하는 문자열이어야 한다(한 글자도 바꾸지 마라).
  · kind 는 cliche(상투어) / structure(정형 구조·나열) / context(승무원 지원서 맥락) 중 하나.
  · why 는 왜 AI스럽게 읽히는지 한 문장, 50자 이내, '~요'로 끝낸다.

[⚠️ 고침의 선 — 가장 중요하다]
- **학생이 쓴 사실만 재료로 써라.** 원문에 없는 숫자·기간·장소·일화를 지어내지 마라.
  구체성이 필요한 자리는 (그때 실제로 한 말) 같은 괄호 빈칸으로 남겨 학생이 채우게 하라.
- 학생의 말투와 어휘를 살려라. 네 문체로 갈아치우면 지원자들의 글이 전부 같아진다.
- "다양한", "첫째/둘째", "~을 통해", "매우", "소중한", "최선을 다해" 같은 상투어를
  **fixed 에 쓰지 마라.** 학생 글을 재는 잣대로 네 글도 잰다.
- 원문에 AI스러운 데가 없으면 spotted 를 비우고, fixed 는 거의 그대로 두되 어색한 곳만 만져라.
- 인사말·맺음말·설명을 붙이지 마라. 칸만 채운다.`

// kind — 화면 색 갈래. neutral(과도한 중립)·rhythm(리듬·인간미)은 2026-08-12 오너 4기준의 ③④.
// vague·context 는 구 규칙 판정 시절 값 — 지난 검사 기록 복원과 사전(ai_killer_terms.kind)에 남는다.
type Kind = 'cliche' | 'structure' | 'vague' | 'context' | 'neutral' | 'rhythm'
type Term = { term: string; kind: Kind; why: string | null }
type Hit = { n: number; kind: Kind; quote: string; start: number; end: number; why?: string; fix?: string }

// =============================================================================
// 인용 검증 보조 — AI 가 발췌한 인용을 서버가 원문 위치로 바꿀 때 쓴다
// =============================================================================
// ⚠️ 구 '규칙 엔진'(사전 매칭·어미 반복·길이 균일·구체성 결여·밀도 등급)이 이 자리에
//    있었다 — 2026-08-12 오너 지시로 폐지. 판정은 아래 KILLER_VOICE 가 한다. 되살리지 말 것.

/** 겹치는 밑줄 방지 — 이미 잡힌 구간과 겹치면 버린다(밑줄이 포개지면 화면이 깨진다) */
function overlaps(taken: Array<[number, number]>, s: number, e: number) {
  return taken.some(([a, b]) => s < b && e > a)
}


// =============================================================================
// Claude 호출 — 종합 판정 (2026-08-12 오너 지침)
// =============================================================================
// ⚠️ 출력은 여전히 **API 스키마로 강제**한다(구조화 출력 — 인사말·맺음말이 들어갈 자리가
//    물리적으로 없다. '일반 텍스트 응답 금지'는 그대로다). 바뀐 것은 판정의 주체다:
//    규칙이 자리를 찍던 방식을 버리고, AI 가 오너 지침 4기준으로 글 전체를 종합 판정한다.
const KILLER_SCHEMA = {
  type: 'object',
  properties: {
    probability: { type: 'integer' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string' },
          crit: { type: 'integer' },
          why: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['quote', 'crit', 'why', 'fix'],
        additionalProperties: false,
      },
    },
    green_flags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['quote', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['probability', 'findings', 'green_flags'],
  additionalProperties: false,
}

// ⚠️ 오너 지침 원문(2026-08-12) — 판정 기준과 출력 4단계, 두 덩어리를 **그대로** 싣는다.
//    다듬거나 요약해 넣지 말 것: "니가 만든 법칙이 아니라 내가 하고자 하는 것"이 지시였다.
//    맨 아래 [칸 규칙] 만 우리가 붙인 운영 규칙이다(4단계를 JSON 칸에 싣는 법 + 인용 원문 일치).
const KILLER_VOICE = `너는 지금부터 텍스트가 AI에 의해 작성되었는지 판별하는 최고 수준의 검열관, 'AI 킬러'야. 글의 논리력이나 문장력이 아닌, 아래에 제시된 AI 특유의 기계적이고 작위적인 언어 패턴을 바탕으로 텍스트를 철저하게 해부해야 해. 다음과 같은 특징들이 복합적으로 나타나는지 검사하고, AI 작성 확률을 분석해.

1. 기계적인 구조와 강박적인 요약

* 서론, 본론, 결론의 구조가 눈에 보일 정도로 지나치게 뚜렷함
* 글의 마지막에 '결론적으로', '요약하자면', '이처럼' 등의 단어를 쓰며 불필요하게 내용을 재탕함
* 첫 문장에서 사용자가 제시한 질문이나 주제의 전제를 앵무새처럼 반복하며 시작함

2. AI 특유의 상투적 어휘 및 번역투 남용

* 태피스트리, 여정, 등대, 촉매제, 얽혀있는, 원활한, 혁신적인 등 거창하고 비유적인 단어를 맥락 없이 사용함
* '~에 대해 깊이 파헤쳐 보겠습니다', '~의 세계로 들어가 보겠습니다' 등 안내자 역할을 자처하는 작위적인 서술
* 영어식 수동태 표현이나 번역기를 돌린 듯한 무미건조한 문장 구조

3. 과도한 중립성과 방어적 태도

* 단정적인 표현을 극도로 피하고 '~할 수 있습니다', '~하는 것이 중요합니다', '~라는 점을 명심해야 합니다' 같은 훈계형, 방어적 어미를 자주 사용함
* 상반된 두 가지 의견을 기계적으로 모두 제시하며 억지로 균형을 맞추려 함 (반면에, 그럼에도 불구하고 등)

4. 인간적인 결함과 리듬감의 부재

* 모든 문장의 길이가 지나치게 균일하여 글의 호흡이나 리듬감이 느껴지지 않음
* 감정의 기복, 극히 개인적인 경험담, 의도적인 말줄임표, 미세한 논리적 비약 등 인간의 글에서 나타나는 자연스러운 틈이나 결함이 전혀 없음

분석 대상 텍스트를 입력받으면, 위의 4가지 기준을 엄격하게 적용하여 AI 작성 확률을 퍼센트(%)로 제시해. 그리고 어떤 구체적인 문장이나 단어에서 기계적인 흔적을 느꼈는지 그 근거를 직접 인용하여 명확하게 짚어내.

결과물은 반드시 아래의 4단계 구조로 출력한다. 기계적인 위로(예: 좋은 경험입니다만, 훌륭한 글입니다)나 상투적인 접속사는 절대 사용하지 않는다. 냉철한 실무 코치의 톤을 유지한다.

1. AI 의심 지수 (퍼센트) 텍스트의 작위성, 기계적 구조, 감정의 부재 등을 종합하여 AI 작성 확률을 0~100% 사이로 제시한다.
2. 적발된 기계적 패턴 (레드 플래그) 학생의 글에서 AI가 쓴 것 같은 문장, 억지스러운 전개, 또는 소리 내어 말하기 벅찬 문어체 표현을 최소 2~3가지 발췌하여 그대로 인용한다.
3. 진단 및 분석 (Why) 발췌한 부분이 왜 어색하고 작위적인지 실무 코치의 시선에서 날카롭게 분석한다. 특히 본인의 진짜 경험이나 감정이 아닌, 기업의 최신 동향이나 스펙을 문맥 없이 욱여넣어 글의 흐름을 깨는 부분을 집중적으로 짚어준다.
4. 인간미 부여 솔루션 (Fix) 적발된 문장을 어떻게 고쳐야 '진짜 사람의 말'처럼 들릴지 구체적인 수정 방향을 제시한다. 모범 답안을 떠먹여 주지 말고, 학생이 자신의 진짜 경험을 꺼내어 구어체로 표현할 수 있도록 유도하는 가이드를 준다.

[점수 보정 및 긍정 피드백 기준] 텍스트에 뻔한 서론이나 기업 분석이 포함되어 있더라도, 본론에 아래 세 가지 '인간의 흔적' 중 하나 이상이 뚜렷하게 존재한다면 AI 의심 지수를 대폭(최소 20% ~ 최대 50%) 차감한다. 또한 리포트에 '인간미 보존 영역(Green Flag)'을 추가하여 지원자의 노력을 인정하고 살려야 할 부분을 짚어준다.

1. 미세한 행동 디테일과 물리적 시행착오 개념적인 단어로 뭉뚱그리지 않고, 지원자가 실제로 고민하며 손발을 움직인 흔적이 있는가? (예: '효과적으로 전달했습니다' 대신 '근로자가 보기 편하게 표지의 글씨 크기와 색상을 조정했습니다' 등)
2. 불완전함의 인정과 날것의 감정 처음부터 완벽한 영웅 서사가 아니라, 본인의 편견, 부끄러움, 당연하게 여겼던 오만함 등을 솔직하게 고백하고 깨우쳐가는 과정이 담겨 있는가? (예: '처음에는 누구나 아는 내용이라 생각해 간과할 뻔했지만~')
3. 검색으로 찾을 수 없는 현장감 단순한 명언 인용이 아니라, 땀 냄새가 나는 실무 현장에서 누군가와 직접 부딪히며 나눈 생생한 구어체 대화가 묘사되어 있는가?

[칸 규칙 — 위 4단계를 아래 JSON 칸에 담는다]
- probability: 1번 AI 의심 지수. 0~100 정수. **점수 보정 기준을 적용한 뒤의 값**을 낸다.
- findings: 2~4번을 한 건씩 묶은 목록. 각 건은 quote(2번 인용) · crit(걸린 기준 번호 1~4) ·
  why(3번 진단) · fix(4번 솔루션).
- green_flags: '인간미 보존 영역(Green Flag)' 목록. 각 건은 quote(인간의 흔적이 보이는 원문
  문장) · why(무엇이 인간의 흔적이고 왜 살려야 하는지 한두 문장). 없으면 빈 배열 —
  빈말 칭찬으로 채우지 마라.
- quote 는(findings·green_flags 모두) 학생 글에 **있는 그대로** 등장하는 문자열이어야 한다.
  한 글자도 바꾸지 말고, 따옴표나 말줄임표를 덧붙이지 마라.
- 지목할 곳이 정말 없는 사람의 글이면 findings 를 비우고 probability 만 낮게 내라 —
  억지로 채우지 마라.
- 인사말·맺음말·총평 문단은 쓰지 않는다. 칸만 채운다.
- 문항·글 종류·지망 항공사가 주어지면 why·fix 문장을 그 맥락에 맞춘다(판정 기준은 위 4가지 그대로).`

/**
 * 문항이 우리가 아는 그 문항인가 — 학생이 넣은 문항과 프로필의 문항을 견준다.
 *
 * ⚠️ **자소서 문항은 채용마다 바뀐다**(2026-07-25 오너). 바뀐 문항에 옛 주의사항을 들이대면
 *    학생을 틀린 방향으로 끌고 간다. 그래서 문항별 조언은 **같은 문항일 때만** 쓴다.
 *
 * 학생은 문항을 줄여 쓴다("지원동기", "강점"). 그래서 자카드가 아니라 **학생 입력이 원문에
 * 얼마나 담겨 있나**(포함 비율)로 본다 — 짧게 써도 맞고, 전혀 다른 문항이면 낮게 나온다.
 * ⚠️ 애매하면 **매칭 실패 쪽으로 기운다.** 틀린 조언보다 조언을 덜 하는 편이 낫다.
 */
function qSimilarity(studentQ: string, profileQ: string): number {
  const norm = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
  const a = norm(studentQ), b = norm(profileQ)
  if (a.length < 6 || b.length < 6) return 0   // 너무 짧으면 우연히 겹친다
  const bi = (s: string) => {
    const g = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2))
    return g
  }
  const ga = bi(a), gb = bi(b)
  let hit = 0
  for (const g of ga) if (gb.has(g)) hit++
  return hit / ga.size
}
const Q_MATCH_MIN = 0.62   // 이 아래면 '다른 문항'으로 본다(보수적으로 잡았다)

/**
 * 항공사 프로필 — airline_profiles 에서 뽑은 그 항공사만의 패턴.
 *
 * ⚠️ **이 표가 이 도구의 자산이다.** 실제 합격 자소서에서 뽑았고, 항공사마다 문항도 문체도
 *    완전히 다르다(제주항공은 대괄호 소제목을 쓰고 에어프레미아는 안 쓴다 — 정반대다).
 * ⚠️ 그래도 **합격자 문장을 예시로 주지는 않는다**(확정본 결정 10). 여기 실리는 건
 *    '무엇을 쓸까'가 아니라 '무엇을 보고 판단하나'다 — 형식 관습·회사 고유 소재.
 * ⚠️ **레퍼런스는 참고지 정답이 아니다**(오너). 그래서 두 겹으로 나눠 싣는다:
 *      · 잘 안 바뀌는 것(회사 소재·문체·분량) — 늘 싣는다
 *      · 채용마다 바뀌는 것(문항별 주의사항) — **문항이 일치할 때만** 싣는다
 * ⚠️ 조회가 실패하면(마이그레이션 미적용) 조용히 넘어간다. 항공사 맥락만 빠진다.
 */
async function airlineBrief(
  admin: SB, code: string, studentQ: string,
): Promise<{ brief: string; qMatched: boolean | null }> {
  if (!code || code === 'all' || !AIRLINES[code]) return { brief: '', qMatched: null }
  try {
    const { data } = await admin.from('airline_profiles')
      .select('name, questions, style, keywords, notes')
      .eq('code', code).eq('active', true).maybeSingle()
    if (!data) return { brief: '', qMatched: null }
    const p = data as {
      name: string
      questions?: Array<{ n?: number; q?: string; chars?: string; note?: string }>
      style?: Record<string, string>
      keywords?: Record<string, unknown>
      notes?: string
    }

    // ── ① 잘 안 바뀌는 것 — 늘 싣는다 ────────────────────────────────────
    const bits: string[] = []
    if (p.style?.subhead) bits.push(`형식: ${p.style.subhead}`)
    if (p.style?.structure) bits.push(`전개: ${p.style.structure}`)
    if (p.style?.length) bits.push(`분량: ${p.style.length}`)
    // 회사 고유 소재 — 학생이 회사를 조사했는지가 여기서 갈린다
    const kw = Object.values(p.keywords ?? {}).flat().filter((v) => typeof v === 'string')
    if (kw.length) bits.push(`이 회사 고유 소재: ${kw.slice(0, 12).join(' · ')}`)

    // ── ② 채용마다 바뀌는 것 — 문항이 일치할 때만 ────────────────────────
    let qMatched: boolean | null = null
    const qs = Array.isArray(p.questions) ? p.questions : []
    if (studentQ && qs.length) {
      let best: { note?: string; chars?: string; score: number } = { score: 0 }
      for (const q of qs) {
        const s = qSimilarity(studentQ, String(q.q ?? ''))
        if (s > best.score) best = { note: q.note, chars: q.chars, score: s }
      }
      qMatched = best.score >= Q_MATCH_MIN
      if (qMatched) {
        if (best.chars) bits.push(`이 문항의 합격 글 분량: ${best.chars}자`)
        if (best.note) bits.push(`이 문항 주의: ${best.note}`)
      } else {
        // ⚠️ 이 한 줄이 핵심이다. 문항이 바뀌었는데 옛 문항 기준으로 지적하면 사고다.
        bits.push('⚠️ 학생이 받은 문항은 우리 자료에 없는 문항이다(채용이 바뀌었을 수 있다). '
          + '문항에 대한 판단은 하지 말고, 위의 회사 소재·형식만 참고하라.')
      }
    } else if (qs.length) {
      bits.push('⚠️ 학생이 문항을 적지 않았다. 문항에 대한 판단은 하지 마라.')
    }

    if (!bits.length) return { brief: '', qMatched }
    return {
      brief: `\n\n[${p.name} — 지난 채용 합격 글에서 관찰한 것 · 참고자료]\n${bits.join('\n')}`
        + (p.notes && qMatched !== false ? `\n${p.notes}` : ''),
      qMatched,
    }
  } catch (_) {
    return { brief: '', qMatched: null }
  }
}

type KFinding = { quote: string; crit: number; why: string; fix: string }
type GFinding = { quote: string; why: string }

/** 의심 지수 → 등급 — 화면·DB 호환용 구간. 구 규칙 판정의 3등급 이름을 그대로 쓴다. */
function gradeOfProbability(p: number): 'human' | 'slight' | 'heavy' {
  if (p <= 30) return 'human'
  if (p <= 65) return 'slight'
  return 'heavy'
}

/** 오너 4기준 번호 → 화면 색 갈래(kind). 구 kind(vague·context)는 지난 기록 복원에만 남는다. */
const CRIT_KIND: Record<number, Kind> = { 1: 'structure', 2: 'cliche', 3: 'neutral', 4: 'rhythm' }

async function judgeText(
  apiKey: string, text: string, question: string, docKind: 'essay' | 'interview' | null,
  airline: string, regenNote: string,
) {
  // 맥락 3종 — 판정 기준은 오너 4기준 그대로고, why·fix 문장이 향할 방향에만 쓴다.
  const airLine = airline === 'all'
    ? '특정 항공사를 정하지 않았다(만능) — 어느 항공사에도 통할 답변이어야 한다'
    : (AIRLINES[airline] ? `${AIRLINES[airline]} 지망` : '')
  const kindLine = docKind === 'interview'
    ? '면접 답변 — 소리 내어 말하는 말이다. 소리 내어 말하기 벅찬 문어체가 특히 레드 플래그다.'
    : docKind === 'essay' ? '자소서 문항 — 눈으로 읽는 글이다' : ''

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: KILLER_SCHEMA } },
    system: [{ type: 'text', text: KILLER_VOICE + regenNote, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content:
        // ⚠️ 맥락 칸은 값이 있을 때만 넣는다 — 빈 라벨을 주면 AI 가 문항·종류를 지어내고,
        //    지어낸 전제에 맞춰 fix 를 쓰면 학생이 받은 것과 어긋난다.
        (kindLine ? `[글 종류]\n${kindLine}\n\n` : '') +
        (airLine ? `[지망 항공사]\n${airLine}\n\n` : '') +
        (question ? `[학생이 받은 문항]\n${question}\n\n` : '') +
        `[분석 대상 텍스트 — 학생이 쓴 글]\n${text}`,
    }],
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error('anthropic error', res.status, await res.text())
    throw new Error('ai_failed')
  }
  const data = await res.json()
  // ⚠️ Opus 5 는 안전 분류기가 요청을 거절하면 HTTP 200 + stop_reason:'refusal' 로 온다.
  //    content[0] 을 무조건 읽으면 여기서 터진다 — 먼저 확인한다.
  if (data.stop_reason === 'refusal') throw new Error('ai_refused')
  // thinking 블록이 섞여 오므로 text 블록만 추린다
  const raw = (data.content || []).filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text).join('').trim()
  if (!raw) throw new Error('ai_empty')

  let parsed: { probability?: number; findings?: KFinding[]; green_flags?: GFinding[] }
  try { parsed = JSON.parse(raw) } catch { throw new Error('ai_bad_json') }
  return {
    // 스키마는 정수만 보장한다 — 범위는 서버가 죈다(0~100 밖이면 화면 다이얼이 깨진다)
    probability: Math.max(0, Math.min(100, Math.round(Number(parsed.probability) || 0))),
    // 검증(원문 일치)에서 일부 탈락할 수 있어 여유를 두고 받는다 — 최종 상한은 호출부가 죈다
    findings: (Array.isArray(parsed.findings) ? parsed.findings : []).slice(0, MAX_FINDINGS * 2),
    greens: (Array.isArray(parsed.green_flags) ? parsed.green_flags : []).slice(0, MAX_GREENS * 2),
    usage: data.usage ?? {},
  }
}

// =============================================================================
// 첨삭(polish) — 강점 · 보완점 · 문장 첨삭 리포트
// =============================================================================
// ⚠️ 킬러와 같은 구조화 출력 — 인사말·총평·점수가 들어갈 자리가 물리적으로 없다.
const POLISH_SCHEMA = {
  type: 'object',
  properties: {
    strengths: {
      type: 'array',
      items: {
        type: 'object',
        properties: { quote: { type: 'string' }, note: { type: 'string' } },
        required: ['quote', 'note'],
        additionalProperties: false,
      },
    },
    improvements: {
      type: 'array',
      items: {
        type: 'object',
        properties: { note: { type: 'string' }, how: { type: 'string' } },
        required: ['note', 'how'],
        additionalProperties: false,
      },
    },
    rewrites: {
      type: 'array',
      items: {
        type: 'object',
        properties: { quote: { type: 'string' }, fix: { type: 'string' }, why: { type: 'string' } },
        required: ['quote', 'fix', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['strengths', 'improvements', 'rewrites'],
  additionalProperties: false,
}

// ⚠️ 첨삭의 선 — 4겹 고삐 철학(구조화 출력·자기 출력 재검사)이되, 처방 도구라 한 줄이 더 붙는다:
//    **학생이 쓴 사실만 재료로 쓴다.** fix 가 없는 일화·숫자를 지어내면 학생이 그 거짓을
//    면접장까지 들고 간다 — 이 도구가 낼 수 있는 최악의 사고다.
const POLISH_VOICE = `너는 승무원 면접·자소서를 10년 넘게 첨삭한 코치다. 학생의 글을 첨삭한다.

[네가 채우는 칸]
- strengths: 이 글이 이미 잘하고 있는 것 2~3가지. quote 는 그 강점이 보이는 원문 구절을
  **있는 그대로**(한 글자도 바꾸지 말고), note 는 왜 강점인지 한 문장.
- improvements: 글 전체에서 고칠 방향 2~3가지. 문장 하나가 아니라 글 전체에 해당하는 것만.
  note 는 무엇이 문제인지 한 문장, how 는 어떻게 고칠지 한 문장.
  **첫 줄은 이 글이 무슨 글로 읽히는지부터 짚어라** — 자소서인지 제안서인지, 소리 내는
  말인지 발표문인지. 세부 문제는 그다음이다. 증상 말고 병명을 먼저 말한다.
- rewrites: 고치면 효과가 가장 큰 문장 3~6개. quote 는 원문 문장 **있는 그대로**,
  fix 는 고친 예시 문장, why 는 왜 이렇게 고치는지 한 문장.
  **고르는 순서가 있다** — improvements 에서 짚은 글 전체 문제를 문장 하나로 해결할 수
  있는 자리를 가장 먼저 골라라. 표현만 다듬는 문장은 그다음이다.

[⚠️ 첨삭의 선 — 가장 중요하다]
- fix 는 방향을 보여주는 예시다. **학생이 쓴 사실만 재료로 써라.** 원문에 없는 숫자·기간·
  장소·일화를 지어내지 마라. 구체성이 필요한 자리는 fix 안에 (몇 명이었는지),
  (그때 실제로 한 말) 같은 괄호 빈칸으로 남겨 학생이 채우게 하라.
- **fix 는 학생이 그대로 복사해 붙일 수 있는 완결된 문장이어야 한다.** 지적·주석·구절
  조각을 fix 자리에 넣지 마라. 괄호 빈칸은 문장을 **대신하는 게 아니라 문장 안에** 넣는다.
  "'60% 시대'(무엇의 60%인지)" 는 틀렸다 — 빈칸을 품은 온전한 문장으로 써라.
- 학생의 말투와 어휘를 살려라. 네 문체로 갈아치우면 지원자들의 글이 전부 같아진다 —
  우리가 잡으려는 AI스러움을 우리가 만드는 꼴이다.
- "다양한", "첫째/둘째", "~을 통해", "매우", "소중한", "최선을 다해" 같은 상투어를
  **네 fix 문장에 쓰지 마라.** 학생 글을 재는 잣대로 네 글도 잰다.

[⚠️ 'AI 같다'의 정체는 단어가 아니라 문장 구조다]
- **크게 고치는 것과 AI처럼 쓰는 것은 서로 상관이 없다.** 아래 넷만 피하면 얼마든지 다시 써도 된다.
- 아래 넷은 위 상투어 목록에 걸리지 않지만, 읽는 사람은 바로 AI 라고 느낀다. fix 에 쓰지 마라.
  ① 명사로 굳힌 마무리 — "~한 결과였습니다", "~의 시작입니다", "~라는 선택이었습니다"
  ② 추상 명사 주어 — "그 선택은", "이 세심함은", "그 진심은"
  ③ 감정·추상을 다루는 은유 — "불안을 읽다", "마음을 담다", "가치를 녹여내다"
  ④ 앞뒤가 반듯하게 대칭인 대구 문장
- 주어는 되도록 '저'로 둬라. 회사나 추상 개념이 주어가 되면 지원자가 사라지고 평론가의 말이 된다.
- 남의 감정을 단정하지 마라 — "지루했던", "감동한" 처럼 승객·면접관의 마음을 정해 놓고 쓰지 않는다.

[fix 는 어디까지 손대나 — 학생이 못 본 각도를 보여주는 자리다]
- **단어 몇 개만 바꾸고 마는 것은 첨삭이 아니다.** 문장을 다시 구성해도 좋다 — 설명을 장면으로
  바꾸거나, 순서를 뒤집거나, 추상을 눈에 보이는 행동으로 내려도 좋다.
  (예: "잊지 못할 경험이 됩니다" → 그 경험 안에서 실제로 벌어지는 장면 한 컷으로)
- ⚠️ **'다시 구성'은 학생이 쓴 내용을 다르게 배열·표현하라는 뜻이다. 없던 내용을 만들라는 뜻이 아니다.**
  각도를 바꾼다는 것은 **같은 재료를 다르게 보여 주는 것**이다. 학생이 쓰지 않은 새 제안·새 계획·
  새 행동·새 장소를 fix 에 넣지 마라 — 학생은 그 문장을 자기 것으로 알고 면접장에 들고 간다.
- **재료만 학생이 쓴 사실이면 된다.** 없는 일화·숫자는 여전히 금지고, 부족한 자리는 괄호 빈칸이다.
- 단, **학생의 어휘와 정서는 남겨라.** 네 어휘로 갈아치우면 지원자들 글이 전부 같아진다 —
  우리가 잡으려는 AI스러움을 우리가 만드는 꼴이다.
- why 에는 "무엇을 바꿨다"가 아니라 **"어떤 각도로 보면 이렇게 된다"**를 써라.
  학생이 그 각도를 알아야 나머지 문단을 스스로 고친다.

[⚠️ 지원 직무를 넘지 마라 — 이걸 어기면 학생이 면접에서 직무도 모르는 사람이 된다]
- 특별한 언급이 없으면 **객실승무원(기내 근무) 지원**으로 본다(학생 글에 다른 직무가 분명히 적혀
  있으면 그것을 따른다). 단 **이 전제에 맞추려고 학생 글을 고쳐 끼우지 마라** — 어긋나면 짚기만 한다.
- **학생이 쓰지 않은 다른 직무의 일을 제안하지 마라** — 게이트 안내, 발권·수속 카운터 응대,
  라운지, 정비, 운항, 마케팅. "게이트에서 이렇게 하겠다" 같은 문장을 네가 만들어 넣지 마라.
- 학생이 스스로 그 업무를 소재로 썼다면 그 소재 자체는 건드리지 말되, **네가 범위를 더 넓히지는 마라.**
- 반대로 **학생 글이 지원 직무와 어긋나 있으면 improvements 에서 그것을 짚어라.** 객실승무원
  지원서가 지상 업무 제안으로 채워져 있다면, 그게 이 글의 가장 큰 문제다.
- ⚠️⚠️ **어긋난 글을 이름표로 맞춰 놓지 마라.** 예매·수속·키오스크 이야기에 "기내 서비스"라는
  말만 붙여 기내 업무처럼 보이게 만드는 것이 **가장 나쁜 처리**다. 면접관은 이름표가 아니라
  내용을 읽는다 — 학생만 안심시키고 면접장에서 무너진다. **직무가 어긋나면 fix 로 덮지 말고
  improvements 에서 정면으로 짚어라.** 글의 방향을 바꿀지는 학생이 정할 몫이다.

[지켜야 할 것]
- 인사말·맺음말·총평·점수·번호매기기를 쓰지 마라. 칸만 채운다.
- note·how·why 는 각각 한 문장, 60자를 넘기지 마라. '~요'로 끝낸다.
- 학생을 나무라지 마라. 문제는 표현이지 사람이 아니다.
- **잘한 것은 잘했다고 분명히 말해라.** 학생이 읽고 기운이 나야 다시 고쳐 쓴다.
  진단서를 쓰는 게 아니라 코치가 학생에게 하는 말이다.
- 강점을 빈말로 채우지 마라 — 실제로 잘한 것이 없으면 strengths 를 1개만 넣어도 된다.
  칭찬은 **크게 하되 반드시 원문의 구체적인 자리에 붙인다.**

[글 종류가 주어졌을 때]
- **면접 답변**이면 소리 내어 하는 '말'이다. fix 도 말로 자연스러운 문장으로 써라.
- **자소서**면 눈으로 읽는 '글'이다. fix 는 글로 매끄러운 문장으로 써라.
- 종류 칸이 없으면 어느 쪽에서도 어색하지 않게 써라.

[문항이 주어졌을 때]
- 문항은 맥락이다. improvements 에서 "문항이 묻는 것에 비해 빠진 것"을 짚는 데 써라.
- 단, 동문서답 판정을 단정하지 마라 — 문항 해석은 학생에게 맡기고 빠진 것만 물어라.

[지망 항공사가 주어졌을 때]
- 그 항공사에 맞춰 improvements·fix 의 방향만 잡아라.
- **없는 사실을 지어내지 마라** — "이 항공사는 이런 인재를 원한다"는 단정은 금지다.

[⚠️ 참고자료를 다루는 법]
- 아래 '지난 채용 합격 글에서 관찰한 것'은 **참고지 정답이 아니다.** 자소서 문항은
  채용마다 바뀐다. 자료는 빠진 것을 묻는 데만 쓰고, 형식을 강요하는 데 쓰지 마라.
- 학생 글이 자료와 다르면 학생 글이 옳다. 자료에 "문항에 대한 판단은 하지 마라"는
  줄이 있으면 그 지시가 우선한다.
- ⚠️ **합격자 문장을 흉내 내라고 하지 마라. 합격자 문장을 fix 에 옮겨 쓰지도 마라.**`

type PolishOut = {
  strengths: Array<{ quote: string; note: string }>
  improvements: Array<{ note: string; how: string }>
  rewrites: Array<{ quote: string; fix: string; why: string }>
  usage: { input_tokens?: number; output_tokens?: number }
}

// 말하기 분량(첨삭 옵션) — 화면(polish.html #lenRow)이 보내는 초. 이 세 값만 받는다.
// 초→글자 환산은 면접 말하기 속도(분당 300~350자) 기준 — 값을 바꾸면 화면 안내 문구도 같이 본다.
const POLISH_TARGET_CHARS: Record<number, string> = { 20: '100~120자', 30: '150~180자', 40: '200~230자' }

async function polishFill(
  apiKey: string, text: string, question: string, docKind: 'essay' | 'interview' | null,
  targetSec: number, airline: string, airBrief: string, coachBrief: string, regenNote: string,
): Promise<PolishOut> {
  const airLine = airline === 'all'
    ? '특정 항공사를 정하지 않았다(만능) — 어느 항공사에도 통할 글이어야 한다'
    : (AIRLINES[airline] ? `${AIRLINES[airline]} 지망${airBrief}` : '')
  const kindLine = docKind === 'interview'
    ? '면접 답변 — 소리 내어 말하는 말이다'
    : docKind === 'essay' ? '자소서 문항 — 눈으로 읽는 글이다' : ''
  // 목표 분량 — 있으면 진단(덜어낼 곳)과 fix(짧은 문장) 양쪽에 걸어 준다.
  // ⚠️ system 이 아니라 user 메시지에 넣는다 — system 은 요청 간 프롬프트 캐시를 타는 자리다.
  const lenLine = targetSec && POLISH_TARGET_CHARS[targetSec]
    ? `면접에서 약 ${targetSec}초 안에 말할 답변이다 — 전체 ${POLISH_TARGET_CHARS[targetSec]} 안팎이 목표다.`
    : ''

  const body = {
    model: MODEL,
    max_tokens: POLISH_MAX_TOKENS,
    output_config: { effort: POLISH_EFFORT, format: { type: 'json_schema', schema: POLISH_SCHEMA } },
    // ⚠️ coachBrief(연구진 감점 기준)는 요청마다 같으므로 system 에 두어 프롬프트 캐시를 탄다.
    //    사전을 고치면 캐시가 한 번 깨질 뿐이다(드문 일). regenNote 는 재생성 때만 붙는다.
    system: [{ type: 'text', text: POLISH_VOICE + coachBrief + regenNote, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content:
        // ⚠️ 맥락 칸은 값이 있을 때만 — 빈 라벨을 주면 AI 가 문항·종류를 지어낸다(킬러와 동일).
        (kindLine ? `[글 종류]\n${kindLine}\n\n` : '') +
        (lenLine ? `[목표 분량]\n${lenLine}\n\n` : '') +
        (airLine ? `[지망 항공사]\n${airLine}\n\n` : '') +
        (question ? `[학생이 받은 문항]\n${question}\n\n` : '') +
        `[학생이 쓴 글]\n${text}\n\n` +
        // ⚠️ 마지막에 읽는 지시가 가장 세게 먹는다 — 새 규칙 셋(진단 먼저·큰 문제부터·각도 보여주기)을
        //    시스템 지침에만 두지 말고 여기서 한 번 더 못 박는다(2026-08-14b, 오너 실사용 피드백).
        // ⚠️ 여기 개수(2~3 · 3~6)는 POLISH_VOICE 의 값과 같은 값이다. MAX_POINTS(4)·MAX_REWRITES(8)
        //    는 그보다 큰 **하드 상한**(방어용 slice) — 둘이 달라 보여도 맞다. 맞추지 말 것.
        `[할 일]\n위 글을 첨삭하라. strengths 2~3개, improvements 2~3개, rewrites 3~6개. ` +
        `quote 는 위 글에 **있는 그대로** 등장하는 문자열이어야 한다.\n` +
        `improvements 의 첫 줄은 이 글이 무슨 글로 읽히는지부터 짚는다 — 증상 말고 병명이다.\n` +
        `rewrites 의 첫 번째는 그 진단을 문장 하나로 해결하는 자리를 고른다.\n` +
        `fix 는 학생이 못 본 각도를 보여주는 자리다 — 다시 구성해도 좋다. 단어 몇 개만 바꾸지 마라.\n` +
        `단 '다시 구성'은 배열·표현을 바꾸는 것이지 없던 내용을 만드는 게 아니다. ` +
        `학생이 쓰지 않은 새 제안·새 업무를 만들어 넣지 마라(객실승무원 지원서다 — 게이트·수속·정비 업무 금지).\n` +
        `직무가 어긋나면 이름표("기내 서비스")를 붙여 맞춰 놓지 말고 improvements 에서 정면으로 짚어라.\n` +
        `재료는 학생이 쓴 사실만 쓰고, 어휘와 정서는 학생 것을 남긴다.` +
        // ⚠️ 마지막에 읽는 지시가 가장 세게 먹는다(2026-08-14b 교훈) — 분량 지시도 여기서 못 박는다.
        (lenLine ? `\n목표 분량(약 ${targetSec}초)을 지켜라 — 글이 그보다 길면 improvements 에서 ` +
          `어느 대목을 덜어낼지 짚고, fix 도 그 분량 감각으로 짧게 써라. ` +
          `분량을 맞추려고 없던 내용을 만들거나 사실을 뭉개지 마라.` : ''),
    }],
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error('anthropic error (polish)', res.status, await res.text())
    throw new Error('ai_failed')
  }
  const data = await res.json()
  if (data.stop_reason === 'refusal') throw new Error('ai_refused')
  const raw = (data.content || []).filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text).join('').trim()
  if (!raw) throw new Error('ai_empty')
  let parsed: Partial<PolishOut>
  try { parsed = JSON.parse(raw) } catch { throw new Error('ai_bad_json') }
  return {
    strengths: (parsed.strengths ?? []).slice(0, MAX_POINTS),
    improvements: (parsed.improvements ?? []).slice(0, MAX_POINTS),
    rewrites: (parsed.rewrites ?? []).slice(0, MAX_REWRITES),
    usage: data.usage ?? {},
  }
}

/**
 * 검사 기록 저장 — 맥락 컬럼 미적용 환경 방어.
 *
 * ⚠️ `question`·`doc_kind` 는 마이그레이션 `20260725160000_ai_killer_context.sql` 이 있어야
 *    존재한다. 미적용이면 PostgREST 가 **insert 를 통째로 거절**해 검사 기록이 전부 유실된다 —
 *    맥락 두 칸 때문에 본체를 잃는 셈이라, 실패하면 그 두 칸을 빼고 한 번 더 넣는다.
 *    (CLAUDE.md 의 '새 컬럼을 공용 select 에 넣지 말 것'과 같은 방어. 여기선 insert 쪽이다.)
 */
async function saveCheck(admin: SB, row: Record<string, unknown>) {
  const { error } = await admin.from('ai_killer_checks').insert(row)
  if (!error) return null
  if (row.question == null && row.doc_kind == null) return error   // 맥락이 없으면 그 문제가 아니다
  const { question: _q, doc_kind: _k, ...bare } = row
  const { error: retryErr } = await admin.from('ai_killer_checks').insert(bare)
  if (!retryErr) console.error('맥락 컬럼 없음(20260725160000 미적용) — 문항·종류를 빼고 저장했다:', error.message)
  return retryErr
}

// =============================================================================
// 진입점
// =============================================================================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // ⚠️ req.json() 은 **한 번만** 읽을 수 있다. 프로브가 먼저 읽어야 하므로 여기서 한 번 읽고
  //    아래 본 흐름은 이 값을 재사용한다(try 안에서 다시 읽으면 빈 객체가 된다).
  // deno-lint-ignore no-explicit-any
  const reqBody: any = await req.json().catch(() => ({}))

  // ── 배포 확인용 프로브 — 로그인 없이 '지금 무엇이 올라가 있는지'만 알려준다 ────────
  // ⚠️ 이게 없으면 밖에서는 함수 버전을 알 방법이 전혀 없다(로그인 게이트라 늘 401,
  //    airline_profiles 는 RLS 로 막혀 개수도 안 보인다). 실제로 배포 여부를 확인하지 못해
  //    관리자에게 SQL 을 여러 번 돌리게 한 자리다.
  // 노출하는 것은 **버전·기능 이름·개수**뿐이다 — 사전도 프로필 내용도 나가지 않는다.
  if ((reqBody as { probe?: unknown }).probe === true) {
    let airlines: number | null = null
    let terms: number | null = null
    let coachTerms: number | null = null
    let polishTable: number | null = null
    let quickfixTable: number | null = null
    try {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const a = await admin.from('airline_profiles').select('code', { count: 'exact', head: true })
      airlines = a.count ?? null
      const t = await admin.from('ai_killer_terms').select('id', { count: 'exact', head: true }).eq('active', true)
      terms = t.count ?? null
      // 연구진 기준 개수 — admin '감점 사전' 탭으로 쌓이는 자산. 0이면 아직 임시 시드만 있는 것.
      const ct = await admin.from('ai_killer_terms').select('id', { count: 'exact', head: true })
        .eq('active', true).eq('origin', 'coach')
      coachTerms = ct.count ?? null
      // 첨삭 표 — null 이면 20260730130000 마이그레이션 미적용(첨삭만 '준비 중'으로 degrade)
      const p = await admin.from('answer_polishes').select('id', { count: 'exact', head: true })
      polishTable = p.error ? null : (p.count ?? 0)
      // 미니 다듬기 수집함 — null 이면 20260731120000 미적용(위젯이 '준비 중'으로 degrade)
      const qf = await admin.from('expression_reports').select('id', { count: 'exact', head: true })
      quickfixTable = qf.error ? null : (qf.count ?? 0)
    } catch (_) { /* 표가 아직 없으면 null 로 둔다 */ }
    return json({
      fn: 'ai-killer',
      version: FN_VERSION,
      features: FN_FEATURES,
      airline_profiles: airlines,   // 4면 제주·에프·이스타·티웨이가 다 들어간 것
      terms: terms,
      coach_terms: coachTerms,      // 연구진 기준 표현 수 — 0이면 아직 임시 시드만(자산 미유입)
      polish_table: polishTable,    // null=마이그레이션 미적용 / 숫자=지금까지 쌓인 첨삭 수
      quickfix_table: quickfixTable, // null=20260731120000 미적용 / 숫자=쌓인 제보 수
      model: MODEL,
      has_api_key: !!Deno.env.get('ANTHROPIC_API_KEY'),
    })
  }

  // member 를 같이 들고 다닌다 — 환급은 service_role 로 부르므로 auth.uid() 가 없다.
  let charged: { tool: string; ref: string; member: string } | null = null
  let supa: SB | null = null

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY 미설정' }, 500)

    // ── 1. 로그인 확인 ────────────────────────────────────────────────────
    // anon 키 + 사용자 JWT — RPC 안의 auth.uid() 가 이 사용자로 잡힌다(sojae-chat 과 같은 패턴).
    supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
    )
    const { data: { user } } = await supa.auth.getUser()
    if (!user) return json({ error: '로그인이 필요합니다' }, 401)

    // 쓰기 전용 클라이언트 — 사전 조회와 검사 기록 저장은 service role 만 가능(RLS)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // ══════════════════════════════════════════════════════════════════════
    // 미니 다듬기(quickfix) 분기 — mode:'quickfix' (2026-07-31). 여기서 끝나고 반환한다.
    // ⚠️ 반드시 킬러의 길이 검증·자동 저장(2-2)보다 **앞**에 있어야 한다 — 뒤에 두면
    //    300자 구간이 답변 저장소에 조각으로 쌓이고, 100자 미만 구간은 검사로 오인돼 죽는다.
    // ⚠️ 구버전 함수에는 이 분기가 없어 mode:'quickfix' 요청이 **킬러 검사로 흘러가
    //    3크레딧이 깎인다** — 그래서 quickfix.js 가 시트를 열 때 프로브로
    //    features.includes('quickfix') 를 확인한다(polish 게이트와 같은 이유 — 지우지 말 것).
    // ══════════════════════════════════════════════════════════════════════
    if (reqBody.mode === 'quickfix') {
      const qtext: string = typeof reqBody.text === 'string' ? reqBody.text.trim() : ''
      const qpage: string | null =
        reqBody.page === 'killer' || reqBody.page === 'answers' || reqBody.page === 'sojae'
          ? reqBody.page : null
      // ⚠️ 예상 가능한 실패는 전부 HTTP 200 + code — non-2xx 면 supabase-js 가 본문을
      //    감춰 화면이 사유(한도·길이)를 못 띄운다(sojae 차감 규칙과 같은 이유).
      if (qtext.length < QF_MIN_CHARS) {
        return json({ error: `${QF_MIN_CHARS}자 이상 넣어 주세요`, code: 'too_short' }, 200)
      }
      if (qtext.length > QF_MAX_CHARS) {
        return json({ error: `한 번에 ${QF_MAX_CHARS}자까지 다듬을 수 있어요`, code: 'too_long' }, 200)
      }

      // ── q-1. 하루 한도(서울 자정 리셋) — expression_reports 행 수로 센다 ──
      // ⚠️ UTC 자정으로 두면 한국 오전 9시에 초기화된다(credit 하루 무료와 같은 함정).
      const seoulDayStartUtc = new Date(
        Math.floor((Date.now() + 9 * 3600_000) / 86400_000) * 86400_000 - 9 * 3600_000,
      ).toISOString()
      const dc = await admin.from('expression_reports')
        .select('id', { count: 'exact', head: true })
        .eq('member_id', user.id).gte('created_at', seoulDayStartUtc)
      // ⚠️ count 실패 = 표 미생성(20260731120000 미적용). 무시하고 진행하면 한도를 못
      //    세는 채로 저장까지 실패한다 — 반드시 여기서 멈춘다(polish p-1 과 같은 게이트).
      if (dc.error) {
        return json({ error: '다듬기 준비가 아직 안 됐어요. 잠시 뒤 다시 시도해 주세요.', code: 'not_ready' }, 200)
      }
      const usedToday = dc.count ?? 0
      if (usedToday >= QF_DAILY) {
        return json({
          error: `오늘 무료 다듬기 ${QF_DAILY}번을 다 썼어요. 내일 다시 열려요.`,
          code: 'daily_limit', remaining: 0,
        }, 200)
      }

      // ── q-2. 사전 로드 — coach 기준 주입 + 자기 출력 재검사에 쓴다 ────────
      const { data: qTermRows } = await admin
        .from('ai_killer_terms').select('term, kind, origin, why').eq('active', true)
      const qTerms = (qTermRows ?? []) as Array<Term & { origin?: string }>
      const qCoach = qTerms.filter((t) => t.origin === 'coach' && t.term)
      const QF_COACH_CAP = 80   // polish 와 같은 상한 — 사전이 커져도 프롬프트가 안 붓는다
      const qCoachBrief = qCoach.length
        ? `\n\n[몬크 연구진이 감점하는 표현 — 학생 글에 보이면 spotted 에서 우선 짚어라. 네 fixed 에는 절대 쓰지 마라]\n`
          + qCoach.slice(0, QF_COACH_CAP).map((t) => `- "${t.term}"${t.why ? ` — ${t.why}` : ''}`).join('\n')
        : ''

      // ── q-3. Haiku 호출(구조화 출력) + 자기 출력 재검사 ───────────────────
      const qCall = async (regenNote: string) => {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: QF_MODEL,
            max_tokens: QF_MAX_TOKENS,
            // ⚠️ effort 를 넣지 말 것 — Haiku 4.5 미지원(400, sojae 되묻기에서 실측). format 은 지원.
            output_config: { format: { type: 'json_schema', schema: QF_SCHEMA } },
            // 사전 주입은 system 에 — 요청마다 같아 프롬프트 캐시를 탄다(polish 와 동일)
            system: [{ type: 'text', text: QF_VOICE + qCoachBrief + regenNote, cache_control: { type: 'ephemeral' } }],
            messages: [{
              role: 'user',
              content: `[학생이 가져온 구간]\n${qtext}\n\n[할 일]\n위 구간을 다듬고, AI스러운 표현을 짚어라.`,
            }],
          }),
        })
        if (!res.ok) {
          console.error('anthropic error (quickfix)', res.status, await res.text())
          throw new Error('ai_failed')
        }
        const data = await res.json()
        if (data.stop_reason === 'refusal') throw new Error('ai_refused')
        const raw = (data.content || []).filter((b: { type: string }) => b.type === 'text')
          .map((b: { text: string }) => b.text).join('').trim()
        let parsed: { fixed?: string; spotted?: Array<{ term: string; kind: Kind; why: string }> }
        try { parsed = JSON.parse(raw) } catch { throw new Error('ai_bad_json') }
        return {
          fixed: typeof parsed.fixed === 'string' ? parsed.fixed.trim() : '',
          spotted: Array.isArray(parsed.spotted) ? parsed.spotted : [],
          usage: (data.usage ?? {}) as { input_tokens?: number; output_tokens?: number },
        }
      }

      let qOut = await qCall('')
      // 자기 출력 재검사(4겹 고삐 ③) — 고쳐 준 문장은 학생이 그대로 옮겨 쓴다.
      // 상투어가 섞이면 우리가 AI스러움을 심어 주는 꼴이라 한 번 다시 쓴다(polish 와 동일).
      {
        const cliche = qTerms.filter((t) => t.kind === 'cliche' && t.term.length >= 3).map((t) => t.term)
        const bad = cliche.filter((t) => qOut.fixed.includes(t))
        if (bad.length > 0) {
          console.log('self-check hit (quickfix), regenerating:', bad.join(', '))
          qOut = await qCall(
            `\n\n[다시 쓰는 이유]\n방금 네 fixed 에 ${bad.map((b) => `"${b}"`).join(', ')} 가 들어 있었다. ` +
            `학생에게 쓰지 말라는 표현을 네가 쓰면 안 된다. 그 표현들을 빼고 다시 다듬어라.`)
        }
      }
      if (!qOut.fixed) throw new Error('ai_empty')

      // ── q-4. spotted 검증 + 저장 + 반환 ──────────────────────────────────
      // ⚠️ 원문에 실제로 등장하는 표현만 남긴다 — AI 가 지어낸 문자열이 수집함에 쌓이면
      //    사전 후보(자산)가 오염된다(킬러의 '문맥' 자리 검증과 같은 고삐).
      const spotted = qOut.spotted
        .filter((s) => s && typeof s.term === 'string' && s.term.trim().length >= 2 && qtext.includes(s.term))
        .map((s) => ({
          term: s.term.trim(),
          kind: s.kind === 'structure' || s.kind === 'context' ? s.kind : 'cliche',
          why: typeof s.why === 'string' ? s.why.slice(0, 120) : '',
        }))
        .slice(0, QF_MAX_SPOTTED)

      const qu = qOut.usage
      const { error: qSaveErr } = await admin.from('expression_reports').insert({
        member_id: user.id, page: qpage, content: qtext, fixed: qOut.fixed, spotted,
        input_tokens: qu.input_tokens ?? 0, output_tokens: qu.output_tokens ?? 0,
      })
      // 저장이 실패해도 결과는 준다 — 무료 기능이라 제보 한 건 유실이 사용자 실패보다 낫다.
      if (qSaveErr) console.error('quickfix save failed', qSaveErr.message)

      return json({
        ok: true, mode: 'quickfix', fixed: qOut.fixed, spotted,
        remaining: Math.max(QF_DAILY - usedToday - 1, 0),
      })
    }

    // ── 2. 입력 검증 ──────────────────────────────────────────────────────
    // ⚠️ reqBody 는 **위에서 이미 읽었다**(프로브가 먼저 읽어야 하므로).
    //    여기서 req.json() 을 다시 부르면 본문이 소진돼 빈 객체가 되고 — text 가 ''  가 되어
    //    모든 검사가 "100자 이상 넣어 주세요"로 죽는다. 다시 읽지 말 것.
    const text: string = typeof reqBody.text === 'string' ? reqBody.text.trim() : ''
    const source: 'paste' | 'answer' = reqBody.source === 'answer' ? 'answer' : 'paste'
    const answerId: string | null = typeof reqBody.answerId === 'string' ? reqBody.answerId : null
    // ── 맥락 2종(둘 다 선택 입력) — 비면 예전과 똑같이 동작한다 ──────────────
    // ⚠️ **판정에는 쓰지 않는다.** 규칙 4종은 글 자체만 보므로 밑줄 자리·개수·등급은
    //    맥락이 있든 없든 같다. 바뀌는 건 AI 가 채우는 why/fix 문장뿐이다(결정 11·12).
    // 문항 — 답변노트에서 불러온 글은 화면이 questions.content / answers.title 을 실어 보낸다.
    const question: string = typeof reqBody.question === 'string'
      ? reqBody.question.trim().slice(0, MAX_QUESTION_CHARS) : ''
    // 글 종류 — 모르면 지적하는 **말이 반대로 나간다**("말할 때 이렇게 세는 사람은 없어서"를
    // 자소서에 그대로 쓰면 어긋난다). 아는 두 값만 받고 그 외에는 미지정으로 둔다.
    const docKind: 'essay' | 'interview' | null =
      reqBody.docKind === 'essay' || reqBody.docKind === 'interview' ? reqBody.docKind : null
    // 지망 항공사 — 자소서 흐름도, 면접이 보는 결도 항공사마다 다르다.
    // ⚠️ 'all'(만능)은 빈 값과 다르다: 만능은 "어디에나 통하게" 쪽으로 조언이 갈린다.
    const airline: string = typeof reqBody.airline === 'string'
      ? (AIRLINES[reqBody.airline] ? reqBody.airline : (reqBody.airline === 'all' ? 'all' : '')) : ''
    // 말하기 목표 분량(첨삭 전용·선택) — 면접 답변일 때만 뜻이 있다. 아는 세 값만 받고
    // 그 외(빈 값·이상값·자소서)는 0(자유) — 예전과 똑같이 동작한다.
    const targetSec: number = docKind === 'interview'
      && (reqBody.targetSec === 20 || reqBody.targetSec === 30 || reqBody.targetSec === 40)
      ? reqBody.targetSec : 0
    const len = text.length
    if (len < MIN_CHARS) return json({ error: `${MIN_CHARS}자 이상 넣어 주세요`, code: 'too_short' }, 400)
    if (len > MAX_CHARS) return json({ error: `${MAX_CHARS}자까지 검사할 수 있어요`, code: 'too_long' }, 400)

    // 사용처 id 를 **먼저** 만든다 — 차감(3)이 저장(7)보다 앞서므로 그때 이미 ref 가 있어야 한다
    const checkId = crypto.randomUUID()

    // ── 2-2. 붙여넣은 글은 저장소에 넣는다 ────────────────────────────────
    // ⚠️ 검사한 글은 **어디서 왔든 답변 저장소에 모인다**(2026-07-25 재설계).
    //    그래야 이력이 답변에 붙어 쌓이고, "고쳐서 다시 검사"가 성립한다.
    //    차감 **전에** 저장한다 — 저장이 실패하면 차감도 하지 않는다(돈만 나가는 상황 방지).
    // ⚠️ 브라우저가 보낸 answerId 를 그대로 믿지 않는다 — 아래 저장·수정은 service role 이라
    //    RLS 를 통과한다. 남의 답변 id 를 넣으면 그 사람의 글이 덮이고 이력이 오염된다.
    //    **본인 것이 아니면 없는 셈 치고 새로 저장한다**(에러로 막으면 정상 사용도 죽는다 —
    //    답변을 지운 뒤 뒤로가기로 돌아온 경우가 그렇다).
    let targetAnswer: string | null = null
    if (answerId) {
      const { data: own } = await admin.from('answers')
        .select('id').eq('id', answerId).eq('member_id', user.id).maybeSingle()
      if (own) targetAnswer = answerId
      else console.warn('answerId not owned or missing — 새 답변으로 저장한다')
    }
    let autoSaved = false
    if (!targetAnswer) {
      const row: Record<string, unknown> = {
        member_id: user.id, status: 'final',
        title: (question || text.slice(0, 40).replace(/\s+/g, ' ').trim() + '…').slice(0, 200),
        content: text, doc_kind: docKind, airline: airline || null,
      }
      let ins = await admin.from('answers').insert(row).select('id').single()
      if (ins.error) {
        // 분류 3종(20260725170000) 미적용이면 그 칸을 빼고 한 번 더 — 본체는 남긴다
        const { doc_kind: _k, airline: _a, ...bare } = row
        ins = await admin.from('answers').insert(bare).select('id').single()
      }
      if (ins.error) {
        console.error('auto-save failed', ins.error.message)
        return json({ error: '답변을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.', code: 'save_failed' }, 200)
      }
      targetAnswer = (ins.data as { id: string }).id
      autoSaved = true
    }

    // ══════════════════════════════════════════════════════════════════════
    // 첨삭(polish) 분기 — mode:'polish' (2026-07-30). 여기서 끝나고 반환한다.
    // 1(로그인)·2(검증)·2-2(저장소 합류)는 킬러와 완전히 같아 위를 그대로 탄다.
    // ⚠️ 구버전 함수에는 이 분기가 없어 mode:'polish' 요청이 **킬러 검사로 흘러가
    //    3크레딧이 깎인다** — 그래서 polish.html 이 제출 전에 프로브로
    //    features.includes('polish') 를 확인한다. 그 게이트를 지우지 말 것.
    // ══════════════════════════════════════════════════════════════════════
    if (reqBody.mode === 'polish') {
      // ── p-1. 표 존재 확인 + 차감 키 ────────────────────────────────────
      // ⚠️ 이 count 가 실패하면(20260730130000 미적용) 반드시 **차감 전에** 멈춘다.
      //    무시하고 진행하면 prevPolishes 가 늘 0 → 차감 키가 늘 같아 두 번째부터
      //    spend_credit 이 'already' 로 통과 — 첨삭이 영영 공짜가 되는 돈 버그다.
      const pc = await admin.from('answer_polishes')
        .select('id', { count: 'exact', head: true })
        .eq('member_id', user.id).eq('answer_id', targetAnswer)
      if (pc.error) {
        return json({ error: '첨삭 준비가 아직 안 됐어요. 잠시 뒤 다시 시도해 주세요.', code: 'not_ready' }, 200)
      }
      const prevPolishes = pc.count ?? 0
      // ⚠️ 묶음 없이 매 회 새 키 — 첨삭은 재검사 무차감이 없다(상수 주석 참조).
      //    같은 키 재호출(네트워크 재전송·이중 탭)만 'already' 로 이중 차감을 막는다.
      const polishRef = `${targetAnswer}#p${prevPolishes}`
      const polishId = crypto.randomUUID()

      const { data: spentRaw2, error: spendErr2 } = await supa.rpc('spend_credit', {
        p_tool: 'polish', p_ref: polishRef, p_free_ref: null,
      })
      const spent2 = spentRaw2 as
        { used?: string; cost?: number; balance?: number; daily_left?: number } | null
      if (spendErr2) {
        const msg = String(spendErr2.message || '')
        if (msg.includes('no_credit')) {
          return json({
            error: '크레딧이 모자라요. 충전하면 바로 첨삭받을 수 있어요.',
            code: 'no_credit', answerId: targetAnswer, autoSaved,
          }, 200)
        }
        console.error('spend_credit failed (polish)', msg)
        return json({ error: '첨삭을 시작하지 못했어요', code: 'spend_failed' }, 500)
      }
      charged = { tool: 'polish', ref: polishRef, member: user.id }

      // ── p-2. 사전·항공사 프로필 로드 + AI 호출 ─────────────────────────
      // 사전은 한 번만 읽어 두 군데(코치 기준 주입 + 자기 출력 재검사)에 쓴다.
      const { data: termRows2 } = await admin
        .from('ai_killer_terms').select('term, kind, origin, why').eq('active', true)
      const allTerms2 = (termRows2 ?? []) as Array<Term & { origin?: string }>

      // ⚠️ 연구진 기준(coach) 주입 — admin '감점 사전' 탭에 쌓이는 표현을 첨삭 AI 의
      //    감점 기준으로 가르친다(2026-07-30 오너 지시 "이 데이터를 학습해서").
      //    킬러는 이 표를 문자열 검출에 직접 쓰지만, 첨삭은 문자열 일치를 넘어
      //    '이런 습관 자체'를 고치라고 시키는 자리라 프롬프트로 넣는다.
      //    coach 만 넣는 이유: general 시드는 어차피 AI 도 아는 뻔한 상투어라
      //    프롬프트 자리만 차지한다 — 몬크만 아는 기준이 이 주입의 값어치다.
      const COACH_CAP = 80   // 사전이 커져도 프롬프트가 무한히 붓지 않게(원가 상한)
      const coach2 = allTerms2.filter((t) => t.origin === 'coach' && t.term)
      if (coach2.length > COACH_CAP) console.log('coach terms capped:', coach2.length, '->', COACH_CAP)
      const coachBrief = coach2.length
        ? `\n\n[몬크 연구진이 감점하는 표현 — 3,500명을 가르치며 쌓은 기준]\n`
          + coach2.slice(0, COACH_CAP).map((t) => `- "${t.term}"${t.why ? ` — ${t.why}` : ''}`).join('\n')
          + `\n(학생 글에 이 표현이나 같은 습관이 보이면 improvements·rewrites 에서 우선 다뤄라. `
          + `네 문장에는 절대 쓰지 마라.)`
        : ''

      const { brief: airBrief2, qMatched: qm2 } = await airlineBrief(admin, airline, question)
      if (qm2 === false) console.log('airline question mismatch (polish):', airline, '|', question.slice(0, 60))

      let rep = await polishFill(apiKey, text, question, docKind, targetSec, airline, airBrief2, coachBrief, '')

      // ── p-3. 자기 출력 재검사 — 상투어 사전을 첨삭 문장에도 돌린다(4겹 고삐 ③) ──
      // ⚠️ 첨삭에서 이게 더 절실하다: fix 는 학생이 **그대로 옮겨 쓸 수도 있는** 문장이라,
      //    여기에 상투어가 섞이면 우리가 학생 글에 AI스러움을 심어 주는 꼴이 된다.
      {
        const cliche2 = allTerms2
          .filter((t) => t.kind === 'cliche').map((t) => t.term)
        const mine = [
          ...rep.strengths.map((s) => s.note),
          ...rep.improvements.flatMap((s) => [s.note, s.how]),
          ...rep.rewrites.flatMap((s) => [s.fix, s.why]),
        ].join(' ')
        const bad2 = cliche2.filter((t) => t.length >= 3 && mine.includes(t))
        if (bad2.length > 0) {
          console.log('self-check hit (polish), regenerating:', bad2.join(', '))
          rep = await polishFill(apiKey, text, question, docKind, targetSec, airline, airBrief2, coachBrief,
            `\n\n[다시 쓰는 이유]\n방금 네 첨삭에 ${bad2.map((b) => `"${b}"`).join(', ')} 가 들어 있었다. ` +
            `학생에게 쓰지 말라고 하는 표현을 네가 쓰면 안 된다. 그 표현들을 빼고 다시 채워라.`)
        }
      }
      // 리포트가 통째로 비면 상품이 아니다 — 실패로 던져 환급한다
      if (rep.rewrites.length === 0 && rep.improvements.length === 0) throw new Error('ai_empty')

      // ── p-4. 저장 + 답변 동기화 + 반환 ─────────────────────────────────
      const u2 = rep.usage
      const { error: saveErr2 } = await admin.from('answer_polishes').insert({
        id: polishId, member_id: user.id, source, answer_id: targetAnswer, content: text,
        question: question || null, doc_kind: docKind, airline: airline || null,
        // target_sec 은 result jsonb 안에 넣는다 — 컬럼을 늘리지 않고 이력 복원(?polish=)까지 살린다
        result: {
          strengths: rep.strengths, improvements: rep.improvements, rewrites: rep.rewrites,
          ...(targetSec ? { target_sec: targetSec } : {}),
        },
        char_count: len, input_tokens: u2.input_tokens ?? 0, output_tokens: u2.output_tokens ?? 0,
      })
      // 저장이 실패해도 리포트는 이미 나왔다 — 결과는 돌려주고 환급하지 않는다(킬러와 동일)
      if (saveErr2) console.error('polish save failed', saveErr2.message)

      // ⚠️ 저장소의 그 답변도 방금 첨삭한 글로 맞춘다(킬러와 같은 이유 — 다음 검사가 옛 글로 안 돌아가게)
      if (targetAnswer && !autoSaved) {
        const stamp = new Date().toISOString()
        const patch: Record<string, unknown> = { content: text, updated_at: stamp }
        if (docKind) patch.doc_kind = docKind
        if (airline) patch.airline = airline
        const up2 = await admin.from('answers').update(patch)
          .eq('id', targetAnswer).eq('member_id', user.id)
        if (up2.error) {
          await admin.from('answers').update({ content: text, updated_at: stamp })
            .eq('id', targetAnswer).eq('member_id', user.id)
        }
      }

      return json({
        ok: true, id: polishId, mode: 'polish',
        strengths: rep.strengths, improvements: rep.improvements, rewrites: rep.rewrites,
        char_count: len, answerId: targetAnswer, autoSaved,
        target_sec: targetSec || undefined,   // 리포트 머리 '30초 분량 기준' 표시용(0=자유는 안 싣는다)
        used: spent2?.used, cost: spent2?.cost, balance: spent2?.balance, daily_left: spent2?.daily_left,
      })
    }

    // ── 3. 차감 (무료 판정·차감이 한 트랜잭션·같은 lock 안) ────────────────
    // ⚠️ 차감 키가 **검사 id 가 아니라 답변 id 묶음**이다. 같은 답변을 MAX_RECHECK 번까지는
    //    같은 키로 부르므로 spend_credit 이 used='already' 로 통과시켜 추가 차감이 없다.
    //    3번째부터 묶음 번호가 올라가 새로 차감된다.
    let prevChecks = 0
    {
      const { count } = await admin.from('ai_killer_checks')
        .select('id', { count: 'exact', head: true })
        .eq('member_id', user.id).eq('answer_id', targetAnswer)
      prevChecks = count ?? 0
    }
    const payRef = `${targetAnswer}#${Math.floor(prevChecks / MAX_RECHECK)}`

    const { data: spentRaw, error: spendErr } = await supa.rpc('spend_credit', {
      p_tool: 'ai_killer', p_ref: payRef, p_free_ref: null,
    })
    const spent = spentRaw as
      { used?: string; cost?: number; balance?: number; daily_left?: number } | null
    if (spendErr) {
      const msg = String(spendErr.message || '')
      if (msg.includes('no_credit')) {
        return json({
          error: '크레딧이 모자라요. 충전하면 바로 이어서 검사할 수 있어요.',
          code: 'no_credit', answerId: targetAnswer, autoSaved,
        }, 200)
      }
      console.error('spend_credit failed', msg)
      return json({ error: '검사를 시작하지 못했어요', code: 'spend_failed' }, 500)
    }
    charged = { tool: 'ai_killer', ref: payRef, member: user.id }

    // ── 4. 사전 로드 — **판정이 아니라 자기 출력 재검사용**(2026-08-12 판정 교체) ─────
    // 우리 문장(why/fix)에 상투어가 섞이면 학생에게 금지한 말을 우리가 쓰는 꼴이라,
    // 사전의 cliche 를 AI 출력에 돌려 걸리면 한 번 다시 쓰게 한다(첨삭·다듬기와 같은 장치).
    const { data: termRows } = await admin
      .from('ai_killer_terms').select('term, kind').eq('active', true)
    const clicheOnly = ((termRows ?? []) as Array<{ term: string; kind: string }>)
      .filter((t) => t.kind === 'cliche' && t.term && t.term.length >= 3)
      .map((t) => t.term)

    // ── 5. 종합 판정(오너 지침 4기준 · 의심 지수 %) + 인용 검증 ──────────────
    // ⚠️ 인용(quote)은 **원문에 실제로 있는 문자열일 때만** 밑줄이 된다 — AI 가 문장을
    //    지어내면 밑줄이 엉뚱한 자리에 그어진다. 위치(start/end)는 서버가 계산한다.
    const buildHits = (found: KFinding[]): Hit[] => {
      const taken: Array<[number, number]> = []
      const out: Hit[] = []
      for (const f of found) {
        const q = (f.quote || '').trim()
        if (q.length < 4) continue
        const i = text.indexOf(q)
        if (i < 0) continue
        const j = i + q.length
        if (overlaps(taken, i, j)) continue
        taken.push([i, j])
        out.push({
          n: 0, kind: CRIT_KIND[f.crit] ?? 'cliche', quote: q, start: i, end: j,
          why: typeof f.why === 'string' ? f.why : '', fix: typeof f.fix === 'string' ? f.fix : '',
        })
      }
      out.sort((a, b) => a.start - b.start)
      return out
    }

    let judged = await judgeText(apiKey, text, question, docKind, airline, '')
    let hits = buildHits(judged.findings)

    // ── 6. 다시 쓰게 하는 조건 둘(1회) ────────────────────────────────────
    //   ① 지수는 높은데 인용이 전부 원문 밖 — 근거 없는 지수는 반쪽짜리 결과다
    //   ② 우리 문장에 상투어 — 학생 글을 재는 잣대로 우리 말도 잰다(4겹 고삐 ③)
    {
      const mine = [
        ...judged.findings.flatMap((f) => [f.why ?? '', f.fix ?? '']),
        ...judged.greens.map((f) => f.why ?? ''),
      ].join(' ')
      const bad = clicheOnly.filter((t) => mine.includes(t))
      const quotesLost = judged.findings.length > 0 && hits.length === 0 && judged.probability >= 40
      if (bad.length > 0 || quotesLost) {
        const notes: string[] = []
        if (quotesLost) notes.push('방금 quote 가 전부 원문에 없는 문자열이었다. 학생 글에 있는 그대로의 문장만 발췌하라.')
        if (bad.length > 0) {
          notes.push(`방금 네 문장에 ${bad.map((b) => `"${b}"`).join(', ')} 가 들어 있었다. ` +
            '학생에게 쓰지 말라는 표현을 네가 쓰면 안 된다. 그 표현들을 빼고 다시 써라.')
        }
        console.log('self-check hit, regenerating:', notes.join(' / '))
        judged = await judgeText(apiKey, text, question, docKind, airline,
          `\n\n[다시 쓰는 이유]\n${notes.join(' ')}`)
        hits = buildHits(judged.findings)
      }
    }

    const truncated = Math.max(hits.length - MAX_FINDINGS, 0)
    if (truncated > 0) hits.length = MAX_FINDINGS
    hits.forEach((h, i) => { h.n = i + 1 })
    const probability = judged.probability

    // 그린 플래그(인간미 보존 영역) — 레드 플래그와 같은 검증: 원문에 실존하는 문자열만,
    // 밑줄끼리 겹치면 버린다(레드가 우선 — 고칠 곳을 짚는 게 이 도구의 본업이다).
    const gTaken: Array<[number, number]> = hits.map((h) => [h.start, h.end] as [number, number])
    const greens: Array<{ quote: string; why: string; start: number; end: number }> = []
    for (const f of judged.greens) {
      if (greens.length >= MAX_GREENS) break
      const q = (f.quote || '').trim()
      if (q.length < 4) continue
      const i = text.indexOf(q)
      if (i < 0) continue
      const j = i + q.length
      if (overlaps(gTaken, i, j)) continue
      gTaken.push([i, j])
      greens.push({ quote: q, why: typeof f.why === 'string' ? f.why : '', start: i, end: j })
    }
    greens.sort((a, b) => a.start - b.start)

    // ── 7. 저장 + 반환 ────────────────────────────────────────────────────
    // ⚠️ result 는 { p, hits } 로 저장한다 — 새 컬럼 없이 의심 지수를 남기는 방법이라
    //    마이그레이션이 필요 없다. 구 기록은 배열 그대로라, 화면 복원이 두 모양을 다 읽는다.
    const g = gradeOfProbability(probability)
    const u = judged.usage as { input_tokens?: number; output_tokens?: number }
    const saveErr = await saveCheck(admin, {
      id: checkId, member_id: user.id, source, answer_id: targetAnswer, content: text,
      question: question || null, doc_kind: docKind,
      result: { p: probability, hits, greens }, grade: g, hit_count: hits.length, char_count: len,
      input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0,
    })
    // 저장이 실패해도 검사는 이미 끝났다 — 결과는 돌려주고 환급은 하지 않는다
    // (사용자는 답을 받았으므로. 기록만 유실되며 로그로 추적한다).
    if (saveErr) console.error('save failed', saveErr.message)

    // ⚠️ 저장소의 그 답변도 방금 검사한 글로 맞춰 둔다. 학생이 고친 글을 붙여 넣고
    //    "다시 검사"를 눌렀는데 저장소가 옛 글을 들고 있으면, 다음 검사가 옛 글로 돌아간다.
    if (targetAnswer && !autoSaved) {
      const stamp = new Date().toISOString()
      const patch: Record<string, unknown> = { content: text, updated_at: stamp }
      if (docKind) patch.doc_kind = docKind
      if (airline) patch.airline = airline
      const up = await admin.from('answers').update(patch)
        .eq('id', targetAnswer).eq('member_id', user.id)
      if (up.error) {
        // 분류 컬럼(20260725170000) 미적용 — 본문만이라도 맞춰 둔다
        await admin.from('answers').update({ content: text, updated_at: stamp })
          .eq('id', targetAnswer).eq('member_id', user.id)
      }
    }

    return json({
      ok: true, id: checkId, grade: g, probability, hits, greens,
      spot_count: hits.length, char_count: len,
      // 상한(MAX_FINDINGS)에 걸려 잘렸으면 알린다 — 조용히 자르지 않는다
      truncated, answerId: targetAnswer, autoSaved,
      // 이 답변에 남은 무차감 재검사 횟수(화면이 "마지막 무차감 검사예요"를 말할 근거)
      recheck_left: Math.max(MAX_RECHECK - (prevChecks % MAX_RECHECK) - 1, 0),
      used: spent?.used, cost: spent?.cost, balance: spent?.balance, daily_left: spent?.daily_left,
    })
  } catch (e) {
    // ⚠️ 차감했는데 결과를 못 준 경우 반드시 되돌린다.
    //    유료는 refund 행 추가, 무료는 free_use 행 삭제(한도 복구) — RPC 가 알아서 나눈다.
    // ⚠️ 환급은 **service_role 로만** 부른다(2026-08-04). 사용자 JWT 로 부르던 구 방식은
    //    같은 RPC 를 브라우저에도 열어 둬야 해서, 학생이 결과를 받은 뒤 스스로 환급해
    //    유료 기능을 공짜로 쓸 수 있었다. 대상 회원은 charged.member 가 들고 있다.
    // ⚠️ 마이그레이션 20260804150000 이 먼저 적용돼 있어야 한다 — 없으면 환급이 실패해
    //    학생이 크레딧을 잃는다(로그로만 남는다).
    if (charged) {
      const adminRef = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )
      const { error } = await adminRef.rpc('refund_credit_for', {
        p_member: charged.member, p_tool: charged.tool, p_ref: charged.ref,
      })
      if (error) console.error('refund failed', error.message, charged.ref)
    }
    const msg = String((e as Error)?.message || '')
    console.error('ai-killer error', msg)
    const mode = (reqBody as { mode?: unknown }).mode
    // 미니 다듬기는 무료 분기 — 차감이 없었으니 '크레딧을 돌려드렸다'고 말하면 거짓이 된다
    if (mode === 'quickfix') {
      if (msg === 'ai_refused') {
        return json({ error: '이 글은 다듬을 수 없어요. 다른 구간으로 시도해 주세요.', code: 'refused' }, 200)
      }
      return json({ error: '다듬기에 실패했어요. 잠시 뒤 다시 시도해 주세요.', code: 'failed' }, 200)
    }
    // 첨삭 분기에서 던져졌으면 문구도 첨삭으로 — '검사에 실패'라고 하면 학생이 딴 도구 이야기로 읽는다
    const act = mode === 'polish' ? '첨삭' : '검사'
    if (msg === 'ai_refused') {
      return json({ error: `이 글은 ${act}할 수 없어요. 다른 글로 시도해 주세요.`, code: 'refused', refunded: true }, 200)
    }
    return json({ error: `${act}에 실패했어요. 크레딧은 돌려드렸습니다.`, code: 'failed', refunded: true }, 200)
  }
})
