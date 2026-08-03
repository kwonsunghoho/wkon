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
   ⚠️ admin.html 은 `data-manual` 로 붙인다. 뒤로 오면 탭이 '오늘'로 돌아가므로,
      **탭을 먼저 되살린 뒤**가 아니면 다른 탭에서 적어 둔 자리로 가 버린다
      (원칙 11 — 상태를 단정하지 않기). 되돌리는 시점은 admin 이 직접 정한다.
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

  var frozen = false;

  function save() {
    if (frozen) return;
    try { sessionStorage.setItem(KEY, String(now())); } catch (e) {}
  }

  /* 떠나기 직전에 적는다. unload 가 아니라 pagehide 인 이유: 모바일 사파리는 unload 를
     안 주는 경우가 있고, bfcache 로 얼려 둘 때도 pagehide 는 온다. */
  window.addEventListener('pagehide', save);
  // 안드로이드는 pagehide 없이 탭만 숨겼다 되살릴 때가 있어 숨는 시점에도 적어 둔다.
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });

  /* ⚠️⚠️ 이 파일에서 제일 조심할 곳 (2026-08-03 2차 — 1차가 폰에서 안 먹은 이유가 여기다).
     뒤로 오면 순서가 이렇다:
       ① 떠날 때 pagehide → 900 적음 ✓
       ② 뒤로 → bfcache 가 화면을 되살림(pageshow persisted) → 페이지가 곧바로 통째 새로고침
       ③ **그 새로고침의 pagehide 가 또 적는다** — 되살아난 위치가 아직 안 잡혔으면 0 을 적는다
       ④ 새로 뜬 화면은 '적어 둔 자리 = 0' 을 읽어 맨 위에 선다
     ①에서 적은 값이 우리가 쓸 전부다. **되살아난 뒤로는 아무것도 적지 않는다.**
     ⚠️ 이 처리가 먹으려면 이 파일이 페이지의 reload 처리보다 **먼저** 실행돼야 한다 —
        그래서 태그에 defer 를 붙이지 않는다(붙이면 본문 인라인 스크립트가 먼저 잡는다). */
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    frozen = true;
    setTimeout(function () { frozen = false; }, 2000);   // 새로고침이 안 오는 페이지를 위한 안전망
  });

  // ── 되돌릴 자리가 있는 방문인가 ─────────────────────────────────────────
  var kind = '';
  try {
    var e0 = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    if (e0) kind = e0.type;
    else if (performance.navigation) kind = (performance.navigation.type === 2) ? 'back_forward'
                                         : (performance.navigation.type === 1) ? 'reload' : 'navigate';
  } catch (e) {}
  var backish = (kind === 'reload' || kind === 'back_forward');   // 새로 눌러 들어온 방문(navigate)은 맨 위가 맞다

  /* ⚠️ 되돌릴 값은 **지금 읽어 둔다.** 나중에 읽으면 안 된다 — 아직 그리는 중에 사용자가
     앱을 내리면 위 visibilitychange 가 현재 위치(0)로 덮어써서 되돌릴 자리를 잃는다. */
  var want = 0;
  try { want = parseInt(sessionStorage.getItem(KEY), 10) || 0; } catch (e) {}

  var done = false;
  function letGo() { done = true; }

  function jump(top) {
    done = true;
    var el = document.documentElement;
    var prev = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';        // CSS 의 smooth 를 잠깐 끈다 — 되돌리기는 순간이동이어야 한다
    try { window.scrollTo(0, top); }
    finally { el.style.scrollBehavior = prev; }
  }

  /* wait: 페이지가 길어지길 기다리는 한도(ms). admin 처럼 화면을 켜기까지 조회가 여러 번인
     곳은 넉넉히 준다. 되돌릴 방문이 아니거나 적어 둔 자리가 없으면 아무 일도 안 한다. */
  function restore(opts) {
    if (!backish || want < MIN || done) return;
    var limit = (opts && opts.wait) || WAIT;

    // 사용자가 먼저 움직였으면 그만둔다 — 읽고 있는 사람을 끌어당기지 않는다
    ['wheel', 'touchstart', 'keydown'].forEach(function (t) {
      try { window.addEventListener(t, letGo, { passive: true }); }
      catch (e) { window.addEventListener(t, letGo); }
    });

    var t0 = Date.now();
    (function tick() {
      if (done) return;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      if (max >= want) { jump(want); return; }               // 그 자리가 생겼다
      if (Date.now() - t0 > limit) {                         // 끝내 안 길어지면(자료가 줄었다) 갈 수 있는 데까지
        if (max > MIN) jump(max);
        return;
      }
      setTimeout(tick, STEP);
    })();
  }

  /* 되돌리기 시점을 페이지가 정해야 하는 곳은 태그에 data-manual 을 달고 직접 부른다
     (admin — 탭을 먼저 되살린 뒤가 아니면 다른 탭에서 적어 둔 자리로 간다). */
  /* frozen() — 페이지가 따로 적어 두는 것이 있으면(admin 의 '보던 탭') 같이 잠가야 한다.
     되살아난 직후의 새로고침에서 다시 적으면 옛 값이 현재 화면 값으로 덮인다. */
  window.moncScrollKeep = {
    save: save, restore: restore, backish: backish, want: want,
    frozen: function () { return frozen; }
  };

  var tag = document.currentScript;
  if (!tag || !tag.hasAttribute('data-manual')) restore();
})();
