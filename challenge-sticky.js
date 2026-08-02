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
   ⚠️⚠️ **담당 코치는 오너가 확정한 배정만 쓴다**(2026-08-02 오너: 보신각=권성호,
      영합각·스피닝·승자각=박새암). 추측해서 이름을 붙이면 허위 표시다. 배정이 바뀌면
      아래 LEAD 표만 고치고, 이름·사진·직함은 researchers-data.js 에서 가져온다.
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

  /* 챌린지별 담당 코치 — 오너 확정(2026-08-02). researchers-data.js 의 id 를 쓴다.
     ⚠️ 여기 없는 챌린지는 담당을 말하지 않고 코치진 전체만 보여준다(추측 금지). */
  var LEAD = { voice: 'kwon', expression: 'park', spinning: 'park', answer: 'park' };

  /* ── 스타일 (이 파일이 주입 — 상세 4종 인라인 CSS 에 복사하지 말 것) ── */
  if (!document.getElementById('chStickyCss')) {
    var st = document.createElement('style');
    st.id = 'chStickyCss';
    st.textContent = [
      /* 하단 고정 바 — lecture.html .lc-sticky 와 같은 문법(높이·활자·알약 CTA) */
      /* ⚠️ 배경을 반투명으로 되돌리지 말 것 (2026-08-02 오너 신고) — 바 밑을 지나가는
         글자가 비쳐 **가로로 잘린 것처럼** 보인다. 불투명 + 또렷한 경계선이어야 한다. */
      '.ch-sticky{position:fixed;left:0;right:0;bottom:0;z-index:90;',
      '  background:var(--bg,#F4F1EA);',
      '  border-top:1px solid var(--border-strong,rgba(38,34,28,.52));',
      '  box-shadow:0 -6px 18px rgba(36,26,18,.10);',
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
      /* 담당 코치 한 줄만 강조 — 나머지는 조용한 행으로 남긴다(원칙 6: 강조는 하나) */
      '.ch-coach li.is-lead{border-color:var(--accent-dark,#142C52);background:var(--action-tint,#E5E9F1);}',
      '.ch-coach li.is-lead img{width:52px;height:52px;flex:0 0 52px;}',
      '.ch-coach .lead-tag{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;',
      '  background:var(--action,#1B3A6B);color:#fff;font-size:12px;font-weight:800;vertical-align:1px;}',
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
        '<div class="s" id="chStickySub">' + NAME + ' · 2주 · 미션 10회차</div>' +
      '</div>' +
      '<button type="button" class="go" id="chStickyGo">신청하기</button>' +
    '</div>';
  document.body.appendChild(bar);

  /* 바가 푸터·본문 끝을 덮지 않도록 실측 높이만큼 body 를 밀어 준다.
     ⚠️ 고정값(예: 72px)을 쓰지 말 것 — 안전영역(env(safe-area-inset-bottom))이
        기기마다 달라 아이폰에서만 덜 밀리거나 더 밀린다. */
  function padBody() {
    /* 바 실측 높이 + 8px 여유. 여유가 없으면 마지막 줄이 경계선에 딱 붙어 잘려 보인다.
       ⚠️ 고정값(예: 72px)을 쓰지 말 것 — 안전영역이 기기마다 다르다. */
    var h = bar.offsetHeight || 0;
    document.body.style.paddingBottom = h ? (h + 8) + 'px' : '';
  }

  /* ── 언제 바를 보여줄까 ─────────────────────────────────────────────────
     '가리면 안 되는 것'이 화면에 보이는 동안엔 내린다. 둘이다.
       ① 히어로·본문의 신청 버튼 — 같은 행동이 두 개 겹치면 어느 걸 눌러야 할지 모른다.
       ② 푸터(사업자 정보) — **2026-08-02 오너 신고의 실제 원인.** 바가 푸터 위를
          지나가면서 '주소: … 고객센터: 070-' 줄이 가로로 잘려 보였다. 통신판매업자
          표시는 법적 고지라 반쯤 가린 채 두면 안 된다.
     ⚠️ 하나만 보고 판단하던 구 코드로 되돌리지 말 것 — 그게 이 사고의 원인이다. */
  var guards = [];
  var heroBtn = document.querySelector('.hero .apply-btn, .hero-inner .apply-btn') ||
                document.querySelector('.apply-btn');
  if (heroBtn) guards.push(heroBtn);
  var lastBtn = (function () {
    var all = document.querySelectorAll('.apply-btn');
    return all.length > 1 ? all[all.length - 1] : null;
  })();
  if (lastBtn) guards.push(lastBtn);
  var footer = document.querySelector('footer, .footer, .footer-inner');
  if (footer) guards.push(footer);

  var visible = new Set();
  function show(on) { bar.classList.toggle('on', !!on); padBody(); }
  if (guards.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target);
      });
      show(visible.size === 0);
    }, { threshold: 0 });
    guards.forEach(function (g) { io.observe(g); });
  } else {
    show(true);
  }

  /* 높이는 한 번만 재면 안 된다 — iOS 는 안전영역(env(safe-area-inset-bottom))과
     주소창 접힘 때문에 바 높이·화면 높이가 스크롤 도중에 바뀐다. 계속 따라간다. */
  window.addEventListener('resize', padBody);
  if (window.ResizeObserver) new ResizeObserver(padBody).observe(bar);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', padBody);

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
  var all = (window.MONC_RESEARCHERS || []).filter(function (r) { return !NON_COACH[r.id]; });
  var lead = all.filter(function (r) { return r.id === LEAD[CH]; })[0] || null;
  var rest = all.filter(function (r) { return !lead || r.id !== lead.id; });

  function row(r, isLead) {
    return '<li' + (isLead ? ' class="is-lead"' : '') + '>' +
      '<img src="' + r.photo + '" alt="" loading="lazy" width="44" height="44"' +
      (r.photoPos ? ' style="object-position:' + r.photoPos + '"' : '') + '>' +
      '<span class="who"><span class="nm">' + r.name +
      (isLead ? '<span class="lead-tag">담당 코치</span>' : '') + '</span>' +
      '<span class="po">' + r.position + '</span></span></li>';
  }

  if (anchor && all.length) {
    var sec = document.createElement('section');
    sec.className = 'ch-coach';
    sec.innerHTML =
      '<div class="ch-coach-in">' +
        '<h2>누가 지도하나요</h2>' +
        '<p class="lead">' + (lead
          ? NAME + '은 <b>' + lead.name + ' 코치</b>가 맡습니다. 2주 동안 미션을 확인하고 피드백을 남겨요.'
          : '전직 객실승무원과 보이스·스피치 전문 코치진이 함께합니다.') + '</p>' +
        '<ul>' + (lead ? row(lead, true) : '') + rest.map(function (r) { return row(r, false); }).join('') + '</ul>' +
        '<a class="more" href="researchers.html">연구진 전체 이력 보기 →</a>' +
      '</div>';
    anchor.parentNode.insertBefore(sec, anchor);
  }
})();
