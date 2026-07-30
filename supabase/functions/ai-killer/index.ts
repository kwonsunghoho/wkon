// =============================================================================
// Supabase Edge Function: ai-killer — 자소서·답변의 'AI 문체' 검사 (2026-07-25)
//                         + 첨삭(mode:'polish') — 강점·보완점·문장 첨삭 (2026-07-30)
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
// 처리 순서(확정본 '서버' 절 그대로)
//   1 로그인 확인 → 2 길이 검증 → 3 무료분 판정+차감 → 4 규칙 검사
//   → 5 Claude 호출(칸만 채움) → 6 자기 출력 재검사 → 7 저장+반환
//   ⚠️ 3번에서 막히면 아래로 안 간다. 5~7 중 실패하면 반드시 환급(refund_credit).
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
const FN_VERSION = '2026-07-31a'
const FN_FEATURES = [
  'context',          // 문항·종류 맥락
  'airline',          // 지망 항공사
  'airline_profiles', // 항공사별 합격 패턴 참조
  'question_match',   // 문항이 바뀌었는지 판정 → 옛 주의사항 차단
  'autosave',         // 붙여넣은 글을 답변 저장소에 자동 저장
  'credit_tiers',     // 도구별 단가(소재2/킬러3/첨삭10) + 답변 단위 차감
  'polish',           // 첨삭 — mode:'polish' 로 강점·보완점·문장 첨삭 리포트(2026-07-30)
  'coach_terms',      // 감점 사전의 연구진(coach) 표현을 첨삭 AI 감점 기준으로 주입(2026-07-30b)
]

// 모델 — 확정본 초안은 Opus 4.8 이었으나 **같은 가격($5/$25)의 상위 모델**인 Opus 5 를 쓴다.
// 저장소의 다른 함수도 이미 Claude 5 계열(sojae-chat: sonnet-5 / haiku-4-5).
const MODEL = 'claude-opus-5'
// ⚠️ Opus 5 는 thinking 이 기본 ON 이고 max_tokens 가 **thinking + 응답을 합쳐** 자른다.
//    칸 10개 채우는 데 출력은 1천 토큰이면 족하지만 여유를 크게 준다(잘리면 통째로 실패).
const MAX_TOKENS = 8000
// 원가 조절 손잡이. 자리는 규칙이 이미 확정했고 AI 는 정해진 칸만 채우므로 medium 으로 시작한다.
// ⑤단계 원가 실측에서 말투 품질이 모자라면 'high' 로 올릴 것(ai_killer_checks 의 토큰 기록 참조).
const EFFORT = 'medium'

// AI 가 추가로 지목할 수 있는 '문맥' 자리 상한(확정본: 최대 3곳)
const MAX_CONTEXT_EXTRA = 3

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

// ⚠️ 화면에 그릴 지적 상한. 371자 실측에서 15곳이 나왔으므로 1,500자면 60곳까지 가능하다 —
//    밑줄 60개는 원문이 안 읽히고, AI 에게 채우라고 할 칸도 60개가 되어 원가가 튄다.
//    **등급은 자른 게 아니라 실제 개수로 매긴다**(자르고 등급까지 낮추면 거짓말이 된다).
//    자른 경우 응답에 truncated 를 실어 화면이 "많아서 앞의 N곳만" 이라고 말할 수 있게 한다.
const MAX_HITS = 24

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

type Kind = 'cliche' | 'structure' | 'vague' | 'context'
type Term = { term: string; kind: Kind; why: string | null }
type Hit = { n: number; kind: Kind; quote: string; start: number; end: number; why?: string; fix?: string }

// =============================================================================
// 규칙 엔진 (④단계) — 자리는 규칙이 찍고, 말은 AI 가 한다
// =============================================================================
// ⚠️ AI 에게 자리까지 고르게 두면 없는 걸 지어낸다(4겹 고삐 ②).
//    아래에서 확정한 span 만 AI 에게 넘기고, AI 는 why/fix 칸만 채운다.
//    예외는 '문맥' 한 종류뿐이고 그마저 **원문에 실제로 있는 문자열인지 서버가 검증**한다.

/** 겹치는 밑줄 방지 — 이미 잡힌 구간과 겹치면 버린다(밑줄이 포개지면 화면이 깨진다) */
function overlaps(taken: Array<[number, number]>, s: number, e: number) {
  return taken.some(([a, b]) => s < b && e > a)
}

