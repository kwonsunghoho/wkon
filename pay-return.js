/* ══════════════════════════════════════════════════════════════════════════
   결제 복귀 대기 화면 — 공용 (2026-08-02 신설 · 진단 D-7)

   왜 필요한가: 모바일 결제는 결제사로 나갔다가 `?payresult=1` 을 달고 **페이지가
   새로 뜬다.** 그 뒤 verify-payment 왕복이 끝날 때까지 사용자가 보는 것은
   **평소와 똑같은 화면**이었다 — 결제가 된 건지 만 건지 알 방법이 없어서 뒤로가기나
   새로고침을 누르게 된다. 트래픽 99%가 모바일이라 사실상 모든 결제가 이 경로다.

   쓰는 법 — 결제 복귀를 처리하는 페이지에 두 줄:
       <script src="pay-return.js" defer></script>          ← ?payresult 가 있으면 스스로 뜬다
       Promise.resolve(handlePayReturn()).finally(moncPayDone);   ← 끝나면 내린다

   ⚠️ `?payresult` 를 스스로 보고 **즉시** 뜬다 — 페이지 스크립트가 준비되길 기다리면
      그 사이 빈 화면이 그대로 보인다(그 몇 초가 이 물건의 존재 이유다).
   ⚠️ 30초 안전장치가 있다. 어떤 이유로든 moncPayDone 이 안 불려도 화면이 잠기면 안 된다
      — 갇히면 사용자는 결제 결과도 못 보고 나갈 방법도 없다.
   ⚠️ 문구에 '완료'라고 쓰지 말 것. 이 시점에 성공 여부는 아직 모른다(원칙 11).
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.moncPayDone) return;                     // 중복 주입 방지

  var p = new URLSearchParams(location.search);
  if (!p.get('payresult')) { window.moncPayDone = function () {}; return; }

  var css =
    '.mpr{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:14px;padding:24px;' +
    'background:rgba(255,255,255,.97);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);' +
    "font-family:'SUIT Variable',SUIT,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;" +
    'text-align:center;word-break:keep-all;}' +
    '.mpr-ring{width:38px;height:38px;border-radius:50%;border:3px solid rgba(27,58,107,.2);' +
    'border-top-color:#1B3A6B;animation:mprSpin .9s linear infinite;}' +
    '@keyframes mprSpin{to{transform:rotate(360deg);}}' +
    '.mpr-t{margin:0;font-size:16px;font-weight:800;color:#1B3A6B;line-height:1.5;}' +
    /* ⚠️ 웜그레이(#5F574B)로 되돌리지 말 것 — 2026-08-05 순백 팔레트로 바꾸면서 배경은
       흰색이 됐는데 이 줄만 남아, 결제 복귀 화면 글자만 누렇게 떴다(2026-08-06 감사).
       이 파일은 CSS 를 문자열로 들고 있어 tokens.css 를 안 타므로 값을 직접 적는다
       — tokens 의 --text-muted 와 같은 값으로 맞춘다. */
    '.mpr-s{margin:0;font-size:13px;font-weight:600;color:#545C68;line-height:1.6;}' +
    /* 움직임을 줄이는 설정에서는 회전 대신 정지한 고리 — 상태는 문구가 말한다 */
    '@media (prefers-reduced-motion: reduce){.mpr-ring{animation:none;border-top-color:#1B3A6B;}}';

  var st = document.createElement('style');
  st.textContent = css;

  var box = document.createElement('div');
  box.className = 'mpr';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.innerHTML =
    '<div class="mpr-ring" aria-hidden="true"></div>' +
    '<p class="mpr-t">결제 결과를 확인하고 있어요</p>' +
    '<p class="mpr-s">창을 닫거나 뒤로 가지 말아 주세요.<br>보통 몇 초면 끝나요.</p>';

  var timer = null;
  function show() {
    if (!document.head || !document.body) return;
    document.head.appendChild(st);
    document.body.appendChild(box);
    timer = setTimeout(hide, 30000);   // 안전장치 — 무슨 일이 있어도 화면을 잠그지 않는다
  }
  function hide() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (box.parentNode) box.parentNode.removeChild(box);
    if (st.parentNode) st.parentNode.removeChild(st);
  }
  window.moncPayDone = hide;

  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show);
})();
