/* ── 특강(lectures.html · lecture.html · index 홈 섹션) 공용 헬퍼 ──
   날짜·상태·이스케이프 등 순수 유틸 + 항공사 매핑 + 카드 마크업 빌더.
   카드 스타일은 lectures.css 한 곳에서 관리(세 페이지 공용). Supabase 접근은 각 페이지가 MONC.sb로 직접. */
(function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function parseDate(str) {
    if (!str) return null;
    const m = String(str).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(str);
    return isNaN(d) ? null : d;
  }

  // 신청(모집) 상태: 'open' | 'upcoming' | 'closed'. 날짜 없으면 상시(open).
  function status(start, end) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const s = parseDate(start), e = parseDate(end);
    if (!s && !e) return 'open';
    if (s && today < s) return 'upcoming';
    if (e) { const ee = new Date(e); ee.setHours(23, 59, 59, 999); if (today > ee) return 'closed'; }
    return 'open';
  }

  function ddaySuffix(end) {
    const e = parseDate(end);
    if (!e) return '';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    e.setHours(23, 59, 59, 999);
    const diff = Math.ceil((e - today) / 86400000);
    if (diff < 0) return '';
    if (diff === 0) return ' · 오늘 마감';
    if (diff <= 3) return ' · D-' + diff;
    return '';
  }

  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  function fmtDate(str) {
    const d = parseDate(str);
    if (!d) return '';
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일(' + WEEK[d.getDay()] + ')';
  }

  function fmtPeriod(start, end) {
    const f = x => { const d = parseDate(x); return d ? (d.getMonth() + 1) + '/' + d.getDate() : '?'; };
    if (!start && !end) return '';
    return f(start) + ' ~ ' + f(end);
  }

  // 항공사 매핑 — 영문 사명(로고 대신 조판)만 여기 두고, 액센트색은 lectures.css의 --air-<code> 변수로.
  const AIRLINES = {
    ke:  { ko: '대한항공',   en: 'KOREAN AIR' },
    lj:  { ko: '진에어',     en: 'JIN AIR' },
    '7c':{ ko: '제주항공',   en: 'JEJU AIR' },
    tw:  { ko: '티웨이항공', en: "T'WAY AIR" },
    ze:  { ko: '이스타항공', en: 'EASTAR JET' },
    yp:  { ko: '에어프레미아', en: 'AIR PREMIA' },
    rf:  { ko: '에어로케이', en: 'AERO K' },
  };
  function airline(code) { return (code && AIRLINES[code]) || null; }

  // 메타행 아이콘(최대 3개): 날짜·강사·잔여석
  const IC = {
    cal:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>',
    who:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5"/></svg>',
    seat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v8h9M6 13l-1 4M15 13l1 4M6 9h9a3 3 0 0 1 3 3v1"/></svg>',
  };
  function mi(icon, text, cls) { return '<span class="mi' + (cls ? ' ' + cls : '') + '">' + icon + text + '</span>'; }

  // 카드 커버에 깔 사진 주소. 허용 스킴만 통과시키고(그 외는 사진 없음 취급),
  // CSS url("...") 안에 넣을 수 있게 역슬래시·따옴표를 이스케이프한다.
  // (반환값은 호출부에서 esc()로 한 번 더 감싸 HTML 속성에 안전하게 들어간다)
  function shotUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    // 스킴이 붙어 있으면 http(s)·data:image 만 통과시킨다(javascript: 등 차단).
    // 스킴이 없으면 'images/foo.webp' 같은 사이트 안 경로라 그대로 쓴다.
    if (/^[a-z][a-z0-9+.\-]*:/i.test(s) && !/^https?:\/\//i.test(s) && !/^data:image\//i.test(s)) return '';
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  // 특강 카드 마크업(스펙: 커버[영문명·제목·룰·뱃지] + 정보부[서브·메타]). 세 페이지 공용.
  function cardHtml(l) {
    const air = airline(l.airline);
    // 사진이 있으면 커버가 '사진 + 아이보리로 녹아드는 그라디언트'가 된다(lectures.css .has-shot).
    // 없으면 지금까지의 아이보리 커버 그대로 — 사진을 준비 못 한 특강도 카드가 안 깨진다.
    const shot = shotUrl(l.thumb_url);
    const vars = [
      l.airline ? '--lx-accent:var(--air-' + l.airline + ')' : '',
      shot ? '--lx-shot:url(&quot;' + esc(shot) + '&quot;)' : '',
    ].filter(Boolean).join(';');
    const accentStyle = vars ? ' style="' + vars + '"' : '';
    const st = status(l.recruit_start, l.recruit_end);
    const soldOut = l.seats_left === 0;
    const isOut = soldOut || st === 'closed';
    const free = !(l.price > 0);
    const badge = free
      ? '<span class="lx-badge free">무료</span>'
      : '<span class="lx-badge paid">' + Number(l.price).toLocaleString() + '원</span>';

    let third = '';
    if (st === 'upcoming') third = mi(IC.seat, '신청 예정');
    else if (isOut) third = mi(IC.seat, '신청 마감');
    else if (l.seats_left != null) third = mi(IC.seat, '잔여 ' + l.seats_left + '석', l.seats_left <= 5 ? 'seats-low' : '');

    const dateStr = fmtDate(l.lecture_date);
    const meta = [
      dateStr ? mi(IC.cal, dateStr) : '',
      l.instructor ? mi(IC.who, esc(l.instructor)) : '',
      third,
    ].filter(Boolean).join('');

    return '<a class="lx-card' + (isOut ? ' is-out' : '') + (shot ? ' has-shot' : '') + '"' + accentStyle
      + ' href="lecture.html?id=' + encodeURIComponent(l.id) + '">'
      + '<div class="lx-cover">'
      +   badge
      +   '<div class="lx-txt">'
      +     (air ? '<div class="lx-en">' + esc(air.en) + '</div>' : '')
      +     '<div class="lx-ko">' + esc(l.title) + '</div>'
      +     '<hr class="lx-rule">'
      +   '</div>'
      + '</div>'
      + '<div class="lx-info">'
      +   (l.subtitle ? '<div class="lx-copy">' + esc(l.subtitle) + '</div>' : '')
      +   (meta ? '<div class="lx-meta">' + meta + '</div>' : '')
      + '</div>'
      + '</a>';
  }

  // 로딩 스켈레톤 카드(은은한 펄스)
  function skeletonHtml(n) {
    let s = '';
    for (let i = 0; i < (n || 3); i++) {
      s += '<div class="lx-sk lx-sk-pulse"><div class="sk-cover"></div>'
        + '<div class="sk-lines"><div class="sk-line"></div><div class="sk-line s2"></div></div></div>';
    }
    return s;
  }

  window.LEC = { esc, parseDate, status, ddaySuffix, fmtDate, fmtPeriod, AIRLINES, airline, shotUrl, cardHtml, skeletonHtml };
})();
