/* =============================================================================
   인앱 브라우저 안내 — inapp.js (2026-08-01 · v5 초슬림)
   =============================================================================
   인스타(유입 1위)·카톡 인앱 브라우저는 파일 다운로드를 막고 구글 OAuth 를
   거부한다(disallowed_useragent). 인앱이면 nav 아래에 얇은 안내를 띄운다.

   ⚠️ 하루에 네 번 고친 자리다 — 규칙을 지키지 않으면 다섯 번째가 된다.
      v1 흐름 안 배너 → nav 와 겹쳐 깨짐. v2 전체 화면 → 기각("상단 설명으로").
      v3 글+버튼 한 줄 flex → 버튼 문구가 커지며 글이 세로로 무너짐.
      v4 두 줄+버튼(106~122px) → 기각("홈페이지를 너무 많이 가리잖아").
      v5(현재) 규칙:
        - 높이 ~52px 두 줄이 상한. 더 키우지 말 것.
        - 버튼 요소 없음 — 아이폰은 안내 문장뿐, 안드로이드는 줄 전체가 탭 영역
          (알약 버튼을 다시 넣으면 높이가 는다). 문구를 상태에 따라 바꾸지 말 것.
        - 배경은 밝은 종이색 — 남색 금지(페이지 다크 카드와 붙어 보인다).
        - 글과 조작을 옆으로 붙이지 말 것(v3 사고). × 는 absolute 라 높이 무관.
   ⚠️ 화면 문자열은 전부 \uXXXX 이스케이프(생성기 scratchpad/gen_inapp.py).
   ⚠️ 파일을 고치면 페이지들의 src="inapp.js?v=N" 도 같이 올린다. 페이지 HTML
      캐시가 10분이라 배포 직후엔 옛 판이 보일 수 있다(정상 — 기다리면 바뀐다).
   ============================================================================= */
(function () {
  'use strict';

  var ua = navigator.userAgent || '';
  var IN_APP = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|KAKAOTALK|Line\/|NAVER\(inapp|NAVER |DaumApps|everytime|band|Snapchat|Twitter|TikTok/i.test(ua);
  /* 인앱 판정 단일 소스 — login.html 이 구글 버튼 잠금에 쓴다(2026-08-08).
     UA 목록을 다른 파일에 복사하지 말 것. 배너를 닫아도(sessionStorage) 판정은 참이어야
     하므로 아래 early return 들보다 먼저 내보낸다. */
  window.MONC_INAPP = IN_APP;
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
    var nav = document.getElementById('navbar');
    var top = nav ? Math.round(nav.getBoundingClientRect().height) : 0;

    var css = ''
      + '.iab{position:fixed;left:0;right:0;z-index:90;top:' + top + 'px;'
      + 'padding:8px 48px 9px 14px;background:#F3F8FF;color:#1E2229;'
      + 'border-bottom:1px solid rgba(27,58,107,.18);box-shadow:0 4px 14px rgba(20,28,44,.08);'
      + "font-family:'SUIT Variable',SUIT,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;"
      + 'word-break:keep-all;-webkit-font-smoothing:antialiased;}'
      + '.iab-t{margin:0;font-size:12.5px;font-weight:700;line-height:1.45;color:#1B3A6B;}'
      + '.iab-s{margin:2px 0 0;font-size:12px;font-weight:600;line-height:1.45;color:#5C6675;}'
      + '.iab.go{cursor:pointer;}'
      + '.iab.go .iab-s{color:#1B3A6B;text-decoration:underline;text-underline-offset:2px;}'
      + '.iab-x{position:absolute;top:50%;right:2px;transform:translateY(-50%);'
      + 'width:44px;height:44px;border:0;background:transparent;color:#5C6675;'
      + 'font-size:18px;line-height:1;cursor:pointer;}';
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    var bar = document.createElement('div');
    bar.className = 'iab' + (isAndroid ? ' go' : '');
    bar.setAttribute('role', 'region');

    var l1 = appName ? ('<b>' + appName + '</b>' + " \uc571\uc5d0\uc11c\ub294 \uc790\ub8cc \ubc1b\uae30\u00b7\ub85c\uadf8\uc778\uc774 \uc548 \ub3fc\uc694.") : "\uc774 \uc571 \uc548\uc5d0\uc11c\ub294 \uc790\ub8cc \ubc1b\uae30\u00b7\ub85c\uadf8\uc778\uc774 \uc548 \ub3fc\uc694.";
    var l2 = isAndroid ? "\uc5ec\uae30\ub97c \ub204\ub974\uba74 Chrome\uc73c\ub85c \uc5f4\ub824\uc694 \u2192" : (isKakao ? "\uc624\ub978\ucabd \uc544\ub798 Safari \uc544\uc774\ucf58\uc73c\ub85c \uc5f4\uc5b4 \uc8fc\uc138\uc694." : "\uc624\ub978\ucabd \uc704 \u22ef \u2192 \u2018\uc678\ubd80 \ube0c\ub77c\uc6b0\uc800\uc5d0\uc11c \uc5f4\uae30\u2019\ub85c \uc5f4\uc5b4 \uc8fc\uc138\uc694.");

    bar.innerHTML = ''
      + '<p class="iab-t">' + l1 + '</p>'
      + '<p class="iab-s">' + l2 + '</p>'
      + '<button class="iab-x" type="button" aria-label="\ub2eb\uae30">\u00d7</button>';

    document.body.appendChild(bar);

    /* 배너는 fixed 라 흐름을 안 밀어서, 본문 맨 위(눈썹 라벨·'← 홈으로' 같은 것)를 덮었다
       (2026-08-02 C-4). 배너 높이만큼 자리를 만든다.
       ⚠️ body 의 padding-top 을 건드리지 말 것 — 페이지마다 자기 padding 을 나중에
          다시 쓰는 곳이 있어 조용히 덮인다(reviews.html 실측: 113 을 넣었는데 56 으로
          되돌아갔다). 흐름에 들어가는 **자리 차지 요소**는 아무도 덮어쓰지 않는다.
       ⚠️ 높이는 고정값이 아니라 실측 — 문구가 두 줄이 되는 기기에서 달라진다. */
    var spacer = document.createElement('div');
    spacer.className = 'iab-space';
    spacer.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(spacer, document.body.firstChild);
    function sizeSpacer() { spacer.style.height = (bar.offsetHeight || 0) + 'px'; }
    sizeSpacer();
    window.addEventListener('resize', sizeSpacer);

    bar.querySelector('.iab-x').addEventListener('click', function (ev) {
      ev.stopPropagation();   // 안드로이드에선 줄 전체가 탭 영역이라 닫기가 이동으로 새면 안 된다
      bar.remove();
      spacer.remove();        // 안 지우면 화면 위에 빈 띠가 남는다
      try { sessionStorage.setItem(HIDE_KEY, '1'); } catch (e) {}
    });

    if (isAndroid) bar.addEventListener('click', function () {
      // 줄 전체가 탭 영역(52px — 터치 44px 충족). 같은 주소 폴백은 제자리 루프라 없음.
      location.href = 'intent://' + pageUrl.replace(/^https?:\/\//, '')
        + '#Intent;scheme=https;package=com.android.chrome;end';
    });
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
