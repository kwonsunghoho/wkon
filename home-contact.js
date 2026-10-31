/* 창문과 마지막 상담 버튼이 보일 때는 작은 상담 버튼을 숨긴다. */
(function () {
  'use strict';
  // 네이버 예약 주소는 기존 상담 페이지 한 곳에서 관리한다.
  // 읽기에 실패하면 상담 안내 페이지로 이동하는 기본 링크를 유지한다.
  var booking = document.querySelector('[data-consult-booking]');
  if (booking) {
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 5000);
    fetch(booking.href, { credentials: 'omit', signal: controller.signal })
      .then(function (response) { if (!response.ok) throw new Error('상담 안내 조회 실패'); return response.text(); })
      .then(function (html) {
        var source = new DOMParser().parseFromString(html, 'text/html').getElementById('csBookBtn');
        if (!source) return;
        var url = new URL(source.getAttribute('href'), document.baseURI);
        if (url.protocol === 'https:' && url.hostname === 'm.booking.naver.com') booking.href = url.href;
      })
      .catch(function () {})
      .finally(function () { clearTimeout(timeout); });
  }
  var button = document.querySelector('.home-contact-float');
  var intro = document.getElementById('heroIntro');
  var ending = document.getElementById('homeContact');
  if (!button || !intro || !ending) return;
  var scheduled = false;
  function update() {
    scheduled = false;
    var introBox = intro.getBoundingClientRect();
    var endingBox = ending.getBoundingClientRect();
    var endingVisible = endingBox.top < window.innerHeight && endingBox.bottom > 0;
    button.hidden = introBox.bottom > 80 || endingVisible;
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(update);
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', schedule);
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(document.body);
  update();
})();
