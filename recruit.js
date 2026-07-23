/* ── 구글 시트 모집 기간 연동 ── */
const RECRUIT_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSjh43-8SUZxM41_RnjiRuUgOxaUFicDmWFAT2EtthjHY5EjzQlA7X3vzYDTNUE0sUnVMfRUfCtomM3/pub?gid=0&single=true&output=csv';

/* challenge_rounds(Supabase)에서 챌린지별 "현재 기수"를 읽어
   {challenge: {start, end, round}} 형태로 반환. 실패 시 구글 시트로 폴백. */
async function loadRecruitDataFromSupabase() {
  if (!window.MONC || !window.MONC.sb) return null;
  const { data, error } = await window.MONC.sb
    .from('challenge_rounds')
    .select('challenge, round, recruit_start, recruit_end')
    .order('recruit_end', { ascending: true });
  if (error || !data) { console.warn('[MONC 모집] Supabase 조회 실패:', error); return null; }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const byChallenge = {};
  data.forEach(r => { (byChallenge[r.challenge] = byChallenge[r.challenge] || []).push(r); });

  const out = {};
  Object.entries(byChallenge).forEach(([ch, rounds]) => {
    // 현재 기수 = recruit_end >= 오늘 중 가장 이른 것, 없으면 가장 최근(마지막) 것
    const upcoming = rounds.filter(r => new Date(r.recruit_end) >= today);
    const chosen = upcoming.length ? upcoming[0] : rounds[rounds.length - 1];
    out[ch] = { start: chosen.recruit_start, end: chosen.recruit_end, round: chosen.round };
  });
  console.log('[MONC 모집] Supabase 데이터:', out);
  return out;
}

async function loadRecruitDataFromCsv() {
  try {
    const res = await fetch(RECRUIT_CSV + '&_=' + Date.now());
    const text = await res.text();
    const rows = text.trim().split('\n').slice(1);
    const data = {};
    rows.forEach(row => {
      const cols = row.match(/(".*?"|[^,]+)(?=,|$)/g) || row.split(',');
      const clean = cols.map(s => s.trim().replace(/^"|"$/g, '').trim());
      if (clean[0]) data[clean[0]] = { start: clean[1], end: clean[2] };
    });
    console.log('[MONC 모집] 구글 시트 데이터(폴백):', data);
    return data;
  } catch (e) {
    console.warn('모집 데이터 로드 실패 (하드코딩 값 사용):', e);
    return null;
  }
}

let _recruitDataPromise = null;
async function loadRecruitData() {
  if (_recruitDataPromise) return _recruitDataPromise;
  _recruitDataPromise = (async () => {
    const sb = await loadRecruitDataFromSupabase();
    if (!sb) return await loadRecruitDataFromCsv();  // 전환 검증 기간 폴백
    // Supabase에 일부 챌린지만 있으면(기수 미등록) 빠진 챌린지를 CSV로 보충 —
    // 안 그러면 페이지마다 제각각인 하드코딩 폴백으로 떨어져 메인·상세 날짜가 어긋난다.
    const missing = Object.keys(RECRUIT_FALLBACKS).filter(id => !sb[id]);
    if (missing.length) {
      const csv = await loadRecruitDataFromCsv();
      if (csv) missing.forEach(id => { if (csv[id]) sb[id] = csv[id]; });
    }
    return sb;
  })();
  return _recruitDataPromise;
}

/* 날짜 문자열을 Date 객체로 변환 */
function parseDate(str) {
  if (!str) return null;
  const s = str.trim();
  let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3]);
  m = s.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[1]-1, +m[2]);
  const d = new Date(s);
  if (!isNaN(d)) return d;
  console.warn('[MONC 모집] 날짜 파싱 실패:', s);
  return null;
}

function getStatus(start, end) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s || !e) { console.warn('[MONC 모집] 날짜 오류 — start:', start, 'end:', end); return 'upcoming'; }
  e.setHours(23, 59, 59, 999);
  if (today < s) return 'upcoming';
  if (today > e) return 'closed';
  return 'open';
}

function fmtPeriod(start, end) {
  const f = d => { const dt = parseDate(d); return dt ? `${dt.getMonth()+1}/${dt.getDate()}` : '?'; };
  return `${f(start)} ~ ${f(end)}`;
}

/* D-day 계산
   open    → 마감까지 남은 일수
   upcoming → 시작까지 남은 일수 */
