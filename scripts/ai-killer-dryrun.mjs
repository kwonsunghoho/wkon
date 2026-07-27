// =============================================================================
// AI킬러 규칙 엔진 dry-run — 실행: node scripts/ai-killer-dryrun.mjs
// =============================================================================
// supabase/functions/ai-killer/index.ts 의 **순수 함수를 그대로 복사**해 실제 글에 돌린다.
// DB·API 없이 돌아가므로 규칙만 빠르게 검증할 수 있다.
//
// ⚠️ 규칙(TERMS 정규식·임계값·판정 로직)을 고치면 **반드시 여기 돌려서 아래 기준선과 비교할 것.**
//    정규식 한 줄이 수백 건을 좌우한다 — 특히 ② '사람이 잘 쓴 글'이 0곳을 유지하는지가 핵심이다.
//    규칙 기반 검사기가 망하는 건 못 잡아서가 아니라 멀쩡한 표현에 밑줄을 그어서다.
//
// 기준선 (2026-07-25 · 시드 사전 28건 기준)
//   ① 전형적 AI 자소서 371자  → 밑줄 15 / 등장 16  · heavy
//   ② 사람이 잘 쓴 글  303자  → 밑줄  0 / 등장  0  · human   ← 오탐 0 이 가장 중요
//   ③ 짧은 면접 답변    92자  → 밑줄  0 / 등장  0  · human
//   ④ 상투어 도배     1500자  → 밑줄 25 / 등장 143 · heavy
//
// ⚠️ 사전은 비공개 테이블(ai_killer_terms)이라 여기엔 **시드 28건만** 복사돼 있다.
//    오너 자료(연구진 감점 표현)가 들어간 뒤의 실제 동작과는 다르다.
// =============================================================================

const TIME_PLACE = /(작년|올해|지난|이번|매일|매주|하루|첫날|당시|학기|방학|여름|겨울|봄|가을|아침|저녁|주말|년|개월|주간|시간|분|초|명|번|회|개|잔|건|층|호|점|월|일)/

function overlaps(taken, s, e) { return taken.some(([a, b]) => s < b && e > a) }

// ⚠️ 밑줄(hits)과 등장 횟수(occurrences)는 다른 수다 — index.ts 의 findTerms 주석 참조.
//    밑줄은 같은 표현당 한 자리, 개수는 나온 만큼 전부. 묶으면 긴 글의 등급이 뒤집힌다.
function findTerms(text, terms, taken) {
  const out = []
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
      taken.push([i, j])
      occurrences++
      if (first) { out.push({ kind: t.kind, quote: t.term, start: i, end: j }); first = false }
    }
  }
  return { hits: out, occurrences }
}

function splitSentences(text) {
  const out = []; let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (!(c === '.' || c === '!' || c === '?' || c === '\n')) continue
    const seg = text.slice(start, i + 1)
    if (seg.trim().length > 0) out.push({ text: seg.trim(), start })
    start = i + 1
  }
  const tail = text.slice(start)
  if (tail.trim().length > 0) out.push({ text: tail.trim(), start })
  return out
}

function findEndingRepeat(sents, taken) {
  if (sents.length < 4) return null
  const counts = new Map()
  sents.forEach((s, idx) => {
    const body = s.text.replace(/[.!?\s]+$/, '')
    if (body.length < 5) return
    const key = body.slice(-4)
    if (!counts.has(key)) counts.set(key, [])
    counts.get(key).push(idx)
  })
  let best = null
  for (const [key, idxs] of counts) if (!best || idxs.length > best.idxs.length) best = { key, idxs }
  if (!best || best.idxs.length < 3 || best.idxs.length * 2 <= sents.length) return null
  const s = sents[best.idxs[0]]
  const body = s.text.replace(/[.!?\s]+$/, '')
  const off = s.start + s.text.indexOf(body) + body.length - best.key.length
  const end = off + best.key.length
  if (overlaps(taken, off, end)) return null
  taken.push([off, end])
  return { kind: 'structure', quote: best.key, start: off, end, note: `${best.idxs.length}/${sents.length}문장` }
}

function findUniformLength(sents) {
  if (sents.length < 5) return null
  const lens = sents.map((s) => s.text.replace(/\s/g, '').length).filter((n) => n > 5)
  if (lens.length < 5) return null
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length
  if (mean < 12) return null
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length)
  if (sd / mean > 0.22) return null
  return { kind: 'structure', quote: '문장 길이가 고름', start: -1, end: -1, note: `cv=${(sd / mean).toFixed(2)}` }
}

function findVagueParagraphs(text) {
  const out = []; let cursor = 0
  for (const raw of text.split(/\n{1,}/)) {
    const start = text.indexOf(raw, cursor); cursor = start + raw.length
    const body = raw.trim()
    if (body.replace(/\s/g, '').length < 60) continue
    if (/\d/.test(body)) continue
    if (TIME_PLACE.test(body)) continue
    out.push({ kind: 'vague', quote: body.slice(0, 20) + '…', start, end: start + raw.length })
  }
  return out
}

function grade(hits, chars) {
  const d = (hits / Math.max(chars, 1)) * 100
  return d < 1.0 ? 'human' : d <= 2.5 ? 'slight' : 'heavy'
}

