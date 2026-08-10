# 연구실 자료 읽기 화면(뷰어) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자료실(lab-shelf) PDF 를 받기 전에 화면에서 먼저 읽게 하고, 저장은 읽기 화면 안의 버튼으로 옮긴다.

**Architecture:** lab-shelf.html 위에 덮이는 전체 화면 뷰어(`lab-viewer.js` 모듈 + `vendor/pdfjs/`). 서버(lab-file)는 무변경 — mode:'view'/'download' 를 이미 지원한다. 실패는 전부 현행 경로로 조용히 degrade.

**Tech Stack:** 손 HTML/JS(빌드 없음), pdfjs-dist 4.10.38 legacy(벤더링), Supabase Edge Function(lab-file, 무변경).

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-10-lab-viewer-design.md` (2026-08-10 오너 승인)
- 서버·admin·delivery 정책 무변경. 화면 전용(view) 자료의 다운로드 차단은 서버가 계속 한다.
- 저장 버튼 노출 조건: `row.delivery !== 'view'` (링크 자료는 뷰어 대상 아님)
- 뷰어 대상 판별: `!row.is_link && ext === 'pdf'` (ext 미상이면 현행 경로)
- 인앱(인스타·카톡)에서 저장 클릭 → 시도하지 않고 토스트 안내(`window.MONC_INAPP`)
- 새 색 금지 — 다크 면은 `--ink #1C2A3A` 계열, 다크 위 CTA 는 흰 알약+네이비 글씨(CLAUDE.md 팔레트)
- 터치 44px+, 화면 문자열 활자 12px+
- 검증은 미러(375px 우선) 실측 — lint/build/테스트 시스템 없음
- 이 레포엔 `deno` 없음, `node` 는 nvm 로더 필요(이번 작업엔 둘 다 불필요)

---

### Task 1: pdf.js 벤더 반입 (`vendor/pdfjs/`)

**Files:**
- Create: `vendor/pdfjs/pdf.min.mjs`, `vendor/pdfjs/pdf.worker.min.mjs`, `vendor/pdfjs/cmaps/*`, `vendor/pdfjs/standard_fonts/*`, `vendor/pdfjs/LICENSE`, `vendor/pdfjs/README.md`(버전·출처 기록)

**Interfaces:**
- Produces: Task 2 가 `import('./vendor/pdfjs/pdf.min.mjs')` 로 쓰는 정적 파일들. workerSrc = `vendor/pdfjs/pdf.worker.min.mjs`, cMapUrl = `vendor/pdfjs/cmaps/`, standardFontDataUrl = `vendor/pdfjs/standard_fonts/`.

- [x] **Step 1: npm 레지스트리에서 tarball 받기(스크래치패드)** — `curl -sL https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-4.10.38.tgz` → `tar -xzf`. legacy 빌드를 쓴다(구형 폰 폭 넓힘).
- [x] **Step 2: 파일 배치** — `package/legacy/build/pdf.min.mjs`·`pdf.worker.min.mjs` → `vendor/pdfjs/`, `package/cmaps` → `vendor/pdfjs/cmaps`, `package/standard_fonts` → `vendor/pdfjs/standard_fonts`, `package/LICENSE` → `vendor/pdfjs/LICENSE`. README.md 에 버전 4.10.38·출처·갱신법 3줄.
- [x] **Step 3: 크기 실측 기록** — `du -sh vendor/pdfjs` + 파일별 크기. gzip 전송 추정(`gzip -c | wc -c`)을 README 에 적는다.
- [x] **Step 4: 커밋** — `git add vendor/pdfjs && git commit`

### Task 2: `lab-viewer.js` 뷰어 모듈

**Files:**
- Create: `lab-viewer.js` (모듈 스크립트, 루트)

**Interfaces:**
- Consumes: Task 1 의 vendor 경로들(위 값 그대로)
- Produces: `window.MONC_LAB_VIEWER = { open(opts) → Promise, close() }`
  - `opts = { url:string(서명 URL), title:string, canSave:boolean, onSave:function|null }`
  - `open()` 은 **첫 페이지 렌더 완료 시 resolve**, 로드·파싱·첫 렌더 실패 시 reject(호출 쪽 폴백 신호)

