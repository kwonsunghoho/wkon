# 챌린지 상세 ①안 '결과 먼저' — 보신각 적용 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `challenge-voice.html` 을 설계서(`docs/superpowers/specs/2026-09-07-challenge-detail-conversion-design.md`)의 ①안 순서로 재배치하고, 그 배치를 다른 상세 넷이 재사용할 수 있게 공용 CSS·공용 JS 슬롯으로 만든다.

**Architecture:** 정적 HTML 사이트(빌드 없음). 새 배치의 스타일은 공용 `challenge-detail.css` 한 파일. 실데이터(후기 수·D-day·참가비·담당 코치)는 이미 있는 공용 스크립트(`challenge-reviews.js`·`recruit.js`·`challenge-sticky.js`)가 **마크업의 슬롯(`data-*`)이 있을 때만** 채우도록 확장한다 — 슬롯이 없는 나머지 넷은 종전 동작 그대로. 계측은 `challenge-sticky.js` 에 두어 5종 공통.

**Tech Stack:** 손으로 쓴 HTML/CSS/JS, Supabase(anon REST), `page_events` 비콘(`window.moncBeacon`).

## Global Constraints

- 숫자는 실데이터만: 후기 수(`reviews` 조회), D-day(`challenge_rounds` → `recruit.js`), 참가비(`site_config` → `MONC.loadChallengePricing`). 모르면 그 알약을 그리지 않는다. 가짜 긴급 장치 금지.
- 보신각 판매 문구: "담당 코치 1:1 중간 점검 1회"(빈도를 세는 표현 금지). 환불: "시작일 전날까지 취소 시 전액 환불 · 시작 이후 환불 불가".
- 상세 5종 인라인 공통 CSS 블록은 수정 금지. 새 스타일은 `challenge-detail.css` 에만.
- `.ba-cell` 마크업·`<audio controls preload="none">` 폴백 유지. 모든 신청 버튼은 `.apply-btn` + `handleApply`.
- 활자 12px+, 터치 44px+, 대비 4.5:1(경계선 3:1), 포커스 표시. 375px 우선.
- 검증 수단은 브라우저 실측뿐(린트·빌드·테스트 없음). 커밋 메시지·주석은 한국어.

---

### Task 1: 공용 스타일 `challenge-detail.css`

**Files:**
- Create: `challenge-detail.css`

**Interfaces:**
- Produces: 클래스 `.hero--photo .hero-wrap .hero-photo .hero-facts .fact-pill .hero-note .cd-sec .cd-lead .cd-more .ba-list .ba-rest .ba-more-btn .fit-list .how-facts .how-fact .coach-line .coach-more .price-card .price-cap .price-line .price-inc .price-refund .faq` — Task 4 마크업과 Task 3 의 코치 한 줄이 쓴다.

- [ ] **Step 1: 파일 작성** — 아래 내용 그대로.

