# MONC 전체 디자인 리디자인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MONC 사이트(index.html + 상세페이지 4개 + 약관/개인정보 페이지)의 컬러·타이포·스크롤 연출을 Jesko Jets 레퍼런스에서 차용한 미니멀 스크롤텔링 구조 + "Warm Sunrise"(크림+코랄) 팔레트로 전면 교체한다.

**Architecture:** 신규 `tokens.css`(공용 디자인 토큰) + `scroll-fx.js`(reveal/sticky-panel/count-up 3종 컴포넌트)를 만들어 index.html과 상세페이지 4개가 공유한다. 기존 CSS 변수 이름(`--primary`, `--action`, `--bg` 등)은 그대로 유지하고 **값만 교체**하여, 변수를 참조하는 기존 CSS 규칙은 손대지 않는다. 변수를 거치지 않는 하드코딩된 구(舊) 팔레트 RGB 리터럴은 정확한 10진수 패턴으로 전역 치환한다.

**Tech Stack:** 순수 정적 HTML/CSS/JS (번들러 없음), Pretendard 가변 폰트(CDN), `IntersectionObserver` 기반 스크롤 연출.

**검증 방법:** 이 저장소는 테스트 스위트/린트가 없다 (CLAUDE.md 명시). 각 태스크의 검증은 `python -m http.server 5500`(또는 `wkon-static` 프리뷰)로 브라우저에서 렌더링 확인 + `grep`으로 잔여 구 팔레트 리터럴 0건 확인으로 대체한다.

---

## 색상 매핑 표 (전 태스크 공통 참조)

| 변수 | 구(舊) 값 | 신(新) 값 | 비고 |
|---|---|---|---|
| `--primary` | `#D63384` | `#241A12` | 웜 니어블랙 (장식/강조 텍스트) |
| `--primary-light` | `#E8608A` | `#6B4A32` | 중간 웜브라운 |
| `--primary-dark` | `#B02871` | `#1A120C` | 더 짙은 니어블랙 |
| `--rose` | `#FF6B9D` | `#9A5B1E` | 라벨/eyebrow 웜브라운, 그라디언트 2단계 |
| `--rose-light` | `#FF85B3` | `#B87A3D` | 밝은 웜브라운 |
| `--coral` | `#FF8FAB` | `#FF6B35` | 코랄 (그라디언트 3단계 — 니어블랙→브라운→코랄로 "선셋" 그라디언트 완성) |
| `--peach` | `#FFB3C6` | `#FFB088` | 라이트 코랄 틴트 |
| `--lavender` | `#E8B4D4` | `#F0D9BC` | 웜 크림탄 |
| `--blush` | `#FCE4EC` | `#FFF3E6` | 크림 |
| `--bg` | `#FFF5F8` | `#FFFAF3` | 기본 배경 (크림) |
| `--bg2` | `#FFEEF4` | `#FFF3E6` | 밝은 크림 대체 배경 |
| `--bg3` | `#FFE4EF` | `#FFEBD6` | 스크롤바 트랙 등 |
| `--surface` | `#FFFFFF` | `#FFFFFF` | 변경 없음 |
| `--surface2` | `#FFF0F5` | `#FFF7ED` | 크림 화이트 |
| `--text` | `#2D1022` | `#241A12` | `--primary`와 통일 |
| `--text-muted` | `#7D4A66` | `#6B5744` | 웜 그레이브라운 |
| `--text-dim` | `#B08098` | `#A8968A` | 라이트 웜 그레이 |
| `--border` | `rgba(214,51,132,0.15)` | `rgba(36,26,18,0.15)` | 니어블랙 헤어라인 |
| `--border-soft` | `rgba(214,51,132,0.08)` | `rgba(36,26,18,0.08)` | |
| `--shadow` | `0 4px 20px rgba(214,51,132,0.10)` | `0 4px 20px rgba(36,26,18,0.10)` | |
| `--shadow-lg` | `... 0.18` | `... rgba(36,26,18,0.18)` | |
| `--shadow-xl` | `... 0.22` | `... rgba(36,26,18,0.22)` | |
| `--action` | `#0C8091` | `#C9471E` | CTA 전용 코랄 (흰 텍스트 대비 4.5:1+ 확인됨, 아래 계산 참조) |
| `--action-dark` | `#0A6E7C` | `#A83A18` | hover |
| `--action-tint` | `#ECFEFF` | `#FFF0E8` | 라이트 코랄 틴트 배경 |
| `--shadow-action` | `rgba(12,128,145,0.32)` | `rgba(201,71,30,0.32)` | |
| `--shadow-action-lg` | `rgba(12,128,145,0.45)` | `rgba(201,71,30,0.45)` | |

