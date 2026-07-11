# 홈페이지 구매전환 동선 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 몰입 장치는 그대로 두고, 신청 동선과 오퍼를 제 위치에 배치해 모바일 구매전환을 끌어올린다.

**Architecture:** 정적 HTML 사이트(`index.html` 단일 페이지) + `recruit.js`. 빌드 없음. 히어로 캐러셀 CTA·하단 고정바·인트로 스킵·감정 피크 CTA·섹션 재배치·카드 바로신청을 추가/수정한다. 가격·보증금·계좌·제출 스키마는 불변이라 휴면 모달/`apply.html`은 손대지 않는다.

**Tech Stack:** 순수 HTML/CSS/Vanilla JS. 검증은 테스트 프레임워크가 없으므로 인앱 프리뷰의 `javascript_tool` DOM 실측으로 한다(무거운 히어로 때문에 스크린샷은 얼어붙으므로 사용 금지).

**Spec:** `docs/superpowers/specs/2026-07-11-conversion-flow-overhaul-design.md`

**공통 규칙:**
- 브랜치: `feature/conversion-flow` (이미 생성됨).
- 커밋 메시지는 한국어(기존 히스토리 관례).
- 각 Task 후 프리뷰(`wkon-static`, 포트 5500)에서 DOM 실측으로 검증하고 커밋.
- 검증 스니펫은 `mcp__Claude_Browser__javascript_tool`(tabId `seed`)로 실행. 스크린샷 금지.

---

### Task 1: 히어로 캐러셀 신청 CTA (B)

`.hero-scene`은 줌 스케일을 받지 않는 일반 sticky라 내부에 CTA를 안전하게 얹을 수 있다. `.hs-carousel`(flex column center)의 마지막 자식으로 슬라이드 4개 공통 CTA바 1개를 넣는다.

**Files:**
- Modify: `index.html` (CSS: `.hs-carousel` 정의 뒤 ~line 1690 근처 / 마크업: `.hs-nav` 닫힘 뒤 ~line 1989)

- [ ] **Step 1: CSS 추가** — `.hs-carousel { ... gap: 24px; }` 블록(현재 index.html에서 `gap: 24px;` 다음 `}`로 끝나는 규칙) 바로 다음 줄에 삽입:

```css
    .hs-cta {
      flex: 0 0 auto;
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      text-align: center; z-index: 3;
    }
    .hs-cta-btn {
      font-size: 16px; padding: 14px 34px; border-radius: 999px;
      box-shadow: 0 10px 30px rgba(201,71,30,.28);
    }
    .hs-cta-sub {
      font-size: 13px; font-weight: 700; color: var(--text);
      opacity: .82; letter-spacing: -.01em; margin: 0;
    }
    .hs-cta-badge {
      display: inline-block; font-size: 12px; font-weight: 800; color: #fff;
      background: var(--accent); padding: 5px 13px; border-radius: 999px; letter-spacing: -.01em;
    }
    .hs-cta-badge[hidden] { display: none; }
    @media (max-width: 768px) { .hs-cta-btn { padding: 13px 30px; } }
```

- [ ] **Step 2: 마크업 추가** — `.hs-nav`를 닫는 `</div>`(좌우 네비게이션 버튼 2개를 감싼 `<div class="hs-nav">…</div>`) 바로 다음, `</div><!-- /.hs-carousel -->` 직전에 삽입:

```html
      <div class="hs-cta">
        <span class="hs-cta-badge" data-recruit-cta-badge hidden></span>
        <a class="btn btn-action hs-cta-btn" href="apply.html">신청하기 →</a>
        <p class="hs-cta-sub">참가비 3만원 · 2주 완주 시 전액 환급</p>
      </div>
```

- [ ] **Step 3: 검증** — 프리뷰 로드 후 실행:

```js
(() => { const c=document.querySelector('.hero-scene .hs-cta'); const b=c&&c.querySelector('.hs-cta-btn'); return { exists: !!c, href: b&&b.getAttribute('href'), text: b&&b.textContent.trim(), sub: c&&c.querySelector('.hs-cta-sub').textContent.trim() }; })()
```
Expected: `{ exists: true, href: "apply.html", text: "신청하기 →", sub: "참가비 3만원 · 2주 완주 시 전액 환급" }`

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "feat(conv): 히어로 캐러셀에 신청 CTA 추가 — 첫 화면 전환 동선 확보"
```

---

### Task 2: 하단 고정 CTA바 full-width 강화 (C)

현재 279px 중앙 정렬 알약 → 좌우 꽉 찬 2줄 바(높이 ≥56px), 긴급성 뱃지 슬롯 추가.

**Files:**
- Modify: `index.html` (CSS: `.mobile-cta-bar` 미디어쿼리 ~line 194-218 / 마크업: `.mobile-cta-bar` ~line 2501)

- [ ] **Step 1: CSS 교체** — 아래 현재 규칙 블록을 통째로 교체.

현재(찾을 대상, `.mobile-cta-bar { display: none; }`부터 `body { padding-bottom: 86px; }` 닫는 `}`까지):
```css
    .mobile-cta-bar { display: none; }
    @media (max-width: 768px) {
      .mobile-cta-bar {
        display: block; position: fixed; z-index: 95;
        left: 50%; bottom: calc(20px + env(safe-area-inset-bottom, 0px));
        transform: translateX(-50%);
        width: auto; max-width: calc(100vw - 32px);
      }
      .mobile-cta-btn {
        width: auto; min-height: 0;
        flex-direction: row; align-items: baseline; gap: 9px; line-height: 1.2;
        white-space: nowrap;
        border-radius: 999px; padding: 13px 24px;
        /* 코랄 틴트 프로스티드 글래스 — 사진 위에 떠 있어도 세련되고 가볍게 */
        background: rgba(201,71,30,.72);
        backdrop-filter: blur(16px) saturate(1.35);
        -webkit-backdrop-filter: blur(16px) saturate(1.35);
        border: 1px solid rgba(255,255,255,.38);
        box-shadow: 0 10px 34px rgba(201,71,30,.28), inset 0 1px 0 rgba(255,255,255,.4);
        color: #fff;
      }
      .mobile-cta-btn .mcta-main { font-size: 15px; font-weight: 800; letter-spacing: -.01em; }
      .mobile-cta-btn .mcta-sub  { font-size: 11px; font-weight: 600; opacity: .9; }
      /* 플로팅 알약이 콘텐츠를 가리지 않도록 여백 확보 */
      body { padding-bottom: 86px; }
    }
```

교체 후:
```css
    .mobile-cta-bar { display: none; }
    @media (max-width: 768px) {
      .mobile-cta-bar {
        display: block; position: fixed; z-index: 95;
        left: 14px; right: 14px; bottom: calc(14px + env(safe-area-inset-bottom, 0px));
        transform: none; width: auto; max-width: none;
      }
      .mobile-cta-btn {
        display: flex; width: 100%; min-height: 56px;
        flex-direction: column; align-items: center; justify-content: center;
        gap: 2px; line-height: 1.25; white-space: nowrap;
        border-radius: 16px; padding: 10px 20px;
        background: rgba(201,71,30,.82);
        backdrop-filter: blur(16px) saturate(1.35);
        -webkit-backdrop-filter: blur(16px) saturate(1.35);
        border: 1px solid rgba(255,255,255,.38);
        box-shadow: 0 10px 34px rgba(201,71,30,.30), inset 0 1px 0 rgba(255,255,255,.4);
        color: #fff;
      }
      .mobile-cta-btn .mcta-main { font-size: 16px; font-weight: 800; letter-spacing: -.01em; }
      .mobile-cta-btn .mcta-sub  { font-size: 11.5px; font-weight: 600; opacity: .92; }
      .mcta-badge { font-weight: 800; }
      .mcta-badge[hidden] { display: none; }
      .mcta-badge::after { content: " · "; }
      body { padding-bottom: 96px; }
    }
