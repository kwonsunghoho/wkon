/* ══════════════════════════════════════════════════════════════════════════
   긴 글 임시 보관 — 공용 (2026-08-02 신설 · 진단 D-10)

   왜 필요한가: 1,500자를 쓰다가 실수로 뒤로 가거나, 로그인 게이트에 튕기거나,
   인앱 브라우저가 화면을 새로 뜨우면 **글이 통째로 사라졌다.** 자동 저장은
   program.html 한 곳(서버 저장)에만 있었고, polish·ai-killer·answers·experiences 는
   아무 보호가 없었다.

   쓰는 법 — 지키고 싶은 입력칸에 속성 한 개:
       <textarea data-keep="polish-input"></textarea>
   제출이 성공하면 페이지가 지운다:
       window.moncDraftClear('polish-input')

   ⚠️⚠️ **sessionStorage 다.** localStorage 로 바꾸지 말 것 — 학생이 쓴 답변은
      개인 이야기다. 공용·가족 PC 에서 브라우저를 닫아도 남아 있으면 다음 사람이 읽는다.
      sessionStorage 는 탭을 닫으면 사라지면서도 '실수로 뒤로 가기'는 막아 준다
      (실제 손실의 대부분이 그 경우다). 서버 저장이 필요하면 program.html 처럼
      해당 기능의 테이블에 컬럼을 두고 마이그레이션을 쓴다.
   ⚠️ 값이 이미 있는 칸은 덮어쓰지 않는다 — 서버에서 불러온 초안을 지우면 안 된다.
   ⚠️ 되살렸다는 사실을 화면에 말한다. 조용히 채우면 '내가 안 쓴 글'로 읽힌다(원칙 11).
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.moncDraftClear) return;

  var PREFIX = 'monc_draft:';
  var MAX = 20000;          // 한 칸당 상한 — sessionStorage 를 통째로 채우지 않게

  function key(k) { return PREFIX + k; }

  window.moncDraftClear = function (k) {
    try { sessionStorage.removeItem(key(k)); } catch (e) {}
    var el = document.querySelector('[data-keep="' + k + '"]');
    var note = el && el.parentNode && el.parentNode.querySelector('.dk-note');
    if (note) note.remove();
  };

  function note(el, text) {
    if (!el.parentNode) return;
    var n = el.parentNode.querySelector('.dk-note');
    if (!n) {
      n = document.createElement('p');
      n.className = 'dk-note';
      n.setAttribute('role', 'status');
      /* 12px 하한 준수. 색은 페이지마다 다르니 currentColor 계열로 두고 투명도만 준다. */
      n.style.cssText = 'margin:6px 0 0;font-size:12px;line-height:1.5;opacity:.75;';
      el.parentNode.insertBefore(n, el.nextSibling);
    }
    n.textContent = text;
  }

  function wire(el) {
    var k = el.getAttribute('data-keep');
    if (!k || el.dataset.dkWired) return;
    el.dataset.dkWired = '1';

    // 되살리기 — 빈 칸일 때만
    try {
      var saved = sessionStorage.getItem(key(k));
      if (saved && !el.value) {
        el.value = saved;
        note(el, '쓰다 만 글을 되살렸어요. 이어서 쓰시면 돼요.');
        el.dispatchEvent(new Event('input', { bubbles: true }));   // 글자수 표시 등이 따라오게
      }
    } catch (e) {}

    var t = null;
    el.addEventListener('input', function () {
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        try {
          var v = el.value || '';
          if (!v.trim()) { sessionStorage.removeItem(key(k)); return; }
          sessionStorage.setItem(key(k), v.slice(0, MAX));
        } catch (e) { /* 용량 초과 등 — 조용히 넘어간다. 저장 실패가 입력을 막으면 안 된다 */ }
      }, 600);
    });
  }

  function scan() { document.querySelectorAll('[data-keep]').forEach(wire); }

  if (document.body) scan();
  else document.addEventListener('DOMContentLoaded', scan);
  /* 화면을 JS 로 그리는 페이지(answers·experiences)를 위해 나중에 생긴 칸도 잡는다 */
  if (window.MutationObserver) {
    var mo = new MutationObserver(function () { scan(); });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', function () {
      mo.observe(document.body, { childList: true, subtree: true });
    });
  }
})();