**`--action: #C9471E` 대비 검증**: 흰 텍스트(`#FFFFFF`) 대비 명도 대비비 ≈ **4.69:1** (WCAG AA 4.5:1 통과). `#FF6B35`(밝은 코랄)는 흰 텍스트 대비 2.83:1로 AA 미달이므로 **버튼 배경/흰 텍스트 조합에는 반드시 `--action`(`#C9471E`)을 쓰고, `#FF6B35`는 그라디언트 강조·라이트 틴트 등 텍스트가 얹히지 않는 장식 용도로만 사용**한다.

**신규 토큰 (추가)**:
```css
--bg-dark: #241A12;
--text-on-dark: #FFFAF3;
--fs-display: clamp(40px, 9vw, 96px);
--fw-light: 300;
```
`--fw-bold`는 기존 `800` → `700`으로 변경 (Pretendard Bold, 확정된 "라이트 베이스 + 굵은 강조" 전략에 맞춤).

**전역 리터럴 치환 규칙 (전 대상 파일 공통)**:
- `#D63384` → `#241A12`
- `#FF6B9D` → `#9A5B1E`
- `#FF8FAB` → `#FF6B35`
- `#FFB3C6` → `#FFB088`
- `#E8B4D4` → `#F0D9BC`
- `#FCE4EC` → `#FFF3E6`
- `#0C8091` → `#C9471E`
- `rgba(214, 51, 132,` / `rgba(214,51,132,` → `rgba(36, 26, 18,`
- `rgba(12, 128, 145,` / `rgba(12,128,145,` → `rgba(201, 71, 30,`

---

### Task 1: `tokens.css` 생성

**Files:**
- Create: `tokens.css`

- [ ] **Step 1: 파일 작성**

```css
/* MONC 디자인 토큰 — Warm Sunrise. index.html + 상세페이지 4개 + 약관/개인정보 페이지가 공유. */
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css');

:root {
  --primary: #241A12;
  --primary-light: #6B4A32;
  --primary-dark: #1A120C;
  --rose: #9A5B1E;
  --rose-light: #B87A3D;
  --coral: #FF6B35;
  --peach: #FFB088;
  --lavender: #F0D9BC;
  --blush: #FFF3E6;
  --bg: #FFFAF3;
  --bg2: #FFF3E6;
  --bg3: #FFEBD6;
  --surface: #FFFFFF;
  --surface2: #FFF7ED;
  --text: #241A12;
  --text-muted: #6B5744;
  --text-dim: #A8968A;
  --border: rgba(36,26,18,0.15);
  --border-soft: rgba(36,26,18,0.08);

  --bg-dark: #241A12;
  --text-on-dark: #FFFAF3;

  --radius-xs: 8px;
  --radius-sm: 14px;
  --radius: 20px;
  --radius-lg: 24px;

  --space-1: 8px;  --space-2: 16px; --space-3: 24px; --space-4: 32px;
  --space-5: 40px; --space-6: 48px; --space-8: 64px;
  --section-y: 88px; --section-y-mobile: 52px;

  --shadow: 0 4px 20px rgba(36,26,18,0.10);
  --shadow-lg: 0 12px 48px rgba(36,26,18,0.18);
  --shadow-xl: 0 24px 64px rgba(36,26,18,0.22);

  /* ── Action Color (코랄) — CTA 전용 강조색 ──
     --action 은 흰 글씨 대비 4.69:1 로 WCAG AA 통과
     (밝은 코랄 #FF6B35 는 흰 텍스트 대비 2.83:1 로 AA 미달이라 CTA 배경에는 쓰지 않음) */
  --action: #C9471E;
  --action-dark: #A83A18;
  --action-tint: #FFF0E8;
  --shadow-action: 0 8px 24px rgba(201,71,30,0.32);
  --shadow-action-lg: 0 12px 32px rgba(201,71,30,0.45);

  --fs-h1: clamp(28px, 6vw, 48px);
  --fs-h2: clamp(26px, 4vw, 32px);
  --fs-h3: 20px;
  --fs-body: 17px;
  --fs-caption: 14px;
  --fs-display: clamp(40px, 9vw, 96px);
  --lh-tight: 1.18;
  --lh-body: 1.7;
  --ls-tight: -0.02em;
  --fw-light: 300;
  --fw-bold: 700;
  --fw-semi: 600;
  --fw-med: 500;
}
```

