// =============================================================================
// Supabase Edge Function: portone-webhook — 포트원 결제 웹훅 (2026-08-10)
// =============================================================================
// 왜 필요한가: 지급은 지금까지 **브라우저가 돌아와서** verify-payment 를 불러야 일어났다.
// pay-pending.js(미결 기록 자가 회복)로 대부분 막았지만, 결제 후 그 브라우저로 영영
// 안 돌아오는 극단 케이스는 남는다. 이 함수는 포트원이 서버로 직접 쏘는 결제 통보를 받아
// **브라우저와 무관하게** 지급을 끝낸다 — 유실률 0% 의 마지막 조각.
//
// 동작: 통보 본문은 방아쇠로만 쓴다(본문 불신 — 포트원 권장). paymentId 만 꺼내
//       포트원 API 로 결제를 다시 조회하고, 결제 생성 때 실어 둔 customData(k=종류)로
//       무엇을 지급할지 정한다. 금액은 언제나 DB 가 신뢰 소스.
//
// 멱등성: 모든 지급이 payment_id 사전 확인 + DB 유니크로 두 번 들어가지 않는다 —
//       브라우저의 verify-payment 와 이 웹훅이 동시에 달려도 한 번만 지급된다.
// 재시도: 일시 오류(조회 실패·DB 오류)는 non-2xx 로 답한다 — 포트원이 알아서 재시도한다.
//       확정 상황(미결제·모름·이미 지급)은 200 으로 접는다.
//
// ⚠️ 배포 시 이 함수만 **JWT 검증을 꺼야 한다**(대시보드 > Edge Functions >
//    portone-webhook > 설정 > Verify JWT 끄기). 포트원은 Supabase 키를 모른다.
// ⚠️ 포트원 콘솔 > 웹훅에 이 주소를 등록해야 동작한다:
//    https://<프로젝트>.supabase.co/functions/v1/portone-webhook
//    콘솔의 웹훅 시크릿을 Supabase Secrets 의 PORTONE_WEBHOOK_SECRET 에 넣으면
//    서명까지 검증한다(없어도 안전하다 — 어차피 본문을 안 믿고 API 로 재조회한다).
// ⚠️ 실어 둔 맥락(customData.k)이 없는 옛 결제는 지급하지 못하고 접는다(200 + skip) —
//    그 결제들은 기존 경로(브라우저 확인·자가 회복·admin 수동 지급)가 처리한다.
// 배포 확인: POST {"probe":true} → version.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FN_VERSION = '2026-08-10a'
const PORTONE_STORE_ID = 'store-a2a17822-a4c8-4d25-ac38-939772dfb6d5'
const PRICE_PER_CHALLENGE_FALLBACK = 33000   // ⚠️ apply.html·verify-payment 와 같은 값 유지

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// verify-payment 와 같은 자동 환불 — 결제는 됐는데 지급이 확정적으로 막힌 경우에만 쓴다.
// deno-lint-ignore no-explicit-any
async function refundAll(
  supa: any, paymentId: string, amount: number, reason: string,
): Promise<boolean> {
  try {
    const secret = Deno.env.get('PORTONE_API_SECRET')
    if (!secret) return false
    const res = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}/cancel`, {
      method: 'POST',
      headers: { Authorization: `PortOne ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: PORTONE_STORE_ID, amount, reason }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { console.error('webhook auto refund failed', res.status, body); return false }
    await supa.from('refunds').insert({
      application_id: null, amount, reason,
      portone_response: (body as Record<string, unknown>)?.cancellation || body || null,
    })
    return true
  } catch (e) {
    console.error('webhook auto refund exception', e)
    return false
  }
}

