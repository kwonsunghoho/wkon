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

  /* 답변·자료 기능 목록. 숨긴 AI킬러·일문일답은 복원하지 않는다. */
  var TOOLS_SUB = [
    /* ⚠️ 1번 항목은 저장소(answers.html) 직행 — 구 mypage.html#sec-answers 는 저장 답변이
       0건이면 접이가 아예 안 그려져 '눌렀는데 아무것도 없음'이 됐다(2026-08-02 오너
       "접힌 칸으로 안 가게 해야지"). 마이페이지 접이로 되돌리지 말 것. */
    ['answers.html', '나만의 승준노트', '쓴 답변이 전부 모이는 곳'],
    /* 순서는 tools.html 카드와 같다(2026-09-23 노트 포스터 승격에 맞춰 정렬): 노트에 글을 넣는 도구(소재 → 첨삭)가
       먼저, 읽고 연습하는 도구(뉴스 → 게임)가 뒤. */
    ['sojae.html', '답변 소재 발굴', '내 경험에서 소재 찾기'],
    ['polish.html', '답변 첨삭', "문장을 '지금 → 이렇게'로"],
    /* ⚠️ AI킬러 잠시 내림(2026-08-25 오너 "ai킬러는 잠깐 숨겨줘 네비에서") — 메뉴에서만 뺀다.
       tools.html 격자 타일은 지시 범위가 아니라 남겨 둔다('격자와 같은 구성' 규칙의 의도적
       예외 — briefing.md에 기록). 다시 열 때 아래 줄을 되살리고, 부제도 준비중 여부를 확인해
       'AI 같은 표현 찾아 밑줄로'(2026-08-11 이전 문구)로 되돌린다.
    ['ai-killer.html', 'AI킬러', '지금은 준비 중이에요'], */
    /* 2026-08-07 개명 '필수 기출 하루 한 개' → '일문일답' — programs.html 제목·tools.html 타일과 한 벌.
       ⚠️ 일문일답 잠시 내림(2026-08-26 오너 "일문일답도 일단 가려놓는게 좋겠다 네비랑 메뉴 전부에서")
       — tools.html 타일과 한 세트(AI킬러와 같은 방식 — 페이지는 살아 있다). 다시 열 때 둘 다 되살린다.
    ['programs.html', '일문일답', '하루 한 개, 내 경험으로'], */
    ['news.html', '항공사 뉴스&산업분석', '10개 항공사 소식 · 스크랩'],
    /* 역량검사 게임(2026-08-24 신설) — 무료·비회원 공개. tools.html 격자와 같은 목록 유지 */
    ['games.html', '역량검사 게임', '검사 유형 7가지 무료 연습']
  ];
  var CHALLENGE_HUB = 'challenges.html';
  /* PC는 상단 메뉴로 이동하고 모바일은 하단 탐색을 유지한다. */
  var COMMUNITY_SUB = [
    ['home', '커뮤니티 홈', '최근 올라온 글과 모집 중인 스터디'],
    ['board', '게시판', '승준정보·헤메&샵·자유게시판'],
    ['studies', '스터디매치', '참여 조건·프로필 확인과 지원'],
    ['activity', '내 활동', '내 글·스터디 지원·프로필·인증 관리']
  ];
  function communityMenuHtml() {
    return COMMUNITY_SUB.map(function (item) {
      return '<a href="community.html?view=' + item[0] + '" data-community-view="' + item[0] + '"><b>' + esc(item[1]) + '</b><span>' + esc(item[2]) + '</span></a>';
    }).join('');
  }
  var REVIEW_SUB = [
    ['reviews-list.html?kind=challenge', '챌린지 후기', '2주를 마친 학생들의 기록'],
    ['reviews-list.html?kind=ke20', '수업 후기', '수업에 참여한 분들이 직접 남긴 후기']
    /* ⚠️ 합격 수기 잠시 내림(2026-08-16 오너 지시 "상담 후기 먼저 채워넣고 그다음 오픈").
       '허브 카드와 같은 세 갈래' 규칙은 양쪽을 같이 줄여 유지한다 — reviews.html 의
       STORIES_OPEN·stories.html/story.html 리다이렉트와 한 벌(docs/notes/pages.md 참조).
       다시 열 때 아래 줄을 되살린다.
    ['stories.html', '합격 수기', '합격까지의 과정을 긴 글로'] */
  ];

  /* 어느 메뉴가 '현재 위치'인지 — 하위 페이지에 있어도 상위 메뉴에 표시가 남아야
     '내가 어디에 있는지'를 알 수 있다(오너가 불편해한 지점의 절반이 이것이다). */
  var SECTION_OF = {
    /* 승준 코스는 단독 링크라 자기 파일 하나뿐. 도구 페이지들은 '승준 도구' 소속 표시 */
    'community.html': 'community',
    'briefing.html': 'course',
    'tools.html': 'tools', 'news.html': 'tools', 'sojae.html': 'tools',
    'ai-killer.html': 'tools', 'answers.html': 'tools', 'polish.html': 'tools',
    'programs.html': 'tools', 'program.html': 'tools', 'experiences.html': 'tools',
    'games.html': 'tools',
    'challenges.html': 'challenge', 'challenge-voice.html': 'challenge',
    'challenge-expression.html': 'challenge', 'challenge-spinning.html': 'challenge',
    'challenge-answer.html': 'challenge', 'challenge-culture.html': 'challenge',
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


  /* 실제 유입은 챌린지·연구자료·특강이다. 답변 도구는 자료 활용 메뉴에서 찾는다. */
  var CHALLENGE_SUB = [[CHALLENGE_HUB, '2주 챌린지', '목소리·표정·발음·답변 집중 준비'], REVIEW_SUB[0]];
  var LECTURE_SUB = [['lectures.html', '특강', '강의 주제·수강 대상·일정 확인'], REVIEW_SUB[1]];
  var MATERIAL_SUB = [['lab-airline.html', '면접 연구자료', '항공사별 자료와 기출 찾기'], TOOLS_SUB[3], TOOLS_SUB[4], ['tools.html', '내 답변 준비 도구', '자료를 본 뒤 소재 발굴·첨삭·답변 저장']];
  Object.keys(SECTION_OF).forEach(function (file) {
    if (SECTION_OF[file] === 'lab' || SECTION_OF[file] === 'tools') SECTION_OF[file] = 'materials';
    else if (SECTION_OF[file] === 'reviews') SECTION_OF[file] = 'about';
  });
  SECTION_OF['researchers.html'] = 'about';

  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var section = SECTION_OF[here] || '';
  var onHome = (here === 'index.html' || here === '');

  /* ── 한 파일이 ?파라미터로 갈래를 겸하는 화면 (2026-08-05) ────────────────────
     `reviews-list.html?kind=` 처럼 파일 하나가 여러 갈래를 그리는 화면이 있다.
     curFile() 이 파일명만 비교하던 동안 **챌린지 후기·상담 후기 두 줄에 현재 표시가
     같이 남았다**(오너 신고 "상담후기를 눌렀는데 왜 챌린지후기에 줄이 생기니").
     · QUERY_DEFAULT = 주소에 값이 없을 때 그 화면이 그리는 갈래(그 페이지의 기본값과
       같은 값을 적는다 — reviews-list.html 의 `KIND` 폴백이 'challenge').
     · 아래 QUERY_VALUES 는 메뉴에 실린 값 목록이다. 주소에 이상한 값(`?kind=zzz`)이
       와도 페이지는 기본 갈래를 그리므로 표시도 기본 갈래로 맞춘다.
     ⚠️ `?`로 갈래가 갈리는 하위 항목을 새로 넣으면 QUERY_DEFAULT 에도 한 줄 넣는다 —
        빠뜨리면 그 화면에서 현재 표시가 아무 줄에도 안 붙는다. */
  var QUERY_DEFAULT = { 'reviews-list.html': { kind: 'challenge' } };
  var QUERY_VALUES = {};   // 'reviews-list.html|kind' → ['challenge','consult']
  [TOOLS_SUB, REVIEW_SUB].forEach(function (list) {
    list.forEach(function (it) {
      var p = String(it[0]).split('#')[0].split('?');
      if (!p[1]) return;
      var file = p[0].toLowerCase();
      new URLSearchParams(p[1]).forEach(function (v, k) {
        var key = file + '|' + k;
        (QUERY_VALUES[key] = QUERY_VALUES[key] || []).push(v);
      });
    });
  });
  /* 상담 후기는 메뉴에서 숨겼지만 기존 주소의 현재 표시 판정은 유지한다. */
  (QUERY_VALUES['reviews-list.html|kind'] = QUERY_VALUES['reviews-list.html|kind'] || []).push('consult');
  var hereQuery = new URLSearchParams(location.search);
  if (here === 'reviews-list.html') {
    section = hereQuery.get('kind') === 'ke20' ? 'lecture' : hereQuery.get('kind') === 'consult' ? 'about' : 'challenge';
  }

  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function cur(key) { return section === key ? ' aria-current="page"' : ''; }
  /* 하위 항목(드롭다운·아코디언)은 '섹션'이 아니라 '이 파일'인지로 표시한다 —
     펼쳤을 때 지금 보고 있는 줄이 어디인지 알 수 있어야 한다(2026-08-02 C-3).
     ⚠️ 파일명만 비교하지 말 것 — `?kind=` 로 갈래가 갈리는 화면에서 두 줄에 동시에
        표시가 남는다(위 QUERY_DEFAULT 주석). 항목이 들고 있는 파라미터는 주소와 값이
        같아야 하고, 주소에 없거나 모르는 값이면 그 화면의 기본 갈래로 본다. */
  function curFile(href) {
    var p = String(href).split('#')[0].split('?');
    var file = p[0].toLowerCase();
    if (file !== here) return '';
    var ok = true;
    new URLSearchParams(p[1] || '').forEach(function (want, key) {
      var got = hereQuery.get(key);
      var known = QUERY_VALUES[file + '|' + key] || [];
      if (got === null || known.indexOf(got) < 0) got = (QUERY_DEFAULT[file] || {})[key];
      if (got !== want) ok = false;
    });
    return ok ? ' aria-current="page"' : '';
  }
  var CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  /* ── 소셜 링크 (2026-08-04 오너 지시) ────────────────────────────────────────
     자리를 기기별로 나눈다 — **모바일은 햄버거 메뉴 하단, 데스크톱은 푸터.**
     ⚠️⚠️ **상단 바에는 넣지 말 것.** 두 가지 이유가 겹친다:
        ① 881~1059px 폴백은 메뉴 gap 을 16px 까지 좁혀 **겨우 넘침 0** 이다(nav.css 실측
           주석 — 6항목 분리로 하한이 769→881 로 올라간 경위 포함). '후기'가 드롭다운이 되며
           21px 늘었을 때 1000px 에서 우측 블록을 3px 침범한 전례가 있다 —
           아이콘 세 개(약 90px)면 그 구간이 다시 깨진다.
        ② 880px 이하에서 `.nav-right` 가 통째로 숨는다(모바일 상단은 로고+햄버거뿐).
           트래픽 99%가 모바일이라 상단 바는 **대부분의 학생이 못 보는 자리**다.
     ⚠️ 아이콘만 두지 말 것 — 글자를 같이 붙인다(원칙 15 '값에는 그것이 무엇인지 붙이기').
        라벨 없는 아이콘은 뉴스 스크랩에서 같은 이유로 폐기됐다.
     ⚠️ 계정을 옮기거나 채널이 늘면 **이 배열만** 고친다(푸터·햄버거가 같은 원본을 쓴다). */
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

  function ddMenu(items) {
    return items.map(function (it) {
      return '<a href="' + it[0] + '"' + curFile(it[0]) + '><b>' + esc(it[1]) + '</b><span>' + esc(it[2]) + '</span></a>';
    }).join('');
  }
  function spacePanelHtml(groups) {
    return groups.map(function (group) {
      return '<section class="mm-menu-group"><h2>' + esc(group[0]) + '</h2>' + group[1].map(function (it) {
        var communityLink = it[0].indexOf('community.html') === 0;
        return '<a class="mm-menu-link" href="' + it[0] + '"' + (communityLink ? ' data-community-shortcut' : curFile(it[0])) + '><b>' + esc(it[1]) + '</b><span>' + esc(it[2]) + '</span></a>';
      }).join('') + '</section>';
    }).join('');
  }
  function spaceHtml(key,label,description,href,id,panel) {
    return '<div class="mm-space-group"><div class="mm-space-head">' +
      '<a class="mm-space-link" href="' + href + '" data-space="' + key + '"><b>' + esc(label) + '</b><span>' + esc(description) + '</span></a>' +
      '<button class="mm-space-toggle" type="button" data-space-label="' + esc(label) + '" aria-expanded="false" aria-controls="' + id + '" aria-label="' + esc(label) + ' 메뉴 펼치기">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button></div>' +
      '<div class="mm-space-panel" id="' + id + '" hidden>' + panel + '</div></div>';
  }

  /* 로고는 홈에서는 준비 선택으로, 다른 페이지에서는 홈으로 이동 */
  var logoHref = onHome ? '#researchFeatures' : 'index.html';

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
    return btn + '<a class="nav-cta" href="apply.html">챌린지 신청</a>';
  }
  function memberCardHtml(hint) {
    var name = (hint.name || '회원').trim() || '회원';
    return '<span class="mm-avatar">' + esc(name.charAt(0) || '·') + '</span>' +
      '<span class="mm-member-text"><b>' + esc(name) + '</b> 님' +
      '<span class="mm-go">' + (hint.role === 'admin' ? '관리자 페이지 가기 →' : '마이페이지 가기 →') + '</span></span>';
  }

  /* PC와 모바일 모두 챌린지·연구자료·특강을 먼저, 커뮤니티를 그다음에 둔다. */
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
          '<li class="nav-dd"><button class="nav-dd-btn nav-feature" type="button" data-hub="challenges.html" aria-expanded="false" aria-haspopup="true"' + cur('challenge') + '>챌린지' + CHEV + '</button><div class="nav-dd-menu">' + ddMenu(CHALLENGE_SUB) + '</div></li>' +
          '<li class="nav-dd"><button class="nav-dd-btn" type="button" data-hub="lab-airline.html" aria-expanded="false" aria-haspopup="true"' + cur('materials') + '>연구자료' + CHEV + '</button><div class="nav-dd-menu">' + ddMenu(MATERIAL_SUB) + '</div></li>' +
          '<li class="nav-dd"><button class="nav-dd-btn" type="button" data-hub="lectures.html" aria-expanded="false" aria-haspopup="true"' + cur('lecture') + '>특강' + CHEV + '</button><div class="nav-dd-menu">' + ddMenu(LECTURE_SUB) + '</div></li>' +
          '<li class="nav-dd nav-community-entry"><button class="nav-dd-btn" type="button" data-hub="community.html" aria-expanded="false" aria-haspopup="true"' + cur('community') + '>커뮤니티' + CHEV + '</button><div class="nav-dd-menu">' + communityMenuHtml() + '</div></li>' +
          '<li><a href="researchers.html"' + cur('about') + '>몬크 소개</a></li>' +
        '</ul>' +
        '<div class="nav-right">' + navRightHtml(authHint) + '</div>' +
        '<button class="hamburger" id="hamburger" aria-label="메뉴" aria-expanded="false"><span></span><span></span><span></span></button>' +
      '</div>' +
      '<div class="nav-space-switch" role="navigation" aria-label="몬크 주요 메뉴">' +
        '<a href="index.html#researchFeatures" data-space="research">면접 준비</a>' +
        '<a href="community.html" data-space="community">커뮤니티</a>' +
      '</div>' +
    '</nav>' +
    '<div class="mobile-menu" id="mobileMenu">' +
      (authHint
        ? '<a class="mm-member-card" href="' + memberHref(authHint) + '">' + memberCardHtml(authHint) + '</a>'
        : '') +
      '<nav class="mm-spaces" aria-label="면접 준비와 커뮤니티">' +
        '<div class="mm-preparation">' + spacePanelHtml([
          ['챌린지', CHALLENGE_SUB],
          ['면접 연구자료', MATERIAL_SUB],
          ['특강', LECTURE_SUB]
        ]) + '</div>' +
        spaceHtml('community','커뮤니티','질문·정보 공유·스터디매치','community.html','mmCommunity',spacePanelHtml([
          ['함께 준비하기', [
            ['community.html?view=board','게시판','승준정보·헤메&샵·자유게시판'],
            ['community.html?view=studies','스터디매치','함께 준비할 스터디 모집과 지원'],
            ['community.html?view=activity','내 활동','내 글·스터디 지원·프로필·인증 관리']
          ]]
        ])) +
        '<a class="mm-about" href="researchers.html"' + curFile('researchers.html') + '>몬크 소개·연구진 →</a>' +
      '</nav>' +
      '<div class="mobile-menu-cta">' +
        (authHint ? '' : '<a class="mm-login" href="' + loginHref() + '">로그인 / 회원가입</a>') +
        '<a class="mm-apply" href="apply.html">챌린지 신청하기</a>' +
      '</div>' +
      /* 소셜 — 모바일은 여기가 담당(데스크톱 몫은 아래 mountFooterSocial 의 푸터).
         ⚠️ CTA 버튼 **아래**에 둔다. 위에 두면 신청하기까지 가는 길에 외부 링크가 끼어든다. */
      '<div class="mm-social">' + socialHtml(true) + '</div>' +
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
    alignSpaceNav();
    syncSpaceNav();
    window.addEventListener('monc:community-route', syncSpaceNav);
    markMain();
    mountFooterSocial();
    wire();
    upgradeLoginLinks();
    initAuth();
  }

  /* 같은 파일 안에서 게시판·모집 화면을 오가도 상위 메뉴의 현재 표시를 갱신한다. */
  function syncSpaceNav() {
    var view = new URLSearchParams(location.search).get('view');
    var active = section === 'community'
      ? 'community'
      : (onHome || ['course','challenge','lecture','materials','about'].indexOf(section) !== -1 ? 'research' : '');
    document.querySelectorAll('#navbar .nav-space-switch [data-space], #mobileMenu .mm-spaces [data-space]').forEach(function (a) {
      if (a.getAttribute('data-space') === active) a.setAttribute('aria-current','page');
      else a.removeAttribute('aria-current');
    });
    var communityView = view || 'home';
    if (communityView === 'thread') communityView = 'board';
    if (communityView === 'study') communityView = 'studies';
    if (communityView === 'profile') communityView = 'activity';
    document.querySelectorAll('#navbar [data-community-view]').forEach(function (a) {
      if (section === 'community' && a.getAttribute('data-community-view') === communityView) a.setAttribute('aria-current','page');
      else a.removeAttribute('aria-current');
    });
    var now = new URLSearchParams(location.search);
    document.querySelectorAll('#mobileMenu [data-community-shortcut]').forEach(function (a) {
      var wanted = new URL(a.href,location.href).searchParams;
      var matched = section === 'community' && (now.get('view') || 'home') === wanted.get('view') && !now.get('id');
      ['topic','mode','verified'].forEach(function (key) {
        if ((now.get(key) || '') !== (wanted.get(key) || '')) matched = false;
      });
      if (matched) a.setAttribute('aria-current','page');
      else a.removeAttribute('aria-current');
    });
  }

  /* 공용 바에 추가한 45px만 보완한다. 홈 사진·커뮤니티의 자체 여백은 각 화면이 맡는다. */
  function alignSpaceNav() {
    if (onHome || section === 'community') return;
    var original = document.body.style.paddingTop;
    function fit() {
      document.body.style.paddingTop = original;
      if (window.matchMedia('(max-width:880px)').matches) {
        var base = parseFloat(window.getComputedStyle(document.body).paddingTop) || 0;
        document.body.style.paddingTop = (base + 45) + 'px';
      }
    }
    fit();
    window.addEventListener('resize', fit, { passive: true });
  }

  /* 데스크톱 소셜 — 페이지 푸터 맨 끝에 붙인다(모바일에서는 nav.css 가 숨긴다. 그쪽은
     햄버거 메뉴가 담당 — 오너 확정 2026-08-04 "모바일은 햄버거, 데스크톱은 푸터").
     ⚠️ 푸터 구조가 두 가지다. `.footer-inner`(index·challenges·researchers·챌린지 상세
        4종)는 폭·정렬을 그 안에서 잡으므로 **그 안에** 넣어야 좌우가 맞는다. 없는 쪽
        (apply·결제 화면 6종의 인라인 미니 푸터)은 footer 가 직접 자식을 세우므로 거기 붙인다.
        footer 에 무조건 붙이면 앞의 일곱 페이지에서 소셜만 컨테이너 밖으로 삐져나온다.
     ⚠️ 푸터가 **없는 페이지에는 아무것도 만들지 않는다**(2026-08-04 기준 25개 —
        sojae·answers·reviews·lectures·briefing·lab 등). 없는 자리에 소셜 줄만 띄우면
        페이지마다 하단 구조(dock·sticky bar)와 부딪힌다. 그 페이지들의 데스크톱 노출은
        푸터를 공용화할 때 함께 해결한다. */
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
       ⚠️ 드롭다운이 여럿이라(승준 도구·챌린지·연구실·후기) 하나를 열면 나머지는 닫는다 — 같이 열리면 메뉴가 겹쳐 뜬다.
       ⚠️ 누름 횟수는 **마우스 유무로 갈린다**(2026-08-02 오너 "웹에서는 두번 클릭해야 허브로
          이동하잖아? 한번 클릭으로 바꿔줘 … 모바일은 한번에 이동하면 하위탭이 의미가 없잖아").
          · 마우스가 있는 기기 → **한 번에 허브로 이동.** 목차는 CSS 의 `:hover`/`:focus-within`
            이 이미 열어 주므로(nav.css) '여는 클릭'이 하는 일이 없었다.
          · 마우스가 없는 넓은 화면(터치 태블릿 ≥881px) → **예전대로 두 번.** 여기서 한 번에
            보내면 드롭다운을 열 방법이 아예 사라진다.
          · 모바일(≤880px)은 이 코드가 아니라 아래 햄버거 아코디언이고 거기는 두 번 유지.
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
      // 제목 링크와 펼침 버튼을 나눈다. 같은 버튼으로 반복해서 열고 닫을 수 있다.
      var spaceToggles = [].slice.call(mm.querySelectorAll('.mm-space-toggle'));
      spaceToggles.forEach(function (toggle) {
        toggle.addEventListener('click', function () {
          var opening = toggle.getAttribute('aria-expanded') !== 'true';
          spaceToggles.forEach(function (other) {
            var expanded = other === toggle && opening;
            var panel = document.getElementById(other.getAttribute('aria-controls'));
            other.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            other.setAttribute('aria-label', other.getAttribute('data-space-label') + (expanded ? ' 메뉴 접기' : ' 메뉴 펼치기'));
            if (panel) panel.hidden = !expanded;
          });
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