- [ ] **Step 2: 브라우저에서 로드만 확인**

`tokens.css`는 아직 어떤 HTML에서도 `<link>`하지 않았으므로 렌더링 영향은 없다. 이 단계는 파일 문법 오류가 없는지만 확인:

Run: `python -c "import re; content=open('tokens.css',encoding='utf-8').read(); assert content.count('{')==content.count('}'), 'brace mismatch'; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add tokens.css
git commit -m "feat(design): Warm Sunrise 디자인 토큰 파일(tokens.css) 추가"
```

---

### Task 2: `scroll-fx.js` — `reveal` 컴포넌트

**Files:**
- Create: `scroll-fx.js`

- [ ] **Step 1: 파일 작성 (reveal만)**

```javascript
(function () {
  'use strict';

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initReveal() {
    var els = document.querySelectorAll('[data-reveal]');
    if (!els.length) return;

    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('is-revealed'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

    els.forEach(function (el) { observer.observe(el); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initReveal();
  });

  window.MoncScrollFx = window.MoncScrollFx || {};
  window.MoncScrollFx.initReveal = initReveal;
})();
```

- [ ] **Step 2: 대응 CSS를 `tokens.css`에 추가**

`tokens.css` 맨 끝에 추가:

```css
[data-reveal] {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
[data-reveal].is-revealed {
  opacity: 1;
  transform: translateY(0);
}
@media (prefers-reduced-motion: reduce) {
  [data-reveal] { transition: none; }
}
```

- [ ] **Step 3: 임시 테스트 페이지로 동작 확인**

`scratchpad`에 임시 파일을 만들어 확인한다 (저장소에는 커밋하지 않음):

```html
<!-- C:\Users\cheess\AppData\Local\Temp\claude\...\scratchpad\reveal-test.html -->
<!DOCTYPE html><html><head>
<link rel="stylesheet" href="file:///C:/Users/cheess/Documents/GitHub/wkon/tokens.css">
</head><body style="height:200vh">
<div data-reveal style="margin-top:150vh;padding:40px;background:#eee">스크롤하면 나타남</div>
<script src="file:///C:/Users/cheess/Documents/GitHub/wkon/scroll-fx.js"></script>
</body></html>
```

브라우저로 열어 아래로 스크롤 시 박스가 fade+slide-up 되는지 확인. 확인 후 임시 파일은 삭제.

- [ ] **Step 4: Commit**

```bash
git add scroll-fx.js tokens.css
git commit -m "feat(design): scroll-fx.js reveal 컴포넌트 추가"
```

---

### Task 3: `scroll-fx.js` — `sticky-panel` 컴포넌트 추가

**Files:**
- Modify: `scroll-fx.js`
- Modify: `tokens.css`

- [ ] **Step 1: `initStickyPanel` 함수 추가**

`scroll-fx.js`의 `initReveal` 함수 뒤, `document.addEventListener` 앞에 추가:

```javascript
  function initStickyPanel() {
    var panels = document.querySelectorAll('[data-sticky-panel]');
    if (!panels.length) return;

    if (prefersReducedMotion) {
      panels.forEach(function (panel) {
        panel.querySelectorAll('[data-sticky-to]').forEach(function (to) {
          to.style.opacity = 1;
        });
        panel.querySelectorAll('[data-sticky-from]').forEach(function (from) {
          from.style.opacity = 0;
        });
      });
      return;
    }

    var ticking = false;

    function update() {
      ticking = false;
      panels.forEach(function (panel) {
        var rect = panel.getBoundingClientRect();
        var vh = window.innerHeight;
        var progress = Math.min(1, Math.max(0, (vh - rect.top) / (rect.height + vh)));
        var from = panel.querySelector('[data-sticky-from]');
        var to = panel.querySelector('[data-sticky-to]');
        if (from) {
          from.style.opacity = String(1 - progress);
          from.style.transform = 'translateY(' + (-progress * 24) + 'px)';
        }
        if (to) {
          to.style.opacity = String(progress);
          to.style.transform = 'translateY(' + ((1 - progress) * 24) + 'px)';
        }
      });
    }

    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    update();
  }
```

