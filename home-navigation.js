/* 홈의 목적지 선택은 기존 공용 비콘으로 측정한다. 개인정보는 보내지 않는다. */
(function () {
  'use strict';
  // 연구원 정보는 공용 원본을 사용한다. 모두를 챌린지 담당자로 표시하지 않는다.
  var portraits = document.getElementById('homeResearchers');
  if (portraits && Array.isArray(window.MONC_RESEARCHERS)) {
    window.MONC_RESEARCHERS.forEach(function (researcher) {
      if (!researcher.photo || !researcher.name) return;
      var img = document.createElement('img');
      img.src = researcher.photo;
      img.alt = researcher.name + ' 연구원';
      img.width = 96;
      img.height = 120;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.style.objectPosition = researcher.photoPos || 'center 18%';
      img.addEventListener('error', function () { img.hidden = true; });
      portraits.appendChild(img);
    });
    portraits.hidden = !portraits.childElementCount;
  }
  document.addEventListener('click', function (event) {
    var intro = event.target.closest('a[data-herocta]');
    if (intro && typeof window.moncBeacon === 'function') {
      window.moncBeacon('hero_cta', {});
    }
    var link = event.target.closest('a[data-home-action]');
    if (!link || typeof window.moncBeacon !== 'function') return;
    window.moncBeacon(link.dataset.homeAction, { destination: link.getAttribute('href') });
  });
})();
