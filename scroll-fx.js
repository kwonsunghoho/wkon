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

    var SCALE_K = 0.32; // progress 1일 때 최대 scale = 1 + SCALE_K
    var ticking = false;

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
        pin.style.transform = 'scale(' + (1 + progress * SCALE_K) + ')';
        pin.style.opacity = String(1 - progress);
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
