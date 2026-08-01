/* =============================================================================
   인앱 브라우저 탈출 안내 — inapp.js (2026-08-01 · 같은 날 전체 화면으로 재작성)
   =============================================================================
   왜 필요한가: **인스타가 우리 유입 1위인데, 인스타 인앱 브라우저는**
     ① 파일 다운로드를 막거나 조용히 삼키고
     ② 구글 OAuth 를 아예 거부한다(disallowed_useragent).
   실제 제보(2026-08-01): "인스타보고 무료배포 읽어보려니 팝업 뜨고 안들어가는데".

   ⚠️ 첫 판은 페이지 '흐름 안'에 배너를 끼워 넣었다가 고정 nav 와 겹치고 레이아웃을
      밀어 화면이 깨졌다(오너: "완전 다 깨져보여서 뭔말인지 하나도 모르겠다").
      그래서 지금은 **position:fixed 전체 화면 덮개**다 — 페이지 레이아웃을 1px 도
      건드리지 않는다. 흐름 안 배너로 되돌리지 말 것.

   동작(오너 확정: "자동으로 나가게"):
     - 안드로이드: 들어오자마자 **자동으로 크롬으로 이동**(인텐트). 실패 대비로
       화면에 버튼·수동 방법도 같이 둔다.
     - 아이폰: 자동 이동이 **기술적으로 불가능**(애플이 웹에서 Safari 강제 오픈을
       막아 놨다 — 어떤 사이트도 못 한다). 전체 화면 안내 + 주소 복사로 민다.

   ⚠️ 이 파일을 지우면 인스타 유입 전체가 자료를 못 받는다(전 페이지 공용, login 포함).
   ⚠️ '이대로 볼게요'는 그 탭에서만 기억한다(sessionStorage) — 새로 들어오면 다시 뜬다.
   ============================================================================= */
