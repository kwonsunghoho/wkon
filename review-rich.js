/* ══════════════════════════════════════════════════════════════════════════
   후기 글 그리기 — 공용 (2026-09-29 신설 · KE20 후기)

   왜 만들었나: KE20 후기는 1,500자까지 쓰고, 글을 소제목으로 나눠 쓴다(오너 "소제목처럼 딱
   알아볼 수 있게 · 보는 사람들 기준으로"). 그 글을 그리는 자리가 넷이다 — 목록
   (reviews-list.html) · 허브 미리보기(reviews.html) · 쓰기 화면의 미리보기(review-write.html) ·
   admin 의 전체 글 보기. 읽는 규칙이 넷으로 갈리면 쓴 사람이 본 미리보기와 올라간 후기가 달라진다.

   글의 모양 — DB 에는 quote 한 칸에 글자로만 들어 있다(컬럼을 늘리지 않았다):
       [가장 도움이 된 점]
       답변을 외우지 않고 …
   **줄 맨 앞의 [ … ](20자 이하)** 가 소제목이다. 단추로 넣은 것이든 직접 친 것이든 같다.
   ⚠️ 이 규칙을 바꾸면 서버도 같이 고친다 — submit_ke20_review 가 본문 글자 수를 같은 규칙으로 센다
      (migration 20260929150000).
   ⚠️ 소제목 뒤에 글이 같은 줄에 붙어 있어도 소제목으로 읽는다. 줄바꿈이 지워진 글에서
      대괄호가 글자 그대로 후기에 나가는 것을 막는다.

   쓰는 법:
       <script src="review-rich.js?v=1"></script>
       el.innerHTML = moncReview.bodyHtml(quote);   // 카드 본문 자리에
       moncReview.fit(el);                          // 화면에 붙인 뒤 — 긴 글을 접고 '더 보기'를 단다
   스타일은 이 파일이 한 번만 심는다(challenge-reviews.js 와 같은 이유 — 네 곳에 복사하지 않는다).
   .rv-quote(한줄평 활자)는 쓰는 화면이 이미 들고 있는 규칙을 그대로 쓴다.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.moncReview) return;

  var HEAD_RE = /^\s*\[([^\[\]\n]{1,20})\]\s*(.*)$/;
  var SHORT = 80;      // 소제목 없이 이 길이 이하 한 단락이면 한줄평 활자(굵게)로 그린다
  var CLAMP = 232;     // 카드에서 글을 접는 높이(약 8줄) — 아래 CSS 의 max-height 와 한 벌
  var SLACK = 40;      // 이만큼은 넘쳐도 접지 않는다(두세 줄 가리자고 단추를 달지 않는다)

  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* 글 → 단락 목록 [{h: 소제목(없으면 ''), text: 본문}]. 소제목만 있고 본문이 빈 단락도 돌려준다 —
     쓰는 중 미리보기는 그 자리를 보여 줘야 한다. 올라가는 후기에서는 bodyHtml 이 뺀다. */
  function parse(text) {
    var parts = [], cur = { h: '', lines: [] };
    String(text == null ? '' : text).replace(/\r/g, '').split('\n').forEach(function (line) {
      var m = line.match(HEAD_RE);
      if (m) { parts.push(cur); cur = { h: m[1].trim(), lines: m[2] ? [m[2]] : [] }; }
      else cur.lines.push(line);
    });
    parts.push(cur);
    return parts.map(function (p) { return { h: p.h, text: p.lines.join('\n').trim() }; })
      .filter(function (p) { return p.h || p.text; });
  }

  // 소제목을 뺀 본문만 한 줄로 — 두 줄짜리 미리보기(허브)·검색용
  function plain(text) {
    return parse(text).map(function (p) { return p.text; }).filter(Boolean)
      .join(' ').replace(/\s+/g, ' ').trim();
  }
  /* 소제목을 뺀 본문 글자 수 — 최소 글자 수 판정.
     ⚠️ 서버(submit_ke20_review)와 **세는 법이 같아야 한다**: 줄마다 소제목을 떼고 앞뒤 공백을 뺀 길이의 합
        (줄바꿈은 세지 않는다). 단락 글자를 통째로 세면 줄바꿈이 끼어 화면은 10자, 서버는 9자가 되는
        글이 생긴다 — 제출을 눌러야 막히는 글이 된다(2026-09-29 임시 Postgres 대조로 확인). */
  function bodyLen(text) {
    return String(text == null ? '' : text).replace(/\r/g, '').split('\n').reduce(function (n, line) {
      var m = line.match(HEAD_RE);
      // Array.from — 글자 단위로 센다(이모지 하나가 2로 세어지면 화면만 통과하고 서버에서 막힌다)
      return n + Array.from((m ? m[2] : line).trim()).length;
    }, 0);
  }

  /* 카드 본문 HTML.
     opt.live  — 쓰는 중 미리보기: 본문이 아직 없는 소제목도 자리를 보여 준다
     opt.empty — 그릴 글이 없을 때 대신 보일 문구(없으면 빈 문자열을 돌려준다) */
  function bodyHtml(text, opt) {
    opt = opt || {};
    var parts = parse(text);
    if (!opt.live) parts = parts.filter(function (p) { return p.text; });
    if (!parts.length) return opt.empty ? '<p class="rv-quote is-empty">' + esc(opt.empty) + '</p>' : '';
    if (parts.length === 1 && !parts[0].h && parts[0].text.length <= SHORT && parts[0].text.indexOf('\n') < 0) {
      return '<p class="rv-quote">' + esc(parts[0].text) + '</p>';
    }
    /* 접힌 채로 내보낸다 — 목록은 카드 높이를 보고 단을 나누므로(reviews-list.html place()),
       펼친 높이로 자리를 잡은 뒤 접으면 단 높이가 어긋난다. 안 접어도 되는 글은 fit() 이 푼다. */
    return '<div class="rv-rich is-clamp">' + parts.map(function (p) {
      return '<div class="rv-part">'
        + (p.h ? '<p class="rv-part-h">' + esc(p.h) + '</p>' : '')
        + (p.text ? '<p class="rv-part-p">' + esc(p.text) + '</p>'
                  : '<p class="rv-part-p is-empty">내용을 적으면 여기에 보여요.</p>')
        + '</div>';
    }).join('') + '</div>'
      + '<button type="button" class="rv-more" aria-expanded="false" hidden>더 보기</button>';
  }

  /* root 안의 긴 글을 접고 '더 보기'를 단다. 화면에 붙인 뒤에 부른다(높이를 재야 한다).
     여러 번 불러도 된다 — 폭이 바뀌어 글줄 수가 달라지면 다시 잰다. 사람이 펼쳐 둔 글은 건드리지 않는다.
     opt.open     — 처음부터 펼쳐 둘지(쓰는 중 미리보기가 다시 그려질 때 펼친 상태를 잇는다)
     opt.onToggle — 펼치거나 접을 때 부른다(open, box) */
  function fit(root, opt) {
    opt = opt || {};
    Array.prototype.forEach.call(root.querySelectorAll('.rv-rich'), function (box) {
      var btn = box.nextElementSibling;
      if (!btn || !btn.classList || !btn.classList.contains('rv-more')) return;
      function set(open) {
        box.classList.toggle('is-clamp', !open);
        btn.setAttribute('aria-expanded', String(open));
        btn.textContent = open ? '접기' : '더 보기';
      }
      if (!btn.getAttribute('data-wired')) {
        btn.setAttribute('data-wired', '1');
        btn.addEventListener('click', function () {
          var open = btn.getAttribute('aria-expanded') !== 'true';
          set(open);
          if (opt.onToggle) opt.onToggle(open, box);
        });
        if (opt.open) btn.setAttribute('aria-expanded', 'true');
      }
      var over = box.scrollHeight > CLAMP + SLACK;
      btn.hidden = !over;
      if (!over) { box.classList.remove('is-clamp'); return; }
      set(btn.getAttribute('aria-expanded') === 'true');
    });
  }

  /* 스타일 — 소제목은 본문(16px 보통)과 굵기·색·왼쪽 막대 셋으로 갈린다.
     카드 한 장만 잘라 놓아도 단락 이름이 읽혀야 한다(원칙 15 — 후기 카드는 캡처돼 돌아다닌다).
     ⚠️ 접기는 -webkit-line-clamp 가 아니라 max-height 다 — 단락이 여러 블록이라 줄 수로는 못 센다.
        페이드 끝 색은 카드 면(--surface)이다. 다른 색 면 위에 쓰면 그 색으로 바꿔야 한다. */
  var CSS = ''
    + '.rv-rich{position:relative;}'
    + '.rv-rich.is-clamp{max-height:' + CLAMP + 'px;overflow:hidden;}'
    + '.rv-rich.is-clamp::after{content:"";position:absolute;left:0;right:0;bottom:0;height:56px;'
    +   'pointer-events:none;background:linear-gradient(to bottom,rgba(255,255,255,0),var(--surface,#fff));}'
    + '.rv-part+.rv-part{margin-top:18px;}'
    + '.rv-part-h{display:flex;align-items:center;gap:7px;margin:0 0 4px;font-size:15px;font-weight:800;'
    +   'line-height:1.4;letter-spacing:-.01em;color:var(--accent-ink,#1B3A6B);word-break:keep-all;}'
    + '.rv-part-h::before{content:"";flex:none;width:3px;height:14px;border-radius:2px;'
    +   'background:var(--accent-ink,#1B3A6B);}'
    + '.rv-part-p{margin:0;font-size:16px;font-weight:400;line-height:1.75;color:var(--text,#1E2229);'
    +   'white-space:pre-line;overflow-wrap:anywhere;word-break:keep-all;}'
    + '.rv-part-p.is-empty{color:var(--text-dim,#5F6874);}'
    + '.rv-more{-webkit-appearance:none;appearance:none;align-self:flex-start;min-height:44px;'
    +   'margin:4px 0 -12px;padding:0 2px;border:0;background:none;font:inherit;font-size:14px;'
    +   'font-weight:800;color:var(--accent-ink,#1B3A6B);cursor:pointer;}'
    + '.rv-more[hidden]{display:none;}'
    + '.rv-more:focus-visible{outline:3px solid var(--action,#1B3A6B);outline-offset:2px;border-radius:4px;}';

  (function injectCss() {
    if (document.getElementById('moncReviewCss')) return;
    var st = document.createElement('style');
    st.id = 'moncReviewCss';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  })();

  window.moncReview = { parse: parse, plain: plain, bodyLen: bodyLen, bodyHtml: bodyHtml, fit: fit };
})();
