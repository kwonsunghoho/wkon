/* 스크롤 진입 시 나타나는 연출 — 챌린지 상세 4종([data-reveal]) 전용.

   ⚠️ 2026-07-30 정리: 한때 같이 있던 세 가지를 걷어냈다.
     · initZoomExit(창 통과 줌 · 293줄) — 2026-07-29 삭제. 홈 히어로가 정적 배경 + 자동
       애니메이션으로 바뀌면서 [data-zoom-exit]를 쓰는 페이지가 하나도 남지 않았다.
       monc:zoomprogress 이벤트도 함께 사라졌다(구독처는 하단 CTA 바였고 스크롤 판정으로 교체).
       되살리려면 하늘/창틀 2겹 이미지부터 필요하다 — 지금 배경은 합본이라 통과가 성립하지 않는다.
     · initStickyPanel(44줄) — [data-sticky-panel]/[data-sticky-from]/[data-sticky-to]를
       쓰는 마크업이 사이트에 하나도 없었다.
     · initCountUp(46줄) — [data-count-up]도 마찬가지. 홈 숫자 타일(#moncStats)은 단위 노출·
       지연 시작이 필요해서 index.html 이 자체 카운트업을 따로 갖고 있다(그쪽이 정본).
   같은 정리에서 index.html 의 <script src="scroll-fx.js"> 도 뺐다 — 홈엔 [data-reveal]이 없다.
   window.MoncScrollFx 내보내기도 부르는 데가 없어 삭제. 필요해지면 그때 다시 열 것. */
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

  document.addEventListener('DOMContentLoaded', initReveal);
})();
