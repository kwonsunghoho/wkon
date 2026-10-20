/* 홈의 목적지 선택은 기존 공용 비콘으로 측정한다. 개인정보는 보내지 않는다. */
(function () {
  'use strict';
  document.addEventListener('click', function (event) {
    var link = event.target.closest('a[data-home-action]');
    if (!link || typeof window.moncBeacon !== 'function') return;
    window.moncBeacon(link.dataset.homeAction, { destination: link.getAttribute('href') });
  });
})();
