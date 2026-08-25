/* ══════════════════════════════════════════════════════════════════════════
   games.js — 역량검사 게임 연습장 (2026-08-24 신설)

   AI역량검사(신역검) 전략게임 9종의 '유형'을 자체 제작 게임으로 연습하는 화면.
   ⚠️ 전부 MONC 자체 구현이다 — 잡다(자인원) 화면·그래픽·문구를 가져오지 말 것
      (저작권·상표. 유형=아이디어는 자유, 표현 복제는 침해 — docs/notes/games.md).
   ⚠️ 서버·AI 호출 없음. 전부 브라우저 안에서 돈다(제공 원가 0 — 오너 확정 무료).
   ⚠️ 점수는 localStorage(개인정보 아님, 기기별 최고 기록뿐). 회원 게이트 없음.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 공용 유틸 ── */
  function $(id) { return document.getElementById(id); }
  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(arr) { return arr[rnd(arr.length)]; }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = rnd(i + 1), t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  /* 심볼 참조 svg — 아이콘·도형은 전부 games.html <defs> 의 자체 제작 심볼(이모지 금지 — games.md) */
  function sym(id) {
    return '<svg aria-hidden="true"><use href="#' + id + '"/></svg>';
  }
  function flash(node, ok) {
    var c = ok ? 'gm-flash-ok' : 'gm-flash-no';
    node.classList.remove('gm-flash-ok', 'gm-flash-no');
    void node.offsetWidth;                      // 리플로우로 애니메이션 재시작
    node.classList.add(c);
  }
  function shake(node) {
    node.classList.remove('gm-shake');
    void node.offsetWidth;
    node.classList.add('gm-shake');
  }

  /* ── 기록 — 기기별 최고 점수. 위치 기록과 달리 개인정보가 아니라 localStorage 를 쓴다 ── */
  var LS_KEY = 'monc_games_v1';
  function readRec() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function saveRec(id, score) {
    var rec = readRec();
    var r = rec[id] || { best: 0, plays: 0 };
    r.plays += 1;
    var isNew = score > (r.best || 0);
    if (isNew) r.best = score;
    rec[id] = r;
    try { localStorage.setItem(LS_KEY, JSON.stringify(rec)); } catch (e) {}
    return isNew;
  }

  /* ── DOM ── */
  var hubWrap = $('gmHub'), grid = $('gmGrid');
  var stage = $('gmStage'), titleEl = $('gmTitle'), introEl = $('gmIntro');
  var hud = $('gmHud'), timeEl = $('gmTime'), timeBar = $('gmTimeBar'), scoreEl = $('gmScore');
  var board = $('gmBoard'), resultEl = $('gmResult'), backBtn = $('gmBack');

  /* ── 엔진 상태 ── */
  var cur = null;          // 현재 게임 정의
  var running = false;
  var timerId = 0, endAt = 0, timeLimit = 0;
  var score = 0;
  var cleanupFn = null;    // 게임별 타이머 정리 등

  function setScore(n) { score = n; scoreEl.textContent = String(n); }
  function addScore(n) { setScore(score + n); }

  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = 0; } }
  function startTimer(sec) {
    timeLimit = sec; endAt = Date.now() + sec * 1000;
    timeEl.textContent = sec + '초';
    timeBar.style.width = '100%';
    stopTimer();
    timerId = setInterval(function () {
      var left = endAt - Date.now();
      if (left <= 0) { finishGame(); return; }
      timeEl.textContent = Math.ceil(left / 1000) + '초';
      timeBar.style.width = (left / (timeLimit * 1000) * 100) + '%';
    }, 100);
  }

  function runCleanup() {
    if (cleanupFn) { try { cleanupFn(); } catch (e) {} cleanupFn = null; }
  }

  function finishGame() {
    if (!running) return;
    running = false;
    stopTimer();
    runCleanup();
    board.classList.remove('on');
    hud.classList.remove('on');
    var isNew = saveRec(cur.id, score);
    var best = (readRec()[cur.id] || {}).best || 0;
    resultEl.innerHTML =
      '<div class="r-name">' + sym(cur.icon) + cur.name + '</div>' +
      '<div class="r-score">' + score + '<small> ' + cur.unit + '</small></div>' +
      '<div class="r-best">이 기기 최고 기록 <b>' + best + cur.unit + '</b></div>' +
      (isNew && score > 0 ? '<span class="r-new">신기록!</span>' : '') +
      '<div class="r-btns">' +
        '<button type="button" class="gm-tohub" id="gmToHub">목록으로</button>' +
        '<button type="button" class="gm-again" id="gmAgain">다시 하기</button>' +
      '</div>';
    resultEl.classList.add('on');
    $('gmAgain').addEventListener('click', function () { startPlay(); });
    $('gmToHub').addEventListener('click', function () { goHub(); });
    $('gmAgain').focus();
  }

  /* 게임에 넘겨주는 손잡이 — 게임 코드는 이 밖의 엔진 내부를 만지지 않는다 */
  var api = {
    board: board,
    addScore: addScore,
    setScore: setScore,
    finish: finishGame,
    onCleanup: function (fn) { cleanupFn = fn; },
    flash: flash,
    shake: shake
  };

  /* ── 화면 전환 ── */
  function startPlay() {
    resultEl.classList.remove('on');
    introEl.style.display = 'none';
    setScore(0);
    board.innerHTML = '';
    board.classList.add('on');
    hud.classList.add('on');
    var timed = cur.time > 0;
    timeEl.parentNode.style.display = timed ? '' : 'none';
    timeBar.parentNode.style.display = timed ? '' : 'none';
    scoreEl.previousSibling.textContent = cur.scoreLabel || '점수';
    running = true;
    if (timed) startTimer(cur.time);
    cur.start(api);
  }

  function openGame(id, viaHistory) {
    var g = null;
    for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) g = GAMES[i];
    if (!g) return;
    cur = g;
    hubWrap.classList.add('off');
    stage.classList.add('on');
    board.classList.remove('on'); board.innerHTML = '';
    hud.classList.remove('on');
    resultEl.classList.remove('on');
    titleEl.innerHTML = sym(g.icon) + g.name;
    introEl.style.display = '';
    introEl.innerHTML =
      '<span class="meas">' + g.meas + '</span>' +
      '<ul>' + g.rules.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>' +
      (g.tips && g.tips.length
        ? '<details><summary>공략 팁 보기</summary><ul>' +
          g.tips.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></details>'
        : '') +
      '<button type="button" class="gm-start" id="gmStart">시작하기</button>';
    $('gmStart').addEventListener('click', startPlay);
    if (!viaHistory) {
      try { history.pushState({ gm: id }, '', '#' + id); } catch (e) {}
    }
    window.scrollTo(0, 0);
  }

  function goHub(viaHistory) {
    running = false;
    stopTimer();
    runCleanup();
    stage.classList.remove('on');
    hubWrap.classList.remove('off');
    renderHub();
    if (!viaHistory) {
      /* 게임을 열 때 push 한 히스토리를 되감는다 — 안 하면 뒤로가기가 게임 화면으로 돌아온다 */
      if (history.state && history.state.gm) { try { history.back(); return; } catch (e) {} }
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    }
  }

  backBtn.addEventListener('click', function () { goHub(); });
  window.addEventListener('popstate', function (e) {
    if (e.state && e.state.gm) openGame(e.state.gm, true);
    else if (stage.classList.contains('on')) goHub(true);
  });

  /* ── 허브 그리기 ── */
  function renderHub() {
    var rec = readRec();
    grid.innerHTML = '';
    GAMES.forEach(function (g) {
      var r = rec[g.id];
      var bs = r && r.best > 0 ? '최고 ' + r.best + g.unit : '아직 기록 없음';
      var card = el('button', 'gm-card',
        '<span class="ic" aria-hidden="true">' + sym(g.icon) + '</span>' +
        '<span class="nm">' + g.name + '</span>' +
        '<span class="ms">' + g.meas + '</span>' +
        '<span class="bs">' + bs + '</span>');
      card.type = 'button';
      card.setAttribute('role', 'listitem');
      card.addEventListener('click', function () { openGame(g.id); });
      grid.appendChild(card);
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     게임 9종 — 전부 이 아래에서만 정의한다. 새 게임은 GAMES 배열에 추가.
     ══════════════════════════════════════════════════════════════════════ */

  /* ── 1. 가위바위보 — 지시(이겨라/져라/비겨라)를 빠르게 뒤집어 판단 ── */
  function gameRPS(api) {
    var HANDS = ['gs-circle', 'gi-rps', 'gs-paper'];   // 바위·가위·보 — 자체 심볼
    var NAMES = ['바위', '가위', '보'];
    var winOf = function (o) { return (o + 2) % 3; };   // 상대를 이기는 손
    var loseOf = function (o) { return (o + 1) % 3; };  // 상대에게 지는 손
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q"><span class="gm-rule"><b id="rpsRule"></b></span>' +
      '<span class="sub">상대가 낸 손을 보고, 지시에 맞는 손을 고르세요</span></div>' +
      '<div class="gm-oppo" id="rpsOppo" aria-live="polite"></div>' +
      '<div class="gm-bigrow" id="rpsBtns"></div>';
    var ruleEl = $('rpsRule'), oppoEl = $('rpsOppo'), wrap = $('rpsBtns');
    var oppo = 0, want = 0;
    HANDS.forEach(function (h, i) {
      var btn = el('button', 'gm-big', sym(h) + '<span>' + NAMES[i] + '</span>');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        if (!isRunning()) return;
        if (i === want) { api.addScore(1); api.flash(b, true); }
        else api.flash(b, false);
        next();
      });
      wrap.appendChild(btn);
    });
    function next() {
      oppo = rnd(3);
      var mode = rnd(3);                                 // 0 이겨라 1 져라 2 비겨라
      want = mode === 0 ? winOf(oppo) : mode === 1 ? loseOf(oppo) : oppo;
      ruleEl.textContent = mode === 0 ? '이기세요' : mode === 1 ? '지세요' : '비기세요';
      oppoEl.innerHTML = sym(HANDS[oppo]) + '<span>' + NAMES[oppo] + '</span>';
    }
    next();
  }

  /* ── 2. 숫자 누르기 — 흩어진 숫자를 1부터 차례대로 ── */
  function gameNumbers(api) {
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q">1부터 차례대로 누르세요<span class="sub" id="numLv"></span></div>' +
      '<div class="gm-cells" id="numGrid" style="grid-template-columns:repeat(4,1fr)"></div>';
    var wrap = $('numGrid'), lvEl = $('numLv');
    var count = 5, next = 1;
    function build() {
      next = 1;
      lvEl.textContent = '이번 판: 1 ~ ' + count;
      wrap.innerHTML = '';
      var cells = [];
      for (var i = 0; i < 16; i++) cells.push(null);
      var spots = shuffle([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]).slice(0, count);
      var nums = shuffle(Array.apply(null, Array(count)).map(function (_, i) { return i + 1; }));
      spots.forEach(function (s, i) { cells[s] = nums[i]; });
      cells.forEach(function (n) {
        if (n == null) { wrap.appendChild(el('div', 'gm-cell empty', '')); return; }
        var c = el('button', 'gm-cell', String(n));
        c.type = 'button';
        c.addEventListener('click', function () {
          if (!isRunning() || c.classList.contains('done')) return;
          if (n === next) {
            c.classList.add('done');
            next++;
            if (next > count) {
              api.addScore(count);
              count = Math.min(count + 1, 12);
              setTimeout(function () { if (isRunning()) build(); }, 200);
            }
          } else shake(c);
        });
        wrap.appendChild(c);
      });
    }
    build();
  }

  /* ── 3. 개수 비교 — 점이 더 많은 쪽 고르기(크기를 섞어 면적으로 못 세게) ── */
  function gameCompare(api) {
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q">점이 <b>더 많은</b> 쪽을 누르세요</div>' +
      '<div class="gm-bigrow" style="align-items:stretch;padding-bottom:16px">' +
        '<button type="button" class="gm-dots" id="cmpL" aria-label="왼쪽 판"><i class="tag">왼쪽</i></button>' +
        '<button type="button" class="gm-dots" id="cmpR" aria-label="오른쪽 판"><i class="tag">오른쪽</i></button>' +
      '</div>';
    var L = $('cmpL'), R = $('cmpR');
    var moreLeft = true;
    function fill(panel, n) {
      panel.querySelectorAll('i:not(.tag)').forEach(function (d) { d.remove(); });
      /* 6x7 격자 자리를 섞어 뽑고 살짝 흔든다 — 겹침 없이 빠르게 셀 수 없는 배치 */
      var spots = shuffle(Array.apply(null, Array(42)).map(function (_, i) { return i; })).slice(0, n);
      spots.forEach(function (s) {
        var col = s % 6, row = Math.floor(s / 6);
        var size = 7 + rnd(7);
        var d = document.createElement('i');
        d.style.width = d.style.height = size + 'px';
        d.style.left = 'calc(' + (col * 16.6 + 2 + rnd(6)) + '% )';
        d.style.top = 'calc(' + (row * 14.2 + 2 + rnd(5)) + '% )';
        panel.appendChild(d);
      });
    }
    function next() {
      var diff = score >= 14 ? 1 : score >= 7 ? 2 : 3;
      var base = 8 + rnd(score >= 7 ? 16 : 10);
      moreLeft = rnd(2) === 0;
      fill(L, moreLeft ? base + diff : base);
      fill(R, moreLeft ? base : base + diff);
    }
    function answer(left) {
      if (!isRunning()) return;
      if (left === moreLeft) { api.addScore(1); api.flash(b, true); }
      else api.flash(b, false);
      next();
    }
    L.addEventListener('click', function () { answer(true); });
    R.addEventListener('click', function () { answer(false); });
    next();
  }

  /* ── 4. 도형 회전 — 회전하면 같아지는 도형 고르기(거울상이 함정) ── */
  function gameRotate(api) {
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q">아래 도형을 <b>돌려서 같아지는</b> 것을 고르세요<span class="sub">뒤집힌(거울) 도형은 정답이 아닙니다</span></div>' +
      '<div class="gm-rot-target"><span class="gm-shape target" id="rotTarget"></span></div>' +
      '<div class="gm-rot-opts" id="rotOpts"></div>';
    var targetEl = $('rotTarget'), optsEl = $('rotOpts');

    function walkShape(n) {
      var cells = { '0,0': true }, cur = [0, 0], list = [[0, 0]];
      var guard = 0;
      while (list.length < n && guard++ < 200) {
        var d = pick([[0, 1], [0, -1], [1, 0], [-1, 0]]);
        cur = [cur[0] + d[0], cur[1] + d[1]];
        var k = cur[0] + ',' + cur[1];
        if (!cells[k]) { cells[k] = true; list.push(cur.slice()); }
      }
      return list;
    }
    function normalize(cells) {
      var mr = Infinity, mc = Infinity;
      cells.forEach(function (c) { mr = Math.min(mr, c[0]); mc = Math.min(mc, c[1]); });
      return cells.map(function (c) { return [c[0] - mr, c[1] - mc]; });
    }
    function rot90(cells) {
      var mx = 0; cells.forEach(function (c) { mx = Math.max(mx, c[0]); });
      return normalize(cells.map(function (c) { return [c[1], mx - c[0]]; }));
    }
    function mirror(cells) {
      var mx = 0; cells.forEach(function (c) { mx = Math.max(mx, c[1]); });
      return normalize(cells.map(function (c) { return [c[0], mx - c[1]]; }));
    }
    function keyOf(cells) {
      return normalize(cells).map(function (c) { return c.join(','); }).sort().join('|');
    }
    function svgOf(cells, rotDeg) {
      var mr = 0, mc = 0;
      cells.forEach(function (c) { mr = Math.max(mr, c[0]); mc = Math.max(mc, c[1]); });
      var S = 18, W = (mc + 1) * S, H = (mr + 1) * S, M = Math.max(W, H);
      var rects = cells.map(function (c) {
        return '<rect x="' + (c[1] * S + (M - W) / 2) + '" y="' + (c[0] * S + (M - H) / 2) +
          '" width="' + (S - 2) + '" height="' + (S - 2) + '" rx="3" fill="currentColor"/>';
      }).join('');
      return '<svg width="86" height="86" viewBox="-4 -4 ' + (M + 8) + ' ' + (M + 8) +
        '" style="color:var(--accent);transform:rotate(' + (rotDeg || 0) + 'deg)" aria-hidden="true">' + rects + '</svg>';
    }
    function next() {
      var shape, rots, mir, tries = 0;
      /* 거울상이 회전과 같아지는 대칭 도형(ㅁ·ㅡ꼴)은 함정을 못 만들어 다시 뽑는다 */
      do {
        shape = normalize(walkShape(5 + rnd(2)));
        rots = [keyOf(shape)];
        var r = shape;
        for (var i = 0; i < 3; i++) { r = rot90(r); rots.push(keyOf(r)); }
        mir = mirror(shape);
      } while (rots.indexOf(keyOf(mir)) >= 0 && tries++ < 40);
      targetEl.innerHTML = svgOf(shape, 0);
      var correctRot = (1 + rnd(3)) * 90;
      var m1 = mir, m2 = rot90(mirror(shape));
      var opts = shuffle([
        { cells: shape, deg: correctRot, ok: true },
        { cells: m1, deg: rnd(4) * 90, ok: false },
        { cells: m2, deg: rnd(4) * 90, ok: false },
        { cells: rot90(rot90(mir)), deg: rnd(4) * 90, ok: false }
      ]);
      optsEl.innerHTML = '';
      opts.forEach(function (o, i) {
        var btn = el('button', 'gm-shape', svgOf(o.cells, o.deg));
        btn.type = 'button';
        btn.setAttribute('aria-label', '보기 ' + (i + 1));
        btn.addEventListener('click', function () {
          if (!isRunning()) return;
          if (o.ok) { api.addScore(1); api.flash(b, true); next(); }
          else { api.flash(b, false); shake(btn); }
        });
        optsEl.appendChild(btn);
      });
    }
    next();
  }

  /* ── 5. 길 만들기 — 타일을 돌려 왼쪽 입구에서 오른쪽 출구까지 연결 ── */
  function gamePath(api) {
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q">타일을 눌러 돌리고, <b>▶ 입구에서 출구 ▶</b>까지 길을 이으세요</div>' +
      '<div class="gm-path" id="pthGrid"></div>' +
      '<div class="gm-pathmeta"><span id="pthCleared">완성한 길 0개</span><span>완성마다 +10점</span></div>';
    var wrap = $('pthGrid'), clearedEl = $('pthCleared');
    var N = 4, cleared = 0;
    var tiles = [];                                   // {kind:'s'|'c', rot, btn}
    var entryRow = 0, exitRow = 0;
    var SIDES = ['U', 'R', 'D', 'L'];
    function conns(t) {                               // 타일이 잇는 두 변
      if (t.kind === 's') return t.rot % 2 === 0 ? ['L', 'R'] : ['U', 'D'];
      var a = SIDES[t.rot % 4], c = SIDES[(t.rot + 1) % 4];   // 꺾임: 이웃한 두 변
      return [a, c];
    }
    function svgTile(t) {
      var d = t.kind === 's'
        ? 'M2 24 L46 24'
        : 'M24 2 Q24 24 46 24';                       // 위(U)→오른쪽(R) 꺾임이 기본형
      return '<svg viewBox="0 0 48 48" style="transform:rotate(' + t.rot * 90 + 'deg)" aria-hidden="true">' +
        '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/></svg>';
    }
    function opp(s) { return { U: 'D', D: 'U', L: 'R', R: 'L' }[s]; }
    function checkPath() {
      /* 입구 칸에 'L'로 들어가 연결을 따라간다 — 출구 칸의 'R'로 나가면 완성 */
      tiles.forEach(function (t) { t.btn.classList.remove('hot'); });
      var r = entryRow, c = 0, from = 'L', guard = 0, hot = [];
      while (guard++ < N * N + 2) {
        var t = tiles[r * N + c];
        var cn = conns(t);
        if (cn.indexOf(from) < 0) return false;
        hot.push(t);
        var out = cn[0] === from ? cn[1] : cn[0];
        if (r === exitRow && c === N - 1 && out === 'R') {
          hot.forEach(function (x) { x.btn.classList.add('hot'); });
          return true;
        }
        if (out === 'U') r--; else if (out === 'D') r++;
        else if (out === 'L') c--; else c++;
        if (r < 0 || r >= N || c < 0 || c >= N) return false;
        from = opp(out);
      }
      return false;
    }
    function build() {
      N = cleared >= 3 ? 5 : 4;
      wrap.style.gridTemplateColumns = 'repeat(' + N + ',1fr)';
      entryRow = rnd(N);
      /* 정답 길 깎기 — 열마다 세로로 조금 움직인 뒤 오른쪽으로 한 칸(재방문 없음이 보장된다) */
      var path = [], r = entryRow;
      for (var c = 0; c < N; c++) {
        path.push([r, c, 'v']);
        if (c < N - 1) {
          var target = Math.max(0, Math.min(N - 1, r + (rnd(3) - 1) * (1 + rnd(2))));
          while (r !== target) { r += target > r ? 1 : -1; path.push([r, c, 'v']); }
        }
      }
      exitRow = r;
      /* 길 칸의 필요 타일 계산 — 들어온 변·나가는 변의 짝으로 종류·회전을 정한다 */
      var need = {};                                  // 'r,c' → [side,side]
      var fromSide = 'L';
      for (var i = 0; i < path.length; i++) {
        var pr = path[i][0], pc = path[i][1];
        var out;
        if (i === path.length - 1) out = 'R';
        else {
          var nr = path[i + 1][0], nc = path[i + 1][1];
          out = nr > pr ? 'D' : nr < pr ? 'U' : 'R';
        }
        need[pr + ',' + pc] = [fromSide, out];
        fromSide = opp(out);
      }
      wrap.innerHTML = '';
      tiles = [];
      for (var rr = 0; rr < N; rr++) {
        for (var cc = 0; cc < N; cc++) {
          var pair = need[rr + ',' + cc];
          var t;
          if (pair) {
            var s = pair.slice().sort().join('');
            if (s === 'LR' || s === 'DU') t = { kind: 's', rot: rnd(4) };
            else {
              var rot = 0;
              for (var k = 0; k < 4; k++) {
                var cn = [SIDES[k], SIDES[(k + 1) % 4]].sort().join('');
                if (cn === s) { rot = k; break; }
              }
              t = { kind: 'c', rot: (rot + 1 + rnd(3)) % 4 };   // 정답에서 살짝 돌려 둔다
            }
          } else t = { kind: rnd(3) === 0 ? 's' : 'c', rot: rnd(4) };
          var btn = el('button', 'gm-tile', svgTile(t));
          btn.type = 'button';
          btn.setAttribute('aria-label', (rr + 1) + '행 ' + (cc + 1) + '열 타일 돌리기');
          if (cc === 0 && rr === entryRow) btn.style.borderLeft = '4px solid var(--action)';
          if (cc === N - 1 && rr === exitRow) btn.style.borderRight = '4px solid var(--action)';
          t.btn = btn;
          (function (tt) {
            tt.btn.addEventListener('click', function () {
              if (!isRunning()) return;
              tt.rot = (tt.rot + 1) % 4;
              tt.btn.innerHTML = svgTile(tt);
              if (checkPath()) {
                api.addScore(10);
                cleared++;
                clearedEl.textContent = '완성한 길 ' + cleared + '개';
                api.flash(b, true);
                setTimeout(function () { if (isRunning()) build(); }, 350);
              }
            });
          })(t);
          tiles.push(t);
          wrap.appendChild(btn);
        }
      }
      /* 처음부터 이어져 있으면 정답 타일 하나를 더 돌려 둔다 */
      if (checkPath()) {
        var keys = Object.keys(need);
        var kk = keys[rnd(keys.length)].split(',');
        var tt2 = tiles[Number(kk[0]) * N + Number(kk[1])];
        tt2.rot = (tt2.rot + 1) % 4;
        tt2.btn.innerHTML = svgTile(tt2);
        tiles.forEach(function (t) { t.btn.classList.remove('hot'); });
      }
    }
    build();
  }

  /* ── 6. 고양이 술래잡기 — 벽으로 길을 막아 고양이를 가두기 ── */
  function gameCat(api) {
    var R = 7, C = 7;   // 셀 40px 터치 크기를 지키려 7×7 — 가장자리가 가까운 만큼 초기 벽을 넉넉히 깐다
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q">빈 칸을 눌러 벽을 세우고, <b>고양이가 밖으로 못 나가게</b> 가두세요' +
      '<span class="sub" id="catRound"></span></div>' +
      '<div class="gm-cat" id="catGrid"></div>';
    var wrap = $('catGrid'), roundEl = $('catRound');
    var walls, cat, over, caughtCount = 0;
    function nbs(r, c) {
      var off = r % 2 === 1 ? [0, 1] : [-1, 0];
      return [[r, c - 1], [r, c + 1],
        [r - 1, c + off[0]], [r - 1, c + off[1]],
        [r + 1, c + off[0]], [r + 1, c + off[1]]]
        .filter(function (p) { return p[0] >= 0 && p[0] < R && p[1] >= 0 && p[1] < C; });
    }
    function isEdge(r, c) { return r === 0 || r === R - 1 || c === 0 || c === C - 1; }
    function bfsStep() {
      /* 고양이 → 가장 가까운 가장자리로 가는 한 걸음. 길이 없으면 null */
      var prev = {}, q = [[cat[0], cat[1]]], seen = {};
      seen[cat[0] + ',' + cat[1]] = true;
      while (q.length) {
        var p = q.shift();
        if (isEdge(p[0], p[1]) && (p[0] !== cat[0] || p[1] !== cat[1])) {
          var k = p[0] + ',' + p[1];
          while (prev[k] && prev[prev[k]]) k = prev[k];
          return k.split(',').map(Number);
        }
        /* 이웃 순서를 섞는다 — 안 섞으면 같은 거리일 때 늘 왼쪽으로 도망가 패턴이 읽힌다 */
        shuffle(nbs(p[0], p[1])).forEach(function (n) {
          var k2 = n[0] + ',' + n[1];
          if (seen[k2] || walls[k2]) return;
          seen[k2] = true; prev[k2] = p[0] + ',' + p[1];
          q.push(n);
        });
      }
      return null;
    }
    function draw() {
      wrap.innerHTML = '';
      for (var r = 0; r < R; r++) {
        var row = el('div', 'row' + (r % 2 === 1 ? ' odd' : ''));
        for (var c = 0; c < C; c++) {
          var k = r + ',' + c;
          var cell = el('button', 'gm-hex', '');
          cell.type = 'button';
          if (walls[k]) { cell.classList.add('wall'); cell.setAttribute('aria-label', '벽'); }
          else if (cat[0] === r && cat[1] === c) {
            cell.classList.add('cat'); cell.innerHTML = sym('gi-cat');
            cell.setAttribute('aria-label', '고양이');
          } else {
            cell.setAttribute('aria-label', (r + 1) + '행 ' + (c + 1) + '열에 벽 세우기');
            (function (rr, cc) {
              cell.addEventListener('click', function () { tap(rr, cc); });
            })(r, c);
          }
          row.appendChild(cell);
        }
        wrap.appendChild(row);
      }
    }
    function tap(r, c) {
      if (!isRunning() || over) return;
      walls[r + ',' + c] = true;
      var step = bfsStep();
      if (step) cat = step;
      else {
        /* 나갈 길이 없다 — 빈 이웃이 있으면 버둥거리고, 그마저 없으면 잡혔다 */
        var free = nbs(cat[0], cat[1]).filter(function (n) { return !walls[n[0] + ',' + n[1]]; });
        if (free.length) cat = pick(free);
        else {
          caughtCount++;
          api.setScore(caughtCount);
          api.flash(b, true);
          setTimeout(function () { if (isRunning()) newRound(); }, 400);
          over = true; draw(); return;
        }
      }
      if (isEdge(cat[0], cat[1])) {
        over = true; draw();
        api.flash(b, false);
        setTimeout(function () { if (isRunning()) api.finish(); }, 500);
        return;
      }
      draw();
    }
    function newRound() {
      over = false;
      walls = {};
      cat = [3, 3];
      var wallCount = Math.max(6, 12 - caughtCount * 2);
      var placed = 0, guard = 0;
      while (placed < wallCount && guard++ < 200) {
        var r = rnd(R), c = rnd(C);
        var k = r + ',' + c;
        if (walls[k] || (r === cat[0] && c === cat[1])) continue;
        walls[k] = true; placed++;
      }
      roundEl.textContent = (caughtCount + 1) + '번째 판 · 놓치면 끝납니다';
      draw();
    }
    newRound();
  }

  /* ── 7. 약속 정하기 — 조건을 모두 만족하는 유일한 시간 찾기 ── */
  function gameYaksok(api) {
    var DAYS = ['월', '화', '수', '목', '금'];
    var TIMES = ['오전', '오후'];
    var NAMES = ['지민', '서연', '하준', '유나', '도윤'];
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q">전원이 가능한 <b>단 하나의 시간</b>을 고르세요</div>' +
      '<div class="gm-say" id="ykSay"></div>' +
      '<div class="gm-week" id="ykWeek"></div>';
    var sayEl = $('ykSay'), weekEl = $('ykWeek');
    var answer = [0, 0];
    function next() {
      var extra = score >= 3;                          // 3문제부터 조건 하나 추가
      var ad = rnd(5), at = rnd(2);
      answer = [ad, at];
      var others = shuffle([0, 1, 2, 3, 4].filter(function (d) { return d !== ad; }));
      var dx = others[0], dy = others[1];
      var names = shuffle(NAMES.slice()).slice(0, extra ? 4 : 3);
      /* 구성으로 유일함을 보장한다: (답 요일+dx[+dy])만 가능 ∩ 답 시간대만 ∩ dx 불가 [∩ dy 불가] */
      var lines = [
        [names[0], '저는 <b>' + shuffle([DAYS[ad], DAYS[dx]].concat(extra ? [DAYS[dy]] : [])).join('·') + '요일</b>만 돼요'],
        [names[1], '저는 <b>' + TIMES[at] + '</b>만 가능해요'],
        [names[2], '<b>' + DAYS[dx] + '요일</b>은 안 돼요']
      ];
      if (extra) lines.push([names[3], '<b>' + DAYS[dy] + '요일</b>은 안 돼요']);
      sayEl.innerHTML = shuffle(lines).map(function (l) {
        return '<p><b>' + l[0] + '</b> · ' + l[1] + '</p>';
      }).join('');
      weekEl.innerHTML = '<span class="hd"></span>' +
        DAYS.map(function (d) { return '<span class="hd">' + d + '</span>'; }).join('');
      TIMES.forEach(function (t, ti) {
        weekEl.appendChild(el('span', 'hd', t));
        DAYS.forEach(function (d, di) {
          var s = el('button', 'gm-slot', '선택');
          s.type = 'button';
          s.setAttribute('aria-label', d + '요일 ' + t);
          s.addEventListener('click', function () {
            if (!isRunning()) return;
            if (di === answer[0] && ti === answer[1]) { api.addScore(1); api.flash(b, true); next(); }
            else { api.flash(b, false); shake(s); }
          });
          weekEl.appendChild(s);
        });
      });
    }
    next();
  }

  /* ── 8. 마법약 만들기 — 주문서 재료를 정확히 담아 제조 ── */
  function gamePotion(api) {
    var ING = ['gs-circle', 'gs-square', 'gs-tri', 'gs-diamond', 'gs-star', 'gs-hex'];
    var ING_NAMES = { 'gs-circle': '원', 'gs-square': '네모', 'gs-tri': '세모', 'gs-diamond': '마름모', 'gs-star': '별', 'gs-hex': '육각' };
    var POTS = ['용기의 물약', '차분함의 물약', '집중의 물약', '미소의 물약', '순발력의 물약'];
    var b = api.board;
    b.innerHTML =
      '<div class="gm-order"><span class="pot" id="ptName"></span>' +
      '<div class="need" id="ptNeed"></div></div>' +
      '<div class="gm-cauldron" id="ptPot" aria-label="솥"></div>' +
      '<div class="gm-ing" id="ptIng"></div>' +
      '<div class="gm-potbtns">' +
        '<button type="button" class="gm-empty" id="ptClear">솥 비우기</button>' +
        '<button type="button" class="gm-brew" id="ptBrew">제조하기</button>' +
      '</div>';
    var nameEl = $('ptName'), needEl = $('ptNeed'), potEl = $('ptPot'), ingEl = $('ptIng');
    var need = [], have = [], hideId = 0;
    function drawPot() { potEl.innerHTML = have.map(sym).join(''); }
    ING.forEach(function (g) {
      var btn = el('button', '', sym(g));
      btn.type = 'button';
      btn.setAttribute('aria-label', ING_NAMES[g] + ' 재료 담기');
      btn.addEventListener('click', function () {
        if (!isRunning() || have.length >= 8) return;
        have.push(g);
        drawPot();
      });
      ingEl.appendChild(btn);
    });
    function multisetEq(a, c) {
      if (a.length !== c.length) return false;
      var m = {};
      a.forEach(function (x) { m[x] = (m[x] || 0) + 1; });
      for (var i = 0; i < c.length; i++) { if (!m[c[i]]) return false; m[c[i]]--; }
      return true;
    }
    function next() {
      clearTimeout(hideId);
      have = []; drawPot();
      var k = Math.min(3 + Math.floor(score / 3), 6);
      need = [];
      for (var i = 0; i < k; i++) need.push(pick(ING));
      need.sort();
      nameEl.textContent = pick(POTS) + ' 주문서';
      needEl.innerHTML = need.map(sym).join('');
      /* 5점부터는 주문서가 잠깐만 보인다 — 외워서 담는 단계 */
      if (score >= 5) {
        hideId = setTimeout(function () {
          needEl.textContent = '? 외운 대로 담으세요';
        }, 2600);
      }
    }
    api.onCleanup(function () { clearTimeout(hideId); });
    $('ptClear').addEventListener('click', function () { have = []; drawPot(); });
    $('ptBrew').addEventListener('click', function () {
      if (!isRunning()) return;
      if (multisetEq(have, need)) { api.addScore(1); api.flash(b, true); next(); }
      else { api.flash(b, false); shake(potEl); have = []; drawPot(); }
    });
    next();
  }

  /* ── 9. 도형 순서 기억 — 불 들어온 순서를 그대로 따라 누르기 ── */
  function gameSequence(api) {
    var GLYPHS = ['gs-circle', 'gs-ring', 'gs-square', 'gs-tri', 'gs-diamond', 'gs-star', 'gs-plus', 'gs-hex', 'gs-half'];
    var GNAMES = ['원', '고리', '네모', '세모', '마름모', '별', '십자', '육각', '반달'];
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q">불이 들어온 <b>순서 그대로</b> 누르세요<span class="sub" id="sqInfo"></span></div>' +
      '<div class="gm-cells" id="sqGrid" style="grid-template-columns:repeat(3,1fr);max-width:280px"></div>';
    var wrap = $('sqGrid'), infoEl = $('sqInfo');
    var cells = [], seq = [], input = 0, len = 3, lives = 3, playing = false;
    var timeouts = [];
    api.onCleanup(function () { timeouts.forEach(clearTimeout); });
    GLYPHS.forEach(function (g, i) {
      var c = el('button', 'gm-cell', sym(g));
      c.type = 'button';
      c.setAttribute('aria-label', GNAMES[i]);
      c.addEventListener('click', function () {
        if (!isRunning() || playing) return;
        if (i === seq[input]) {
          c.classList.add('lit');
          timeouts.push(setTimeout(function () { c.classList.remove('lit'); }, 180));
          input++;
          if (input >= seq.length) {
            api.setScore(len);                        // 점수 = 성공한 최고 단계
            len++;
            playing = true;                           // 다음 판 준비 중 잘못 눌러 기회를 잃지 않게
            timeouts.push(setTimeout(function () { if (isRunning()) round(); }, 500));
          }
        } else {
          lives--;
          api.flash(b, false);
          if (lives <= 0) { api.finish(); return; }
          info();
          playing = true;
          timeouts.push(setTimeout(function () { if (isRunning()) round(); }, 600));
        }
      });
      cells.push(c);
      wrap.appendChild(c);
    });
    function info() {
      infoEl.textContent = '이번 단계: ' + len + '개 · 남은 기회 ' + lives;
    }
    function round() {
      info();
      seq = [];
      for (var i = 0; i < len; i++) seq.push(rnd(9));
      input = 0;
      playing = true;
      seq.forEach(function (s, i) {
        timeouts.push(setTimeout(function () { cells[s].classList.add('lit'); }, 600 + i * 620));
        timeouts.push(setTimeout(function () { cells[s].classList.remove('lit'); }, 600 + i * 620 + 450));
      });
      timeouts.push(setTimeout(function () { playing = false; }, 600 + seq.length * 620));
    }
    round();
  }

  function isRunning() { return running; }

  /* ── 게임 정의 목록 — 허브 카드 순서 그대로 ── */
  var GAMES = [
    { id: 'rps', name: '가위바위보', icon: 'gi-rps', unit: '점', time: 60,
      meas: '순발력 · 판단 전환',
      rules: ['상대 손과 지시(이기세요·지세요·비기세요)가 나옵니다.',
        '지시에 맞는 손을 최대한 빨리 고르세요.', '60초 동안 맞힌 개수가 점수입니다.'],
      tips: ['"지세요"가 나오면 한 박자 멈추고 뒤집어 생각하세요 — 습관대로 이기는 손이 먼저 나갑니다.',
        '정확도가 속도보다 먼저입니다. 틀린 답을 빨리 내는 것이 제일 손해입니다.'],
      start: gameRPS },
    { id: 'path', name: '길 만들기', icon: 'gi-path', unit: '점', time: 90,
      meas: '계획 · 공간 지각',
      rules: ['타일을 누르면 90도씩 돌아갑니다.', '왼쪽 입구(파란 표시)에서 오른쪽 출구까지 길을 이으세요.',
        '길 하나를 완성할 때마다 +10점, 90초 안에 여러 판을 깹니다.'],
      tips: ['입구부터 순서대로 잇지 말고, 먼저 전체 경로를 눈으로 그린 뒤 손을 대세요.',
        '꺾임 타일은 네 방향 중 하나뿐입니다 — 최대 세 번이면 원하는 방향이 나옵니다.'],
      start: gamePath },
    { id: 'sequence', name: '도형 순서 기억', icon: 'gi-seq', unit: '단계', time: 0,
      meas: '작업 기억',
      rules: ['칸에 불이 순서대로 들어옵니다.', '다 본 뒤 같은 순서로 누르세요.',
        '성공하면 한 개씩 길어지고, 기회 3번을 다 쓰면 끝납니다.'],
      tips: ['위치를 말로 바꿔 외우세요("가운데-왼쪽 위-별") — 눈으로만 좇는 것보다 오래 남습니다.',
        '틀렸을 때 같은 길이로 다시 옵니다. 침착하게 다시 외우면 됩니다.'],
      start: gameSequence },
    { id: 'rotate', name: '도형 회전', icon: 'gi-rotate', unit: '점', time: 60,
      meas: '공간 회전',
      rules: ['기준 도형을 돌려서 같아지는 보기를 고르세요.',
        '뒤집힌(거울상) 도형이 함정으로 섞여 있습니다.', '60초 동안 맞힌 개수가 점수입니다.'],
      tips: ['도형의 튀어나온 귀퉁이 하나를 정해 그것만 따라 돌리세요 — 전체를 돌리는 것보다 빠릅니다.',
        '거울상은 아무리 돌려도 겹치지 않습니다. 헷갈리면 귀퉁이의 좌우 방향을 보세요.'],
      start: gameRotate },
    { id: 'potion', name: '마법약 만들기', icon: 'gi-potion', unit: '점', time: 60,
      meas: '작업 기억 · 정확성',
      rules: ['주문서에 적힌 재료를 그대로 솥에 담고 제조를 누르세요.',
        '개수까지 정확해야 합니다. 틀리면 솥이 비워집니다.',
        '5점부터는 주문서가 잠깐만 보입니다 — 외워서 담으세요.'],
      tips: ['재료를 종류별로 묶어 세면(풀 2, 물 1) 외우기 쉽습니다.',
        '틀리는 것이 제일 느립니다. 담기 전에 주문서를 한 번 더 확인하세요.'],
      start: gamePotion },
    { id: 'cat', name: '고양이 술래잡기', icon: 'gi-cat', unit: '판', time: 0,
      meas: '전략 · 수읽기', scoreLabel: '잡은 판',
      rules: ['빈 칸을 누르면 벽이 생기고, 고양이는 한 칸씩 밖으로 도망갑니다.',
        '가장자리에 닿기 전에 사방을 막아 가두세요.',
        '가두면 다음 판(벽이 더 적게)으로, 놓치면 끝납니다.'],
      tips: ['고양이 옆에 붙여 쌓지 말고, 두세 칸 앞 길목을 먼저 끊으세요.',
        '고양이가 가려는 방향(가장 가까운 가장자리)부터 막는 것이 기본입니다.'],
      start: gameCat },
    { id: 'yaksok', name: '약속 정하기', icon: 'gi-yaksok', unit: '점', time: 90,
      meas: '조건 추론',
      rules: ['친구들의 가능한 시간 조건이 나옵니다.',
        '전원이 가능한 단 하나의 시간을 표에서 고르세요.', '90초 동안 맞힌 문제 수가 점수입니다.'],
      tips: ['"~만 돼요"부터 읽으세요 — 후보가 가장 크게 줄어듭니다.',
        '남은 후보에 "안 돼요" 조건을 하나씩 지워 나가면 답이 남습니다.'],
      start: gameYaksok },
    { id: 'numbers', name: '숫자 누르기', icon: 'gi-numbers', unit: '점', time: 60,
      meas: '주의력 · 탐색 속도',
      rules: ['흩어진 숫자를 1부터 차례대로 누르세요.',
        '한 판을 다 누르면 다음 판은 숫자가 늘어납니다.', '60초 동안 모은 점수로 겨룹니다.'],
      tips: ['다음 숫자를 누르는 동안 눈은 그다음 숫자를 찾고 있어야 합니다.',
        '화면을 왼쪽 위→오른쪽 아래로 훑는 자기만의 순서를 정해 두면 빨라집니다.'],
      start: gameNumbers },
    { id: 'compare', name: '개수 비교', icon: 'gi-compare', unit: '점', time: 60,
      meas: '수 감각 · 순간 판단',
      rules: ['두 판 중 점이 더 많은 쪽을 고르세요.',
        '점 크기가 제각각이라 넓이로는 못 셉니다.', '맞힐수록 개수 차이가 줄어듭니다.'],
      tips: ['하나씩 세지 말고 서너 개 묶음으로 어림하세요 — 셀 시간은 없습니다.',
        '차이가 1개까지 줄면 빈 곳의 크기를 비교하는 것도 방법입니다.'],
      start: gameCompare }
  ];

  /* ── 시작 — 주소 해시(#rps)로 바로 열 수 있게 ── */
  renderHub();
  var h = (location.hash || '').replace('#', '');
  if (h) {
    for (var i = 0; i < GAMES.length; i++) {
      /* 히스토리에 상태를 남기지 않는다 — 딥링크로 바로 연 경우 '← 목록'은 화면 안에서만
         허브로 돌아가야 한다(상태를 넣으면 goHub 의 history.back() 이 페이지 밖으로 나간다). */
      if (GAMES[i].id === h) { openGame(h, true); break; }
    }
  }
})();
