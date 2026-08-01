/* =============================================================================
   인앱 브라우저 안내 — inapp.js (2026-08-01 · v3 상단 고정 한 줄)
   =============================================================================
   인스타(유입 1위)·카톡 인앱 브라우저는 파일 다운로드를 막고 구글 OAuth 를
   거부한다(disallowed_useragent). 그래서 인앱이면 상단에 안내를 띄운다.

   ⚠️ 형태 변경 금지 — 오너 확정 경과(2026-08-01, 하루 안에 세 번):
      v1 흐름 안 배너 → 고정 nav 와 글자가 겹쳐 깨져 보임(실사고).
      v2 전체 화면 덮개 → 오너 기각("장난치냐? 그냥 상단 설명으로 바꿔").
      v3(현재) = position:fixed 로 nav '아래'에 붙는 한 줄 — 페이지 레이아웃을
      건드리지 않고(fixed), nav 와도 겹치지 않는다(top = navbar 실측 높이,
      z-index 90 < nav 100 이라 만에 하나 겹쳐도 nav 가 이긴다).

   ⚠️ 화면 문자열은 전부 \uXXXX 이스케이프(생성기 scratchpad/gen_inapp.py) —
      어떤 charset 오독에서도 글자가 깨질 수 없다. 한글을 그대로 넣지 말 것.
   ⚠️ 페이지에서 src="inapp.js?v=N" 으로 부른다 — 인앱 웹뷰가 캐시를 잘 안 버려서
      파일을 고치면 ?v= 도 같이 올린다(v1 깨진 화면이 캐시로 계속 보인 실사고).
   ============================================================================= */
(function () {
  'use strict';

  var ua = navigator.userAgent || '';
  var IN_APP = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|KAKAOTALK|Line\/|NAVER\(inapp|NAVER |DaumApps|everytime|band|Snapchat|Twitter|TikTok/i.test(ua);
  if (!IN_APP) return;

  var HIDE_KEY = 'monc_inapp_off';
  try { if (sessionStorage.getItem(HIDE_KEY) === '1') return; } catch (e) {}

  var isAndroid = /Android/i.test(ua);
  var isKakao = /KAKAOTALK/i.test(ua);
  var appName = /Instagram/i.test(ua) ? "\uc778\uc2a4\ud0c0\uadf8\ub7a8"
    : isKakao ? "\uce74\uce74\uc624\ud1a1"
    : /FBAN|FBAV|FB_IAB|FBIOS/i.test(ua) ? "\ud398\uc774\uc2a4\ubd81"
    : null;
  var pageUrl = location.href;

  function mount() {
    // nav 바로 아래에 붙인다. nav 가 없는 페이지(login)는 맨 위(0).
    var nav = document.getElementById('navbar');
    var top = nav ? Math.round(nav.getBoundingClientRect().height) : 0;

    var css = ''
      + '.iab{position:fixed;left:0;right:0;z-index:90;top:' + top + 'px;'
      + 'display:flex;align-items:center;gap:8px;padding:9px 10px 9px 14px;'
      + 'background:#1B3A6B;color:#fff;box-shadow:0 6px 18px rgba(20,28,44,.25);'
      + "font-family:'SUIT Variable',SUIT,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;"
      + 'word-break:keep-all;-webkit-font-smoothing:antialiased;}'
      + '.iab-tx{flex:1;min-width:0;}'
      + '.iab-t{margin:0;font-size:13px;font-weight:700;line-height:1.45;}'
      + '.iab-s{margin:3px 0 0;font-size:12px;font-weight:600;line-height:1.45;color:rgba(255,255,255,.82);}'
      + '.iab-go{flex:none;min-height:44px;padding:0 13px;border:0;border-radius:999px;'
      + 'background:#fff;color:#1B3A6B;font:inherit;font-size:12.5px;font-weight:800;cursor:pointer;white-space:nowrap;}'
      + '.iab-x{flex:none;width:44px;height:44px;border:0;border-radius:50%;background:transparent;'
      + 'color:rgba(255,255,255,.78);font-size:20px;line-height:1;cursor:pointer;}';
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    var bar = document.createElement('div');
    bar.className = 'iab';
    bar.setAttribute('role', 'region');

    var msg = appName ? ('<b>' + appName + '</b>' + " \uc548\uc5d0\uc11c\ub294 \uc790\ub8cc \ubc1b\uae30\uc640 \ub85c\uadf8\uc778\uc774 \uc548 \ub3fc\uc694.") : "\uc9c0\uae08 \ubcf4\uc2dc\ub294 \uc571 \uc548\uc5d0\uc11c\ub294 \uc790\ub8cc \ubc1b\uae30\uc640 \ub85c\uadf8\uc778\uc774 \uc548 \ub3fc\uc694.";
    var sub = isAndroid ? '' : (isKakao ? "\uc624\ub978\ucabd \uc544\ub798 Safari \uc544\uc774\ucf58\uc744 \ub20c\ub7ec \uc8fc\uc138\uc694." : "\uc624\ub978\ucabd \uc704 \u22ef \uba54\ub274 \u2192 \u2018\uc678\ubd80 \ube0c\ub77c\uc6b0\uc800\uc5d0\uc11c \uc5f4\uae30\u2019\ub97c \ub20c\ub7ec \uc8fc\uc138\uc694.");

    bar.innerHTML = ''
      + '<span class="iab-tx"><p class="iab-t">' + msg + '</p>'
      + (sub ? '<p class="iab-s">' + sub + '</p>' : '') + '</span>'
      + '<button class="iab-go" type="button">' + (isAndroid ? "Chrome\uc73c\ub85c \uc5f4\uae30" : "\uc8fc\uc18c \ubcf5\uc0ac") + '</button>'
      + '<button class="iab-x" type="button" aria-label="\ub2eb\uae30">\u00d7</button>';

    document.body.appendChild(bar);

    bar.querySelector('.iab-x').addEventListener('click', function () {
      bar.remove();
      try { sessionStorage.setItem(HIDE_KEY, '1'); } catch (e) {}
    });

    bar.querySelector('.iab-go').addEventListener('click', function () {
      if (isAndroid) {
        // 크롬으로 넘긴다(버튼을 눌렀을 때만 — 자동 이동 없음).
        // 같은 주소를 폴백으로 주면 제자리 루프가 되므로 주지 않는다.
        location.href = 'intent://' + pageUrl.replace(/^https?:\/\//, '')
          + '#Intent;scheme=https;package=com.android.chrome;end';
        return;
      }
      var btn = this;
      copy(pageUrl, function (ok) {
        btn.textContent = ok ? "\ubcf5\uc0ac\ud588\uc5b4\uc694! \ube0c\ub77c\uc6b0\uc800\uc5d0 \ubd99\uc5ec\ub123\uc5b4 \uc8fc\uc138\uc694." : "\ubcf5\uc0ac\uac00 \uc548 \ub3fc\uc694 \u2014 \uc8fc\uc18c\ucc3d\uc744 \uae38\uac8c \ub20c\ub7ec \ubcf5\uc0ac\ud574 \uc8fc\uc138\uc694.";
        btn.style.whiteSpace = 'normal';
      });
    });
  }

  // 인앱 웹뷰는 클립보드 API 를 막는 경우가 많다 — 옛 방식으로 폴백
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

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
