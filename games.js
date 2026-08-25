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

  /* 버그 제보 창구 — 사이트 공용 카카오톡 문의(정본 주소는 nav.js SOCIAL·pages.md) */
  var REPORT_URL = 'https://pf.kakao.com/_iajxnX/chat';

  /* ── 엔진 상태 ── */
  var cur = null;          // 현재 게임 정의
  var running = false;
  var timerId = 0, endAt = 0, timeLimit = 0;
  var score = 0;
  var streak = 0, bestStreak = 0, tries = 0, okCnt = 0, segs = [];
  var cleanupFn = null;    // 게임별 타이머 정리 등
  var streakEl = $('gmStreak');

  function setScore(n) { score = n; scoreEl.textContent = String(n); }
  /* 판정 한 번 = mark 한 번 — 점수·연속·세그먼트(라운드별 성적)를 한 곳에서 적는다.
     결과 화면의 정답률·최고 연속·라운드별 성적이 전부 여기서 나온다. */
  function mark(ok, gain, seg) {
    tries++;
    if (ok) {
      okCnt++;
      setScore(score + (gain == null ? 1 : gain));
      streak++;
      if (streak > bestStreak) bestStreak = streak;
    } else streak = 0;
    streakEl.textContent = String(streak);
    if (seg) {
      var sg = null;
      for (var i = 0; i < segs.length; i++) if (segs[i].label === seg) sg = segs[i];
      if (!sg) { sg = { label: seg, ok: 0, tot: 0 }; segs.push(sg); }
      sg.tot++;
      if (ok) sg.ok++;
    }
  }

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
      (tries > 0
        ? '<div class="r-stats">' +
          '<div class="r-row"><span>정답</span><b>' + okCnt + ' / ' + tries + '문항 · ' +
            Math.round(okCnt / tries * 100) + '%</b></div>' +
          '<div class="r-row"><span>최고 연속</span><b>' + bestStreak + '</b></div>' +
          segs.map(function (sg) {
            return '<div class="r-row"><span>' + sg.label + '</span><b>' + sg.ok + ' / ' + sg.tot +
              (sg.tot ? ' · ' + Math.round(sg.ok / sg.tot * 100) + '%' : '') + '</b></div>';
          }).join('') +
          '</div>'
        : '') +
      '<div class="r-btns">' +
        '<button type="button" class="gm-tohub" id="gmToHub">목록으로</button>' +
        '<button type="button" class="gm-again" id="gmAgain">다시 하기</button>' +
      '</div>' +
      '<a class="r-report" href="' + REPORT_URL + '" target="_blank" rel="noopener">게임이 이상했나요? 카카오톡으로 제보하기</a>';
    resultEl.classList.add('on');
    $('gmAgain').addEventListener('click', function () { startPlay(); });
    $('gmToHub').addEventListener('click', function () { goHub(); });
    $('gmAgain').focus();
  }

  /* 게임에 넘겨주는 손잡이 — 게임 코드는 이 밖의 엔진 내부를 만지지 않는다 */
  var api = {
    board: board,
    mark: mark,
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
    streak = 0; bestStreak = 0; tries = 0; okCnt = 0; segs = [];
    streakEl.textContent = '0';
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
        : '<button type="button" class="gm-start" data-mode="practice">시작하기</button>') +
      /* 약한 라운드만 골라 반복 — 실물의 라운드 선택을 칩 한 줄로 */
      (g.parts
        ? '<div class="gm-parts"><em>부분만 연습</em>' + g.parts.map(function (pp) {
            return '<button type="button" class="gm-part" data-mode="' + pp.key + '">' + pp.label + '</button>';
          }).join('') + '</div>'
        : '');
    [].slice.call(introEl.querySelectorAll('.gm-start, .gm-part')).forEach(function (btn) {
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
      api.mark(ok, 1, plan[pi].dual ? '2·3-back' : '2-back');
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
        if (judge && !answered) {                       /* 미응답 = 오답 */
          api.mark(false, 0, pl.dual ? '2·3-back' : '2-back');
          api.flash(b, false);
        }
        next();
      });
    }
    buildButtons(plan[0].dual);
    seq = genSeq(plan[0]);
    idx = 0;
    show();
  }

  /* ── 2. 가위바위보 — 목표는 언제나 '내가 이긴다', 라운드마다 관점이 뒤집힌다 ──
     실전 구성(오너 캡처): R1 나의 관점 40초 → R2 상대 관점 40초 → R3 랜덤 1분 40초, 무제한 문제.
     나의 관점 = 상대 손을 보고 내가 이기는 손 / 상대 관점 = 내 손을 보고 상대가 지는 손. */
  function gameRPS(api, mode) {
    var HANDS = ['gs-circle', 'gi-rps', 'gs-paper'];   // 0 바위 1 가위 2 보
    var NAMES = ['바위', '가위', '보'];
    var winOf = function (o) { return (o + 2) % 3; };  // o 를 이기는 손
    var loseOf = function (o) { return (o + 1) % 3; }; // o 에게 지는 손
    var real = mode === 'real';
    var rounds =
      mode === 'r1' ? [{ persp: 'me', sec: 40 }] :
      mode === 'r2' ? [{ persp: 'opp', sec: 40 }] :
      mode === 'r3' ? [{ persp: 'rand', sec: 100 }] :
      [
        { persp: 'me', sec: real ? 40 : 20 },
        { persp: 'opp', sec: real ? 40 : 20 },
        { persp: 'rand', sec: real ? 100 : 40 }
      ];
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q"><span id="rpsPhase"></span><span class="sub" id="rpsInfo"></span></div>' +
      '<div class="gm-vs">' +
        '<div class="gm-hand"><em>나</em><span id="rpsMe"></span></div>' +
        '<div class="gm-hand"><em>상대</em><span id="rpsOp"></span></div>' +
      '</div>' +
      '<div class="gm-qtimer"><i id="rpsTick"></i></div>' +
      '<div class="gm-bigrow" id="rpsBtns"></div>';
    var phaseEl = $('rpsPhase'), infoEl = $('rpsInfo'), meCard = $('rpsMe'), opCard = $('rpsOp');
    var tickBar = $('rpsTick'), wrap = $('rpsBtns');
    var tk = null, tids = [];
    api.onCleanup(function () { if (tk) tk.stop(); tids.forEach(clearTimeout); });
    function later(fn, ms) { tids.push(setTimeout(fn, ms)); }
    var ri = 0, persp = 'me', want = 0, betw = true;
    [1, 0, 2].forEach(function (i) {                   // 실전 배열 순서: 가위·바위·보
      var btn = el('button', 'gm-big', sym(HANDS[i]) + '<span>' + NAMES[i] + '</span>');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        if (!isRunning() || betw) return;
        var ok = i === want;
        api.mark(ok, 1, persp === 'me' ? '나의 관점' : '상대 관점');
        api.flash(b, ok);
        next();
      });
      wrap.appendChild(btn);
    });
    function next() {
      var p = rounds[ri].persp;
      persp = p === 'rand' ? (rnd(2) ? 'me' : 'opp') : p;
      var shown = rnd(3);
      if (persp === 'me') {
        want = winOf(shown);
        opCard.innerHTML = sym(HANDS[shown]) + '<b>' + NAMES[shown] + '</b>';
        meCard.innerHTML = '<i>?</i>';
        infoEl.textContent = '상대 손을 보고, 내가 이기는 손을 고르세요';
      } else {
        want = loseOf(shown);
        meCard.innerHTML = sym(HANDS[shown]) + '<b>' + NAMES[shown] + '</b>';
        opCard.innerHTML = '<i>?</i>';
        infoEl.textContent = '내 손을 보고, 상대가 지는 손을 고르세요';
      }
      phaseEl.textContent = 'R' + (ri + 1) + '/' + rounds.length + ' · ' + (persp === 'me' ? '나의 관점' : '상대 관점');
    }
    function startRound() {
      if (!isRunning()) return;
      betw = false;
      next();
      tk = ticker(tickBar, rounds[ri].sec * 1000, function () {
        ri++;
        if (ri >= rounds.length) { api.finish(); return; }
        betw = true;
        phaseEl.textContent = 'ROUND ' + (ri + 1) + ' · ' +
          (rounds[ri].persp === 'me' ? '나의 관점' : rounds[ri].persp === 'opp' ? '상대 관점' : '관점 랜덤');
        infoEl.textContent = '잠깐 쉬었다 이어집니다';
        meCard.innerHTML = ''; opCard.innerHTML = '';
        later(startRound, 1400);
      });
    }
    startRound();
  }

  /* ── 2. 숫자 누르기 — 1라운드 신호 반응 + 2라운드 순서·특수 규칙(인지 제어) ──
     실전 구성(캡처 기준): R1 60초 고정 배열에서 활성화된 숫자 클릭 / R2 120초 매 문항 섞인
     배열에서 1→9 순서, 지정 숫자는 연속 2번·지정 숫자는 건너뛰기, 신호 전 클릭은 오답. */
  function gameNumbers(api, mode) {
    var doR1 = mode !== 'p2', doR2 = mode !== 'p1';
    var short = mode === 'practice';
    var r1sec = short ? 30 : 60;
    var r2sec = short ? 60 : 120;
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
          api.mark(true, 1, '1라운드');
          c.classList.remove('lit');
          nextTarget();
        } else { api.mark(false, 0, '1라운드'); shake(c); }
      } else if (phase === 2) {
        if (switching) return;
        if (!ready) { failQ('신호 전에 눌렀어요'); return; }
        if (n === exp[ep]) {
          ep++;
          c.classList.add('done');
          if (exp[ep] === n) c.classList.remove('done');   /* 2번 숫자 첫 클릭 — 한 번 더 눌러야 한다 */
          if (ep >= exp.length) {
            switching = true;
            api.mark(true, 1, '2라운드');
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
      api.mark(false, 0, '2라운드');
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
      tk = ticker(tickBar, r1sec * 1000, function () {
        if (doR2) startBreak(); else api.finish();
      });
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
      /* '2라운드만'으로 바로 들어오면 쉬는 화면을 안 거친다 — 제목을 여기서도 적는다 */
      phaseEl.textContent = '2라운드 — 순서대로 누르기';
      newR2Q();
      tk = ticker(tickBar, r2sec * 1000, function () { api.finish(); });
    }
    if (doR1) startR1(); else startR2();
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
      api.mark(ok, 1);
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

  /* ── 5. 도형 회전 — 45도 회전·반전 순서를 '상상해서' 입력한다(모양은 안 바뀐다) ──
     실전 구성(오너 캡처): 한 번에 45도(90도 아님), 좌우·상하반전, 문제당 클릭 20(지움·초기화 포함),
     과정 최대 8단계, 실전은 글자 3분 → 무늬 3분. 판정은 변형 행렬 비교 — 글자·무늬 모두
     비대칭이라 행렬이 같아야만 화면도 같다(대칭 도형은 생성에서 거른다). */
  function gameRotate(api, mode) {
    var LETTERS = ['F', 'G', 'J', 'L', 'P', 'R', 'Q'];
    var real = mode === 'real';
    var phases = real
      ? [{ kind: 'letter', sec: 180 }, { kind: 'pattern', sec: 180 }]
      : mode === 'pattern' ? [{ kind: 'pattern', count: 10 }] : [{ kind: 'letter', count: 10 }];
    var C = Math.SQRT1_2;
    var OPS = [
      { k: 'L45', label: '왼쪽 45°', m: [C, -C, C, C] },
      { k: 'R45', label: '오른쪽 45°', m: [C, C, -C, C] },
      { k: 'H', label: '좌우반전', m: [-1, 0, 0, 1] },
      { k: 'V', label: '상하반전', m: [1, 0, 0, -1] }
    ];
    function mul(o, u) {                               // o∘u — css matrix(a,b,c,d) 합성
      return [o[0] * u[0] + o[2] * u[1], o[1] * u[0] + o[3] * u[1],
        o[0] * u[2] + o[2] * u[3], o[1] * u[2] + o[3] * u[3]];
    }
    var I = [1, 0, 0, 1];
    function same(a, c) {
      for (var i = 0; i < 4; i++) if (Math.abs(a[i] - c[i]) > 0.01) return false;
      return true;
    }
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q"><span id="rtPhase"></span><span class="sub" id="rtInfo"></span></div>' +
      '<div class="gm-rt-cards">' +
        '<div class="gm-rt-card"><em>전</em><svg id="rtBefore" viewBox="0 0 80 80"></svg></div>' +
        '<div class="gm-rt-card aft"><em>후</em><svg id="rtAfter" viewBox="0 0 80 80"></svg></div>' +
      '</div>' +
      '<div class="gm-rt-ops" id="rtOps"></div>' +
      '<div class="gm-rt-slots" id="rtSlots"></div>' +
      '<div class="gm-rt-tools"><span>남은 클릭 <b id="rtClick">20</b></span>' +
        '<button type="button" id="rtUndo">하나 지움</button>' +
        '<button type="button" id="rtReset">전체 초기화</button></div>' +
      (real ? '<div class="gm-qtimer"><i id="rtTick"></i></div>' : '') +
      '<div class="gm-reveal" id="rtReveal"></div>' +
      '<button type="button" class="gm-submit" id="rtGo">답안 제출</button>';
    var phaseEl = $('rtPhase'), infoEl = $('rtInfo'), beforeEl = $('rtBefore'), afterEl = $('rtAfter');
    var opsEl = $('rtOps'), slotsEl = $('rtSlots'), clickEl = $('rtClick'), revealEl = $('rtReveal');
    var tk = null, tids = [];
    api.onCleanup(function () { if (tk) tk.stop(); tids.forEach(clearTimeout); });
    function later(fn, ms) { tids.push(setTimeout(fn, ms)); }
    var pi = 0, q = 0, clicks = 20, seq = [], target = I, shapeHtml = '', solved = 0, locked = false;
    function letterShape() {
      return '<text x="40" y="41" text-anchor="middle" dominant-baseline="central" font-size="50" ' +
        'font-weight="800" font-family="Arial, sans-serif" fill="currentColor">' + pick(LETTERS) + '</text>';
    }
    function patternShape() {
      /* 3×3에서 4칸 — 어떤 회전·반전으로도 자기 자신이 안 되는 비대칭 무늬만 쓴다 */
      for (var t = 0; t < 60; t++) {
        var cells = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, 4).sort();
        var pts = cells.map(function (i) { return [Math.floor(i / 3), i % 3]; });
        var keyOf = function (ps) {
          return ps.map(function (c) { return c.join(','); }).sort().join('|');
        };
        var base = keyOf(pts), symm = false;
        var variants = [
          function (r, c) { return [c, 2 - r]; }, function (r, c) { return [2 - r, 2 - c]; },
          function (r, c) { return [2 - c, r]; }, function (r, c) { return [r, 2 - c]; },
          function (r, c) { return [2 - r, c]; }, function (r, c) { return [c, r]; },
          function (r, c) { return [2 - c, 2 - r]; }
        ];
        for (var v = 0; v < variants.length; v++) {
          var mapped = pts.map(function (pc) { return variants[v](pc[0], pc[1]); });
          if (keyOf(mapped) === base) { symm = true; break; }
        }
        if (symm) continue;
        return pts.map(function (pc) {
          return '<rect x="' + (17 + pc[1] * 16) + '" y="' + (17 + pc[0] * 16) +
            '" width="14" height="14" rx="2" fill="currentColor"/>';
        }).join('');
      }
      return '<rect x="17" y="17" width="14" height="14" fill="currentColor"/>';
    }
    function apply(svg, m) { svg.style.transform = 'matrix(' + m.join(',') + ',0,0)'; svg.style.transformOrigin = '50% 50%'; }
    function drawSeq() {
      slotsEl.innerHTML = seq.length
        ? seq.map(function (o) { return '<i>' + o.label + '</i>'; }).join('')
        : '<i style="background:transparent;color:var(--text-dim)">버튼을 눌러 순서를 입력하세요</i>';
    }
    function spend() {
      if (clicks <= 0) return false;
      clicks--; clickEl.textContent = String(clicks);
      return true;
    }
    OPS.forEach(function (o) {
      var btn = el('button', '', o.label);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        if (!isRunning() || locked) return;
        if (seq.length >= 8 || !spend()) { shake(btn); return; }
        seq.push(o);
        drawSeq();
      });
      opsEl.appendChild(btn);
    });
    $('rtUndo').addEventListener('click', function () {
      if (!isRunning() || locked || !seq.length) return;
      if (!spend()) return;
      seq.pop(); drawSeq();
    });
    $('rtReset').addEventListener('click', function () {
      if (!isRunning() || locked || !seq.length) return;
      if (!spend()) return;
      seq = []; drawSeq();
    });
    $('rtGo').addEventListener('click', function () {
      if (!isRunning() || locked) return;
      locked = true;
      var m = I;
      seq.forEach(function (o) { m = mul(o.m, m); });
      var ok = same(m, target);
      api.mark(ok, 1, phases[pi].kind === 'letter' ? '글자' : '무늬');
      if (ok) solved++;
      api.flash(b, ok);
      if (!real) revealEl.textContent = '정답 예: ' + curAnswer.map(function (o) { return o.label; }).join(' → ');
      later(nq, real ? 500 : 1300);
    });
    var curAnswer = [];
    function nq() {
      if (!isRunning()) return;
      var ph = phases[pi];
      if (!real && q >= ph.count) { api.finish(); return; }
      q++; locked = false;
      clicks = 20; clickEl.textContent = '20';
      seq = []; drawSeq();
      revealEl.textContent = '';
      shapeHtml = ph.kind === 'letter' ? letterShape() : patternShape();
      var len = 1 + Math.min(2, Math.floor(solved / 4)) + rnd(2);   // 1~2 → 최대 3~4
      var m = I;
      do {
        m = I; curAnswer = [];
        for (var i = 0; i < len; i++) { var o = pick(OPS); curAnswer.push(o); m = mul(o.m, m); }
      } while (same(m, I));
      target = m;
      beforeEl.innerHTML = shapeHtml; apply(beforeEl, I);
      afterEl.innerHTML = shapeHtml; apply(afterEl, target);
      phaseEl.textContent = (ph.kind === 'letter' ? '글자' : '무늬') + (real ? ' · 실전' : '');
      infoEl.textContent = real ? '맞힌 ' + score + '개' : '문항 ' + q + '/' + ph.count;
    }
    function startPhase() {
      var ph = phases[pi];
      q = 0;
      if (real) {
        tk = ticker($('rtTick'), ph.sec * 1000, function () {
          pi++;
          if (pi >= phases.length) { api.finish(); return; }
          startPhase();
        });
      }
      nq();
    }
    startPhase();
  }

  /* ── 4. 길 만들기 — 울타리(/ \\)로 직진 차량을 꺾어 같은 색 손님에게 보낸다 ──
     실전 구성(오너 캡처): 차량은 직진·울타리를 만나면 90도 꺾임, 설치·제거 클릭 최대 20,
     정답 울타리 수 표시, 48문제·최대 5분. 짝은 택시→1인·버스→단체·오토바이→화물(색 동일).
     캡처의 '누른 위치로 방향 결정'은 터치에 안 맞아 탭 순환(없음→/→\\→없음)으로 바꿨다. */
  function gamePath(api, mode) {
    var N = 5;
    var real = mode === 'real';
    var total = real ? 48 : 12;
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q">울타리로 꺾어서 <b>같은 색 손님</b>에게 보내세요<span class="sub" id="pthInfo"></span></div>' +
      '<div class="gm-pstats"><span>남은 클릭 <b id="pthClick">20</b></span>' +
        '<span>정답 울타리 <b id="pthNeed">0</b></span><span>설치 <b id="pthSet">0</b></span></div>' +
      '<div class="gm-pwrap" id="pthWrap"></div>' +
      (real ? '<div class="gm-qtimer"><i id="pthTick"></i></div>' : '') +
      '<div class="gm-reveal" id="pthReveal"></div>' +
      '<button type="button" class="gm-submit" id="pthGo">제출</button>';
    var infoEl = $('pthInfo'), clickEl = $('pthClick'), needEl = $('pthNeed'), setEl = $('pthSet');
    var wrap = $('pthWrap'), revealEl = $('pthReveal');
    var tk = null, tids = [];
    api.onCleanup(function () { if (tk) tk.stop(); tids.forEach(clearTimeout); });
    function later(fn, ms) { tids.push(setTimeout(fn, ms)); }
    if (real) tk = ticker($('pthTick'), 300 * 1000, function () { api.finish(); });

    var VEH = [
      { v: 'gi-taxi', g: 'gi-guest1', c: 'col-y' },
      { v: 'gi-bus', g: 'gi-guest2', c: 'col-b' },
      { v: 'gi-moto', g: 'gi-cargo', c: 'col-r' }
    ];
    var DIRS = { T: [1, 0], B: [-1, 0], L: [0, 1], R: [0, -1] };   // 진입 방향(안쪽으로)
    function reflect(d, t) { return t === 1 ? [-d[1], -d[0]] : [d[1], d[0]]; }   // 1='/' 2='\\'
    function entryCell(side, idx) {
      return side === 'T' ? { r: 0, c: idx } : side === 'B' ? { r: N - 1, c: idx } :
        side === 'L' ? { r: idx, c: 0 } : { r: idx, c: N - 1 };
    }
    function simulate(side, idx, fmap) {
      var e = entryCell(side, idx);
      var r = e.r, c = e.c, d = DIRS[side].slice(), guard = 0, touched = {};
      while (guard++ < 80) {
        var f = fmap[r + ',' + c];
        if (f) { d = reflect(d, f); touched[r + ',' + c] = 1; }
        var nr = r + d[0], nc = c + d[1];
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) {
          var os = d[0] === 1 ? 'B' : d[0] === -1 ? 'T' : d[1] === 1 ? 'R' : 'L';
          return { side: os, idx: os === 'T' || os === 'B' ? c : r, touched: touched };
        }
        r = nr; c = nc;
      }
      return null;   // 울타리 순환
    }
    var q = 0, puzzle = null, fences = {}, clicks = 20, placed = 0;
    function genPuzzle(vcount, fcount) {
      for (var t = 0; t < 300; t++) {
        var sol = {}, put = 0, g = 0;
        while (put < fcount && g++ < 60) {
          var k = rnd(N) + ',' + rnd(N);
          if (!sol[k]) { sol[k] = 1 + rnd(2); put++; }
        }
        var kinds = shuffle([0, 1, 2]).slice(0, vcount);
        var usedSlots = {}, vs = [], bad = false, touchedAll = {};
        for (var vi = 0; vi < vcount; vi++) {
          var side = pick(['T', 'B', 'L', 'R']), idx = rnd(N);
          if (usedSlots[side + idx]) { bad = true; break; }
          usedSlots[side + idx] = 1;
          var res = simulate(side, idx, sol);
          if (!res || usedSlots[res.side + res.idx]) { bad = true; break; }
          usedSlots[res.side + res.idx] = 1;
          Object.keys(res.touched).forEach(function (kk) { touchedAll[kk] = 1; });
          vs.push({ kind: kinds[vi], side: side, idx: idx, out: res.side, outIdx: res.idx });
        }
        if (bad) continue;
        if (Object.keys(touchedAll).length < fcount) continue;   // 안 쓰인 울타리가 있으면 다시
        return { vs: vs, sol: sol, need: fcount };
      }
      return null;
    }
    function fenceSvg(t) {
      return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="' +
        (t === 1 ? 'M8 40 40 8' : 'M8 8 40 40') +
        '" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" fill="none"/></svg>';
    }
    function markerAt(side, idx) {
      for (var i = 0; i < puzzle.vs.length; i++) {
        var v = puzzle.vs[i], def = VEH[v.kind];
        if (v.side === side && v.idx === idx) return '<span class="mk ' + def.c + '">' + sym(def.v) + '</span>';
        if (v.out === side && v.outIdx === idx) return '<span class="mk ' + def.c + '">' + sym(def.g) + '</span>';
      }
      return '';
    }
    function draw(hint) {
      wrap.innerHTML = '';
      for (var r = -1; r <= N; r++) {
        for (var c = -1; c <= N; c++) {
          if (r === -1 || r === N || c === -1 || c === N) {
            var mk = '';
            if (r === -1 && c >= 0 && c < N) mk = markerAt('T', c);
            else if (r === N && c >= 0 && c < N) mk = markerAt('B', c);
            else if (c === -1 && r >= 0 && r < N) mk = markerAt('L', r);
            else if (c === N && r >= 0 && r < N) mk = markerAt('R', r);
            wrap.appendChild(el('div', 'gm-pedge', mk));
            continue;
          }
          var k = r + ',' + c;
          var src = hint ? puzzle.sol : fences;
          var cell = el('button', 'gm-pcell' + (hint && puzzle.sol[k] ? ' hint' : ''),
            src[k] ? fenceSvg(src[k]) : '');
          cell.type = 'button';
          cell.setAttribute('aria-label', (r + 1) + '행 ' + (c + 1) + '열 울타리');
          (function (kk) {
            cell.addEventListener('click', function () { tap(kk); });
          })(k);
          wrap.appendChild(cell);
        }
      }
    }
    var locked = false;
    function tap(k) {
      if (!isRunning() || locked) return;
      if (clicks <= 0) { shake(wrap); return; }
      clicks--; clickEl.textContent = String(clicks);
      var cur = fences[k] || 0;
      if (cur === 2) delete fences[k];
      else fences[k] = cur + 1;                        // 없음 → / → \\ → 없음
      placed = Object.keys(fences).length;
      setEl.textContent = String(placed);
      draw(false);
    }
    $('pthGo').addEventListener('click', function () {
      if (!isRunning() || locked) return;
      locked = true;
      var allOk = puzzle.vs.every(function (v) {
        var res = simulate(v.side, v.idx, fences);
        return res && res.side === v.out && res.idx === v.outIdx;
      });
      api.mark(allOk, 1);
      api.flash(b, allOk);
      if (!real) {
        revealEl.textContent = allOk ? '연결 성공!' : '정답 배치를 잠깐 보여드릴게요';
        if (!allOk) draw(true);
        later(nq, allOk ? 700 : 1600);
      } else later(nq, 400);
    });
    function nq() {
      if (!isRunning()) return;
      if (q >= total) { api.finish(); return; }
      q++; locked = false;
      var step = real ? 12 : 4;
      var fcount = Math.min(4, 1 + Math.floor((q - 1) / step));
      var vcount = fcount >= 3 ? 2 : 1;
      puzzle = genPuzzle(vcount, fcount) || genPuzzle(1, 1);
      fences = {}; placed = 0; clicks = 20;
      clickEl.textContent = '20'; setEl.textContent = '0';
      needEl.textContent = String(puzzle.need);
      revealEl.textContent = '';
      infoEl.textContent = '문항 ' + q + '/' + total + ' · 칸을 누르면 없음 → / → \\ 순서로 바뀝니다';
      draw(false);
    }
    nq();
  }

  /* ── 6. 약속 정하기 — 세 친구의 선호가 1초씩 지나간다. 기억했다가 공통(R4는 반대)을 답한다 ──
     실전 구성(오너 캡처): R1 요일·R2 장소·R3 메뉴는 모두의 공통, R4 버스는 아무도 안 탄 번호.
     4라운드 × 10문항, 제시 1초·답 3초, 각 라운드 6번째 문항부터 기억 3개 → 4개. */
  function gameYaksok(api, mode) {
    var NAMES = ['지민', '서연', '하준'];
    var real = mode === 'real';
    var PART = { day: 0, place: 1, menu: 2, bus: 3 }[mode];
    var perRound = real ? 10 : PART != null ? 10 : 3;
    var ROUNDS = [
      { label: '요일', q: '약속 요일을 언제로 잡으면 좋을까요?', pool: ['월', '화', '수', '목', '금', '토', '일'], candAll: true, common: true, note: '모두가 공통으로 고르는 요일' },
      { label: '장소', q: '약속 장소는 어디가 좋을까요?', pool: ['공원', '카페', '서점', '영화관', '박물관', '한강', '전시회', '노래방'], common: true, note: '모두가 공통으로 고르는 곳' },
      { label: '메뉴', q: '메뉴는 무엇으로 할까요?', pool: ['김밥', '피자', '치킨', '국수', '초밥', '샐러드', '버거', '전골'], common: true, note: '모두가 공통으로 고르는 메뉴' },
      { label: '버스', q: '아무도 타지 않은 버스는 몇 번일까요?', common: false, note: '이번엔 반대 — 아무도 안 탄 번호를 고르세요' }
    ];
    function sample(arr, n) { return shuffle(arr.slice()).slice(0, n); }
    var b = api.board;
    b.innerHTML =
      '<div class="gm-q"><span id="ykPhase"></span><span class="sub" id="ykInfo"></span></div>' +
      '<div class="gm-memo" id="ykStage"></div>' +
      '<div class="gm-qtimer"><i id="ykTick"></i></div>' +
      '<div class="gm-reveal" id="ykReveal"></div>';
    var phaseEl = $('ykPhase'), infoEl = $('ykInfo'), stageEl = $('ykStage'), revealEl = $('ykReveal');
    var tickBar = $('ykTick');
    var tk = null, tids = [];
    api.onCleanup(function () { if (tk) tk.stop(); tids.forEach(clearTimeout); });
    function later(fn, ms) { tids.push(setTimeout(fn, ms)); }
    var roundList = null;   // ROUNDS 아래에서 채운다(부분 연습이면 한 라운드만)
    var ri = 0, qi = 0;
    function gen(round, memSize) {
      if (round.common) {
        for (var t = 0; t < 60; t++) {
          var answer = pick(round.pool);
          var rest = round.pool.filter(function (x) { return x !== answer; });
          var sets = NAMES.map(function () { return shuffle([answer].concat(sample(rest, memSize - 1))); });
          var inter = round.pool.filter(function (x) {
            return sets.every(function (st) { return st.indexOf(x) >= 0; });
          });
          if (inter.length !== 1) continue;
          var cands = round.candAll ? round.pool.slice()
            : shuffle([answer].concat(sample(rest, 5)));
          return { answer: answer, sets: sets, cands: cands };
        }
        return null;
      }
      /* 버스 — 후보는 전부 '누군가 탄 번호'여야 하고 답만 아무도 안 탄 번호다 */
      var nums = [];
      while (nums.length < 8) {
        var n = 10 + rnd(90);
        if (nums.indexOf(n) < 0) nums.push(n);
      }
      var ans = nums[0];
      var ridden = nums.slice(1);
      var sets2 = NAMES.map(function () { return sample(ridden, memSize); });
      var union = [];
      sets2.forEach(function (st) { st.forEach(function (n2) { if (union.indexOf(n2) < 0) union.push(n2); }); });
      var cands2 = shuffle([ans].concat(sample(union, Math.min(5, union.length))));
      return { answer: String(ans), sets: sets2.map(function (st) { return st.map(String); }), cands: cands2.map(String) };
    }
    function roundIntro() {
      if (ri >= roundList.length) { api.finish(); return; }
      qi = 0;
      var r = roundList[ri];
      phaseEl.textContent = 'ROUND ' + (ri + 1) + '/' + roundList.length + ' · ' + r.label;
      infoEl.textContent = r.note;
      stageEl.innerHTML = '<div class="who">' + r.note + '</div>';
      tickBar.style.width = '0%';
      later(nq, 1600);
    }
    function nq() {
      if (!isRunning()) return;
      if (qi >= perRound) { ri++; roundIntro(); return; }
      qi++;
      var r = roundList[ri];
      var memSize = real && qi >= 6 ? 4 : 3;
      var data = gen(r, memSize);
      if (!data) { qi--; later(nq, 10); return; }
      phaseEl.textContent = 'R' + (ri + 1) + '/' + roundList.length + ' · ' + r.label;
      infoEl.textContent = '문항 ' + qi + '/' + perRound;
      revealEl.textContent = '';
      tickBar.style.width = '0%';
      showFriend(0);
      function showFriend(k) {
        if (!isRunning()) return;
        if (k >= NAMES.length) { ask(); return; }
        stageEl.innerHTML = '<div class="who">' + NAMES[k] + '</div>' +
          '<div class="set">' + data.sets[k].map(function (x) { return '<i>' + x + '</i>'; }).join('') + '</div>';
        later(function () { showFriend(k + 1); }, 1000);   // 제시 1초 — 실전 속도 그대로
      }
      function ask() {
        var done = false;
        stageEl.innerHTML = '<div class="who">' + r.q + '</div><div class="gm-cands" id="ykCands"></div>';
        var candsEl = $('ykCands');
        data.cands.forEach(function (cd) {
          var btn = el('button', '', cd);
          btn.type = 'button';
          btn.addEventListener('click', function () {
            if (!isRunning() || done) return;
            done = true;
            if (tk) tk.stop();
            var ok = cd === data.answer;
            api.mark(ok, 1, r.label);
            api.flash(b, ok);
            if (!real) revealEl.textContent = '정답: ' + data.answer;
            later(nq, real ? 350 : 1000);
          });
          candsEl.appendChild(btn);
        });
        tk = ticker(tickBar, 3000, function () {         // 답 3초
          if (done) return;
          done = true;
          api.mark(false, 0, r.label);
          api.flash(b, false);
          if (!real) revealEl.textContent = '시간 초과 — 정답: ' + data.answer;
          later(nq, real ? 350 : 1000);
        });
      }
    }
    roundList = PART != null ? [ROUNDS[PART]] : ROUNDS;
    roundIntro();
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
    { id: 'rps', name: '가위바위보', icon: 'gi-rps', unit: '점', time: 0,
      meas: '순발력 · 관점 전환',
      modes: [
        { key: 'practice', label: '짧게 연습', sub: '라운드당 20초 → 랜덤 40초' },
        { key: 'real', label: '실전 흐름', sub: '나의 관점 40초 → 상대 관점 40초 → 랜덤 1분 40초' }
      ],
      rules: ['규칙은 하나 — <b>언제나 내가 이겨야</b> 합니다. 관점에 따라 고르는 손이 뒤집힙니다.',
        '<b>나의 관점</b>: 상대 손을 보고 내가 이기는 손 / <b>상대 관점</b>: 내 손을 보고 상대가 지는 손.',
        '3라운드(나의 관점 → 상대 관점 → 랜덤) 동안 무제한으로 풀어 맞힌 수를 셉니다.'],
      tips: ['상대 관점이 나오면 한 박자 멈추세요 — 습관대로 이기는 손이 먼저 나가는 게 최대 실점 요인입니다.',
        '랜덤 라운드는 매 문항 관점 배지부터 확인하고 손을 고르세요.'],
      parts: [{ key: 'r1', label: 'R1 나의 관점' }, { key: 'r2', label: 'R2 상대 관점' }, { key: 'r3', label: 'R3 랜덤' }],
      start: gameRPS },
    { id: 'path', name: '길 만들기', icon: 'gi-path', unit: '점', time: 0,
      meas: '경로 계획 · 공간',
      modes: [
        { key: 'practice', label: '연습', sub: '12문항 · 틀리면 정답 배치 공개' },
        { key: 'real', label: '실전 흐름', sub: '48문항 · 최대 5분 · 클릭 20' }
      ],
      rules: ['차량은 <b>직진</b>하고, 울타리(/ 또는 \\)를 만나면 <b>90도 꺾입니다.</b>',
        '칸을 누르면 없음 → / → \\ 순서로 바뀝니다. 누를 때마다 클릭(최대 20)이 차감됩니다.',
        '같은 색 손님에게 닿게 만든 뒤 제출하세요. 정답 울타리 수에 맞게 최소로 설치하는 게 좋습니다.'],
      tips: ['차량에서 손님까지 길을 눈으로 먼저 그리고, 꺾이는 자리에만 울타리를 놓으세요.',
        '/ 는 오른쪽 진행을 위로, \\ 는 아래로 꺾습니다 — 헷갈리면 연습에서 하나 놓고 제출해 확인하세요.'],
      start: gamePath },
    { id: 'rotate', name: '도형 회전', icon: 'gi-rotate', unit: '점', time: 0,
      meas: '심적 회전 · 계획',
      modes: [
        { key: 'practice', label: '연습 · 글자', sub: '10문항 · 제출 후 정답 순서 공개' },
        { key: 'pattern', label: '연습 · 무늬', sub: '10문항' },
        { key: 'real', label: '실전 흐름', sub: '글자 3분 → 무늬 3분 · 클릭 20' }
      ],
      rules: ['전 모양을 회전·반전시켜 <b>후 모양과 똑같이 만드는 순서</b>를 입력하세요.',
        '회전은 한 번에 <b>45도</b>입니다(90도 아님). 좌우반전·상하반전도 있습니다.',
        '버튼을 눌러도 <b>모양은 바뀌지 않습니다</b> — 머릿속으로 돌려 보고 순서(최대 8단계)를 넣으세요. 지움·초기화도 클릭(20)을 소모합니다.'],
      tips: ['글자의 튀어나온 획 하나를 정해 그것만 따라 돌리면 전체를 상상하는 것보다 빠릅니다.',
        '45도 두 번이 90도입니다 — 후 모양이 비스듬하면 홀수 번, 반듯하면 짝수 번 돌린 것입니다.'],
      start: gameRotate },
    { id: 'yaksok', name: '약속 정하기', icon: 'gi-yaksok', unit: '점', time: 0,
      meas: '순간 기억 · 규칙 전환',
      modes: [
        { key: 'practice', label: '연습', sub: '4라운드 × 3문항 · 정답 공개' },
        { key: 'real', label: '실전 흐름', sub: '4라운드 × 10문항 · 6번째부터 기억 4개' }
      ],
      rules: ['세 친구의 선호가 <b>각자 1초씩</b> 빠르게 지나갑니다. 기억했다가 질문에 답하세요.',
        '요일·장소·메뉴 라운드는 <b>모두가 공통으로</b> 고른 것, 마지막 버스 라운드는 반대로 <b>아무도 안 탄 번호</b>를 고릅니다.',
        '답변 제한은 문항당 3초입니다.'],
      tips: ['세 명의 목록을 다 외우려 하지 말고, 첫 친구 것을 기준으로 겹치는 것만 남기며 지워 나가세요.',
        '버스 라운드는 규칙이 뒤집힙니다 — 라운드 안내를 놓치면 아는 문제도 틀립니다.'],
      parts: [{ key: 'day', label: '요일만' }, { key: 'place', label: '장소만' }, { key: 'menu', label: '메뉴만' }, { key: 'bus', label: '버스만' }],
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
      parts: [{ key: 'p1', label: '1라운드만' }, { key: 'p2', label: '2라운드만' }],
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
