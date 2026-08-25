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

  /* 문항 제한시간 막대(3초 등) — 전역 타이머와 별개. stop() 을 부르면 멈춘다 */
  function ticker(bar, ms, onEnd) {
    var t0 = Date.now();
    bar.style.width = '100%';
    var id = setInterval(function () {
      var left = 1 - (Date.now() - t0) / ms;
      if (left <= 0) { clearInterval(id); bar.style.width = '0%'; if (onEnd) onEnd(); return; }
      bar.style.width = (left * 100) + '%';
    }, 80);
    return { stop: function () { clearInterval(id); } };
  }

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
  var curMode = 'practice';   // 연습/실전 — '다시 하기'는 마지막 모드를 그대로 쓴다
  function startPlay(mode) {
    if (mode) curMode = mode;
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
    cur.start(api, curMode);
  }

  function openGame(id, viaHistory) {
    var g = null;
    for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) g = GAMES[i];
    if (!g) return;
    cur = g;
    curMode = 'practice';           // 다른 게임의 '실전'이 넘어오지 않게 초기화
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
      /* 모드가 있으면 버튼 두세 개(첫 번째가 기본) — 슬라이더·옵션 나열은 두지 않는다(오너 "더 쉽게") */
      (g.modes
        ? g.modes.map(function (m, i) {
            return '<button type="button" class="gm-start' + (i ? ' alt' : '') + '" data-mode="' + m.key + '">' +
              m.label + '<small>' + m.sub + '</small></button>';
          }).join('')
        : '<button type="button" class="gm-start" data-mode="practice">시작하기</button>');
    [].slice.call(introEl.querySelectorAll('.gm-start')).forEach(function (btn) {
      btn.addEventListener('click', function () { startPlay(btn.getAttribute('data-mode')); });
    });
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

  /* ── 0. 도형 2-back — n번째 전 도형과 같은지 판단(작업 기억 갱신) ──
     실전 구성(오너 제공 캡처 기준): 2-back 23문항 → 2·3-back 24문항, 도형당 3초 고정.
     연습은 15문항·4초에 맞히면 바로 다음. 실전 키보드(←/→/Space)는 모바일이라 버튼으로 옮겼다. */
  function gameNback(api, mode) {
    var SETS = [
      ['gs-circle', 'gs-tri', 'gs-square'],
      ['gs-ring', 'gs-half', 'gs-hex'],
      ['gs-diamond', 'gs-star', 'gs-plus']
    ];
    var plan = mode === 'real'
      ? [{ dual: false, count: 23, sec: 3, fast: false }, { dual: true, count: 24, sec: 3, fast: false }]
      : mode === 'dual'
        ? [{ dual: true, count: 15, sec: 4, fast: true }]
        : [{ dual: false, count: 15, sec: 4, fast: true }];
    var set = pick(SETS);
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q"><span id="nbPhase"></span><span class="sub" id="nbInfo"></span></div>' +
      '<div class="gm-nb-stage" id="nbStage"></div>' +
      '<div class="gm-qtimer"><i id="nbTick"></i></div>' +
      '<div class="gm-nb-btns" id="nbBtns"></div>';
    var stageEl = $('nbStage'), tickBar = $('nbTick'), btnsEl = $('nbBtns');
    var phaseEl = $('nbPhase'), infoEl = $('nbInfo');
    var tk = null, tids = [];
    api.onCleanup(function () { if (tk) tk.stop(); tids.forEach(clearTimeout); });
    function later(fn, ms) { tids.push(setTimeout(fn, ms)); }

    var pi = 0, seq = [], idx = 0, lead = 2, answered = false;

    function buildButtons(dual) {
      btnsEl.innerHTML = '';
      var defs = dual
        ? [['b2', '2번째 전과<br>같다'], ['b3', '3번째 전과<br>같다'], ['none', '둘 다<br>아니다']]
        : [['b2', '2번째 전과 같다'], ['none', '다르다']];
      defs.forEach(function (d) {
        var btn = el('button', '', d[1]);
        btn.type = 'button';
        btn.disabled = true;
        btn.addEventListener('click', function () { answer(d[0]); });
        btnsEl.appendChild(btn);
      });
    }
    function genSeq(pl) {
      lead = pl.dual ? 3 : 2;
      var arr = [];
      for (var i = 0; i < pl.count + lead; i++) {
        var v = null, r = Math.random();
        if (i >= lead) {
          if (r < 0.32) v = arr[i - 2];
          else if (pl.dual && r < 0.58) v = arr[i - 3];
        }
        if (!v) v = pick(set);
        if (pl.dual && i >= 3) {
          var g = 0;   /* 2전·3전 동시 일치는 정답이 둘이 돼 버려 피한다 */
          while (v === arr[i - 2] && v === arr[i - 3] && g++ < 12) v = pick(set);
        }
        arr.push(v);
      }
      return arr;
    }
    function truthOf(i) {
      if (seq[i] === seq[i - 2]) return 'b2';
      if (plan[pi].dual && seq[i] === seq[i - 3]) return 'b3';
      return 'none';
    }
    function setBtns(on) {
      [].slice.call(btnsEl.children).forEach(function (x) { x.disabled = !on; });
    }
    function answer(key) {
      if (!isRunning() || answered || idx < lead) return;
      answered = true;
      setBtns(false);
      var ok = key === truthOf(idx);
      if (ok) api.addScore(1);
      api.flash(b, ok);
      if (plan[pi].fast) { if (tk) tk.stop(); later(next, 260); }
    }
    function next() { idx++; show(); }
    function show() {
      if (!isRunning()) return;
      var pl = plan[pi];
      if (idx >= seq.length) {                          /* 단계 끝 */
        pi++;
        if (pi >= plan.length) { api.finish(); return; }
        stageEl.textContent = '이어서 2·3-back — ' + plan[pi].count + '문항';
        buildButtons(plan[pi].dual);
        seq = genSeq(plan[pi]);
        idx = 0;
        later(show, 1700);
        return;
      }
      answered = false;
      var judge = idx >= lead;
      phaseEl.textContent = pl.dual ? '2·3-back' : '2-back';
      infoEl.textContent = judge
        ? '문항 ' + (idx - lead + 1) + '/' + pl.count
        : '기억만 하세요 (' + (idx + 1) + '/' + lead + ') — 아직 답하지 않아요';
      stageEl.innerHTML = sym(seq[idx]);
      setBtns(judge);
      if (tk) tk.stop();
      tk = ticker(tickBar, pl.sec * 1000, function () {
        if (judge && !answered) api.flash(b, false);    /* 미응답 = 오답 */
        next();
      });
    }
    buildButtons(plan[0].dual);
    seq = genSeq(plan[0]);
    idx = 0;
    show();
  }

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

  /* ── 2. 숫자 누르기 — 1라운드 신호 반응 + 2라운드 순서·특수 규칙(인지 제어) ──
     실전 구성(캡처 기준): R1 60초 고정 배열에서 활성화된 숫자 클릭 / R2 120초 매 문항 섞인
     배열에서 1→9 순서, 지정 숫자는 연속 2번·지정 숫자는 건너뛰기, 신호 전 클릭은 오답. */
  function gameNumbers(api, mode) {
    var r1sec = mode === 'real' ? 60 : 30;
    var r2sec = mode === 'real' ? 120 : 60;
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q"><span id="numPhase"></span><span class="sub" id="numInfo"></span></div>' +
      '<div class="gm-qtimer"><i id="numTick"></i></div>' +
      '<div class="gm-cells" id="numGrid" style="grid-template-columns:repeat(3,1fr);max-width:300px"></div>';
    var phaseEl = $('numPhase'), infoEl = $('numInfo'), tickBar = $('numTick'), wrap = $('numGrid');
    var tk = null, tids = [];
    api.onCleanup(function () { if (tk) tk.stop(); tids.forEach(clearTimeout); });
    function later(fn, ms) { tids.push(setTimeout(fn, ms)); }
    var cells = [], nums = [];
    function buildGrid(order) {
      wrap.innerHTML = ''; cells = []; nums = order;
      order.forEach(function (n) {
        var c = el('button', 'gm-cell', String(n));
        c.type = 'button';
        c.addEventListener('click', function () { onTap(n, c); });
        cells.push(c); wrap.appendChild(c);
      });
    }
    var phase = 0, target = 0, ready = false, switching = false;
    var exp = [], ep = 0, twice = 0, skip = 0;
    function cellOf(n) { return cells[nums.indexOf(n)]; }
    function onTap(n, c) {
      if (!isRunning()) return;
      if (phase === 1) {
        if (!ready) return;
        if (n === target) {
          api.addScore(1);
          c.classList.remove('lit');
          nextTarget();
        } else shake(c);
      } else if (phase === 2) {
        if (switching) return;
        if (!ready) { failQ('신호 전에 눌렀어요'); return; }
        if (n === exp[ep]) {
          ep++;
          c.classList.add('done');
          if (exp[ep] === n) c.classList.remove('done');   /* 2번 숫자 첫 클릭 — 한 번 더 눌러야 한다 */
          if (ep >= exp.length) {
            switching = true;
            api.addScore(1);
            api.flash(b, true);
            later(newR2Q, 280);
          }
        } else failQ('규칙과 다르게 눌렀어요');
      }
    }
    function nextTarget() {
      var t;
      do { t = 1 + rnd(9); } while (t === target);
      target = t;
      cells.forEach(function (c) { c.classList.remove('lit'); });
      cellOf(target).classList.add('lit');
    }
    function failQ(why) {
      if (switching) return;
      switching = true;
      ready = false;
      api.flash(b, false);
      infoEl.textContent = why + ' — 다음 문항으로';
      later(newR2Q, 600);
    }
    function newR2Q() {
      switching = false;
      ready = false;
      buildGrid(shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]));
      twice = 1 + rnd(9);
      do { skip = 1 + rnd(9); } while (skip === twice);
      exp = []; ep = 0;
      for (var n = 1; n <= 9; n++) {
        if (n === skip) continue;
        exp.push(n);
        if (n === twice) exp.push(n);
      }
      infoEl.innerHTML = '<b>' + twice + '</b>는 연속 2번 · <b>' + skip + '</b>은 건너뛰기';
      wrap.style.opacity = '.45';
      later(function () { wrap.style.opacity = ''; ready = true; }, 800);   /* 준비 — 그 전에 누르면 오답 */
    }
    function startR1() {
      phase = 1;
      phaseEl.textContent = '1라운드 — 신호 반응';
      infoEl.textContent = '불 들어온 숫자를 최대한 빨리 누르세요';
      buildGrid(shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]));
      ready = true;
      nextTarget();
      tk = ticker(tickBar, r1sec * 1000, startBreak);
    }
    function startBreak() {
      phase = 0; ready = false;
      wrap.innerHTML = '';
      phaseEl.textContent = '2라운드 — 순서대로 누르기';
      infoEl.textContent = '매 판 규칙(2번/건너뛰기)을 먼저 확인하세요';
      later(startR2, 1600);
    }
    function startR2() {
      phase = 2;
      newR2Q();
      tk = ticker(tickBar, r2sec * 1000, function () { api.finish(); });
    }
    startR1();
  }

  /* ── 3. 개수 비교 — 좌우 단어 무리가 1초만 보였다 사라진다(캡처 기준: 답 3초·16~45개·차이 3~4) ── */
  function gameCompare(api, mode) {
    var WORDS = ['하늘', '구름', '미소', '안전', '기내', '여권', '규정', '승객', '표정', '메모'];
    var total = mode === 'real' ? 46 : 20;
    var reveal = mode !== 'real';
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q">단어가 <b>더 많았던 쪽</b>을 고르세요<span class="sub" id="cmpInfo"></span></div>' +
      '<div class="gm-bigrow" style="align-items:stretch">' +
        '<button type="button" class="gm-wpanel" id="cmpL" aria-label="왼쪽 판"><i class="tag">왼쪽</i></button>' +
        '<button type="button" class="gm-wpanel" id="cmpR" aria-label="오른쪽 판"><i class="tag">오른쪽</i></button>' +
      '</div>' +
      '<div class="gm-qtimer"><i id="cmpTick"></i></div>' +
      '<div class="gm-reveal" id="cmpReveal"></div>';
    var L = $('cmpL'), R = $('cmpR'), infoEl = $('cmpInfo'), tickBar = $('cmpTick'), revealEl = $('cmpReveal');
    var q = 0, nl = 0, nr = 0, done = false, tk = null, tids = [];
    api.onCleanup(function () { if (tk) tk.stop(); tids.forEach(clearTimeout); });
    function later(fn, ms) { tids.push(setTimeout(fn, ms)); }
    function fill(panel, word, n) {
      [].slice.call(panel.querySelectorAll('span')).forEach(function (x) { x.remove(); });
      var spots = shuffle(Array.apply(null, Array(48)).map(function (_, i) { return i; })).slice(0, n);
      spots.forEach(function (sp) {
        var w = document.createElement('span');
        w.textContent = word;
        w.style.fontSize = (12 + rnd(9)) + 'px';                  /* 크기 제각각 — 면적으로 못 세게 */
        w.style.left = ((sp % 6) * 15 + 1 + rnd(5)) + '%';
        w.style.top = (Math.floor(sp / 6) * 12 + 1 + rnd(4)) + '%';
        panel.appendChild(w);
      });
    }
    function clearPanels() {
      [L, R].forEach(function (pnl) {
        [].slice.call(pnl.querySelectorAll('span')).forEach(function (x) { x.remove(); });
      });
    }
    function finishQ(ok, timeout) {
      done = true;
      if (tk) { tk.stop(); tickBar.style.width = '0%'; }
      if (ok) api.addScore(1);
      api.flash(b, ok);
      if (reveal) revealEl.textContent = '왼쪽 ' + nl + '개 · 오른쪽 ' + nr + '개' + (timeout ? ' — 시간 초과' : '');
      clearPanels();
      later(next, reveal ? 1000 : 350);
    }
    function next() {
      if (q >= total) { api.finish(); return; }
      q++; done = false;
      var myq = q;
      revealEl.textContent = '';
      infoEl.textContent = '문항 ' + q + '/' + total;
      var base = 16 + rnd(26);                                    /* 16~41 */
      var diff = (reveal && q <= 5) ? 5 : 3 + rnd(2);             /* 연습 초반만 완만, 이후 3~4 */
      nl = base; nr = base + diff;
      if (rnd(2) === 0) { var t = nl; nl = nr; nr = t; }
      var wl = pick(WORDS), wr;
      do { wr = pick(WORDS); } while (wr === wl);
      fill(L, wl, nl);
      fill(R, wr, nr);
      later(function () {                                         /* 1초만 보여주고 가린다 */
        if (done || myq !== q || !isRunning()) return;
        clearPanels();
        tk = ticker(tickBar, 3000, function () {
          if (!done && myq === q) finishQ(false, true);
        });
      }, 1000);
    }
    function answer(left) {
      if (!isRunning() || done) return;
      finishQ(left === (nl > nr), false);
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

  /* ── 6. 고양이 술래잡기 — 생쥐 위치를 외웠다가, 고양이가 나온 칸에 생쥐가 있었는지 판단 ──
     실전 구성(캡처 기준): 생쥐 약 1초 노출 → 고양이 등장 → 빨간 칸부터 판단, 확신 4단계,
     고양이 한 마리당 3초, 생쥐 4→최대 18마리, 한 문항 = 빨강·파랑 2번 판단. 확신도는 채점에
     안 넣고 안내만 한다(실제 검사가 확신을 본다는 사실을 팁으로 전한다). */
  function gameCat(api, mode) {
    var total = mode === 'real' ? 20 : 10;
    var reveal = mode !== 'real';
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q"><span id="catQ"></span><span class="sub" id="catInfo"></span></div>' +
      '<div class="gm-mgrid" id="catGrid"></div>' +
      '<div class="gm-qtimer"><i id="catTick"></i></div>' +
      '<div class="gm-judge" id="catBtns"></div>';
    var qEl = $('catQ'), infoEl = $('catInfo'), wrap = $('catGrid'), tickBar = $('catTick'), btnsEl = $('catBtns');
    var tk = null, tids = [];
    api.onCleanup(function () { if (tk) tk.stop(); tids.forEach(clearTimeout); });
    function later(fn, ms) { tids.push(setTimeout(fn, ms)); }
    var cells = [];
    function buildGrid() {
      wrap.innerHTML = ''; cells = [];
      for (var i = 0; i < 25; i++) {
        var c = el('div', 'gm-mcell', '');
        cells.push(c); wrap.appendChild(c);
      }
    }
    var onAns = null;
    [['y2', '있었다 · 확실'], ['y1', '있었다 · 아마'], ['n1', '없었다 · 아마'], ['n2', '없었다 · 확실']]
      .forEach(function (d) {
        var btn = el('button', '', d[1]);
        btn.type = 'button';
        btn.disabled = true;
        btn.addEventListener('click', function () { if (onAns) onAns(d[0].charAt(0) === 'y'); });
        btnsEl.appendChild(btn);
      });
    function setBtns(on) { [].slice.call(btnsEl.children).forEach(function (x) { x.disabled = !on; }); }
    var q = 0, mice = [];
    function nq() {
      if (!isRunning()) return;
      if (q >= total) { api.finish(); return; }
      q++;
      var n = Math.min(4 + Math.floor((q - 1) / 2) * 2, 18);
      qEl.textContent = '생쥐 위치를 기억하세요';
      infoEl.textContent = '문항 ' + q + '/' + total + ' · 생쥐 ' + n + '마리';
      buildGrid();
      setBtns(false);
      tickBar.style.width = '0%';
      mice = shuffle(Array.apply(null, Array(25)).map(function (_, i) { return i; })).slice(0, n);
      mice.forEach(function (i) { cells[i].innerHTML = sym('gi-mouse'); });
      later(function () {
        if (!isRunning()) return;
        cells.forEach(function (c) { c.innerHTML = ''; });
        probe(0);
      }, 1100);
    }
    function probe(k) {                                 /* k=0 첫 번째(빨강) · k=1 두 번째(파랑) */
      var cellIdx, has;
      if (rnd(2) === 0) { cellIdx = pick(mice); has = true; }     /* 반반 나오게 */
      else {
        var g = 0;
        do { cellIdx = rnd(25); } while (mice.indexOf(cellIdx) >= 0 && g++ < 40);
        has = mice.indexOf(cellIdx) >= 0;
      }
      var cls = k === 0 ? 'probe-r' : 'probe-b';
      cells[cellIdx].classList.add(cls);
      cells[cellIdx].innerHTML = sym('gi-cat');
      qEl.innerHTML = (k === 0 ? '<b class="c-red">첫 번째 칸</b>' : '<b class="c-blue">두 번째 칸</b>') +
        ' — 여기에 생쥐가 있었나요?';
      setBtns(true);
      var settled = false;
      tk = ticker(tickBar, 3000, function () { if (!settled) settle(null); });
      onAns = function (saidYes) { if (!settled) settle(saidYes); };
      function settle(saidYes) {
        settled = true;
        if (tk) tk.stop();
        setBtns(false);
        onAns = null;
        var ok = saidYes !== null && saidYes === has;
        if (ok) api.addScore(1);
        api.flash(b, ok);
        cells[cellIdx].classList.remove(cls);
        cells[cellIdx].innerHTML = '';
        if (k === 0) later(function () { probe(1); }, 300);
        else if (reveal) {
          mice.forEach(function (i) { cells[i].innerHTML = sym('gi-mouse'); });
          infoEl.textContent = '생쥐가 있던 자리예요';
          later(nq, 1000);
        } else later(nq, 300);
      }
    }
    nq();
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

  /* ── 8. 마법약 만들기 — 켜진 약초 조합을 보고 결과(파란약/빨간약)를 예측하는 규칙 학습 ──
     실전 구성(캡처 기준): 카드 일부만 켜짐·전체 조합이 결과를 결정, 답 3초, 매 문항 결과 공개
     (공개가 과제의 일부), 같은 조합의 결과가 도중에 몰래 바뀐다, 실전 100문항. */
  function gamePotion(api, mode) {
    var HERBS = ['gs-circle', 'gs-tri', 'gs-square', 'gs-star'];
    var total = mode === 'real' ? 100 : 30;
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q">이 조합이면 <b>무슨 약</b>이 나올까요?<span class="sub" id="ptInfo"></span></div>' +
      '<div class="gm-herbs" id="ptHerbs"></div>' +
      '<div class="gm-qtimer"><i id="ptTick"></i></div>' +
      '<div class="gm-reveal" id="ptReveal"></div>' +
      '<div class="gm-pots">' +
        '<button type="button" class="blue" id="ptBlue">파란약</button>' +
        '<button type="button" class="red" id="ptRed">빨간약</button>' +
      '</div>';
    var infoEl = $('ptInfo'), herbsEl = $('ptHerbs'), tickBar = $('ptTick'), revealEl = $('ptReveal');
    var tk = null, tids = [];
    api.onCleanup(function () { if (tk) tk.stop(); tids.forEach(clearTimeout); });
    function later(fn, ms) { tids.push(setTimeout(fn, ms)); }
    /* 조합 풀 — 1~3개가 켜진 서로 다른 조합 6가지. 결과는 조합마다 고정이지만
       중간중간 일부 조합이 조용히 뒤집힌다(규칙 전환 — 알아채고 갈아타는 것까지가 과제). */
    var pool = (function () {
      var masks = [];
      for (var m = 1; m < 16; m++) {
        var bits = m.toString(2).replace(/0/g, '').length;
        if (bits >= 1 && bits <= 3) masks.push(m);
      }
      return shuffle(masks).slice(0, 6).map(function (m) { return { mask: m, blue: rnd(2) === 0 }; });
    })();
    var q = 0, curCombo = null, done = false;
    var nextSwitch = 10 + rnd(8);
    function drawCombo(mask) {
      herbsEl.innerHTML = '';
      HERBS.forEach(function (h, i) {
        herbsEl.appendChild(el('span', 'gm-herb' + (mask & (1 << i) ? ' lit' : ''), sym(h)));
      });
    }
    function settle(saidBlue) {
      if (done || !isRunning()) return;
      done = true;
      if (tk) { tk.stop(); tickBar.style.width = '0%'; }
      var isBlue = curCombo.blue;
      var ok = saidBlue !== null && saidBlue === isBlue;
      if (ok) api.addScore(1);
      api.flash(b, ok);
      revealEl.innerHTML = '제조 결과: <b class="' + (isBlue ? 'c-blue' : 'c-red') + '">' +
        (isBlue ? '파란약' : '빨간약') + '</b>' +
        (saidBlue === null ? ' — 시간 초과' : ok ? ' — 맞았어요' : ' — 틀렸어요');
      later(nq, 950);
    }
    $('ptBlue').addEventListener('click', function () { settle(true); });
    $('ptRed').addEventListener('click', function () { settle(false); });
    function nq() {
      if (!isRunning()) return;
      if (q >= total) { api.finish(); return; }
      q++;
      if (q >= nextSwitch) {                            /* 규칙 전환 — 안내 없이 조용히 */
        shuffle(pool.slice()).slice(0, 1 + rnd(2)).forEach(function (c) { c.blue = !c.blue; });
        nextSwitch = q + 10 + rnd(8);
      }
      done = false;
      revealEl.textContent = '';
      infoEl.textContent = '문항 ' + q + '/' + total;
      curCombo = pick(pool);
      drawCombo(curCombo.mask);
      tk = ticker(tickBar, 3000, function () { settle(null); });
    }
    nq();
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
    { id: 'nback', name: '도형 2-back', icon: 'gi-nback', unit: '점', time: 0,
      meas: '작업 기억 갱신',
      modes: [
        { key: 'b2', label: '2-back 연습', sub: '15문항 · 도형당 4초 · 맞히면 바로 다음' },
        { key: 'dual', label: '2·3-back 연습', sub: '15문항 · 판정이 하나 늘어요' },
        { key: 'real', label: '실전 흐름', sub: '2-back 23문항 → 2·3-back 24문항 · 도형당 3초' }
      ],
      rules: ['도형이 하나씩 나옵니다. 3번째 도형부터, <b>2번째 전 도형과 같은지</b> 답하세요.',
        '2·3-back 은 4번째부터 <b>2번째 전 / 3번째 전 / 둘 다 아님</b> 셋 중 하나로 답합니다.',
        '제한시간 안에 답하지 않으면 오답입니다.'],
      tips: ['눈이 아니라 입으로 외우세요 — "원-세모-원"처럼 최근 도형을 소리 없이 되뇌면 덜 놓칩니다.',
        '틀렸다고 멈추면 다음 도형까지 놓칩니다. 틀린 건 버리고 바로 다음 도형을 외우세요.'],
      start: gameNback },
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
    { id: 'potion', name: '마법약 만들기', icon: 'gi-potion', unit: '점', time: 0,
      meas: '규칙 학습 · 적응',
      modes: [
        { key: 'practice', label: '연습', sub: '30문항' },
        { key: 'real', label: '실전 흐름', sub: '100문항 · 실제와 같은 길이' }
      ],
      rules: ['약초 4가지 중 <b>일부가 켜진 조합</b>이 나옵니다. 파란약과 빨간약 중 무엇이 나올지 3초 안에 예측하세요.',
        '정답 규칙은 알려 주지 않습니다 — 매 문항 공개되는 제조 결과를 보며 <b>조합→결과 규칙을 스스로 찾는</b> 게임입니다.',
        '같은 조합의 결과가 <b>도중에 바뀔 수 있습니다.</b> 바뀐 걸 알아채고 갈아타는 것까지가 과제입니다.'],
      tips: ['카드 하나가 아니라 <b>조합 전체</b>가 결과를 정합니다. "원+세모=파랑"처럼 조합 단위로 외우세요.',
        '모든 문항을 맞힐 수는 없습니다. 한 번 틀렸다고 뒤집지 말고, 두 번 연속 틀리면 규칙이 바뀐 걸로 보세요.'],
      start: gamePotion },
    { id: 'cat', name: '고양이 술래잡기', icon: 'gi-cat', unit: '점', time: 0,
      meas: '위치 기억 · 판단',
      modes: [
        { key: 'practice', label: '연습', sub: '10문항 · 판단 뒤 정답 공개' },
        { key: 'real', label: '실전 흐름', sub: '20문항 · 공개 없음' }
      ],
      rules: ['생쥐들이 숨은 자리가 <b>1초만</b> 보였다 사라집니다.',
        '고양이가 나타난 칸(<b class="c-red">첫 번째</b> → <b class="c-blue">두 번째</b>)에 생쥐가 있었는지 3초 안에 답하세요.',
        '답은 확신까지 넷 중 하나입니다. 생쥐는 4마리에서 시작해 최대 18마리까지 늘어납니다.'],
      tips: ['전부 외울 수는 없습니다 — 생쥐가 몰린 구역을 덩어리로 기억하세요.',
        '실제 검사는 확신도까지 봅니다. 모르면 과신보다 "아마"를 고르는 게 낫습니다.'],
      start: gameCat },
    { id: 'yaksok', name: '약속 정하기', icon: 'gi-yaksok', unit: '점', time: 90,
      meas: '조건 추론',
      rules: ['친구들의 가능한 시간 조건이 나옵니다.',
        '전원이 가능한 단 하나의 시간을 표에서 고르세요.', '90초 동안 맞힌 문제 수가 점수입니다.'],
      tips: ['"~만 돼요"부터 읽으세요 — 후보가 가장 크게 줄어듭니다.',
        '남은 후보에 "안 돼요" 조건을 하나씩 지워 나가면 답이 남습니다.'],
      start: gameYaksok },
    { id: 'numbers', name: '숫자 누르기', icon: 'gi-numbers', unit: '점', time: 0,
      meas: '반응 속도 · 인지 제어',
      modes: [
        { key: 'practice', label: '짧게 연습', sub: '1라운드 30초 → 2라운드 60초' },
        { key: 'real', label: '실전 흐름', sub: '1라운드 60초 → 2라운드 120초' }
      ],
      rules: ['1라운드: 불이 들어온 숫자를 최대한 빨리 누릅니다.',
        '2라운드: 새 배열마다 <b>1→9 순서대로.</b> 단 한 숫자는 <b>연속 2번</b>, 한 숫자는 <b>건너뛰기.</b>',
        '준비 표시 중에 누르면 오답이고, 규칙을 어기면 그 문항은 즉시 끝납니다.'],
      tips: ['2라운드는 누르기 전에 규칙(2번/건너뛰기 숫자)과 배열부터 확인하는 습관이 점수를 만듭니다.',
        '급하게 시작하는 게 제일 손해예요 — 흐림이 걷힌 다음 손을 대세요.'],
      start: gameNumbers },
    { id: 'compare', name: '개수 비교', icon: 'gi-compare', unit: '점', time: 0,
      meas: '수 감각 · 순간 판단',
      modes: [
        { key: 'practice', label: '연습', sub: '20문항 · 답하면 실제 개수 공개' },
        { key: 'real', label: '실전 흐름', sub: '46문항 · 노출 1초 · 답 3초' }
      ],
      rules: ['좌우에 단어들이 <b>1초만</b> 보였다 사라집니다.',
        '단어가 더 많았던 쪽을 <b>3초 안에</b> 고르세요.',
        '글자 크기가 제각각이라 면적이 아니라 <b>개수</b>로 판단해야 합니다. 한쪽 16~45개, 차이는 3~4개 안팎.'],
      tips: ['하나씩 셀 시간이 없습니다 — 서너 개 묶음으로 어림하고, 헷갈리면 더 많아 보인 쪽을 직관적으로 바로 고르세요.',
        '연습에서 실제 개수를 확인하며 내 눈대중이 몇 개 차이까지 통하는지 재 보세요.'],
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
