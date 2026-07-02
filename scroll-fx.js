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

  function initCountUp() {
    var els = document.querySelectorAll('[data-count-up]');
    if (!els.length) return;

    function run(el) {
      var raw = el.getAttribute('data-count-up');
      var target = parseFloat(raw);
      var suffix = el.getAttribute('data-count-suffix') || '';
      if (prefersReducedMotion || isNaN(target)) {
        el.textContent = target + suffix;
        return;
      }
      // 소수점 자리수는 원본 문자열 기준으로 결정 (예: "14.2" → 소수 1자리).
      // 정수 값은 기존과 동일하게 Math.round()로 반올림.
      var dotIndex = raw.indexOf('.');
      var decimals = dotIndex === -1 ? 0 : raw.length - dotIndex - 1;
      var duration = 1200;
      var start = null;
      function step(ts) {
        if (start === null) start = ts;
        var progress = Math.min(1, (ts - start) / duration);
        var current = decimals > 0
          ? (target * progress).toFixed(decimals)
          : Math.round(target * progress);
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

  function initZoomExit() {
    var wraps = document.querySelectorAll('[data-zoom-exit]');
    if (!wraps.length) return;

    if (prefersReducedMotion) {
      return; // CSS 쪽에서 sticky/min-height를 해제해 정적 레이아웃으로 표시
    }

    var SCALE_K = 0.32; // 기본 최대 scale = 1 + SCALE_K (data-zoom-scale 속성으로 섹션별 오버라이드 가능)
    var ticking = false;

    // data-zoom-runway(vh 단위 숫자)가 있으면 기본 160vh 대신 해당 값을 min-height로 적용.
    // (CSS의 [data-zoom-exit][data-zoom-exit] { min-height: 160vh } 기본값을 인라인 스타일로 오버라이드)
    wraps.forEach(function (wrap) {
      var runwayAttr = wrap.getAttribute('data-zoom-runway');
      var runwayVh = runwayAttr ? parseFloat(runwayAttr) : NaN;
      if (!isNaN(runwayVh)) {
        wrap.style.minHeight = runwayVh + 'vh';
      }
    });

    // smoothstep 이징 — 선형(progress 그대로)보다 시작/끝이 완만해 "확 당겨지는"
    // 느낌 대신 서서히 가속했다 서서히 감속하는 자연스러운 확대감을 줌.
    function easeInOut(p) {
      return p * p * (3 - 2 * p);
    }

    function update() {
      ticking = false;
      wraps.forEach(function (wrap) {
        var pin = wrap.querySelector('.zoom-exit-pin');
        if (!pin) return;
        var rect = wrap.getBoundingClientRect();
        var vh = window.innerHeight;
        // wrap 상단이 뷰포트 상단을 지나 wrap 하단(= 스크롤 runway 끝)에 도달할 때까지 0→1
        var runway = rect.height - vh;
        var progress = runway > 0 ? (-rect.top) / runway : 0;
        progress = Math.min(1, Math.max(0, progress));
        var eased = easeInOut(progress);
        var scaleAttr = wrap.getAttribute('data-zoom-scale');
        var scaleK = scaleAttr ? parseFloat(scaleAttr) : SCALE_K;
        if (isNaN(scaleK)) scaleK = SCALE_K;
        pin.style.transform = 'scale(' + (1 + eased * scaleK) + ')';
        // data-zoom-fade="none"이면 페이드 없이 확대만 진행 (완전 불투명 유지) —
        // "사라짐" 없이 "뚫고 들어가는" 느낌을 위함. 속성이 없으면 기존과 동일하게
        // progress에 따라 선형으로 페이드아웃.
        var fadeAttr = wrap.getAttribute('data-zoom-fade');
        pin.style.opacity = fadeAttr === 'none' ? '1' : String(1 - eased);

        // 다음 섹션(주로 어두운 톤)으로 자연스럽게 이어지도록, wrap 안에
        // .zoom-tone-bridge 요소가 있으면 진행률에 따라 어두운 그라디언트를
        // 서서히 덧씌워 톤이 미리 어두워지기 시작하게 함 (급격한 톤 전환 방지).
        var toneBridge = wrap.querySelector('.zoom-tone-bridge');
        if (toneBridge) {
          toneBridge.style.opacity = String(eased);
        }

        // 줌/페이드가 완료(progress===1)되면 sticky를 풀어 pin이 뷰포트에 계속
        // 고정되지 않고 wrap과 함께 자연스럽게 스크롤되어 사라지도록 함 —
        // 그래야 뒤이은 섹션이 곧바로 이어서 올라와 빈 스크롤 구간이 생기지 않음.
        // 위로 스크롤해 progress가 다시 1 밑으로 내려가면 sticky를 복원해
        // 역방향 스크롤에서도 동일한 효과가 재생되도록 함.
        if (progress >= 1) {
          if (pin.style.position !== 'absolute') {
            pin.style.position = 'absolute';
            pin.style.top = '0';
          }
        } else if (pin.style.position === 'absolute') {
          pin.style.position = 'sticky';
          pin.style.top = '0';
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
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  document.addEventListener('DOMContentLoaded', function () {
    initReveal();
    initStickyPanel();
    initCountUp();
    initZoomExit();
  });

  window.MoncScrollFx = window.MoncScrollFx || {};
  window.MoncScrollFx.initReveal = initReveal;
  window.MoncScrollFx.initStickyPanel = initStickyPanel;
  window.MoncScrollFx.initCountUp = initCountUp;
  window.MoncScrollFx.initZoomExit = initZoomExit;
})();
