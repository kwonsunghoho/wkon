/* 홈 수업 영역에 실제 공개 후기만 보여준다. 권한은 각 기능에서 확인한다. */
(function () {
  'use strict';
  var host = document.getElementById('homeReviews');
  if (!host) return;
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function reviewHtml(row) {
    var course = row.kind === 'ke20' ? '수업' : (row.challenge || '챌린지');
    var href = 'reviews-list.html?kind=' + (row.kind === 'ke20' ? 'ke20' : 'challenge');
    var body = '';
    if (row.quote) {
      var quote = window.moncReview ? window.moncReview.plain(row.quote) : row.quote;
      body = '<p class="home-review-quote">' + esc(quote) + '</p>';
    } else {
      var src = row.image_path || row.url;
      if (!src) return '';
      if (!/^https?:/i.test(src)) {
        try { src = window.MONC.sb.storage.from('reviews').getPublicUrl(src).data.publicUrl; }
        catch (e) { return ''; }
      }
      if (!/^https?:\/\//i.test(src)) return '';
      body = '<img src="' + esc(src) + '" alt="' + esc(course) + ' 참여 후기" width="480" height="180" loading="lazy" decoding="async">';
    }
    var kind = row.kind === 'ke20' ? 'ke20' : 'challenge';
    var label = kind === 'ke20' ? '수업 후기' : '챌린지 후기';
    return '<a class="home-review" data-review-kind="' + kind + '" href="' + href + '"><div class="home-review-heading"><h3>' + label + '</h3><span>' + esc(course) + '</span></div><span class="home-review-mark" aria-hidden="true">“</span>' + body + '<span class="home-review-more">' + label + ' 더 보기 <span aria-hidden="true">→</span></span></a>';
  }
  async function loadReviews() {
    if (!window.MONC || !window.MONC.sb) return;
    try {
      // 기존 후기 목록과 같은 공개 조건·최근 등록 순서다. 상담 후기는 가져와도 표시하지 않는다.
      var result = await window.MONC.sb.from('reviews').select('*').eq('visible', true).order('created_at', { ascending: false });
      if (result.error || !result.data) return;
      var rows = result.data.filter(function (row) { return !row.kind || row.kind === 'challenge' || row.kind === 'ke20'; });
      rows.sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
      // 두 종류를 독립적으로 고른다. 최근 수업 후기만으로 양쪽이 채워지지 않게 한다.
      var cards = ['challenge', 'ke20'].map(function (kind) {
        return rows.filter(function (row) { return (row.kind === 'ke20' ? 'ke20' : 'challenge') === kind; }).map(reviewHtml).filter(Boolean)[0] || '';
      }).filter(Boolean);
      if (!cards.length) return;
      host.querySelector('.home-review-list').innerHTML = cards.join('');
      host.hidden = false;
    } catch (e) { /* 공개 후기를 확인하지 못하면 미리보기 없이 목록 링크만 제공한다. */ }
  }
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      if (entries.some(function (entry) { return entry.isIntersecting; })) {
        observer.disconnect();
        loadReviews();
      }
    }, { rootMargin: '300px' });
    observer.observe(document.getElementById('doors'));
  } else loadReviews();
})();