```css
/* ══════════════════════════════════════════════════════════════════════════
   챌린지 상세 — ①안 '결과 먼저' 배치 공용 스타일 (2026-09-07 오너 확정)
   설계: docs/superpowers/specs/2026-09-07-challenge-detail-conversion-design.md
   싣는 법: 인라인 <style> 블록 **뒤**에 <link rel="stylesheet" href="challenge-detail.css?v=1">
           (앞에 두면 인라인 .hero 규칙이 같은 특이도로 이 파일을 덮는다)
   ⚠️ 상세 5종의 인라인 공통 CSS 블록(* 리셋 ~ .footer-copy)은 그대로 둔다. 새 배치의 스타일은
      이 파일 한 곳 — 페이지 인라인에 복사하면 다섯 파일이 어긋난다(pages.md).
   ⚠️ 색은 tokens.css 변수만(새 색 금지). 활자 12px+ · 터치 44px+ · 경계선 3:1.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── 1. 히어로: 사진 + 약속 한 줄 + 사실 알약 3개 + 신청 버튼 ── */
.hero.hero--photo { padding: 66px 0 40px; }            /* 66px = 고정 nav 높이(nav.css) — 사진이 바로 밑에 붙는다 */
.hero-wrap { max-width: 1000px; margin: 0 auto; }
.hero-photo { position: relative; aspect-ratio: 4 / 3; overflow: hidden; background: var(--bg3); }
.hero-photo img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: 50% 24%; }
.hero-photo .hero-badge { position: absolute; left: 16px; top: 16px; margin: 0; background: rgba(255,255,255,.94); }
.hero--photo .hero-inner { padding-top: 22px; }
.hero--photo .hero-title { font-size: clamp(26px, 6.4vw, 40px); margin-bottom: 10px; }
.hero--photo .hero-desc { font-size: 16px; line-height: 1.65; margin-bottom: 18px; }
.hero-facts { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.fact-pill { display: inline-flex; align-items: center; gap: 5px; min-height: 34px; padding: 0 13px; border-radius: 999px;
  background: var(--surface); border: 1.5px solid var(--border); font-size: 13.5px; font-weight: 700; color: var(--text);
  font-variant-numeric: tabular-nums; }
.fact-pill[hidden] { display: none; }
.fact-pill strong { color: var(--accent-ink); font-weight: 800; }
.fact-pill s { color: var(--text-muted); font-weight: 500; text-decoration-thickness: 1.5px; }
.fact-pill s[hidden] { display: none; }
.fact-pill .won { font-size: 12px; }
/* recruit.js 가 #recruitChip 안에 붙이는 D-day 조각 — 임박(3일 이하)만 채운 알약 */
.fact-pill .dday-chip { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 999px;
  background: var(--action-tint); color: var(--accent-ink); font-size: 12px; font-weight: 800; }
.fact-pill .dday-urgent { background: var(--action); color: var(--action-ink); }
.hero--photo .hero-actions { flex-direction: column; }
.hero--photo .hero-actions .btn { width: 100%; }
.hero-note { margin-top: 10px; font-size: 13px; color: var(--text-muted); text-align: center; line-height: 1.5; }
@media (min-width: 860px) {
  .hero.hero--photo { padding-top: 96px; }
  .hero-wrap { display: grid; grid-template-columns: 5fr 6fr; gap: 40px; align-items: center; padding: 0 20px; }
  .hero-photo { border-radius: var(--radius); }
  .hero--photo .hero-inner { padding: 0; margin: 0; max-width: none; }
  .hero--photo .hero-actions { flex-direction: row; }
  .hero--photo .hero-actions .btn { width: auto; min-width: 220px; }
  .hero-note { text-align: left; }
}

/* ── 2. 섹션 공통(새 배치) — 인라인 section 규칙(padding-top 0 · bottom 60) 위에 간격만 조인다 ── */
.cd-sec { padding: 0 0 48px; }
.cd-sec .section-title { margin-bottom: 16px; }
.cd-lead { font-size: 15.5px; color: var(--text-muted); line-height: 1.65; margin: -6px 0 18px; word-break: keep-all; }
.cd-more { display: inline-flex; align-items: center; min-height: 44px; font-size: 14.5px; font-weight: 800; color: var(--accent-ink);
  text-decoration: underline; text-underline-offset: 3px; }

/* ── 3. 비포/애프터 — 1쌍만 펼치고 나머지는 버튼 ── */
.ba-list { display: flex; flex-direction: column; gap: 16px; max-width: 720px; margin: 0 auto; }
.ba-rest { display: flex; flex-direction: column; gap: 16px; }
.ba-rest[hidden] { display: none; }
.ba-more-btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; max-width: 720px; margin: 14px auto 0;
  min-height: 48px; padding: 0 20px; border-radius: 999px; border: 1.5px solid rgba(27,58,107,.55); background: var(--surface);
  color: var(--accent-ink); font: inherit; font-size: 15px; font-weight: 800; cursor: pointer; }
.ba-more-btn::after { content: '▾'; font-size: 13px; }
.ba-more-btn[aria-expanded="true"]::after { content: '▴'; }
.ba-more-btn:focus-visible { outline: 3px solid var(--accent-dark); outline-offset: 3px; }

/* ── 4. 이런 학생에게 — 카드 대신 체크 목록 ── */
.fit-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; max-width: 720px; }
.fit-list li { display: flex; gap: 10px; align-items: flex-start; font-size: 16px; line-height: 1.55; color: var(--text); word-break: keep-all; }
.fit-list li::before { content: ''; flex: 0 0 22px; width: 22px; height: 22px; margin-top: 1px; border-radius: 50%; background-color: var(--action-tint);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M5 10.5l3 3 7-7' fill='none' stroke='%231B3A6B' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-size: 14px; background-position: center; background-repeat: no-repeat; }
@media (min-width: 640px) { .fit-list { grid-template-columns: 1fr 1fr; } }

/* ── 5. 2주 진행 방식 — 사실 4칸 + 주차 접이(기존 .curriculum-*) + 담당 코치 한 줄(challenge-sticky.js 가 채움) ── */
.how-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; }
.how-fact { padding: 12px 14px; border-radius: var(--radius-sm); background: var(--bg2); border: 1px solid var(--border-soft); }
.how-fact b { display: block; font-size: 16px; font-weight: 800; color: var(--text); line-height: 1.3; }
.how-fact span { display: block; margin-top: 3px; font-size: 13px; color: var(--text-muted); line-height: 1.45; word-break: keep-all; }
@media (min-width: 640px) { .how-facts { grid-template-columns: repeat(4, 1fr); } }
.coach-line { display: flex; align-items: center; gap: 12px; margin-top: 16px; padding: 12px 14px; border-radius: var(--radius-sm);
  background: var(--action-tint); border: 1px solid rgba(27,58,107,.28); }
.coach-line img { width: 52px; height: 52px; flex: 0 0 52px; border-radius: 50%; object-fit: cover; object-position: center 18%; background: var(--bg2); }
.coach-line .who { min-width: 0; }
.coach-line .nm { display: block; font-size: 15px; font-weight: 800; color: var(--text); line-height: 1.35; word-break: keep-all; }
.coach-line .nm i { font-style: normal; display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px; background: var(--action);
  color: var(--action-ink); font-size: 12px; font-weight: 800; vertical-align: 1px; }
.coach-line .po { display: block; margin-top: 2px; font-size: 12.5px; color: var(--text-muted); line-height: 1.45; }
.coach-more { display: inline-flex; align-items: center; min-height: 44px; margin-top: 4px; font-size: 14px; font-weight: 800; color: var(--accent-ink);
  text-decoration: underline; text-underline-offset: 3px; }

/* ── 6. 참가비 카드 ── */
.price-card { max-width: 720px; margin: 0 auto; padding: 20px 18px; border-radius: var(--radius); border: 1.5px solid var(--action);
  background: var(--surface); box-shadow: var(--shadow); }
.price-cap { font-size: 13px; font-weight: 700; color: var(--text-muted); letter-spacing: .02em; }
.price-line { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-top: 4px; font-variant-numeric: tabular-nums; }
.price-line s { font-size: 15px; color: var(--text-muted); text-decoration-thickness: 1.5px; }
.price-line s[hidden] { display: none; }
.price-line strong { font-size: 30px; font-weight: 900; color: var(--text); letter-spacing: -.02em; line-height: 1.1; }
.price-line strong .won { font-size: 16px; font-weight: 800; margin-left: 1px; }
.price-inc { list-style: none; display: grid; gap: 8px; margin: 16px 0 0; padding: 16px 0 0; border-top: 1px dashed var(--border-strong);
  font-size: 15px; color: var(--text); }
.price-inc li { display: flex; gap: 8px; word-break: keep-all; line-height: 1.5; }
.price-inc li::before { content: '·'; font-weight: 900; color: var(--accent-ink); }
.price-card .btn { width: 100%; margin-top: 18px; }
.price-refund { margin-top: 12px; font-size: 12.5px; color: var(--text-muted); line-height: 1.55; text-align: center; word-break: keep-all; }
.price-refund a { color: var(--accent-ink); font-weight: 700; }

/* ── 7. FAQ — 네이티브 details(키보드·낭독기 기본 지원) ── */
.faq { max-width: 720px; margin: 0 auto; border-top: 1px solid var(--border); }
.faq details { border-bottom: 1px solid var(--border); }
.faq summary { list-style: none; display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 52px; padding: 12px 0;
  font-size: 16px; font-weight: 700; color: var(--text); cursor: pointer; word-break: keep-all; }
.faq summary::-webkit-details-marker { display: none; }
.faq summary::after { content: '+'; flex: 0 0 auto; font-size: 22px; font-weight: 400; color: var(--text-muted); line-height: 1; }
.faq details[open] summary::after { content: '−'; }
.faq summary:focus-visible { outline: 3px solid var(--accent-dark); outline-offset: 2px; border-radius: 6px; }
.faq p { padding: 0 0 16px; font-size: 15px; line-height: 1.7; color: var(--text-muted); word-break: keep-all; }
.faq p a { color: var(--accent-ink); font-weight: 700; }
```