`document.addEventListener('DOMContentLoaded', ...)` 블록 안에 `initStickyPanel();` 호출 추가:

```javascript
  document.addEventListener('DOMContentLoaded', function () {
    initReveal();
    initStickyPanel();
  });
```

`window.MoncScrollFx` 객체에도 등록:

```javascript
  window.MoncScrollFx.initStickyPanel = initStickyPanel;
```

- [ ] **Step 2: 대응 CSS를 `tokens.css`에 추가**

```css
[data-sticky-panel] { position: relative; min-height: 100vh; }
[data-sticky-panel] > .sticky-inner { position: sticky; top: 0; height: 100vh; display: flex; align-items: center; }
[data-sticky-from], [data-sticky-to] {
  transition: opacity 0.3s linear, transform 0.3s linear;
  will-change: opacity, transform;
}
[data-sticky-to] { position: absolute; inset: 0; opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  [data-sticky-from], [data-sticky-to] { transition: none; }
}
```

- [ ] **Step 3: scratchpad 테스트 페이지로 확인**

Task 2의 테스트 방식과 동일하게 scratchpad에 `sticky-panel` 마크업으로 임시 페이지를 만들어 스크롤 시 `data-sticky-from` → `data-sticky-to`로 교차 페이드되는지 확인 후 삭제.

- [ ] **Step 4: Commit**

```bash
git add scroll-fx.js tokens.css
git commit -m "feat(design): scroll-fx.js sticky-panel 컴포넌트 추가"
```

---

### Task 4: `scroll-fx.js` — `count-up` 컴포넌트 추가

**Files:**
- Modify: `scroll-fx.js`

- [ ] **Step 1: `initCountUp` 함수 추가**

`initStickyPanel` 뒤에 추가:

```javascript
  function initCountUp() {
    var els = document.querySelectorAll('[data-count-up]');
    if (!els.length) return;

    function run(el) {
      var target = parseFloat(el.getAttribute('data-count-up'));
      var suffix = el.getAttribute('data-count-suffix') || '';
      if (prefersReducedMotion || isNaN(target)) {
        el.textContent = target + suffix;
        return;
      }
      var duration = 1200;
      var start = null;
      function step(ts) {
        if (start === null) start = ts;
        var progress = Math.min(1, (ts - start) / duration);
        var current = Math.round(target * progress);
        el.textContent = current + suffix;
        if (progress < 1) window.requestAnimationFrame(step);
      }
      window.requestAnimationFrame(step);
    }

    if (!('IntersectionObserver' in window)) {
      els.forEach(run);
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          run(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    els.forEach(function (el) { observer.observe(el); });
  }
```

`DOMContentLoaded` 리스너와 `MoncScrollFx` 등록에 추가:

```javascript
  document.addEventListener('DOMContentLoaded', function () {
    initReveal();
    initStickyPanel();
    initCountUp();
  });
  window.MoncScrollFx.initCountUp = initCountUp;
```

- [ ] **Step 2: scratchpad 테스트 페이지로 확인**

`<span data-count-up="527" data-count-suffix="명">0명</span>`를 화면 하단에 두고 스크롤 진입 시 0→527로 카운트업되는지 확인 후 삭제.

- [ ] **Step 3: Commit**

```bash
git add scroll-fx.js
git commit -m "feat(design): scroll-fx.js count-up 컴포넌트 추가"
```

---

### Task 5: `index.html` — 토큰 교체 + 전역 리터럴 치환

**Files:**
- Modify: `index.html:22-74` (기존 `:root` 블록)
- Modify: `index.html` 전체 (하드코딩 리터럴)

- [ ] **Step 1: 기존 `:root` 블록을 `tokens.css` link로 교체**

`index.html`의 `<head>`에서 `<style>` 태그 시작 직후, 기존 `:root { ... }` 블록(22~74행)을 통째로 삭제하고 `<style>` 태그 바로 앞에 추가:

```html
  <link rel="stylesheet" href="tokens.css">
  <style>
```

(기존 `--fw-bold: 800;`처럼 `tokens.css`에 없는 하드코딩이 `:root` 밖에 더 있는지 삭제 전에 `grep -n ":root" index.html`로 재확인)

- [ ] **Step 2: 전역 리터럴 치환**