```

- [ ] **Step 2: 마크업 교체** — 현재 하단바 마크업을 교체.

현재:
```html
<div class="mobile-cta-bar">
  <a class="btn btn-action mobile-cta-btn" href="apply.html" aria-label="지금 신청하기, 참가비 3만원 수료 시 환급">
    <span class="mcta-main">지금 신청하기</span>
    <span class="mcta-sub">참가비 3만원 · 수료 시 전액 환급</span>
  </a>
</div>
```
교체 후:
```html
<div class="mobile-cta-bar">
  <a class="btn btn-action mobile-cta-btn" href="apply.html" aria-label="지금 신청하기, 참가비 3만원, 2주 완주 시 전액 환급">
    <span class="mcta-main">지금 신청하기</span>
    <span class="mcta-sub"><span class="mcta-badge" data-recruit-cta-badge hidden></span>참가비 3만원 · 완주 시 전액 환급</span>
  </a>
</div>
```

- [ ] **Step 3: 검증** — 모바일 뷰포트(375px)에서 실행:

```js
(() => { const bar=document.querySelector('.mobile-cta-bar'); const r=bar.getBoundingClientRect(); const btn=bar.querySelector('.mobile-cta-btn'); const br=btn.getBoundingClientRect(); return { barW: Math.round(r.width), btnH: Math.round(br.height), fullWidthish: r.width > window.innerWidth - 40, badge: !!bar.querySelector('.mcta-badge') }; })()
```
Expected: `barW` ≈ 347 (375-28), `fullWidthish: true`, `btnH` ≥ 56, `badge: true`.

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "feat(conv): 모바일 하단 고정 CTA바 full-width·긴급성 슬롯 강화"
```

---

### Task 3: recruit.js 긴급성 뱃지 연동 + fetch 메모이즈 (C 연동)

Task 1·2가 심어둔 `[data-recruit-cta-badge]`를 "가장 임박한 모집" 한 줄로 채운다. `loadRecruitData`를 메모이즈해 중복 fetch를 막는다.

**Files:**
- Modify: `recruit.js` (`loadRecruitData` ~line 48-52, 파일 끝)
- Modify: `index.html` (`applyIndexRecruit().then(chxSyncStates);` ~line 3101)

- [ ] **Step 1: `loadRecruitData` 메모이즈** — 현재 함수를 교체.

현재:
```js
async function loadRecruitData() {
  const sb = await loadRecruitDataFromSupabase();
  if (sb) return sb;
  return await loadRecruitDataFromCsv();  // 전환 검증 기간 폴백
}
```
교체 후:
```js
let _recruitDataPromise = null;
async function loadRecruitData() {
  if (_recruitDataPromise) return _recruitDataPromise;
  _recruitDataPromise = (async () => {
    const sb = await loadRecruitDataFromSupabase();
    if (sb) return sb;
    return await loadRecruitDataFromCsv();  // 전환 검증 기간 폴백
  })();
  return _recruitDataPromise;
}
```

- [ ] **Step 2: `applyGlobalRecruitCta` 추가** — `recruit.js` 맨 끝(파일 마지막 줄 `}` 다음)에 추가:

```js

/* ── 히어로/하단 CTA 긴급성 뱃지: 가장 임박한 모집 상태를 한 줄로 ──
   open(마감 임박 우선) → upcoming(오픈 임박) 순. closed뿐이면 정적 문구 유지. */
async function applyGlobalRecruitCta() {
  const badges = document.querySelectorAll('[data-recruit-cta-badge]');
  if (!badges.length) return;
  let data = null;
  try { data = await loadRecruitData(); } catch (e) {}
  const sources = data || RECRUIT_FALLBACKS;
  let best = null;
  Object.values(sources).forEach(d => {
    if (!d || !d.start || !d.end) return;
    const st = getStatus(d.start, d.end);
    const dd = getDday(d.start, d.end, st);
    if (!dd) return;
    const num = dd === 'D-Day' ? 0 : parseInt(dd.replace('D-', ''), 10);
    const rank = st === 'open' ? 0 : (st === 'upcoming' ? 1 : 2);
    if (!best || rank < best.rank || (rank === best.rank && num < best.num)) {
      best = { rank, num, dday: dd, status: st };
    }
  });
  if (!best || best.status === 'closed') return;
  const label = best.status === 'open'
    ? (best.dday === 'D-Day' ? '오늘 마감' : `모집 중 · ${best.dday} 마감`)
    : (best.dday === 'D-Day' ? '오늘 오픈' : `다음 모집 ${best.dday}`);
  badges.forEach(el => { el.textContent = label; el.hidden = false; });
}
```