- [ ] **Step 2: 확인** — `grep -c '/\*' challenge-detail.css` 와 `grep -c '\*/' challenge-detail.css` 가 같은지(주석 짝). 커밋은 Task 4 와 함께(파일만으로는 화면이 없다).

---

### Task 2: `challenge-reviews.js` — 히어로 알약 '후기 N건' 슬롯

**Files:**
- Modify: `challenge-reviews.js` (load() 안, `if (!rows.length) return;` 다음)

**Interfaces:**
- Consumes: 마크업 `[data-review-pill hidden]` 안의 `[data-review-count]`(Task 4).
- Produces: 후기 1건 이상이면 count 텍스트 `N건` + 알약 `hidden=false`. 0건·조회 실패면 손대지 않는다(알약 안 보임).

- [ ] **Step 1: 코드 삽입** — `if (!rows.length) return;                            // 0건이면 안 그린다` 바로 뒤에:

```js
      /* 히어로 사실 알약 '후기 N건'(2026-09-07 ①안) — 위 return 이 0건을 걸러 주므로 여기 오면 항상 1건 이상.
         슬롯이 없는 페이지(아직 구 배치)에서는 아무 일도 없다. */
      document.querySelectorAll('[data-review-count]').forEach(function (el) { el.textContent = rows.length + '건'; });
      document.querySelectorAll('[data-review-pill]').forEach(function (el) { el.hidden = false; });
```

