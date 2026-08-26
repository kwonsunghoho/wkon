/* =============================================================================
   pay-methods.js — 포트원 결제수단(채널) 공용 창구 (2026-08-19)
   -----------------------------------------------------------------------------
   - 상점 ID·채널 키는 이 파일 한 곳에만 둔다(공개 가능 값). 결제 7개 페이지
     (apply·lecture·mypage·ai-killer·polish·program·lab-shelf) + 온보딩(본인인증 채널)이
     전부 이걸 읽는다 — 페이지에 다시 하드코딩하지 말 것(2026-08-02 폴백 금액처럼
     한쪽만 고치는 사고 방지).
   - ⚠️ KAKAO 키가 빈 문자열이면 카카오페이는 화면 어디에도 안 나온다(토스페이 단독 —
     기존과 동일 동작). 포트원 콘솔에서 카카오페이 채널을 만들면 키만 채우면 켜진다.
   - choose(): 결제수단 고르는 바텀시트. 카카오 키가 없으면 시트 없이 토스 키를 즉시
     돌려준다(기존 흐름 무변경). 닫으면 null — 부르는 쪽은 아무것도 하지 않아야 한다
     (버튼 잠금·미결 기록 pends.add 보다 반드시 앞에 부를 것).
   - bfcache: 결제로 나갔다 뒤로 돌아오면 문서가 얼렸던 그대로 되살아난다 — 열려 있던
     시트는 pageshow(persisted)에서 null 로 닫는다(기다리던 쪽은 조용히 끝난다).
   - 화면 문자열은 한글 리터럴(\uXXXX 이스케이프는 inapp.js 전용 규칙 — nav.js 전례).
   - 파일을 고치면 7개 페이지의 ?v= 도 같이 올린다.
   - 설계: docs/superpowers/specs/2026-08-19-kakaopay-channel-design.md
   ============================================================================= */