- [ ] **Step 3: index.html 호출 연결** — 현재 `applyIndexRecruit().then(chxSyncStates);`을 교체:

```js
  applyIndexRecruit().then(chxSyncStates).then(function () {
    if (typeof applyGlobalRecruitCta === 'function') applyGlobalRecruitCta();
  });
```

- [ ] **Step 4: 검증** — 프리뷰 로드 후 2초 뒤 실행(모집 데이터 로드 대기):

```js
(async () => { await new Promise(r=>setTimeout(r,2500)); return [...document.querySelectorAll('[data-recruit-cta-badge]')].map(el => ({ hidden: el.hidden, text: el.textContent })); })()
```
Expected: 각 뱃지가 `hidden: false`이고 `text`가 `모집 중 · D-N 마감` / `다음 모집 D-N` / `오늘 마감` 중 하나. (현재 하드코딩 모집일이 과거라 데이터 없으면 `closed`뿐 → 뱃지 숨김 유지도 정상. 콘솔 `[MONC 모집]` 로그로 데이터 유무 확인.)

- [ ] **Step 5: 커밋**

```bash
git add recruit.js index.html
git commit -m "feat(conv): 히어로·하단 CTA에 모집 임박 뱃지 연동 + 모집데이터 fetch 메모이즈"
```

---

### Task 4: 인트로 건너뛰기 버튼 (A)

창문 인트로 연출은 100% 보존하고, 스케일 핀 밖(태그라인과 형제)에 '건너뛰기' pill을 얹는다. `monc:zoomprogress`(0~1) 구독으로 0.85 이상이면 숨긴다.

**Files:**
- Modify: `index.html` (CSS: `.ht-cue` reduced-motion 블록 ~line 1660 근처 / 마크업: `.hero-tagline` 닫힘 뒤 ~line 1916 / JS: `</body>` 직전)

- [ ] **Step 1: CSS 추가** — `@media (prefers-reduced-motion: reduce) { .ht-cue { animation: none; } }` 블록 다음에 삽입:

```css
    .hero-skip {
      position: fixed; z-index: 60;
      right: 16px; bottom: calc(20px + env(safe-area-inset-bottom, 0px));
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 13px; font-weight: 700; letter-spacing: -.01em;
      color: #F6F1E7; text-decoration: none;
      background: rgba(0,0,0,.28);
      border: 1px solid rgba(246,241,231,.45); border-radius: 999px;
      padding: 8px 15px;
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      transition: opacity .3s ease;
    }
    .hero-skip.is-gone { opacity: 0; pointer-events: none; }
    @media (max-width: 768px) {
      .hero-skip { bottom: calc(84px + env(safe-area-inset-bottom, 0px)); }
    }
```

- [ ] **Step 2: 마크업 추가** — `.hero-tagline`(`<div class="hero-tagline" id="heroTagline">…</div>`)을 닫는 `</div>` 다음, `</section>`(hero-window-intro 닫힘) 직전에 삽입:

```html
  <a class="hero-skip" id="heroSkip" href="#home" aria-label="인트로 건너뛰고 바로 보기">건너뛰기 <span aria-hidden="true">↓</span></a>
```

- [ ] **Step 3: JS 추가** — `</body>` 태그 바로 앞에 삽입:

```html
<script>
(function () {
  var wrap = document.querySelector('.hero-window-intro');
  var skip = document.getElementById('heroSkip');
  if (!wrap || !skip) return;
  wrap.addEventListener('monc:zoomprogress', function (e) {
    skip.classList.toggle('is-gone', (e.detail && e.detail.progress) >= 0.85);
  });
  window.addEventListener('scroll', function () {
    var r = wrap.getBoundingClientRect();
    if (r.bottom < window.innerHeight * 0.5) skip.classList.add('is-gone');
  }, { passive: true });
  skip.addEventListener('click', function (ev) {
    var home = document.getElementById('home');
    if (!home) return;
    ev.preventDefault();
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    home.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  });
})();
</script>
```

- [ ] **Step 4: 검증** — 프리뷰(스크롤 top) 실행:

```js
(() => { const s=document.getElementById('heroSkip'); const cs=getComputedStyle(s); const r=s.getBoundingClientRect(); return { exists:!!s, href:s.getAttribute('href'), pos:cs.position, z:cs.zIndex, gone:s.classList.contains('is-gone'), inView: r.top<innerHeight&&r.bottom>0 }; })()
```
Expected: `{ exists:true, href:"#home", pos:"fixed", z:"60", gone:false, inView:true }`. 이어서 아래로 스크롤 후 재실행 시 `gone:true` 확인:
```js
window.scrollTo(0, document.querySelector('.hero-scene').offsetTop); document.getElementById('heroSkip').classList.contains('is-gone')
```
Expected: `true`.

- [ ] **Step 5: 커밋**

```bash
git add index.html
git commit -m "feat(conv): 인트로 건너뛰기 버튼 추가 — 3화면 연출 이탈 완화(연출 자체는 보존)"
```

---

### Task 5: 감정 피크 CTA 병기 (D)

Before/After 섹션 끝과 커뮤니티(후기) 섹션에 신청 CTA를 심어, 하단바 하나에만 의존하던 중간 구간에 전환 동선을 만든다.

**Files:**
- Modify: `index.html` (Before/After 섹션 끝 ~line 2167 / 커뮤니티 CTA ~line 2240-2242)

- [ ] **Step 1: Before/After 섹션 CTA** — `.ba-grid`를 닫는 `</div>`(카드 4장을 감싼 그리드) 다음, `.container`를 닫는 `</div>` 직전에 삽입:

```html
      <div class="ba-cta reveal" data-reveal style="text-align:center; margin-top:36px;">
        <a class="btn btn-action" href="apply.html">나도 이렇게 바뀌기 →</a>
      </div>
```
(정확한 위치: `<a class="ba-detail-link" href="challenge-expression.html">전체 스토리 보기 →</a>`로 끝나는 마지막 `.ba-card` 다음의 `</div>`(그리드 닫힘)와 `</div>`(컨테이너 닫힘) 사이.)

- [ ] **Step 2: 커뮤니티 CTA 병기** — 현재 후기 CTA 블록을 교체.

현재:
```html
    <div class="reveal" style="text-align:center; margin-top:36px;">
      <a class="mc-cta" href="reviews.html">후기 더 보기 →</a>
    </div>
```
교체 후:
```html
    <div class="reveal" style="text-align:center; margin-top:36px; display:flex; flex-wrap:wrap; gap:12px; justify-content:center; align-items:center;">
      <a class="btn btn-action" href="apply.html">지금 신청하기</a>
      <a class="mc-cta" href="reviews.html">후기 더 보기 →</a>
    </div>
```

- [ ] **Step 3: 검증** — 실행:

```js
(() => { const ba=document.querySelector('#before-after .ba-cta a'); const co=[...document.querySelectorAll('#community a')].find(a=>a.getAttribute('href')==='apply.html'); return { baHref: ba&&ba.getAttribute('href'), baText: ba&&ba.textContent.trim(), communityApply: !!co }; })()
```
Expected: `{ baHref:"apply.html", baText:"나도 이렇게 바뀌기 →", communityApply:true }`

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "feat(conv): Before/After·후기 섹션에 신청 CTA 병기 — 감정 피크 구간 전환 동선"
```

---

### Task 6: 진단(advisor) 섹션을 챌린지 카드 위로 이동 (E)

"고민되면 진단 → 추천 → 카드"로 결정→행동 흐름을 좁힌다. `advisor` IIFE·recruit.js는 셀렉터 기반이라 마크업 블록만 옮기면 된다.

**Files:**
- Modify: `index.html` (`<section class="advisor" id="advisor">…</section>` ~line 2349-2405 → `<!-- CHALLENGES -->`/`<section class="challenges">` ~line 2252 앞으로)

- [ ] **Step 1: advisor 섹션 제거** — `<section class="advisor" id="advisor">`부터 그에 대응하는 `</section>`까지 전체 블록을 잘라낸다(원문 보관). 제거 후 그 자리에는 아무것도 남기지 않는다(앞뒤 `instructors`/`member-appeal` 주석은 유지).

- [ ] **Step 2: challenges 앞에 삽입** — `<!-- CHALLENGES -->` 주석(과 `<section class="challenges" id="challenges">`) 바로 앞에 Step 1에서 잘라낸 advisor 섹션 전체를 붙여넣는다.

- [ ] **Step 3: 검증** — 섹션 순서(docTop) 확인:

```js
(() => { const ids=['community','advisor','challenges','instructors','member-appeal']; return ids.map(id=>({id, top: Math.round(document.getElementById(id).getBoundingClientRect().top+scrollY)})).sort((a,b)=>a.top-b.top).map(x=>x.id); })()
```
Expected: `["community","advisor","challenges","instructors","member-appeal"]` (advisor가 challenges보다 앞).

- [ ] **Step 4: 진단 기능 무결성 확인** — 콘솔 에러 없음(`read_console_messages` onlyErrors) + 진단 첫 문항 렌더 확인:
```js
!!document.querySelector('#advStage .adv-q[data-q="0"] .adv-opt')
```
Expected: `true`.

- [ ] **Step 5: 커밋**

```bash
git add index.html
git commit -m "refactor(conv): 진단 섹션을 챌린지 카드 위로 이동 — 결정→행동 흐름 정렬"
```

---

### Task 7: 챌린지 카드 '바로 신청' 병기 + 카드 a→div 전환 (F)

카드 본문 클릭=상세페이지(설득 자산 유지), 별도 '바로 신청' 버튼=`apply.html?c=<id>` 프리셀렉트. 앵커 중첩을 피하려 카드 `<a>`→`<div>`로 바꾸고 stretched-link로 상세 링크를 유지한다. 캐러셀 JS는 슬라이드를 앵커로 쓰지 않으므로(오직 `dataset.idx`/`classList`/DOM 이동) 안전하다.

**Files:**
- Modify: `index.html` (카드 4개 마크업 ~line 2287-2322 / CSS: `.chx-slide` 계열 ~line 452-545 근처)
- 매핑: voice→`challenge-voice.html`/`apply.html?c=voice`, expression→`challenge-expression.html`/`?c=expression`, spinning→`challenge-spinning.html`/`?c=spinning`, answer→`challenge-answer.html`/`?c=answer`.

- [ ] **Step 1: CSS 추가** — `.chx-slide.is-disabled { pointer-events: none !important; }` 규칙 근처에 추가:

```css
    .chx-detaillink { position: absolute; inset: 0; z-index: 1; text-indent: -9999px; overflow: hidden; }
    .chx-info { position: relative; z-index: 2; }
    .chx-apply {
      display: inline-flex; align-items: center; gap: 4px;
      margin-top: 10px; padding: 9px 16px; border-radius: 999px;
      font-size: 13px; font-weight: 800; letter-spacing: -.01em;
      background: var(--action); color: var(--action-ink); text-decoration: none;
      box-shadow: 0 6px 18px rgba(242,121,69,.28);
    }
    .chx-slide.is-disabled .chx-apply { opacity: .5; }