- [ ] **Step 2: 확인** — `node --check challenge-reviews.js` 통과. 브라우저 검증은 Task 5.

---

### Task 3: `challenge-sticky.js` — 참가비 슬롯 · 담당 코치 한 줄 · 계측 / `supabase-config.js` — 비콘 keepalive

**Files:**
- Modify: `challenge-sticky.js` (price() · 코치진 블록 · 파일 끝)
- Modify: `supabase-config.js` (`window.moncBeacon`)

**Interfaces:**
- Consumes: 마크업 `[data-ch-price="now"]`·`[data-ch-price="list"]`·`[data-price-pill]`·`[data-coach-slot]`·`[data-reach="price|faq|end"]`·`.apply-btn[data-pos]`(Task 4).
- Produces: 비콘 `ch_detail_cta {c,pos}`·`ch_detail_reach {c,s}`. 코치 한 줄 마크업 `.coach-line`+`.coach-more`(Task 1 스타일).

- [ ] **Step 1: price() 교체** — 기존 `(async function price() { … })();` 전체를 아래로:

```js
  (async function price() {
    var el = document.getElementById('chStickyPrice');
    /* ①안 히어로 알약·참가비 카드 슬롯(2026-09-07) — 같은 조회 한 번으로 바·알약·카드를 같이 채운다.
       ⚠️ 못 읽으면 알약은 그리지 않고(hidden 유지) 카드는 '참가비 안내'로 비운다 — 숫자를 지어내지 않는다. */
    var nows  = document.querySelectorAll('[data-ch-price="now"]');
    var lists = document.querySelectorAll('[data-ch-price="list"]');
    var pills = document.querySelectorAll('[data-price-pill]');
    function unknown() {
      el.textContent = '참가비 안내';
      nows.forEach(function (n) { n.textContent = '참가비 안내'; });
      lists.forEach(function (s) { s.hidden = true; });
    }
    if (!window.MONC || !window.MONC.sb || !window.MONC.loadChallengePricing) { unknown(); return; }
    try {
      var p = await window.MONC.loadChallengePricing(null);
      if (p && Number.isFinite(p.price) && p.price >= 0) {
        var won = '<span class="won">원</span>';
        /* 취소선은 시각 효과라 낭독기가 안 읽는다 — 무엇이 정가고 무엇이 낼 돈인지 말해 준다. */
        var wasHtml = p.list == null ? '' : '<span class="sr-only">정가 </span>' + p.list.toLocaleString('ko-KR') + won;
        var nowHtml = (p.list == null ? '' : '<span class="sr-only">할인가 </span>') + p.price.toLocaleString('ko-KR') + won;
        el.innerHTML = (wasHtml ? '<s class="was">' + wasHtml + '</s>' : '') + '<span class="now">' + nowHtml + '</span>';
        nows.forEach(function (n) { n.innerHTML = nowHtml; });
        lists.forEach(function (s) { s.hidden = !wasHtml; if (wasHtml) s.innerHTML = wasHtml; });
        pills.forEach(function (pl) { pl.hidden = false; });
        return;
      }
    } catch (err) {}
    /* ⚠️ 실패해도 숫자를 지어내지 않는다 — 틀린 금액을 띄우면 광고가와 청구가가 어긋난다. */
    unknown();
  })();
```

- [ ] **Step 2: 코치진 블록 교체** — `if (anchor && all.length) { … }` 를 아래로(앞의 `row()` 정의는 그대로):

