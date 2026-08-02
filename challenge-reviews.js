/* ══════════════════════════════════════════════════════════════════════════
   챌린지 상세 — 그 챌린지의 실제 후기 (2026-08-02 오너 "후기 보여지게해봐")

   왜 만들었나: 후기 108건과 연구진이 사이트에 있는데 **정작 결제를 결심하는 화면
   (챌린지 상세 4종)에서 링크가 0건**이었다. 증거가 결정 지점에 없던 것.

   쓰는 법 — 챌린지 상세 페이지에 두 줄:
       <section class="ch-rv" id="chReviews" data-challenge="보신각" hidden></section>
       <script src="challenge-reviews.js" defer></script>
   supabase-config.js(MONC)가 먼저 로드돼 있어야 한다(4종 모두 이미 싣는다).

   ⚠️ 챌린지 상세 4종은 인라인 CSS 를 복사해 쓰는 구조라, 이 기능의 스타일은
      네 파일에 또 복사하지 않고 **이 파일이 한 번만 주입**한다(nav.js 와 같은 이유).
   ⚠️ 후기 0건이면 섹션을 **아예 안 그린다** — 사이트 공통 규칙(빈 껍데기 금지).
   ⚠️ 조회는 select('*') + 클라이언트 필터다. .eq('kind', …) 로 서버에서 거르면
      kind 컬럼 마이그레이션(20260801180000) 미적용 환경에서 400 이 난다
      (reviews-list.html 과 같은 방어 — 한쪽만 고치지 말 것).
   ⚠️ 이름은 챌린지 후기만 노출한다. 상담 후기는 실명 미노출 규칙이 따로 있어
      여기 섞지 않는다(kind 가 'challenge' 인 것만).
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var sec = document.getElementById('chReviews');
  if (!sec || !window.MONC || !window.MONC.sb) return;

  var CH = sec.getAttribute('data-challenge') || '';
  if (!CH) return;

  var MAX = 3;                       // 상세는 미리보기 3개 — 전체는 목록 페이지가 맡는다
  var LIST_URL = 'reviews-list.html?kind=challenge';

  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* 스타일 — 상세 4종의 기존 토큰(--surface·--border·--accent-ink)만 쓴다.
     새 색을 만들지 않는다(팔레트 규칙). 카드는 목록 페이지의 인용 카드와 같은 성격. */
  var CSS = ''
    + '.ch-rv{padding:64px 20px;background:var(--bg2,#F5F0E8);}'
    + '.ch-rv[hidden]{display:none;}'
    + '.ch-rv-in{max-width:960px;margin:0 auto;}'
    + '.ch-rv-head{text-align:center;margin-bottom:28px;}'
    + '.ch-rv-grid{display:grid;gap:14px;grid-template-columns:1fr;}'
    + '@media(min-width:760px){.ch-rv-grid{grid-template-columns:repeat(3,1fr);}}'
    + '.ch-rv-card{display:flex;flex-direction:column;gap:12px;margin:0;padding:20px 18px;'
    +   'background:var(--surface,#fff);border:1px solid var(--border,#e3ddd3);'
    +   'border-radius:16px;box-shadow:var(--shadow,0 2px 10px rgba(16,43,86,.06));}'
    + '.ch-rv-badge{display:inline-flex;align-items:center;gap:5px;align-self:flex-start;'
    +   'padding:4px 10px;border-radius:999px;background:var(--action-tint,#EEF2F9);'
    +   'color:var(--accent-ink,#1B3A6B);font-size:12px;font-weight:800;}'
    + '.ch-rv-q{margin:0;font-size:15px;line-height:1.75;color:var(--text,#1C2A3A);word-break:keep-all;}'
    + '.ch-rv-who{margin-top:auto;font-size:13px;font-weight:700;color:var(--text-muted,#5c6672);}'
    /* 스크린샷만 있는 후기 — 인용문이 아직 없는 건은 이미지 앞면으로 */
    + '.ch-rv-shot{display:block;width:100%;border:0;padding:0;background:none;cursor:pointer;'
    +   'border-radius:12px;overflow:hidden;}'
    + '.ch-rv-shot img{display:block;width:100%;height:190px;object-fit:cover;object-position:top;}'
    + '.ch-rv-more{display:flex;align-items:center;justify-content:center;gap:8px;'
    +   'min-height:52px;margin:22px auto 0;padding:0 26px;max-width:420px;'
    +   'border:1.5px solid var(--action,#1B3A6B);border-radius:999px;background:var(--surface,#fff);'
    +   'color:var(--action,#1B3A6B);font-size:15px;font-weight:800;text-decoration:none;}';

  function injectCss() {
    if (document.getElementById('chRvCss')) return;
    var st = document.createElement('style');
    st.id = 'chRvCss';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function imgUrl(path) {
    if (!path) return '';
    if (/^https?:/i.test(path)) return path;
    try { return window.MONC.sb.storage.from('reviews').getPublicUrl(path).data.publicUrl; }
    catch (e) { return ''; }
  }

  /* 발신자 줄 — "누가 썼는지"를 문장으로 만든다.
     ⚠️ 이름 컬럼은 `reviewer_name` 이다(`name` 아님 — 2026-08-02 오너 지적 전까지
        `r.name` 을 읽어 **이름이 한 번도 안 붙었고**, 남은 게 '1기' 한 조각뿐이라
        오타처럼 보였다. reviews-list·reviews 허브는 처음부터 reviewer_name 을 쓴다).
     ⚠️ 이름이 없는 건은 숫자만 남으므로 '참여자'를 붙여 **무엇의 1기인지** 말한다.
        기수 숫자를 홀로 두지 말 것 — 카드는 캡처돼 돌아다녀서 제목 없이도 읽혀야 한다. */
  function whoLine(r) {
    var nm = (r.reviewer_name || '').trim();
    var co = (r.cohort != null && r.cohort !== '') ? CH + ' ' + r.cohort + '기' : '';
    if (nm && co) return nm + ' · ' + co;
    if (co) return co + ' 참여자';
    return nm;
  }

  function cardHtml(r) {
    var who = whoLine(r);
    var foot = who ? '<div class="ch-rv-who">' + esc(who) + '</div>' : '';
    if (r.quote) {
      return '<figure class="ch-rv-card">'
        + '<span class="ch-rv-badge">실제 후기</span>'
        + '<p class="ch-rv-q">' + esc(r.quote) + '</p>'
        + foot + '</figure>';
    }
    var src = imgUrl(r.url);
    if (!src) return '';
    return '<figure class="ch-rv-card">'
      + '<span class="ch-rv-badge">실제 후기</span>'
      + '<a class="ch-rv-shot" href="' + LIST_URL + '">'
      +   '<img src="' + esc(src) + '" alt="' + esc(CH) + ' 챌린지 후기" loading="lazy">'
      + '</a>' + foot + '</figure>';
  }

  (function load() {
    window.MONC.sb.from('reviews').select('*').eq('visible', true).then(function (res) {
      if (res.error || !res.data) return;                  // 조회 실패 → 섹션 숨김 유지
      var rows = res.data.filter(function (r) {
        return (r.kind || 'challenge') === 'challenge' && r.challenge === CH;
      });
      if (!rows.length) return;                            // 0건이면 안 그린다

      // 인용문이 있는 후기를 앞에 — 훑을 수 있는 층이 먼저 보여야 한다(목록 페이지와 같은 규칙)
      rows.sort(function (a, b) { return (b.quote ? 1 : 0) - (a.quote ? 1 : 0); });
      var cards = rows.slice(0, MAX).map(cardHtml).filter(Boolean);
      if (!cards.length) return;

      injectCss();
      sec.innerHTML = '<div class="ch-rv-in">'
        + '<div class="ch-rv-head">'
        +   '<div class="section-label">Real Reviews</div>'
        +   '<h2 class="section-title">' + esc(CH) + ' 참여자들의 후기</h2>'
        + '</div>'
        + '<div class="ch-rv-grid">' + cards.join('') + '</div>'
        + '<a class="ch-rv-more" href="' + LIST_URL + '">후기 ' + rows.length + '건 전체 보기 →</a>'
        + '</div>';
      sec.hidden = false;
    }, function () { /* 조회 자체가 실패 — 섹션 숨김 유지 */ });
  })();
})();