// ── 시드 사전(마이그레이션과 동일) ──
const TERMS = [
  ['다양한 경험','cliche'],['많은 경험','cliche'],['이를 통해','cliche'],['을 통해','cliche'],
  ['최선을 다하겠습니다','cliche'],['열심히 하겠습니다','cliche'],['소중한 경험','cliche'],
  ['밑거름이 되었습니다','cliche'],['역량을 발휘','cliche'],['책임감을 가지고','cliche'],
  ['열정을 가지고','cliche'],['긍정적인 마인드','cliche'],['서비스 마인드','cliche'],
  ['고객의 니즈','cliche'],['원활한 소통','cliche'],['소통 능력','cliche'],['팀워크의 중요성','cliche'],
  ['어릴 적부터','context'],['하늘을 동경','context'],['항상 밝은 미소','context'],['귀사','context'],
  ['위기를 기회로','cliche'],['첫째','structure'],['둘째','structure'],['셋째','structure'],
  ['또한','structure'],['더불어','structure'],['나아가','structure'],
].map(([term, kind]) => ({ term, kind })).sort((a, b) => b.term.length - a.term.length)

const MAX_HITS = 24   // index.ts 와 같은 값

function run(label, text) {
  const taken = []
  const sents = splitSentences(text)
  const found = findTerms(text, TERMS, taken)
  const ending = findEndingRepeat(sents, taken)
  const uniform = findUniformLength(sents)
  const vague = findVagueParagraphs(text)
  const hits = [...found.hits, ...(ending ? [ending] : []), ...(uniform ? [uniform] : []), ...vague]
  hits.sort((a, b) => (a.start < 0 ? 1 : b.start < 0 ? -1 : a.start - b.start))

  const occ = found.occurrences + (ending ? 1 : 0) + (uniform ? 1 : 0) + vague.length
  const truncated = Math.max(hits.length - MAX_HITS, 0)
  const len = text.length
  const d = ((occ / len) * 100).toFixed(2)

  console.log(`\n══ ${label} ── ${len}자`)
  console.log(`   밑줄 ${hits.length}자리 / 등장 ${occ}회 · 100자당 ${d} · ${grade(occ, len)}` +
              (truncated > 0 ? `  (상한 초과로 ${truncated}자리 잘림)` : ''))
  for (const h of hits.slice(0, MAX_HITS)) {
    console.log(`   [${h.kind.padEnd(9)}] "${h.quote}"${h.note ? ' (' + h.note + ')' : ''}`)
  }
  if (hits.some((h) => h == null)) console.log('   ⚠️ null 이 섞임!')
  return { spots: hits.length, occ, grade: grade(occ, len) }
}

// ── ① 목업 샘플(전형적 AI 자소서) — 많이 잡혀야 정상 ──
run('① AI스러운 자소서', `저는 다양한 경험을 통해 서비스 마인드를 키워왔습니다. 대학 시절 카페에서 아르바이트를 하며 많은 손님을 응대하였고, 이를 통해 고객의 니즈를 파악하는 능력을 기를 수 있었습니다. 또한 교내 봉사 동아리 활동을 하며 팀워크의 중요성을 깨달았습니다.

작년 여름 성수기에는 하루 300잔 넘게 만들었는데, 그때 단골 손님 이름을 스무 명쯤 외웠습니다.

제가 승무원에 적합한 이유는 다음과 같습니다. 첫째, 저는 항상 밝은 미소로 손님을 맞이하였습니다. 둘째, 고객의 불편사항을 신속하게 해결하고자 노력하였습니다. 셋째, 동료들과의 원활한 소통을 통해 업무 효율을 높일 수 있었습니다.

이러한 소중한 경험을 바탕으로 대한항공의 객실승무원으로서 최선을 다하겠습니다.`)

// ── ② 사람이 잘 쓴 글 — 거의 안 잡혀야 정상(오탐 테스트) ──
run('② 사람이 잘 쓴 글', `카페에서 2년을 일했습니다. 작년 8월, 에어컨이 고장난 날이었어요. 매장 온도가 31도까지 올라갔고 손님들이 하나둘 나가기 시작했습니다.

저는 얼음물을 담은 컵을 입구 옆 테이블에 쭉 늘어놨습니다. 그리고 들어오시는 분마다 "오늘 에어컨이 고장나서 좀 더워요, 죄송합니다" 하고 먼저 말씀드렸어요. 미리 말하면 화를 덜 내신다는 걸 그날 배웠습니다.

그날 매출은 평소의 8할이었습니다. 항의는 한 건도 없었고요. 기내에서도 지연이나 결항처럼 제가 못 바꾸는 상황이 생길 텐데, 그때 제일 먼저 할 일은 먼저 말을 거는 거라고 생각합니다.`)

// ── ③ 짧은 답변(100자대) — 밀도 판정이 튀지 않는지 ──
run('③ 짧은 면접 답변', `저는 사람을 대하는 일을 좋아합니다. 카페에서 일할 때 단골손님이 늘어나는 걸 보며 보람을 느꼈고, 승무원도 결국 사람을 만나는 일이라고 생각해 지원하게 되었습니다.`)

// ── ④ 1,500자 최악 케이스 — 상한(MAX_HITS)과 등급 산수가 버티는지 ──
const BLOCK = `저는 다양한 경험을 통해 서비스 마인드를 키워왔습니다. 첫째, 고객의 니즈를 파악하였습니다. 둘째, 원활한 소통 능력을 길렀습니다. 셋째, 팀워크의 중요성을 깨달았습니다. 또한 책임감을 가지고 임하였습니다. 더불어 긍정적인 마인드로 노력하였습니다. 이러한 소중한 경험을 바탕으로 최선을 다하겠습니다.`
let big = ''
while (big.length < 1400) big += BLOCK + '\n\n'
run('④ 상투어 도배 1,500자', big.slice(0, 1500))

// ── 기준선 대조 ──
console.log('\n' + '─'.repeat(60))
console.log('기준선(2026-07-25): ①15/16 heavy · ②0/0 human · ③0/0 human · ④25/143 heavy')
console.log('② 가 0이 아니면 오탐이 생긴 것 — 규칙을 되돌리거나 좁힐 것.')
