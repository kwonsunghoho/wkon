/* =============================================================================
   인앱 브라우저 탈출 안내 — inapp.js (2026-08-01)
   =============================================================================
   왜 필요한가: **인스타가 우리 유입 1위인데, 인스타 인앱 브라우저는**
     ① 파일 다운로드를 막거나 조용히 삼키고
     ② 구글 OAuth 를 아예 거부한다(구글이 인앱 웹뷰 로그인을 차단 — disallowed_useragent)
   실제 제보(2026-08-01): "인스타보고 무료배포 읽어보려니 팝업 뜨고 안들어가는데".
   서버는 정상이었고 인앱이 파일 창을 막은 것이었다.

   그래서 인앱이면 **들어오자마자** 바깥 브라우저로 안내한다.
     - 안드로이드: 크롬 인텐트로 한 번에 넘어간다(버튼 한 번).
     - 아이폰: 강제 이동이 불가능하다 — 'Safari로 열기' 위치를 그림처럼 알려주고
       주소 복사 버튼을 준다(붙여넣기만 하면 되게).

   ⚠️ 배너를 지우지 말 것. 이 자리가 막히면 인스타 유입 전체가 자료를 못 받는다.
   ⚠️ 닫아도 그 탭에서만 숨긴다(sessionStorage) — 새로 들어오면 다시 보여준다.
   ⚠️ 판정은 넉넉하게 한다. 인앱을 놓치면 사고가 나지만, 일반 브라우저에 잘못 뜨면
      배너 한 줄이 더 보일 뿐이다(닫으면 끝).
   ============================================================================= */