/**
 * 사전 기반 탐색 — 한국어는 단어 경계가 없어 indexOf 로 전부 훑는다.
 *
 * ⚠️ **밑줄과 개수를 분리한다**(2026-07-25 dry-run 에서 발견한 구조적 문제).
 *   - 밑줄(Hit): 같은 표현이 일곱 번 나와도 **처음 한 번만** 긋는다. 다 그으면 밑줄밭이 된다.
 *   - 개수(occurrences): **나온 만큼 전부 센다.** "~을 통해"가 일곱 번인 글은 한 번인 글보다
 *     실제로 더 AI스럽기 때문이다.
 *   둘을 묶어 두면 글이 길수록 밀도가 인위적으로 낮아져, 통짜 AI 자소서 1,500자가
 *   '조금 티남'으로 나온다(실측 확인). 밑줄은 화면 문제, 개수는 측정 문제 — 같이 두면 안 된다.
 */
function findTerms(text: string, terms: Term[], taken: Array<[number, number]>) {
  const out: Hit[] = []
  let occurrences = 0
  for (const t of terms) {
    if (!t.term) continue
    let from = 0
    let first = true
    for (;;) {
      const i = text.indexOf(t.term, from)
      if (i < 0) break
      const j = i + t.term.length
      from = j
      if (overlaps(taken, i, j)) continue
      // 모든 등장을 taken 에 넣는다 — 짧은 표현이 긴 표현 안쪽을 다시 세는 걸 막는다
      taken.push([i, j])
      occurrences++
      if (first) {
        out.push({ n: 0, kind: t.kind, quote: t.term, start: i, end: j, why: t.why ?? undefined })
        first = false
      }
    }
  }
  return { hits: out, occurrences }
}

/** 문장 분리 — 마침표/물음표/느낌표 + 줄바꿈. 구조 판정의 기본 단위 */
function splitSentences(text: string) {
  const out: Array<{ text: string; start: number }> = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const isEnd = c === '.' || c === '!' || c === '?' || c === '\n'
    if (!isEnd) continue
    const seg = text.slice(start, i + 1)
    if (seg.trim().length > 0) out.push({ text: seg.trim(), start })
    start = i + 1
  }
  const tail = text.slice(start)
  if (tail.trim().length > 0) out.push({ text: tail.trim(), start })
  return out
}

/**
 * 어미 반복 — 모든 문장이 같은 소리로 끝나는가.
 * 사람 글과 AI 글의 가장 뚜렷한 차이 중 하나(확정본 '정형 구조').
 * 문장 끝 4글자(마침표 제외)를 키로 세고, 4문장 이상에서 절반 넘게 같으면 잡는다.
 */
function findEndingRepeat(sents: Array<{ text: string; start: number }>, taken: Array<[number, number]>): Hit | null {
  if (sents.length < 4) return null
  const counts = new Map<string, number[]>()
  sents.forEach((s, idx) => {
    const body = s.text.replace(/[.!?\s]+$/, '')
    if (body.length < 5) return
    const key = body.slice(-4)
    if (!counts.has(key)) counts.set(key, [])
    counts.get(key)!.push(idx)
  })
  let best: { key: string; idxs: number[] } | null = null
  for (const [key, idxs] of counts) if (!best || idxs.length > best.idxs.length) best = { key, idxs }
  if (!best || best.idxs.length < 3 || best.idxs.length * 2 <= sents.length) return null

  // 밑줄은 첫 번째 등장 문장의 어미에만 긋는다(전부 그으면 글이 밑줄밭이 된다)
  const s = sents[best.idxs[0]]
  const body = s.text.replace(/[.!?\s]+$/, '')
  const off = s.start + s.text.indexOf(body) + body.length - best.key.length
  const end = off + best.key.length
  if (overlaps(taken, off, end)) return null
  taken.push([off, end])
  return {
    n: 0, kind: 'structure', quote: best.key, start: off, end,
    why: `어미 '${best.key}'가 ${best.idxs.length}번 반복돼요. 모든 문장이 같은 소리로 끝나면 듣는 내내 단조롭게 들려요.`,
  }
}

