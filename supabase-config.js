/* =============================================================================
 * MONC 회원 시스템 — Supabase 공용 설정 + 헬퍼
 * 이 파일보다 먼저 supabase-js CDN 스크립트가 로드돼 있어야 한다.
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="supabase-config.js"></script>
 * ⚠️ 여기 anon key 는 공개용(브라우저 노출 OK). service_role key 는 절대 넣지 말 것.
 * ⚠️ 변수명 주의: 라이브러리 전역명이 window.supabase 이므로 클라이언트는 sb 로 둔다.
 * ============================================================================= */
(function () {
  const SUPABASE_URL = 'https://apzwauiumhmsvrgffjis.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwendhdWl1bWhtc3ZyZ2ZmamlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NzQ1ODYsImV4cCI6MjA5ODU1MDU4Nn0.RzqVWeNhGe3bWzEIwU1HZ7hjE1bhQxIxJcvSFTjrN_Y';

  if (!window.supabase || !window.supabase.createClient) {
    console.error('supabase-js 라이브러리가 로드되지 않았습니다. CDN <script> 순서를 확인하세요.');
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // 총 미션 일수 (2주)
  const TOTAL_DAYS = 14;

  // 로그인 페이지 경로(상대). 다른 페이지에서 미로그인 시 이리로 보냄.
  const LOGIN_PAGE = 'login.html';

  // OAuth 로그인 시작(provider: 'google' | 'kakao' | …). 끝나면 returnTo로 되돌아온다.
  async function signInWithProvider(provider, returnTo, extra) {
    const redirectTo = returnTo || window.location.href.split('#')[0].split('?')[0];
    return sb.auth.signInWithOAuth({ provider, options: Object.assign({ redirectTo }, extra || {}) });
  }
  function signInWithGoogle(returnTo) { return signInWithProvider('google', returnTo); }
  // 카카오는 닉네임만 요청. 이메일(account_email)을 요청하면 비즈앱이 아닌 경우
  // "설정하지 않은 동의항목" KOE205 에러가 나므로 scope 를 profile_nickname 으로 한정.
  function signInWithKakao(returnTo)  { return signInWithProvider('kakao', returnTo, { scopes: 'profile_nickname' }); }

  async function signOut() {
    await sb.auth.signOut();
    // 로그아웃 후에는 로그인 창이 아니라 홈으로 (미로그인 접근 시 requireSession 이 login 으로 보냄)
    window.location.href = 'index.html';
  }

  // 현재 세션(로그인 정보). 없으면 null.
  async function getSession() {
    const { data } = await sb.auth.getSession();
    return data.session;
  }

  // 로그인 필수. 미로그인 시 로그인 페이지로 보내고 null 반환.
  async function requireSession() {
    const session = await getSession();
    if (!session) { window.location.href = LOGIN_PAGE; return null; }
    return session;
  }

  // 내 members 프로필 행. 없으면 null.
  async function getMyProfile() {
    const session = await getSession();
    if (!session) return null;
    const { data, error } = await sb
      .from('members')
      // cohorts(...) 는 cohort_id FK 로 연결된 기수 정보(없으면 null). 마이페이지 기간 표시용.
      // is_owner 는 오너 전용 관리자 임명 UI 판단용. sojae_enabled 는 소재 발굴 권한.
      .select('id, name, email, role, cohort_id, phone, is_owner, sojae_enabled, cohorts(name, start_date, end_date)')
      .eq('id', session.user.id)
      .single();
    if (error) { console.error('프로필 조회 실패', error); return null; }
    return data;
  }

  // ── 약관·개인정보 동의 (가입 시 1회) ───────────────────────────────────────
  // 로그인마다 체크를 다시 받지 않는다(2026-07-15). 최초 로그인 직후 login.html 의
  // 동의 게이트에서 명시 동의를 받아 members.agreed_at 에 남기고, 이후엔 어떤 기기에서
  // 로그인해도 서버 기록을 보고 통과시킨다. ⚠️ 사전 체크·간주 동의로 바꾸지 말 것.
  const TERMS_VERSION = '2026-07-15';   // 약관 개정 시 올리면 전원 재동의(게이트 재노출)

  // ⚠️ 동의 캐시는 반드시 '계정별' 키다. 기기 전역 키(구 monc_consent_v1)로 두면
  //    공용·가족 기기에서 A가 남긴 흔적 때문에 신규 회원 B가 동의 게이트를 건너뛰고,
  //    심지어 B 명의의 동의 기록이 서버에 위조 저장된다. 무기명 키로 되돌리지 말 것.
  const consentKey = (uid) => 'monc_consent_v1:' + uid;

  function localConsent(uid) {
    try {
      const raw = localStorage.getItem(consentKey(uid));
      return !!raw && raw.split('|')[1] === TERMS_VERSION;  // 버전 불일치 = 약관 개정 → 재동의
    } catch (e) { return false; }
  }
  function setLocalConsent(uid) {
    try { localStorage.setItem(consentKey(uid), new Date().toISOString() + '|' + TERMS_VERSION); } catch (e) {}
  }

  // 내 동의 기록. { agreed_at, terms_version } | null(미동의) | undefined(컬럼 미생성 등 조회 불가)
  // ⚠️ getMyProfile() 공용 select 에 넣지 않는다 — 마이그레이션(20260715120000) 미적용 환경에서
  //    프로필 조회 전체가 깨지므로(major 와 동일한 방어) 별도 조회한다.
  async function getConsent() {
    const session = await getSession();
    if (!session) return null;
    const { data, error } = await sb
      .from('members').select('agreed_at, terms_version').eq('id', session.user.id).single();
    if (error) return undefined;                 // 컬럼 미생성 → 호출부가 계정별 로컬 기록으로 폴백
    return data && data.agreed_at ? data : null;
  }

  // 동의 기록 저장. 서버 저장이 실패해도(컬럼 미생성 등) 이 계정의 로컬 기록은 남겨 재요구를 막는다.
  async function recordConsent() {
    const session = await getSession();
    if (!session) return false;
    setLocalConsent(session.user.id);
    const { error } = await sb.from('members')
      .update({ agreed_at: new Date().toISOString(), terms_version: TERMS_VERSION })
      .eq('id', session.user.id);
    if (error) { console.warn('동의 기록 저장 실패 — 계정별 로컬 기억으로 폴백', error.message); return false; }
    return true;
  }

  // 동의 완료 여부. 서버 기록이 진실이고, 조회 불가일 때만 '이 계정의' 기기 기억으로 폴백한다.
  async function hasConsented() {
    const session = await getSession();
    if (!session) return false;
    const uid = session.user.id;
    const c = await getConsent();
    if (c === undefined) return localConsent(uid);              // 컬럼 미생성 → 계정별 기기 기억
    if (c) {
      if (c.terms_version === TERMS_VERSION) { setLocalConsent(uid); return true; }
      return false;                                             // 구 약관에 동의 → 재동의 필요
    }
    // 서버엔 기록이 없고 '이 계정'의 로컬 기록만 있는 경우(마이그레이션 이전 동의) → 서버로 백필.
    // 계정별 키라서 남의 동의가 여기로 흘러들어올 수 없다.
    if (localConsent(uid)) { await recordConsent(); return true; }
    return false;
  }

  // 동의 거부 시 즉시 파기. OAuth 로 로그인하는 순간 트리거가 members(이름·이메일) 행을 만들기 때문에,
  // 게이트에서 '동의하지 않고 나가기'를 누르면 그 개인정보를 서버에서 지워야 한다(미동의자·만14세 미만).
  // delete_my_account() RPC 는 20260715120000_member_consent.sql 에 있다(owner 실행).
  // 반환: 'deleted'(계정까지 삭제) | 'redacted'(RPC 미적용 → 이름·이메일만 즉시 비움) | 'failed'
  async function deleteMyAccount() {
    const session = await getSession();
    if (!session) return 'failed';
    const uid = session.user.id;
    const { error } = await sb.rpc('delete_my_account');
    if (!error) {
      try { localStorage.removeItem(consentKey(uid)); } catch (e) {}
      return 'deleted';
    }
    console.warn('delete_my_account RPC 실패(마이그레이션 미적용?) — 프로필 개인정보만 비웁니다', error.message);
    const { error: e2 } = await sb.from('members').update({ name: null, email: null }).eq('id', uid);
    try { localStorage.removeItem(consentKey(uid)); } catch (e) {}
    return e2 ? 'failed' : 'redacted';
  }

  // 동의 미완료 회원을 로그인 페이지의 동의 게이트로 보낸다(회원 전용 페이지 가드).
  async function requireConsent() {
    if (await hasConsented()) return true;
    window.location.replace(LOGIN_PAGE + '?consent=1');
    return false;
  }

  // 소재 발굴 접근 가능 여부. 권한 플래그(sojae_enabled) 또는 관리자면 true.
  // getMyProfile() 로 얻은 프로필을 넘긴다. mypage·sojae 가 동일 기준으로 판정.
  function hasSojaeAccess(profile) {
    return !!profile && (profile.sojae_enabled === true || profile.role === 'admin');
  }

  // 관리자 전용 페이지 가드. 관리자가 아니면 로그인/차단 처리.
  async function requireAdmin() {
    const session = await requireSession();
    if (!session) return null;
    const profile = await getMyProfile();
    if (!profile || profile.role !== 'admin') {
      alert('관리자만 접근할 수 있는 페이지입니다.');
      window.location.href = 'mypage.html';
      return null;
    }
    return profile;
  }

  // private 버킷 파일의 재생용 signed URL (기본 1시간)
  async function getSignedUrl(storagePath, expiresIn) {
    if (!storagePath) return null;
    const { data, error } = await sb.storage
      .from('recordings')
      .createSignedUrl(storagePath, expiresIn || 3600);
    if (error) { console.error('signed URL 실패', error); return null; }
    return data.signedUrl;
  }

  // 전역 노출
  window.MONC = {
    sb, TOTAL_DAYS, LOGIN_PAGE, TERMS_VERSION,
    signInWithProvider, signInWithGoogle, signInWithKakao,
    signOut, getSession, requireSession,
    getMyProfile, hasSojaeAccess, requireAdmin, getSignedUrl,
    getConsent, recordConsent, hasConsented, requireConsent, deleteMyAccount,
  };
})();
