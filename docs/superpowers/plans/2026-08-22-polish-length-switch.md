# 첨삭 결과 화면 분량 전환 + 'N초 버전' 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 첨삭 결과 화면에서 자유·20·30·40초를 바로 바꿔 보게 하고(받은 분량은 무차감 재사용, 새 분량은 10크레딧 재첨삭), 분량을 고른 리포트에는 학생 재료만으로 통째 재구성한 'N초 버전' + '덜어낸 대목'을 더 준다.

**Architecture:** 서버(`ai-killer` `mode:'polish'`)는 분량이 있을 때만 출력 스키마에 `short_version`·`cuts` 두 칸을 더해 같은 한 번의 호출로 받고, 결과 jsonb 에 같이 저장한다(컬럼 추가 없음). 화면(`polish.html`)은 결과 머리 아래 분량 버튼 줄을 그리고, 세션 캐시 + `answer_polishes` 조회(원문이 정확히 같은 행만)로 '받은 분량'을 판정해 즉시 전환하거나 같은 입력에 `targetSec` 만 바꿔 재첨삭한다. 노출은 프로브 features `polish_length_version` 게이트.

**Tech Stack:** 손으로 쓴 HTML/CSS/JS(빌드 없음) · Supabase Edge Function(Deno, 한 파일) · Anthropic Messages API 구조화 출력. 테스트 스위트 없음 — 검증은 스텁 사본 375px 실측 + 프롬프트 실측.

**설계서:** `docs/superpowers/specs/2026-08-22-polish-length-switch-design.md`

---

## 파일 구조

| 파일 | 책임 | 변경 |
|---|---|---|
| `supabase/functions/ai-killer/index.ts` | 첨삭 서버 — 스키마·프롬프트·검증·저장·반환 | 수정(한 파일 유지) |
| `polish.html` | 결과 화면 분량 줄·N초 버전 카드·재첨삭 흐름 | 수정 |
| `docs/notes/polish.md` · `docs/notes/implementation-status.md` | 기록 | 수정 |
| 스크래치패드 `__polish-test.html` · `__wrap.html` | 스텁 하네스·375px 래퍼(커밋 금지) | 임시 |

---

### Task 1: 서버 — 버전·features·스키마·타입

**Files:**
- Modify: `supabase/functions/ai-killer/index.ts:67-82` (FN_VERSION·FN_FEATURES), `:481-515` (POLISH_SCHEMA), `:612-619` (PolishOut·POLISH_TARGET_CHARS)

- [ ] **Step 1: 버전·features**

`FN_VERSION` 줄과 `FN_FEATURES` 끝을 이렇게 바꾼다.

```ts
const FN_VERSION = '2026-08-22a'  // a = 첨삭 분량 전환 + N초 버전(short_version·cuts)
```

```ts
  'polish_length',    // 첨삭 말하기 분량 — targetSec(20/30/40초)을 프롬프트 목표 분량으로(2026-08-21)
  'polish_length_version', // 분량 리포트에 N초 버전(short_version)·덜어낸 대목(cuts) 동봉(2026-08-22)
]
```

- [ ] **Step 2: 분량용 스키마**

`POLISH_SCHEMA` 정의 바로 아래에 추가한다.

```ts
// 분량(targetSec)이 있을 때만 쓰는 스키마 — N초 버전 본문 + 덜어낸 대목. 칸을 옵션으로 두지 않고
// required 로 못 박는다(구조화 출력은 required 가 안전하고, 자유 리포트에는 빈 칸을 싣지 않는다).
const POLISH_SCHEMA_LEN = {
  ...POLISH_SCHEMA,
  properties: {
    ...POLISH_SCHEMA.properties,
    short_version: { type: 'string' },
    cuts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { quote: { type: 'string' }, why: { type: 'string' } },
        required: ['quote', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: [...POLISH_SCHEMA.required, 'short_version', 'cuts'],
}
```

- [ ] **Step 3: 타입·환산표**

`PolishOut` 과 `POLISH_TARGET_CHARS` 를 이렇게 바꾼다.

```ts
type PolishOut = {
  strengths: Array<{ quote: string; note: string }>
  improvements: Array<{ note: string; how: string }>
  rewrites: Array<{ quote: string; fix: string; why: string }>
  short_version: string                          // 분량 리포트만 — 자유(0)면 ''
  cuts: Array<{ quote: string; why: string }>    // 분량 리포트만 — 자유(0)면 []
  usage: { input_tokens?: number; output_tokens?: number }
}

// 말하기 분량(첨삭 옵션) — 화면(polish.html #lenRow·#rsLen)이 보내는 초. 이 세 값만 받는다.
// 초→글자 환산은 면접 말하기 속도(분당 300~350자) 기준 — 값을 바꾸면 화면 안내 문구도 같이 본다.
const POLISH_TARGET_CHARS: Record<number, string> = { 20: '100~120자', 30: '150~180자', 40: '200~230자' }
// 환산 상한(숫자) — short_version 이 이 값의 1.3배를 넘으면 한 번 다시 쓰게 한다(POLISH_OVER_RATIO)
const POLISH_TARGET_MAX: Record<number, number> = { 20: 120, 30: 180, 40: 230 }
const POLISH_OVER_RATIO = 1.3
```

- [ ] **Step 4: 커밋**

```bash
git add supabase/functions/ai-killer/index.ts
git commit -m "feat(ai-killer): 첨삭 분량 스키마 POLISH_SCHEMA_LEN·환산 상한 — FN_VERSION 2026-08-22a"
```

---

### Task 2: 서버 — polishFill 프롬프트·스키마 선택·파싱

**Files:**
- Modify: `supabase/functions/ai-killer/index.ts` `polishFill()` (`:621-695`)

- [ ] **Step 1: lenLine 확장**

`polishFill` 안의 `lenLine` 정의를 이렇게 바꾼다.

