/* =============================================================================
   커뮤니티 오픈채팅 모집 카드 — lab-shelf·tools 2곳 공용 (2026-08-16 신설 · 2026-08-28 뉴스 폐지로 3→2곳)
   -----------------------------------------------------------------------------
   - 쓰는 법: 본문에 <div data-community-card></div> + 이 파일 로드(supabase-config 뒤).
   - ⚠️ 입장 주소·참여코드는 이 파일에도, 레포 어디에도 없다(공개 레포).
     로그인 회원만 community_config(RLS: authenticated 전용)에서 받는다.
   - 비회원 클릭 → login.html?returnTo=<현재>. 회원 클릭 → 코드+입장 링크 펼침.
   - 표 미생성(PGRST205)·조회 실패·행 없음 → "아직 준비 중" 한 줄로 조용히 degrade.
   - bfcache: lab-shelf 는 통째 reload 예외 페이지라(결제 복귀 — CLAUDE.md)
     pageshow(persisted)에서 카드를 초기 상태로 되돌린다 — 공용 기기에서
     로그아웃 뒤 뒤로가기로 남의 참여코드가 되살아나는 것 방지.
   - 화면 문자열은 한글 리터럴(\uXXXX 이스케이프는 inapp.js 전용 규칙 — nav.js 전례).
   - 파일을 고치면 두 페이지의 ?v= 도 같이 올린다.
   - 설계: docs/superpowers/specs/2026-08-16-community-card-design.md
   ============================================================================= */
