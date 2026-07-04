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
    window.location.href = LOGIN_PAGE;
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
      // is_owner 는 오너 전용 관리자 임명 UI 판단용.
      .select('id, name, email, role, cohort_id, phone, is_owner, cohorts(name, start_date, end_date)')
      .eq('id', session.user.id)
      .single();
    if (error) { console.error('프로필 조회 실패', error); return null; }
    return data;
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
    sb, TOTAL_DAYS, LOGIN_PAGE,
    signInWithProvider, signInWithGoogle, signInWithKakao,
    signOut, getSession, requireSession,
    getMyProfile, requireAdmin, getSignedUrl,
  };
})();