/**
 * 문장 길이 균일성 — 길이가 지나치게 고르면 사람이 쓴 글이 아니다.
 * ⚠️ 밑줄 그을 자리가 없는 판정이라 문단이 아니라 **글 전체**에 붙는 지적으로 돌려준다
 *    (start/end = -1). 화면은 이걸 카드로만 그린다.
 */
function findUniformLength(sents: Array<{ text: string; start: number }>): Hit | null {
  if (sents.length < 5) return null
  const lens = sents.map((s) => s.text.replace(/\s/g, '').length).filter((n) => n > 5)
  if (lens.length < 5) return null
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length
  if (mean < 12) return null
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length)
  if (sd / mean > 0.22) return null   // 편차가 충분하면 사람 글
  return {
    n: 0, kind: 'structure', quote: '문장 길이가 고름', start: -1, end: -1,
    why: `${lens.length}문장의 길이가 거의 같아요(평균 ${Math.round(mean)}자). 사람은 이렇게 고르게 쓰지 않아요.`,
  }
}

/**
 * 구체성 결여 — 숫자·시기·장소가 하나도 없는 문단.
 * ⚠️ 밑줄이 아니라 **문단 단위** 지적이다(확정본).
 * ⚠️ 여기가 오탐이 가장 잘 나는 자리다. 합격자 레퍼런스로 규칙을 깎기 전까지
 *    기준을 느슨하게(=덜 잡게) 둔다 — 멀쩡한 문단에 밑줄을 긋는 게 못 잡는 것보다 나쁘다.
 */
const TIME_PLACE = /(작년|올해|지난|이번|매일|매주|하루|첫날|당시|학기|방학|여름|겨울|봄|가을|아침|저녁|주말|년|개월|주간|시간|분|초|명|번|회|개|잔|건|층|호|점|월|일)/
function findVagueParagraphs(text: string): Hit[] {
  const out: Hit[] = []
  let cursor = 0
  for (const raw of text.split(/\n{1,}/)) {
    const start = text.indexOf(raw, cursor)
    cursor = start + raw.length
    const body = raw.trim()
    if (body.replace(/\s/g, '').length < 60) continue   // 짧은 문단은 판정하지 않는다
    if (/\d/.test(body)) continue                        // 숫자가 하나라도 있으면 통과
    if (TIME_PLACE.test(body)) continue                  // 시기·수량 표현이 있으면 통과
    out.push({
      n: 0, kind: 'vague', quote: body.slice(0, 24), start, end: start + raw.length,
      why: '숫자·시기·장소가 하나도 없어서 누구 이야기여도 말이 되는 문단이에요.',
      fix: '언제, 어디서, 몇 명이었는지 딱 하나만 넣어도 장면이 살아나요.',
    })
  }
  return out
}

/** 등급 — 확정본 결정 5. 100자당 밀도로 판정한다(200자의 3곳과 1000자의 3곳은 다르다) */
function grade(hits: number, chars: number): 'human' | 'slight' | 'heavy' {
  const d = (hits / Math.max(chars, 1)) * 100
  if (d < 1.0) return 'human'
  if (d <= 2.5) return 'slight'
  return 'heavy'
}

// =============================================================================
// Claude 호출 (⑤단계) — AI 는 '칸'만 채운다
// =============================================================================
// ⚠️ 4겹 고삐 ②를 프롬프트가 아니라 **API 스키마로 강제**한다.
//    구조화 출력(output_config.format)이라 인사말·맺음말이 들어갈 자리가 물리적으로 없다.
const SLOT_SCHEMA = {
  type: 'object',
  properties: {
    slots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          why: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['n', 'why', 'fix'],
        additionalProperties: false,
      },
    },
    context_extra: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string' },
          why: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['quote', 'why', 'fix'],
        additionalProperties: false,
      },
    },
  },
  required: ['slots', 'context_extra'],
  additionalProperties: false,
}

