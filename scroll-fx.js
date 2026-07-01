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

  document.addEventListener('DOMContentLoaded', function () {
    initReveal();
    initStickyPanel();
  });

  window.MoncScrollFx = window.MoncScrollFx || {};
  window.MoncScrollFx.initReveal = initReveal;
  window.MoncScrollFx.initStickyPanel = initStickyPanel;
})();
