/* ══════════════════════════════════════════════════════════════════════════
   MONC 공용 상단 메뉴 — 마크업 주입 + 동작 (2026-07-30 신설)

   오너 지시: "다른 페이지나 허브로 이동할 때 상단 네비게이션은 무조건 다 보이게".

   쓰는 법 — 페이지에 두 줄만 넣는다(순서 무관, 둘 다 <head> 권장):
       <link rel="stylesheet" href="nav.css">
       <script src="nav.js" defer></script>
   그리고 그 페이지의 **기존 nav 마크업·CSS·햄버거 JS 는 지운다**(두 개가 겹친다).

   ⚠️⚠️ 메뉴 항목을 페이지에 복사해 넣지 말 것. 이 파일이 유일한 원본이다 —
      전에는 같은 nav 가 index·researchers·challenges 세 곳에 복사돼 있어서
      문구 하나 바꿀 때마다 세 파일을 맞춰야 했고, 실제로 자주 어긋났다.

   ⚠️ supabase-config.js(MONC)가 있으면 로그인 상태를 반영하고, 없으면 조용히
      로그아웃 화면으로 둔다 — 이 파일이 supabase 를 필수로 요구하면 안 된다
      (terms·privacy 처럼 supabase 를 안 싣는 페이지에도 메뉴가 붙어야 한다).
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (document.getElementById('navbar')) return;   // 이미 있으면(구 마크업 잔존) 손대지 않는다

  var LOGO = 'images/MONC_Logo_Full_Package/assets/web/monc-logo-transparent-640.webp';

  /* 하위 항목 — 승준노트는 briefing.html 카드와, 챌린지는 challenges.html 카드와 같은 목록.
     ⚠️ 실전 모의면접(rehearsal)은 배포 보류라 briefing.html 에서도 숨겨져 있다 — 넣지 말 것. */
  var BRIEFING_SUB = [
    ['briefing.html', '승준노트 한눈에', '도구 전체 보기'],
    ['news.html', '항공 뉴스', '10개 항공사 소식 · 스크랩'],
    ['sojae.html', '답변 기초 쌓기', '자기객관화부터 차근차근'],
    ['mypage.html#sec-answers', '답변노트', '쓴 답변 한곳에 모아 보기'],
    ['ai-killer.html', 'AI킬러', 'AI 같은 표현 찾아 고치기']
  ];
  var CHALLENGE_SUB = [
    ['challenges.html', '챌린지 한눈에', '모집 현황 · 전체 보기'],
    ['challenge-voice.html', '보.신.각', '2주 만에 목소리가 달라져요'],
    ['challenge-expression.html', '영.합.각', '카메라 앞에서도 자연스럽게'],
    ['challenge-spinning.html', '스.피.닝', '리듬을 타며 발음이 터진다'],
    ['challenge-answer.html', '승.자.각', '2주에 답변 10개 완성']
  ];

  /* 어느 메뉴가 '현재 위치'인지 — 하위 페이지에 있어도 상위 메뉴에 표시가 남아야
     '내가 어디에 있는지'를 알 수 있다(오너가 불편해한 지점의 절반이 이것이다). */
  var SECTION_OF = {
    'briefing.html': 'briefing', 'news.html': 'briefing', 'sojae.html': 'briefing',
    'ai-killer.html': 'briefing', 'answers.html': 'briefing', 'polish.html': 'briefing',
    'challenges.html': 'challenge', 'challenge-voice.html': 'challenge',
    'challenge-expression.html': 'challenge', 'challenge-spinning.html': 'challenge',
    'challenge-answer.html': 'challenge',
    'lectures.html': 'lecture', 'lecture.html': 'lecture',
    'researchers.html': 'researchers', 'reviews.html': 'reviews'
  };

  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var section = SECTION_OF[here] || '';
  var onHome = (here === 'index.html' || here === '');

  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function cur(key) { return section === key ? ' aria-current="page"' : ''; }
  var CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  function ddMenu(items) {
    return items.map(function (it) {
      return '<a href="' + it[0] + '"><b>' + esc(it[1]) + '</b><span>' + esc(it[2]) + '</span></a>';
    }).join('');
  }
  function accPanel(items) {
    return items.map(function (it) {
      return '<a class="mm-sub" href="' + it[0] + '"><b>' + esc(it[1]) + '</b><span>' + esc(it[2]) + '</span></a>';
    }).join('');
  }

  /* 로고는 홈에서만 #home(미션 섹션) 앵커, 다른 페이지에선 홈으로 이동 */
  var logoHref = onHome ? '#home' : 'index.html';

  var navHtml =
    '<nav id="navbar">' +
      '<div class="nav-inner">' +
        '<a class="logo" href="' + logoHref + '"><img src="' + LOGO + '" alt="MONC" /></a>' +
        '<ul class="nav-links">' +
          '<li class="nav-dd">' +
            '<button class="nav-dd-btn nav-briefing" type="button" aria-expanded="false" aria-haspopup="true"' + cur('briefing') + '>승준노트' + CHEV + '</button>' +
            '<div class="nav-dd-menu">' + ddMenu(BRIEFING_SUB) + '</div>' +
          '</li>' +
          '<li class="nav-dd">' +
            '<button class="nav-dd-btn" type="button" aria-expanded="false" aria-haspopup="true"' + cur('challenge') + '>챌린지' + CHEV + '</button>' +
            '<div class="nav-dd-menu">' + ddMenu(CHALLENGE_SUB) + '</div>' +
          '</li>' +
          '<li><a href="lectures.html"' + cur('lecture') + '>특강</a></li>' +
          '<li><a href="researchers.html"' + cur('researchers') + '>연구진</a></li>' +
          '<li><a href="reviews.html"' + cur('reviews') + '>후기</a></li>' +
        '</ul>' +
        '<div class="nav-right">' +
          '<a class="nav-login" href="login.html">로그인/회원가입</a>' +
          '<a class="nav-cta" href="apply.html">신청하기</a>' +
        '</div>' +
        '<button class="hamburger" id="hamburger" aria-label="메뉴" aria-expanded="false"><span></span><span></span><span></span></button>' +
      '</div>' +
    '</nav>' +
    '<div class="mobile-menu" id="mobileMenu">' +
      '<ul>' +
        '<li class="mm-acc">' +
          '<button class="mm-acc-btn" type="button" aria-expanded="false" aria-controls="mmBriefing"><span class="nav-briefing">승준노트</span>' +
          '<svg class="mm-acc-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
          '<div class="mm-acc-panel" id="mmBriefing">' + accPanel(BRIEFING_SUB) + '</div>' +
        '</li>' +
        '<li class="mm-acc">' +
          '<button class="mm-acc-btn" type="button" aria-expanded="false" aria-controls="mmChallenges">챌린지' +
          '<svg class="mm-acc-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
          '<div class="mm-acc-panel" id="mmChallenges">' + accPanel(CHALLENGE_SUB) + '</div>' +
        '</li>' +
        '<li><a href="lectures.html"' + cur('lecture') + '>특강</a></li>' +
        '<li><a href="researchers.html"' + cur('researchers') + '>연구진</a></li>' +
        '<li><a href="reviews.html"' + cur('reviews') + '>후기</a></li>' +
      '</ul>' +
      '<div class="mobile-menu-cta">' +
        '<a class="mm-login" href="login.html">로그인 / 회원가입</a>' +
        '<a class="mm-apply" href="apply.html">신청하기</a>' +
      '</div>' +
    '</div>';

  function mount() {
    var holder = document.createElement('div');
    holder.innerHTML = navHtml;
    // body 맨 앞에 넣는다 — nav 는 fixed 라 위치엔 영향이 없지만, 키보드 tab 순서가 화면과 맞아야 한다.
    while (holder.firstChild) document.body.insertBefore(holder.firstChild, document.body.firstChild);
    wire();
    initAuth();
  }

  function wire() {
    /* ── 드롭다운 ──
       ⚠️ 드롭다운이 둘이라 하나를 열면 다른 하나는 닫는다 — 둘 다 열리면 메뉴 두 장이 겹쳐 뜬다. */
    var dds = [].slice.call(document.querySelectorAll('#navbar .nav-dd'));
    function closeDd(dd) {
      dd.classList.remove('is-open');
      var b = dd.querySelector('.nav-dd-btn');
      if (b) b.setAttribute('aria-expanded', 'false');
    }
    dds.forEach(function (dd) {
      var btn = dd.querySelector('.nav-dd-btn');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var open = !dd.classList.contains('is-open');
        dds.forEach(closeDd);
        if (open) { dd.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true'); }
      });
    });
    document.addEventListener('click', function (e) {
      dds.forEach(function (dd) { if (!dd.contains(e.target)) closeDd(dd); });
    });

    /* ── 햄버거 ── */
    var hb = document.getElementById('hamburger');
    var mm = document.getElementById('mobileMenu');
    if (hb && mm) {
      hb.addEventListener('click', function () {
        var open = mm.classList.toggle('open');
        hb.classList.toggle('open', open);
        hb.setAttribute('aria-expanded', open ? 'true' : 'false');
        document.body.style.overflow = open ? 'hidden' : '';
      });
      // 메뉴 안의 링크를 누르면 닫는다(같은 페이지 앵커로 가는 경우 메뉴가 덮고 있으면 안 되므로)
      mm.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () {
          mm.classList.remove('open'); hb.classList.remove('open');
          hb.setAttribute('aria-expanded', 'false');
          document.body.style.overflow = '';
        });
      });
      /* 아코디언 — 토글은 button 이라 위 '링크 클릭 시 닫기'에 안 걸린다 */
      mm.querySelectorAll('.mm-acc-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var open = btn.closest('.mm-acc').classList.toggle('is-open');
          btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      dds.forEach(closeDd);
      if (mm && mm.classList.contains('open') && hb) hb.click();
    });
  }

  /* 로그인 상태면 오른쪽 버튼을 '마이페이지 알약'으로 바꾸고 모바일 메뉴에 회원 카드를 끼운다.
     ⚠️ MONC(supabase-config.js) 가 없는 페이지에서는 아무것도 하지 않는다 — 로그아웃 화면 유지. */
  function initAuth() {
    if (!window.MONC || !window.MONC.getSession) return;
    (async function () {
      var session = null;
      try { session = await MONC.getSession(); } catch (e) { return; }
      if (!session) return;

      var profile = null;
      try { profile = await MONC.getMyProfile(); } catch (e) {}
      var name = (profile && profile.name) ? profile.name : '회원';
      var initial = (name.trim().charAt(0)) || '·';

      // 관리자는 회원 마이페이지가 아니라 관리자 페이지로 보낸다.
      var isAdmin = !!(profile && profile.role === 'admin');
      var memberHref = isAdmin ? 'admin.html' : 'mypage.html';
      var pillLabel = isAdmin ? '관리자 페이지' : '마이페이지';
      var goLabel = isAdmin ? '관리자 페이지 가기 →' : '마이페이지 가기 →';

      var navRight = document.querySelector('#navbar .nav-right');
      if (navRight) {
        navRight.innerHTML =
          '<a class="mypage-pill" href="' + memberHref + '"><span class="nav-avatar">' + esc(initial) +
          '</span>' + pillLabel + '</a>' +
          '<a class="nav-cta" href="apply.html">신청하기</a>';
      }

      var mmEl = document.getElementById('mobileMenu');
      if (mmEl) {
        var card = document.createElement('a');
        card.className = 'mm-member-card';
        card.href = memberHref;
        card.innerHTML =
          '<span class="mm-avatar">' + esc(initial) + '</span>' +
          '<span class="mm-member-text"><b>' + esc(name) + '</b> 님' +
          '<span class="mm-go">' + esc(goLabel) + '</span></span>';
        mmEl.insertBefore(card, mmEl.firstElementChild);
        // 회원 카드가 메뉴를 닫는 처리에 걸리도록(위 wire 는 주입 전에 돌았다)
        card.addEventListener('click', function () { document.body.style.overflow = ''; });
        var loginBtn = mmEl.querySelector('.mm-login');
        if (loginBtn) loginBtn.remove();
      }
    })();
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