// ⚠️ 말투 지침 — 4겹 고삐 ①.
//    "자연스럽게 써"라고 지시하지 말 것. 그 지시 자체가 AI스러운 결과를 낳는다.
//    지금은 연구진 첨삭 자료(오너 자료 2)가 없어 '흉내낼 원본' 대신 규칙으로 버틴다.
//    ⑧단계에서 실제 첨삭 문장을 통째로 넣고 "이 사람처럼 써라"로 바꿀 것 — 이 상수가 그 자리다.
const VOICE = `너는 승무원 면접을 10년 넘게 가르친 코치다. 학생 글에서 'AI 같은 표현'을 짚어 준다.

[네가 채우는 칸]
- why: 왜 별로인지. 반드시 **한 문장**. '~요'로 끝낸다.
- fix: 어떻게 고칠지. 반드시 **한 문장**. 구체적인 행동으로.

[지켜야 할 것]
- 인사말·맺음말·요약·번호매기기를 쓰지 마라. 칸만 채운다.
- 한 문장은 60자를 넘기지 마라.
- 학생을 나무라지 마라. 문제는 표현이지 사람이 아니다.
- "다양한", "첫째/둘째", "~하시길 바랍니다", "~을 통해", "매우", "중요합니다" 같은 말을
  **네 문장에도 쓰지 마라.** 학생 글을 재는 잣대로 네 말도 잰다.
- 모범답안을 대신 써 주지 마라. 학생이 스스로 고칠 방향만 준다.

[문항이 주어졌을 때]
- 문항은 **맥락일 뿐이다.** fix 를 그 문항에 맞게 쓰는 데만 써라.
  (예: 지원동기 문항이면 "왜 하필 이 항공사인지 한 줄", 갈등 경험 문항이면 "그때 실제로 한 말")
- **답변이 문항에 맞는지는 판정하지 마라.** 동문서답·분량·구성은 네 일이 아니다.
  네 일은 AI 같은 표현을 짚는 것 하나뿐이다.

[글 종류가 주어졌을 때]
- **면접 답변**이면 소리 내어 하는 '말'이다. '첫째/둘째' 나열과 '또한·더불어' 같은 문어체
  접속부사는 외운 원고로 들리니 그 점을 짚어라. fix 는 **어떻게 말할지**로 준다.
- **자소서**면 눈으로 읽는 '글'이다. 문단을 정리하는 나열까지 나무라지 마라 —
  글에서는 어색하지 않다. fix 는 **어떤 사실을 문장에 넣을지**로 준다.
- 종류 칸이 없으면 둘 다에서 어색한 것만 짚어라. "말할 때는", "글에서는" 같은
  **한쪽을 전제한 표현을 쓰지 마라.**

[지망 항공사가 주어졌을 때]
- 그 항공사에 맞춰 **fix 의 방향만** 잡아라. 항공사 이름을 굳이 문장에 넣지 마라.
- **없는 사실을 지어내지 마라** — "이 항공사는 이런 인재를 원한다"는 식의 단정은 금지다.

[⚠️ 참고자료를 다루는 법 — 가장 중요하다]
- 아래 '지난 채용 합격 글에서 관찰한 것'은 **참고지 정답이 아니다.**
  **자소서 문항은 채용마다 바뀐다.** 지난 채용 기준으로 이번 글을 재면 학생을 틀린 방향으로
  끌고 간다.
- **학생 글이 자료와 다르면 학생 글이 옳다.** "이 항공사는 이렇게 쓰지 않는다",
  "이 문항은 이렇게 답해야 한다" 같은 단정을 하지 마라. 자료에 없는 형식이라는 이유로
  지적하지 마라.
- 자료는 **빠진 것을 묻는 데만** 쓴다. 예: "이 회사 이야기가 한 줄도 없어요."
  형식을 강요하는 데 쓰지 마라.
- 자료에 "문항에 대한 판단은 하지 마라"는 줄이 있으면 **그 지시가 우선한다.**
- ⚠️ **합격자 문장을 흉내 내라고 하지 마라.** 그러면 지원자들의 글이 전부 같아진다 —
  우리가 잡으려는 AI스러움을 우리가 만드는 꼴이다.`

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

