// Supabase Edge Function: cancel-payment
// admin 이 신청 건의 간편결제를 전액/부분 환불한다. 포트원 취소 API 를 서버에서 호출하고
// (원결제수단 자동 환불 — 환불계좌 불필요) 성공 시 applications/refunds 에 기록한다.
//
// 배포: Supabase 콘솔 > Edge Functions > cancel-payment (Verify JWT = ON, 기본값 유지)
// 필요한 환경변수(Supabase Secrets):
//   PORTONE_API_SECRET  — verify-payment 와 동일한 포트원 V2 API Secret (이미 등록됨)
// ⚠️ 배포 전에 migration 20260723120000_payment_refunds.sql 먼저 실행할 것.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    const { applicationId, amount, reason } = await req.json()
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
      .select('id, payment_id, paid_amount, refunded_amount, payment_status')
      .eq('id', applicationId).single()
    if (appErr || !app) return json({ ok: false, error: 'not_found' }, 404)
    if (!app.payment_id) return json({ ok: false, error: 'not_pg_payment' }, 400)

    const cancellable = (app.paid_amount || 0) - (app.refunded_amount || 0)
    if (amt > cancellable) {
      return json({ ok: false, error: 'amount_exceeds', cancellable }, 400)
    }

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
