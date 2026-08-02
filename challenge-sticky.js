/* ══════════════════════════════════════════════════════════════════════════
   챌린지 상세 4종 공용 — 하단 가격·신청 바 + 코치진 소개 (2026-08-02 신설)

   왜 만들었나(진단 A-3): challenge-voice/expression/spinning/answer 네 파일에
   **가격이 0회 등장**했다. 학생은 커리큘럼 10일치와 전후 음성 7쌍을 다 듣고도
   금액을 모르고 apply.html 에 가서야 3만원을 처음 봤다. 버튼 공백도 컸다 —
   보신각은 문서 9,669px 인데 y655~y9206 (8,551px · 10.5화면) 사이에 누를 것이 없었다.
   신뢰 근거도 비어 있었다: 담당 코치 이력이 apply.html 에만 있고, 학생이 결심하는
   화면에는 없었다(후기 섹션은 0건이면 통째로 사라지므로 그 기수엔 아무것도 안 남는다).

   쓰는 법 — 상세 페이지에 한 줄:
       <script src="challenge-sticky.js" defer></script>
   챌린지 id 는 <body data-challenge="voice"> 에서 읽는다.

   ⚠️⚠️ 금액은 **반드시 site_config.challenge_price 를 읽어 그린다.** 홈에 3만원을
      글자로 박아 두고 DB 를 33,000원으로 올려 광고가와 청구가가 어긋난 사고 기록이 있다.
      조회 실패 시엔 금액을 **아무 숫자도 쓰지 않고** 비운다 — 틀린 금액보다 없는 편이 낫다.
   ⚠️ 챌린지 **허브**(challenges.html)에는 신청 CTA 를 넣지 않는다(오너 확정 · home.md).
      이 파일은 상세 4종 전용이다.
   ⚠️ 특강 카드 커버의 가격 배지는 폐기 확정이다(lectures.md) — 그것과 다른 물건이다.
      여기는 '상세 하단 고정 바'로, lecture.html 의 .lc-sticky 와 같은 계열이다.
   ⚠️ 코치는 **챌린지별로 누가 가르치는지 배정하지 않는다.** 그 정보를 코드가 모르는데
      추측해서 이름을 붙이면 허위 표시가 된다. 지금은 apply.html 이 이미 쓰고 있는 사실
      ('전직 승무원·전문 코치진')만 말하고 연구진 페이지로 보낸다.
      오너가 챌린지별 담당을 확정해 주면 그때 이 파일에서 갈라 쓴다.
   ⚠️ 현형빈은 챌린지 미지도라 코치 줄에서 뺀다(pages.md).
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CH = (document.body && document.body.dataset && document.body.dataset.challenge) || '';
  if (!CH) return;

  var NAME = {
    voice: '보.신.각', expression: '영.합.각', spinning: '스.피.닝', answer: '승.자.각'
  }[CH] || '챌린지';

  /* 챌린지를 지도하지 않는 연구원은 뺀다(pages.md — '연구진 전원 = 챌린지 코치'가 아니다) */
  var NON_COACH = { hyun: 1 };

  /* ── 스타일 (이 파일이 주입 — 상세 4종 인라인 CSS 에 복사하지 말 것) ── */
  if (!document.getElementById('chStickyCss')) {
    var st = document.createElement('style');
    st.id = 'chStickyCss';
    st.textContent = [
      /* 하단 고정 바 — lecture.html .lc-sticky 와 같은 문법(높이·활자·알약 CTA) */
      '.ch-sticky{position:fixed;left:0;right:0;bottom:0;z-index:90;',
      '  background:rgba(244,241,234,.94);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);',
      '  border-top:1px solid var(--border,rgba(38,34,28,.16));',
      '  padding:10px 16px calc(10px + env(safe-area-inset-bottom));',
      '  transform:translateY(110%);transition:transform .28s ease;}',
      '.ch-sticky.on{transform:none;}',
      '.ch-sticky-in{max-width:520px;margin:0 auto;display:flex;align-items:center;gap:14px;}',
      '.ch-sticky .info{flex:1 1 auto;min-width:0;}',
      '.ch-sticky .p{font-size:17px;font-weight:900;color:var(--text,#26221C);line-height:1.25;}',
      '.ch-sticky .p .won{font-size:13px;font-weight:800;margin-left:1px;}',
      '.ch-sticky .s{font-size:12px;color:var(--text-muted,#5C564C);line-height:1.4;',
      '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.ch-sticky .go{flex:0 0 auto;min-height:44px;padding:13px 24px;border:none;border-radius:999px;',
      '  background:var(--action,#1B3A6B);color:var(--action-ink,#fff);font-size:15px;font-weight:900;',
      '  font-family:inherit;cursor:pointer;}',
      '.ch-sticky .go:disabled{opacity:.55;cursor:not-allowed;}',
      '.ch-sticky .go:focus-visible{outline:3px solid var(--accent-dark,#142C52);outline-offset:3px;}',
      '@media (prefers-reduced-motion: reduce){.ch-sticky{transition:none;}}',

      /* 코치진 줄 — 카드가 아니라 한 덩어리. 얼굴은 작게, 사실만. */
      '.ch-coach{padding:40px 0;}',
      '.ch-coach-in{max-width:760px;margin:0 auto;padding:0 20px;}',
      '.ch-coach h2{font-size:clamp(21px,4.6vw,27px);font-weight:800;letter-spacing:-.02em;',
      '  margin:0 0 8px;color:var(--text,#26221C);}',
      '.ch-coach .lead{margin:0 0 20px;font-size:15px;line-height:1.7;color:var(--text-muted,#5C564C);}',
      '.ch-coach ul{list-style:none;margin:0 0 18px;padding:0;display:grid;gap:12px;}',
      '@media (min-width:640px){.ch-coach ul{grid-template-columns:1fr 1fr;}}',
      '.ch-coach li{display:flex;align-items:center;gap:12px;padding:12px 14px;',
      '  background:var(--surface,#fff);border:1px solid var(--border-soft,rgba(38,34,28,.10));',
      '  border-radius:14px;}',
      '.ch-coach img{width:44px;height:44px;flex:0 0 44px;border-radius:50%;object-fit:cover;',
      '  object-position:center 18%;background:var(--bg2,#FBF9F5);}',
      /* ⚠️ .nm/.po 는 span 이라 display:block 이 없으면 이름과 직함이 한 줄에 붙는다
         ("권성호보이스·스피치·표현력 전문가" — 2026-08-02 실측에서 잡음). */
      '.ch-coach .who{min-width:0;display:block;}',
      '.ch-coach .nm{display:block;font-size:15px;font-weight:800;color:var(--text,#26221C);line-height:1.35;}',
      '.ch-coach .po{display:block;margin-top:2px;font-size:12.5px;color:var(--text-muted,#5C564C);line-height:1.45;}',
      '.ch-coach .more{display:inline-flex;align-items:center;min-height:44px;font-size:14px;',
      '  font-weight:800;color:var(--accent-ink,#1B3A6B);text-decoration:underline;',
      '  text-underline-offset:3px;}'
    ].join('');
    document.head.appendChild(st);
  }

  /* ── 하단 고정 바 ─────────────────────────────────────────────────────── */
  var bar = document.createElement('div');
  bar.className = 'ch-sticky';
  bar.innerHTML =
    '<div class="ch-sticky-in">' +
      '<div class="info">' +
        '<div class="p" id="chStickyPrice">참가비 확인 중…</div>' +
        '<div class="s">' + NAME + ' · 2주 · 미션 10회차</div>' +
      '</div>' +
      '<button type="button" class="go" id="chStickyGo">신청하기</button>' +
    '</div>';
  document.body.appendChild(bar);

  /* 바가 푸터·본문 끝을 덮지 않도록 실측 높이만큼 body 를 밀어 준다.
     ⚠️ 고정값(예: 72px)을 쓰지 말 것 — 안전영역(env(safe-area-inset-bottom))이
        기기마다 달라 아이폰에서만 덜 밀리거나 더 밀린다. */
  function padBody() {
    var h = bar.offsetHeight || 0;
    document.body.style.paddingBottom = h ? (h + 'px') : '';
  }

  /* 히어로의 신청 버튼이 화면에 보이는 동안엔 바를 감춘다 — 같은 행동이 두 개
     겹쳐 보이면 어느 것을 눌러야 하는지 헷갈린다(원칙 6: 같은 행동의 반복은
     허용하되 '동시에 두 개'는 아니다). */
  var heroBtn = document.querySelector('.hero .apply-btn, .hero-inner .apply-btn') ||
                document.querySelector('.apply-btn');
  function show(on) { bar.classList.toggle('on', !!on); padBody(); }
  if (heroBtn && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { show(!e.isIntersecting); });
    }, { threshold: 0 }).observe(heroBtn);
  } else {
    show(true);
  }
  window.addEventListener('resize', padBody);

  document.getElementById('chStickyGo').addEventListener('click', function (e) {
    /* 마감·모집예정 처리(오픈 알림 시트)는 각 페이지의 handleApply 가 이미 갖고 있다.
       여기서 다시 구현하면 두 벌이 되어 어긋난다. */
    if (typeof window.handleApply === 'function') { window.handleApply(e); return; }
    window.location.href = 'apply.html?c=' + encodeURIComponent(CH);
  });

  /* ── 금액 (site_config.challenge_price) ──────────────────────────────── */
  (async function price() {
    var el = document.getElementById('chStickyPrice');
    if (!window.MONC || !window.MONC.sb) { el.textContent = '참가비 안내'; return; }
    try {
      var r = await window.MONC.sb.from('site_config').select('value').eq('key', 'challenge_price').maybeSingle();
      var v = r && r.data && r.data.value;
      var n = typeof v === 'number' ? v : parseInt(v, 10);
      if (Number.isFinite(n) && n >= 0) {
        el.innerHTML = n.toLocaleString('ko-KR') + '<span class="won">원</span>';
        return;
      }
    } catch (err) {}
    /* ⚠️ 실패해도 숫자를 지어내지 않는다 — 틀린 금액을 띄우면 광고가와 청구가가 어긋난다. */
    el.textContent = '참가비 안내';
  })();

  /* ── 모집 상태를 버튼 라벨에 반영 ────────────────────────────────────── */
  (async function status() {
    var go = document.getElementById('chStickyGo');
    if (typeof loadRecruitData !== 'function' || typeof getStatus !== 'function') return;
    var data = null;
    try { data = await loadRecruitData(); } catch (e) {}
    var d = data && data[CH];
    if (!d || !d.start || !d.end) return;    // 모르면 '신청하기' 그대로 — 막지 않는다(A-1 규칙)
    var stt = getStatus(d.start, d.end);
    if (stt === 'upcoming') go.textContent = '오픈 알림 받기';
    else if (stt === 'closed') go.textContent = '오픈 알림 받기';
  })();

  /* ── 코치진 ───────────────────────────────────────────────────────────
     후기 섹션(#chReviews) 바로 위에 넣는다 — 커리큘럼 → 코치 → 후기 → 추천 순.
     연구원 데이터는 researchers-data.js 단일 원본을 쓴다(이름·사진 복사 금지). */
  var anchor = document.getElementById('chReviews');
  var people = (window.MONC_RESEARCHERS || []).filter(function (r) { return !NON_COACH[r.id]; });
  if (anchor && people.length) {
    var sec = document.createElement('section');
    sec.className = 'ch-coach';
    sec.innerHTML =
      '<div class="ch-coach-in">' +
        '<h2>누가 지도하나요</h2>' +
        '<p class="lead">전직 객실승무원과 보이스·스피치 전문 코치진이 함께합니다. ' +
        '2주 동안 미션을 확인하고 피드백을 남기는 사람들이에요.</p>' +
        '<ul>' + people.map(function (r) {
          return '<li><img src="' + r.photo + '" alt="" loading="lazy" width="44" height="44"' +
                 (r.photoPos ? ' style="object-position:' + r.photoPos + '"' : '') + '>' +
                 '<span class="who"><span class="nm">' + r.name + '</span>' +
                 '<span class="po">' + r.position + '</span></span></li>';
        }).join('') + '</ul>' +
        '<a class="more" href="researchers.html">연구진 전체 이력 보기 →</a>' +
      '</div>';
    anchor.parentNode.insertBefore(sec, anchor);
  }
})();