- [x] **Step 1: 파일 작성** — 아래 코드 전문 그대로(설계 포인트: 덮개 DOM·CSS 자체 생성 / IntersectionObserver 지연 렌더 / dpr≤2 / 렌더 캔버스 LRU 16장(메모리) / `disableRange:true`(서명 URL 60초 — 다중 range 요청이 만료를 밟는다) / pushState+popstate 뒤로가기 닫기 / Esc·X 닫기 / body 스크롤 잠금 / resize 재배치):

```js
/* 연구실 자료 읽기 화면 — lab-shelf.html 위 전체 덮개 (2026-08-10)
   pdf.js(vendor/pdfjs 4.10.38 legacy)는 이 모듈이 처음 열릴 때만 로드된다.
   노출: window.MONC_LAB_VIEWER = { open(opts), close() }
   open(opts): { url, title, canSave, onSave } → Promise
   - 첫 페이지가 그려지면 resolve. 로드·파싱·첫 렌더 실패면 reject —
     호출 쪽(lab-shelf)이 현행 방식(새 탭/받기)으로 폴백한다.
   ⚠️ 서명 URL 은 60초 만료 — disableRange:true 로 한 번에 받는다(range 재요청이 만료를 밟는다). */
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

  /* ── DOM — 처음 열 때 한 번만 만든다 ── */
  var root = null, bar = null, tit = null, body = null, note = null, saveBtn = null, closeBtn = null;
  function ensureDom() {
    if (root) return;
    var st = document.createElement('style');
    st.textContent =
      '#lvRoot{position:fixed;inset:0;z-index:5000;background:#1C2A3A;display:flex;flex-direction:column;}' +
      '#lvRoot[hidden]{display:none;}' +
      '#lvBar{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;padding-top:calc(8px + env(safe-area-inset-top,0px));background:#16233270;background:rgba(15,24,38,.55);border-bottom:1px solid rgba(255,255,255,.10);backdrop-filter:none;}' +
      '#lvClose{flex:none;width:44px;height:44px;border:0;background:transparent;color:#fff;border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;}' +
      '#lvClose:active{background:rgba(255,255,255,.12);}' +
      '#lvTitle{flex:1;min-width:0;color:#fff;font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '#lvSave{flex:none;min-height:44px;padding:0 18px;border:0;border-radius:999px;background:#fff;color:#1B3A6B;font-size:15px;font-weight:800;cursor:pointer;}' +
      '#lvSave:active{transform:scale(.97);}' +
      '#lvSave[hidden]{display:none;}' +
      '#lvBody{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:12px 10px calc(24px + env(safe-area-inset-bottom,0px));}' +
      '.lv-page{position:relative;margin:0 auto 10px;max-width:900px;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.35);}' +
      '.lv-page canvas{display:block;width:100%;height:auto;}' +
      '.lv-page.err::after{content:"이 페이지를 그리지 못했어요";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#8a94a5;font-size:13px;}' +
      '#lvNote{position:absolute;left:0;right:0;top:45%;text-align:center;color:rgba(255,255,255,.85);font-size:14px;pointer-events:none;}' +
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
          '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</button>' +
        '<div id="lvTitle"></div>' +
        '<button id="lvSave" type="button" hidden>저장</button>' +
      '</div>' +
      '<div id="lvBody"></div>' +
      '<div id="lvNote" hidden></div>';
    document.body.appendChild(root);
    bar = root.querySelector('#lvBar');
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
          page.cleanup();
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
      var n = S.doc.numPages;
      layout(n);
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
        setNote('자료를 여는 중… ' + Math.min(99, Math.round(p.loaded / p.total * 100)) + '%');
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
```

- [x] **Step 2: 미러 재구축** — 스크래치패드에 `site/` rsync 미러 + `server.py`(기존 패턴) 생성, `.claude/launch.json` 의 `wkon-mirror` `runtimeArgs` 경로를 이 세션 스크래치패드로 갱신(죽은 옛 경로 교체).
- [x] **Step 3: 한글 테스트 PDF 생성** — 스크래치패드 venv 에 `fpdf2` 설치, `/System/Library/Fonts/Supplemental/AppleGothic.ttf` 임베드로 6쪽 한글 PDF → 미러 `site/sample.pdf` (레포에 커밋하지 않는다).
- [x] **Step 4: 단독 검증 페이지** — 미러 전용 `site/viewer-test.html`(레포 밖): `lab-viewer.js` 모듈 로드 후 버튼 3개 — ①열기(canSave:true, onSave→화면에 '저장 눌림' 표시) ②열기(canSave:false) ③깨진 URL(reject 확인). 375px 로 렌더·저장 버튼·Esc·뒤로가기 닫기·실패 reject 실측.
- [x] **Step 5: 커밋** — `git add lab-viewer.js && git commit`