```ts
  // 목표 분량 — 있으면 진단(덜어낼 곳)·fix(짧은 문장)·N초 버전(통째 재구성) 셋에 건다.
  // ⚠️ system 이 아니라 user 메시지에 넣는다 — system 은 요청 간 프롬프트 캐시를 타는 자리다.
  const chars = POLISH_TARGET_CHARS[targetSec]
  const lenLine = targetSec && chars
    ? `면접에서 약 ${targetSec}초 안에 말할 답변이다 — 전체 ${chars} 안팎이 목표다.\n` +
      `이 분량에 맞춰 short_version(통째로 다시 구성한 답변 하나)과 cuts(덜어낸 대목)를 채운다.\n` +
      `- 남기는 순서: ① 질문에 대한 답 한 문장 ② 그걸 보여주는 행동·장면 하나 ③ 그 결과·배운 것 한 문장.\n` +
      `- 먼저 빼는 것: 배경 설명, 같은 말의 반복, 수식어, 일화가 둘이면 하나.\n` +
      `- short_version 은 학생 글에 있는 재료로만 쓴다 — 없는 숫자·일화 금지, 모자라면 (괄호 빈칸). ` +
      `학생의 어휘와 정서를 남기고, 소리 내어 말하는 문장으로, 인사말·맺음말 없이 ${chars} 안에 쓴다.\n` +
      `- 글이 이미 목표보다 짧으면 늘리지 마라 — 그 분량에서 다듬은 버전을 주고 cuts 는 빈 배열로 둔다.\n` +
      `- cuts 는 덜어낸 대목 1~3개. quote 는 원문에 **있는 그대로**, why 는 왜 빼도 되는지 한 문장(60자 안, '~요').`
    : ''
```

- [ ] **Step 2: 스키마 선택·끝 재고지**

`body` 의 `output_config` 줄과 `[할 일]` 끝의 분량 재고지를 이렇게 바꾼다.

```ts
    output_config: {
      effort: POLISH_EFFORT,
      format: { type: 'json_schema', schema: lenLine ? POLISH_SCHEMA_LEN : POLISH_SCHEMA },
    },
```

```ts
        // ⚠️ 마지막에 읽는 지시가 가장 세게 먹는다(2026-08-14b 교훈) — 분량 지시도 여기서 못 박는다.
        (lenLine ? `\n목표 분량(약 ${targetSec}초·${chars})을 지켜라 — short_version 은 ${chars} 안, ` +
          `학생 재료만, 없던 내용 금지, 이미 짧으면 늘리지 마라. 글이 넘치면 improvements 에서 ` +
          `어느 대목을 덜어낼지 짚고, fix 도 그 분량 감각으로 짧게 써라. cuts 의 quote 는 원문 그대로.` : ''),
```

- [ ] **Step 3: 파싱**

`return { strengths: ..., usage }` 를 이렇게 바꾼다.

```ts
  return {
    strengths: (parsed.strengths ?? []).slice(0, MAX_POINTS),
    improvements: (parsed.improvements ?? []).slice(0, MAX_POINTS),
    rewrites: (parsed.rewrites ?? []).slice(0, MAX_REWRITES),
    // 분량 리포트만 — 자유면 스키마에 칸이 없어 빈 값으로 떨어진다
    short_version: lenLine ? String(parsed.short_version ?? '').trim() : '',
    cuts: lenLine ? (parsed.cuts ?? []).slice(0, 3) : [],
    usage: data.usage ?? {},
  }
```

- [ ] **Step 4: 커밋**

```bash
git add supabase/functions/ai-killer/index.ts
git commit -m "feat(ai-killer): 분량 리포트 프롬프트 — 남기는 순서·재료 제한·short_version·cuts 지시"
```

---

### Task 3: 서버 — polish 분기의 재검사·넘침 재생성·cuts 필터·저장·반환

**Files:**
- Modify: `supabase/functions/ai-killer/index.ts` polish 분기 p-3·p-4 (`:1055-1115`)

- [ ] **Step 1: 자기 재검사에 새 칸 포함**

p-3 의 `mine` 배열을 이렇게 바꾼다.

```ts
        const mine = [
          ...rep.strengths.map((s) => s.note),
          ...rep.improvements.flatMap((s) => [s.note, s.how]),
          ...rep.rewrites.flatMap((s) => [s.fix, s.why]),
          rep.short_version,                       // N초 버전도 학생이 옮겨 쓸 수 있는 문장이다
          ...rep.cuts.map((c) => c.why),
        ].join(' ')
```

- [ ] **Step 2: 넘침 재생성 + cuts 필터**

`if (rep.rewrites.length === 0 && rep.improvements.length === 0) throw new Error('ai_empty')` 바로 **앞**에 넣는다.

```ts
      // ── p-3b. N초 버전 분량 검사 — 환산 상한의 1.3배를 넘으면 한 번만 다시 쓰게 한다 ──
      //    그래도 넘치면 그대로 반환(실패·환급 아님 — 리포트 본체는 멀쩡하다). 로그만 남긴다.
      if (targetSec && POLISH_TARGET_MAX[targetSec]) {
        const cap = Math.round(POLISH_TARGET_MAX[targetSec] * POLISH_OVER_RATIO)
        if (rep.short_version.length > cap) {
          console.log('short_version over cap, regenerating:', rep.short_version.length, '>', cap)
          rep = await polishFill(apiKey, text, question, docKind, targetSec, airline, airBrief2, coachBrief,
            `\n\n[다시 쓰는 이유]\n방금 네 short_version 이 ${rep.short_version.length}자로 목표(${POLISH_TARGET_CHARS[targetSec]})를 ` +
            `크게 넘었다. 같은 재료로 ${POLISH_TARGET_MAX[targetSec]}자 안에 다시 써라 — 없던 내용을 넣지 말고 덜어내라.`)
          if (rep.short_version.length > cap) console.log('short_version still over cap:', rep.short_version.length)
        }
        // cuts 의 quote 가 원문에 없으면 그 항목만 버린다 — 화면이 없는 인용을 그리지 않게
        rep.cuts = rep.cuts.filter((c) => c && typeof c.quote === 'string' && c.quote.trim().length >= 2
          && text.includes(c.quote.trim()))
      }
```

- [ ] **Step 3: 저장·반환에 동봉**

p-4 의 `result:` 와 `return json({...})` 를 이렇게 바꾼다.

