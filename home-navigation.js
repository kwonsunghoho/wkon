/* 공용 연구진 원본과 기존 목적지 클릭 계측을 사용하는 메인. */
(function () {
  'use strict';
  var host = document.getElementById('homeResearchers');
  var previous = document.getElementById('homeResearcherPrev');
  var next = document.getElementById('homeResearcherNext');
  var counter = document.getElementById('homeResearcherCount');
  if (host && previous && next && counter && Array.isArray(window.MONC_RESEARCHERS)) {
    window.MONC_RESEARCHERS.filter(function (person) { return person.name; }).forEach(function (person) {
      var card = document.createElement('article');
      card.className = 'monc-person';
      if (person.photo) {
        var image = document.createElement('img');
        image.src = person.photo;
        image.alt = '';
        image.width = 400;
        image.height = 400;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.style.objectPosition = person.photoPos || 'center 18%';
        image.addEventListener('error', function () { image.hidden = true; });
        card.appendChild(image);
      }
      var heading = document.createElement('div');
      heading.className = 'monc-person-head';
      var role = document.createElement('p');
      role.className = 'monc-person-role';
      role.textContent = person.role || '';
      var name = document.createElement('h3');
      name.textContent = person.name;
      var position = document.createElement('p');
      position.className = 'monc-person-position';
      position.textContent = person.position || '';
      heading.append(role, name, position);
      var bio = document.createElement('p');
      bio.className = 'monc-person-bio';
      // 공용 공개 이력의 기존 강조 태그만 유지한다.
      bio.innerHTML = person.bio || '';
      card.append(heading, bio);
      host.appendChild(card);
    });
    var cards = Array.from(host.children);
    var index = 0;
    function step() {
      return cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : host.clientWidth;
    }
    function measure() {
      index = Math.max(0, Math.min(cards.length - 1, Math.round(host.scrollLeft / (step() || 1))));
      counter.textContent = cards.length ? (index + 1) + ' / ' + cards.length : '';
      previous.disabled = !cards.length || index === 0;
      next.disabled = !cards.length || index === cards.length - 1;
    }
    function move(direction) {
      host.scrollTo({
        left: Math.max(0, Math.min(cards.length - 1, index + direction)) * step(),
        behavior: window.matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth'
      });
    }
    previous.addEventListener('click', function () { move(-1); });
    next.addEventListener('click', function () { move(1); });
    host.addEventListener('scroll', measure, { passive: true });
    host.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        move(event.key === 'ArrowRight' ? 1 : -1);
      }
    });
    if ('ResizeObserver' in window) new ResizeObserver(measure).observe(host);
    else window.addEventListener('resize', measure);
    measure();
  }
  document.addEventListener('click', function (event) {
    var intro = event.target.closest('a[data-herocta]');
    if (intro && typeof window.moncBeacon === 'function') window.moncBeacon('hero_cta', {});
    var link = event.target.closest('a[data-home-action]');
    if (link && typeof window.moncBeacon === 'function') {
      window.moncBeacon(link.dataset.homeAction, { destination: link.getAttribute('href') });
    }
  });
})();
