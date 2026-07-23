// Supabase Edge Function: verify-payment
// 포트원(PortOne) V2 결제를 "서버에서" 검증한 뒤에만 신청(applications)을 저장한다.
// 브라우저만 믿으면 위조 결제로 무료 신청이 가능하므로, 실제 결제 여부·금액을 서버가 재확인한다.
//
// 필요한 환경변수(Supabase Secrets):
//   PORTONE_API_SECRET  — 포트원 콘솔에서 발급한 V2 API Secret
//   (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Supabase가 자동 주입)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PRICE_PER_CHALLENGE = 30000 // 참가비 3만 (2026-07-20 보증금 제도 폐지 — PG 심사 요건)

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
    const { paymentId, challenges, applicant, lectureId } = await req.json()

    // service role 클라이언트 — 특강 금액 조회(신뢰 소스)와 신청 저장 둘 다에 쓴다.
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // 결제 대상 판별: lectureId 가 있으면 '특강 1건', 없으면 기존 '챌린지 N개'.
    // ⚠️ 금액은 브라우저를 믿지 않고 서버가 DB(특강)·상수(챌린지)에서 다시 계산한다.
    let expected: number
    let list: unknown[]
    let lectureIdCol: string | null = null
    if (lectureId) {
      const { data: lec, error: lecErr } = await supa
        .from('special_lectures').select('id, title, price').eq('id', lectureId).single()
      if (lecErr || !lec) return json({ ok: false, error: 'lecture_not_found' }, 400)
      expected = lec.price
      list = [{ type: 'lecture', lecture_id: lec.id, name: lec.title, price: lec.price }]
      lectureIdCol = lec.id
    } else {
      list = Array.isArray(challenges) ? challenges : []
      expected = list.length * PRICE_PER_CHALLENGE
    }
    if (!paymentId || expected <= 0 || !applicant?.name || !applicant?.phone) {
      return json({ ok: false, error: 'bad_request' }, 400)
    }

    // 1) 포트원에 실제 결제 내역 조회
    const secret = Deno.env.get('PORTONE_API_SECRET')
    const res = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `PortOne ${secret}` },
    })
    if (!res.ok) return json({ ok: false, error: 'lookup_failed' }, 502)
    const pay = await res.json()

    // 2) 검증: 결제 완료(PAID) + 금액 일치
    if (pay.status !== 'PAID') return json({ ok: false, error: 'not_paid', status: pay.status }, 402)
    const paid = pay?.amount?.total
    if (paid !== expected) return json({ ok: false, error: 'amount_mismatch', paid, expected }, 402)

    // 3) 검증 통과 → 신청 저장 (service role, RLS 우회)
    const payload: Record<string, unknown> = {
      name: applicant.name,
      phone: applicant.phone,
      refund_account: applicant.refund_account || null,
      challenges: list,
      total_price: expected,
      pay_method: lectureId ? 'tosspay' : 'kakaopay',
      payment_id: paymentId,
      payment_status: 'paid',
      paid_amount: paid,
    }
    if (lectureIdCol) payload.lecture_id = lectureIdCol
    if (applicant.member_id) payload.member_id = applicant.member_id

    const { error } = await supa.from('applications').insert(payload)
    if (error) {
      // 동일 결제ID 중복(이미 접수됨)이면 성공으로 간주
      if (error.code === '23505' || String(error.message).includes('duplicate')) {
        return json({ ok: true, duplicate: true })
      }
      return json({ ok: false, error: 'insert_failed', detail: error.message }, 500)
    }
    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: 'exception', detail: String(e) }, 500)
  }
})
