// Supabase Edge Function: verify-payment
// 포트원(PortOne) V2 결제를 "서버에서" 검증한 뒤에만 신청(applications)을 저장한다.
// 브라우저만 믿으면 위조 결제로 무료 신청이 가능하므로, 실제 결제 여부·금액을 서버가 재확인한다.
//
// 필요한 환경변수(Supabase Secrets):
//   PORTONE_API_SECRET  — 포트원 콘솔에서 발급한 V2 API Secret
//   (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Supabase가 자동 주입)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PRICE_PER_CHALLENGE_FALLBACK = 30000 // site_config.challenge_price 미설정 시 기본값
const PORTONE_STORE_ID = 'store-a2a17822-a4c8-4d25-ac38-939772dfb6d5'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// 결제는 승인됐는데 신청을 저장할 수 없을 때(특강 정원 마감) 전액 자동 환불한다.
// ⚠️ 돈만 나가고 신청은 실패하는 상태를 남기지 않기 위한 안전장치 — 실패해도 예외를
//    던지지 않고 false 를 돌려준다(호출부가 사용자에게 고객센터 안내를 띄운다).
async function refundAll(
  supa: ReturnType<typeof createClient>, paymentId: string, amount: number, reason: string,
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
    if (!res.ok) { console.error('auto refund failed', res.status, body); return false }
    // 신청 행이 없으므로 application_id 는 null — 장부에는 남긴다(admin 이 대조 가능).
    await supa.from('refunds').insert({
      application_id: null, amount, reason,
      portone_response: (body as Record<string, unknown>)?.cancellation || body || null,
    })
    return true
  } catch (e) {
    console.error('auto refund exception', e)
    return false
  }
}

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
      // 챌린지 공통 참가비는 admin에서 site_config.challenge_price 로 관리(미설정 시 3만원).
      // ⚠️ 브라우저가 보낸 금액이 아니라 서버가 DB에서 읽은 값으로 재계산한다.
      let per = PRICE_PER_CHALLENGE_FALLBACK
      const { data: cfg } = await supa.from('site_config').select('value').eq('key', 'challenge_price').maybeSingle()
      const n = typeof cfg?.value === 'number' ? cfg.value : parseInt(String(cfg?.value ?? ''), 10)
      if (Number.isFinite(n) && n > 0) per = n
      expected = list.length * per
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
      // 정원 마감(DB 트리거 MC001) — 결제하는 사이에 마지막 자리가 나갔다.
      // 결제는 이미 승인됐으므로 전액 자동 환불하고 실패로 답한다.
      // ⚠️ 여기만 200 으로 답한다: supabase-js 의 functions.invoke 는 non-2xx 면 data 를
      //    null 로 만들고 본문을 error.context 안에 숨겨, 브라우저가 'lecture_full' 인지
      //    구분할 수 없다(= 환불됐다는 안내를 못 띄운다). 실패 여부는 ok:false 로 전한다.
      if (error.code === 'MC001' || String(error.message).includes('lecture_full')) {
        const refunded = await refundAll(supa, paymentId, paid, '특강 정원 마감 · 자동 환불')
        return json({ ok: false, error: 'lecture_full', refunded })
      }
      return json({ ok: false, error: 'insert_failed', detail: error.message }, 500)
    }
    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: 'exception', detail: String(e) }, 500)
  }
})
