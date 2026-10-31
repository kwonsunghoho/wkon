/* 창문과 마지막 상담 버튼이 보일 때는 작은 상담 버튼을 숨긴다. */
(function () {
  'use strict';
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
