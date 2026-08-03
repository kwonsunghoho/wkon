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
     ⚠️ 실전 모의면접(rehearsal)은 배포 보류라 briefing.html 에서도 숨겨져 있다 — 넣지 말 것.
     ⚠️ 맨 앞에 있던 '승준노트 한눈에'·'챌린지 한눈에'(허브 링크)는 2026-07-31 오너 지시로 뺐다.
        허브로 가는 길은 아래 HUB 상수 + 상위 버튼 '한 번 더 누르기'가 대신한다(wire() 참조) —
        목록 맨 위에 다시 넣지 말 것. */
  var BRIEFING_HUB = 'briefing.html';
  var BRIEFING_SUB = [
    /* ⚠️ 1번 항목은 저장소(answers.html) 직행 — 구 mypage.html#sec-answers 는 저장 답변이
       0건이면 접이가 아예 안 그려져 '눌렀는데 아무것도 없음'이 됐다(2026-08-02 오너
       "접힌 칸으로 안 가게 해야지"). 마이페이지 접이로 되돌리지 말 것. */
    ['answers.html', '나만의 승준노트', '쓴 답변이 전부 모이는 곳'],
    ['news.html', '항공사 뉴스&산업분석', '10개 항공사 소식 · 스크랩'],
    ['sojae.html', '답변 소재 발굴', '내 경험에서 소재 찾기'],
    ['polish.html', '답변 첨삭', "문장을 '지금 → 이렇게'로"],
    ['ai-killer.html', 'AI킬러', 'AI 같은 표현 찾아 밑줄로'],
    ['programs.html', '필수 기출 하루 한 개', '하루 한 개, 내 경험으로']
  ];
  var CHALLENGE_HUB = 'challenges.html';
  var CHALLENGE_SUB = [
    ['challenge-voice.html', '보.신.각', '2주 만에 목소리가 달라져요'],
    ['challenge-expression.html', '영.합.각', '카메라 앞에서도 자연스럽게'],
    ['challenge-spinning.html', '스.피.닝', '리듬을 타며 발음이 터진다'],
    ['challenge-answer.html', '승.자.각', '2주에 답변 10개 완성']
  ];
  /* 연구실 드롭다운(2026-07-31 오너 확정) — 상단 탭 '연구실'은 카테고리(두 번 누르면
     허브 lab.html)고, 목차는 허브의 카드 두 장과 1:1 — 연구실(원장)/연구진("하위탭도
     두개로 나눠줘야지 왜 하나야"). 탭을 연구실·연구진 두 개로 분리하는 안은 같은 날
     기각 — 상단 6개면 769~999px 에서 54px 초과(실측), 소개 페이지가 상품과 같은 급이
     되고, 허브가 무의미해진다(경과는 nav.md). 하위 페이지(자료실·영상관 등)가 생기면
     이 배열에 한 줄씩 추가한다.
     ⚠️ 승준노트·챌린지 목차의 허브 링크('한눈에')는 오너가 뺐으므로 되살리지 말 것. */
  var LAB_HUB = 'lab.html';
  var LAB_SUB = [
    /* ⚠️ 설명 줄은 lab-archive.html 의 서가 카드와 같은 목록을 유지한다. 기출문제는
       2026-08-03 항공사 자료실 안의 갈래가 됐는데 이 줄만 옛 5서가로 남아 있었다
       — 메뉴를 열 때마다 옛 구성이 보였다(오너 지적). 서가를 늘리면 여기도 고친다. */
    ['lab-archive.html', '연구실', '자료실·영상관·현장 리포트·채용 캘린더'],
    ['researchers.html', '연구진', '이력과 전문 분야 소개']
  ];
  /* 후기 드롭다운 (2026-08-02 C-9) — 세 갈래로 가는 길이 reviews.html 의 JS 카드
     하나뿐이었다. 그 카드는 로드 실패 시 hub.innerHTML='' 로 비우기 때문에, 한 번
     실패하면 세 목록에 닿을 방법이 사라진다. 승준노트(6)·챌린지(4)·연구실(2)은
     드롭다운이 있는데 3갈래인 후기만 없던 자리다.
     ⚠️ 목록은 reviews.html 허브 카드와 같은 세 갈래를 유지한다 — 한쪽만 늘리지 말 것. */
  var REVIEW_HUB = 'reviews.html';
  var REVIEW_SUB = [
    ['reviews-list.html?kind=challenge', '챌린지 후기', '2주를 마친 학생들의 기록'],
    ['reviews-list.html?kind=consult', '상담 후기', '1:1 상담을 받아 본 이야기'],
    ['stories.html', '합격 수기', '합격까지의 과정을 긴 글로']
  ];

  /* 어느 메뉴가 '현재 위치'인지 — 하위 페이지에 있어도 상위 메뉴에 표시가 남아야
     '내가 어디에 있는지'를 알 수 있다(오너가 불편해한 지점의 절반이 이것이다). */
  var SECTION_OF = {
    'briefing.html': 'briefing', 'news.html': 'briefing', 'sojae.html': 'briefing',
    'ai-killer.html': 'briefing', 'answers.html': 'briefing', 'polish.html': 'briefing',
    'programs.html': 'briefing', 'program.html': 'briefing', 'experiences.html': 'briefing',
    'challenges.html': 'challenge', 'challenge-voice.html': 'challenge',
    'challenge-expression.html': 'challenge', 'challenge-spinning.html': 'challenge',
    'challenge-answer.html': 'challenge',
    'lab.html': 'lab',
    'lab-shelf.html': 'lab', 'lab-archive.html': 'lab',
    /* ⚠️ lab-shelf.html 은 열리자마자 history.replaceState 로 주소를 lab-<key>.html 로
       바꾼다(공유용 스텁). nav.js 는 defer 라 실행 시점엔 이미 바뀐 뒤여서, 이 다섯 개를
       등록하지 않으면 서가 5종 전부 '연구실' 표시가 사라진다(2026-08-02 C-8).
       서가를 추가하면 여기에도 한 줄 넣는다. */
    'lab-airline.html': 'lab', 'lab-video.html': 'lab', 'lab-question.html': 'lab',
    'lab-calendar.html': 'lab', 'lab-report.html': 'lab',
    'lectures.html': 'lecture', 'lecture.html': 'lecture',
    /* 연구진 페이지는 '연구실' 소속으로 표시 — '연구진' 단독 항목은 2026-07-31 제거하고
       연구실 드롭다운의 하위 '연구진 소개'로 넣었다(연구실 하단에 같은 연구진 섹션이 있어
       겹치고, '연구실/연구진' 두 글자가 비슷해 나란히 있으면 구분이 안 된다 — 오너 확정). */
    'researchers.html': 'lab',
    /* 후기는 허브(reviews.html) 아래 세 갈래 — 종류별 목록·수기 상세에서도 '후기'에 표시가 남는다 */
    'reviews.html': 'reviews', 'reviews-list.html': 'reviews',
    'stories.html': 'reviews', 'story.html': 'reviews'
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
  /* 하위 항목(드롭다운·아코디언)은 '섹션'이 아니라 '이 파일'인지로 표시한다 —
     펼쳤을 때 지금 보고 있는 줄이 어디인지 알 수 있어야 한다(2026-08-02 C-3). */
  function curFile(href) {
    return (String(href).split(/[?#]/)[0].toLowerCase() === here) ? ' aria-current="page"' : '';
  }
  var CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  function ddMenu(items) {
    return items.map(function (it) {
      return '<a href="' + it[0] + '"' + curFile(it[0]) + '><b>' + esc(it[1]) + '</b><span>' + esc(it[2]) + '</span></a>';
    }).join('');
  }
  function accPanel(items) {
    return items.map(function (it) {
      return '<a class="mm-sub" href="' + it[0] + '"' + curFile(it[0]) + '><b>' + esc(it[1]) + '</b><span>' + esc(it[2]) + '</span></a>';
    }).join('');
  }

  /* 로고는 홈에서만 #home(미션 섹션) 앵커, 다른 페이지에선 홈으로 이동 */
  var logoHref = onHome ? '#home' : 'index.html';

  /* ── 로그인 링크는 '지금 화면'을 들려 보낸다 (2026-08-02) ────────────────────
     자동 리다이렉트(supabase-config 의 requireSession/requireConsent)는 이미 returnTo 를
     붙이는데, **사람이 직접 누르는 로그인 링크에만 빠져 있었다.** 결제 직전 화면에서
     '로그인'을 누르면 로그인 6~8탭을 거친 뒤 마이페이지에 도착하고 고른 챌린지가 날아갔다.
     ⚠️ nav.js 는 supabase 없이도 도는 파일이라(terms·privacy) MONC 에 기대지 않고 직접 만든다.
     ⚠️ 열린 리다이렉트 검증은 login.html 의 safeReturnTo() 가 한다 — 여기서 만들지 말 것.
     ⚠️ login·onboarding 에서 자기 자신으로 되돌아오면 무한 루프라 그때는 안 붙인다. */
  function loginHref() {
    var ref = (location.pathname.split('/').pop() || 'index.html') + location.search + location.hash;
    if (/^(login|onboarding)\.html/i.test(ref)) return 'login.html';
    return 'login.html?returnTo=' + encodeURIComponent(ref);
  }
  window.moncLoginHref = loginHref;   // 런타임에 로그인 링크를 조립하는 페이지들이 쓴다

  /* ── 로그인 상태 '기기 기억' (2026-08-03) ────────────────────────────────
     전에는 매 페이지가 '로그인/회원가입'을 먼저 그리고, 서버 확인(getSession→
     getMyProfile, 0.3~1초)이 끝나야 회원 알약으로 바꿨다 — 페이지를 옮길 때마다
     오른쪽 위가 깜빡이는 원인(오너 신고). 마지막으로 확인된 상태를 기기에 적어
     두고 **처음부터 그 상태로** 그린다.
     · 이 기억은 '먼저 그리는 용도'일 뿐 권한이 아니다 — 진짜 판정은 여전히
       initAuth(서버)가 하고, 기억과 다르면 그때 바로잡는다. 회원 페이지 접근
       통제도 각 페이지의 requireSession/requireAdmin 그대로다.
     · supabase 토큰 키(sb-…-auth-token)가 기기에 없으면 기억도 지운다 —
       로그아웃하면 supabase 가 토큰을 지우므로 다음 화면부터 자동으로 비로그인.
     · MONC 없는 페이지(terms·privacy)에서는 기억대로 그리기만 하고 검증은 없다 —
       틀려도 눌러서 간 페이지의 가드가 로그인으로 보낸다. */
  var AUTH_HINT_KEY = 'monc_nav_auth_v1';
  function readAuthHint() {
    try {
      var hasToken = false;
      for (var i = 0; i < localStorage.length; i++) {
        if (/^sb-[a-z0-9]+-auth-token$/.test(localStorage.key(i) || '')) { hasToken = true; break; }
      }
      if (!hasToken) { localStorage.removeItem(AUTH_HINT_KEY); return null; }
      var h = JSON.parse(localStorage.getItem(AUTH_HINT_KEY) || 'null');
      if (h && (h.role === 'admin' || h.role === 'member')) return h;
    } catch (e) {}
    return null;
  }
  var authHint = readAuthHint();

  /* 오른쪽 버튼·모바일 회원 카드 마크업 — 첫 그리기(위 기억)와 서버 확인 뒤
     갱신(initAuth)이 같은 모양을 쓰도록 한 곳에 둔다. hint 가 null 이면 비로그인. */
  function memberHref(hint) { return hint.role === 'admin' ? 'admin.html' : 'mypage.html'; }
  function navRightHtml(hint) {
    var btn;
    if (hint) {
      var name = (hint.name || '회원').trim();
      btn = '<a class="mypage-pill" href="' + memberHref(hint) + '"><span class="nav-avatar">'
        + esc(name.charAt(0) || '·') + '</span>'
        + (hint.role === 'admin' ? '관리자 페이지' : '마이페이지') + '</a>';
    } else {
      btn = '<a class="nav-login" href="' + loginHref() + '">로그인/회원가입</a>';
    }
    return btn + '<a class="nav-cta" href="apply.html">신청하기</a>';
  }
  function memberCardHtml(hint) {
    var name = (hint.name || '회원').trim() || '회원';
    return '<span class="mm-avatar">' + esc(name.charAt(0) || '·') + '</span>' +
      '<span class="mm-member-text"><b>' + esc(name) + '</b> 님' +
      '<span class="mm-go">' + (hint.role === 'admin' ? '관리자 페이지 가기 →' : '마이페이지 가기 →') + '</span></span>';
  }

  var navHtml =
    /* 본문 바로가기 (2026-08-02 D-12) — 37개 페이지 전부에 없었다. 데스크톱 키보드
       사용자는 매 페이지 nav 링크 9개를 지나야 본문에 닿는다.
       ⚠️ 평소엔 .sr-only 로 숨고 **포커스되면 화면에 나타난다** — 안 나타나면 있으나 마나다.
       ⚠️ 대상 #main 은 아래 mount() 가 본문 컨테이너를 찾아 붙인다(페이지마다 다르다). */
    '<a class="skip-link sr-only" href="#main">본문 바로가기</a>' +
    '<nav id="navbar">' +
      '<div class="nav-inner">' +
        '<a class="logo" href="' + logoHref + '"><img src="' + LOGO + '" alt="MONC" /></a>' +
        '<ul class="nav-links">' +
          '<li class="nav-dd">' +
            '<button class="nav-dd-btn nav-briefing" type="button" data-hub="' + BRIEFING_HUB + '" aria-expanded="false" aria-haspopup="true"' + cur('briefing') + '>승준노트' + CHEV + '</button>' +
            '<div class="nav-dd-menu">' + ddMenu(BRIEFING_SUB) + '</div>' +
          '</li>' +
          '<li class="nav-dd">' +
            '<button class="nav-dd-btn" type="button" data-hub="' + CHALLENGE_HUB + '" aria-expanded="false" aria-haspopup="true"' + cur('challenge') + '>챌린지' + CHEV + '</button>' +
            '<div class="nav-dd-menu">' + ddMenu(CHALLENGE_SUB) + '</div>' +
          '</li>' +
          '<li class="nav-dd">' +
            '<button class="nav-dd-btn" type="button" data-hub="' + LAB_HUB + '" aria-expanded="false" aria-haspopup="true"' + cur('lab') + '>연구실' + CHEV + '</button>' +
            '<div class="nav-dd-menu">' + ddMenu(LAB_SUB) + '</div>' +
          '</li>' +
          '<li><a href="lectures.html"' + cur('lecture') + '>특강</a></li>' +
          '<li class="nav-dd">' +
            '<button class="nav-dd-btn" type="button" data-hub="' + REVIEW_HUB + '" aria-expanded="false" aria-haspopup="true"' + cur('reviews') + '>후기' + CHEV + '</button>' +
            '<div class="nav-dd-menu">' + ddMenu(REVIEW_SUB) + '</div>' +
          '</li>' +
        '</ul>' +
        '<div class="nav-right">' + navRightHtml(authHint) + '</div>' +
        '<button class="hamburger" id="hamburger" aria-label="메뉴" aria-expanded="false"><span></span><span></span><span></span></button>' +
      '</div>' +
    '</nav>' +
    '<div class="mobile-menu" id="mobileMenu">' +
      (authHint
        ? '<a class="mm-member-card" href="' + memberHref(authHint) + '">' + memberCardHtml(authHint) + '</a>'
        : '') +
      '<ul>' +
        '<li class="mm-acc">' +
          '<button class="mm-acc-btn" type="button" data-hub="' + BRIEFING_HUB + '" aria-expanded="false" aria-controls="mmBriefing"' + cur('briefing') + '><span class="nav-briefing">승준노트</span>' +
          '<svg class="mm-acc-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
          '<div class="mm-acc-panel" id="mmBriefing">' + accPanel(BRIEFING_SUB) + '</div>' +
        '</li>' +
        '<li class="mm-acc">' +
          '<button class="mm-acc-btn" type="button" data-hub="' + CHALLENGE_HUB + '" aria-expanded="false" aria-controls="mmChallenges"' + cur('challenge') + '>챌린지' +
          '<svg class="mm-acc-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
          '<div class="mm-acc-panel" id="mmChallenges">' + accPanel(CHALLENGE_SUB) + '</div>' +
        '</li>' +
        '<li class="mm-acc">' +
          '<button class="mm-acc-btn" type="button" data-hub="' + LAB_HUB + '" aria-expanded="false" aria-controls="mmLab"' + cur('lab') + '>연구실' +
          '<svg class="mm-acc-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
          '<div class="mm-acc-panel" id="mmLab">' + accPanel(LAB_SUB) + '</div>' +
        '</li>' +
        '<li><a href="lectures.html"' + cur('lecture') + '>특강</a></li>' +
        '<li class="mm-acc">' +
          '<button class="mm-acc-btn" type="button" data-hub="' + REVIEW_HUB + '" aria-expanded="false" aria-controls="mmReviews"' + cur('reviews') + '>후기' +
          '<svg class="mm-acc-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
          '<div class="mm-acc-panel" id="mmReviews">' + accPanel(REVIEW_SUB) + '</div>' +
        '</li>' +
      '</ul>' +
      '<div class="mobile-menu-cta">' +
        (authHint ? '' : '<a class="mm-login" href="' + loginHref() + '">로그인 / 회원가입</a>') +
        '<a class="mm-apply" href="apply.html">신청하기</a>' +
      '</div>' +
    '</div>';

  function mount() {
    var holder = document.createElement('div');
    holder.innerHTML = navHtml;
    // body 맨 앞에 넣는다 — nav 는 fixed 라 위치엔 영향이 없지만, 키보드 tab 순서가 화면과 맞아야 한다.
    /* ⚠️ 순서를 뒤집지 말 것. 구 코드는 `insertBefore(holder.firstChild, body.firstChild)` 를
       반복해서 **넣을수록 앞으로 밀리는** 구조라 결과가 역순이었다(mobileMenu → navbar →
       skip-link). 그래도 티가 안 나다가, 2026-08-02 본문 바로가기를 넣자 **첫 Tab 이
       바로가기가 아니라 로고로 가서** 기능이 죽었다(실측). 기준 노드를 고정해 순서를 지킨다. */
    var anchor = document.body.firstChild;
    while (holder.firstChild) document.body.insertBefore(holder.firstChild, anchor);
    markMain();
    wire();
    upgradeLoginLinks();
    initAuth();
  }

  /* 본문 바로가기의 착지점. 페이지마다 컨테이너가 달라 여기서 찾아 붙인다.
     ⚠️ tabindex="-1" 이 필요하다 — 안 주면 앵커로 스크롤만 되고 포커스가 안 옮겨가서
        다음 Tab 이 다시 nav 로 돌아간다(바로가기의 의미가 없어진다). */
  function markMain() {
    if (document.getElementById('main')) return;
    var el = document.querySelector('main, .wrap, .container, [role="main"]');
    if (!el) return;
    el.id = 'main';
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  }

  /* 페이지 본문에 static 으로 박혀 있는 로그인 링크에도 returnTo 를 붙인다.
     (index 클로징 '이미 회원이라면 로그인' · apply 결제 직전 2곳 등)
     ⚠️ nav 가 방금 심은 자기 링크는 이미 완성돼 있어 `href="login.html"` 정확 일치에
        안 걸린다 — 그래서 선택자를 넓히지 말 것. 런타임에 만들어지는 링크
        (lecture 게스트 안내·quickfix·programs)는 window.moncLoginHref() 를 직접 쓴다. */
  function upgradeLoginLinks() {
    var href = loginHref();
    if (href === 'login.html') return;                       // login·onboarding 에서는 안 붙인다
    document.querySelectorAll('a[href="login.html"]').forEach(function (a) {
      a.setAttribute('href', href);
    });
  }

  function wire() {
    /* ── 드롭다운 ──
       ⚠️ 드롭다운이 여럿이라(승준노트·챌린지·연구실) 하나를 열면 나머지는 닫는다 — 같이 열리면 메뉴가 겹쳐 뜬다.
       ⚠️ 누름 횟수는 **마우스 유무로 갈린다**(2026-08-02 오너 "웹에서는 두번 클릭해야 허브로
          이동하잖아? 한번 클릭으로 바꿔줘 … 모바일은 한번에 이동하면 하위탭이 의미가 없잖아").
          · 마우스가 있는 기기 → **한 번에 허브로 이동.** 목차는 CSS 의 `:hover`/`:focus-within`
            이 이미 열어 주므로(nav.css) '여는 클릭'이 하는 일이 없었다.
          · 마우스가 없는 넓은 화면(터치 태블릿 ≥769px) → **예전대로 두 번.** 여기서 한 번에
            보내면 드롭다운을 열 방법이 아예 사라진다.
          · 모바일(≤768px)은 이 코드가 아니라 아래 햄버거 아코디언이고 거기는 두 번 유지.
       ⚠️ 폭(미디어쿼리)이 아니라 `(hover: hover)` 로 가른다 — 같은 1024px 라도 노트북과
          아이패드는 필요한 동작이 다르다. 클릭 시점에 물어봐서 기기 상태가 바뀌어도 따라간다.
          (구 규칙은 '어디서나 두 번'이었고, 그때 쓰던 `:hover` **상태** 판정은 여전히 금지 —
           호버가 남아 있는지 아닌지가 애매해 첫 누름이 제멋대로 이동한다. 여기서 보는 건
           상태가 아니라 기기 능력이다.)
       닫기는 바깥 클릭·Esc 가 맡는다. */
    function hasMouse() {
      return !!(window.matchMedia && window.matchMedia('(hover: hover)').matches);
    }
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
        var hub = btn.getAttribute('data-hub');
        if (hub && (hasMouse() || dd.classList.contains('is-open'))) { location.href = hub; return; }
        dds.forEach(closeDd);
        dd.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
      });
    });
    document.addEventListener('click', function (e) {
      dds.forEach(function (dd) { if (!dd.contains(e.target)) closeDd(dd); });
    });

    /* ── 햄버거 ── */
    var hb = document.getElementById('hamburger');
    var mm = document.getElementById('mobileMenu');
    if (hb && mm) {
      /* ── 포커스 가두기 (2026-08-02 D-1) ────────────────────────────────────
         메뉴를 열어도 포커스가 햄버거에 남고 뒤 화면이 그대로 탭에 걸려 있었다.
         낭독기·키보드 사용자는 '열린 메뉴 뒤의 안 보이는 링크들'을 계속 지나야 했다.
         세 가지를 같이 한다 — ① 열면 첫 항목으로 포커스 이동 ② 열려 있는 동안 뒤 화면
         inert ③ 닫으면 열었던 버튼으로 되돌림. 하나만 하면 반쪽이다.
         ⚠️ inert 미지원 브라우저를 위해 aria-hidden 도 같이 건다(둘 다 없으면 낭독기가
            뒤 화면을 계속 읽는다). nav 자신과 메뉴는 대상에서 뺀다. */
      function backdropInert(on) {
        [].slice.call(document.body.children).forEach(function (el) {
          if (el === mm || el.id === 'navbar' || el.classList.contains('skip-link')) return;
          if (on) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
          else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
        });
      }
      function setMenu(open) {
        mm.classList.toggle('open', open);
        hb.classList.toggle('open', open);
        hb.setAttribute('aria-expanded', open ? 'true' : 'false');
        document.body.style.overflow = open ? 'hidden' : '';
        backdropInert(open);
        if (open) {
          var first = mm.querySelector('button, a');
          if (first) first.focus();
        } else {
          hb.focus();
        }
      }
      hb.addEventListener('click', function () { setMenu(!mm.classList.contains('open')); });
      /* 열린 메뉴 안에서 Tab 이 밖으로 새지 않게 순환시킨다 */
      mm.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab' || !mm.classList.contains('open')) return;
        var f = [].slice.call(mm.querySelectorAll('a[href], button:not([disabled])'))
          .filter(function (el) { return el.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      // 메뉴 안의 링크를 누르면 닫는다(같은 페이지 앵커로 가는 경우 메뉴가 덮고 있으면 안 되므로)
      mm.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () {
          // 이동하면서 닫힌다 — 여기서 hb.focus() 를 부르면 안 되므로 상태만 되돌린다.
          mm.classList.remove('open'); hb.classList.remove('open');
          hb.setAttribute('aria-expanded', 'false');
          document.body.style.overflow = '';
          backdropInert(false);
        });
      });
      /* 아코디언 — 토글은 button 이라 위 '링크 클릭 시 닫기'에 안 걸린다.
         ⚠️ **여기는 계속 두 번이다**: 한 번 = 펼치기, 한 번 더 = 허브로 이동. 모바일엔 호버가
            없어 첫 탭에 허브로 보내면 하위 항목을 볼 방법이 사라진다(2026-08-02 오너 확정 —
            데스크톱만 한 번으로 바꿨다). 위 드롭다운을 고칠 때 여기까지 같이 바꾸지 말 것.
            그래서 '눌러서 접기'가 없어진 대신 **하나를 펼치면 다른 하나를 접는다** —
            접는 길이 하나도 없으면 메뉴가 열린 채로만 남는다. */
      var accs = [].slice.call(mm.querySelectorAll('.mm-acc'));
      function closeAcc(acc) {
        acc.classList.remove('is-open');
        var b = acc.querySelector('.mm-acc-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
      }
      accs.forEach(function (acc) {
        var btn = acc.querySelector('.mm-acc-btn');
        if (!btn) return;
        btn.addEventListener('click', function () {
          var hub = btn.getAttribute('data-hub');
          if (acc.classList.contains('is-open')) { if (hub) location.href = hub; return; }
          accs.forEach(closeAcc);
          acc.classList.add('is-open');
          btn.setAttribute('aria-expanded', 'true');
        });
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      dds.forEach(closeDd);
      if (mm && mm.classList.contains('open') && hb) hb.click();   // setMenu(false) → 포커스 복귀까지
    });
  }

  /* 서버 확인 결과대로 오른쪽 버튼·모바일 회원 카드를 맞춘다. hint=null 이면 비로그인 화면.
     위 '기기 기억'이 이미 같은 모양을 그려 놨으면 그대로 두고(교체 깜빡임 방지),
     다를 때만 고친다 — 이름·역할이 바뀌었거나 기억이 틀렸던 경우다. */
  function applyAuthUI(hint) {
    var navRight = document.querySelector('#navbar .nav-right');
    if (navRight) {
      var html = navRightHtml(hint);
      if (navRight.innerHTML !== html) navRight.innerHTML = html;
    }
    var mmEl = document.getElementById('mobileMenu');
    if (!mmEl) return;
    var card = mmEl.querySelector('.mm-member-card');
    var loginBtn = mmEl.querySelector('.mm-login');
    if (!hint) {                       // 기억으로 그렸는데 실제론 로그아웃 → 되돌린다
      if (card) card.remove();
      if (!loginBtn) {
        var cta = mmEl.querySelector('.mobile-menu-cta');
        if (cta) {
          var a = document.createElement('a');
          a.className = 'mm-login';
          a.href = loginHref();
          a.textContent = '로그인 / 회원가입';
          cta.insertBefore(a, cta.firstChild);
        }
      }
      return;
    }
    if (!card) {
      card = document.createElement('a');
      card.className = 'mm-member-card';
      mmEl.insertBefore(card, mmEl.firstElementChild);
      // 회원 카드가 메뉴를 닫는 처리에 걸리도록(위 wire 는 주입 전에 돌았다)
      card.addEventListener('click', function () { document.body.style.overflow = ''; });
    }
    card.href = memberHref(hint);
    var cardHtml = memberCardHtml(hint);
    if (card.innerHTML !== cardHtml) card.innerHTML = cardHtml;
    if (loginBtn) loginBtn.remove();
  }

  /* 로그인 상태면 오른쪽 버튼을 '마이페이지 알약'으로 바꾸고 모바일 메뉴에 회원 카드를 끼운다.
     ⚠️ MONC(supabase-config.js) 가 없는 페이지에서는 아무것도 하지 않는다 — 기억대로 유지. */
  function initAuth() {
    if (!window.MONC || !window.MONC.getSession) return;
    (async function () {
      var session = null;
      try { session = await MONC.getSession(); } catch (e) { return; }
      if (!session) {
        // 기억으로 먼저 그렸는데 세션이 없다(만료 등) → 기억을 지우고 비로그인으로 되돌린다
        if (authHint) {
          try { localStorage.removeItem(AUTH_HINT_KEY); } catch (e) {}
          applyAuthUI(null);
        }
        return;
      }

      var profile = null;
      try { profile = await MONC.getMyProfile(); } catch (e) {}
      // 관리자는 회원 마이페이지가 아니라 관리자 페이지로 보낸다.
      var hint = {
        role: (profile && profile.role === 'admin') ? 'admin' : 'member',
        name: (profile && profile.name) ? profile.name : '회원'
      };
      // 다음 페이지가 처음부터 맞게 그리도록 기억을 갱신 — 조회 실패 시엔 덮어쓰지 않는다
      if (profile) {
        try { localStorage.setItem(AUTH_HINT_KEY, JSON.stringify(hint)); } catch (e) {}
      }
      applyAuthUI(profile ? hint : (authHint || hint));
    })();
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