```js
  /* ①안 배치(2026-09-07): 페이지에 [data-coach-slot] 이 있으면 담당 코치 **한 줄만** 그 자리에 넣는다.
     코치진 전체 섹션(아래 else)은 구 배치 페이지에서만 — 슬롯이 있는데 LEAD 가 없으면 아무것도 안 그린다(추측 금지). */
  var slot = document.querySelector('[data-coach-slot]');
  if (slot) {
    if (lead) {
      slot.innerHTML =
        '<div class="coach-line">' +
          '<img src="' + lead.photo + '" alt="" loading="lazy" width="52" height="52"' +
          (lead.photoPos ? ' style="object-position:' + lead.photoPos + '"' : '') + '>' +
          '<span class="who"><span class="nm">' + NAME + '은 ' + lead.name + ' 코치가 맡습니다<i>담당 코치</i></span>' +
          '<span class="po">' + lead.position + ' · ' + (GUIDE[CH] ? '가이던스 영상' : '1:1 중간 점검 1회') + '</span></span>' +
        '</div>' +
        '<a class="coach-more" href="researchers.html">연구진 전체 이력 보기 →</a>';
    }
  } else if (anchor && all.length) {
    var sec = document.createElement('section');
    sec.className = 'ch-coach';
    sec.innerHTML =
      '<div class="ch-coach-in">' +
        '<h2>누가 지도하나요</h2>' +
        '<p class="lead">' + (lead
          ? NAME + '은 <b>' + lead.name + ' 코치</b>가 맡습니다. ' + (GUIDE[CH]
              ? '코치 가이던스 영상을 따라 2주 동안 매일 답변을 직접 씁니다.'
              : '2주 동안 미션을 확인하고 피드백을 남겨요.')
          : '전직 객실승무원과 보이스·스피치 전문 코치진이 함께합니다.') + '</p>' +
        '<ul>' + (lead ? row(lead, true) : '') + rest.map(function (r) { return row(r, false); }).join('') + '</ul>' +
        '<a class="more" href="researchers.html">연구진 전체 이력 보기 →</a>' +
      '</div>';
    anchor.parentNode.insertBefore(sec, anchor);
  }

  /* ── 계측(2026-09-07 상세 개편 전후 비교용) — page_events, 실패는 조용히 무시 ──
     ch_detail_cta  {c, pos}: 신청 버튼 클릭(pos = 마크업 data-pos: hero/price/final, 하단 바 = bar).
     ch_detail_reach {c, s}: [data-reach] 섹션이 화면에 들어온 첫 순간(s = price/faq/end).
     분모는 supabase-config 의 page_view. 슬롯 없는 구 배치 페이지도 CTA 기준선은 쌓인다. */
  function beacon(ev, meta) { if (typeof window.moncBeacon === 'function') window.moncBeacon(ev, meta); }
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('.apply-btn, #chStickyGo') : null;
    if (!t) return;
    beacon('ch_detail_cta', { c: CH, pos: t.getAttribute('data-pos') || (t.id === 'chStickyGo' ? 'bar' : 'other') });
  }, true);
  var reaches = document.querySelectorAll('[data-reach]');
  if (reaches.length && 'IntersectionObserver' in window) {
    var rio = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (!en.isIntersecting) return;
        beacon('ch_detail_reach', { c: CH, s: en.target.getAttribute('data-reach') });
        rio.unobserve(en.target);
      });
    }, { threshold: 0.25 });
    reaches.forEach(function (r) { rio.observe(r); });
  }
```

- [ ] **Step 3: `supabase-config.js` 비콘 keepalive** — `window.moncBeacon = function (event, meta) { … };` 를 아래로:

```js
  window.moncBeacon = function (event, meta) {
    try {
      const sb = window.MONC.sb;
      const row = { event: event, path: path, meta: meta || {} };
      /* keepalive fetch(2026-09-07): 버튼을 누르자마자 페이지를 떠나도(상세 → 신청 이동) 요청이 살아남는다.
         supabase-js insert 는 일반 fetch 라 이동과 함께 끊길 수 있었다(ch_detail_cta 가 이 경우다).
         anon 키로 보낸다 — page_events INSERT 는 anon 정책(with check true)이라 회원이어도 같은 결과. */
      if (window.fetch && sb.supabaseUrl && sb.supabaseKey) {
        fetch(sb.supabaseUrl + '/rest/v1/page_events', {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', 'apikey': sb.supabaseKey,
                     'Authorization': 'Bearer ' + sb.supabaseKey, 'Prefer': 'return=minimal' },
          body: JSON.stringify(row)
        }).catch(function () {});
        return;
      }
      sb.from('page_events').insert(row).then(function () {}, function () {});
    } catch (e) {}
  };
```

- [ ] **Step 4: 확인** — `node --check challenge-sticky.js supabase-config.js` 통과. 브라우저 검증은 Task 5.

---

### Task 4: `challenge-voice.html` 재배치

**Files:**
- Modify: `challenge-voice.html` — `</style>` 뒤에 CSS 링크 1줄, `<body>` ~ `<footer>` 사이 전체 교체, 인라인 스크립트에 비포/애프터 접이 토글 추가.

**Interfaces:**
- Consumes: Task 1 클래스, Task 2·3 슬롯 규약.

- [ ] **Step 1: head** — `</style>` 바로 뒤 `</head>` 앞에:

```html
  <!-- ①안 '결과 먼저' 배치(2026-09-07) 공용 스타일 — 인라인 블록 뒤에 둔다(앞에 두면 .hero 가 덮는다) -->
  <link rel="stylesheet" href="challenge-detail.css?v=1">
```

- [ ] **Step 2: body 교체** — `<body data-challenge="voice">` 부터 `<footer>` 직전까지를 아래로. 비포/애프터 B~G 카드 6장은 **기존 마크업 그대로** `#baRest` 안으로 옮긴다(인용문 포함).

