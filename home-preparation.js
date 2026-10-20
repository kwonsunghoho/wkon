/* 기존 후기 목록과 같은 공개 조건으로 원문만 미리 보여준다. */
(function () {
  'use strict';
  var host = document.getElementById('homeReviews');
  if (!host) return;
  var busy = false;
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function reviewHtml(row) {
    var kind = row.kind === 'ke20' ? 'ke20' : 'challenge';
    var label = kind === 'ke20' ? '수업 후기' : '챌린지 후기';
    var course = kind === 'ke20' ? '' : (row.challenge || '');
    var quote = window.moncReview ? window.moncReview.plain(row.quote || '') : (row.quote || '');
    var body = '';
    if (quote.trim()) body = '<p class="home-review-quote">' + esc(quote) + '</p>';
    else {
      var src = row.image_path || row.url;
      if (!src) return '';
      if (!/^https?:/i.test(src)) {
        try { src = window.MONC.sb.storage.from('reviews').getPublicUrl(src).data.publicUrl; }
        catch (error) { return ''; }
      }
      if (!/^https?:\/\//i.test(src)) return '';
      body = '<img src="' + esc(src) + '" alt="' + esc(label) + ' 원문" loading="lazy" decoding="async">';
    }
    return '<a class="home-review" data-review-kind="' + kind + '" href="reviews-list.html?kind=' + kind + '"><div class="home-review-heading"><h3>' + label + '</h3>' +
      (course ? '<span>' + esc(course) + '</span>' : '') + '</div>' + body +
      '<span class="home-review-more">후기 원문·전체 목록 보기 <span aria-hidden="true">→</span></span></a>';
  }
  function status(message, failed) {
    host.querySelector('.home-review-list').innerHTML = '';
    host.querySelectorAll('.home-status, .home-retry').forEach(function (node) { node.remove(); });
    host.insertAdjacentHTML('afterbegin','<p class="home-status" role="status">' + message + '</p>' +
      (failed ? '<button type="button" class="home-retry">후기 다시 불러오기</button>' : ''));
    if (failed) host.querySelector('button').addEventListener('click',loadReviews);
  }
  async function loadReviews() {
    if (busy) return;
    busy = true;
    host.setAttribute('aria-busy','true');
    status('공개 후기를 불러오는 중입니다.');
    var timer;
    try {
      if (!window.MONC || !window.MONC.sb) throw new Error('연결 없음');
      // 기존 목록의 호환 정책 유지: kind가 없는 레거시 후기 역시 챌린지로 분류한다.
      var result = await Promise.race([
        window.MONC.sb.from('reviews').select('*').eq('visible',true).order('created_at',{ascending:false}),
        new Promise(function (_,reject) { timer=setTimeout(function () { reject(new Error('시간 초과')); },12000); })
      ]);
      if (result.error || !Array.isArray(result.data)) throw new Error('후기 조회 실패');
      var rows = result.data.filter(function (row) { return !row.kind || row.kind==='challenge' || row.kind==='ke20'; });
      var cards = ['challenge','ke20'].map(function (kind) {
        var candidates=rows.filter(function (row) { return (row.kind==='ke20'?'ke20':'challenge')===kind; });
        for(var i=0;i<candidates.length;i++) { var card=reviewHtml(candidates[i]); if(card) return card; }
        return '';
      }).filter(Boolean);
      if (!cards.length) status('현재 미리 보여드릴 공개 후기가 없습니다. 아래 후기 목록을 확인해 주세요.');
      else {
        host.querySelectorAll('.home-status, .home-retry').forEach(function (node) { node.remove(); });
        host.querySelector('.home-review-list').innerHTML=cards.join('');
        host.querySelectorAll('img').forEach(function (img) {
          img.addEventListener('error',function () {
            var text=document.createElement('p');
            text.className='home-status';
            text.textContent='후기 이미지를 불러오지 못했습니다. 원문 목록에서 확인해 주세요.';
            img.replaceWith(text);
          },{once:true});
        });
      }
    } catch (error) { status('후기를 불러오지 못했습니다. 다시 시도하거나 아래 후기 목록을 확인해 주세요.',true); }
    finally { clearTimeout(timer); busy=false; host.setAttribute('aria-busy','false'); }
  }
  if ('IntersectionObserver' in window) {
    var observer=new IntersectionObserver(function (entries) {
      if(entries.some(function (entry) { return entry.isIntersecting; })) { observer.disconnect(); loadReviews(); }
    },{rootMargin:'300px'});
    observer.observe(document.getElementById('doors'));
  } else loadReviews();
})();
