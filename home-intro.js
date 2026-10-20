/* ═══ 히어로 — MONC 조립 애니메이션 (2026-07-29) ═══
   "Moment Of New Career" 문장에서 소문자가 물러나고 M·O·N·C 가 가운데로 모여 로고가 된다.
   구 인트로의 조립 안무를 그대로 되살리되 **스크롤이 아니라 시간으로** 돌린다
   (오너: "원래 애니메이션을 쓰되 입장하면 자동으로 발동되게").

   ⚠️ 구 인트로의 뒷부분(조립 후 창 통과 줌 → 페이드아웃)은 되살릴 수 없다 —
      새 배경이 창+하늘 합본이라 확대해도 통과가 성립하지 않는다. 조립까지만 하고
      로고가 화면에 남는다. 덕분에 히어로에 브랜드가 계속 보인다.

   ⚠️ 좌표 함정(구 인트로에서 실제로 밟은 것) — 도착점은 .hi-target 의 각 글자를
      **실측**해서 얻는다. 계산으로 만들지 말 것. 그리고 자간은 letter-spacing 이 아니라
      margin 으로 줘야 getBoundingClientRect 중심이 실제 글자 중심과 일치한다.
   ⚠️ 조립이 끝나면 문장 span 을 숨기고 .hi-target 을 보여준다 — transform 으로 2.4배 키운
      글자는 래스터가 흐려진다. 이 교체를 빼면 로고가 뿌옇게 남는다.
   ⚠️ 웹폰트(SUIT)가 늦게 오면 글자 폭이 바뀐다 → document.fonts.ready 에서 재측정한다. */