(function () {
  'use strict';

  var ua = navigator.userAgent || '';

  // 인앱 웹뷰들(인스타·페북·카톡·라인·네이버·다음·에브리타임 등 — 학생 유입 경로).
  // 판정은 넉넉하게: 놓치면 사고, 오탐이면 안내 한 번 더 보일 뿐이다.
  var IN_APP = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|KAKAOTALK|Line\/|NAVER\(inapp|NAVER |DaumApps|everytime|band|Snapchat|Twitter|TikTok/i.test(ua);
  if (!IN_APP) return;

  var HIDE_KEY = 'monc_inapp_off';
  try { if (sessionStorage.getItem(HIDE_KEY) === '1') return; } catch (e) {}

  var isAndroid = /Android/i.test(ua);
  var isKakao = /KAKAOTALK/i.test(ua);
  var appName = /Instagram/i.test(ua) ? '인스타그램'
    : isKakao ? '카카오톡'
    : /FBAN|FBAV|FB_IAB|FBIOS/i.test(ua) ? '페이스북'
    : '앱';
  var pageUrl = location.href;

  /* ── 스타일 — 전부 이 안에서만. 페이지 CSS 를 쓰지도, 건드리지도 않는다 ── */
  var css = ''
    + '.iao{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;'
    + 'padding:24px 20px;background:linear-gradient(180deg,#1E4079,#142C52);'
    + "font-family:'SUIT Variable',SUIT,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;"
    + 'word-break:keep-all;-webkit-font-smoothing:antialiased;}'
    + '.iao-card{width:min(100%,340px);max-height:92vh;overflow-y:auto;background:#FCF9F1;color:#26221C;'
    + 'border-radius:20px;padding:26px 22px 18px;box-shadow:0 18px 60px rgba(0,0,0,.35);text-align:center;}'
    + '.iao-card h2{margin:0 0 10px;font-size:21px;font-weight:800;letter-spacing:-0.01em;}'
    + '.iao-sub{margin:0 0 18px;font-size:14.5px;font-weight:500;line-height:1.6;color:#5A5346;}'
    + '.iao-sub b{color:#26221C;font-weight:800;}'
    + '.iao-step{display:flex;align-items:flex-start;gap:10px;text-align:left;margin-bottom:10px;'
    + 'font-size:15px;font-weight:600;line-height:1.5;}'
    + '.iao-step b{flex:none;width:22px;height:22px;border-radius:50%;background:#1B3A6B;color:#fff;'
    + 'font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:1px;}'
    + '.iao-main{display:block;width:100%;min-height:52px;margin-top:14px;border:0;border-radius:14px;'
    + 'background:#1B3A6B;color:#fff;font:inherit;font-size:16px;font-weight:800;cursor:pointer;}'
    + '.iao-tip{margin:12px 0 0;font-size:12.5px;font-weight:600;line-height:1.55;color:#5A5346;}'
    + '.iao-skip{display:block;width:100%;min-height:44px;margin-top:6px;border:0;background:transparent;'
    + 'color:#8A8578;font:inherit;font-size:13px;font-weight:600;text-decoration:underline;cursor:pointer;}';

  // 안드로이드 — 크롬으로 바로 넘긴다. 크롬이 없으면 아무 일도 안 일어나고
  // 화면의 수동 안내가 그대로 남는다(같은 주소를 폴백으로 주면 제자리 루프가 된다).
  function toChrome() {
    location.href = 'intent://' + pageUrl.replace(/^https?:\/\//, '')
      + '#Intent;scheme=https;package=com.android.chrome;end';
  }

  function copy(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { legacy(); });
    } else legacy();
    function legacy() {
      // 인앱 웹뷰는 클립보드 API 를 막는 경우가 많다 — 옛 방식으로 폴백
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

  function mount() {
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    var wrap = document.createElement('div');
    wrap.className = 'iao';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');

    var inner = ''
      + '<div class="iao-card">'
      + '<h2>브라우저로 열어 주세요</h2>'
      + '<p class="iao-sub"><b>' + appName + '</b> 안에서는<br>자료 받기와 로그인이 막혀 있어요.</p>';

    if (isAndroid) {
      inner += ''
        + '<p class="iao-sub" style="margin-bottom:4px;">잠시 뒤 <b>Chrome</b> 으로 자동 이동해요.</p>'
        + '<button class="iao-main" type="button" data-act="chrome">지금 바로 열기</button>'
        + '<p class="iao-tip">이동하지 않으면 오른쪽 위 <b>⋮</b> 를 눌러<br><b>다른 브라우저에서 열기</b>를 선택해 주세요.</p>';
    } else {
      inner += (isKakao
        ? '<div class="iao-step"><b>1</b><span>오른쪽 아래 <b>Safari 아이콘</b>을 눌러요</span></div>'
        : '<div class="iao-step"><b>1</b><span>오른쪽 위 <b>⋯</b> 버튼을 눌러요</span></div>'
          + '<div class="iao-step"><b>2</b><span><b>외부 브라우저에서 열기</b><br>(또는 Safari로 열기)를 눌러요</span></div>')
        + '<button class="iao-main" type="button" data-act="copy">주소 복사하기</button>'
        + '<p class="iao-tip">복사한 주소를 Safari 주소창에 붙여넣어도 돼요.</p>';
    }

    inner += '<button class="iao-skip" type="button" data-act="skip">괜찮아요, 이대로 볼게요</button></div>';
    wrap.innerHTML = inner;
    document.body.appendChild(wrap);

    // 덮개가 떠 있는 동안 뒤 페이지 스크롤을 잠근다(닫으면 되돌린다)
    var prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'chrome') { toChrome(); return; }
      if (act === 'copy') {
        copy(pageUrl, function (ok) {
          b.textContent = ok ? '복사됐어요! 브라우저에 붙여넣어 주세요'
                             : '복사가 막혔어요 — 주소창을 길게 눌러 복사해 주세요';
        });
        return;
      }
      if (act === 'skip') {
        wrap.remove();
        document.documentElement.style.overflow = prevOverflow;
        try { sessionStorage.setItem(HIDE_KEY, '1'); } catch (e2) {}
      }
    });

    // 오너 확정 "자동으로 나가게" — 안드로이드는 안내가 그려진 직후 자동 이동.
    // 아이폰은 자동 이동 자체가 불가능하다(애플이 막아 놨다) — 위 수동 안내가 전부다.
    if (isAndroid) setTimeout(toChrome, 700);
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
