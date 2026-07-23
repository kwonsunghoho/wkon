/* ── 특강(lectures.html · lecture.html) 공용 헬퍼 ──
   날짜·상태·이스케이프 등 순수 유틸. Supabase 접근은 각 페이지가 MONC.sb 로 직접 한다. */
(function () {
  // 안전한 HTML 이스케이프(관리자 입력이라도 방어적으로) — innerHTML 조립 전 항상 통과시킬 것.
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

  // 신청(모집) 상태: recruit_start~recruit_end 기준. 'open' | 'upcoming' | 'closed'.
  // 날짜가 비면 상시 신청(open)으로 본다.
  function status(start, end) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const s = parseDate(start), e = parseDate(end);
    if (!s && !e) return 'open';
    if (s && today < s) return 'upcoming';
    if (e) { const ee = new Date(e); ee.setHours(23, 59, 59, 999); if (today > ee) return 'closed'; }
    return 'open';
  }

  // 마감까지 남은 일수(open 일 때만). 3일 이하면 " · D-2" 식 접미사, 아니면 ''.
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
  // "8월 3일(일)" 형태. 날짜 없으면 ''.
  function fmtDate(str) {
    const d = parseDate(str);
    if (!d) return '';
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일(' + WEEK[d.getDay()] + ')';
  }

  // "6/1 ~ 6/28" 형태(모집 기간).
  function fmtPeriod(start, end) {
    const f = x => { const d = parseDate(x); return d ? (d.getMonth() + 1) + '/' + d.getDate() : '?'; };
    if (!start && !end) return '';
    return f(start) + ' ~ ' + f(end);
  }

  window.LEC = { esc, parseDate, status, ddaySuffix, fmtDate, fmtPeriod };
})();
