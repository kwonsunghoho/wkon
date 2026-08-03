/* ══════════════════════════════════════════════════════════════════════════
   scroll-keep.js — 뒤로 왔을 때 '보던 자리'로 되돌리기 (전 페이지 공용)

   왜 필요한가 (2026-08-03 오너 신고 "영상관 갔다 나오니까 맨 위로 뚝 끊기면서 올라간다")
   ─────────────────────────────────────────────────────────────────────────
   브라우저는 원래 뒤로/앞으로 올 때 **떠날 때 그리던 화면을 통째로 되살린다**(bfcache).
   스크롤 위치도 그 안에 들어 있어서, 아무것도 안 해도 보던 자리에서 이어진다.

   그런데 같은 날 "고쳤는데 왜 옛 화면이 깜빡이냐"를 잡으려고 읽기 전용 화면 19곳에
   `pageshow + e.persisted → location.reload()` 를 넣었다. 되살린 화면을 버리고 새로
   받게 하는 처리라 **되살아난 스크롤 위치까지 같이 버려진다.**

   여기서 끝이 아니다. 이 사이트의 목록은 대부분 Supabase 에서 받아 그리므로,
   다시 받는 순간의 페이지는 아직 짧다. 브라우저가 되돌아갈 자리를 못 찾고 맨 위에
   멈춘다(챌린지 후기 목록 실측: 4000px → 0px).

   그래서 이 파일이 한다 — **떠날 때 위치를 적어 두고, 목록이 다 들어와 페이지가
   충분히 길어지는 순간 그 자리로 옮긴다.**

   지켜야 할 것
   ─────────────────────────────────────────────────────────────────────────
   ⚠️ 새로 눌러 들어온 방문(navigation type 'navigate')은 절대 건드리지 않는다.
      메뉴에서 눌러 들어왔는데 중간부터 보이면 그게 고장이다. 되돌리는 건
      'reload'(위 bfcache 차단이 부른 새로고침)와 'back_forward'(뒤로/앞으로) 뿐이다.
   ⚠️ 사용자가 먼저 움직였으면(스크롤·터치·키) 그만둔다. 읽고 있는 사람을 끌어당기지 않는다.
   ⚠️ 되돌릴 때는 반드시 순간이동이다. reviews-list 처럼 `scroll-behavior:smooth` 가
      걸린 페이지에서 그냥 scrollTo 하면 화면이 주르륵 흘러내린다 — 잠깐 auto 로 바꿔서 옮긴다.
   ⚠️ 기록은 sessionStorage(탭 하나·닫으면 사라짐). localStorage 로 바꾸지 말 것 —
      공용 기기에서 다음 사람이 남의 마지막 위치를 물려받는다.
   ⚠️ admin.html 에는 일부러 안 붙였다. 뒤로 오면 탭이 '오늘'로 돌아가는데 스크롤만
      되살리면 **다른 탭에서 적어 둔 자리**로 가 버린다(원칙 11 — 상태를 단정하지 않기).
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var KEY  = 'monc_scroll_v1:' + location.pathname + location.search;   // 페이지마다 따로(?kind=·?shelf= 포함)
  var MIN  = 40;      // 이만큼도 안 내렸으면 되돌릴 게 없다
  var WAIT = 3000;    // 목록이 늦게 와도 여기까지는 기다린다
  var STEP = 50;      // 다시 재 보는 간격(ms) — 숨은 탭에서 멈추는 rAF 대신 타이머를 쓴다

  function now() {
    return Math.round(window.pageYOffset || document.documentElement.scrollTop || 0);
  }

  function save() {
    try { sessionStorage.setItem(KEY, String(now())); } catch (e) {}
  }

  /* 떠나기 직전에 적는다. unload 가 아니라 pagehide 인 이유: 모바일 사파리는 unload 를
     안 주는 경우가 있고, bfcache 로 얼려 둘 때도 pagehide 는 온다. */
  window.addEventListener('pagehide', save);
  // 안드로이드는 pagehide 없이 탭만 숨겼다 되살릴 때가 있어 숨는 시점에도 적어 둔다.
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });

  // ── 여기서부터는 '되돌릴 자리가 있는 방문'인지 판정 ─────────────────────
  var kind = '';
  try {
    var e0 = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    if (e0) kind = e0.type;
    else if (performance.navigation) kind = (performance.navigation.type === 2) ? 'back_forward'
                                         : (performance.navigation.type === 1) ? 'reload' : 'navigate';
  } catch (e) {}
  if (kind !== 'reload' && kind !== 'back_forward') return;   // 새로 눌러 들어온 방문 — 맨 위가 맞다

  var want = 0;
  try { want = parseInt(sessionStorage.getItem(KEY), 10) || 0; } catch (e) {}
  if (want < MIN) return;

  var done = false;
  function letGo() { done = true; }
  ['wheel', 'touchstart', 'keydown'].forEach(function (t) {
    try { window.addEventListener(t, letGo, { passive: true }); }
    catch (e) { window.addEventListener(t, letGo); }
  });

  function jump(top) {
    done = true;
    var el = document.documentElement;
    var prev = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';        // CSS 의 smooth 를 잠깐 끈다 — 되돌리기는 순간이동이어야 한다
    try { window.scrollTo(0, top); }
    finally { el.style.scrollBehavior = prev; }
  }

  var t0 = Date.now();
  (function tick() {
    if (done) return;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (max >= want) { jump(want); return; }                 // 그 자리가 생겼다
    if (Date.now() - t0 > WAIT) {                            // 끝내 안 길어지면(자료가 줄었다) 갈 수 있는 데까지
      if (max > MIN) jump(max);
      return;
    }
    setTimeout(tick, STEP);
  })();
})();
