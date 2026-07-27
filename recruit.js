/* ── 모집 기간 연동 (Supabase challenge_rounds 단일 소스) ── */

/* challenge_rounds(Supabase)에서 챌린지별 "현재 기수"를 읽어
   {challenge: {start, end, round}} 형태로 반환.
   조회 실패나 미등록 챌린지는 그 자리를 비워 두고 → 각 호출부가
   data-recruit-* / RECRUIT_FALLBACKS 하드코딩으로 폴백한다. */
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

let _recruitDataPromise = null;
async function loadRecruitData() {
  if (_recruitDataPromise) return _recruitDataPromise;
  // 단일 소스 = Supabase challenge_rounds. 조회 실패나 미등록 챌린지는
  // null/누락으로 두고, 각 호출부가 data-recruit-* / RECRUIT_FALLBACKS
  // 하드코딩으로 폴백한다(구 구글 시트 CSV 폴백은 2026-07-23 제거 — admin 단일 관리).
  _recruitDataPromise = loadRecruitDataFromSupabase();
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

/* ── 메인 페이지: 챌린지 목록 상태 적용 ──
   ⚠️ 구 `.challenge-card` 블록은 2026-07-27 삭제. #challenges 섹션이 2026-07-23에
   사라진 뒤로 그 셀렉터는 아무것도 잡지 못하는 죽은 코드였다(기간 바·액션 라벨 처리 포함).
   ⚠️ 히어로도 캐러셀(.hs-card/.hs-status)에서 에디토리얼 목록(.ch-card/.ch-st)으로
   전면 교체됐다 — 캐러셀 셀렉터로 되돌리지 말 것. */
async function applyIndexRecruit() {
  const data = await loadRecruitData();

  /* 홈 챌린지 카드의 모집 상태. 챌린지별 상태를 말하는 유일한 자리다
     (하단 고정 CTA 바는 '전체 중 가장 임박한 상태' 하나만 말한다).
     ⚠️ 구 초록 그라디언트 알약(.recruit-status/.status-recruiting)을 다시 쓰지 말 것 —
     사이트 전체가 베이지·오렌지·명조인데 그 초록만 어디서나 쓰는 기성품 색이라
     고급감을 깎아먹었다(2026-07-27 오너 지적). 지금은 사이트 팔레트 안의 활자로만 말한다. */
  document.querySelectorAll('.ch-card[data-recruit-id]').forEach(card => {
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

    /* 마감·예정 카드는 사진을 흑백으로 — 배지로 소리치는 대신 사진이 상태를 말한다.
       (클릭은 그대로 열어 둔다: 다음 기수를 기다리는 사람에게 상세는 여전히 유효하다.) */
    card.classList.toggle('is-dim', status !== 'open');

    const chip = card.querySelector('.ch-st');
    if (!chip) return;
    if (status === 'upcoming') {
      chip.textContent = '모집 예정';
      chip.className = 'ch-st is-upcoming';
    } else if (status === 'closed') {
      chip.textContent = '마감 · 다음 기수 준비 중';
      chip.className = 'ch-st is-closed';
    } else {
      const dday = getDday(start, end, status); // 'D-3' | 'D-Day' | null
      chip.textContent = dday ? ('모집 중 · ' + (dday === 'D-Day' ? '오늘 마감' : dday)) : '모집 중';
      chip.className = 'ch-st is-open';
    }
    chip.hidden = false;
  });

  /* 상태가 확정됐음을 알린다 — index.html의 heroReorder()가 이걸 받아 카드를
     '모집 중 → 예정 → 마감' 순으로 재정렬하고 번호를 다시 매긴다(2026-07-27 오너 확정).
     ⚠️ 여기서 직접 DOM을 옮기지 않는 이유: 번호 재부여는 index.html이 들고 있어서
     순서만 바꾸면 번호와 어긋난다. */
  document.dispatchEvent(new CustomEvent('monc:recruitready'));
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

/* ── 챌린지 상세 페이지: 버튼·칩 상태 적용 ──
   원격(Supabase/CSV) 도착 전엔 HTML에 하드코딩된 날짜가 잠깐 보였다가 교체되는
   플래시가 있었다 — 새로고침 타이밍마다 다른 날짜를 목격하는 원인(오너 지적 2026-07-23).
   그래서 로딩 동안엔 날짜 대신 '확인 중'만 두고, 데이터가 온 뒤에만 실제 기간을 그린다.
   ⚠️ 로딩 표시로 chip의 <strong>이 사라지므로, 도착 후엔 항상 innerHTML을 새로
   조립한다(구 버전은 open·dday 조합에서만 재구성해 엣지에서 빈 chip이 됐다). */
async function applyDetailRecruit(challengeId) {
  const chip = document.getElementById('recruitChip');
  if (chip) {
    chip.textContent = '모집기간 확인 중…';
    chip.style.opacity = '.55';
    chip.style.background = '';
  }

  const data = await loadRecruitData();
  const d = data ? data[challengeId] : null;
  const start = (d && d.start) || (chip && chip.dataset.recruitStart);
  const end   = (d && d.end)   || (chip && chip.dataset.recruitEnd);
  const status = (start && end) ? getStatus(start, end) : null;
  const dday   = status ? getDday(start, end, status) : null;

  if (chip) {
    chip.style.opacity = '';
    if (!status) {
      chip.textContent = '모집기간 준비 중';           // 원격·하드코딩 다 실패 시(빈 chip 방지)
    } else if (status === 'open') {
      chip.innerHTML = dday
        ? `모집 <strong>${fmtPeriod(start, end)}</strong> ${makeDdayChip(dday, status)}`
        : `모집 <strong>${fmtPeriod(start, end)}</strong>`;
      chip.style.background = '';
    } else {
      chip.innerHTML = (status === 'upcoming' ? '모집 예정 ' : '모집 마감 ') + fmtPeriod(start, end);
      chip.style.background = status === 'closed' ? 'rgba(120,120,120,.1)' : 'rgba(214,51,132,.08)';
    }
  }

  if (status && status !== 'open') {
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