```bash
sed -i \
  -e 's/#D63384/#241A12/g' \
  -e 's/#FF6B9D/#9A5B1E/g' \
  -e 's/#FF8FAB/#FF6B35/g' \
  -e 's/#FFB3C6/#FFB088/g' \
  -e 's/#E8B4D4/#F0D9BC/g' \
  -e 's/#FCE4EC/#FFF3E6/g' \
  -e 's/#0C8091/#C9471E/g' \
  -e 's/rgba(214,\s*51,\s*132,/rgba(36, 26, 18,/g' \
  -e 's/rgba(12,\s*128,\s*145,/rgba(201, 71, 30,/g' \
  index.html
```

- [ ] **Step 3: 잔여 리터럴 0건 확인**

Run: `grep -cE "#D63384|#FF6B9D|#FF8FAB|#FFB3C6|#E8B4D4|#FCE4EC|#0C8091|rgba\(214,\s*51,\s*132|rgba\(12,\s*128,\s*145" index.html`
Expected: `0`

- [ ] **Step 4: 브라우저로 시각 확인**

`python -m http.server 5500`(또는 `wkon-static` 프리뷰)로 `index.html`을 열어, 전체 배경이 크림톤으로, 신청 버튼(`.btn-action`)이 코랄톤으로 바뀌었는지 확인. 레이아웃 깨짐(요소 겹침, 텍스트 잘림) 없는지 스크롤하며 확인.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(design): index.html Warm Sunrise 팔레트로 전환"
```

---

### Task 6~9: 상세페이지 4개 — 토큰 교체 + 전역 리터럴 치환

**Files:**
- Modify: `challenge-voice.html`, `challenge-expression.html`, `challenge-spinning.html`, `challenge-answer.html`

각 파일마다 Task 5와 동일한 절차를 반복한다 (파일별로 별도 커밋).

- [ ] **Step 1: 기존 `:root` 블록을 `tokens.css` link로 교체**

각 파일의 `<head>` 안 `:root { ... }` 블록(각 파일 8행 부근, `grep -n ":root" <file>`로 정확한 라인 재확인 후)을 삭제하고 `<style>` 태그 앞에 추가:

```html
  <link rel="stylesheet" href="tokens.css">
  <style>
```

- [ ] **Step 2: 전역 리터럴 치환** (파일명만 바꿔 4번 반복)

```bash
for f in challenge-voice.html challenge-expression.html challenge-spinning.html challenge-answer.html; do
  sed -i \
    -e 's/#D63384/#241A12/g' \
    -e 's/#FF6B9D/#9A5B1E/g' \
    -e 's/#FF8FAB/#FF6B35/g' \
    -e 's/#FFB3C6/#FFB088/g' \
    -e 's/#E8B4D4/#F0D9BC/g' \
    -e 's/#FCE4EC/#FFF3E6/g' \
    -e 's/#0C8091/#C9471E/g' \
    -e 's/rgba(214,\s*51,\s*132,/rgba(36, 26, 18,/g' \
    -e 's/rgba(12,\s*128,\s*145,/rgba(201, 71, 30,/g' \
    "$f"
done
```

- [ ] **Step 3: 잔여 리터럴 0건 확인 (파일별)**

Run: `grep -cE "#D63384|#FF6B9D|#FF8FAB|#FFB3C6|#E8B4D4|#FCE4EC|#0C8091|rgba\(214,\s*51,\s*132|rgba\(12,\s*128,\s*145" challenge-voice.html challenge-expression.html challenge-spinning.html challenge-answer.html`
Expected: 각 파일 `0`

- [ ] **Step 4: 브라우저로 시각 확인 (파일별)**

각 상세페이지를 열어 전/후 오디오 재생·유튜브 임베드·다이어그램 등 기존 기능이 정상 동작하는지, 색상이 크림+코랄톤으로 바뀌었는지 확인.

- [ ] **Step 5: Commit (파일별 개별 커밋)**

```bash
git add challenge-voice.html && git commit -m "feat(design): challenge-voice.html Warm Sunrise 팔레트로 전환"
git add challenge-expression.html && git commit -m "feat(design): challenge-expression.html Warm Sunrise 팔레트로 전환"
git add challenge-spinning.html && git commit -m "feat(design): challenge-spinning.html Warm Sunrise 팔레트로 전환"
git add challenge-answer.html && git commit -m "feat(design): challenge-answer.html Warm Sunrise 팔레트로 전환"
```

---

### Task 10: `application-modal.js` — 리터럴 치환

**Files:**
- Modify: `application-modal.js`

이 파일은 CSS 변수가 아니라 하드코딩된 hex를 인라인 style에 직접 사용한다 (`color:#D63384` 등 35건). `tokens.css`를 참조하도록 리팩터링하지 않고, 다른 파일과 동일한 리터럴 치환만 적용한다 (로직 변경 없음, CLAUDE.md 상 가격/계좌 로직은 이번 스코프 아님).

