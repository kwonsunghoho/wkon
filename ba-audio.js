/* ══════════════════════════════════════════════════════════════════════════
   비포/애프터 음성 — 콤팩트 플레이어 + 동시 재생 차단 (2026-08-02 신설)

   오너 지적: "비포애프터 녹음본 재생박스 너무 커, 동시 재생이 되는데?"
   원인 둘 다 **네이티브 `<audio controls>` 를 그대로 쓴 것**이다.
     ① iOS 사파리는 폭이 좁으면 컨트롤을 큰 회색 덩어리로 그린다(실측 셀 높이 168px).
        `::-webkit-media-controls-*` 는 iOS 에서 안 먹어 CSS 로 줄일 수 없다.
     ② 오디오 요소끼리는 서로를 모른다 — 비포를 켠 채 애프터를 켜면 겹쳐서 들린다.
        전·후를 비교하는 화면에서 이건 기능이 망가진 것이다.

   두 가지를 한다.
     A. **동시 재생 차단(전역)** — 페이지의 어떤 오디오든 하나가 시작하면 나머지를 멈춘다.
        `play` 는 버블링이 없어 **document 캡처 단계**로 듣는다. 나중에 DOM 에 꽂히는
        오디오(mypage 서명 URL)도 자동으로 걸린다.
     B. **콤팩트 UI(선택 적용)** — `.ba-cell` 안의 오디오만 우리 버튼으로 바꾼다.

   쓰는 법:
       <div class="ba-cell" data-ba="before" style="…기존 셀 스타일…">
         <div style="…">BEFORE</div>
         <audio preload="none" controls src="audio/x-before.mp3"></audio>
       </div>
       <script src="ba-audio.js" defer></script>

   ⚠️ **마크업의 `controls` 를 지우지 말 것.** 이 스크립트가 뜨지 않으면(로드 실패·구형)
      네이티브 컨트롤이 그대로 남아 **소리는 들린다.** controls 를 빼 두면 스크립트가
      실패하는 순간 증거가 통째로 사라진다(결제를 결심하는 화면이다).
   ⚠️ `preload="none"` 유지 — challenge-voice 가 재생도 안 했는데 3,854KB 를 받던
      자리다(원칙 13). 그래서 **길이(duration)는 재생 전에는 모른다** — 시간 표시를
      만들지 않고 진행 막대만 쓴다. 재생 전에 '0:14' 같은 값을 지어내지 말 것.
   ⚠️ 셀 폭이 320px 화면에서 110px 까지 좁아진다. 아이콘·라벨만 넣는 이유다.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__baAudio) return;
  window.__baAudio = 1;

  /* ── A. 동시 재생 차단 ─────────────────────────────────────────────────
     capture:true 가 핵심 — media 이벤트는 버블링하지 않는다. */
  document.addEventListener('play', function (e) {
    var me = e.target;
    if (!me || !me.tagName) return;
    var t = me.tagName.toLowerCase();
    if (t !== 'audio' && t !== 'video') return;
    var all = document.querySelectorAll('audio, video');
    for (var i = 0; i < all.length; i++) {
      if (all[i] !== me && !all[i].paused) all[i].pause();
    }
  }, true);

  /* ── B. 콤팩트 UI ──────────────────────────────────────────────────── */
  var cells = document.querySelectorAll('.ba-cell');
  if (!cells.length) return;

  var PLAY  = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L13 8z" fill="currentColor"/></svg>';
  var PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.4" y="3.2" width="2.7" height="9.6" rx="1" fill="currentColor"/><rect x="8.9" y="3.2" width="2.7" height="9.6" rx="1" fill="currentColor"/></svg>';

  var CSS = ''
    /* 셀의 안쪽 여백은 버튼이 가진다 — 원본 인라인 padding 은 스크립트가 0 으로 덮는다 */
    + '.ba-cell.is-ba{overflow:hidden;}'
    + '.ba-btn{display:flex;align-items:center;gap:8px;width:100%;min-width:0;min-height:52px;'
    +   'padding:0 10px;border:0;background:none;font:inherit;color:inherit;cursor:pointer;text-align:left;}'
    + '.ba-ic{flex:0 0 32px;width:32px;height:32px;border-radius:50%;display:flex;'
    +   'align-items:center;justify-content:center;background:var(--action,#1B3A6B);color:#fff;}'
    + '.ba-ic svg{width:14px;height:14px;display:block;}'
    /* 라벨은 원본 라벨의 색·굵기를 그대로 물려받는다(비포=흐림 / 애프터=네이비) */
    + '.ba-tx{min-width:0;font-size:12px;font-weight:800;letter-spacing:.06em;'
    +   'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
    + '.ba-pg{height:3px;background:rgba(23,42,71,.12);}'
    + '.ba-pg i{display:block;height:100%;width:0;background:var(--action,#1B3A6B);transition:width .15s linear;}'
    + '.ba-err{padding:10px;font-size:12px;font-weight:700;color:#B3261E;}'
    /* 모바일 탭 잔류 강조 방지 — hover 는 마우스 있는 기기에서만 */
    + '@media(hover:hover){.ba-btn:hover .ba-ic{background:var(--action-hover,#16305A);}}'
    /* 320px 에서는 셀 폭이 110px 까지 좁아져 'BEFORE' 가 말줄임된다(실측). 활자 12px 하한을
       지키려면 칸을 넓혀야 하므로 이 폭에서만 위아래로 쌓는다(2단 114px < 구 1단 168px).
       ⚠️ 격자는 페이지에 인라인 style 로 박혀 있어 !important 가 필요하다. */
    + '@media(max-width:359px){.ba-grid{grid-template-columns:1fr !important;}}';

  var st = document.createElement('style');
  st.id = 'baAudioCss';
  st.textContent = CSS;
  document.head.appendChild(st);

  function upgrade(cell) {
    var audio = cell.querySelector('audio');
    if (!audio) return;

    /* 원본 라벨(<div>BEFORE</div>) — 글자와 색을 새 버튼으로 옮기고 원본은 숨긴다.
       색을 그대로 물려받아야 비포/애프터 구분이 유지된다. */
    var srcLabel = cell.querySelector('div');
    var text = srcLabel ? srcLabel.textContent.trim()
                        : (cell.getAttribute('data-ba') || '').toUpperCase();
    var color = srcLabel ? getComputedStyle(srcLabel).color : '';
    if (srcLabel) srcLabel.hidden = true;

    cell.classList.add('is-ba');
    cell.style.padding = '0';
    // 격자에 표시를 남긴다 — 320px 에서 1열로 내리는 규칙이 이 클래스를 잡는다
    if (cell.parentElement) cell.parentElement.classList.add('ba-grid');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ba-btn';
    btn.innerHTML = '<span class="ba-ic">' + PLAY + '</span><span class="ba-tx"></span>';
    var tx = btn.querySelector('.ba-tx');
    tx.textContent = text;
    if (color) tx.style.color = color;

    var pg = document.createElement('div');
    pg.className = 'ba-pg';
    pg.innerHTML = '<i></i>';
    var fill = pg.querySelector('i');

    audio.removeAttribute('controls');
    audio.style.display = 'none';
    cell.insertBefore(btn, audio);
    cell.insertBefore(pg, audio);

    var human = /after/i.test(text) ? '애프터' : '비포';
    function setLabel(playing) {
      btn.setAttribute('aria-label', human + ' 음성 ' + (playing ? '일시정지' : '재생'));
    }
    setLabel(false);

    btn.addEventListener('click', function () {
      if (audio.paused) {
        var p = audio.play();
        /* 자동재생 정책·네트워크 실패는 조용히 넘기지 않는다(원칙 11) */
        if (p && p.catch) p.catch(function () { fail(); });
      } else {
        audio.pause();
      }
    });

    audio.addEventListener('play', function () {
      btn.querySelector('.ba-ic').innerHTML = PAUSE;
      setLabel(true);
    });
    function stopped() {
      btn.querySelector('.ba-ic').innerHTML = PLAY;
      setLabel(false);
    }
    audio.addEventListener('pause', stopped);
    audio.addEventListener('ended', function () { stopped(); fill.style.width = '0'; });
    audio.addEventListener('timeupdate', function () {
      var d = audio.duration;
      if (!d || !isFinite(d)) return;               // preload=none 이라 재생 전엔 모른다
      fill.style.width = Math.min(100, (audio.currentTime / d) * 100) + '%';
    });

    function fail() {
      btn.hidden = true; pg.hidden = true;
      if (cell.querySelector('.ba-err')) return;
      var e = document.createElement('div');
      e.className = 'ba-err';
      e.textContent = text + ' 음성을 재생할 수 없어요.';
      cell.appendChild(e);
    }
    audio.addEventListener('error', fail);
  }

  for (var i = 0; i < cells.length; i++) upgrade(cells[i]);
})();