// 웹훅 서명 검증(standard-webhooks · 포트원 V2) — 시크릿이 설정된 경우에만.
// 서명 = base64(HMAC-SHA256(`${id}.${timestamp}.${body}`, base64decode(시크릿)))
async function sigOk(secretRaw: string, req: Request, rawBody: string): Promise<boolean> {
  try {
    const id = req.headers.get('webhook-id') || ''
    const ts = req.headers.get('webhook-timestamp') || ''
    const sigHeader = req.headers.get('webhook-signature') || ''
    if (!id || !ts || !sigHeader) return false
    // 오래된 통보 재전송 방어 — 5분 밖이면 버린다
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
    const secret = secretRaw.startsWith('whsec_') ? secretRaw.slice(6) : secretRaw
    const keyBytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0))
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${rawBody}`)))
    let b = ''; for (const x of mac) b += String.fromCharCode(x)
    const expect = btoa(b)
    // 헤더는 "v1,서명" 이 공백으로 여러 개 올 수 있다
    return sigHeader.split(' ').some((part) => part.split(',').pop() === expect)
  } catch (_) { return false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const raw = await req.text()
  // deno-lint-ignore no-explicit-any
  let body: any = {}
  try { body = JSON.parse(raw || '{}') } catch (_) { /* 빈 본문도 아래에서 접힌다 */ }

  if (body.probe === true) {
    return json({ ok: true, fn: 'portone-webhook', version: FN_VERSION,
      has_secret: !!Deno.env.get('PORTONE_WEBHOOK_SECRET') })
  }

  // 서명 검증 — 시크릿이 있으면 필수. 없으면 통과(본문은 어차피 안 믿는다).
  const whSecret = Deno.env.get('PORTONE_WEBHOOK_SECRET')
  if (whSecret && !(await sigOk(whSecret, req, raw))) {
    return json({ ok: false, error: 'bad_signature' }, 401)
  }

  try {
    // 포트원 V2 통보는 { type, data: { paymentId, storeId } } — 구형·수동 호출도 받아 준다
    const paymentId = String(body?.data?.paymentId || body?.paymentId || body?.payment_id || '').trim()
    if (!paymentId) return json({ ok: true, skip: 'no_payment_id' })
    const storeId = body?.data?.storeId
    if (storeId && storeId !== PORTONE_STORE_ID) return json({ ok: true, skip: 'other_store' })

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // ── 1. 결제 재조회 — 통보 본문이 아니라 이 결과가 사실이다
    const secret = Deno.env.get('PORTONE_API_SECRET')
    const res = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `PortOne ${secret}` },
    })
    if (res.status === 404) return json({ ok: true, skip: 'unknown_payment' })
    if (!res.ok) return json({ ok: false, error: 'lookup_failed' }, 502)   // 포트원이 재시도한다
    const pay = await res.json()
    if (pay.status !== 'PAID') return json({ ok: true, skip: pay.status })   // 취소·대기 통보는 접는다
    const paid = Number(pay?.amount?.total)

    // ── 2. 결제 생성 때 실어 둔 주문 맥락(customData) — 무엇을 지급할지 여기서 안다
    // deno-lint-ignore no-explicit-any
    let cd: any = {}
    try { cd = JSON.parse(String(pay?.customData ?? '') || '{}') } catch (_) { cd = {} }
    const kind = String(cd.k || '')
    if (!kind) return json({ ok: true, skip: 'no_context' })   // 맥락 없는 옛 결제 — 기존 경로가 처리

    // ═══ 연구실 자료 ═══════════════════════════════════════════════════
    if (kind === 'lab') {
      const uid = String(cd.uid || ''), rid = String(cd.rid || '')
      if (!uid || !rid) return json({ ok: true, skip: 'lab_no_target' })
      const { data: dup, error: dupErr } = await supa.from('lab_purchases')
        .select('id').eq('payment_id', paymentId).maybeSingle()
      if (dupErr) return json({ ok: false, error: 'db' }, 500)
      if (dup) return json({ ok: true, already: true })
      const { data: r0 } = await supa.from('lab_resources').select('id, price').eq('id', rid).maybeSingle()
      if (!r0 || Number(r0.price) !== paid) return json({ ok: true, skip: 'lab_price_mismatch' })
      const { error: insErr } = await supa.from('lab_purchases').insert({
        resource_id: rid, user_id: uid, amount: paid, payment_id: paymentId,
      })
      if (insErr) {
        if (insErr.code === '23505' || String(insErr.message).includes('duplicate key')) {
          // 같은 결제가 방금 먼저 들어갔으면 성공, 다른 결제로 이미 산 자료면 중복 구매 → 환불
          const { data: byPay } = await supa.from('lab_purchases')
            .select('id').eq('payment_id', paymentId).maybeSingle()
          if (byPay) return json({ ok: true, already: true })
          const refunded = await refundAll(supa, paymentId, paid, '연구실 자료 중복 구매(웹훅) · 자동 환불')
          return json({ ok: true, refunded })
        }
        return json({ ok: false, error: 'db' }, 500)
      }
      return json({ ok: true, granted: 'lab' })
    }

    // ═══ 크레딧 팩 ═══════════════════════════════════════════════════════
    if (kind === 'credit') {
      const uid = String(cd.uid || ''), pk = String(cd.pk || '')
      if (!uid || !pk) return json({ ok: true, skip: 'credit_no_target' })
      const { data: cfg } = await supa.from('site_config').select('value').eq('key', 'credit_packs').maybeSingle()
      const packs = Array.isArray(cfg?.value) ? cfg!.value as Array<Record<string, unknown>> : []
      const pack = packs.find((p) => String(p.id) === pk)
      if (!pack || Number(pack.price) !== paid) return json({ ok: true, skip: 'credit_price_mismatch' })
      const tool = String(pack.tool || 'ai_killer')
      const { data: dup, error: dupErr } = await supa.from('credit_ledger')
        .select('id').eq('tool', tool).eq('ref', paymentId).eq('reason', 'purchase').maybeSingle()
      if (dupErr) return json({ ok: false, error: 'db' }, 500)
      if (dup) return json({ ok: true, already: true })
      const { error: insErr } = await supa.from('credit_ledger').insert({
        member_id: uid, tool, delta: Number(pack.count) || 0, reason: 'purchase', ref: paymentId,
      })
      if (insErr && !String(insErr.message || '').includes('duplicate')) {
        return json({ ok: false, error: 'db' }, 500)
      }
      return json({ ok: true, granted: 'credit' })
    }

    // ═══ 답변 프로그램 이용권 ═════════════════════════════════════════════
    if (kind === 'program') {
      const uid = String(cd.uid || ''), pid = String(cd.pid || '')
      if (!uid || !pid) return json({ ok: true, skip: 'program_no_target' })
      const { data: dup, error: dupErr } = await supa.from('program_enrollments')
        .select('id').eq('payment_id', paymentId).maybeSingle()
      if (dupErr) return json({ ok: false, error: 'db' }, 500)
      if (dup) return json({ ok: true, already: true })
      const { data: prog } = await supa.from('answer_programs').select('id, price').eq('id', pid).maybeSingle()
      if (!prog || Number(prog.price) !== paid) return json({ ok: true, skip: 'program_price_mismatch' })
      const { error: insErr } = await supa.from('program_enrollments').insert({
        program_id: pid, member_id: uid, source: 'purchase', payment_id: paymentId, status: 'active',
      })
      if (insErr) {
        if (insErr.code === '23505' || String(insErr.message).includes('duplicate key')) {
          const { data: byPay } = await supa.from('program_enrollments')
            .select('id').eq('payment_id', paymentId).maybeSingle()
          if (byPay) return json({ ok: true, already: true })
          const refunded = await refundAll(supa, paymentId, paid, '답변 프로그램 중복 구매(웹훅) · 자동 환불')
          return json({ ok: true, refunded })
        }
        return json({ ok: false, error: 'db' }, 500)
      }
      return json({ ok: true, granted: 'program' })
    }

    // ═══ 특강·챌린지 — applications 저장 ═════════════════════════════════
    if (kind === 'lecture' || kind === 'challenge') {
      const name = String(cd.name || ''), phone = String(cd.phone || '')
      if (!name || !phone) return json({ ok: true, skip: 'apps_no_applicant' })
      // 같은 결제ID 재통보·브라우저 경합 — 이미 접수됐으면 끝(verify-payment 0)과 같은 확인)
      const { data: dup, error: dupErr } = await supa.from('applications')
        .select('id').eq('payment_id', paymentId).maybeSingle()
      if (dupErr) return json({ ok: false, error: 'db' }, 500)
      if (dup) return json({ ok: true, already: true })

      let expected = 0
      // deno-lint-ignore no-explicit-any
      let list: any[] = []
      let lectureIdCol: string | null = null
      let slotIdCol: string | null = null
      if (kind === 'lecture') {
        const lid = String(cd.lid || '')
        if (!lid) return json({ ok: true, skip: 'lecture_no_id' })
        const { data: lec } = await supa.from('special_lectures').select('id, title, price').eq('id', lid).maybeSingle()
        if (!lec) return json({ ok: true, skip: 'lecture_not_found' })
        expected = Number(lec.price)
        const entry: Record<string, unknown> = { type: 'lecture', lecture_id: lec.id, name: lec.title, price: lec.price }
        if (cd.slot) {
          const { data: slot } = await supa.from('lecture_slots')
            .select('id, lecture_id, slot_date, start_time, label')
            .eq('id', String(cd.slot)).eq('lecture_id', lec.id).maybeSingle()
          if (slot) {
            slotIdCol = slot.id
            entry.slot_id = slot.id
            entry.slot = [slot.slot_date, String(slot.start_time || '').slice(0, 5)].filter(Boolean).join(' ') || (slot.label || '')
          }
        }
        list = [entry]
        lectureIdCol = lid
      } else {
        list = Array.isArray(cd.ch) ? cd.ch : []
        if (!list.length) return json({ ok: true, skip: 'challenge_empty' })
        let per = PRICE_PER_CHALLENGE_FALLBACK
        const { data: cfg } = await supa.from('site_config').select('value').eq('key', 'challenge_price').maybeSingle()
        const n = typeof cfg?.value === 'number' ? cfg.value : parseInt(String(cfg?.value ?? ''), 10)
        if (Number.isFinite(n) && n > 0) per = n
        expected = list.length * per
      }
      if (paid !== expected) return json({ ok: true, skip: 'apps_price_mismatch' })

      const payload: Record<string, unknown> = {
        name, phone, refund_account: null,
        challenges: list, total_price: expected,
        pay_method: kind === 'lecture' ? 'tosspay' : 'kakaopay',
        payment_id: paymentId, payment_status: 'paid', paid_amount: paid,
      }
      if (lectureIdCol) payload.lecture_id = lectureIdCol
      if (slotIdCol) payload.slot_id = slotIdCol
      // member_id — 결제 생성 때 실어 둔 계정. 브라우저 경로처럼 JWT 대조는 못 하지만,
      // customData 는 우리 결제창이 만든 값이고 남의 계정을 넣어 봐야 그 계정에 '선물'이
      // 될 뿐이라 가로채기가 안 된다.
      if (cd.uid) payload.member_id = String(cd.uid)

      const { error } = await supa.from('applications').insert(payload)
      if (error) {
        // 확정 실패(정원 마감·중복 신청)는 verify-payment 와 같은 규칙 — 전액 자동 환불
        if (error.code === 'MC001' || String(error.message).includes('lecture_full')) {
          const refunded = await refundAll(supa, paymentId, paid, '특강 정원 마감(웹훅) · 자동 환불')
          return json({ ok: true, refunded })
        }
        if (error.code === 'MC002' || String(error.message).includes('duplicate_application')) {
          const refunded = await refundAll(supa, paymentId, paid, '중복 신청(웹훅) · 자동 환불')
          return json({ ok: true, refunded })
        }
        if (error.code === '23505' || String(error.message).includes('duplicate key')) {
          return json({ ok: true, already: true })
        }
        return json({ ok: false, error: 'db' }, 500)   // 일시 오류 — 포트원이 재시도한다
      }
      return json({ ok: true, granted: kind })
    }

    return json({ ok: true, skip: 'unknown_kind' })
  } catch (e) {
    console.error('webhook exception', e)
    return json({ ok: false, error: 'exception' }, 500)   // 포트원이 재시도한다
  }
})