```ts
        result: {
          strengths: rep.strengths, improvements: rep.improvements, rewrites: rep.rewrites,
          ...(targetSec ? {
            target_sec: targetSec, target_chars: POLISH_TARGET_CHARS[targetSec],
            short_version: rep.short_version, cuts: rep.cuts,
          } : {}),
        },
```

```ts
      return json({
        ok: true, id: polishId, mode: 'polish',
        strengths: rep.strengths, improvements: rep.improvements, rewrites: rep.rewrites,
        char_count: len, answerId: targetAnswer, autoSaved,
        target_sec: targetSec || undefined,   // 리포트 머리 '30초 분량 기준' 표시용(0=자유는 안 싣는다)
        target_chars: targetSec ? POLISH_TARGET_CHARS[targetSec] : undefined,
        short_version: targetSec ? rep.short_version : undefined,   // N초 버전 카드(polish.html #verSec)
        cuts: targetSec ? rep.cuts : undefined,
        used: spent2?.used, cost: spent2?.cost, balance: spent2?.balance, daily_left: spent2?.daily_left,
      })
```

- [ ] **Step 4: 문법 확인**

`deno` 가 없으므로 괄호·백틱 균형과 변수명(`rep` 은 `let`)을 눈으로 확인한다. `rep` 이 `const` 면 `let rep = await polishFill(...)` 로 바꾼다(현재 `let`).

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/ai-killer/index.ts
git commit -m "feat(ai-killer): N초 버전 재검사·넘침 1회 재생성·cuts 인용 필터 + result·응답 동봉"
```

---

### Task 4: 화면 — CSS·마크업

**Files:**
- Modify: `polish.html` CSS(`.in-len-cap` 아래 `:123`), 결과 마크업(`.rp-top` 아래 `:454`)

- [ ] **Step 1: CSS**

`.in-len-cap { ... }` 줄 아래에 추가한다.

```css
    /* 결과 머리의 분량 전환 줄(2026-08-22) — 입력부 #lenRow 와 같은 버튼 문법 + 버튼마다 이름표
       (보는 중 / 다시 보기 / 10크레딧). 값만 남기면 오타로 읽힌다(design-principles '값에는 이름표'). */
    .rs-len { margin-top: 10px; }
    .rs-len .in-kind { margin-bottom: 0; }
    .rs-len .in-kind button { display: flex; flex-direction: column; align-items: center; justify-content: center;
                              gap: 1px; min-height: 52px; padding: 6px 2px; line-height: 1.2; }
    .rs-len .in-kind button small { font-size: 12px; font-weight: 700; color: var(--text-dim); }
    .rs-len .in-kind button.have small { color: var(--p-keep); }
    .rs-len .in-kind button.on small { color: var(--text-muted); }
    .rs-len .in-kind button:disabled { opacity: .55; cursor: default; }
    .rs-len-cap { margin-top: 7px; font-size: 13px; color: var(--text-dim); line-height: 1.5; }
    .notice .lnk { display: inline-flex; align-items: center; min-height: 44px; padding: 0; margin-left: 4px;
                   font: inherit; font-weight: 800; color: inherit; background: none; border: 0;
                   text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
    /* N초 버전 카드 — 학생 재료만으로 통째 재구성한 답변 + 덜어낸 대목. 복사 버튼은 두지 않는다('첨삭의 선'). */
    .ver { background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--accent-ink);
           border-radius: var(--radius-sm); padding: 14px; margin-top: 14px; }
    .ver-h { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .ver-t { font-size: 16px; font-weight: 800; }
    .ver-n { font-size: 13px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
    .ver-body { margin-top: 10px; padding: 12px 13px; background: var(--p-fix-bg); border-radius: var(--radius-xs);
                font-size: 16px; font-weight: 600; line-height: 1.75; white-space: pre-wrap; word-break: keep-all; }
    .ver-cuts { margin-top: 10px; }
    .ver-cuts .lbl { font-size: 13px; font-weight: 800; color: var(--text-dim); margin-bottom: 2px; }
    .ver-cut { font-size: 14px; line-height: 1.6; padding: 7px 0; border-top: 1px dashed var(--border-soft); }
    .ver-cut em { display: block; font-style: normal; color: var(--text-muted);
                  text-decoration: line-through; text-decoration-color: rgba(192,57,43,.45); }
    .ver-cut span { display: block; color: var(--text); margin-top: 2px; }
    .ver .notice { margin-top: 10px; }
```

그리고 기존 `.rw-fix .blank { ... }` 선택자를 `.rw-fix .blank, .ver-body .blank { ... }` 로 바꾼다.

- [ ] **Step 2: 마크업**

`<div class="rp-top">…</div>` 바로 아래(`<div id="dirSec">` 위)에 넣는다.

```html
      <!-- 분량 전환(2026-08-22) — 같은 글을 다른 분량으로. 받은 분량은 저장 결과 재사용(무차감),
           없는 분량은 재첨삭(10크레딧). 면접 답변 + 서버 features 'polish_length_version' 일 때만 —
           구버전 함수는 N초 버전 칸을 안 돌려줘 "눌렀는데 똑같다"가 된다(프로브 게이트와 한 쌍). -->
      <div class="rs-len hidden" id="rsLen">
        <div class="in-kind" role="group" aria-label="다른 분량으로 보기" id="rsLenBtns"></div>
        <div class="rs-len-cap">다른 분량으로도 볼 수 있어요 — 이미 받은 분량은 크레딧이 안 나가요</div>
        <div class="waitbox hidden" id="rsWait" aria-live="polite"></div>
        <div id="rsLenNotice"></div>
      </div>

      <!-- N초 버전 — 분량을 고른 리포트에만. 내용은 renderVer() 가 그린다 -->
      <div class="ver hidden" id="verSec"></div>
```

- [ ] **Step 3: 커밋**

```bash
git add polish.html
git commit -m "feat(polish): 결과 화면 분량 줄·N초 버전 카드 — CSS·마크업"
```

---

### Task 5: 화면 — 상태·도우미(rowToReport·renderVer·paintRsLen·loadLenCache·startWait 대상)

**Files:**
- Modify: `polish.html` 상태 변수(`:535-540`), `checkReady()`(`:560-566`), `startWait/stopWait/waitPaint`(`:919-941`), `showResult()` 앞에 도우미 추가

- [ ] **Step 1: 상태 변수**

`let _lenReady = false;` 줄 아래에 추가한다.

```js
    let _lenVerReady = false;   // 서버가 N초 버전(polish_length_version)을 아는가 — 모르면 결과 화면 분량 줄을 안 그린다
    let _lastReport = null;     // 지금 보고 있는 리포트(showResult 인자) — 재첨삭이 원문·분량을 여기서 읽는다
    let _byLen = {};            // { [sec]: report } — 같은 글로 받은 분량별 리포트(세션 + 저장분). 글이 바뀌면 비운다
    const LEN_OPTS = [0, 20, 30, 40];   // 결과 화면 분량 버튼 — 입력부 #lenRow 와 같은 네 값
```

- [ ] **Step 2: checkReady 게이트**

`_lenReady = ...` 줄 아래에 추가한다.

```js
        _lenVerReady = !!(data && Array.isArray(data.features) && data.features.includes('polish_length_version'));
```

- [ ] **Step 3: 대기 표시를 대상 지정형으로**

`let _waitTimers = [];` 아래 `waitPaint`·`startWait`·`stopWait` 를 이렇게 바꾼다(입력 화면 `#waitBox`·결과 화면 `#rsWait` 둘 다 쓴다).

```js
    let _waitTimers = [];
    let _waitBox = 'waitBox';   // 지금 그리는 대기 칸 id — 입력 화면 waitBox / 결과 화면 rsWait
    function waitPaint(k) {
      $(_waitBox).querySelectorAll('.wst').forEach((r, j) => {
        r.classList.toggle('done', j < k);
        r.classList.toggle('act', j === k);
      });
    }
    function startWait(boxId) {
      _waitBox = boxId || 'waitBox';
      $(_waitBox).innerHTML = WAIT_STEPS.map((s) =>
        '<div class="wst"><span class="ic"></span>' + s
        + '<span class="dots"><i></i><i></i><i></i></span></div>').join('')
        + '<div class="wait-foot">보통 30초~1분 걸려요 · 결과가 오면 바로 열려요</div>'
        + '<div class="wait-hold hidden" id="waitHold">거의 다 됐어요 — 조금만 더 기다려 주세요</div>';
      $(_waitBox).classList.remove('hidden');
      waitPaint(0);
      WAIT_AT.forEach((ms, k) => { if (k) _waitTimers.push(setTimeout(() => waitPaint(k), ms)); });
      _waitTimers.push(setTimeout(() => $('waitHold').classList.remove('hidden'), 50000));
    }
    function stopWait() {
      _waitTimers.forEach(clearTimeout); _waitTimers = [];
      $(_waitBox).classList.add('hidden');
      $(_waitBox).innerHTML = '';   // 비워 둔다 — 두 칸이 같은 #waitHold 를 쓰므로 옛 칸이 남으면 $('waitHold') 가 엉뚱한 걸 잡는다
      $('goBtn').classList.remove('going');
    }
```

- [ ] **Step 4: 도우미 넷**

`function showResult(r) {` 바로 **위**에 추가한다.

```js
    // ── 분량 전환(2026-08-22) — 저장 행 → 리포트 객체(handleEntry ?polish= 와 loadLenCache 가 같이 쓴다)
    function rowToReport(d) {
      const r = d.result || {};
      return {
        ok: true, strengths: r.strengths || [], improvements: r.improvements || [], rewrites: r.rewrites || [],
        short_version: r.short_version || '', cuts: r.cuts || [], target_chars: r.target_chars || '',
        char_count: d.char_count, _when: d.created_at, target_sec: r.target_sec || 0,
        _text: d.content || '',   // 기록된 원문 — 제자리 펼침 복원 + '같은 글' 판정 기준
        _title: _answerTitle || '',
      };
    }

    // N초 버전 카드 — 분량 리포트에 short_version 이 있을 때만. 자유 리포트·옛 분량 리포트는 숨긴다.
    function renderVer(r) {
      const el = $('verSec');
      const sv = String(r.short_version || '').trim();
      if (!sv || !r.target_sec) { el.classList.add('hidden'); el.innerHTML = ''; return; }
      const cuts = (r.cuts || []).filter((c) => c && c.quote);
      el.innerHTML = '<div class="ver-h"><span class="ver-t">' + r.target_sec + '초 버전 — 내 글로만 다시 구성</span>'
        + '<span class="ver-n">' + (r.target_chars ? '목표 ' + esc(r.target_chars) + ' · ' : '') + '지금 ' + sv.length + '자</span></div>'
        + '<div class="ver-body">' + markBlanks(esc(sv)) + '</div>'
        + (cuts.length
            ? '<div class="ver-cuts"><div class="lbl">덜어낸 대목 ' + cuts.length + '곳</div>'
              + cuts.map((c) => '<div class="ver-cut"><em>' + esc(c.quote) + '</em><span>' + esc(c.why) + '</span></div>').join('')
              + '</div>'
            : '')
        + '<p class="notice info">고친 예시는 <b>방향</b>이에요. (괄호 빈칸)은 내 경험으로 채우고, 내 말투로 다시 다듬어 주세요.</p>';
      el.classList.remove('hidden');
    }

    // 분량 버튼 줄 — 면접 답변 + 신버전 함수일 때만. 버튼마다 '보는 중 / 다시 보기 / N크레딧' 이름표.
    function paintRsLen() {
      const r = _lastReport;
      const show = !!r && _lenVerReady && _kind === 'interview';
      $('rsLen').classList.toggle('hidden', !show);
      if (!show) return;
      const cur = Number(r.target_sec) || 0, cost = polishCost();
      $('rsLenBtns').innerHTML = LEN_OPTS.map((s) => {
        const have = !!_byLen[s], on = s === cur;
        return '<button type="button" data-rsec="' + s + '" class="' + (on ? 'on' : '') + (have ? ' have' : '') + '"'
          + ' aria-pressed="' + (on ? 'true' : 'false') + '"' + (_busy ? ' disabled' : '') + '>'
          + (s ? s + '초' : '자유')
          + '<small>' + (on ? '보는 중' : (have ? '다시 보기' : cost + '크레딧')) + '</small></button>';
      }).join('');
    }

    // 저장분으로 '받은 분량' 채우기 — 원문(content)이 지금 리포트와 **정확히 같은** 행만 센다
    // (옛 글의 20초 버전을 지금 글의 것처럼 보여주면 안 된다). 분량>0 인데 short_version 이 없는
    // 2026-08-21a 이전 행은 안 센다 — 그 분량을 누르면 새 버전을 10크레딧에 받는다.
    // 조회 실패(미적용·네트워크)면 세션 캐시만으로 동작 — 서버가 어차피 매번 차감하므로 거짓 무료는 없다.
    async function loadLenCache(r) {
      const text = String(r && r._text || '');
      if (!_answerId || !text) return;
      const aid = _answerId;
      try {
        const { data } = await MONC.sb.from('answer_polishes').select('*')
          .eq('answer_id', aid).order('created_at', { ascending: false }).limit(40);
        if (aid !== _answerId || !_lastReport || _lastReport._text !== text) return;   // 그새 다른 글로 넘어갔다
        (data || []).forEach((d) => {
          if ((d.content || '') !== text) return;
          const res = d.result || {};
          const sec = Number(res.target_sec) || 0;
          if (sec && !res.short_version) return;
          if (!_byLen[sec]) _byLen[sec] = rowToReport(d);
        });
      } catch (_) { /* 미적용·네트워크 — 세션 캐시만으로 동작 */ }
      paintRsLen();
    }
```

- [ ] **Step 5: 커밋**

```bash
git add polish.html
git commit -m "feat(polish): 분량 전환 상태·도우미(rowToReport·renderVer·paintRsLen·loadLenCache) + 대기 칸 대상 지정"
```

---

### Task 6: 화면 — showResult 연결·switchLen·충전 이동·배선·진입 정리

**Files:**
- Modify: `polish.html` `showResult()`(`:796`·끝 `:877`), `run()`(`:975`), 배선(`:1137`), `handleEntry()`(`:1160-1180`)

- [ ] **Step 1: showResult 머리·꼬리**

`function showResult(r) {` 첫 줄들을 이렇게 바꾼다.

```js
    function showResult(r) {
      $('inputView').classList.add('hidden');
      $('resultView').classList.remove('hidden');
      closeAcc();
      _lastReport = r;
      _byLen[Number(r.target_sec) || 0] = r;   // 이 글로 받은 분량 — 다시 누르면 무차감 재사용
      $('rsLenNotice').innerHTML = '';
      renderVer(r);
      paintRsLen();
```

그리고 `showResult` 끝의 `document.documentElement.scrollTop = 0;` 은 그대로 둔다.

- [ ] **Step 2: run() — 새 글은 캐시를 비운다**

`run()` 의 `showResult(data);` 앞에 한 줄 넣는다.

```js
        _byLen = {};   // 입력 화면에서 온 첨삭은 새 기준 글 — 옛 분량 캐시를 버린다
        showResult(data);
        loadLenCache(data);   // 저장분에서 같은 글의 다른 분량을 찾는다(기다리지 않는다)
```

- [ ] **Step 3: switchLen·goCharge**

`// ── 충전(포트원)` 주석 **위**에 추가한다.

```js
    // ── 분량 전환 — 받은 분량은 즉시, 없는 분량은 같은 입력에 targetSec 만 바꿔 재첨삭(10크레딧) ──
    async function switchLen(sec) {
      if (_busy || !_lastReport) return;
      const cached = _byLen[sec];
      if (cached) { showResult(cached); return; }
      const text = String(_lastReport._text || '').trim();
      if (text.length < MIN || text.length > MAX) {
        $('rsLenNotice').innerHTML = '<div class="notice warn">이 리포트에는 원문이 없어 다른 분량으로 다시 받을 수 없어요. 새 첨삭으로 받아 주세요.</div>';
        return;
      }
      _busy = true; paintRsLen(); $('againBtn').disabled = true; $('rsLenNotice').innerHTML = '';
      startWait('rsWait');
      try {
        const { data, error } = await MONC.sb.functions.invoke('ai-killer', {
          body: {
            mode: 'polish',
            source: _answerId ? 'answer' : 'paste', text, answerId: _answerId,
            question: $('qIn').value.trim(), docKind: _kind, airline: _air,
            targetSec: sec,
          },
        });
        if (error || !data) throw new Error('invoke_failed');
        if (!data.ok) {
          $('rsLenNotice').innerHTML = '<div class="notice warn">' + esc(data.error || '첨삭에 실패했어요.')
            + (data.code === 'no_credit' ? '<button type="button" class="lnk" id="rsCharge">충전하러 가기</button>' : '')
            + '</div>';
          return;
        }
        if (data.answerId) _answerId = data.answerId;
        data._title = _lastReport._title || '';
        data._text = text;
        showResult(data);
      } catch (_) {
        $('rsLenNotice').innerHTML = '<div class="notice warn">첨삭에 실패했어요. 잠시 뒤 다시 시도해 주세요. '
          + '크레딧이 차감됐다면 자동으로 돌려드립니다.</div>';
      } finally {
        _busy = false; stopWait(); $('againBtn').disabled = false; paintRsLen();
        await loadBalance();
      }
    }

    // 충전함은 입력 화면에만 있다(복제하지 않는다) — 글을 채워 두고 입력 화면으로 돌아가 충전함을 연다
    function goCharge() {
      if (!$('ta').value.trim() && _lastReport) { $('ta').value = String(_lastReport._text || ''); onInput(); }
      $('resultView').classList.add('hidden');
      $('inputView').classList.remove('hidden');
      $('chargeBox').classList.add('open');
      $('chargeBox').scrollIntoView({ block: 'start' });
    }
```

- [ ] **Step 4: 배선**

`$('lenRow').addEventListener('click', ...)` 블록 **뒤**, `$('againBtn')` 배선 **앞**에 추가하고, `againBtn` 핸들러에 캐시 초기화를 더한다.

```js
    $('rsLenBtns').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rsec]');
      if (b && !b.disabled) switchLen(Number(b.dataset.rsec) || 0);
    });
    $('rsLenNotice').addEventListener('click', (e) => { if (e.target.closest('#rsCharge')) goCharge(); });
```

```js
    $('againBtn').addEventListener('click', () => {
      $('resultView').classList.add('hidden');
      $('inputView').classList.remove('hidden');
      // ⚠️ 종류·항공사는 그대로 둔다 — 다음 글도 같은 조건일 확률이 훨씬 높다.
      _answerId = null; _answerTitle = '';
      _lastReport = null; _byLen = {};   // 분량 캐시는 글에 묶인다 — 새 글이면 버린다
      $('ta').value = ''; $('qIn').value = ''; onInput(); refresh();
      document.documentElement.scrollTop = 0;
    });
```

- [ ] **Step 5: handleEntry — rowToReport 재사용 + 항공사 복원 + 캐시**

`?polish=` 분기의 `if (data) { ... }` 를 이렇게 바꾼다.

```js
          if (data) {
            if (data.doc_kind) setKind(data.doc_kind);
            setAir(data.airline || '');   // 재첨삭이 같은 항공사로 가야 한다
            $('qIn').value = data.question || '';
            _answerId = data.answer_id || null;
            const rep = rowToReport(data);
            _byLen = {};
            showResult(rep);
            loadLenCache(rep);
            return true;
          }
```

- [ ] **Step 6: 문법 확인**

`node -e "..."` 로 스크립트 블록만 파싱해 본다(스크래치패드에 추출).

```bash
python - <<'EOF'
import re,io
src=open('polish.html',encoding='utf-8').read()
blocks=re.findall(r'<script>(.*?)</script>',src,re.S)
open(r'C:/Users/cheess/AppData/Local/Temp/claude/C--Users-cheess-Documents-GitHub-wkon--claude-worktrees-answer-review-length-selection-02e6fa/42f156b8-338c-4c29-aa33-703c6b620a08/scratchpad/polish-main.js','w',encoding='utf-8').write(blocks[-1])
EOF
node --check "C:/Users/cheess/AppData/Local/Temp/claude/C--Users-cheess-Documents-GitHub-wkon--claude-worktrees-answer-review-length-selection-02e6fa/42f156b8-338c-4c29-aa33-703c6b620a08/scratchpad/polish-main.js" && echo OK
```
Expected: `OK`

- [ ] **Step 7: 커밋**

```bash
git add polish.html
git commit -m "feat(polish): 결과 화면 분량 전환 — 받은 분량 즉시·없는 분량 재첨삭·충전 이동·이력 복원 연결"
```

---

### Task 7: 스텁 하네스 375px 실측 + 오너 목업

**Files:**
- Create(임시·커밋 금지): 스크래치패드 `__polish-test.html`, `__wrap.html`, `shot.py`

- [ ] **Step 1: 스텁 사본 만들기**

`polish.html` 을 복사해 `supabase-config.js` 태그 **뒤**에 스텁을 끼운다(파이썬으로 생성 — PowerShell `Get-Content` 는 `-Encoding UTF8` 필수). 스텁은 `?state=` 로 세 상태를 낸다: `free`(자유 리포트 보는 중·20초는 저장분 있음) · `len30`(30초 리포트 보는 중 + N초 버전·덜어낸 대목 2곳) · `wait`(재첨삭 대기 중 — invoke 가 영영 안 돌아온다).

```python
# make-test.py — 스크래치패드에서 실행. 레포 polish.html → 같은 폴더의 __polish-test.html(커밋 금지)
import re, pathlib
repo = pathlib.Path(r'C:/Users/cheess/Documents/GitHub/wkon/.claude/worktrees/answer-review-length-selection-02e6fa')
src = (repo/'polish.html').read_text(encoding='utf-8')
STUB = r'''<script>
(function(){
  const q = new URLSearchParams(location.search); const state = q.get('state') || 'free';
  const TEXT = '저는 작년 카페에서 일하며 단골손님의 이름을 외우는 습관을 들였습니다. 처음에는 어색했지만 손님들이 먼저 인사를 건네기 시작했고, 매출도 조금 올랐습니다. 한 번은 비 오는 날 우산이 없는 손님께 제 우산을 빌려드렸는데 다음 날 따뜻한 커피와 함께 돌려주셨습니다. 이런 경험에서 저는 작은 관심이 관계를 바꾼다는 것을 배웠습니다. 승무원이 되어서도 승객 한 분 한 분을 기억하는 사람이 되고 싶습니다.';
  const BASE = { ok:true, strengths:[{quote:'손님들이 먼저 인사를 건네기 시작했고', note:'결과를 장면으로 보여줘서 믿음이 가요.'}],
    improvements:[{note:'일화가 둘이라 말이 길어져요.', how:'우산 일화 하나로 좁혀 보세요.'}],
    rewrites:[{quote:'이런 경험에서 저는 작은 관심이 관계를 바꾼다는 것을 배웠습니다.', fix:'그날 이후로 저는 손님 한 분의 얼굴을 먼저 떠올리게 됐어요.', why:'배운 점을 설명 대신 행동으로 보여주는 각도예요.'}],
    char_count: TEXT.length, answerId:'a1' };
  const R30 = Object.assign({}, BASE, { target_sec:30, target_chars:'150~180자',
    short_version:'카페에서 일할 때 비 오는 날 우산이 없는 손님께 제 우산을 빌려드린 적이 있습니다. 다음 날 그분이 따뜻한 커피와 함께 돌려주셨어요. 그때 작은 관심이 관계를 바꾼다는 걸 배웠고, 승무원이 되어서도 승객 한 분 한 분을 기억하는 사람이 되고 싶습니다.',
    cuts:[{quote:'처음에는 어색했지만 손님들이 먼저 인사를 건네기 시작했고, 매출도 조금 올랐습니다.', why:'결과 설명이라 우산 장면 하나로 충분해요.'},
          {quote:'단골손님의 이름을 외우는 습관을 들였습니다.', why:'일화가 둘이면 하나만 남기는 게 짧은 답에 맞아요.'}] });
  const ROWS = [ { id:'p1', answer_id:'a1', content:TEXT, created_at:'2026-08-22T01:00:00Z', char_count:TEXT.length, result:{ strengths:BASE.strengths, improvements:BASE.improvements, rewrites:BASE.rewrites, target_sec:20, target_chars:'100~120자', short_version:'비 오는 날 우산이 없는 손님께 제 우산을 빌려드렸고, 다음 날 커피와 함께 돌려받았습니다. 작은 관심이 관계를 바꾼다는 걸 배웠습니다.', cuts:[] } } ];
  const chain = (rows) => { const c = { eq(){return c;}, order(){return c;}, limit(){return c;}, maybeSingle(){return Promise.resolve({data:rows[0]||null});}, then(res){return Promise.resolve({data:rows}).then(res);} }; return c; };
  window.MONC = {
    requireSession: async () => ({ user:{ id:'u1' } }), getSession: async () => ({ user:{ id:'u1' } }), requireConsent: async () => true,
    sb: {
      functions: { invoke: async (_n, { body }) => {
        if (body && body.probe) return { data:{ version:'2026-08-22a', features:['polish','polish_length','polish_length_version'], polish_table:1 } };
        if (state === 'wait') return new Promise(() => {});
        return { data: Object.assign({}, body.targetSec === 30 ? R30 : BASE, { target_sec: body.targetSec || undefined }) };
      } },
      rpc: async (n) => n === 'credit_wallet' ? { data:{ balance:37, costs:{ polish:10 }, polish_free_left:0 } } : { data:null },
      from: (t) => ({ select: () => chain(t === 'answer_polishes' ? ROWS : (t === 'site_config' ? [] : [])) }),
    },
  };
  window.__STATE = state; window.__TEXT = TEXT; window.__R30 = R30;
})();
</script>'''
out = src.replace('<script src="supabase-config.js"></script>', '<script src="supabase-config.js"></script>\n' + STUB, 1)
# 진입 블록 뒤에 상태별 트리거를 단다 — 첨삭 실행 함수는 IIFE 안이라 화면의 버튼을 눌러 태운다
TRIG = r'''<script>
window.addEventListener('load', () => setTimeout(() => {
  const st = window.__STATE;
  document.getElementById('ta').value = window.__TEXT;
  document.getElementById('ta').dispatchEvent(new Event('input'));
  if (st === 'len30') document.querySelector('#lenRow [data-sec="30"]').click();
  document.getElementById('goBtn').click();
  if (st === 'wait') setTimeout(() => document.querySelector('#rsLenBtns [data-rsec="40"]').click(), 800);
}, 600));
</script>'''
out = out.replace('</body>', TRIG + '\n</body>', 1)
(pathlib.Path(__file__).parent/'__polish-test.html').write_text(out, encoding='utf-8')
print('ok')
```

하네스 파일은 레포 루트에서 서빙돼야 `tokens.css`·`nav.js` 가 잡힌다 — 스크래치패드에서 만든 뒤 **레포 루트로 복사**(`__polish-test.html` — 검증 끝나면 삭제, 커밋 금지).

- [ ] **Step 2: 프리뷰로 렌더·계측**

`preview_start {name:"wkon-static"}` → `navigate http://localhost:5500/__polish-test.html?state=len30`. 계측은 `javascript_tool` 로:

```js
(() => {
  const q = (s) => document.querySelector(s);
  const r = (el) => el && el.getBoundingClientRect();
  const btns = [...document.querySelectorAll('#rsLenBtns button')];
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    rsLenVisible: q('#rsLen') && getComputedStyle(q('#rsLen')).display !== 'none',
    btn: btns.map((b) => ({ t: b.textContent, h: Math.round(r(b).height), on: b.classList.contains('on'), have: b.classList.contains('have'), dis: b.disabled })),
    verVisible: q('#verSec') && getComputedStyle(q('#verSec')).display !== 'none',
    verTitle: q('.ver-t') && q('.ver-t').textContent, verN: q('.ver-n') && q('.ver-n').textContent,
    cuts: document.querySelectorAll('.ver-cut').length,
    smallPx: btns.length ? getComputedStyle(btns[0].querySelector('small')).fontSize : null,
    rpSub: q('#rpSub').textContent,
    errors: 0,
  };
})()
```
Expected(len30): `overflow 0` · `rsLenVisible true` · 버튼 4개 높이 ≥52 · 30초 `on` + '보는 중' · 20초 `have`(저장분) '다시 보기' · 자유·40초 '10크레딧' · `verVisible true` · `verTitle '30초 버전 — 내 글로만 다시 구성'` · `cuts 2` · `smallPx '12px'` · rpSub 에 '30초 분량 기준'.
`?state=free`: `verVisible false` · 자유 `on` '보는 중' · 20초 '다시 보기'. 그 상태에서 `#rsLenBtns [data-rsec="20"]` 클릭 → 즉시 20초 리포트(invoke 안 탐 — `verTitle '20초 버전…'`, cuts 0 → `.ver-cuts` 없음).
`?state=wait`: `#rsWait` 보임·`.wst.act` 1개 · 버튼 전부 `disabled` · `#againBtn.disabled true`.
`read_console_messages onlyErrors` → 0건. 320px 도 `resize_window` 로 한 번(overflow 0).

- [ ] **Step 3: 375px 스크린샷(오너 목업)**

`__wrap.html`(레포 루트·임시): `<iframe src="__polish-test.html?state=len30" style="width:375px;height:1400px;border:0">` 를 헤드리스 크롬으로 찍는다.

```bash
"/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --hide-scrollbars --window-size=420,1500 --screenshot="<스크래치패드>/len30.png" "http://localhost:5500/__wrap.html?state=len30"
```
(`__wrap.html` 은 `location.search` 를 iframe src 에 그대로 넘긴다.) `free`·`wait` 도 같은 방식. 셋을 `SendUserFile` 로 보여주고 **오너 승인까지 push 하지 않는다.**

- [ ] **Step 4: 임시 파일 제거**

레포 루트의 `__polish-test.html`·`__wrap.html` 삭제. `git status` 로 깨끗한지 확인.

---

### Task 8: 문서 + 최종 커밋

**Files:**
- Modify: `docs/notes/polish.md`(맨 위에 새 절), `docs/notes/implementation-status.md:23`(ai-killer 행)

- [ ] **Step 1: polish.md 새 절**

파일 제목 아래, `## 2026-08-21 말하기 분량 옵션` 절 **위**에 넣는다.

```markdown
## 2026-08-22 결과 화면 분량 전환 + 'N초 버전' (오너 "결과물에서도 다른 길이를 바로 볼 수 있게 — 크레딧을 사용해서")

설계서 `docs/superpowers/specs/2026-08-22-polish-length-switch-design.md`. 오너 확정 둘: **이미 받은
분량은 저장 결과 재사용(무차감)·새 분량만 10크레딧** / **분량 리포트에 'N초 버전' 한 덩어리를 더 준다**(A안 —
문장 단위 첨삭만으로는 "20초면 이 답변이 통째로 어떻게 되는지"를 못 보여줘 학생이 조각을 조립해야 했다).

- **결과 머리 아래 `#rsLen`**: 자유·20·30·40초(`LEN_OPTS`) 버튼 줄. 버튼마다 이름표 — 보는 중 / 다시 보기(받은
  분량·무차감) / `polishCost()`크레딧(없는 분량). 노출은 **면접 답변 + 프로브 features `polish_length_version`**
  (`_lenVerReady`) — 구버전 함수는 N초 버전 칸을 안 돌려줘 "눌렀는데 똑같다"가 된다. 입력부 `#lenRow` 게이트
  (`polish_length`)는 별개로 유지.
- **받은 분량 판정 `_byLen`**: 세션에서 받은 리포트 + `loadLenCache()` 가 `answer_polishes` 에서 **원문(content)이
  지금 리포트와 정확히 같은 행만** 분량별로 채운다(옛 글의 20초 버전을 지금 글의 것처럼 보여주지 않기 위해).
  분량>0 인데 `short_version` 이 없는 2026-08-21a 이전 행은 안 센다(누르면 새 버전을 10크레딧에). 조회 실패면
  세션 캐시만 — 서버가 어차피 매번 차감하므로 거짓 무료는 없다. 글이 바뀌면(`run()`·'새 첨삭'·`?polish=`) 비운다.
- **재첨삭 `switchLen(sec)`**: 같은 원문(`_lastReport._text`)·문항·항공사·`answerId`·글 종류에 `targetSec` 만 바꿔
  서버 호출 — 차감 키는 기존 `${answer}#p${prev}` 그대로(새 분량 = 새 첨삭 = 10크레딧). 대기는 결과 화면 안
  `#rsWait`(`startWait('rsWait')` — 대기 칸이 대상 지정형이 됐다), 대기 중 분량 버튼·'새 첨삭' 잠금.
  `no_credit` 이면 '충전하러 가기' → `goCharge()` 가 글을 채워 두고 입력 화면 충전함을 연다(충전함 복제 안 함).
- **'N초 버전' 카드 `#verSec`**(`renderVer`): 제목 `N초 버전 — 내 글로만 다시 구성` + `목표 150~180자 · 지금 N자`,
  본문(`short_version`, 괄호 빈칸 표시), '덜어낸 대목 N곳'(`cuts` quote 취소선 + why), 주의 문구 동일. 복사 버튼 없음.
- **서버**: 분량 있을 때만 `POLISH_SCHEMA_LEN`(`short_version`·`cuts` required). 프롬프트 `[목표 분량]` 에 남기는
  순서(답 한 문장 → 행동·장면 하나 → 결과 한 문장), 먼저 빼는 것(배경·반복·수식어·둘째 일화), 재료 제한, **이미
  짧으면 늘리지 마라**, cuts 규칙 + `[할 일]` 끝 재고지. 자기 재검사에 `short_version`·`cuts.why` 포함.
  `short_version` 이 `POLISH_TARGET_MAX × 1.3` 을 넘으면 **한 번** 재생성(그래도 넘치면 그대로 반환·로그). `cuts`
  는 원문에 없는 인용을 서버가 버린다. 저장은 `result` jsonb(`target_sec`·`target_chars`·`short_version`·`cuts`) —
  컬럼 추가 없음. `FN_VERSION` **`2026-08-22a`**, features `polish_length_version`. 오너 콘솔 재배포 필요.
- 검증: 스텁 사본 `__polish-test.html?state=free|len30|wait` 375/320px 실측(분량 줄·이름표·즉시 전환·대기 잠금·
  카드·오버플로 0·콘솔 에러 0). 프롬프트 실측(배포 뒤 같은 글 20·30·40)은 배포 후 이 절에 추가한다.
```

- [ ] **Step 2: implementation-status.md**

ai-killer 행의 첫 문장을 이렇게 바꾼다(나머지는 그대로).

```
**레포 = `2026-08-22a`(첨삭 분량 전환 + N초 버전 `polish_length_version`) — 오너 콘솔 재배포 필요. 미배포여도 안전하다 — 결과 화면 분량 줄은 프로브에 `polish_length_version` 이 있어야만 그려진다. 앞선 `2026-08-21a`(`polish_length`)는 오너 배포 보고(2026-08-21).** ⚠️ 이 세션 프록시가 ...
```

- [ ] **Step 3: 커밋**

```bash
git add docs/notes/polish.md docs/notes/implementation-status.md
git commit -m "docs: 첨삭 결과 화면 분량 전환·N초 버전 기록 + ai-killer 2026-08-22a 배포 상태"
```

- [ ] **Step 4: 오너 승인 뒤 main 병합·푸시** — 브랜치에서 `git checkout main && git merge --ff-only claude/answer-review-length-selection-02e6fa && git push origin main`(워크트리라 main 체크아웃이 막히면 레포 루트에서). 푸시 뒤 오너에게 ai-killer 함수 재배포를 요청한다(콘솔 — CLI 안내 금지).