```

- [ ] **Step 2: 카드 1(voice) 교체** — 현재:
```html
        <a class="challenge-card chx-slide is-active" href="challenge-voice.html" data-idx="0" data-recruit-id="voice" data-recruit-start="2026-06-01" data-recruit-end="2026-06-28">
```
을 다음으로(여는 태그만 변경):
```html
        <div class="challenge-card chx-slide is-active" data-idx="0" data-recruit-id="voice" data-recruit-start="2026-06-01" data-recruit-end="2026-06-28">
          <a class="chx-detaillink" href="challenge-voice.html" tabindex="-1" aria-label="보신각 상세 보기">보신각 상세</a>
```
그리고 이 카드의 닫는 `</a>`를 `</div>`로 변경. `.chx-info` 안 `<span class="challenge-action">내 목소리 바꿔보기 →</span>` 다음에 추가:
```html
            <a class="chx-apply" href="apply.html?c=voice">바로 신청 →</a>
```

- [ ] **Step 3: 카드 2(expression) 교체** — 여는 태그를 `<div class="challenge-card chx-slide" data-idx="1" data-recruit-id="expression" data-recruit-start="2026-06-08" data-recruit-end="2026-07-05">`로 바꾸고 그 다음 줄에 `<a class="chx-detaillink" href="challenge-expression.html" tabindex="-1" aria-label="영합각 상세 보기">영합각 상세</a>` 추가. 닫는 `</a>`→`</div>`. `.chx-info`의 `<span class="challenge-action">영상면접 감각 깨우기 →</span>` 다음에 `<a class="chx-apply" href="apply.html?c=expression">바로 신청 →</a>` 추가.

- [ ] **Step 4: 카드 3(spinning) 교체** — 여는 태그를 `<div class="challenge-card chx-slide" data-idx="2" data-recruit-id="spinning" data-recruit-start="2026-06-02" data-recruit-end="2026-06-29">`로, 다음 줄에 `<a class="chx-detaillink" href="challenge-spinning.html" tabindex="-1" aria-label="스피닝 상세 보기">스피닝 상세</a>` 추가. 닫는 `</a>`→`</div>`. `<span class="challenge-action">말하기 감각 깨우기 →</span>` 다음에 `<a class="chx-apply" href="apply.html?c=spinning">바로 신청 →</a>` 추가.

- [ ] **Step 5: 카드 4(answer) 교체** — 여는 태그를 `<div class="challenge-card chx-slide" data-idx="3" data-recruit-id="answer" data-recruit-start="2026-06-09" data-recruit-end="2026-07-06">`로, 다음 줄에 `<a class="chx-detaillink" href="challenge-answer.html" tabindex="-1" aria-label="승자각 상세 보기">승자각 상세</a>` 추가. 닫는 `</a>`→`</div>`. `<span class="challenge-action">합격 답변 만들기 →</span>` 다음에 `<a class="chx-apply" href="apply.html?c=answer">바로 신청 →</a>` 추가.

- [ ] **Step 6: 검증(구조·링크)** — 실행:

```js
(() => { const cards=[...document.querySelectorAll('.challenge-card')]; return { count: cards.length, allDiv: cards.every(c=>c.tagName==='DIV'), detail: cards.map(c=>c.querySelector('.chx-detaillink')?.getAttribute('href')), apply: cards.map(c=>c.querySelector('.chx-apply')?.getAttribute('href')) }; })()
```
Expected: `count:4, allDiv:true, detail:["challenge-voice.html","challenge-expression.html","challenge-spinning.html","challenge-answer.html"], apply:["apply.html?c=voice","apply.html?c=expression","apply.html?c=spinning","apply.html?c=answer"]`

- [ ] **Step 7: 검증(캐러셀 무결성)** — 데스크톱(≥769px)에서 이름 클릭 이동 로직이 살아있는지 + 콘솔 에러 없는지 확인:
```js
(() => { const items=[...document.querySelectorAll('.chx-item')]; const slides=[...document.querySelectorAll('.chx-slide')]; return { items: items.length, slides: slides.length, activeSlide: !!document.querySelector('.chx-slide.is-active'), hrefOnItems: items.map(i=>i.dataset.href) }; })()
```
Expected: `items:4, slides:4, activeSlide:true, hrefOnItems`가 4개 상세 URL. `read_console_messages`(onlyErrors) 결과 비어 있음.

- [ ] **Step 8: 커밋**

```bash
git add index.html
git commit -m "feat(conv): 챌린지 카드에 '바로 신청' 병기 — 카드 a→div stretched-link(상세 유지)"
```

---

### Task 8: 전체 모바일 퍼널 재측정 + 마무리

**Files:** 없음(검증만)

- [ ] **Step 1: 모바일(375px) 전면 재측정** — 개편 전 지도와 대비:

```js
(() => { const vh=innerHeight; const q=s=>document.querySelector(s); const has=(sel,txt)=>[...document.querySelectorAll(sel)].some(a=>(a.textContent||'').includes(txt)); return {
  heroCta: !!q('.hero-scene .hs-cta-btn'),
  heroSkip: !!q('#heroSkip'),
  bottomBarFull: q('.mobile-cta-bar').getBoundingClientRect().width > innerWidth-40,
  baCta: !!q('#before-after .ba-cta a'),
  communityApply: [...document.querySelectorAll('#community a')].some(a=>a.getAttribute('href')==='apply.html'),
  order: ['community','advisor','challenges'].map(id=>Math.round(q('#'+id).getBoundingClientRect().top+scrollY)),
  cardApply: document.querySelectorAll('.chx-apply').length,
  applyAnchors: document.querySelectorAll('a[href^="apply.html"]').length
}; })()
```
Expected: `heroCta:true, heroSkip:true, bottomBarFull:true, baCta:true, communityApply:true, order` 오름차순(community<advisor<challenges), `cardApply:4`, `applyAnchors` ≥ 8.

- [ ] **Step 2: 콘솔/네트워크 에러 확인** — `read_console_messages`(onlyErrors) 비어 있음. `preview_logs`(level error) 비어 있음.

- [ ] **Step 3: 데스크톱(1280px) 회귀 확인** — `resize_window` desktop 후 Step 1 재실행: 히어로 CTA·카드·재배치가 데스크톱에서도 정상(캐러셀 활성 슬라이드 존재, 레이아웃 깨짐 없음).

- [ ] **Step 4: 최종 상태 보고** — 변경 요약 + 커밋 로그를 사용자에게 제시하고, 배포(main 병합/푸시) 여부를 물어본다. **자동 푸시 금지** — 배포는 사용자 승인 후.

---

## Self-Review (작성자 점검)

- **Spec 커버리지:** A(Task 4)·B(Task 1)·C(Task 2+3)·D(Task 5)·E(Task 6)·F(Task 7)·G(Task 1·2의 오퍼 문구로 충족)·H(Task 3~8 검증 스니펫) — 전부 대응됨.
- **플레이스홀더:** 없음(모든 코드 블록 실제 값).
- **타입/명명 일관성:** `[data-recruit-cta-badge]`(Task 1·2 마크업 ↔ Task 3 `applyGlobalRecruitCta` 셀렉터) 일치, `.chx-detaillink`/`.chx-apply`(Task 1 CSS 아님·Task 7 CSS ↔ Task 7 마크업·검증) 일치, `.hs-cta`/`.hs-cta-btn`(Task 1) 일치, `#heroSkip`/`.hero-skip`/`is-gone`(Task 4) 일치.
- **리스크:** 카드 `a→div` 시 태그 결합 CSS 셀렉터가 있으면 확인 필요 → grep 결과 `.challenge-card`/`.chx-slide`는 클래스 셀렉터라 무관(확인 완료). `.chx-slide.is-disabled`가 카드 전체 pointer-events를 끄므로 마감 카드의 '바로 신청'도 자동 비활성(의도된 동작).