```html
<body data-challenge="voice">

<!-- ①안 '결과 먼저'(2026-09-07 오너 확정) — 순서·규칙: docs/superpowers/specs/2026-09-07-challenge-detail-conversion-design.md
     사진·알약·카드 스타일은 challenge-detail.css(공용). 인라인에 복사하지 말 것. -->
<section class="hero hero--photo">
  <div class="hero-wrap">
    <div class="hero-photo">
      <!-- 허브 카드와 같은 사진 — 첫 화면 최대 요소라 먼저 받는다 -->
      <img src="images/hero-voice.webp" alt="" width="1112" height="1109" fetchpriority="high" decoding="async">
      <span class="hero-badge">보이스</span>
    </div>
    <div class="container hero-inner">
      <h1 class="hero-title"><span class="gradient-text" style="font-weight: var(--fw-bold); view-transition-name: challenge-name;">보.신.각</span> - 보이스 <strong style="font-weight: var(--fw-bold);">신분상승</strong> 챌린지</h1>
      <p class="hero-desc">작게 들리던 내 목소리를, 면접관이 기억하는 목소리로. 코치와 함께하는 2주, 하루 10~15분.</p>
      <!-- 사실 3개 — 전부 실데이터. 후기 수 = challenge-reviews.js · 모집 = recruit.js · 참가비 = challenge-sticky.js.
           ⚠️ 값을 모르면 알약을 그리지 않는다(hidden 유지). 숫자를 지어내지 말 것. -->
      <div class="hero-facts">
        <span class="fact-pill" data-review-pill hidden>후기 <strong data-review-count></strong></span>
        <span class="fact-pill" id="recruitChip">모집기간 확인 중…</span>
        <span class="fact-pill" data-price-pill hidden><s data-ch-price="list" hidden></s><strong data-ch-price="now"></strong></span>
      </div>
      <div class="hero-actions">
        <a class="btn btn-primary apply-btn" data-pos="hero" href="#" onclick="handleApply(event)">신청하기</a>
      </div>
      <p class="hero-note">시작일 전날까지 취소하면 전액 환불</p>
    </div>
  </div>
</section>

<!-- 2. 증거 — 1쌍만 펼치고 나머지 6쌍은 버튼으로. 카드 마크업·controls 폴백·preload=none 은 ba-audio.js 규칙 그대로 -->
<section class="cd-sec">
  <div class="container">
    <div class="section-label">Before &amp; After</div>
    <h2 class="section-title">같은 사람의 목소리가 2주 만에 이렇게 달라졌어요</h2>
    <p class="cd-lead">직접 들어보세요. 실제 챌린저의 DAY 1 과 DAY 10 녹음입니다.</p>
    <div class="ba-list">
      (기존 챌린저 A 카드 그대로)
      <div class="ba-rest" id="baRest" hidden>
        (기존 챌린저 B~G 카드 6장 그대로)
      </div>
    </div>
    <button type="button" class="ba-more-btn" id="baMoreBtn" aria-expanded="false" aria-controls="baRest">다른 챌린저 6명의 변화 더 듣기</button>
  </div>
</section>

<!-- 3. 나한테 맞나 — 카드 6장을 체크 목록으로(제목만) -->
<section class="cd-sec">
  <div class="container">
    <div class="section-label">Recommended For</div>
    <h2 class="section-title">이런 학생에게 맞아요</h2>
    <ul class="fit-list">
      <li>면접에서 긴장하면 목소리가 높아지는 학생</li>
      <li>말할 때 목에 힘이 많이 들어가는 학생</li>
      <li>답변 내용은 준비했지만 전달력이 약한 학생</li>
      <li>말끝이 흐려져 자신감이 없어 보이는 학생</li>
      <li>목소리가 가볍거나 어린 느낌으로 들리는 학생</li>
      <li>아나운서처럼 안정적이고 신뢰감 있는 목소리를 만들고 싶은 학생</li>
    </ul>
  </div>
</section>

<!-- 4. 어떻게 하나 — 사실 4칸 + 주차 접이(둘 다 접힘) + 담당 코치 한 줄(challenge-sticky.js 가 슬롯에 채움) -->
<section class="cd-sec">
  <div class="container">
    <div class="section-label">How it works</div>
    <h2 class="section-title">2주 동안 이렇게 진행돼요</h2>
    <div class="how-facts">
      <div class="how-fact"><b>하루 10~15분</b><span>가이던스 영상 보고 녹음 제출</span></div>
      <div class="how-fact"><b>미션 10회차</b><span>2주 · 1주치를 한 번에 받아요</span></div>
      <div class="how-fact"><b>카카오톡 채널</b><span>미션 안내 · 과제 제출</span></div>
      <div class="how-fact"><b>1:1 중간 점검 1회</b><span>담당 코치가 직접 짚어줘요</span></div>
    </div>
    <div class="curriculum-list">
      (기존 1주차·2주차 .curriculum-week 블록 그대로, 단 1주차의 `open` 클래스 제거)
    </div>
    <div data-coach-slot></div>
  </div>
</section>

<!-- 5. 남들은 뭐라나 — 실제 후기 3개(challenge-reviews.js). 0건이면 섹션을 안 그린다 -->
<section class="ch-rv" id="chReviews" data-challenge="보신각" hidden></section>

<!-- 6. 얼마인가 — 금액은 challenge-sticky.js 가 site_config 에서 채운다(하드코딩 금지) -->
<section class="cd-sec" data-reach="price">
  <div class="container">
    <div class="section-label">Price</div>
    <h2 class="section-title">참가비</h2>
    <div class="price-card">
      <div class="price-cap">보.신.각 · 코치와 함께하는 2주 · 미션 10회차</div>
      <div class="price-line"><s data-ch-price="list" hidden></s><strong data-ch-price="now">참가비 확인 중…</strong></div>
      <ul class="price-inc">
        <li>2주 · 미션 10회차(DAY 1~10) 코치 가이던스 영상</li>
        <li>담당 코치 1:1 중간 점검 1회</li>
        <li>카카오톡 전용 채널 미션 안내 · 과제 제출</li>
        <li>처음·끝 녹음 비교(마이페이지)</li>
      </ul>
      <a class="btn btn-primary apply-btn" data-pos="price" href="#" onclick="handleApply(event)">신청하기</a>
      <p class="price-refund">시작일 전날까지 취소 시 전액 환불 · 시작 이후 환불 불가 · <a href="apply.html?c=voice">제공·환불 규정 자세히</a></p>
    </div>
  </div>
</section>

<!-- 7. 궁금한 것 — apply.html FAQ 와 같은 사실(진행 방식은 보신각 문장). 참가비 FAQ 는 위 카드가 맡는다 -->
<section class="cd-sec" data-reach="faq">
  <div class="container">
    <div class="section-label">FAQ</div>
    <h2 class="section-title">자주 묻는 질문</h2>
    <div class="faq">
      <details><summary>어떻게 진행되나요?</summary><p>100% 온라인·비대면이에요. 카카오톡 전용 채널에서 2주(14일) 동안 미션 10회차(DAY 1~10)를 안내받고 음성 녹음 과제를 제출해요. 미션은 1주치가 한 번에 제공되고, 진행 중간에 담당 코치가 1:1로 점검해요.</p></details>
      <details><summary>결제하면 언제 시작하나요?</summary><p>입금 확인 후, 다음 기수 시작일에 다 함께 시작해요. 시작 전에 채널로 안내드려요.</p></details>
      <details><summary>수료 기준이 뭔가요?</summary><p>2주(14일) 중 미션 10일(DAY 1~10)을 모두 완수하면 수료예요.</p></details>
      <details><summary>중간에 그만두면 환불되나요?</summary><p>시작일 전날까지 취소하시면 결제 금액을 전액(100%) 환불해 드려요. 시작 후에는 1주일치 미션이 한 번에 제공되고 선착순 정원이라 환불이 되지 않아요. 자세한 규정은 <a href="apply.html?c=voice">신청 페이지</a>와 <a href="terms.html">이용약관 제4조</a>에 있어요.</p></details>
    </div>
  </div>
</section>

<!-- 8. 마무리 -->
<section style="padding-top: 0; padding-bottom: 80px;" data-reach="end">
  <div class="container">
    <div class="cta-box">
      <h2 class="cta-title">2주 뒤, 내 목소리가 달라집니다</h2>
      <p class="cta-desc">코치와 함께하는 2주 · 미션 10회차</p>
      <a class="btn btn-white apply-btn" data-pos="final" href="#" onclick="handleApply(event)">보.신.각 신청하기</a>
      <p style="font-size:13px; color:rgba(255,255,255,.84); margin:18px 0 0; line-height:1.6; position:relative; z-index:1;">100% 온라인·비대면 · 기수 시작일부터 14일(총 10회차) 제공 · 카카오톡 전용 채널 진행 · 제공·환불 규정은 <a href="apply.html?c=voice" style="color:#fff; text-decoration:underline;">신청 페이지</a> 참고</p>
    </div>
  </div>
</section>
```