(function () {
  var mid    = document.getElementById('heroMid');
  var stack  = document.querySelector('.hi-stack');
  var phrase = document.getElementById('hiPhrase');
  var target = document.getElementById('hiTarget');
  var kor    = document.getElementById('hiKor');
  var cue    = document.getElementById('heroCue');
  if (!stack || !phrase || !target) return;

  var marks  = phrase.querySelectorAll('.hi-l.is-mark');
  var others = [];
  var all = phrase.querySelectorAll('.hi-l');
  for (var i = 0; i < all.length; i++) {
    if (all[i].className.indexOf('is-mark') < 0) others.push(all[i]);
  }
  var slots = target.querySelectorAll('span');
  if (marks.length !== slots.length) return;

  /* 타임라인(초)
     ⚠️ 2026-07-30 오너 "조립을 더 부드럽고 빠르게" — 구 값(hold .6 / build 1.8 / total 3.6)에서
        조립을 0.95초로 줄였다(총 3.6→2.45초). **속도만 줄인 게 아니라 이징을 함께 바꿨다** —
        아래 ease() 주석 참조. 대칭 이징을 그대로 두고 시간만 줄이면 가운데만 빨라지고
        앞뒤의 기어가는 구간은 그대로 남아 '급해졌다'로만 읽힌다.
     ⚠️ korAt 은 buildEnd 보다 살짝 **앞**이다(로고가 착지하는 순간 한글이 이미 올라오고 있어야
        두 동작이 한 흐름으로 읽힌다). 이 관계를 뒤집지 말 것. */
  /* 2026-08-19 오너 "조립 훨씬 빠르게 속도감있게" → 곧바로 "문장 정지는 0.4초로 놔두고
     조립 속도를 지금(0.55초)으로 유지" — 정지 0.4 복원 + 압축 조립(0.55)·페이드(한글 0.3 ·
     신호 0.4)는 유지. 총 2.45 → 1.70. 정지를 다시 줄이지 말 것(오너 확정).
     ⚠️ total 은 마지막 페이드 끝(cueAt+0.4)보다 커야 한다 — frame()의 경고 주석 참조. */
  var T = { hold: 0.4, buildEnd: 0.95, korAt: 0.90, cueAt: 1.20, total: 1.70 };

  /* ⚠️ 로고를 **창 개구부에 맞춰 실측으로 키우고, 그 개구부 한가운데에 놓는다**
     (2026-07-29 오너 "창문 안에 핏하게" · 2026-07-30 "글자가 창틀 밖으로 삐져나오고 위치도 중앙이 아니다").
     CSS 만으로는 못 맞춘다 — 창의 화면 대비 폭이 세로형 38%·가로형 15.7%로 완전히 달라
     같은 vw 값이 두 경우에 전혀 다른 결과를 낸다. 게다가 배경이 object-fit:cover 라
     화면 비율에 따라 이미지가 잘리면서 창 폭도, 창의 세로 위치도 또 달라진다.
     그래서 cover 스케일을 직접 계산해 **개구부 사각형을 박스 좌표로 환산**한 뒤
     ① 로고 폭이 그 폭의 FIT 비율이 되도록 font-size 를 역산하고
     ② .hero-mid 를 그 중심에 앉힌다. CSS 의 clamp·top:50% 는 JS 가 죽었을 때의 폴백일 뿐이다.

     ⚠️⚠️ OPEN 은 **유리(개구부)** 좌표다 — 바깥 창틀이 아니다. 2026-07-30 이전 세로형 값
        (0.230~0.769)은 유리가 아니라 **창틀 바깥 테두리**를 잰 것이어서, 로고가 개구부의
        127%(실측)로 커져 M 과 C 가 창틀 위로 올라탔다. 가로형 값(0.422~0.578)만 유리였다.
        배경 이미지를 교체하면 이 네 값을 **유리 기준으로** 다시 잴 것. */
  var OPEN = {
    /* hero-window-mob.webp(853×1844) · hero-window-web.webp(1717×916) 픽셀 실측 */
    portrait:  { l: 0.3118, r: 0.6928, t: 0.3384, b: 0.6490 },
    landscape: { l: 0.4222, r: 0.5789, t: 0.2750, b: 0.7385 }
  };
  var FIT = 0.90;                       /* 개구부 폭 대비 로고 폭 — 유리 안쪽 곡선에 닿지 않을 만큼만 */
  /* 창틀+그림자 하단(사진 높이 비율 · 캔버스 픽셀 실측 2026-08-19) — 스크롤 신호가 이 아래로
     내려가야 한다(고정 bottom 은 화면 비율 따라 창틀에 올라탔다). 사진 교체 시 OPEN 처럼 재측정. */
  var FRAME_B = { portrait: 0.704, landscape: 0.807 };
  var LIFT = 0.04;                      /* 개구부 높이 대비 시각 보정 — 정중앙은 눈에 낮게 읽힌다 */
  var PAD = 16;                         /* 문장이 화면 가장자리에 붙지 않게 남기는 좌우 여백 */

  /* ⚠️ 글자 상자와 **눈에 보이는 글자**는 다르다 — M·C 는 좌우 사이드베어링이 넓고 한글은 좁아,
     상자끼리 맞추면 한글이 양쪽으로 3~4px 씩 삐져나온다(실측). 그래서 캔버스로 첫 글자·끝 글자의
     사이드베어링을 재서 **잉크 기준**으로 맞춘다. 구형 브라우저에서 measureText 확장이 없으면
     0 으로 떨어져 상자 기준(구 동작)으로 degrade 한다. */
  var _mctx = null;
  function bearings(ch, el) {
    try {
      if (!_mctx) _mctx = document.createElement('canvas').getContext('2d');
      var cs = window.getComputedStyle(el);
      _mctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      var m = _mctx.measureText(ch);
      if (typeof m.actualBoundingBoxLeft !== 'number') return null;
      return { lb: -m.actualBoundingBoxLeft, rb: m.width - m.actualBoundingBoxRight };
    } catch (e) { return null; }
  }
  /* 요소의 실제 글자 왼쪽 끝 / 오른쪽 끝(자간이 0일 때 재야 정확하다) */
  function inkEdges(first, last) {
    var a = first.getBoundingClientRect(), b = last.getBoundingClientRect();
    var ta = first.textContent, tb = last.textContent;
    var ba = bearings(ta.charAt(0), first), bb = bearings(tb.charAt(tb.length - 1), last);
    return { l: a.left + (ba ? ba.lb : 0), r: b.right - (bb ? bb.rb : 0) };
  }

  /* ⚠️ 문장은 **첫 화면에 다 보여야 한다**(2026-07-30 오너 "첫 화면이 글자가 이딴식으로
     시작하는 게 어딨냐, 화면 안에 봐야 할 거 아니야"). 두 줄로 접어 크기를 살렸지만
     기기 폭은 제각각이라 clamp 만으로는 보장이 안 된다 — 넘치면 여기서 줄여 맞춘다. */
  function fitPhrase(cw) {
    phrase.style.fontSize = '';
    var pb = parseFloat(window.getComputedStyle(phrase).fontSize);
    var pw = phrase.getBoundingClientRect().width;
    if (!pb || !pw) return;
    var avail = cw - PAD * 2;
    if (pw > avail) phrase.style.fontSize = (pb * avail / pw).toFixed(2) + 'px';
  }

  /* ⚠️ 한글 줄은 로고와 **양끝을 맞춘다**(2026-07-30 오너 "서브타이틀 메인타이틀 양쪽 글자에
     맞춰라, 혼자 툭 튀어나오잖아"). 자간을 계산해 넣고, 마지막 글자 뒤에 붙는 자간만큼은
     margin-right 로 도로 뺀다 — 안 빼면 그 여백까지 폭에 잡혀 가운데정렬이 왼쪽으로 밀린다.
     ⚠️ 한 줄이 로고보다 넓으면(실측 393px: 한글 207px vs 로고 135px) 자간이 음수가 되어
        글자가 겹친다 → 그때만 두 줄로 접는다. **글씨를 줄여 맞추는 방법은 못 쓴다** —
        9px 이 되어 9대 원칙(가독성 12pt+)에 걸린다. */
  var KOR_MIN = 12;                     /* 9대 원칙(가독성 12pt+) — 이 아래로는 줄이지 않는다 */
  /* ⚠️ 로고-한글 사이 간격은 **로고 크기에 비례**해야 한다(2026-07-30 오너 "모바일에서는
     메인과 서브 행간이 더 줄어들어야 할 것 같다, 너무 떨어져 있는데"). 구 CSS 고정 18px 은
     로고가 작아지는 모바일에서만 헐거워졌다 — 실측 시각 간격 모바일 0.94em vs 웹 0.62em.
     ⚠️ margin 은 '보이는 간격'이 아니다. 두 줄 상자 안의 빈 공간(로고 글자 아래 여백 ≈0.30em,
        한글 줄 위 반행간+윗공간 ≈0.5×글자크기)을 빼야 실제로 보이는 간격이 GAP 이 된다. */
  var GAP = 0.55;                       /* 로고 글자 크기 대비 '눈에 보이는' 간격 */
  function gapFor(logoSize) {
    var line = kor.querySelector('.hi-kl') || kor;
    var st = window.getComputedStyle(line);
    var kfs = parseFloat(st.fontSize) || 14;
    var lh = parseFloat(st.lineHeight) || kfs * 1.4;
    /* ⚠️ 행간에 따라 글자 위 빈 공간이 달라진다(한 줄 1.7 / 두 줄 1.28) — 고정 계수로 두면
       두 줄 모드에서만 간격이 벌어진다. 반행간 + 글자 윗공간(≈.15em)을 실제 값에서 뺀다. */
    var slack = (lh - kfs) / 2 + kfs * 0.15;
    return Math.max(0, logoSize * (GAP - 0.30) - slack);
  }
  function fitKor(logoInkW) {
    if (!kor) return;
    var lines = kor.querySelectorAll('.hi-kl'), i, last = null;
    if (!lines.length) return;
    for (i = 0; i < lines.length; i++) { lines[i].style.letterSpacing = ''; lines[i].style.marginRight = ''; }
    kor.classList.remove('two');
    kor.style.fontSize = '';
    last = lines[lines.length - 1];
    var chars = 0;
    for (i = 0; i < lines.length; i++) chars += lines[i].textContent.length;
    if (chars < 2) return;
    var e = inkEdges(lines[0], last), natural = e.r - e.l;
    /* ⚠️ 조금 넘칠 뿐이면 두 줄로 접지 말고 글씨를 살짝 줄여 한 줄로 맞춘다 —
       접어 버리면 반토막 난 줄을 로고 폭까지 늘리느라 자간이 1em 가까이 벌어진다
       (실측 1024px: 자간 18px). 대신 12px 밑으로는 안 줄인다. */
    if (natural > logoInkW) {
      var fs = parseFloat(window.getComputedStyle(kor).fontSize);
      var want = fs * logoInkW / natural;
      if (want >= KOR_MIN) {
        kor.style.fontSize = want.toFixed(2) + 'px';
        e = inkEdges(lines[0], last); natural = e.r - e.l;
      }
    }
    if (natural <= logoInkW) {                     /* 한 줄로 편다 */
      var ls = (logoInkW - natural) / (chars - 1);
      for (i = 0; i < lines.length; i++) lines[i].style.letterSpacing = ls.toFixed(2) + 'px';
      last.style.marginRight = (-ls).toFixed(2) + 'px';
      return;
    }
    kor.classList.add('two');                      /* 두 줄로 접고 줄마다 편다 */
    for (i = 0; i < lines.length; i++) {
      var c = lines[i].textContent.length;
      var le = inkEdges(lines[i], lines[i]);
      var l2 = c > 1 ? (logoInkW - (le.r - le.l)) / (c - 1) : 0;
      if (l2 < 0) l2 = 0;                          /* 로고보다 넓은 줄은 억지로 좁히지 않는다 */
      lines[i].style.letterSpacing = l2.toFixed(2) + 'px';
      lines[i].style.marginRight = (-l2).toFixed(2) + 'px';
    }
  }
  function fitWindow() {
    var shot = document.querySelector('.hero-shot');
    if (!shot || !shot.naturalWidth) return;
    var cw = shot.clientWidth, ch = shot.clientHeight;
    var sc = Math.max(cw / shot.naturalWidth, ch / shot.naturalHeight);
    var rw = shot.naturalWidth * sc, rh = shot.naturalHeight * sc;
    var o = shot.naturalHeight > shot.naturalWidth ? OPEN.portrait : OPEN.landscape;
    /* object-position:center 라 넘치는 쪽은 좌우(또는 위아래)로 균등하게 잘린다. */
    var ox = (cw - rw) / 2, oy = (ch - rh) / 2;
    var winW = rw * (o.r - o.l);
    target.style.fontSize = '';
    var base = parseFloat(window.getComputedStyle(target).fontSize);
    var cur = target.getBoundingClientRect().width;
    if (!base || !cur) return;
    var size = base * (winW * FIT) / cur;
    target.style.fontSize = size.toFixed(2) + 'px';
    /* 무대 높이도 로고에 맞춘다 — 안 맞추면 커진 로고가 아래 한글 줄과 겹친다. */
    stack.style.height = (size * 1.2).toFixed(1) + 'px';
    /* ⚠️ 순서가 있다 — 로고 폭이 확정된 뒤에 한글 줄을 그 폭에 맞추고, 한글 줄 수가
       정해진 뒤에야 덩어리 높이(korH)를 읽어 세로 중심을 잡을 수 있다. */
    fitPhrase(cw);
    var li = inkEdges(slots[0], slots[slots.length - 1]);
    fitKor(li.r - li.l);
    if (kor) kor.style.marginTop = gapFor(size).toFixed(1) + 'px';
    if (!mid) return;
    /* ⚠️⚠️ 세로 기준은 **로고 + 한글 줄을 합친 덩어리**다 — 로고 하나가 아니다
       (2026-07-30 오너 "아직도 창문 아래쪽에 있잖아").
       한글 줄은 흐름 밖(top:100%)이라 .hero-mid 높이에 안 잡혀서, 로고만 개구부 정중앙에
       두면 그 아래에 한글 42px 이 더 붙어 **덩어리 전체가 아래로 쏠린다.** 그만큼(절반) 뺀다.
       ⚠️ 여기에 개구부 높이의 LIFT 만큼 더 올린다 — 기하학적 정중앙은 눈에 낮게 읽힌다
          (본문 위쪽이 짙은 하늘, 아래쪽이 흰 구름이라 아래가 비어 보이는 것도 겹친다).
          네 자리(0 / 덩어리중앙 / +4% / +7%)를 실제로 렌더해 비교한 결과가 이 값이다. */
    var korH = kor ? kor.offsetHeight + (parseFloat(window.getComputedStyle(kor).marginTop) || 0) : 0;
    var openH = rh * (o.b - o.t);
    mid.style.top = (oy + rh * (o.t + o.b) / 2 - korH / 2 - openH * LIFT).toFixed(1) + 'px';
    /* 가로 중심도 화면 정중앙이 아니라 개구부 중심이다(이미지상 창이 2px 오른쪽에 그려져 있다). */
    mid.style.transform = 'translate(' + (ox + rw * (o.l + o.r) / 2 - cw / 2).toFixed(1) + 'px, -50%)';
    /* ── 시작 버튼 폭 상한 = 유리 실측 폭(2026-08-19 오너 "창문 안에 이쁘게 들어가게") ──
       구 280px 고정폭은 유리(모바일 ~150px)의 두 배라 창을 뚫고 나갔다. 로고(FIT)와 같은
       기준으로 유리 폭을 CSS 변수로 내려 버튼이 창 안에 앉는다. */
    mid.style.setProperty('--glass-w', winW.toFixed(1) + 'px');
    /* ── 신호를 창틀 아래로(2026-08-19 오너 "아직도 스크롤 문구 창문에 있다") ──
       고정 bottom:34 는 인앱처럼 세로가 짧은 화면에서 창틀(FRAME_B)에 올라탄다. 창틀 하단
       +8px 아래로 실측 배치하고, 그래도 자리가 없으면 cue-tight 로 세 조각 사이 여백만
       30px 줄인다(세 조각 한 벌은 유지 — 그 아래 한계 화면은 최소 6px 로 최선). */
    if (cue) {
      var fb = oy + rh * (shot.naturalHeight > shot.naturalWidth ? FRAME_B.portrait : FRAME_B.landscape);
      var vh = window.innerHeight || document.documentElement.clientHeight || 0;
      cue.classList.remove('cue-tight');
      var room = vh - fb - cue.offsetHeight - 8;
      if (room < 8) { cue.classList.add('cue-tight'); room = vh - fb - cue.offsetHeight - 8; }
      cue.style.setProperty('--cue-lift', Math.max(6, Math.min(34, room)).toFixed(1) + 'px');
    }
  }   /* ⚠️ T.total 은 마지막 페이드(cueAt + 0.4 = 1.60)보다 커야 한다 — 모자라면 스크롤 신호가
         중간 투명도에서 얼어붙는다(구 3.4 로 뒀을 때 0.83 에서 멈춘 실사고). 타임라인을 또 줄이면
         total 을 마지막 페이드 종료보다 뒤에 두는지 먼저 확인할 것(현재 1.70 > 1.60). */
  var geo = null;
  /* 프레임마다 같은 값을 다시 쓰지 않기 위한 캐시 — apply() 참조. */
  var lastFade = -1, lastDone = null;

  function measure() {
    /* transform 이 걸린 채로 재면 값이 오염된다 — 항상 초기화 후 잰다. */
    for (var i = 0; i < all.length; i++) { all[i].style.transform = ''; }
    /* ⚠️ 여기서 transform 을 지웠으니 캐시도 함께 버려야 한다 — 안 버리면 폰트 도착·리사이즈로
       재측정된 뒤 '값이 같다'며 다시 쓰지 않아 소문자가 원위치에 불투명하게 되살아난다. */
    lastFade = -1;
    fitWindow();                         /* 도착점을 재기 전에 로고 크기·자리부터 확정 */
    var g = { marks: [], scale: 1 };
    var pm = marks[0].getBoundingClientRect(), tm = slots[0].getBoundingClientRect();
    g.scale = pm.width > 0 ? (tm.width / pm.width) : 1;
    for (var k = 0; k < marks.length; k++) {
      var a = marks[k].getBoundingClientRect(), b = slots[k].getBoundingClientRect();
      g.marks.push({
        dx: (b.left + b.width / 2) - (a.left + a.width / 2),
        dy: (b.top + b.height / 2) - (a.top + a.height / 2)
      });
    }
    geo = g;
  }

  var cl = function (v) { return v < 0 ? 0 : (v > 1 ? 1 : v); };
  /* easeOutCubic — 바로 출발해서 길게 미끄러져 착지한다(2026-07-30 오너 "더 부드럽고 빠르게").
     ⚠️ 구 easeInOutCubic(대칭)으로 되돌리지 말 것 — 그게 '느리다'의 원인이었다.
        대칭 곡선은 정지 상태에서 **속도 0으로 출발**해 앞의 20%를 기어가고(1.8초 중 360ms 동안
        고작 3% 이동) 끝에서도 같은 만큼 기어서, 실제 이동은 가운데 짧은 구간에 몰린다.
        시간만 줄이면 그 가운데 구간만 빨라져 '휙 지나갔는데 여전히 늑장'이 된다.
     지금 곡선은 첫 100ms 에 27%, 절반 시점에 88% 를 이동한 뒤 남은 12% 를 길게 흘려 착지한다 —
     '빠르게 모였다가 부드럽게 내려앉는' 느낌이 여기서 나온다. 도착 속도는 0 이라 '툭' 끝나지 않는다. */
  function ease(t) { return 1 - Math.pow(1 - t, 3); }

  function apply(u) {
    if (!geo) return;
    var e = ease(u);
    var s = 1 + (geo.scale - 1) * e;
    for (var k = 0; k < marks.length; k++) {
      var m = geo.marks[k];
      marks[k].style.transform = 'translate(' + (m.dx * e).toFixed(2) + 'px,'
                               + (m.dy * e).toFixed(2) + 'px) scale(' + s.toFixed(4) + ')';
    }
    /* 소문자는 대문자가 떠나는 만큼 물러난다 — 끝까지 남아 있으면 로고 위에 겹친다.
       ⚠️ 기준이 **시간(u)이 아니라 이동량(e)** 인 것이 핵심이다. 시간 기준으로 두면 이징을
          바꿀 때마다 관계가 어긋난다 — 지금처럼 앞이 빠른 곡선에서는 대문자가 이미 날아간
          뒤에도 소문자가 제자리에 남아 겹쳐 보인다(구 u/0.55 를 그대로 두면 실제로 그렇게 된다).
          0.64 = 구 동작에서 소문자가 완전히 사라지던 시점의 이동량이다(대문자가 64% 갔을 때).
       ⚠️ 페이드가 끝난 뒤에도 매 프레임 같은 값을 17개 글자에 다시 쓰던 것을 막는다 —
          값이 바뀔 때만 쓴다(저사양 폰에서 조립 구간 프레임이 흔들리던 자리). */
    var fade = cl(e / 0.64);
    if (fade !== lastFade) {
      lastFade = fade;
      for (var j = 0; j < others.length; j++) {
        others[j].style.opacity = (1 - fade).toFixed(3);
        others[j].style.transform = 'scale(' + (1 - 0.25 * fade).toFixed(3) + ')';
      }
    }
    /* 마지막에 네이티브 렌더로 교체(확대 래스터 흐림 방지)
       ⚠️ 바뀔 때만 쓴다 — .hi-phrase 는 자식이 21개라, 매 프레임 visibility 를 쓰면
          그 서브트리 스타일 재계산이 매번 걸린다(조립 구간에서 가장 비싼 한 줄이었다). */
    var done = u > 0.995;
    if (done !== lastDone) {
      lastDone = done;
      target.style.visibility = done ? 'visible' : 'hidden';
      phrase.style.visibility = done ? 'hidden' : 'visible';
    }
  }

  function frame(sec) {
    apply(cl((sec - T.hold) / (T.buildEnd - T.hold)));
    if (kor) {
      var kt = cl((sec - T.korAt) / 0.3);   /* 0.45→0.3 — 2026-08-19 속도감 압축(T 주석 참조) */
      kor.style.opacity = kt.toFixed(3);
      kor.style.transform = 'translateY(' + ((1 - kt) * 7).toFixed(1) + 'px)';
    }
    if (cue) cue.style.opacity = cl((sec - T.cueAt) / 0.4).toFixed(3);   /* 0.5→0.4 — 같은 압축 */
  }

  function markSeen() { try { localStorage.setItem('monc_intro_seen', '1'); } catch (e) {} }

  /* 스크롤이 시작되면 안내를 숨긴다(2026-07-30 오너 지시) — 안 그러면 다음 섹션까지
     화살표가 따라다니며 계속 "내려라"라고 말한다(이미 내리고 있는 사람에게).
     ⚠️ 클래스로 토글하는 이유: 위 frame()이 인라인 style.opacity 를 매 프레임 덮어쓰므로
        인라인으로 숨기면 재생 중엔 바로 되살아난다. CSS 의 !important 가 인라인을 이긴다.
     ⚠️ 맨 위로 돌아오면 다시 보여준다 — 히어로를 다시 보고 있는데 신호만 없으면
        처음 온 사람과 다른 화면이 된다. 24px 는 모바일 바운스에 안 걸리는 최소치. */
  if (cue) {
    var gone = null, cueTick = false;
    var syncCue = function () {
      cueTick = false;
      var hide = (window.pageYOffset || document.documentElement.scrollTop || 0) > 24;
      if (gone === hide) return;      // 매 프레임 클래스 재기록 방지
      gone = hide;
      cue.classList.toggle('is-gone', hide);
    };
    window.addEventListener('scroll', function () {
      if (!cueTick) { cueTick = true; requestAnimationFrame(syncCue); }
    }, { passive: true });
    syncCue();   /* 새로고침 복원으로 이미 내려가 있는 상태에서 열릴 수 있다 */
  }

  measure();

  var running = true;
  /* 재생이 끝난 뒤엔 도착 좌표(FLIP)는 쓸모없지만 **로고 크기·자리는 계속 맞춰야 한다** —
     회전하면 배경 이미지가 세로형↔가로형으로 바뀌면서 창 위치와 폭이 통째로 달라진다. */
  var refit = function () { if (running) measure(); else fitWindow(); };
  var shot = document.querySelector('.hero-shot');
  /* ⚠️ 이미지가 오기 전엔 naturalWidth 가 0이라 창을 못 잰다 → 로드(=소스 교체 포함) 후 반드시 재측정. */
  if (shot) shot.addEventListener('load', refit);

  /* ⚠️ reduced-motion 이면 조립을 건너뛰고 '완성된 로고' 상태로 둔다.
     아무것도 안 하면 문장만 남아 브랜드 로고를 못 보게 된다. */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    running = false; frame(T.total); markSeen();
  } else {
    var t0 = 0;
    var tick = function (now) {
      if (!t0) t0 = now;
      var sec = (now - t0) / 1000;
      frame(sec);
      if (sec < T.total) { requestAnimationFrame(tick); }
      else { running = false; frame(T.total); markSeen(); }
    };
    var started = false;
    var start = function () { if (started) return; started = true; frame(0); requestAnimationFrame(tick); };
    if (shot && !shot.complete) {
      shot.addEventListener('load', start);
      shot.addEventListener('error', start);
      setTimeout(start, 1200);
    } else { start(); }

    /* 폰트가 늦게 오면 글자 폭이 바뀐다 → 아직 재생 중이면 좌표를 다시 잡는다. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { if (running) measure(); });
    }
  }

  /* 화면이 바뀌면 창의 폭·자리가 바뀐다 → 재생 중이면 도착점까지, 끝난 뒤엔 크기·자리만 다시 잡는다. */
  window.addEventListener('resize', refit, { passive: true });
})();
