/* ── 블라인드 퀴즈 '당신이 면접관이라면?' — 자기 주입 공용 컴포넌트 (2026-07-29) ──
   index.html 홈 섹션(#blind-quiz)에서 이사. 퀴즈 재료(전·후 녹음)가 전부 보신각·스피닝
   클립이라, 그 두 상세 페이지(challenge-voice.html·challenge-spinning.html)에 싣는 것이
   맞다(오너 확정 — 허브·홈이 아니라 "보신각, 스피닝 이런 쪽").
   사용법: 페이지에 <div id="blind-quiz-mount"></div> 를 두고 이 파일을 defer 로 로드.
   ⚠️ 스타일·마크업·로직이 이 한 파일에 있다 — 고칠 일이 생기면 여기 한 곳만 고친다
      (application-modal.js와 같은 자기 주입 패턴, 마크업 두 벌 복사 금지).
   ⚠️ 클래스는 전부 bq- 네임스페이스 — 상세 페이지의 .section-label/.btn과 충돌하지 않게
      헤더·버튼도 자체 클래스(.bq-label/.bq-title/.bq-btn)를 쓴다. tokens.css 변수에만 의존. */
(function () {
  'use strict';
  var mount = document.getElementById('blind-quiz-mount');
  if (!mount) return;

  /* ── 스타일 — index.css 시절 .bq-* 블록 그대로 + 자체 헤더·버튼 ── */
  var css = `
.bq-section { padding: 60px 0; background: var(--bg-dark); }
.bq-wrap { max-width: 800px; margin: 0 auto; padding: 0 20px; }
.bq-head { text-align: center; max-width: 520px; margin: 0 auto 40px; }
.bq-label {
  display: inline-flex; align-items: center; gap: 9px;
  font-size: 12px; font-weight: 800; letter-spacing: 2.5px; text-transform: uppercase;
  color: var(--action-on-dark); margin-bottom: 10px;
}
.bq-label::before { content: ''; width: 26px; height: 1.5px; background: var(--action-on-dark); flex: none; }
.bq-title {
  font-family: var(--serif); font-weight: 800;
  font-size: var(--fs-h2); line-height: 1.28; letter-spacing: -0.01em;
  color: var(--action-on-dark); margin-bottom: 14px; word-break: keep-all;
}
.bq-desc { font-size: var(--fs-body, 17px); color: rgba(245,241,232,.6); line-height: 1.7; }
.bq-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  background: #FFFFFF; color: var(--accent-ink); border: none; cursor: pointer;
  border-radius: 14px; padding: 16px 28px; font-size: 15px; font-weight: 700;
  font-family: inherit; text-decoration: none; box-shadow: var(--shadow-action);
  transition: background .2s, transform .2s; -webkit-tap-highlight-color: transparent;
}
.bq-btn:hover { background: var(--action-hover); transform: translateY(-2px); }
.bq-btn:active { transform: translateY(0) scale(.99); }
.bq-btn:focus-visible { outline: 3px solid var(--action-on-dark); outline-offset: 3px; }
.bq-stage {
  max-width: 520px; margin: 0 auto;
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  overflow: hidden;
  word-break: keep-all;
}
/* .bq-intro/.bq-reveal/.bq-result의 display:flex가 UA [hidden]과 동일 특이도로 이기므로 명시 차단 */
.bq-stage [hidden] { display: none !important; }
.bq-intro { position: relative; min-height: 460px; display: flex; align-items: flex-end; }
.bq-intro-media { position: absolute; inset: 0; overflow: hidden; }
.bq-intro-media img {
  width: 100%; height: 100%; object-fit: cover; object-position: 50% 30%;
  transform-origin: 50% 35%;
  animation: bq-kenburns 16s ease-in-out infinite alternate;
}
@keyframes bq-kenburns { from { transform: scale(1); } to { transform: scale(1.12) translateX(-2%); } }
.bq-intro::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(to bottom, rgba(15,14,20,.1) 0%, rgba(15,14,20,0) 30%, rgba(15,14,20,.55) 62%, rgba(12,11,16,.9) 100%);
}
.bq-intro-overlay {
  position: relative; z-index: 1; width: 100%;
  padding: 28px 24px;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  text-align: center; color: #fff;
}
.bq-intro-title { font-size: clamp(24px, 6.4vw, 30px); font-weight: 900; line-height: 1.3; color: #fff; }
.bq-intro-meta { font-size: 12.5px; font-weight: 700; color: rgba(255,255,255,.66); }
.bq-start-btn { min-height: 52px; padding: 14px 36px; font-size: 16px; font-weight: 800; margin-top: 4px; }
.bq-scene { position: relative; aspect-ratio: 16 / 9; background: #131722; }
.bq-scene video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.bq-scene::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(to bottom, rgba(10,12,18,.45) 0%, rgba(10,12,18,0) 34%, rgba(10,12,18,0) 62%, rgba(10,12,18,.5) 100%);
}
.bq-scene-top {
  position: absolute; z-index: 1; top: 12px; left: 14px; right: 14px;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
.bq-scene-badge {
  font-size: 11.5px; font-weight: 800; color: #F3EFE7;
  background: rgba(16,18,26,.62); border: 1px solid rgba(255,255,255,.18);
  padding: 4px 11px; border-radius: 99px;
  display: inline-flex; align-items: center; gap: 6px;
}
.bq-scene-badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--action-on-dark); }
.bq-scene-badge.is-live::before { animation: bq-blink 1.1s ease-in-out infinite; }
@keyframes bq-blink { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
.bq-dots { display: inline-flex; gap: 5px; flex: 0 0 auto; }
.bq-dots i { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,.35); }
.bq-dots i.on { background: var(--action-on-dark); }
.bq-scene-tag {
  position: absolute; z-index: 1; left: 14px; bottom: 12px;
  font-size: 11.5px; font-weight: 800; color: #F3EFE7;
  background: rgba(25,65,146,.72); padding: 4px 11px; border-radius: 99px;
}
.bq-console { padding: 18px 18px 22px; }
.bq-round-num { font-size: 12px; font-weight: 800; color: rgba(245,241,232,.72); letter-spacing: .04em; margin-bottom: 10px; }
.bq-clips { display: flex; flex-direction: column; gap: 10px; }
.bq-clip {
  display: flex; align-items: center; gap: 12px;
  width: 100%; min-height: 64px;
  padding: 12px 14px;
  background: var(--surface2);
  border: 1.5px solid var(--border-soft);
  border-radius: var(--radius-sm);
  cursor: pointer; text-align: left;
  transition: border-color .2s, background .2s;
  -webkit-tap-highlight-color: transparent;
  font-family: inherit; color: inherit;
}
.bq-clip.playing { border-color: var(--accent); background: var(--accent-tint); }
.bq-clip-play {
  width: 40px; height: 40px; flex: 0 0 auto; border-radius: 50%;
  background: var(--accent-ink); color: #fff;
  display: flex; align-items: center; justify-content: center;
}
.bq-clip-info { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.bq-clip-name { font-size: 15px; font-weight: 800; color: var(--text); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bq-clip-check { font-size: 11.5px; font-weight: 700; color: var(--accent-ink); }
.bq-clip-badge { font-size: 11px; font-weight: 800; border-radius: 99px; padding: 2px 9px; }
.bq-clip-badge.is-before { background: rgba(36,26,18,.1); color: var(--primary); }
.bq-clip-badge.is-after { background: var(--action); color: var(--action-ink); }
.bq-eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; }
.bq-eq i { width: 3px; height: 30%; border-radius: 2px; background: var(--accent); opacity: .35; }
.bq-clip.playing .bq-eq i { opacity: 1; background: var(--action); animation: bq-eq .7s ease-in-out infinite alternate; }
.bq-clip.playing .bq-eq i:nth-child(2) { animation-delay: .12s; }
.bq-clip.playing .bq-eq i:nth-child(3) { animation-delay: .24s; }
.bq-clip.playing .bq-eq i:nth-child(4) { animation-delay: .36s; }
@keyframes bq-eq { from { height: 25%; } to { height: 100%; } }
.bq-clip-bar { display: block; height: 4px; border-radius: 99px; background: rgba(38,34,28,.12); overflow: hidden; }
.bq-clip-fill { display: block; height: 100%; width: 0%; background: var(--accent-dark); border-radius: 99px; transition: width .1s linear; }
.bq-question { margin-top: 20px; text-align: center; }
.bq-q-text { font-size: 15px; font-weight: 700; color: var(--text-muted); margin-bottom: 12px; }
.bq-q-text strong { color: var(--text); }
.bq-answers { display: flex; gap: 10px; }
.bq-answer-btn {
  flex: 1; min-height: 52px;
  border-radius: 99px;
  border: 2px solid var(--accent-ink);
  background: var(--surface); color: var(--accent-ink);
  font-size: 15px; font-weight: 800; cursor: pointer;
  font-family: inherit;
  transition: background .2s, opacity .2s;
  -webkit-tap-highlight-color: transparent;
}
.bq-answer-btn:disabled { opacity: .35; cursor: default; border-color: var(--border); color: var(--text-dim); }
.bq-answer-btn:not(:disabled):hover, .bq-answer-btn:not(:disabled):active { background: var(--accent-tint); }
.bq-reveal { margin-top: 20px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.bq-verdict { font-size: 20px; font-weight: 900; color: var(--accent-dark); }
.bq-verdict.is-miss { color: var(--primary); }
.bq-explain { font-size: 14px; color: var(--text-muted); line-height: 1.7; }
.bq-explain strong { color: var(--text); }
.bq-next-btn { min-height: 48px; padding: 12px 32px; font-size: 15px; font-weight: 800; margin-top: 4px; }
.bq-result { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 32px 24px; }
.bq-score-big { font-size: clamp(24px, 6vw, 32px); font-weight: 900; color: var(--text); line-height: 1.3; }
.bq-score-big strong { color: var(--action); }
.bq-result-msg { font-size: 14.5px; color: var(--text-muted); line-height: 1.7; }
.bq-cta { min-height: 52px; padding: 15px 32px; font-size: 16px; font-weight: 800; margin-top: 6px; }
.bq-retry {
  background: none; border: none; cursor: pointer;
  font-size: 13.5px; font-weight: 700; color: var(--text-dim); font-family: inherit;
  text-decoration: underline; text-underline-offset: 3px;
  padding: 8px; -webkit-tap-highlight-color: transparent;
}
@media (prefers-reduced-motion: reduce) {
  .bq-intro-media img,
  .bq-scene-badge.is-live::before,
  .bq-clip.playing .bq-eq i { animation: none; }
}
@media (max-width: 768px) {
  .bq-section { padding: var(--section-y-mobile, 52px) 0; }
  .bq-intro { min-height: 420px; }
  .bq-console { padding: 16px 14px 20px; }
}
`;

  /* ── 마크업 — index.html 시절 그대로(헤더·버튼만 bq- 네임스페이스) ── */
  var html = `
<section class="bq-section" id="blind-quiz">
  <div class="bq-wrap">
    <div class="bq-head">
      <div class="bq-label">Blind Test</div>
      <h2 class="bq-title">당신이 면접관이라면?</h2>
      <p class="bq-desc">면접관의 귀로 직접 판정해 보세요.</p>
    </div>
    <div class="bq-stage">

      <!-- 인트로: 면접장 입장 -->
      <div class="bq-intro" id="bq-intro">
        <div class="bq-intro-media">
          <img src="images/bq-intro.jpg" alt="네 명의 면접관 앞에 앉은 승무원 지원자" loading="lazy" decoding="async">
        </div>
        <div class="bq-intro-overlay">
          <h3 class="bq-intro-title">오늘, 당신이<br>면접관입니다</h3>
          <div class="bq-intro-meta">🎧 약 1분 · 이어폰 권장</div>
          <button class="bq-btn bq-start-btn" id="bq-start" type="button">판정 시작하기</button>
        </div>
      </div>

      <!-- 라운드: 실루엣 영상 씬 + 판정 콘솔 -->
      <div class="bq-round" id="bq-round" hidden>
        <div class="bq-scene">
          <video id="bq-video" src="video/bq-candidate.mp4" muted loop playsinline preload="none" aria-hidden="true"></video>
          <div class="bq-scene-top">
            <span class="bq-scene-badge" id="bq-scene-badge">블라인드 심사 중</span>
            <span class="bq-dots" id="bq-dots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
          </div>
          <span class="bq-scene-tag" id="bq-round-tag">보신각 · 목소리</span>
        </div>
        <div class="bq-console">
          <div class="bq-round-num" id="bq-round-num">ROUND 1/5</div>
          <div class="bq-clips">
            <button class="bq-clip" type="button" data-slot="0">
              <span class="bq-clip-play"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg></span>
              <span class="bq-clip-info">
                <span class="bq-clip-name">지원자 A <span class="bq-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="bq-clip-badge" hidden></span><span class="bq-clip-check" hidden>✓ 들었어요</span></span>
                <span class="bq-clip-bar"><span class="bq-clip-fill"></span></span>
              </span>
            </button>
            <button class="bq-clip" type="button" data-slot="1">
              <span class="bq-clip-play"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg></span>
              <span class="bq-clip-info">
                <span class="bq-clip-name">지원자 B <span class="bq-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="bq-clip-badge" hidden></span><span class="bq-clip-check" hidden>✓ 들었어요</span></span>
                <span class="bq-clip-bar"><span class="bq-clip-fill"></span></span>
              </span>
            </button>
          </div>
          <div class="bq-question" id="bq-question">
            <p class="bq-q-text" id="bq-q-text">두 목소리를 모두 들어보세요</p>
            <div class="bq-answers">
              <button class="bq-answer-btn" type="button" data-slot="0" disabled>지원자 A</button>
              <button class="bq-answer-btn" type="button" data-slot="1" disabled>지원자 B</button>
            </div>
          </div>
          <div class="bq-reveal" id="bq-reveal" hidden>
            <div class="bq-verdict" id="bq-verdict"></div>
            <p class="bq-explain" id="bq-explain"></p>
            <button class="bq-btn bq-next-btn" id="bq-next" type="button">다음 라운드 →</button>
          </div>
        </div>
      </div>

      <!-- 최종 결과 -->
      <div class="bq-result" id="bq-result" hidden>
        <div class="bq-score-big" id="bq-score-big"></div>
        <p class="bq-result-msg" id="bq-result-msg"></p>
        <button class="bq-btn bq-cta" type="button" onclick="location.href='apply.html'">나도 2주 뒤, 통과되는 목소리 만들기</button>
        <button class="bq-retry" id="bq-retry" type="button">다시 판정하기</button>
      </div>

    </div>
  </div>
</section>
`;

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  mount.innerHTML = html;

  /* ── 로직 — index.html 시절 그대로 ── */
  var card = mount.querySelector('.bq-stage');
  if (!card) return;

  // 전/후 음원 풀 — 보신각(mp3) 7쌍 + 스피닝(m4a) 4쌍. 매 판마다 보신각 3 + 스피닝 2 랜덤 추출
  var POOL_VOICE = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(function (k) {
    return { tag: '보신각 · 목소리', before: 'audio/challenger-' + k + '-before.mp3', after: 'audio/challenger-' + k + '-after.mp3' };
  });
  var POOL_SPIN = ['a', 'b', 'c', 'd'].map(function (k) {
    return { tag: '스피닝 · 말하기', before: 'audio/spinning-' + k + '-before.m4a', after: 'audio/spinning-' + k + '-after.m4a' };
  });
  var TOTAL = 5;

  var els = {
    intro: document.getElementById('bq-intro'),
    round: document.getElementById('bq-round'),
    result: document.getElementById('bq-result'),
    roundNum: document.getElementById('bq-round-num'),
    roundTag: document.getElementById('bq-round-tag'),
    question: document.getElementById('bq-question'),
    qText: document.getElementById('bq-q-text'),
    reveal: document.getElementById('bq-reveal'),
    verdict: document.getElementById('bq-verdict'),
    explain: document.getElementById('bq-explain'),
    next: document.getElementById('bq-next'),
    scoreBig: document.getElementById('bq-score-big'),
    resultMsg: document.getElementById('bq-result-msg'),
    video: document.getElementById('bq-video'),
    badge: document.getElementById('bq-scene-badge'),
    dots: document.getElementById('bq-dots')
  };
  var clipBtns = Array.prototype.slice.call(card.querySelectorAll('.bq-clip'));
  var answerBtns = Array.prototype.slice.call(card.querySelectorAll('.bq-answer-btn'));

  var ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

  // 모션 최소화 사용자는 영상 자동재생 금지 (정지 프레임만)
  var REDUCE_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function buzz(pattern) { // 햅틱 — 미지원 브라우저는 조용히 무시
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
  }

  function setBadge(text, live) {
    els.badge.textContent = text;
    els.badge.classList.toggle('is-live', !!live);
  }

  // 씬 동기화 — 클립이 재생 중이면 실루엣 영상 재생 + "지원자 X 답변 중" 배지
  function syncScene() {
    var playingSlot = -1;
    players.forEach(function (p, i) { if (p && !p.paused) playingSlot = i; });
    if (playingSlot >= 0) {
      setBadge('지원자 ' + (playingSlot === 0 ? 'A' : 'B') + ' 답변 중', true);
      if (els.video && !REDUCE_MOTION) els.video.play().catch(function () {});
    } else {
      setBadge('블라인드 심사 중', false);
      if (els.video) els.video.pause();
    }
  }

  var rounds = [];
  var idx = 0;
  var afterPicks = 0;     // '훈련 후'를 통과시킨 라운드 수
  var answered = false;
  var players = [null, null];
  var listened = [false, false];

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function setPlayingUI(slot, playing) {
    clipBtns[slot].classList.toggle('playing', playing);
    clipBtns[slot].querySelector('.bq-clip-play').innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    syncScene();
  }

  function stopAll() {
    players.forEach(function (p, i) {
      if (!p) return;
      p.pause();
      setPlayingUI(i, false);
    });
  }

  function markListened(slot) {
    if (listened[slot]) return;
    listened[slot] = true;
    clipBtns[slot].querySelector('.bq-clip-check').hidden = false;
    if (listened[0] && listened[1] && !answered) {
      answerBtns.forEach(function (b) { b.disabled = false; });
      els.qText.innerHTML = '당신이 면접관이라면, <strong>누구를 통과</strong>시키시겠어요?';
    }
  }

  function bindAudio(a, slot) {
    var fill = clipBtns[slot].querySelector('.bq-clip-fill');
    a.addEventListener('timeupdate', function () {
      if (a.duration) fill.style.width = (a.currentTime / a.duration * 100) + '%';
      if (a.currentTime >= 1) markListened(slot); // 1초 이상 들으면 '들었음' 처리
    });
    a.addEventListener('ended', function () {
      setPlayingUI(slot, false);
      fill.style.width = '0%';
      markListened(slot);
    });
    // 로드 실패(파일 누락 등)로 판정이 영영 막히지 않게
    a.addEventListener('error', function () { markListened(slot); });
  }

  function startRound() {
    var r = rounds[idx];
    answered = false;
    listened = [false, false];
    stopAll();
    players = r.clips.map(function (c) {
      var a = new Audio();
      a.preload = 'none'; // 탭해야 로드 — 페이지 무게 보호
      a.src = c.src;
      return a;
    });
    players.forEach(bindAudio);
    els.roundNum.textContent = 'ROUND ' + (idx + 1) + '/' + TOTAL;
    els.roundTag.textContent = r.tag;
    var dotEls = els.dots.children;
    for (var d = 0; d < dotEls.length; d++) dotEls[d].classList.toggle('on', d <= idx);
    setBadge('블라인드 심사 중', false);
    els.qText.textContent = '두 목소리를 모두 들어보세요';
    clipBtns.forEach(function (btn, i) {
      var badge = btn.querySelector('.bq-clip-badge');
      badge.hidden = true;
      badge.className = 'bq-clip-badge';
      badge.textContent = '';
      btn.querySelector('.bq-clip-check').hidden = true;
      btn.querySelector('.bq-clip-fill').style.width = '0%';
      setPlayingUI(i, false);
    });
    answerBtns.forEach(function (b) { b.disabled = true; });
    els.question.hidden = false;
    els.reveal.hidden = true;
    els.intro.hidden = true;
    els.result.hidden = true;
    els.round.hidden = false;
  }

  clipBtns.forEach(function (btn, slot) {
    btn.addEventListener('click', function () {
      var a = players[slot];
      if (!a) return;
      if (a.paused) {
        var other = players[1 - slot];
        if (other && !other.paused) { other.pause(); setPlayingUI(1 - slot, false); }
        a.play().catch(function () { markListened(slot); });
        setPlayingUI(slot, true);
      } else {
        a.pause();
        setPlayingUI(slot, false);
      }
    });
  });

  answerBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (answered) return;
      answered = true;
      stopAll();
      buzz(20);
      var r = rounds[idx];
      var pickedAfter = r.clips[+btn.dataset.slot].type === 'after';
      if (pickedAfter) afterPicks++;
      // 라벨 공개 — 다시 들으며 확인 가능
      clipBtns.forEach(function (cb, i) {
        var badge = cb.querySelector('.bq-clip-badge');
        var isAfter = r.clips[i].type === 'after';
        badge.textContent = isAfter ? '훈련 후' : '훈련 전';
        badge.classList.add(isAfter ? 'is-after' : 'is-before');
        badge.hidden = false;
      });
      els.verdict.textContent = pickedAfter ? '‘훈련 후’를 통과시키셨네요 👏' : '이번 선택은 ‘훈련 전’이었어요';
      els.verdict.classList.toggle('is-miss', !pickedAfter);
      els.explain.innerHTML = idx === 0
        ? (pickedAfter
            ? '반전 — <strong>지원자 A와 B는 같은 사람</strong>입니다. 방금 당신의 귀가 딱 14일의 차이를 골라냈어요.'
            : '반전 — <strong>지원자 A와 B는 같은 사람</strong>입니다. 라벨이 공개됐으니 다시 들어보세요. 차이가 들리기 시작할 거예요.')
        : (pickedAfter
            ? '이번에도 딱 14일의 차이를 골라내셨어요.'
            : '라벨을 알고 다시 들으면 차이가 들리기 시작할 거예요.');
      els.next.textContent = idx === TOTAL - 1 ? '판정 결과 보기' : '다음 라운드 →';
      els.question.hidden = true;
      els.reveal.hidden = false;
    });
  });

  els.next.addEventListener('click', function () {
    idx++;
    if (idx < TOTAL) { startRound(); return; }
    stopAll();
    buzz([15, 40, 15]);
    els.round.hidden = true;
    els.scoreBig.innerHTML = TOTAL + '명 중 <strong>' + afterPicks + '명</strong>, ‘훈련 후’ 통과';
    var msg;
    if (afterPicks === TOTAL) msg = '완벽한 면접관의 귀! 2주의 변화는 첫 귀에 들립니다.';
    else if (afterPicks === TOTAL - 1) msg = '면접관의 귀는 정확했어요. 2주의 변화는 이렇게 첫 귀에 증명됩니다.';
    else if (afterPicks >= 3) msg = '몇 라운드는 미묘하게 갈렸죠? 라벨을 알고 다시 들으면 차이가 확실히 들립니다.';
    else msg = '정답을 알고 다시 들으면 차이가 들리기 시작합니다. 합격은 그 미묘한 지점에서 갈려요.';
    els.resultMsg.textContent = msg;
    els.result.hidden = false;
  });

  function startQuiz() {
    idx = 0;
    afterPicks = 0;
    var picked = shuffle(POOL_VOICE).slice(0, 3).concat(shuffle(POOL_SPIN).slice(0, 2));
    rounds = shuffle(picked).map(function (p) {
      return {
        tag: p.tag,
        clips: shuffle([{ src: p.before, type: 'before' }, { src: p.after, type: 'after' }])
      };
    });
    // 첫 탭(제스처) 시점에 영상 로드 시작 — 첫 클립 재생 전까지 준비
    if (els.video && els.video.preload === 'none') { els.video.preload = 'auto'; els.video.load(); }
    startRound();
  }

  document.getElementById('bq-start').addEventListener('click', startQuiz);
  document.getElementById('bq-retry').addEventListener('click', startQuiz);
})();