- [ ] **Step 3: 인라인 스크립트** — 커리큘럼 아코디언 IIFE 앞에 추가:

```js
  /* 비포/애프터 — 1쌍만 펼치고 나머지 6쌍은 버튼으로(2026-09-07 ①안). 접을 때 재생 중인 소리는 멈춘다. */
  (function () {
    const btn = document.getElementById('baMoreBtn'), rest = document.getElementById('baRest');
    if (!btn || !rest) return;
    btn.addEventListener('click', () => {
      const open = rest.hidden;
      rest.hidden = !open;
      if (!open) rest.querySelectorAll('audio').forEach(a => a.pause());
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? '접기' : '다른 챌린저 6명의 변화 더 듣기';
    });
  })();
```

- [ ] **Step 4: 정적 확인** — `grep -c 'class="ba-cell"' challenge-voice.html` = 14(7쌍 그대로), `grep -c 'apply-btn' challenge-voice.html` = 3(히어로·카드·마무리), `grep -c 'data-reach' challenge-voice.html` = 3, 인라인 `<style>` 공통 블록이 다른 넷과 동일한지 `diff <(sed -n '/<style>/,/<\/style>/p' challenge-voice.html) <(sed -n '/<style>/,/<\/style>/p' challenge-spinning.html)` 로 확인(차이는 `@media (max-width:600px)` 블록만).