(function () {
  'use strict';

  var ua = navigator.userAgent || '';

  // 인앱 웹뷰들. 인스타·페북·카톡·라인·네이버·다음·에브리타임(학생 유입 경로)
  var IN_APP = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|KAKAOTALK|Line\/|NAVER\(inapp|NAVER |DaumApps|everytime|band|Snapchat|Twitter|TikTok/i.test(ua);
  if (!IN_APP) return;

  var HIDE_KEY = 'monc_inapp_banner_off';
  try { if (sessionStorage.getItem(HIDE_KEY) === '1') return; } catch (e) {}

  var isAndroid = /Android/i.test(ua);
  var url = location.href;

  var css = ''
    + '.ia-bar{position:sticky;top:0;z-index:400;display:flex;align-items:center;gap:10px;'
    + 'padding:10px 14px;background:#1B3A6B;color:#fff;font-size:13px;font-weight:700;line-height:1.45;}'
    + '.ia-bar p{margin:0;flex:1;min-width:0;}'
    // 터치 44px 하한(9대 원칙 2) — 여기서 줄이지 말 것. 못 누르면 배너가 없는 것과 같다.
    + '.ia-go{flex:none;min-height:44px;padding:0 14px;border:0;border-radius:999px;'
    + 'background:#fff;color:#1B3A6B;font:inherit;font-size:12.5px;font-weight:800;cursor:pointer;}'
    + '.ia-x{flex:none;width:44px;height:44px;border:0;border-radius:50%;background:transparent;'
    + 'color:rgba(255,255,255,.75);font-size:20px;line-height:1;cursor:pointer;}'
    + '.ia-scrim{position:fixed;inset:0;z-index:500;background:rgba(20,28,44,.62);}'
    + '.ia-sheet{position:fixed;left:0;right:0;bottom:0;z-index:510;width:min(100%,560px);margin:0 auto;'
    + 'background:#FCF9F1;color:#26221C;border-radius:20px 20px 0 0;'
    + 'padding:18px 20px calc(24px + env(safe-area-inset-bottom,0px));box-shadow:0 -14px 44px rgba(38,34,28,.3);}'
    + '.ia-sheet h3{margin:0 0 8px;font-size:17px;font-weight:800;}'
    + '.ia-sheet p{margin:0 0 12px;font-size:13.5px;font-weight:500;line-height:1.6;color:#5A5346;}'
    + '.ia-step{display:flex;gap:9px;align-items:flex-start;margin-bottom:9px;font-size:13.5px;font-weight:600;line-height:1.5;}'
    + '.ia-step b{flex:none;width:20px;height:20px;border-radius:50%;background:#1B3A6B;color:#fff;'
    + 'font-size:11.5px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:1px;}'
    + '.ia-copy{width:100%;min-height:50px;margin-top:6px;border:0;border-radius:13px;'
    + 'background:#1B3A6B;color:#fff;font:inherit;font-size:15px;font-weight:800;cursor:pointer;}'
    + '.ia-close{width:100%;min-height:44px;margin-top:8px;border:0;background:transparent;'
    + 'color:#5A5346;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;}';

  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  var bar = document.createElement('div');
  bar.className = 'ia-bar';
  bar.innerHTML =
    '<p>지금 <b>앱 안 브라우저</b>예요. 여기선 자료 파일이 안 열리고 로그인도 막혀요.</p>' +
    '<button class="ia-go" type="button">브라우저로 열기</button>' +
    '<button class="ia-x" type="button" aria-label="닫기">&times;</button>';

  function mount() {
    // nav 바로 아래(문서 맨 앞)에 둔다 — 자료를 누르기 '전에' 보여야 의미가 있다
    document.body.insertBefore(bar, document.body.firstChild);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  bar.querySelector('.ia-x').addEventListener('click', function () {
    bar.remove();
    try { sessionStorage.setItem(HIDE_KEY, '1'); } catch (e) {}
  });

  bar.querySelector('.ia-go').addEventListener('click', function () {
    if (isAndroid) {
      // 크롬으로 바로 넘긴다. 크롬이 없으면 아무 일도 안 일어나므로 시트로 폴백.
      var naked = url.replace(/^https?:\/\//, '');
      var t = setTimeout(openSheet, 1200);
      window.addEventListener('pagehide', function () { clearTimeout(t); }, { once: true });
      location.href = 'intent://' + naked + '#Intent;scheme=https;package=com.android.chrome;end';
      return;
    }
    openSheet();   // 아이폰은 강제 이동이 막혀 있다 — 방법을 알려준다
  });

  function openSheet() {
    if (document.querySelector('.ia-sheet')) return;
    var scrim = document.createElement('div');
    scrim.className = 'ia-scrim';
    var sheet = document.createElement('div');
    sheet.className = 'ia-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.innerHTML =
      '<h3>브라우저에서 열어 주세요</h3>' +
      '<p>앱 안 브라우저는 파일 받기와 로그인이 막혀 있어요. 아래 순서로 옮기시면 바로 됩니다.</p>' +
      (isAndroid
        ? '<div class="ia-step"><b>1</b><span>오른쪽 위 <b>⋮</b> 를 눌러요</span></div>' +
          '<div class="ia-step"><b>2</b><span><b>다른 브라우저로 열기</b>(또는 Chrome)를 선택해요</span></div>'
        : '<div class="ia-step"><b>1</b><span>오른쪽 아래 <b>⋯</b> 또는 <b>나침반</b> 아이콘을 눌러요</span></div>' +
          '<div class="ia-step"><b>2</b><span><b>Safari로 열기</b>를 선택해요</span></div>') +
      '<button class="ia-copy" type="button">주소 복사하기</button>' +
      '<button class="ia-close" type="button">닫기</button>';

    document.body.appendChild(scrim);
    document.body.appendChild(sheet);

    var copyBtn = sheet.querySelector('.ia-copy');
    copyBtn.addEventListener('click', function () {
      copy(url, function (ok) {
        copyBtn.textContent = ok ? '복사됐어요 — 브라우저에 붙여넣어 주세요' : '복사가 안 돼요. 주소창을 길게 눌러 복사해 주세요';
      });
    });
    function close() { scrim.remove(); sheet.remove(); }
    sheet.querySelector('.ia-close').addEventListener('click', close);
    scrim.addEventListener('click', close);
  }

  // 인앱 웹뷰는 클립보드 API 를 막는 경우가 많다 — 옛 방식으로 폴백한다
  function copy(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { legacy(); });
    } else legacy();

    function legacy() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
        document.body.appendChild(ta);
        ta.select(); ta.setSelectionRange(0, text.length);
        var ok = document.execCommand('copy');
        ta.remove();
        done(!!ok);
      } catch (e) { done(false); }
    }
  }
})();