(function () {
  'use strict';
  var mount = document.querySelector('[data-community-card]');
  if (!mount) return;

  var css = ''
    + '.cmc-wrap{max-width:720px;margin:36px auto 8px;padding:0 20px}'
    + '.cmc{display:flex;align-items:center;gap:12px;background:#fff;'
    +   'border:1px solid var(--border-soft,rgba(23,42,71,.12));border-radius:14px;'
    +   'box-shadow:var(--shadow,0 4px 20px rgba(20,32,52,.10));padding:14px;letter-spacing:-.015em}'
    + '.cmc-ico{flex:0 0 auto;width:40px;height:40px;border-radius:12px;background:#FEE500;'
    +   'color:#191919;display:flex;align-items:center;justify-content:center}'
    + '.cmc-txt{flex:1 1 auto;min-width:0}'
    + '.cmc-tit{display:block;font-size:14px;font-weight:700;color:var(--ink,#1C2A3A)}'
    + '.cmc-sub{display:block;font-size:12px;color:var(--text-muted,#545C68);margin-top:2px}'
    + '.cmc-btn{flex:0 0 auto;min-height:44px;padding:0 16px;border:0;border-radius:12px;'
    +   'background:var(--action,#1B3A6B);color:#fff;font-size:14px;font-weight:800;'
    +   'font-family:inherit;letter-spacing:inherit;cursor:pointer}'
    + '.cmc-btn:disabled{opacity:.6;cursor:default}'
    + '.cmc-note{margin:8px 2px 0;font-size:12px;color:var(--text-muted,#545C68)}'
    + '.cmc-panel{margin-top:10px;background:#fff;border:1px solid var(--border-soft,rgba(23,42,71,.12));'
    +   'border-radius:12px;padding:14px}'
    + '.cmc-code-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}'
    + '.cmc-code-label{font-size:12px;color:var(--text-muted,#545C68)}'
    + '.cmc-code{font-size:16px;font-weight:700;color:var(--ink,#1C2A3A);'
    +   'user-select:all;-webkit-user-select:all}'
    + '.cmc-copy{min-height:44px;padding:0 14px;border:1px solid var(--border-soft,rgba(23,42,71,.12));'
    +   'border-radius:12px;background:#fff;color:var(--ink,#1C2A3A);font-size:14px;font-weight:700;'
    +   'font-family:inherit;cursor:pointer}'
    + '.cmc-go{display:flex;align-items:center;justify-content:center;gap:8px;min-height:48px;'
    +   'margin-top:12px;border-radius:12px;background:#FEE500;color:#191919;'
    +   'font-size:14px;font-weight:700;text-decoration:none}'
    + '@media (max-width:359px){.cmc{flex-wrap:wrap}.cmc-btn{flex:1 1 100%}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var KAKAO_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">'
    + '<path d="M12 3C6.9 3 2.8 6.2 2.8 10.2c0 2.5 1.7 4.7 4.2 6l-1 3.6c-.1.3.3.6.6.4l4.3-2.8c.4 0 '
    + '.7.1 1.1.1 5.1 0 9.2-3.2 9.2-7.2S17.1 3 12 3z"/></svg>';

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function render() {
    mount.innerHTML = ''
      + '<div class="cmc-wrap">'
      +   '<div class="cmc">'
      +     '<span class="cmc-ico" aria-hidden="true">' + KAKAO_SVG + '</span>'
      +     '<span class="cmc-txt">'
      +       '<span class="cmc-tit">승무원 준비생 커뮤니티</span>'
      /* 부제 교체(2026-08-16 오너 "몬크가 운영하는 승무원 채용관련 채팅방으로 바꾸자") —
         '— 회원 전용' 꼬리는 게이트 예고라 남긴다. 띄어쓰기만 맞춤법대로('채용 관련'). */
      +       '<span class="cmc-sub">몬크가 운영하는 승무원 채용 관련 채팅방 — 회원 전용</span>'
      +     '</span>'
      +     '<button type="button" class="cmc-btn">입장</button>'
      +   '</div>'
      +   '<div class="cmc-extra"></div>'
      + '</div>';
    mount.querySelector('.cmc-btn').addEventListener('click', onEnter);
  }

  function extra() { return mount.querySelector('.cmc-extra'); }
  function note(msg) { extra().innerHTML = '<p class="cmc-note">' + msg + '</p>'; }

  /* 계측 — index.html 의 moncTrack 과 같은 모양(실패 조용히 무시) */
  function beacon() {
    if (!window.MONC || !window.MONC.sb) return;
    try {
      window.MONC.sb.from('page_events').insert({
        event: 'community_card_click',
        path: location.pathname,
        meta: { viewport: window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop' }
      }).then(function () {}, function () {});
    } catch (e) {}
  }

  function toLogin() {
    /* ⚠️ 절대경로가 아니라 파일명만 쓴다(supabase-config 의 pageRef 와 같은 꼴) —
       login.html 의 safeReturnTo() 가 앞에 / 가 붙은 값을 통째로 버려서, pathname 을
       그대로 보내면 로그인 뒤 이 카드로 못 돌아온다(2026-08-17 수정). */
    var page = location.pathname.split('/').pop() || 'index.html';
    location.href = 'login.html?returnTo=' + encodeURIComponent(page + location.search + location.hash);
  }

  async function onEnter() {
    beacon();
    if (!window.MONC || !window.MONC.sb) { toLogin(); return; }
    var btn = mount.querySelector('.cmc-btn');
    btn.disabled = true;
    btn.textContent = '확인 중…';
    try {
      var session = await window.MONC.getSession();
      if (!session) { toLogin(); return; }
      var res = await window.MONC.sb.from('community_config')
        .select('*').eq('key', 'open_chat').maybeSingle();
      var v = (!res.error && res.data && res.data.value) || null;
      if (!v || !v.url) {
        note('아직 준비 중이에요. 잠시 뒤 다시 눌러 주세요.');
        return;
      }
      openPanel(v);
    } catch (e) {
      note('아직 준비 중이에요. 잠시 뒤 다시 눌러 주세요.');
    } finally {
      btn.disabled = false;
      btn.textContent = '입장';
    }
  }

  function openPanel(v) {
    var code = v.code ? String(v.code) : '';
    extra().innerHTML = ''
      + '<div class="cmc-panel">'
      + (code
        ? '<div class="cmc-code-row">'
          + '<span class="cmc-code-label">참여코드</span>'
          + '<span class="cmc-code">' + escHtml(code) + '</span>'
          + '<button type="button" class="cmc-copy">복사</button>'
          + '</div>'
        : '')
      + '<a class="cmc-go" href="' + escHtml(v.url) + '" target="_blank" rel="noopener">'
      +   KAKAO_SVG + '카카오톡으로 입장하기</a>'
      + (code
        ? '<p class="cmc-note">입장할 때 위 참여코드를 입력해 주세요.</p>'
        : '')
      + '</div>';
    var copy = extra().querySelector('.cmc-copy');
    if (copy) copy.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(code);
        copy.textContent = '복사됨';
      } catch (e) {
        note('복사가 막혔어요. 코드를 길게 눌러 복사해 주세요.');
      }
    });
  }

  /* bfcache 복귀 — 펼쳐진 코드까지 통째로 초기화 */
  window.addEventListener('pageshow', function (e) { if (e.persisted) render(); });

  render();
})();
