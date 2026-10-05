// Supabase Edge Function: cancel-payment
// admin 이 신청 건의 간편결제를 전액/부분 환불한다. 포트원 취소 API 를 서버에서 호출하고
// (원결제수단 자동 환불 — 환불계좌 불필요) 성공 시 applications/refunds 에 기록한다.
//
// 배포: Supabase 콘솔 > Edge Functions > cancel-payment (Verify JWT = ON, 기본값 유지)
// 필요한 환경변수(Supabase Secrets):
//   PORTONE_API_SECRET  — verify-payment 와 동일한 포트원 V2 API Secret (이미 등록됨)
// ⚠️ 기존 환불 테이블은 적용 완료. 이번 배포 전에는 20261005120000_refund_items.sql을 실행한다.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 배포 확인용 버전 — 코드를 고치면 같이 올리고, 콘솔 배포 뒤 probe 로 확인한다(관리자에게 SQL 을 시키지 않는다).
const FN_VERSION = '2026-10-05a'

const PORTONE_STORE_ID = 'store-a2a17822-a4c8-4d25-ac38-939772dfb6d5'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  try {
    const { applicationId, amount, reason, itemIndexes, probe } = await req.json()

    // 배포 확인용 프로브 — 환불을 건드리지 않고 버전만 돌려준다(anon key 로 호출 가능).
    // admin 확인보다 앞에 둔다: 배포 여부는 로그인 없이도 확인할 수 있어야 한다.
    if (probe === true) return json({ ok: true, fn: 'cancel-payment', version: FN_VERSION, refundItems: true })

    const amt = Number(amount)
    if (!applicationId || !Number.isInteger(amt) || amt <= 0) {
      return json({ ok: false, error: 'bad_request' }, 400)
    }

    // 1) 호출자가 admin 인지 확인 (JWT 전달 → 본인 확인 → members.role 대조)
    const caller = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
    )
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return json({ ok: false, error: 'unauthorized' }, 401)

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: me } = await supa.from('members').select('role').eq('id', user.id).single()
    if (!me || me.role !== 'admin') return json({ ok: false, error: 'forbidden' }, 403)

    // 2) 신청 건 조회 + 환불 가능액 검증 (초과 환불 방지 1차 방어; 2차는 포트원이 막음)
    const { data: app, error: appErr } = await supa.from('applications')
      .select('*')
      .eq('id', applicationId).single()
    if (appErr || !app) return json({ ok: false, error: 'not_found' }, 404)
    if (!app.payment_id) return json({ ok: false, error: 'not_pg_payment' }, 400)

    const cancellable = (app.paid_amount || 0) - (app.refunded_amount || 0)
    if (amt > cancellable) {
      return json({ ok: false, error: 'amount_exceeds', cancellable }, 400)
    }

    // 항목은 브라우저의 이름을 믿지 않고 해당 신청 원본에서 복사한다.
    const choices = Array.isArray(app.challenges) ? app.challenges : []
    if (!Array.isArray(itemIndexes) || !itemIndexes.length ||
        itemIndexes.some((i: unknown) => typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= choices.length) ||
        new Set(itemIndexes).size !== itemIndexes.length) {
      return json({ ok: false, error: 'invalid_items', message: '환불할 항목을 다시 선택해 주세요.' }, 400)
    }
    if (amt === cancellable && !app.refunded_amount && itemIndexes.length !== choices.length) {
      return json({ ok: false, error: 'invalid_items', message: '전액 환불은 모든 항목을 선택해 주세요.' }, 400)
    }
    const items = itemIndexes.map((i: number) => {
      const c = choices[i]
      if (!c || typeof c !== 'object') return null
      // 표시와 식별에 필요한 값만 저장한다.
      return c.type === 'lecture' || c.lecture_id
        ? { type: 'lecture', lecture_id: c.lecture_id, name: c.name, slot: c.slot }
        : c.challenge ? { challenge: c.challenge, round: c.round } : null
    })
    if (items.some((c: unknown) => c === null)) return json({ ok: false, error: 'invalid_items' }, 400)
    // 마이그레이션 전에는 실제 돈이 움직이기 전에 멈춘다.
    const { error: readyErr } = await supa.from('refunds').select('items').limit(0)
    if (readyErr) return json({ ok: false, error: 'not_ready', message: '환불 항목 저장 준비가 필요합니다. 관리자에게 확인해 주세요.' })

    // 3) 포트원 결제 취소 (부분취소는 amount 지정)
    const secret = Deno.env.get('PORTONE_API_SECRET')
    if (!secret) return json({ ok: false, error: 'secret_missing' }, 500)
    const res = await fetch(`https://api.portone.io/payments/${encodeURIComponent(app.payment_id)}/cancel`, {
      method: 'POST',
      headers: { Authorization: `PortOne ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: PORTONE_STORE_ID,
        amount: amt,
        reason: reason || '관리자 환불',
      }),
    })
    const pay = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('portone cancel error', res.status, pay)
      // 이미 전액 취소된 결제 등 — 포트원 에러 타입을 그대로 전달해 admin 이 알 수 있게
      return json({ ok: false, error: 'cancel_failed', type: pay?.type, message: pay?.message }, 502)
    }

    // 4) 기록 (환불 누계 + 상태 + 이력). 포트원 취소는 이미 성공했으므로
    //    여기가 실패해도 ok 로 답하되 warning 을 실어 admin 이 수동 확인하게 한다.
    const newRefunded = (app.refunded_amount || 0) + amt
    const full = newRefunded >= (app.paid_amount || 0)
    const upd: Record<string, unknown> = {
      refunded_amount: newRefunded,
      payment_status: full ? 'refunded' : 'partial_refunded',
    }
    if (full) upd.refunded = true // 구 admin 불리언 호환(요약 배지)

    const { error: upErr } = await supa.from('applications').update(upd).eq('id', app.id)
    const { error: insErr } = await supa.from('refunds').insert({
      application_id: app.id,
      amount: amt,
      items,
      reason: reason || null,
      portone_response: pay?.cancellation || pay || null,
      created_by: user.id,
    })
    if (upErr || insErr) {
      console.error('refund record fail', upErr, insErr)
      return json({
        ok: true, warning: '환불은 완료됐지만 기록 저장에 실패했어요. 새로고침 후 금액을 확인하고, 다시 환불 버튼을 누르지 마세요.',
        refunded_amount: newRefunded, payment_status: upd.payment_status,
      })
    }
    return json({ ok: true, refunded_amount: newRefunded, payment_status: upd.payment_status })
  } catch (e) {
    console.error(e)
    return json({ ok: false, error: 'exception', detail: String(e) }, 500)
  }
})
