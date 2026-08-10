// Supabase Edge Function: verify-payment
// 포트원(PortOne) V2 결제를 "서버에서" 검증한 뒤에만 신청(applications)을 저장한다.
// 브라우저만 믿으면 위조 결제로 무료 신청이 가능하므로, 실제 결제 여부·금액을 서버가 재확인한다.
//
// 필요한 환경변수(Supabase Secrets):
//   PORTONE_API_SECRET  — 포트원 콘솔에서 발급한 V2 API Secret
//   (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Supabase가 자동 주입)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 배포 확인용 버전 — 코드를 고치면 같이 올리고, 콘솔 배포 뒤 probe 로 확인한다(관리자에게 SQL 을 시키지 않는다).
const FN_VERSION = '2026-08-10a'

// site_config.challenge_price 미설정 시 기본값.
// ⚠️ **apply.html 의 폴백과 같은 값을 유지한다.** 어긋나면 DB 를 못 읽는 순간 화면에 보이는
//    금액과 서버가 검증하는 기준가가 달라진다(2026-08-02 오너 지시 33,000원 — 구 30,000원).
const PRICE_PER_CHALLENGE_FALLBACK = 33000
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
// supa 타입은 any — createClient 의 제네릭 인스턴스가 호출부마다 달라 deno check 가
// 걸리는 기존 마찰의 해소(타입 표기만 변경, 런타임 동일).
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
    const { paymentId, challenges, applicant, lectureId, slotId, creditPack, programId, resourceId, probe } = await req.json()

    // service role 클라이언트 — 특강 금액 조회(신뢰 소스)와 신청 저장 둘 다에 쓴다.
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // ── 배포 확인용 프로브 ────────────────────────────────────────────────
    // 결제를 건드리지 않고 버전과 기준가만 돌려준다(anon key 로 호출 가능).
    // 이 한 번으로 ① 새 코드가 배포됐나 ② DB 에 참가비가 설정돼 있나 ③ 폴백이 화면과 맞나 확인된다.
    if (probe === true) {
      const { data: cfg } = await supa.from('site_config').select('value').eq('key', 'challenge_price').maybeSingle()
      const raw = cfg?.value
      const price = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
      return json({
        ok: true, fn: 'verify-payment', version: FN_VERSION,
        challengePrice: Number.isFinite(price) ? price : null,
        priceFallback: PRICE_PER_CHALLENGE_FALLBACK,
      })
    }

    // ═══════════════════════════════════════════════════════════════════
    // 크레딧 충전 (2026-07-25) — 신청 저장이 아니라 원장에 크레딧을 넣는다.
    // 아래 챌린지·특강 경로와 완전히 다른 일이라 여기서 갈라져 끝낸다.
    // ═══════════════════════════════════════════════════════════════════
    if (creditPack) {
      // ⚠️ 누구에게 넣을지는 **브라우저가 아니라 JWT 로 정한다.**
      //    body 의 memberId 를 믿으면 남의 계정에 넣거나 남의 결제를 가로챌 수 있다.
      const auth = req.headers.get('Authorization') || ''
      const asUser = createClient(
        Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: auth } } },
      )
      const { data: { user } } = await asUser.auth.getUser()
      if (!user) return json({ ok: false, error: 'not_authenticated' }, 401)

      // 상품·금액은 DB 가 신뢰 소스(브라우저가 보낸 금액 불신). admin 에서 바꾸면 즉시 반영.
      const { data: cfg } = await supa.from('site_config').select('value').eq('key', 'credit_packs').maybeSingle()
      const packs = Array.isArray(cfg?.value) ? cfg!.value as Array<Record<string, unknown>> : []
      const pack = packs.find((p) => String(p.id) === String(creditPack))
      if (!pack) return json({ ok: false, error: 'pack_not_found' }, 400)
      const count = Number(pack.count) || 0
      const price = Number(pack.price) || 0
      const tool = String(pack.tool || 'ai_killer')
      if (!paymentId || count <= 0 || price <= 0) return json({ ok: false, error: 'bad_request' }, 400)

      // 이미 이 결제로 충전했으면 그대로 통과시킨다(재시도·복귀 중복 호출 방어).
      // ⚠️ 최종 방어는 DB 의 credit_ledger_purchase_uq 다 — 조회와 insert 사이엔 틈이 있다.
      const { data: dup } = await supa.from('credit_ledger')
        .select('id').eq('tool', tool).eq('ref', paymentId).eq('reason', 'purchase').maybeSingle()
      if (dup) {
        const { data: rows } = await supa.from('credit_ledger').select('delta').eq('member_id', user.id)
        const bal = (rows || []).reduce((a, r) => a + (Number(r.delta) || 0), 0)
        return json({ ok: true, already: true, added: count, balance: bal })
      }

      const secret = Deno.env.get('PORTONE_API_SECRET')
      const res = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: `PortOne ${secret}` },
      })
      if (!res.ok) return json({ ok: false, error: 'lookup_failed' }, 502)
      const pay = await res.json()
      if (pay.status !== 'PAID') return json({ ok: false, error: 'not_paid', status: pay.status }, 402)
      if (pay?.amount?.total !== price) {
        return json({ ok: false, error: 'amount_mismatch', paid: pay?.amount?.total, expected: price }, 402)
      }

      // 검증 통과 → 원장에 넣는다. reason='purchase', ref=결제 id (멱등성 키).
      const { error: insErr } = await supa.from('credit_ledger').insert({
        member_id: user.id, tool, delta: count, reason: 'purchase', ref: paymentId,
      })
      if (insErr) {
        // 유니크 위반 = 방금 다른 요청이 먼저 넣었다. 사용자에겐 성공이 맞다.
        if (!String(insErr.message || '').includes('duplicate')) {
          console.error('credit insert failed', insErr.message)
          return json({ ok: false, error: 'grant_failed' }, 500)
        }
      }
      const { data: rows } = await supa.from('credit_ledger').select('delta').eq('member_id', user.id)
      const balance = (rows || []).reduce((a, r) => a + (Number(r.delta) || 0), 0)
      return json({ ok: true, added: count, balance })
    }

    // ═══════════════════════════════════════════════════════════════════
    // 매일 답변 프로그램 이용권 구매 (2026-07-30 · 체험판 없이 바로 유료 — 오너 확정)
    // 신청(applications)이 아니라 program_enrollments 에 이용권을 넣는다.
    // ═══════════════════════════════════════════════════════════════════
    if (programId) {
      // ⚠️ 누구에게 지급할지는 **body 가 아니라 JWT 로 정한다**(크레딧 충전과 같은 이유 —
      //    body 의 회원 id 를 믿으면 남의 계정 지급·남의 결제 가로채기가 된다).
      const auth = req.headers.get('Authorization') || ''
      const asUser = createClient(
        Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: auth } } },
      )
      const { data: { user } } = await asUser.auth.getUser()
      if (!user) return json({ ok: false, error: 'not_authenticated' }, 401)

      // 금액은 DB 가 신뢰 소스(브라우저가 보낸 금액 불신). price null=지급 전용 /
      // 0 이하=판매 대상 아님 — admin 에서 가격을 바꾸면 재배포 없이 반영된다.
      const { data: prog, error: progErr } = await supa.from('answer_programs')
        .select('id, title, price, visible').eq('id', programId).maybeSingle()
      if (progErr || !prog) return json({ ok: false, error: 'program_not_found' }, 400)
      const progPrice = Number(prog.price)
      if (!paymentId) return json({ ok: false, error: 'bad_request' }, 400)
      if (!Number.isFinite(progPrice) || progPrice <= 0 || !prog.visible) {
        return json({ ok: false, error: 'program_not_for_sale' }, 400)
      }

      // 같은 결제로 두 번 지급 방지(재시도·모바일 복귀 중복 호출 방어)
      const { data: dupEnr } = await supa.from('program_enrollments')
        .select('id').eq('payment_id', paymentId).maybeSingle()
      if (dupEnr) return json({ ok: true, already: true })

      const pSecret = Deno.env.get('PORTONE_API_SECRET')
      const pRes = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: `PortOne ${pSecret}` },
      })
      if (!pRes.ok) return json({ ok: false, error: 'lookup_failed' }, 502)
      const pPay = await pRes.json()
      if (pPay.status !== 'PAID') return json({ ok: false, error: 'not_paid', status: pPay.status }, 402)
      if (pPay?.amount?.total !== progPrice) {
        return json({ ok: false, error: 'amount_mismatch', paid: pPay?.amount?.total, expected: progPrice }, 402)
      }

      // 검증 통과 → 이용권 지급. unique(program_id, member_id) 가 최종 방어다.
      const { error: enrErr } = await supa.from('program_enrollments').insert({
        program_id: prog.id, member_id: user.id, source: 'purchase',
        payment_id: paymentId, status: 'active',
      })
      if (enrErr) {
        // 이미 이용권이 있는데 또 결제 — 특강 중복(MC002)과 같은 처리: 전액 자동 환불 + HTTP 200
        // (non-2xx 면 브라우저가 환불 사실을 안내하지 못한다 — 위 주석과 같은 이유).
        if (enrErr.code === '23505' || String(enrErr.message).includes('duplicate key')) {
          const refunded = await refundAll(supa, paymentId, progPrice, '답변 프로그램 중복 구매 · 자동 환불')
          return json({ ok: false, error: 'already_enrolled', refunded })
        }
        console.error('enrollment insert failed', enrErr.message)
        // 결제는 승인됐는데 지급을 못 했다(마이그레이션 미적용 등) — 돈만 나간 상태를 남기지 않는다.
        const refunded = await refundAll(supa, paymentId, progPrice, '이용권 지급 실패 · 자동 환불')
        return json({ ok: false, error: 'grant_failed', refunded })
      }
      return json({ ok: true, program: prog.title })
    }

    // ═══════════════════════════════════════════════════════════════════
    // 연구실 유료 자료 구매 (2026-08-01) — 자료 하나하나에 값이 붙는다(오너 확정).
    // 신청(applications)이 아니라 lab_purchases 에 구매를 기록한다.
    // 위 이용권(programId) 분기와 구조가 같다: 단건 · JWT 지급 · DB 가격 재확인 ·
    // 중복이면 전액 환불.
    // ═══════════════════════════════════════════════════════════════════
    if (resourceId) {
      // ⚠️ 누구의 구매인지는 **body 가 아니라 JWT 로 정한다**(위 두 분기와 같은 이유).
      const auth = req.headers.get('Authorization') || ''
      const asUser = createClient(
        Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: auth } } },
      )
      const { data: { user } } = await asUser.auth.getUser()
      if (!user) return json({ ok: false, error: 'not_authenticated' }, 401)

      // 금액은 DB 가 신뢰 소스. admin 에서 값을 바꾸면 재배포 없이 즉시 반영된다.
      // price 0 = 무료 자료라 애초에 결제 대상이 아니다(로그인만으로 열린다).
      const { data: res0, error: resErr } = await supa.from('lab_resources')
        .select('id, title, price, published').eq('id', resourceId).maybeSingle()
      if (resErr || !res0) return json({ ok: false, error: 'resource_not_found' }, 400)
      const resPrice = Number(res0.price)
      if (!paymentId) return json({ ok: false, error: 'bad_request' }, 400)
      if (!Number.isFinite(resPrice) || resPrice <= 0 || !res0.published) {
        return json({ ok: false, error: 'resource_not_for_sale' }, 400)
      }

      // 같은 결제로 두 번 기록 방지(재시도·모바일 복귀 중복 호출 방어).
      // ⚠️ 남의 기록이면 성공으로 답하지 않는다 — 브라우저가 '구매 완료'를 띄우고도
      //    자료가 안 열리는 상태가 된다. wrong_account 는 HTTP 200 + code(공통 규칙).
      const { data: dupBuy } = await supa.from('lab_purchases')
        .select('id, user_id').eq('payment_id', paymentId).maybeSingle()
      if (dupBuy) {
        if (dupBuy.user_id === user.id) return json({ ok: true, already: true })
        return json({ ok: false, error: 'wrong_account' })
      }

      const rSecret = Deno.env.get('PORTONE_API_SECRET')
      const rRes = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: `PortOne ${rSecret}` },
      })
      if (!rRes.ok) return json({ ok: false, error: 'lookup_failed' }, 502)
      const rPay = await rRes.json()
      if (rPay.status !== 'PAID') return json({ ok: false, error: 'not_paid', status: rPay.status }, 402)
      if (rPay?.amount?.total !== resPrice) {
        return json({ ok: false, error: 'amount_mismatch', paid: rPay?.amount?.total, expected: resPrice }, 402)
      }
      // 결제를 연 계정 표식(customData.uid) 대조 — 복귀 주소(paymentId·rid)가 새어도
      // 남의 계정으로 확인해 자료를 가로채지 못하게(2026-08-10). 표식 없는 옛 결제는 통과.
      try {
        const cd = JSON.parse(String(rPay?.customData ?? '') || '{}')
        if (cd && cd.uid && cd.uid !== user.id) return json({ ok: false, error: 'wrong_account' })
      } catch (_) { /* 표식이 JSON 이 아니면 옛 형식 — 통과 */ }

      // 검증 통과 → 구매 기록. unique(resource_id, user_id) 가 최종 방어다.
      const { error: buyErr } = await supa.from('lab_purchases').insert({
        resource_id: res0.id, user_id: user.id, amount: resPrice, payment_id: paymentId,
      })
      if (buyErr) {
        // 이미 산 자료를 또 결제 — 특강 중복(MC002)·이용권 중복과 같은 처리:
        // 전액 자동 환불 + HTTP 200. ⚠️ non-2xx 로 돌려주면 supabase-js 가 본문을
        // 감춰 브라우저가 '환불됐다'를 못 띄운다.
        if (buyErr.code === '23505' || String(buyErr.message).includes('duplicate key')) {
          const refunded = await refundAll(supa, paymentId, resPrice, '연구실 자료 중복 구매 · 자동 환불')
          return json({ ok: false, error: 'already_purchased', refunded })
        }
        console.error('lab purchase insert failed', buyErr.message)
        // 결제는 승인됐는데 기록을 못 했다(마이그레이션 미적용 등) — 돈만 나간 상태를 남기지 않는다.
        const refunded = await refundAll(supa, paymentId, resPrice, '자료 구매 기록 실패 · 자동 환불')
        return json({ ok: false, error: 'grant_failed', refunded })
      }
      return json({ ok: true, resource: res0.title })
    }

    // 결제 대상 판별: lectureId 가 있으면 '특강 1건', 없으면 기존 '챌린지 N개'.
    // ⚠️ 금액은 브라우저를 믿지 않고 서버가 DB(특강)·상수(챌린지)에서 다시 계산한다.
    // 호출자 확인 — 특강은 로그인 필수, 챌린지는 member_id 검증에 쓴다(아래 참조).
    const callerAuth = req.headers.get('Authorization') || ''
    const asCaller = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: callerAuth } } },
    )
    const { data: { user: caller } } = await asCaller.auth.getUser()

    let expected: number
    let list: unknown[]
    let lectureIdCol: string | null = null
    let slotIdCol: string | null = null
    if (lectureId) {
      // ⚠️ 특강 신청은 로그인 필수(2026-08-05 오너 확정) — 대상은 body 가 아니라 JWT 가 정한다.
      //    UI 게이트·RLS(20260805140000)를 우회해 로그인 없이 결제까지 온 경우,
      //    돈만 나간 상태를 남기지 않는다: 실결제(PAID)면 전액 환불 후 거절.
      //    프로브({paymentId:'probe'})는 결제 조회가 실패해 환불 없이 거절만 된다 —
      //    이 응답(login_required)이 곧 '로그인 필수 버전' 배포 확인 신호다.
      if (!caller) {
        let refunded = false
        try {
          const s0 = Deno.env.get('PORTONE_API_SECRET')
          const pr = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}`, {
            headers: { Authorization: `PortOne ${s0}` },
          })
          if (pr.ok) {
            const pp = await pr.json()
            if (pp.status === 'PAID' && Number(pp?.amount?.total) > 0) {
              refunded = await refundAll(supa, paymentId, pp.amount.total, '특강 비로그인 결제 · 자동 환불')
            }
          }
        } catch (_) { /* 조회 실패 — 거절만 한다 */ }
        return json({ ok: false, error: 'login_required', refunded })
      }
      const { data: lec, error: lecErr } = await supa
        .from('special_lectures').select('id, title, price').eq('id', lectureId).single()
      if (lecErr || !lec) return json({ ok: false, error: 'lecture_not_found' }, 400)
      expected = lec.price
      const entry: Record<string, unknown> =
        { type: 'lecture', lecture_id: lec.id, name: lec.title, price: lec.price }

      // 시간대 — ⚠️ 브라우저가 보낸 slotId 가 정말 이 특강의 것인지 서버가 확인한다.
      // (다른 특강의 시간대를 밀어넣어 남의 자리를 잡는 걸 막는다)
      if (slotId) {
        const { data: slot } = await supa
          .from('lecture_slots').select('id, lecture_id, slot_date, start_time, label')
          .eq('id', slotId).eq('lecture_id', lec.id).maybeSingle()
        if (!slot) return json({ ok: false, error: 'slot_not_found' }, 400)
        slotIdCol = slot.id
        entry.slot_id = slot.id
        entry.slot = [slot.slot_date, String(slot.start_time || '').slice(0, 5)]
          .filter(Boolean).join(' ') || (slot.label || '')
      }
      list = [entry]
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
    if (slotIdCol) payload.slot_id = slotIdCol
    // member_id 는 body 가 아니라 JWT 가 정한다(2026-08-05).
    //   특강: 로그인 필수라 caller 가 반드시 있다 — 항상 caller 명의로 적는다.
    //   챌린지: 비회원 결제가 있어 로그인은 선택 — body 의 member_id 는 본인 JWT 와
    //           일치할 때만 적는다(남의 계정에 신청을 걸어 두는 위장 차단).
    if (lectureIdCol) payload.member_id = caller!.id
    else if (applicant.member_id && caller && applicant.member_id === caller.id) {
      payload.member_id = applicant.member_id
    }

    const { error } = await supa.from('applications').insert(payload)
    if (error) {
      // ⚠️ 트리거 코드(MC001/MC002)를 '동일 결제ID' 판정보다 먼저 본다.
      //    아래 판정이 메시지에 'duplicate key' 가 들어있는지도 보기 때문에, 순서가 뒤바뀌면
      //    중복 신청(message = duplicate_application)이 '이미 접수됨(ok:true)'으로 삼켜져
      //    돈만 나가고 환불이 안 된다.
      // ⚠️ 환불 분기는 200 으로 답한다: supabase-js 의 functions.invoke 는 non-2xx 면 data 를
      //    null 로 만들고 본문을 error.context 안에 숨겨, 브라우저가 사유를 구분할 수 없다
      //    (= 환불됐다는 안내를 못 띄운다). 실패 여부는 ok:false 로 전한다.

      // 특강 정원 마감(MC001) — 결제하는 사이에 마지막 자리가 나갔다 → 전액 자동 환불.
      if (error.code === 'MC001' || String(error.message).includes('lecture_full')) {
        const refunded = await refundAll(supa, paymentId, paid, '특강 정원 마감 · 자동 환불')
        return json({ ok: false, error: 'lecture_full', refunded })
      }
      // 같은 프로그램 중복 신청(MC002) — 이미 신청한 챌린지·특강을 또 결제한 경우.
      // 브라우저 사전 검사로 못 잡는 경우(비회원·두 탭 동시 결제)가 여기로 온다 → 전액 자동 환불.
      if (error.code === 'MC002' || String(error.message).includes('duplicate_application')) {
        const refunded = await refundAll(supa, paymentId, paid, '중복 신청 · 자동 환불')
        // hint 에 트리거가 담아준 프로그램 이름이 온다(예: '표현력 4기') — 사용자 안내에 쓴다.
        return json({ ok: false, error: 'duplicate_application', refunded, program: error.hint || null })
      }
      // 동일 결제ID(같은 결제를 두 번 검증 — 이미 접수됨)면 성공으로 간주.
      // ⚠️ 'duplicate' 가 아니라 'duplicate key' 로 좁힌다 — 위 MC002 메시지를 삼키지 않게.
      if (error.code === '23505' || String(error.message).includes('duplicate key')) {
        return json({ ok: true, duplicate: true })
      }
      return json({ ok: false, error: 'insert_failed', detail: error.message }, 500)
    }
    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: 'exception', detail: String(e) }, 500)
  }
})
