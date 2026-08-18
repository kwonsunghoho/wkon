/* 연구실 자료 읽기 화면 — lab-shelf.html 위 전체 덮개 (2026-08-10)
   pdf.js(vendor/pdfjs 4.10.38 legacy)는 이 모듈이 처음 열릴 때만 로드된다.
   노출: window.MONC_LAB_VIEWER = { open(opts), close() }
   open(opts): { url, title, canSave, onSave } → Promise
   - 첫 페이지가 그려지면 resolve. 로드·파싱·첫 렌더 실패면 reject —
     호출 쪽(lab-shelf)이 현행 방식(새 탭/받기)으로 폴백한다.
   ⚠️ 서명 URL 은 60초 만료 — disableRange:true 로 한 번에 받는다(range 재요청이 만료를 밟는다).
   ⚠️ z-index 는 lab-shelf 와 한 벌: 뷰어 900 < 토스트(#shToast) 950. */
(function () {
  'use strict';
  if (window.MONC_LAB_VIEWER) return;

  var VENDOR = 'vendor/pdfjs/';
  var MAX_LIVE = 16;                 // 살아 있는 캔버스 상한 — 구형 폰 메모리 보호
  var pdfjsLoad = null;

  function loadPdfjs() {
    if (!pdfjsLoad) {
      pdfjsLoad = import('./' + VENDOR + 'pdf.min.mjs').then(function (m) {
        m.GlobalWorkerOptions.workerSrc = VENDOR + 'pdf.worker.min.mjs';
        return m;
      });
      pdfjsLoad.catch(function () { pdfjsLoad = null; });   // 일시 실패가 영구화되지 않게
    }
    return pdfjsLoad;
  }

  /* ── DOM — 처음 열 때 한 번만 만든다. 색은 팔레트 그대로:
     다크 면 --ink(#1C2A3A), 다크 위 CTA 는 흰 알약+네이비(#1B3A6B) 글씨. ── */
  var root = null, tit = null, body = null, note = null, saveBtn = null, closeBtn = null;
  function ensureDom() {
    if (root) return;
    var st = document.createElement('style');
    st.textContent =
      '#lvRoot{position:fixed;inset:0;z-index:900;background:#1C2A3A;display:flex;flex-direction:column;}' +
      '#lvRoot[hidden]{display:none;}' +
      '#lvBar{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;' +
        'padding-top:calc(8px + env(safe-area-inset-top,0px));' +
        'background:#1C2A3A;border-bottom:1px solid rgba(255,255,255,.12);}' +
      '#lvClose{flex:none;width:44px;height:44px;border:0;background:transparent;color:#fff;' +
        'border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;}' +
      '#lvClose:active{background:rgba(255,255,255,.12);}' +
      '#lvTitle{flex:1;min-width:0;color:#fff;font-size:15px;font-weight:700;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '#lvSave{flex:none;min-height:44px;padding:0 18px;border:0;border-radius:999px;' +
        'background:#fff;color:#1B3A6B;font-size:15px;font-weight:800;cursor:pointer;}' +
      '#lvSave:active{transform:scale(.97);}' +
      '#lvSave[hidden]{display:none;}' +
      '#lvBody{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;' +
        'padding:12px 10px calc(24px + env(safe-area-inset-bottom,0px));}' +
      '.lv-page{position:relative;margin:0 auto 10px;background:#fff;border-radius:6px;' +
        'overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.35);}' +
      '.lv-page canvas{display:block;width:100%;height:auto;}' +
      '.lv-links{position:absolute;inset:0;pointer-events:none;}' +
      '.lv-links a{position:absolute;pointer-events:auto;}' +
      '.lv-page.err::after{content:"이 페이지를 그리지 못했어요";' +
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'color:#8a94a5;font-size:13px;}' +
      '#lvNote{position:absolute;left:0;right:0;top:45%;text-align:center;' +
        'color:rgba(255,255,255,.85);font-size:14px;pointer-events:none;}' +
      '#lvNote[hidden]{display:none;}';
    document.head.appendChild(st);

    root = document.createElement('div');
    root.id = 'lvRoot';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '자료 읽기');
    root.hidden = true;
    root.innerHTML =
      '<div id="lvBar">' +
        '<button id="lvClose" type="button" aria-label="닫기">' +
          '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
          '<path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</button>' +
        '<div id="lvTitle"></div>' +
        '<button id="lvSave" type="button" hidden>저장</button>' +
      '</div>' +
      '<div id="lvBody"></div>' +
      '<div id="lvNote" hidden></div>';
    document.body.appendChild(root);
    tit = root.querySelector('#lvTitle');
    body = root.querySelector('#lvBody');
    note = root.querySelector('#lvNote');
    saveBtn = root.querySelector('#lvSave');
    closeBtn = root.querySelector('#lvClose');
    closeBtn.addEventListener('click', function () { closeUI(); });
    saveBtn.addEventListener('click', function () { if (S.onSave) S.onSave(); });
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.open) closeUI();
    });
    window.addEventListener('resize', onResize);
  }

  /* ── 상태 ── */
  var S = { open: false, doc: null, io: null, wraps: [], live: [], onSave: null, pushed: false,
            cssW: 0, ratio: 1.414, prevFocus: null, prevOverflow: '', gen: 0 };

  function setNote(t) { note.textContent = t || ''; note.hidden = !t; }

  function pageW() {
    var w = body.clientWidth - 20;            // 좌우 패딩 10px
    return Math.max(200, Math.min(900, w));
  }

  /* 캔버스 LRU — 멀어진 페이지는 비워 메모리를 지킨다(자리는 높이로 유지) */
  function evictFar(cur) {
    while (S.live.length > MAX_LIVE) {
      S.live.sort(function (a, b) { return Math.abs(a - cur) - Math.abs(b - cur); });
      var far = S.live.pop();
      var w = S.wraps[far - 1];
      if (w) {
        var c = w.querySelector('canvas');
        if (c) { w.style.height = c.clientHeight + 'px'; c.remove(); }
        w.dataset.done = '';
      }
    }
  }

  /* PDF 안 하이퍼링크 — 캔버스는 그림일 뿐이라 링크 주석(annotation)을 <a> 로 따로 얹는다.
     좌표는 scale 1 뷰포트의 백분율 — 리사이즈로 캔버스가 다시 그려져도 그대로 맞는다.
     캔버스가 LRU 로 비워져도 층은 남고, 재렌더 때 지우고 다시 얹는다(중복 방지). */
  function drawLinks(w, page, annots) {
    var old = w.querySelector('.lv-links'); if (old) old.remove();
    var links = (annots || []).filter(function (a) {
      return a.subtype === 'Link' && (a.url || a.dest);
    });
    if (!links.length) return;
    var vp = page.getViewport({ scale: 1 });
    var lay = document.createElement('div');
    lay.className = 'lv-links';
    links.forEach(function (an) {
      var r = vp.convertToViewportRectangle(an.rect);
      var el = document.createElement('a');
      el.style.left = (Math.min(r[0], r[2]) / vp.width * 100) + '%';
      el.style.top = (Math.min(r[1], r[3]) / vp.height * 100) + '%';
      el.style.width = (Math.abs(r[2] - r[0]) / vp.width * 100) + '%';
      el.style.height = (Math.abs(r[3] - r[1]) / vp.height * 100) + '%';
      if (an.url) {
        /* 바깥 주소 — 새 탭. 사용자가 직접 누르는 <a> 라 인앱 팝업 차단에 안 걸린다. */
        el.href = an.url; el.target = '_blank'; el.rel = 'noopener noreferrer';
        el.title = an.url;
      } else {
        /* 문서 안 이동(목차 등) — 해당 쪽으로 스크롤 */
        el.href = '#';
        el.setAttribute('aria-label', '문서 안 해당 위치로 이동');
        el.addEventListener('click', function (e) { e.preventDefault(); goDest(an.dest); });
      }
      lay.appendChild(el);
    });
    w.appendChild(lay);
  }

  function goDest(dest) {
    if (!S.doc) return;
    var gen = S.gen;
    (typeof dest === 'string' ? S.doc.getDestination(dest) : Promise.resolve(dest))
      .then(function (d) {
        if (gen !== S.gen || !d || !d[0]) return;
        return S.doc.getPageIndex(d[0]).then(function (idx) {
          if (gen !== S.gen) return;
          var t = S.wraps[idx];
          if (t) body.scrollTop += t.getBoundingClientRect().top - body.getBoundingClientRect().top - 12;
        });
      }).catch(function () {});
  }

  function renderPage(n) {
    var gen = S.gen;
    var w = S.wraps[n - 1];
    if (!S.doc || !w || w.dataset.done === '1' || w.dataset.busy === '1') return Promise.resolve();
    w.dataset.busy = '1';
    return S.doc.getPage(n).then(function (page) {
      if (gen !== S.gen) return;                       // 닫혔거나 재배치됨
      var cssW = S.cssW;
      var vp1 = page.getViewport({ scale: 1 });
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var vp = page.getViewport({ scale: (cssW / vp1.width) * dpr });
      var c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      var old = w.querySelector('canvas'); if (old) old.remove();
      w.appendChild(c);
      return page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp })
        .promise.then(function () {
          if (gen !== S.gen) return;
          w.style.height = 'auto';
          w.dataset.done = '1'; w.dataset.busy = '';
          w.classList.remove('err');
          if (S.live.indexOf(n) < 0) S.live.push(n);
          evictFar(n);
          return page.getAnnotations({ intent: 'display' })
            .catch(function () { return []; })   // 링크를 못 읽어도 본문 읽기는 막지 않는다
            .then(function (annots) {
              if (gen === S.gen) drawLinks(w, page, annots);
              page.cleanup();
            });
        });
    }).catch(function (err) {
      if (gen !== S.gen) return;
      w.dataset.busy = ''; w.classList.add('err');
      throw err;
    });
  }

  function layout(numPages) {
    S.cssW = pageW();
    body.innerHTML = '';
    S.wraps = []; S.live = [];
    for (var i = 0; i < numPages; i++) {
      var d = document.createElement('div');
      d.className = 'lv-page';
      d.style.width = S.cssW + 'px';
      d.style.height = Math.round(S.cssW * S.ratio) + 'px';
      d.dataset.page = String(i + 1);
      body.appendChild(d);
      S.wraps.push(d);
    }
    if (S.io) S.io.disconnect();
    S.io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (en.isIntersecting) renderPage(Number(en.target.dataset.page)).catch(function () {});
      });
    }, { root: body, rootMargin: '1200px 0px' });
    S.wraps.forEach(function (w) { S.io.observe(w); });
  }

  var rsTimer = null;
  function onResize() {
    if (!S.open || !S.doc) return;
    clearTimeout(rsTimer);
    rsTimer = setTimeout(function () {
      if (!S.open || !S.doc) return;
      if (Math.abs(pageW() - S.cssW) < 60) return;     // 주소창 접힘 정도는 무시
      layout(S.doc.numPages);
      renderPage(1).catch(function () {});
    }, 200);
  }

  /* ── 뒤로가기 — 열 때 상태를 쌓고, 닫기는 back 으로 통일한다 ── */
  function onPop() {
    if (!S.open) return;
    S.pushed = false;
    teardown();
  }
  function closeUI() {
    if (!S.open) return;
    if (S.pushed) { history.back(); return; }          // popstate 가 teardown 한다
    teardown();
  }
  function teardown() {
    S.gen++; S.open = false;
    if (S.io) { S.io.disconnect(); S.io = null; }
    if (S.doc) { try { S.doc.destroy(); } catch (e) {} S.doc = null; }
    S.wraps = []; S.live = []; S.onSave = null;
    body.innerHTML = ''; setNote('');
    root.hidden = true;
    document.body.style.overflow = S.prevOverflow;
    if (S.prevFocus && S.prevFocus.focus) { try { S.prevFocus.focus(); } catch (e) {} }
    S.prevFocus = null;
  }

  function open(opts) {
    ensureDom();
    if (S.open) closeUI();
    S.open = true; S.gen++;
    var gen = S.gen;
    S.onSave = opts.canSave ? (opts.onSave || null) : null;
    tit.textContent = opts.title || '자료';
    saveBtn.hidden = !opts.canSave;
    S.prevFocus = document.activeElement;
    S.prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.hidden = false;
    closeBtn.focus();
    try { history.pushState({ moncLabViewer: 1 }, ''); S.pushed = true; }
    catch (e) { S.pushed = false; }
    setNote('자료를 여는 중…');

    return loadPdfjs().then(function (pdfjs) {
      if (gen !== S.gen) throw new Error('closed');
      var task = pdfjs.getDocument({
        url: opts.url,
        disableRange: true,
        cMapUrl: VENDOR + 'cmaps/', cMapPacked: true,
        standardFontDataUrl: VENDOR + 'standard_fonts/'
      });
      task.onProgress = function (p) {
        if (gen !== S.gen || !p || !p.total) return;
        setNote('자료를 여는 중… ' +
          Math.min(99, Math.round(p.loaded / p.total * 100)) + '%');
      };
      return task.promise;
    }).then(function (doc) {
      if (gen !== S.gen) { try { doc.destroy(); } catch (e) {} throw new Error('closed'); }
      S.doc = doc;
      return doc.getPage(1).then(function (p1) {
        if (gen !== S.gen) throw new Error('closed');
        var vp = p1.getViewport({ scale: 1 });
        S.ratio = vp.height / vp.width;
        layout(doc.numPages);
        return renderPage(1);
      });
    }).then(function () {
      if (gen !== S.gen) throw new Error('closed');
      setNote('');
    }).catch(function (err) {
      if (gen === S.gen && S.open) closeUI();          // 실패한 덮개는 남기지 않는다
      throw err;                                        // 호출 쪽 폴백 신호
    });
  }

  window.MONC_LAB_VIEWER = { open: open, close: closeUI };
})();