- [ ] **Step 1: 전역 리터럴 치환**

```bash
sed -i \
  -e 's/#D63384/#241A12/g' \
  -e 's/#FF6B9D/#9A5B1E/g' \
  -e 's/rgba(214,\s*51,\s*132,/rgba(36, 26, 18,/g' \
  application-modal.js
```

- [ ] **Step 2: 잔여 리터럴 0건 확인**

Run: `grep -cE "#D63384|#FF6B9D|rgba\(214,\s*51,\s*132" application-modal.js`
Expected: `0`

- [ ] **Step 3: 브라우저로 신청 모달 동작 확인**

상세페이지(예: `challenge-voice.html`) 열어 "신청하기" 버튼으로 모달을 띄우고, 색상이 코랄/니어블랙 톤으로 바뀌었는지, 체크박스·가격 표시·복사 버튼(`copyAccount`)이 기존과 동일하게 동작하는지 확인.

- [ ] **Step 4: Commit**

```bash
git add application-modal.js
git commit -m "feat(design): application-modal.js Warm Sunrise 팔레트로 전환"
```

---

### Task 11: `terms.html`, `privacy.html` — 톤만 교체 (스크롤 이펙트 없음)

**Files:**
- Modify: `terms.html`, `privacy.html`

- [ ] **Step 1: `tokens.css` link 추가 + 기존 `:root`(있는 경우) 제거**

`grep -n ":root" terms.html privacy.html`로 인라인 `:root` 존재 여부 확인. 있으면 Task 5와 동일하게 `<link rel="stylesheet" href="tokens.css">`로 교체.

- [ ] **Step 2: 리터럴 치환**

```bash
sed -i \
  -e 's/#D63384/#241A12/g' \
  -e 's/#FF6B9D/#9A5B1E/g' \
  -e 's/#0C8091/#C9471E/g' \
  -e 's/rgba(214,\s*51,\s*132,/rgba(36, 26, 18,/g' \
  terms.html privacy.html
```

- [ ] **Step 3: 잔여 리터럴 0건 확인 + 브라우저 확인**

Run: `grep -cE "#D63384|#FF6B9D|#0C8091|rgba\(214,\s*51,\s*132" terms.html privacy.html`
Expected: 각 파일 `0`. 브라우저로 두 페이지 렌더링만 확인 — 스크롤 이펙트는 추가하지 않는다.

- [ ] **Step 4: Commit**

```bash
git add terms.html privacy.html
git commit -m "feat(design): 약관/개인정보 페이지 톤을 Warm Sunrise로 전환"
```

---

### Task 12: `index.html` — `scroll-fx.js` 연결 + 기본 섹션에 `reveal` 적용

**Files:**
- Modify: `index.html`

- [ ] **Step 1: `<script>` 추가**

`index.html`의 `</body>` 직전(기존 인라인 `<script>` 블록보다 앞)에 추가:

```html
<script src="scroll-fx.js"></script>
```

- [ ] **Step 2: `data-reveal` 속성 추가 (5개 섹션)**

`grep -n '<section' index.html`로 확인한 아래 섹션들의 최상위 카드/아이템 요소에 `data-reveal` 속성을 추가한다:

- `how` 섹션(2616행 부근): `.how-grid` 안의 각 스텝 카드
- `testimonials` 섹션(2653행 부근): 리뷰 카드 컨테이너 최상위 요소
- `challenges` 섹션(2672행 부근): `.challenge-card` 각각
- `instructors` 섹션(2906행 부근): 강사 카드 각각
- `categories` 섹션(3096행 부근): 카테고리 아이템 각각

예: `<div class="challenge-card">` → `<div class="challenge-card" data-reveal>`

- [ ] **Step 3: 브라우저 확인**

