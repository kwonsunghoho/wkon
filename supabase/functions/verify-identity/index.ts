// Supabase Edge Function: verify-identity
// 포트원(PortOne) V2 휴대폰 본인인증(KG이니시스 통합인증)을 "서버에서" 검증한 뒤에만
// 회원 프로필(실명·번호·CI·DI)을 저장한다. 브라우저는 identityVerificationId 하나만
// 보낸다 — 이름·번호·CI 를 브라우저가 보내면 안 믿는다(verify-payment 와 같은 원칙).
//
// 흐름: 온보딩 인증창 완료 → 이 함수(JWT) → 포트원 API 재조회(status VERIFIED 확인)
//   → RPC apply_identity_verification(service_role 전용 · migration 20260826150000)
//   → CI·번호 중복 판정 + members 갱신 + 감사 기록.
//
// 알려진 실패는 전부 HTTP 200 + code 로 돌려준다(non-2xx 면 supabase-js 가 본문을 감춰
// 화면이 안내를 못 띄운다 — 결제 함수들과 같은 규칙). 401 은 미로그인뿐.
//   not_verified      — 인증 미완료·실패·건 없음
//   dup_phone         — 같은 사람(CI)·같은 번호의 다른 계정 존재(provider·me_fresh 동봉)
//   verification_used — 같은 인증 건을 다른 계정이 이미 사용
//   bad_phone         — 휴대전화 형식 아님
//   not_ready         — 마이그레이션 미적용(화면은 직접 입력 폼으로 폴백)
//
// 필요한 환경변수(Supabase Secrets):
//   PORTONE_API_SECRET  — 포트원 콘솔에서 발급한 V2 API Secret (verify-payment 와 공유)
//   (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY 는 Supabase가 자동 주입)
//
// 설계: docs/superpowers/specs/2026-08-26-identity-verification-design.md

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 배포 확인용 버전 — 코드를 고치면 같이 올리고, 콘솔 배포 뒤 anon 프로브로 확인한다.
const FN_VERSION = '2026-08-26b'

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
    const { identityVerificationId, probe } = await req.json()

    // ── 배포 확인용 프로브 — 인증 검사보다 앞(로그인 없이 배포 여부 확인) ──────
    if (probe === true) {
      return json({ ok: true, fn: 'verify-identity', version: FN_VERSION })
    }

    // ── 누구의 프로필에 저장할지는 body 가 아니라 JWT 가 정한다 ───────────────
    const auth = req.headers.get('Authorization') || ''
    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    )
    const { data: { user } } = await asUser.auth.getUser()
    if (!user) return json({ ok: false, code: 'not_authenticated' }, 401)

    // 인증 건 id — 온보딩이 만드는 형태(identity-verification-<uuid>)만 통과
    const ivId = String(identityVerificationId || '')
    if (!/^identity-verification-[0-9a-fA-F-]{36}$/.test(ivId)) {
      return json({ ok: false, code: 'bad_request' })
    }

    // ── 포트원 재조회 — 인증창 결과를 그대로 믿지 않는다 ─────────────────────
    const secret = Deno.env.get('PORTONE_API_SECRET')
    if (!secret) return json({ ok: false, code: 'not_ready' })
    const pRes = await fetch(`https://api.portone.io/identity-verifications/${encodeURIComponent(ivId)}`, {
      headers: { Authorization: `PortOne ${secret}` },
    })
    const iv = await pRes.json().catch(() => ({}))
    if (!pRes.ok) {
      // 404 = 건 없음(만들다 만·위조 id) — 화면에는 '인증이 완료되지 않았어요'면 충분
      console.error('portone lookup failed', pRes.status, iv)
      return json({ ok: false, code: 'not_verified' })
    }
    if (iv?.status !== 'VERIFIED') return json({ ok: false, code: 'not_verified' })

    const vc = iv?.verifiedCustomer || {}
    const name = String(vc.name || '').trim()
    // 인증사 응답의 번호는 형이 제각각일 수 있다(+82 국제형·하이픈 포함) — 숫자만 남기고
    // 82 국가번호는 국내형(0…)으로 바꿔 RPC(형식 검사·중복 대조)에 넘긴다. 통합인증 창에서
    // 휴대폰이 아닌 방식(카드·간편인증서)을 고르면 번호가 아예 빠질 수 있다 → bad_phone.
    let phone = String(vc.phoneNumber || '').replace(/\D/g, '')
    if (/^82(1[016789])/.test(phone)) phone = '0' + phone.slice(2)
    const birth = /^\d{4}-\d{2}-\d{2}$/.test(String(vc.birthDate || '')) ? String(vc.birthDate) : null
    const ci = String(vc.ci || '').trim() || null
    const di = String(vc.di || '').trim() || null
    if (!phone) {
      console.error('verify-identity bad_phone — verifiedCustomer keys:', Object.keys(vc).join(','))
      return json({ ok: false, code: 'bad_phone' })
    }

    // ── 저장은 RPC 한 곳(service_role) — CI·번호 중복 판정 + 감사 기록 ────────
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data, error } = await supa.rpc('apply_identity_verification', {
      p_member: user.id, p_verification_id: ivId, p_name: name || null,
      p_phone: phone, p_birth: birth, p_ci: ci, p_di: di,
    })
    if (error) {
      // 마이그레이션 미적용 — 화면은 직접 입력 폼으로 폴백한다(저장 전이라 차감·부작용 없음)
      const missing = error.code === 'PGRST202' || /apply_identity_verification/i.test(error.message || '')
      if (missing) return json({ ok: false, code: 'not_ready' })
      console.error('apply_identity_verification failed', error)
      return json({ ok: false, code: 'error', message: error.message })
    }
    // 성공이 아닌 결과는 로그에 남긴다 — 화면 캡처만으로 원인을 좁힐 수 있게(2026-08-26 실사고)
    if (!data || data.ok !== true) console.error('verify-identity outcome', data?.code, 'member', user.id)
    // RPC 가 주는 jsonb 그대로 — { ok:true, name, phone } | { ok:false, code, provider, me_fresh }
    return json(data || { ok: false, code: 'error' })
  } catch (e) {
    console.error('verify-identity exception', e)
    return json({ ok: false, code: 'error', message: String(e) }, 200)
  }
})
