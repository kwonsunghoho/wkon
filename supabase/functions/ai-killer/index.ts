// =============================================================================
// Supabase Edge Function: ai-killer — 자소서·답변의 'AI 문체' 검사 (2026-07-25)
// =============================================================================
// 스펙: docs/superpowers/specs/2026-07-24-ai-killer-design.md (④⑤단계)
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
//   20260725150000_ai_killer.sql
//
// 처리 순서(확정본 '서버' 절 그대로)
//   1 로그인 확인 → 2 길이 검증 → 3 무료분 판정+차감 → 4 규칙 검사
//   → 5 Claude 호출(칸만 채움) → 6 자기 출력 재검사 → 7 저장+반환
//   ⚠️ 3번에서 막히면 아래로 안 간다. 5~7 중 실패하면 반드시 환급(refund_credit).
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

// ⚠️ 화면에 그릴 지적 상한. 371자 실측에서 15곳이 나왔으므로 1,500자면 60곳까지 가능하다 —
//    밑줄 60개는 원문이 안 읽히고, AI 에게 채우라고 할 칸도 60개가 되어 원가가 튄다.
//    **등급은 자른 게 아니라 실제 개수로 매긴다**(자르고 등급까지 낮추면 거짓말이 된다).
//    자른 경우 응답에 truncated 를 실어 화면이 "많아서 앞의 N곳만" 이라고 말할 수 있게 한다.
const MAX_HITS = 24

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
- 모범답안을 대신 써 주지 마라. 학생이 스스로 고칠 방향만 준다.`

async function fillSlots(apiKey: string, text: string, hits: Hit[], regenNote: string) {
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
        `[학생이 쓴 글]\n${text}\n\n` +
        `[규칙이 이미 찍은 자리 — 이 번호들의 why/fix 칸을 채워라]\n${listed}\n\n` +
        `[추가로 지목할 수 있는 것]\ncontext_extra 에 전형적인 자소서 문구를 최대 ${MAX_CONTEXT_EXTRA}곳까지 넣어라. ` +
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
// 진입점
// =============================================================================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  let charged: { tool: string; ref: string } | null = null
  let supa: ReturnType<typeof createClient> | null = null

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
    const reqBody = await req.json().catch(() => ({}))
    const text: string = typeof reqBody.text === 'string' ? reqBody.text.trim() : ''
    const source: 'paste' | 'answer' = reqBody.source === 'answer' ? 'answer' : 'paste'
    const answerId: string | null = typeof reqBody.answerId === 'string' ? reqBody.answerId : null
    const len = text.length
    if (len < MIN_CHARS) return json({ error: `${MIN_CHARS}자 이상 넣어 주세요`, code: 'too_short' }, 400)
    if (len > MAX_CHARS) return json({ error: `${MAX_CHARS}자까지 검사할 수 있어요`, code: 'too_long' }, 400)

    // 사용처 id 를 **먼저** 만든다 — 차감(3)이 저장(7)보다 앞서므로 그때 이미 ref 가 있어야 한다
    const checkId = crypto.randomUUID()

    // ── 3. 무료분 판정 + 차감 (지급·차감이 한 트랜잭션·같은 lock 안) ──────
    const freeRef = source === 'answer' && answerId ? answerId : null
    const { data: spentRaw, error: spendErr } = await supa.rpc('spend_credit', {
      p_tool: 'ai_killer', p_ref: checkId, p_free_ref: freeRef,
    })
    const spent = spentRaw as { used?: string; balance?: number; free_left?: number } | null
    if (spendErr) {
      const msg = String(spendErr.message || '')
      if (msg.includes('no_credit')) {
        return json({ error: '검사 횟수가 없어요. 충전하고 이어서 해요.', code: 'no_credit' }, 200)
      }
      console.error('spend_credit failed', msg)
      return json({ error: '검사를 시작하지 못했어요', code: 'spend_failed' }, 500)
    }
    charged = { tool: 'ai_killer', ref: checkId }

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
      await admin.from('ai_killer_checks').insert({
        id: checkId, member_id: user.id, source, answer_id: answerId, content: text,
        result: [], grade: 'human', hit_count: 0, char_count: len,
      })
      return json({
        ok: true, id: checkId, grade: 'human', hits: [],
        spot_count: 0, occurrences: 0, char_count: len, truncated: 0,
        used: spent?.used, balance: spent?.balance, free_left: spent?.free_left,
      })
    }

    // ── 5·6. Claude 호출 + 자기 출력 재검사 (4겹 고삐 ③) ──────────────────
    // 우리가 만든 상투어 사전을 **AI 가 쓴 문장에도 똑같이 돌려** 걸리면 한 번 다시 쓰게 한다.
    const clicheOnly = terms.filter((t) => t.kind === 'cliche').map((t) => t.term)
    const selfCheck = (out: { slots: Array<{ why: string; fix: string }>; extra: Array<{ why: string; fix: string }> }) => {
      const mine = [...out.slots, ...out.extra].flatMap((s) => [s.why ?? '', s.fix ?? '']).join(' ')
      return clicheOnly.filter((t) => t.length >= 3 && mine.includes(t))
    }

    let filled = await fillSlots(apiKey, text, hits, '')
    const bad = selfCheck(filled)
    if (bad.length > 0) {
      console.log('self-check hit, regenerating:', bad.join(', '))
      filled = await fillSlots(apiKey, text, hits,
        `\n\n[다시 쓰는 이유]\n방금 네 답변에 ${bad.map((b) => `"${b}"`).join(', ')} 가 들어 있었다. ` +
        `학생에게 쓰지 말라고 하는 표현을 네가 쓰면 안 된다. 그 표현들을 빼고 다시 채워라.`)
    }

    // 규칙이 찍은 자리에 AI 의 칸을 얹는다. AI 가 빠뜨린 칸은 규칙 메모로 메운다.
    const byN = new Map(filled.slots.map((s) => [s.n, s]))
    for (const h of hits) {
      const s = byN.get(h.n)
      if (s?.why) h.why = s.why
      if (s?.fix) h.fix = s.fix
      if (!h.fix) h.fix = '이 표현을 빼고 겪은 장면을 그대로 써 보세요.'
      if (!h.why) h.why = '자소서에서 흔히 보이는 표현이라 눈에 남지 않아요.'
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
    const { error: saveErr } = await admin.from('ai_killer_checks').insert({
      id: checkId, member_id: user.id, source, answer_id: answerId, content: text,
      result: hits, grade: g, hit_count: total, char_count: len,
      input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0,
    })
    // 저장이 실패해도 검사는 이미 끝났다 — 결과는 돌려주고 환급은 하지 않는다
    // (사용자는 답을 받았으므로. 기록만 유실되며 로그로 추적한다).
    if (saveErr) console.error('save failed', saveErr.message)

    return json({
      ok: true, id: checkId, grade: g, hits,
      // 화면이 "고칠 곳 N"으로 쓸 값(= hits.length). occurrences 는 등급 근거라 따로 준다.
      spot_count: hits.length, occurrences: total, char_count: len,
      // 자리가 상한에 걸려 잘렸으면 알린다 — 조용히 자르지 않는다
      truncated,
      used: spent?.used, balance: spent?.balance, free_left: spent?.free_left,
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
    if (msg === 'ai_refused') {
      return json({ error: '이 글은 검사할 수 없어요. 다른 글로 시도해 주세요.', code: 'refused', refunded: true }, 200)
    }
    return json({ error: '검사에 실패했어요. 횟수는 돌려드렸습니다.', code: 'failed', refunded: true }, 200)
  }
})