- [ ] **Step 5: 커밋**

```bash
git add challenge-detail.css challenge-reviews.js challenge-sticky.js supabase-config.js challenge-voice.html
git commit -m "보신각 상세 ①안 '결과 먼저' 재배치 — 사진 히어로·사실 알약 3개·비포/애프터 1쌍·참가비 카드·FAQ + 공용 CSS/슬롯/계측"
```

---

### Task 5: 375px 실측 검증 · 문서 · 배포

**Files:**
- Modify: `docs/notes/pages.md`(새 절), `CLAUDE.md`(기타 페이지 행)

- [ ] **Step 1: 로컬 미러 서빙** — 프리뷰 프로세스는 `~/Documents` 를 못 읽는다(memory). Bash 로 `rsync -a --delete --exclude .git --exclude .claude <worktree>/ <scratchpad>/site/` 뒤 `python3 -m http.server 5799 --bind 127.0.0.1`(cwd = scratchpad/site, 백그라운드).

- [ ] **Step 2: 375×812 측정(브라우저 JS)** — 아래 값을 기록:

```js
({ H: document.documentElement.scrollHeight, screens: +(document.documentElement.scrollHeight/innerHeight).toFixed(1),
   pills: [...document.querySelectorAll('.fact-pill')].map(p => ({t: p.textContent.trim(), hidden: p.hidden})),
   card: document.querySelector('.price-line').textContent.trim(), bar: document.getElementById('chStickyPrice').textContent.trim(),
   coach: !!document.querySelector('.coach-line'), reviews: !document.getElementById('chReviews').hidden,
   restHidden: document.getElementById('baRest').hidden,
   small: [...document.querySelectorAll('body *')].filter(e => { const s=getComputedStyle(e); return e.textContent.trim() && s.fontSize && parseFloat(s.fontSize) < 12 && s.display!=='none'; }).length,
   touch: [...document.querySelectorAll('a.btn, button, summary, .week-header')].filter(e => e.getBoundingClientRect().height && e.getBoundingClientRect().height < 44).map(e => e.className),
   overflow: document.documentElement.scrollWidth > innerWidth })
```

기대: screens ≤ 8, 알약 3개 값 = 실데이터(후기 55건 · 모집 8/24 ~ 9/13 D-6 · 49,000/33,000), card 금액 = bar 금액, coach true, reviews true, restHidden true, small 0, touch [], overflow false. 320px 에서 overflow false. 콘솔 에러 0.

- [ ] **Step 3: 동작** — `#baMoreBtn` 클릭 → `#baRest` 펼침·라벨 '접기'; FAQ summary 클릭; 주차 헤더 Enter; 히어로 버튼 클릭 → `apply.html?c=voice` 이동 + 네트워크에 `page_events` POST(`ch_detail_cta`); 스크롤 → `ch_detail_reach` 3건. `window._recruitStatus='closed'` 후 버튼 클릭 → 오픈 알림 시트.

- [ ] **Step 4: 데스크톱 1280** — 히어로 2열, 넘침 0, 스크린샷 1장.

- [ ] **Step 5: 문서** — `docs/notes/pages.md` 에 '챌린지 상세 ①안 결과 먼저 배치(2026-09-07)' 절: 순서 8단계 · 슬롯 규약 · challenge-detail.css 링크 위치 · 실측값. `CLAUDE.md` 기타 페이지 행에 `challenge-detail.css` 추가. 커밋.

- [ ] **Step 6: 배포** — 보고 판단하는 수정이라 main 직행(CLAUDE.md): 워크트리 브랜치를 main 에 fast-forward 병합 후 `git push origin main`. 오너 폰 확인 요청.