async function fillSlots(
  apiKey: string, text: string, question: string, docKind: 'essay' | 'interview' | null,
  airline: string, airBrief: string, hits: Hit[], regenNote: string,
) {
  // 항공사 — 'all'(만능)은 특정 항공사가 아니라 "어디에나 통해야 한다"는 제약이다.
  const airLine = airline === 'all'
    ? '특정 항공사를 정하지 않았다(만능) — 어느 항공사에도 통할 답변이어야 한다'
    : (AIRLINES[airline] ? `${AIRLINES[airline]} 지망${airBrief}` : '')
  // 종류에 따라 '전형적인 문구'의 기준이 다르다 — 면접 답변에서 걸리는 건 외운 티다.
  const kindLine = docKind === 'interview'
    ? '면접 답변 — 소리 내어 말하는 말이다'
    : docKind === 'essay' ? '자소서 문항 — 눈으로 읽는 글이다' : ''
  // ⚠️ 미지정일 때 '자소서'라고 말하지 않는다 — 면접 답변이었으면 기준이 어긋난 채 지목한다.
  const extraWord = docKind === 'interview' ? '외운 원고처럼 들리는 문구'
    : docKind === 'essay' ? '전형적인 자소서 문구' : '전형적인 지원자 문구'
  const listed = hits
    .map((h) => `${h.n}. [${h.kind}] "${h.quote}"${h.why ? ` (규칙 메모: ${h.why})` : ''}`)
    .join('\n')

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SLOT_SCHEMA } },
    system: [{ type: 'text', text: VOICE + regenNote, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content:
        // ⚠️ 맥락 칸은 값이 있을 때만 넣는다 — 빈 라벨을 주면 AI 가 문항·종류를 지어내고,
        //    지어낸 전제에 맞춰 fix 를 쓰면 학생이 받은 것과 어긋난다.
        (kindLine ? `[글 종류]\n${kindLine}\n\n` : '') +
        (airLine ? `[지망 항공사]\n${airLine}\n\n` : '') +
        (question ? `[학생이 받은 문항]\n${question}\n\n` : '') +
        `[학생이 쓴 글]\n${text}\n\n` +
        `[규칙이 이미 찍은 자리 — 이 번호들의 why/fix 칸을 채워라]\n${listed}\n\n` +
        `[추가로 지목할 수 있는 것]\ncontext_extra 에 ${extraWord}를 최대 ${MAX_CONTEXT_EXTRA}곳까지 넣어라. ` +
        `quote 는 위 글에 **있는 그대로** 등장하는 문자열이어야 한다(한 글자도 바꾸지 마라). 없으면 빈 배열.`,
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

  let parsed: { slots?: Array<{ n: number; why: string; fix: string }>; context_extra?: Array<{ quote: string; why: string; fix: string }> }
  try { parsed = JSON.parse(raw) } catch { throw new Error('ai_bad_json') }
  return {
    slots: parsed.slots ?? [],
    extra: (parsed.context_extra ?? []).slice(0, MAX_CONTEXT_EXTRA),
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

// ⚠️ 첨삭의 선 — 킬러 VOICE 와 같은 4겹 고삐 철학이되, 처방 도구라 한 줄이 더 붙는다:
//    **학생이 쓴 사실만 재료로 쓴다.** fix 가 없는 일화·숫자를 지어내면 학생이 그 거짓을
//    면접장까지 들고 간다 — 이 도구가 낼 수 있는 최악의 사고다.
const POLISH_VOICE = `너는 승무원 면접·자소서를 10년 넘게 첨삭한 코치다. 학생의 글을 첨삭한다.

[네가 채우는 칸]
- strengths: 이 글이 이미 잘하고 있는 것 2~3가지. quote 는 그 강점이 보이는 원문 구절을
  **있는 그대로**(한 글자도 바꾸지 말고), note 는 왜 강점인지 한 문장.
- improvements: 글 전체에서 고칠 방향 2~3가지. 문장 하나가 아니라 글 전체에 해당하는 것만.
  note 는 무엇이 문제인지 한 문장, how 는 어떻게 고칠지 한 문장.
- rewrites: 고치면 효과가 가장 큰 문장 3~6개. quote 는 원문 문장 **있는 그대로**,
  fix 는 고친 예시 문장, why 는 왜 이렇게 고치는지 한 문장.

[⚠️ 첨삭의 선 — 가장 중요하다]
- fix 는 방향을 보여주는 예시다. **학생이 쓴 사실만 재료로 써라.** 원문에 없는 숫자·기간·
  장소·일화를 지어내지 마라. 구체성이 필요한 자리는 fix 안에 (몇 명이었는지),
  (그때 실제로 한 말) 같은 괄호 빈칸으로 남겨 학생이 채우게 하라.
- 학생의 말투와 어휘를 살려라. 네 문체로 갈아치우면 지원자들의 글이 전부 같아진다 —
  우리가 잡으려는 AI스러움을 우리가 만드는 꼴이다.
- "다양한", "첫째/둘째", "~을 통해", "매우", "소중한", "최선을 다해" 같은 상투어를
  **네 fix 문장에 쓰지 마라.** 학생 글을 재는 잣대로 네 글도 잰다.

[지켜야 할 것]
- 인사말·맺음말·총평·점수·번호매기기를 쓰지 마라. 칸만 채운다.
- note·how·why 는 각각 한 문장, 60자를 넘기지 마라. '~요'로 끝낸다.
- 학생을 나무라지 마라. 문제는 표현이지 사람이 아니다.
- 강점을 빈말로 채우지 마라 — 실제로 잘한 것이 없으면 strengths 를 1개만 넣어도 된다.

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

async function polishFill(
  apiKey: string, text: string, question: string, docKind: 'essay' | 'interview' | null,
  airline: string, airBrief: string, coachBrief: string, regenNote: string,
): Promise<PolishOut> {
  const airLine = airline === 'all'
    ? '특정 항공사를 정하지 않았다(만능) — 어느 항공사에도 통할 글이어야 한다'
    : (AIRLINES[airline] ? `${AIRLINES[airline]} 지망${airBrief}` : '')
  const kindLine = docKind === 'interview'
    ? '면접 답변 — 소리 내어 말하는 말이다'
    : docKind === 'essay' ? '자소서 문항 — 눈으로 읽는 글이다' : ''

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
        (airLine ? `[지망 항공사]\n${airLine}\n\n` : '') +
        (question ? `[학생이 받은 문항]\n${question}\n\n` : '') +
        `[학생이 쓴 글]\n${text}\n\n` +
        `[할 일]\n위 글을 첨삭하라. strengths ${MAX_POINTS}개 이하, improvements ${MAX_POINTS}개 이하, ` +
        `rewrites ${MAX_REWRITES}개 이하. quote 는 위 글에 **있는 그대로** 등장하는 문자열이어야 한다.`,
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
    } catch (_) { /* 표가 아직 없으면 null 로 둔다 */ }
    return json({
      fn: 'ai-killer',
      version: FN_VERSION,
      features: FN_FEATURES,
      airline_profiles: airlines,   // 4면 제주·에프·이스타·티웨이가 다 들어간 것
      terms: terms,
      coach_terms: coachTerms,      // 연구진 기준 표현 수 — 0이면 아직 임시 시드만(자산 미유입)
      polish_table: polishTable,    // null=마이그레이션 미적용 / 숫자=지금까지 쌓인 첨삭 수
      model: MODEL,
      has_api_key: !!Deno.env.get('ANTHROPIC_API_KEY'),
    })
  }

  let charged: { tool: string; ref: string } | null = null
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
      charged = { tool: 'polish', ref: polishRef }

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

      let rep = await polishFill(apiKey, text, question, docKind, airline, airBrief2, coachBrief, '')

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
          rep = await polishFill(apiKey, text, question, docKind, airline, airBrief2, coachBrief,
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
        result: { strengths: rep.strengths, improvements: rep.improvements, rewrites: rep.rewrites },
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
    charged = { tool: 'ai_killer', ref: payRef }

    // ── 4. 규칙 검사 ──────────────────────────────────────────────────────
    // 사전은 비공개 테이블이라 service role 로만 읽힌다(이게 규칙을 서버에 둔 이유).
    const { data: termRows } = await admin
      .from('ai_killer_terms').select('term, kind, why').eq('active', true)
    // ⚠️ 연구진 표현(coach)이 일반 상투어(general)보다 먼저 자리를 잡도록 긴 표현부터 훑는다
    //    (짧은 표현이 먼저 잡으면 긴 표현이 겹침 판정에 걸려 사라진다).
    const terms: Term[] = ((termRows ?? []) as Term[]).sort((a, b) => b.term.length - a.term.length)

    const taken: Array<[number, number]> = []
    const sents = splitSentences(text)
    // ⚠️ 각 판정은 **한 번만** 부른다. findEndingRepeat 은 taken 을 변경하므로
    //    두 번 부르면 두 번째 호출이 자기가 만든 겹침에 걸려 null 을 돌려준다.
    const termFound = findTerms(text, terms, taken)
    const ending = findEndingRepeat(sents, taken)
    const uniform = findUniformLength(sents)
    const vague = findVagueParagraphs(text)
    const hits: Hit[] = [
      ...termFound.hits,
      ...(ending ? [ending] : []),
      ...(uniform ? [uniform] : []),
      ...vague,
    ]
    hits.sort((a, b) => (a.start < 0 ? 1 : b.start < 0 ? -1 : a.start - b.start))

    // ⚠️ 두 개의 수를 구분한다 — 섞으면 화면도 등급도 틀린다.
    //    occurrences : 표현이 **나온 총 횟수**. 등급(밀도)의 분자이자 DB 에 남기는 값.
    //                  char_count 와 함께 있으면 임계값이 바뀌어도 과거 등급을 다시 계산할 수 있다.
    //    hits.length : **밑줄 자리 수**(같은 표현은 한 자리). 화면이 "고칠 곳 N"으로 보여줄 값.
    const occurrences = termFound.occurrences + (ending ? 1 : 0) + (uniform ? 1 : 0) + vague.length
    const truncated = Math.max(hits.length - MAX_HITS, 0)
    if (truncated > 0) hits.length = MAX_HITS
    hits.forEach((h, i) => { h.n = i + 1 })

    // 걸린 게 하나도 없으면 AI 를 부르지 않는다 — 원가를 아끼고 결과도 정확하다
    if (hits.length === 0) {
      await saveCheck(admin, {
        id: checkId, member_id: user.id, source, answer_id: targetAnswer, content: text,
        question: question || null, doc_kind: docKind,
        result: [], grade: 'human', hit_count: 0, char_count: len,
      })
      return json({
        ok: true, id: checkId, grade: 'human', hits: [],
        spot_count: 0, occurrences: 0, char_count: len, truncated: 0,
        answerId: targetAnswer, autoSaved,
        recheck_left: Math.max(MAX_RECHECK - (prevChecks % MAX_RECHECK) - 1, 0),
        used: spent?.used, cost: spent?.cost, balance: spent?.balance, daily_left: spent?.daily_left,
      })
    }

    // ── 5·6. Claude 호출 + 자기 출력 재검사 (4겹 고삐 ③) ──────────────────
    // 우리가 만든 상투어 사전을 **AI 가 쓴 문장에도 똑같이 돌려** 걸리면 한 번 다시 쓰게 한다.
    const clicheOnly = terms.filter((t) => t.kind === 'cliche').map((t) => t.term)
    const selfCheck = (out: { slots: Array<{ why: string; fix: string }>; extra: Array<{ why: string; fix: string }> }) => {
      const mine = [...out.slots, ...out.extra].flatMap((s) => [s.why ?? '', s.fix ?? '']).join(' ')
      return clicheOnly.filter((t) => t.length >= 3 && mine.includes(t))
    }

    // 항공사 프로필 — 그 항공사만의 형식·고유 소재(비공개 표, service role 로만 읽힌다).
    // ⚠️ 학생이 넣은 문항을 함께 넘겨 **이번 채용 문항이 우리 자료와 같은지** 서버가 판정한다.
    //    다르면 문항별 조언은 빠지고 잘 안 바뀌는 것(회사 소재·형식)만 남는다.
    const { brief: airBrief, qMatched } = await airlineBrief(admin, airline, question)
    // 불일치가 쌓이면 그 항공사 문항이 바뀌었다는 신호다 — 오너가 프로필을 갱신할 근거.
    if (qMatched === false) console.log('airline question mismatch:', airline, '|', question.slice(0, 60))

    let filled = await fillSlots(apiKey, text, question, docKind, airline, airBrief, hits, '')
    const bad = selfCheck(filled)
    if (bad.length > 0) {
      console.log('self-check hit, regenerating:', bad.join(', '))
      filled = await fillSlots(apiKey, text, question, docKind, airline, airBrief, hits,
        `\n\n[다시 쓰는 이유]\n방금 네 답변에 ${bad.map((b) => `"${b}"`).join(', ')} 가 들어 있었다. ` +
        `학생에게 쓰지 말라고 하는 표현을 네가 쓰면 안 된다. 그 표현들을 빼고 다시 채워라.`)
    }

    // 규칙이 찍은 자리에 AI 의 칸을 얹는다. AI 가 빠뜨린 칸은 규칙 메모로 메운다.
    // ⚠️ 메우는 문구도 종류를 따른다 — 면접 답변에 "자소서에서 흔히 보이는"이라고 하면
    //    학생이 "이건 말인데?" 하고 신뢰를 잃는다. 미지정이면 한쪽을 전제하지 않는 말로 둔다.
    const fbWhy = docKind === 'interview'
      ? '지원자들이 자주 쓰는 표현이라 면접관 귀에 남지 않아요.'
      : docKind === 'essay' ? '자소서에서 흔히 보이는 표현이라 눈에 남지 않아요.'
      : '너무 자주 쓰이는 표현이라 인상에 남지 않아요.'
    const fbFix = docKind === 'interview'
      ? '이 표현을 빼고 그때 겪은 장면을 그대로 말해 보세요.'
      : '이 표현을 빼고 겪은 장면을 그대로 써 보세요.'
    const byN = new Map(filled.slots.map((s) => [s.n, s]))
    for (const h of hits) {
      const s = byN.get(h.n)
      if (s?.why) h.why = s.why
      if (s?.fix) h.fix = s.fix
      if (!h.fix) h.fix = fbFix
      if (!h.why) h.why = fbWhy
    }

    // ⚠️ '문맥' 추가 지목은 **원문에 실제로 있는 문자열일 때만** 받는다.
    //    AI 가 span 을 지어내면 화면의 밑줄이 엉뚱한 자리에 그어진다 — 위치는 서버가 계산한다.
    let added = 0
    for (const e of filled.extra) {
      const q = (e.quote || '').trim()
      if (q.length < 4) continue
      const i = text.indexOf(q)
      if (i < 0) continue
      const j = i + q.length
      if (overlaps(taken, i, j)) continue
      taken.push([i, j])
      hits.push({ n: 0, kind: 'context', quote: q, start: i, end: j, why: e.why, fix: e.fix })
      added++
    }
    hits.sort((a, b) => (a.start < 0 ? 1 : b.start < 0 ? -1 : a.start - b.start))
    hits.forEach((h, i) => { h.n = i + 1 })

    // ── 7. 저장 + 반환 ────────────────────────────────────────────────────
    // 등급의 분자 = 규칙이 센 총 등장 + AI 가 추가 지목해 서버가 검증한 것
    const total = occurrences + added
    const g = grade(total, len)
    const u = filled.usage as { input_tokens?: number; output_tokens?: number }
    const saveErr = await saveCheck(admin, {
      id: checkId, member_id: user.id, source, answer_id: targetAnswer, content: text,
      question: question || null, doc_kind: docKind,
      result: hits, grade: g, hit_count: total, char_count: len,
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
      ok: true, id: checkId, grade: g, hits,
      // 화면이 "고칠 곳 N"으로 쓸 값(= hits.length). occurrences 는 등급 근거라 따로 준다.
      spot_count: hits.length, occurrences: total, char_count: len,
      // 자리가 상한에 걸려 잘렸으면 알린다 — 조용히 자르지 않는다
      truncated, answerId: targetAnswer, autoSaved,
      // 이 답변에 남은 무차감 재검사 횟수(화면이 "마지막 무차감 검사예요"를 말할 근거)
      recheck_left: Math.max(MAX_RECHECK - (prevChecks % MAX_RECHECK) - 1, 0),
      used: spent?.used, cost: spent?.cost, balance: spent?.balance, daily_left: spent?.daily_left,
    })
  } catch (e) {
    // ⚠️ 차감했는데 결과를 못 준 경우 반드시 되돌린다.
    //    유료는 refund 행 추가, 무료는 free_use 행 삭제(한도 복구) — RPC 가 알아서 나눈다.
    if (charged && supa) {
      const { error } = await supa.rpc('refund_credit', { p_tool: charged.tool, p_ref: charged.ref })
      if (error) console.error('refund failed', error.message, charged.ref)
    }
    const msg = String((e as Error)?.message || '')
    console.error('ai-killer error', msg)
    // 첨삭 분기에서 던져졌으면 문구도 첨삭으로 — '검사에 실패'라고 하면 학생이 딴 도구 이야기로 읽는다
    const act = (reqBody as { mode?: unknown }).mode === 'polish' ? '첨삭' : '검사'
    if (msg === 'ai_refused') {
      return json({ error: `이 글은 ${act}할 수 없어요. 다른 글로 시도해 주세요.`, code: 'refused', refunded: true }, 200)
    }
    return json({ error: `${act}에 실패했어요. 크레딧은 돌려드렸습니다.`, code: 'failed', refunded: true }, 200)
  }
})
