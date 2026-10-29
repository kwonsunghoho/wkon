/* MONC 공용 헤더·전체 메뉴. 인증과 목적지의 접근 권한은 기존 페이지가 확인한다. */
(function () {
  'use strict';
  if (document.getElementById('navbar')) return;
  var LOGO = 'images/MONC_Logo_Full_Package/assets/web/monc-logo-transparent-640.webp';
  var groups = [
    ['교육 과정', [['challenges.html','챌린지'],['online-courses.html','온라인 강의'],['lectures.html','특강']]],
    ['면접 연습', [['sojae.html','답변 소재 발굴'],['polish.html','답변 첨삭'],['games.html','역량검사 연습']]],
    ['자료·정보', [['lab-airline.html','면접 자료·기출'],['news.html','항공사 뉴스·산업분석']]],
    ['커뮤니티', [['community.html?view=board&topic=prep','게시판'],['community.html?view=studies','스터디'],['tools.html#community','카카오톡 오픈채팅']]],
    ['수강 후기', [['reviews-list.html?kind=challenge','챌린지 후기'],['reviews-list.html?kind=ke20','수업 후기']]]
  ];
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  var SOCIAL = [
    ['https://www.instagram.com/monc.point/', '인스타그램',
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.209 0-4-1.79-4-4 0-2.209 1.79-4 4-4 2.209 0 4 1.79 4 4 0 2.209-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/></svg>'],
    ['https://www.youtube.com/@monc_lab', '유튜브',
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>'],
    /* 네이버 블로그 (2026-08-09 오너 지시) — N 마크도 currentColor(브랜드 초록 금지 규칙 동일) */
    ['https://blog.naver.com/mtccm', '네이버 블로그',
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.273 12.845 7.376 0H0v24h7.726V11.156L16.624 24H24V0h-7.727v12.845Z"/></svg>'],
    /* 오픈채팅 커뮤니티 (2026-08-16 오너 "모바일 햄버거에 좀 추가하면 어떨까") — 오픈챗
       직링크가 아니라 **도구 허브의 회원 게이트 카드(tools.html#community)로 가는 문**이다.
       방 주소는 레포에 못 싣는다(회원 전용 — community-card.js·pages.md). 내부 링크라
       target=_blank 를 붙이지 않는다(socialHtml 이 http 여부로 가른다).
       넷째 원소 = 표시 플래그: 'row2'(모바일 햄버거에서 여기부터 둘째 줄 — 카카오 짝),
       'promo'(**카카오 노랑 알약** — 같은 날 오너 "카톡문의랑 같은 느낌이라 클릭률 떨어질 것
       같다, 더 강조해줘". 노랑은 이 사이트에서 '카카오로 가는 행동' 색이다: .kakao-ask·카드
       입장 버튼과 같은 문법. 채널 아이콘 브랜드색 금지 규칙과 별개 — 그건 그대로다). */
    ['tools.html#community', '카카오톡 오픈채팅',
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>',
      'row2 promo'],
    /* 카카오톡 문의 (2026-08-09 오너 "문의를 좀 바로 할 수 있게") — 앞 셋은 채널이고 이것만
       문의 창구라 라벨을 '문의'로 구분한다. ⚠️ 주소에 **`/chat` 을 붙일 것** — 채널 홈이
       비공개라 홈 주소는 '페이지를 찾을 수 없습니다'가 뜬다(pages.md).
       ⚠️ 아이콘은 여기서도 currentColor 다 — 노랑은 결제 화면 버튼(.kakao-ask) 몫이고,
          이 줄은 다섯이 같은 회색으로 서야 목록으로 읽힌다(브랜드색 금지 규칙 그대로). */
    ['https://pf.kakao.com/_iajxnX/chat', '카카오톡 문의',
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3C6.9 3 2.8 6.2 2.8 10.2c0 2.5 1.7 4.7 4.2 6l-1 3.6c-.1.3.3.6.6.4l4.3-2.8c.4 0 .7.1 1.1.1 5.1 0 9.2-3.2 9.2-7.2S17.1 3 12 3z"/></svg>']
  ];
  /* ⚠️ `rel` 에 noopener 는 필수 — target=_blank 로 연 창이 opener 로 이 페이지를 조작할 수 있다.
     ⚠️ 이름은 <span> 으로 감싼다 — 데스크톱 푸터에서 글자만 숨기고 싶어질 때를 위해서가
        아니라, 아이콘(svg)과 글자의 세로 정렬을 flex 로 잡기 위해서다. */
  /* splitRows=true(모바일 햄버거)면 'row2' 표시 항목 앞에 줄바꿈 조각(.sbreak)을 넣어
     "채널 셋 / 카카오 둘" 두 줄로 갈라 세운다(2026-08-16 오너 "카톡문의만 동떨어져 보인다").
     푸터(데스크톱)는 한 줄 그대로. 내부 링크(http 아님)에는 target=_blank 를 안 붙인다.
     'promo' 표시 항목은 .s-promo(카카오 노랑 알약) — 모바일·푸터 양쪽 공통. */
  function socialHtml(splitRows) {
    return SOCIAL.map(function (s) {
      var ext = /^https?:/i.test(s[0]);
      var flags = s[3] || '';
      return (splitRows && flags.indexOf('row2') >= 0 ? '<i class="sbreak" aria-hidden="true"></i>' : '') +
        '<a href="' + s[0] + '"' + (flags.indexOf('promo') >= 0 ? ' class="s-promo"' : '') +
        (ext ? ' target="_blank" rel="noopener"' : '') + '>' + s[2] +
        '<span>' + esc(s[1]) + '</span></a>';
    }).join('');
  }


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


  function myHtml(hint) {
    return '<a class="nav-my" aria-label="' + (hint ? '마이페이지' : '마이: 로그인') + '" href="' + (hint ? 'mypage.html' : loginHref()) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="3.5"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg><span>마이</span></a>';
  }
  function accountHtml(hint) {
    return hint ? '<a href="mypage.html"><span class="mm-name">' + esc(hint.name || '회원') + ' 님</span><span>내 정보 →</span></a>'
      : '<a href="' + loginHref() + '">로그인 / 회원가입 <span aria-hidden="true">→</span></a>';
  }
  function menuHtml() {
    return groups.map(function (group,index) {
      return '<section class="mm-group"><h2><button type="button" class="mm-group-toggle" aria-expanded="false" aria-controls="menuGroup' + index + '">' + esc(group[0]) + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></h2><ul id="menuGroup' + index + '" hidden>' + group[1].map(function (item) {
        return '<li><a href="' + esc(item[0]) + '" data-menu-destination>' + esc(item[1]) + '</a></li>';
      }).join('') + '</ul></section>';
    }).join('');
  }
  function mount() {
    var holder = document.createElement('div');
    holder.innerHTML = '<a class="skip-link sr-only" href="#main">본문 바로가기</a>' +
      '<nav id="navbar" aria-label="공용 헤더"><div class="nav-inner">' +
      '<a class="logo" href="index.html" aria-label="MONC 메인"><img src="' + LOGO + '" alt="MONC" width="96" height="32"></a>' +
      '<div class="nav-right">' + myHtml(authHint) + '</div>' +
      '<button type="button" class="hamburger" id="hamburger" aria-label="전체 메뉴 열기" aria-controls="mobileMenu" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18M3 12h18M3 19h18"/></svg></button></div></nav>' +
      '<dialog id="mobileMenu" aria-label="전체 메뉴"><div class="mm-head"><a class="logo" href="index.html" aria-label="MONC 메인"><img src="' + LOGO + '" alt="MONC" width="96" height="32"></a><button id="menuClose" type="button" aria-label="전체 메뉴 닫기" autofocus><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19"/></svg></button></div>' +
      '<div class="mm-scroll"><div class="mm-account">' + accountHtml(authHint) + '</div><nav class="mm-personal" aria-label="내 학습"><a href="classroom.html" data-menu-destination>내 강의실</a><a href="answers.html" data-menu-destination>저장한 답변</a><a href="mypage.html" data-menu-destination>마이페이지</a></nav><nav aria-label="전체 기능">' + menuHtml() + '</nav>' +
      '<nav class="mm-support" aria-label="소개 및 문의"><a href="researchers.html" data-menu-destination>몬크·연구진 소개</a><a href="consult.html" data-menu-destination>1:1 상담 예약</a><a href="https://pf.kakao.com/_iajxnX/chat" target="_blank" rel="noopener" data-menu-destination>카카오톡 문의</a><a href="admin.html" id="menuAdmin" hidden data-menu-destination>관리자</a></nav>' +
      '<div class="mm-social">' + SOCIAL.slice(0,3).map(function (s) { return '<a href="' + s[0] + '" target="_blank" rel="noopener">' + esc(s[1]) + '</a>'; }).join('') + '</div></div></dialog>';
    var anchor = document.body.firstChild;
    while (holder.firstChild) document.body.insertBefore(holder.firstChild,anchor);
    markMain();
    mountFooterSocial();
    upgradeLoginLinks();
    syncCurrent();
    window.addEventListener('monc:community-route',syncCurrent);
    window.addEventListener('hashchange',syncCurrent);
    wire();
    initAuth();
  }
  function syncCurrent() {
    var here = location.pathname.split('/').pop() || 'index.html';
    var now = new URLSearchParams(location.search);
    document.querySelectorAll('#mobileMenu [data-menu-destination]').forEach(function (link) {
      var url = new URL(link.href,location.href);
      var matches = url.origin === location.origin && url.pathname.split('/').pop() === here;
      if (matches && here === 'community.html') {
        var view = now.get('view') || 'home';
        view = ({thread:'board',study:'studies',profile:'activity'})[view] || view;
        matches = (url.searchParams.get('view') || 'home') === view;
        if (matches && view === 'board') matches = (url.searchParams.get('topic') || '') === (now.get('topic') || '');
      } else if (matches && here === 'reviews-list.html') {
        var kind = now.get('kind');
        if (['challenge','ke20','consult'].indexOf(kind) < 0) kind = 'challenge';
        matches = url.searchParams.get('kind') === kind;
      } else if (matches) matches = url.hash === location.hash;
      if (matches) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    });
  }
  function wire() {
    var dialog = document.getElementById('mobileMenu');
    var opener = document.getElementById('hamburger');
    var savedOverflow = '', savedPadding = '';
    function close() { if (dialog.open) dialog.close(); }
    function expandGroup(selected) {
      dialog.querySelectorAll('.mm-group-toggle').forEach(function (button) {
        var expanded=button===selected;
        button.setAttribute('aria-expanded',String(expanded));
        document.getElementById(button.getAttribute('aria-controls')).hidden=!expanded;
      });
    }
    opener.addEventListener('click',function () {
      savedOverflow = document.body.style.overflow;
      savedPadding = document.body.style.paddingRight;
      var gap = window.innerWidth - document.documentElement.clientWidth;
      if (gap) document.body.style.paddingRight = (parseFloat(getComputedStyle(document.body).paddingRight) + gap) + 'px';
      document.body.style.overflow = 'hidden';
      // 메뉴를 열 때는 전체 분류를 먼저 보여주고, 선택한 그룹 하나만 펼친다.
      expandGroup(null);
      dialog.showModal();
      dialog.querySelector('.mm-scroll').scrollTop=0;
      opener.setAttribute('aria-expanded','true');
      document.getElementById('menuClose').focus();
    });
    dialog.addEventListener('close',function () {
      document.body.style.overflow = savedOverflow;
      document.body.style.paddingRight = savedPadding;
      opener.setAttribute('aria-expanded','false');
      opener.focus({preventScroll:true});
    });
    document.getElementById('menuClose').addEventListener('click',close);
    dialog.addEventListener('cancel',function (event) { event.preventDefault(); close(); });
    dialog.addEventListener('click',function (event) {
      var toggle = event.target.closest('.mm-group-toggle');
      if (toggle) {
        expandGroup(toggle.getAttribute('aria-expanded')==='true' ? null : toggle);
        toggle.scrollIntoView({block:'nearest'});
        return;
      }
      var link = event.target.closest('a');
      if (link) {
        if (typeof window.moncBeacon === 'function') window.moncBeacon('menu_destination',{destination:link.getAttribute('href')});
        close();
      } else if (event.target === dialog) {
        var r=dialog.getBoundingClientRect();
        if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) close();
      }
    });
    // 브라우저 기본 모달 격리에 더해 Tab의 양 끝도 메뉴 안에서 순환한다.
    dialog.addEventListener('keydown',function (event) {
      if (event.key !== 'Tab') return;
      var nodes = Array.from(dialog.querySelectorAll('a[href],button')).filter(function (el) { return el.getClientRects().length && !el.disabled; });
      var first=nodes[0], last=nodes[nodes.length-1];
      if(event.shiftKey && document.activeElement===first){ event.preventDefault(); last.focus(); }
      else if(!event.shiftKey && document.activeElement===last){ event.preventDefault(); first.focus(); }
    });
    // 뒤로 가기로 복원될 때 열린 모달과 스크롤 잠금이 남지 않게 한다.
    window.addEventListener('pagehide',close);
  }
  function applyAuthUI(hint) {
    var right=document.querySelector('#navbar .nav-right');
    var account=document.querySelector('#mobileMenu .mm-account');
    // 서버 프로필로 확인된 관리자만 헤더에서 바로 관리 화면으로 이동한다.
    var isAdmin=!!(hint && hint.role==='admin');
    if(right) right.innerHTML=(isAdmin ? '<a class="nav-admin" href="admin.html" aria-label="관리자 페이지">관리자</a>' : '')+myHtml(hint);
    if(account) account.innerHTML=accountHtml(hint);
    document.getElementById('menuAdmin').hidden=!isAdmin;
  }
  function mountFooterSocial() {
    var f = document.querySelector('footer');
    if (!f || document.getElementById('moncSocial')) return;
    var inner = f.querySelector('.footer-inner');
    var host = inner || f;
    var box = document.createElement('div');
    box.id = 'moncSocial';
    box.innerHTML = socialHtml();
    /* ⚠️ 사업자 정보(.footer-copy) **앞**에 넣는다 — 맨 뒤에 붙이면 상호·사업자등록번호
       아래에 소셜이 와서, 푸터에서 가장 낮은 정보 밑에 링크가 매달린 꼴이 된다(실측으로
       한 번 그렇게 나왔다). 미니 푸터(.footer-copy 가 없는 7종)는 사업자 정보가 텍스트
       노드라 기준 요소가 없다 — 그쪽은 맨 뒤가 맞다. */
    var copy = host.querySelector('.footer-copy');
    if (copy) host.insertBefore(box, copy);
    else host.appendChild(box);
    /* ⚠️⚠️ `.footer-inner` 가 두 종류다 — 같은 클래스인데 축이 다르다.
          · index·challenges·researchers → `flex-direction: column`(줄이 세로로 쌓인다)
          · **챌린지 상세 4종** → `row` + `space-between`(로고 왼쪽 ↔ 사업자정보 오른쪽 한 줄)
       뒤쪽에 그냥 끼우면 소셜이 **로고와 사업자정보 사이 가운데**로 끌려간다(실측
       2026-08-04: 로고 x=252 · 소셜 x=846 · 같은 y). 그래서 row 인 경우에만 제 줄을
       차지하게 해 세 줄로 편다 — 결과 순서는 양쪽 다 로고 → (링크) → 소셜 → 사업자정보.
       ⚠️ 폭은 인라인 style 이 아니라 클래스로 준다(스타일은 nav.css 한 곳에 모은다). */
    if (inner && getComputedStyle(inner).flexDirection !== 'column') box.classList.add('is-row');
  }


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
      // 마이는 모두 내 정보로 연결하고, 확인된 관리자에게만 보조 링크를 연다.
      var hint = {
        role: (profile && profile.role === 'admin') ? 'admin' : 'member',
        name: (profile && profile.name) ? profile.name : '회원'
      };
      // 다음 페이지가 처음부터 맞게 그리도록 기억을 갱신 — 조회 실패 시엔 덮어쓰지 않는다
      if (profile) {
        try { localStorage.setItem(AUTH_HINT_KEY, JSON.stringify(hint)); } catch (e) {}
      }
      applyAuthUI(profile ? hint : { role: 'member', name: '회원' });
    })();
  }


  if(document.body) mount();
  else document.addEventListener('DOMContentLoaded',mount);
})();