### Task 3: `lab-shelf.html` 연결

**Files:**
- Modify: `lab-shelf.html` — openDoc(1246)·openSheet 파일 목록(1185)·파일 클릭(1658) 세 자리 + 헬퍼 추가

**Interfaces:**
- Consumes: `window.MONC_LAB_VIEWER.open(opts)` (Task 2), lab-file 응답 `{ok,url,mode,title,fileLabel,watermarked,code,...}`
- Produces: 없음(말단 화면)

- [x] **Step 1: 뷰어 로더·저장 헬퍼 추가** — `openUrl` 함수 아래에 삽입:

```js
/* ── 읽기 화면(뷰어) — PDF 는 받기 전에 화면에서 먼저 읽는다 (2026-08-10 오너 확정) ──
   부품(lab-viewer.js + vendor/pdfjs)은 뷰어를 처음 여는 순간에만 받는다.
   구형 폰·로드 실패·그리기 실패는 전부 현행 경로(openUrl/받기)로 조용히 돌아간다. */
var VIEWER_SRC = 'lab-viewer.js?v=1';
var viewerLoad = null;
function viewerSupported() {
  return !!(window.IntersectionObserver && window.Promise &&
    window.HTMLScriptElement && ('noModule' in HTMLScriptElement.prototype));
}
function ensureViewer() {
  if (window.MONC_LAB_VIEWER) return Promise.resolve(window.MONC_LAB_VIEWER);
  if (viewerLoad) return viewerLoad;
  viewerLoad = new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.type = 'module'; s.src = VIEWER_SRC;
    var t = setTimeout(fail, 8000);
    function fail() { clearTimeout(t); viewerLoad = null; reject(new Error('viewer_load')); }
    s.onerror = fail;
    s.onload = function () {
      clearTimeout(t);
      if (window.MONC_LAB_VIEWER) resolve(window.MONC_LAB_VIEWER); else fail();
    };
    document.head.appendChild(s);
  });
  return viewerLoad;
}

/* 뷰어의 '저장' — 받기 경로는 현행과 완전히 같다(mode:'download' → location.href).
   ⚠️ 인앱(인스타·카톡)은 파일 저장을 조용히 막는다 — 시도 대신 안내한다. */
var saveBusy = false;
function saveDoc(row, fileId) {
  if (window.MONC_INAPP) {
    toast('인스타·카톡 브라우저에서는 저장이 막혀요. 오른쪽 위 메뉴의 ‘다른 브라우저로 열기’를 눌러 주세요.', 4600);
    return;
  }
  if (saveBusy) return;
  saveBusy = true;
  toast('파일을 준비하는 중…', 8000);
  window.MONC.sb.functions.invoke('lab-file', {
    body: { resourceId: row.id, mode: 'download', password: lastPw || '', fileId: fileId || '' }
  }).then(function (res) {
    saveBusy = false;
    var d = (res && res.data) || {};
    if (!d.ok || !d.url) { toast(d.error || '파일을 받지 못했어요. 잠시 뒤 다시 시도해 주세요.'); return; }
    location.href = d.url;
    toast(d.watermarked ? '받으신 분 정보가 표시된 파일이에요.' : '파일 받기를 시작했어요.', 3200);
  }).catch(function () {
    saveBusy = false;
    toast('파일을 받지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  });
}
```
(인앱 안내 문구는 inapp.js 규칙대로 `\uXXXX` 이스케이프 — 위 예시가 그 형태다.)

- [x] **Step 2: openDoc 라우팅** — 시그니처 `function openDoc(row, password, fileId, o)`. 함수 서두에:

```js
var direct = !!(o && o.direct);
var ext = String((o && o.ext) || row.file_ext || '').toLowerCase();
var useViewer = !direct && !row.is_link && ext === 'pdf' && viewerSupported();
```

mode 계산을 `useViewer ? 'view' : ((row.is_link || row.delivery === 'view') ? 'view' : 'download')` 로. 성공 분기(`d.ok && d.url`)에서 `openUrl` 호출 **앞에**:

```js
if (useViewer && d.mode === 'view' && !d.external) {
  if (sheetKind === 'pw' || sheetKind === 'file') closeSheet();
  ensureViewer().then(function (v) {
    return v.open({
      url: d.url,
      title: (d.title || row.title) + (d.fileLabel ? ' — ' + d.fileLabel : ''),
      canSave: row.delivery !== 'view',
      onSave: function () { saveDoc(row, fileId || ''); }
    });
  }).then(function () {
    $('shToast').hidden = true;
  }).catch(function () {
    // 뷰어가 안 되면 현행 방식으로 — 서명 URL 60초 만료 대비, 새로 받아 연다
    openDoc(row, lastPw, fileId, { direct: true, ext: ext });
  });
  return;
}
```

- [x] **Step 3: 상·하편 ext 전달** — 파일 목록 버튼에 `data-ext` 추가(1189행 근처): `'<button class="fl-item" type="button" data-fid="' + esc(f.id) + '" data-ext="' + esc(String(f.ext || '')) + '">'`. 클릭(1658행): `openDoc(fileTarget, lastPw, b.getAttribute('data-fid'), { ext: b.getAttribute('data-ext') || '' });`
- [x] **Step 4: 토스트 z-index 확인** — `#shToast` 가 뷰어(z 5000) 위에 오도록(저장 안내가 뷰어 위에 떠야 한다). 낮으면 `#shToast` 만 5100 으로 올린다.
- [x] **Step 5: 미러 통합 실측** — rsync 재동기화 후 `lab-shelf.html?shelf=archive` 를 375px 로 열고, 콘솔에서 `MONC.sb.functions.invoke` 를 가짜 응답(`{data:{ok:true,url:'/sample.pdf',mode:'view',title:'테스트 자료'}}`)으로 바꿔 실제 클릭 → 뷰어 열림·저장 버튼(딜리버리별 노출)·저장 클릭 시 mode:'download' 호출·뒤로가기/X/Esc 닫기·폴백(`url:'/broken.pdf'` → 현행 openUrl 경로 진입)을 확인.
- [x] **Step 6: 커밋**

### Task 4: 375px 실측 검증 마무리

**Files:** (수정 발견 시 해당 파일)

- [x] **Step 1: 렌더 품질** — 375px·320px·데스크톱(1280px)에서 한글 PDF 6쪽 선명도(dpr2)·스크롤·페이지 간격. 세로→가로 회전(리사이즈 재배치).
- [x] **Step 2: 조작 실측** — 닫기 44px, 저장 44px, 제목 말줄임, Esc, 뒤로가기(뷰어만 닫히고 목록 유지), 스크롤 잠금(뒤 목록이 안 움직이는지), 뷰어 위 토스트 노출.
- [x] **Step 3: 접근성** — 열릴 때 포커스가 닫기로, 닫으면 원래 자리로. role=dialog.
- [x] **Step 4: 발견 수정 반영 + 커밋, 스크린샷 확보**

### Task 5: 문서·배포

**Files:**
- Modify: `docs/notes/lab.md`(뷰어 절 신설 — 규칙·폴백 표·전송량 실측), 필요 시 `CLAUDE.md` 연구실 행 한 줄
- 배포: `main` 병합 + push

- [x] **Step 1: lab.md 에 '읽기 화면(뷰어)' 절 추가** — 판별 규칙, delivery 별 저장 버튼, degrade 표, `?v=` 버스터 규칙(lab-viewer.js 수정 시 VIEWER_SRC 버전 동반), vendor 갱신법, 전송량 실측치.
- [x] **Step 2: 커밋 → main 병합 → push(=배포)** — 결제 흐름 파일을 건드렸으므로 브랜치에서 검증을 끝낸 뒤 병합한다(CLAUDE.md 규칙).
- [x] **Step 3: 오너 확인 안내** — 라이브에서 실제 자료(서명 URL·워터마크)로 1회 확인 요청. 배포 직후엔 강력 새로고침.

## Self-Review 결과

- 스펙 전 항목이 Task 1~5 에 대응(벤더/뷰어/연결/degrade/검증/문서). 
- 상·하편 ext 는 Task 3 Step 3 이 없으면 뷰어 판별이 빠진다 — 포함 확인.
- `open()` reject 시 덮개를 스스로 닫고 던진다(폴백과 이중 화면 방지) — Task 2 코드에 반영.
- 서명 URL 만료(60초) 대비 `disableRange:true` + 폴백은 재호출로 새 URL — 반영.