function getDday(start, end, status) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = parseDate(status === 'upcoming' ? start : end);
  if (!target) return null;
  const diff = Math.round((target - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return null;
  if (diff === 0) return 'D-Day';
  return `D-${diff}`;
}

/* D-day 칩 HTML 생성 */
function makeDdayChip(dday, status) {
  if (!dday) return '';
  const num = dday === 'D-Day' ? 0 : parseInt(dday.replace('D-', ''));
  let cls, label;
  if (status === 'upcoming') {
    cls = 'dday-upcoming';
    label = dday === 'D-Day' ? '오늘 오픈!' : `${dday} 후 오픈`;
  } else {
    cls = num <= 3 ? 'dday-urgent' : 'dday-open';
    label = dday === 'D-Day' ? '오늘 마감!' : `${dday} 마감`;
  }
  return `<span class="dday-chip ${cls}">${label}</span>`;
}

/* ── 메인 페이지: 카드 상태 적용 ── */
async function applyIndexRecruit() {
  const data = await loadRecruitData();
  document.querySelectorAll('.challenge-card[data-recruit-id]').forEach(card => {
    const id = card.dataset.recruitId;
    const d = data ? data[id] : null;
    const start = (d && d.start) || card.dataset.recruitStart;
    const end   = (d && d.end)   || card.dataset.recruitEnd;
    if (!start || !end) return;

    const status = getStatus(start, end);

    window._challengeStatuses = window._challengeStatuses || {};
    window._challengeStatuses[id] = status;

    window._challengeRounds = window._challengeRounds || {};
    if (d && d.round != null) window._challengeRounds[id] = d.round;

    const badge    = card.querySelector('.recruit-status');
    const action   = card.querySelector('.challenge-action');
    const periodEl = card.querySelector('.recruit-period');
    const dday     = getDday(start, end, status);

    // 모집 기간 바 재구성
    if (periodEl) {
      const chipHtml = makeDdayChip(dday, status);
      if (status === 'upcoming') {
        periodEl.innerHTML = `<span class="period-dates">${fmtPeriod(start, end)}</span>${chipHtml}`;
      } else if (status === 'closed') {
        periodEl.innerHTML = `<span class="period-dates">${fmtPeriod(start, end)}</span><span class="dday-chip dday-closed">마감</span>`;
      } else {
        periodEl.innerHTML = `<span class="period-dates">${fmtPeriod(start, end)}</span>${chipHtml}`;
      }
      periodEl.className = `recruit-period rp-${status}`;
    }

    if (status === 'upcoming') {
      if (badge) { badge.textContent = '모집 예정'; badge.className = 'recruit-status status-upcoming'; }
      if (action) action.textContent = '모집 예정';
      card.classList.add('is-disabled');
    } else if (status === 'closed') {
      if (badge)  { badge.textContent = '모집 마감'; badge.className = 'recruit-status status-closed'; }
      if (action) action.textContent = '모집 마감';
      card.classList.add('is-disabled');
    } else {
      if (badge) { badge.textContent = '모집 중'; badge.className = 'recruit-status status-recruiting'; }
    }
  });

  /* 히어로 캐러셀 카드 모집 칩 — 구 #challenges 섹션 삭제(2026-07-23) 후
     홈에서 챌린지별 모집 상태를 말하는 유일한 자리. 하단 CTA 바는 전체 상태 하나만 말한다. */
  document.querySelectorAll('.hs-card[data-recruit-id]').forEach(card => {
    const id = card.dataset.recruitId;
    const d = data ? data[id] : null;
    const start = (d && d.start) || card.dataset.recruitStart;
    const end   = (d && d.end)   || card.dataset.recruitEnd;
    if (!start || !end) return;

    const status = getStatus(start, end);
    window._challengeStatuses = window._challengeStatuses || {};
    window._challengeStatuses[id] = status;

    const chip = card.querySelector('.hs-status');
    if (!chip) return;
    if (status === 'upcoming') {
      chip.textContent = '모집 예정';
      chip.className = 'hs-status recruit-status status-upcoming';
    } else if (status === 'closed') {
      chip.textContent = '마감';
      chip.className = 'hs-status recruit-status status-closed';
    } else {
      const dday = getDday(start, end, status); // 'D-3' | 'D-Day' | null
      chip.textContent = dday ? ('모집 중 · ' + (dday === 'D-Day' ? '오늘 마감' : dday)) : '모집 중';
      chip.className = 'hs-status recruit-status status-recruiting';
    }
    chip.hidden = false;
  });
}

/* ── 카드 없이도 전체 챌린지 상태 로드 (모달 공용) ── */
const RECRUIT_FALLBACKS = {
  voice:      { start: '2026-06-01', end: '2026-06-28' },
  expression: { start: '2026-06-08', end: '2026-07-05' },
  spinning:   { start: '2026-06-02', end: '2026-06-29' },
  answer:     { start: '2026-06-09', end: '2026-07-06' }
};

async function loadChallengeStatuses() {
  if (window._challengeStatuses) return;
  let data = null;
  try { data = await loadRecruitData(); } catch(e) {}
  window._challengeStatuses = {};
  Object.entries(RECRUIT_FALLBACKS).forEach(([id, fb]) => {
    const d = data ? data[id] : null;
    const start = (d && d.start) || fb.start;
    const end   = (d && d.end)   || fb.end;
    window._challengeStatuses[id] = getStatus(start, end);

    window._challengeRounds = window._challengeRounds || {};
    if (d && d.round != null) window._challengeRounds[id] = d.round;
  });
}

/* ── 챌린지 상세 페이지: 버튼·칩 상태 적용 ── */
async function applyDetailRecruit(challengeId) {
  const data = await loadRecruitData();
  const chip = document.getElementById('recruitChip');
  const d = data ? data[challengeId] : null;
  const start = (d && d.start) || (chip && chip.dataset.recruitStart);
  const end   = (d && d.end)   || (chip && chip.dataset.recruitEnd);
  if (!start || !end) return;

  const status = getStatus(start, end);
  const dday   = getDday(start, end, status);

  if (chip) {
    const strongEl = chip.querySelector('strong');
    if (strongEl) strongEl.textContent = fmtPeriod(start, end);
    if (status === 'open' && dday) {
      chip.innerHTML = `모집 <strong>${fmtPeriod(start, end)}</strong> ${makeDdayChip(dday, status)}`;
      chip.style.background = '';
    } else if (status !== 'open') {
      chip.innerHTML = (status === 'upcoming' ? '모집 예정 ' : '모집 마감 ') + fmtPeriod(start, end);
      chip.style.background = status === 'closed' ? 'rgba(120,120,120,.1)' : 'rgba(214,51,132,.08)';
    }
  }

  if (status !== 'open') {
    document.querySelectorAll('.apply-btn').forEach(btn => {
      btn.style.opacity = '.55';
      btn.style.filter = 'grayscale(.4)';
      btn.style.cursor = 'not-allowed';
      btn.textContent = status === 'upcoming' ? '모집 예정' : '모집 마감';
    });
  }

  window._recruitStatus = status;
}

/* ── 히어로/하단 CTA 긴급성 뱃지: 가장 임박한 모집 상태를 한 줄로 ──
   open(마감 임박 우선) → upcoming(오픈 임박) 순. closed뿐이면 정적 문구 유지. */
async function applyGlobalRecruitCta() {
  const badges = document.querySelectorAll('[data-recruit-cta-badge]');
  if (!badges.length) return;
  let data = null;
  try { data = await loadRecruitData(); } catch (e) {}
  const sources = data || RECRUIT_FALLBACKS;
  let best = null;
  Object.values(sources).forEach(d => {
    if (!d || !d.start || !d.end) return;
    const st = getStatus(d.start, d.end);
    const dd = getDday(d.start, d.end, st);
    if (!dd) return;
    const num = dd === 'D-Day' ? 0 : parseInt(dd.replace('D-', ''), 10);
    const rank = st === 'open' ? 0 : (st === 'upcoming' ? 1 : 2);
    if (!best || rank < best.rank || (rank === best.rank && num < best.num)) {
      best = { rank, num, dday: dd, status: st };
    }
  });
  if (!best || best.status === 'closed') return;
  const label = best.status === 'open'
    ? (best.dday === 'D-Day' ? '오늘 마감' : `모집 중 · ${best.dday} 마감`)
    : (best.dday === 'D-Day' ? '오늘 오픈' : `다음 모집 ${best.dday}`);
  badges.forEach(el => { el.textContent = label; el.hidden = false; });
}
