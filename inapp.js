/* =============================================================================
   인앱 브라우저 안내 — inapp.js (2026-08-01 · v4)
   =============================================================================
   인스타(유입 1위)·카톡 인앱 브라우저는 파일 다운로드를 막고 구글 OAuth 를
   거부한다(disallowed_useragent). 인앱이면 nav 아래에 안내를 띄운다.

   ⚠️ 하루 동안 세 번 깨진 자리다 — 아래를 지키지 않으면 네 번째가 된다.
      v1 흐름 안 배너: 고정 nav 와 글자 겹침 → 깨짐.
      v2 전체 화면 덮개: 오너 기각("그냥 상단 설명으로 바꿔").
      v3 한 줄 flex(글+버튼 옆 배치): '주소 복사' 버튼이 눌린 뒤 문구가 길어지며
         옆의 글을 짓눌러 한 단어씩 세로로 무너짐 + 남색 배경이 아래 남색 카드와
         붙어 한 덩어리로 보임(오너: "이게 뭐냐고").
      v4(현재) 규칙:
        - 글과 조작을 **위아래로 쌓는다** — 한 줄 flex 에 글+버튼을 같이 넣지 말 것.
        - **버튼 문구를 상태에 따라 바꾸지 말 것**(길어지면 레이아웃이 무너진다).
        - 아이폰은 버튼 없음 — \u22ef 안내 문장만(복사 버튼이 사고 원인이라 제거).
        - 배경은 밝은 종이색 — 남색 금지(페이지 다크 카드와 붙어 보인다).
   ⚠️ 화면 문자열은 전부 \uXXXX 이스케이프(생성기 scratchpad/gen_inapp.py).
   ⚠️ 파일을 고치면 페이지들의 src="inapp.js?v=N" 도 같이 올린다(인앱 캐시).
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
    var nav = document.getElementById('navbar');
    var top = nav ? Math.round(nav.getBoundingClientRect().height) : 0;

    var css = ''
      + '.iab{position:fixed;left:0;right:0;z-index:90;top:' + top + 'px;'
      + 'padding:10px 12px 12px 16px;background:#FFFDF6;color:#26221C;'
      + 'border-bottom:1.5px solid rgba(27,58,107,.22);box-shadow:0 8px 22px rgba(20,28,44,.12);'
      + "font-family:'SUIT Variable',SUIT,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;"
      + 'word-break:keep-all;-webkit-font-smoothing:antialiased;}'
      + '.iab-r1{display:flex;align-items:flex-start;gap:6px;}'
      + '.iab-t{flex:1;min-width:0;margin:5px 0 0;font-size:13.5px;font-weight:800;line-height:1.5;color:#1B3A6B;}'
      + '.iab-s{margin:4px 44px 0 0;font-size:12.5px;font-weight:600;line-height:1.55;color:#5A5346;}'
      + '.iab-go{display:inline-block;margin-top:9px;min-height:44px;padding:0 18px;border:0;border-radius:999px;'
      + 'background:#1B3A6B;color:#fff;font:inherit;font-size:13px;font-weight:800;cursor:pointer;}'
      + '.iab-x{flex:none;width:44px;height:44px;margin:-4px -4px 0 0;border:0;border-radius:50%;'
      + 'background:transparent;color:#8A8578;font-size:20px;line-height:1;cursor:pointer;}';
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    var bar = document.createElement('div');
    bar.className = 'iab';
    bar.setAttribute('role', 'region');

    var msg = appName ? ('<b>' + appName + '</b>' + " \uc548\uc5d0\uc11c\ub294 \uc790\ub8cc \ubc1b\uae30\uc640 \ub85c\uadf8\uc778\uc774 \uc548 \ub3fc\uc694.") : "\uc9c0\uae08 \ubcf4\uc2dc\ub294 \uc571 \uc548\uc5d0\uc11c\ub294 \uc790\ub8cc \ubc1b\uae30\uc640 \ub85c\uadf8\uc778\uc774 \uc548 \ub3fc\uc694.";

    bar.innerHTML = ''
      + '<div class="iab-r1"><p class="iab-t">' + msg + '</p>'
      + '<button class="iab-x" type="button" aria-label="\ub2eb\uae30">\u00d7</button></div>'
      + (isAndroid
          ? '<button class="iab-go" type="button">Chrome\uc73c\ub85c \uc5f4\uae30</button>'
          : '<p class="iab-s">' + (isKakao ? "\uc624\ub978\ucabd \uc544\ub798 Safari \uc544\uc774\ucf58\uc744 \ub204\ub974\uba74 \uc815\uc0c1\uc73c\ub85c \uc5f4\ub824\uc694." : "\uc624\ub978\ucabd \uc704 \u22ef \uba54\ub274\uc5d0\uc11c \u2018\uc678\ubd80 \ube0c\ub77c\uc6b0\uc800\uc5d0\uc11c \uc5f4\uae30\u2019\ub97c \ub204\ub974\uba74 \uc815\uc0c1\uc73c\ub85c \uc5f4\ub824\uc694.") + '</p>');

    document.body.appendChild(bar);

    bar.querySelector('.iab-x').addEventListener('click', function () {
      bar.remove();
      try { sessionStorage.setItem(HIDE_KEY, '1'); } catch (e) {}
    });

    var go = bar.querySelector('.iab-go');
    if (go) go.addEventListener('click', function () {
      // 크롬으로 넘긴다. 같은 주소를 폴백으로 주면 제자리 루프라 주지 않는다.
      location.href = 'intent://' + pageUrl.replace(/^https?:\/\//, '')
        + '#Intent;scheme=https;package=com.android.chrome;end';
    });
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
