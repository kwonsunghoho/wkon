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

  /* ── 시간대(lecture_slots) ──
     한 특강을 여러 날·여러 타임으로 열 때 쓴다. 정원·잔여석은 타임마다 따로.
     특강의 capacity/lecture_date 는 DB 트리거가 슬롯에서 롤업하므로 카드 코드는 그대로다. */

  // '14:00:00' → '오후 2시', '09:30' → '오전 9시 30분'. 못 읽으면 원문 그대로.
  function fmtTime(t) {
    if (!t) return '';
    const m = String(t).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return String(t);
    const h = +m[1], min = +m[2];
    const ampm = h < 12 ? '오전' : '오후';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return ampm + ' ' + h12 + '시' + (min ? ' ' + min + '분' : '');
  }

  // 시간대 한 줄 표기: '7월 24일(금) · 오후 2시 ~ 오후 3시 30분 · 오전반'
  function slotWhen(s) {
    if (!s) return '';
    const time = [fmtTime(s.start_time), fmtTime(s.end_time)].filter(Boolean).join(' ~ ');
    return [fmtDate(s.slot_date), time, s.label].filter(Boolean).join(' · ');
  }

  // 짧은 표기(신청 내역·관리자 목록용): '7/24 14:00'
  function slotShort(s) {
    if (!s) return '';
    const d = parseDate(s.slot_date);
    const day = d ? (d.getMonth() + 1) + '/' + d.getDate() : '';
    const hm = s.start_time ? String(s.start_time).slice(0, 5) : '';
    return [day, hm].filter(Boolean).join(' ') || (s.label || '');
  }

  // 이 타임이 꽉 찼는가 (정원 미설정이면 무제한)
  function slotFull(s) { return !!s && s.seats_left === 0; }

  /* 남은 자리 수를 신청자에게 보여줄지 (admin '특강' 탭의 잔여석 공개 스위치).
     ⚠️ 표시 판정일 뿐이다 — 마감 문구·정원 초과 차단은 이 값과 무관하게 그대로 돈다.
     show_seats 마이그레이션(20260819130000) 미적용이면 값이 undefined 라 지금까지처럼 보인다. */
  function seatsVisible(l) { return !l || l.show_seats !== false; }

  /* 참가비 표시 문구 — 값이 있으면 금액, 0원이면 '무료' 또는 관리자가 넣은 문구('상담 시 안내' 등).
     ⚠️ 문구(price_label)는 0원일 때만 쓴다 — 값이 있는 특강의 금액을 문구로 가리면
        금액을 안 보고 결제하게 된다. 카드·상세·하단바가 전부 이 한 곳을 부른다. */
  function priceText(l) {
    if (l && l.price > 0) return Number(l.price).toLocaleString() + '원';
    const label = l && l.price_label ? String(l.price_label).trim() : '';
    return label || '무료';
  }

  // 날짜 → 시각 → sort_order 순. DB 정렬과 같은 규칙을 클라이언트에서도 보장한다.
  function sortSlots(list) {
    return (list || []).slice().sort((a, b) =>
      String(a.slot_date).localeCompare(String(b.slot_date))
      || String(a.start_time || '').localeCompare(String(b.start_time || ''))
      || (a.sort_order || 0) - (b.sort_order || 0));
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
    cal:  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>',
    who:  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5"/></svg>',
    seat: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v8h9M6 13l-1 4M15 13l1 4M6 9h9a3 3 0 0 1 3 3v1"/></svg>',
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
    // 가격은 커버 배지가 아니라 정보부 맨 아래 한 줄로 말한다(2026-07-24 A안).
    // 무료도 이 줄 하나로만 — 배지와 두 번 말하지 않는다.
    // 초록 강조는 '무료'라는 단어에만 — '상담 시 안내' 같은 관리자 문구는 금액처럼 네이비.
    const priceStr = priceText(l);
    const priceLine = '<div class="lx-price"><span class="l">참가비</span>'
      + '<span class="v' + (priceStr === '무료' ? ' free' : '') + '">'
      + esc(priceStr) + '</span></div>';

    let third = '';
    if (st === 'upcoming') third = mi(IC.seat, '신청 예정');
    // 자리가 찬 것과 기간이 끝난 것은 다른 사정이라 문구를 나눈다(잔여석은 신청마다 자동 계산)
    else if (isOut) third = mi(IC.seat, soldOut ? '정원 마감' : '신청 마감');
    // 잔여석 숨김 특강은 이 줄을 비운다(마감 문구는 위에서 이미 처리 — 숨겨도 마감은 말한다)
    else if (seatsVisible(l) && l.seats_left != null) third = mi(IC.seat, '잔여 ' + l.seats_left + '석', l.seats_left <= 5 ? 'seats-low' : '');

    // 시간대가 여럿이면 '7월 24일(금) · 3개 타임'(날짜가 갈리면 '… 외 · N개 타임').
    // 호출부가 l._slots 를 붙여줬을 때만 — 없으면 지금까지처럼 진행일 한 줄이다.
    // (특강의 lecture_date 는 트리거가 최초 슬롯 날짜로 롤업해두므로 폴백도 어긋나지 않는다)
    const slots = sortSlots(l._slots);
    let dateStr = fmtDate(l.lecture_date);
    if (slots.length) {
      const first = fmtDate(slots[0].slot_date) || dateStr;
      const oneDay = slots.every(s => String(s.slot_date) === String(slots[0].slot_date));
      dateStr = slots.length > 1
        ? first + (oneDay ? '' : ' 외') + ' · ' + slots.length + '개 타임'
        : first;
    }
    const meta = [
      dateStr ? mi(IC.cal, dateStr) : '',
      l.instructor ? mi(IC.who, esc(l.instructor)) : '',
      third,
    ].filter(Boolean).join('');

    return '<a class="lx-card' + (isOut ? ' is-out' : '') + (shot ? ' has-shot' : '') + '"' + accentStyle
      + ' href="lecture.html?id=' + encodeURIComponent(l.id) + '">'
      + '<div class="lx-cover">'
      +   '<div class="lx-txt">'
      +     (air ? '<div class="lx-en">' + esc(air.en) + '</div>' : '')
      +     '<div class="lx-ko">' + esc(l.title) + '</div>'
      +     '<hr class="lx-rule">'
      +   '</div>'
      + '</div>'
      + '<div class="lx-info">'
      +   (l.subtitle ? '<div class="lx-copy">' + esc(l.subtitle) + '</div>' : '')
      +   (meta ? '<div class="lx-meta">' + meta + '</div>' : '')
      +   priceLine
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

  /* 특강 목록에 시간대를 붙여 온다(`l._slots`). 카드가 'N개 타임'을 그릴 때 쓴다.
     ⚠️ 별도 조회인 이유: `select('*,lecture_slots(*)')` 로 조인하면 lecture_slots
     마이그레이션(20260724160000) 미적용 환경에서 목록 조회 전체가 400 난다.
     여기서 실패하면 조용히 넘어가고 카드는 진행일 한 줄로 그려진다. */
  async function attachSlots(sb, lectures) {
    const list = lectures || [];
    if (!sb || !list.length) return list;
    try {
      const { data, error } = await sb.from('lecture_slots')
        .select('*').in('lecture_id', list.map(l => l.id));
      if (error || !data) return list;
      const byLecture = {};
      data.forEach(s => { (byLecture[s.lecture_id] = byLecture[s.lecture_id] || []).push(s); });
      list.forEach(l => { l._slots = byLecture[l.id] || []; });
    } catch (e) { /* 미적용 환경 — 시간대 없이 그린다 */ }
    return list;
  }

  window.LEC = {
    esc, parseDate, status, ddaySuffix, fmtDate, fmtPeriod, AIRLINES, airline, shotUrl,
    cardHtml, skeletonHtml,
    fmtTime, slotWhen, slotShort, slotFull, seatsVisible, priceText, sortSlots, attachSlots,
  };
})();