각 섹션까지 스크롤하며 카드들이 fade+slide-up으로 나타나는지 확인. `testimonials`는 기존 마퀴 자동 스크롤과 충돌하지 않는지(리뷰 카드가 무한 복제되는 마퀴 구조라면 `data-reveal`을 마퀴 컨테이너 전체가 아니라 섹션 헤더에만 적용) 확인.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(hero): index.html 주요 섹션에 scroll-fx reveal 적용"
```

---

### Task 13: `index.html` — `before-after` 섹션을 `sticky-panel`로 전환

**Files:**
- Modify: `index.html:2523-2615` (`ba-section`)

- [ ] **Step 1: 마크업 구조 변경**

`ba-section` 내부의 "전(前)" 텍스트 블록과 "후(後)" 텍스트 블록을 아래 구조로 감싼다 (기존 오디오 플레이어 마크업은 그대로 두고 텍스트 레이어만 감쌈):

```html
<div data-sticky-panel>
  <div class="sticky-inner">
    <div data-sticky-from>
      <!-- 기존 "전(前)" 카피 -->
    </div>
    <div data-sticky-to>
      <!-- 기존 "후(後)" 카피 -->
    </div>
  </div>
</div>
```

- [ ] **Step 2: 브라우저 확인**

`before-after` 섹션에 진입해 스크롤할 때 "전" 텍스트가 옅어지고 "후" 텍스트가 선명해지는지 확인. 오디오 재생 버튼이 여전히 클릭 가능한지(sticky-inner의 `position: sticky`가 클릭을 막지 않는지) 확인.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(hero): before-after 섹션에 sticky-panel 스크롤 연출 적용"
```

---

### Task 14: `index.html` — `community` 섹션을 다크 대비 섹션 + `count-up`으로 전환

**Files:**
- Modify: `index.html:3030-3095` (`community` 섹션)

- [ ] **Step 1: 배경/텍스트 색 다크 전환**

`community` 섹션의 최상위 요소에 인라인 스타일 추가:

```html
<section class="community" id="community" style="background: var(--bg-dark); color: var(--text-on-dark);">
```

섹션 내부에서 `var(--text)`, `var(--text-muted)`를 참조하던 하위 요소가 있다면 다크 배경 위에서 대비가 나오도록 `var(--text-on-dark)` 계열로 개별 확인 (해당 섹션 안에 몇 개나 있는지 `grep -n "community" -A 60 index.html`으로 확인 후 조정).

- [ ] **Step 2: 통계 숫자에 `data-count-up` 적용**

기존 통계 숫자 요소(예: 합격생 수)를 찾아:

```html
<span data-count-up="527" data-count-suffix="명">0명</span>
```

형태로 교체 (실제 숫자는 기존 하드코딩된 값을 그대로 사용).

- [ ] **Step 3: 브라우저 확인**

`community` 섹션이 다크 배경으로 렌더링되는지, 텍스트 대비가 충분한지(크림 텍스트가 니어블랙 배경 위에서 잘 읽히는지), 통계 숫자가 스크롤 진입 시 카운트업되는지 확인.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(hero): community 섹션 다크 대비 처리 + count-up 통계 적용"
```

---

### Task 15: `index.html` — `cta-section` 코랄 전환 + 모바일 CTA 바를 플로팅 알약으로 변경

**Files:**
- Modify: `index.html:3114-` (`cta-section`)
- Modify: `index.html` (`.mobile-cta-bar` 관련 CSS/HTML)

- [ ] **Step 1: `cta-section` 배경 확인**

Task 5의 전역 치환으로 `--action-tint`가 이미 코랄 계열로 바뀌어 있어야 한다. `grep -n "cta-section" -A 20 index.html`로 배경이 `var(--action-tint)` 또는 `var(--action)` 계열을 쓰는지 확인하고, 하드코딩된 값이 남아있다면 해당 변수 참조로 교체.

- [ ] **Step 2: `.mobile-cta-bar`를 플로팅 알약형으로 변경**

`grep -n "mobile-cta-bar" index.html`로 관련 CSS 규칙을 찾아 아래처럼 교체:

```css
.mobile-cta-bar {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  width: auto;
  max-width: calc(100vw - 32px);
  border-radius: 999px;
  padding: 12px 20px;
  box-shadow: var(--shadow-action-lg);
  background: var(--action);
}
```

(기존에 `width: 100%; left: 0; right: 0;` 등 전체 폭 바 스타일이 있었다면 제거)

- [ ] **Step 3: 브라우저로 모바일 뷰포트 확인**

`preview_resize`로 모바일(375px) 뷰포트로 전환해 하단 CTA가 화면 폭 전체 바가 아니라 중앙 정렬된 알약형 버튼으로 보이는지, 스크롤 시 다른 콘텐츠를 가리지 않는지 확인.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(hero): cta-section 코랄 전환 + 모바일 CTA를 플로팅 알약형으로 변경"
```