(function () {
  'use strict';

  var STORE_ID = 'store-a2a17822-a4c8-4d25-ac38-939772dfb6d5';
  var CHANNELS = {
    toss: 'channel-key-8a96b8c5-494a-4f37-b111-2e3ac03c2b59',
    /* 카카오페이 채널 키(2026-08-19 오너 전달 — 포트원 실연동 채널). 비우면 카카오페이
       선택지가 화면에서 통째로 꺼진다(끄는 스위치를 겸한다). */
    kakao: 'channel-key-86182882-80d9-450b-9ec3-3b178e5d0227'
  };
  /* 휴대폰 본인인증 채널 키(2026-08-26 오너 전달 — KG이니시스 통합인증, 포트원 경유).
     결제수단이 아니라 온보딩 본인인증(requestIdentityVerification)용 — choose() 시트와 무관.
     비우면 온보딩이 인증 UI 를 켜지 않고 직접 입력 폼으로 폴백한다(카카오 키와 같은 스위치). */
  var IDENTITY_CHANNEL = 'channel-key-d4c6e771-0eb6-424d-971b-200a655c2d2b';

  var _resolve = null;   // 시트가 열려 있는 동안만 값이 있다(중복 오픈 방지 겸용)
  var _lastFocus = null;

  function kakaoReady() { return !!CHANNELS.kakao; }

  /* ── 바텀시트 — 처음 열 때 한 번만 만든다 ── */
  function buildSheet() {
    if (document.getElementById('pmMask')) return;

    var css = ''
      + '.pm-mask{position:fixed;inset:0;z-index:970;background:rgba(15,23,42,.45)}'
      + '.pm-sheet{position:fixed;left:0;right:0;bottom:0;z-index:971;margin:0 auto;max-width:560px;'
      +   'background:#fff;border-radius:20px 20px 0 0;padding:14px 20px calc(20px + env(safe-area-inset-bottom));'
      +   'box-shadow:0 -8px 32px rgba(20,32,52,.18);letter-spacing:-.015em;'
      +   'transform:translateY(12px);opacity:0;transition:transform .18s ease,opacity .18s ease}'
      + '.pm-sheet.on{transform:translateY(0);opacity:1}'
      + '.pm-handle{width:44px;height:4px;border-radius:2px;background:rgba(23,42,71,.18);margin:0 auto 12px}'
      + '.pm-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}'
      + '.pm-title{font-size:17px;font-weight:800;color:var(--ink,#1C2A3A)}'
      + '.pm-close{width:44px;height:44px;margin:-10px -12px -10px 0;border:0;background:none;cursor:pointer;'
      +   'font-size:24px;line-height:1;color:var(--text-muted,#545C68);font-family:inherit}'
      + '.pm-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;width:100%;'
      +   'min-height:52px;padding:14px 16px;border:none;border-radius:12px;cursor:pointer;'
      +   'font-size:16px;font-weight:900;font-family:inherit;letter-spacing:inherit}'
      + '.pm-btn + .pm-btn{margin-top:8px}'
      + '.pm-btn.toss{background:#0064FF;color:#fff}'
      + '.pm-btn.kakao{background:#FFEB00;color:#191919}';
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var mask = document.createElement('div');
    mask.className = 'pm-mask'; mask.id = 'pmMask'; mask.hidden = true;
    mask.addEventListener('click', function () { close(null); });

    var sheet = document.createElement('div');
    sheet.className = 'pm-sheet'; sheet.id = 'pmSheet'; sheet.hidden = true;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'pmTitle');
    sheet.innerHTML = ''
      + '<div class="pm-handle"></div>'
      + '<div class="pm-head">'
      +   '<div class="pm-title" id="pmTitle">결제 수단 선택</div>'
      +   '<button type="button" class="pm-close" id="pmClose" aria-label="닫기">&times;</button>'
      + '</div>'
      + '<button type="button" class="pm-btn toss" id="pmToss">'
      +   '<img src="images/tosspay-logo-white.svg" alt="" style="height:19px;width:auto;display:block;">'
      +   '<span>토스페이로 결제</span>'
      + '</button>'
      + '<button type="button" class="pm-btn kakao" id="pmKakao">카카오페이로 결제</button>';

    document.body.appendChild(mask);
    document.body.appendChild(sheet);

    document.getElementById('pmClose').addEventListener('click', function () { close(null); });
    document.getElementById('pmToss').addEventListener('click', function () { close(CHANNELS.toss); });
    document.getElementById('pmKakao').addEventListener('click', function () { close(CHANNELS.kakao); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _resolve) close(null);
    });
  }

  function close(value) {
    var resolve = _resolve;
    _resolve = null;
    var mask = document.getElementById('pmMask');
    var sheet = document.getElementById('pmSheet');
    if (mask) mask.hidden = true;
    if (sheet) { sheet.hidden = true; sheet.classList.remove('on'); }
    if (_lastFocus && document.body.contains(_lastFocus)) { try { _lastFocus.focus(); } catch (e) {} }
    _lastFocus = null;
    if (resolve) resolve(value);
  }

  /* 결제수단을 고른다. 돌려주는 값: 채널 키(문자열) 또는 null(닫음).
     카카오 키가 없으면 시트 없이 토스 키 즉시 반환. 이미 열려 있으면 null(중복 클릭). */
  function choose() {
    if (!kakaoReady()) return Promise.resolve(CHANNELS.toss);
    if (_resolve) return Promise.resolve(null);
    buildSheet();
    return new Promise(function (resolve) {
      _resolve = resolve;
      _lastFocus = document.activeElement;
      document.getElementById('pmMask').hidden = false;
      var sheet = document.getElementById('pmSheet');
      sheet.hidden = false;
      requestAnimationFrame(function () { sheet.classList.add('on'); });
      document.getElementById('pmToss').focus();
    });
  }

  // 결제사로 나갔다 뒤로 돌아온 문서(bfcache) — 열린 채 얼어 있던 시트를 접는다.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted && _resolve) close(null);
  });

  window.moncPay = {
    storeId: STORE_ID,
    channels: CHANNELS,
    identityChannel: IDENTITY_CHANNEL,
    kakaoReady: kakaoReady,
    choose: choose
  };
})();