---

### Task 16: 상세페이지 4개 — `scroll-fx.js` 연결 + 히어로 영역 `reveal`

**Files:**
- Modify: `challenge-voice.html`, `challenge-expression.html`, `challenge-spinning.html`, `challenge-answer.html`

- [ ] **Step 1: `<script>` 추가 (파일별)**

각 파일의 `</body>` 직전에 추가:

```html
<script src="scroll-fx.js"></script>
```

- [ ] **Step 2: 히어로 영역에 `data-reveal` 추가 (파일별)**

각 파일에서 히어로 타이틀/배지/설명 블록의 최상위 요소에 `data-reveal` 속성 추가 (`grep -n "hero-badge\|hero-desc" <file>`로 위치 확인).

- [ ] **Step 3: 브라우저 확인 (파일별)**

각 상세페이지를 새로고침하며 히어로 영역이 페이드인되는지, 기존 오디오/영상 기능이 정상 동작하는지 확인.

- [ ] **Step 4: Commit (파일별)**

```bash
git add challenge-voice.html && git commit -m "feat(hero): challenge-voice.html에 scroll-fx reveal 적용"
git add challenge-expression.html && git commit -m "feat(hero): challenge-expression.html에 scroll-fx reveal 적용"
git add challenge-spinning.html && git commit -m "feat(hero): challenge-spinning.html에 scroll-fx reveal 적용"
git add challenge-answer.html && git commit -m "feat(hero): challenge-answer.html에 scroll-fx reveal 적용"
```

---

### Task 17: 타이포그래피 — 라이트 베이스 + 강조 단어 굵게 (히어로 헤드라인)

**Files:**
- Modify: `index.html` (히어로 헤드라인)
- Modify: 상세페이지 4개 (히어로 헤드라인)

- [ ] **Step 1: index.html 히어로 헤드라인 굵기 전환**

`grep -n "fs-h1" index.html`로 히어로 `<h1>` 요소를 찾는다. 기존 `font-weight:800`(또는 `var(--fw-bold)`, 이제 700) 전체 적용을 `font-weight: var(--fw-light)`로 바꾸고, 핵심 키워드 1~2개만 `<strong style="font-weight: var(--fw-bold);">`로 감싼다.

예시 (실제 카피는 파일에서 확인한 문구 유지):
```html
<h1 style="font-weight: var(--fw-light);">
  <strong style="font-weight: var(--fw-bold);">합격</strong>까지 단 2주
</h1>
```

- [ ] **Step 2: 상세페이지 4개도 동일 적용**

각 파일의 히어로 타이틀에 동일한 라이트+강조 패턴 적용.

- [ ] **Step 3: 브라우저 확인**

5개 페이지 전부에서 헤드라인이 얇은 기본 굵기 + 핵심어만 굵게 보이는지, 가독성이 떨어지지 않는지 확인.

- [ ] **Step 4: Commit**

```bash
git add index.html challenge-voice.html challenge-expression.html challenge-spinning.html challenge-answer.html
git commit -m "feat(design): 히어로 헤드라인에 라이트+강조 타이포 전략 적용"
```

---

## Self-Review 결과

- **스펙 커버리지**: 디자인 토큰(Task 1), 공용 컴포넌트(Task 2-4), 전역 리컬러(Task 5-11), 섹션별 스크롤 연출(Task 12-15), 상세페이지 reveal(Task 16), 타이포 전략(Task 17), 약관 페이지 톤만 적용(Task 11) — 스펙의 모든 섹션에 대응 태스크 존재.
- **플레이스홀더 스캔**: "TBD"/"나중에" 없음. 색상 값은 전부 계산된 정확한 hex/rgba.
- **타입/이름 일관성**: `data-reveal`/`data-sticky-panel`/`data-sticky-from`/`data-sticky-to`/`data-count-up`/`data-count-suffix` 속성명과 `window.MoncScrollFx.init*` 함수명이 Task 2~4 정의와 Task 12~16 사용처에서 동일하게 유지됨.
