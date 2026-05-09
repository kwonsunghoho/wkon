/* ── 구글 시트 모집 기간 연동 ── */
const RECRUIT_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSjh43-8SUZxM41_RnjiRuUgOxaUFicDmWFAT2EtthjHY5EjzQlA7X3vzYDTNUE0sUnVMfRUfCtomM3/pub?gid=0&single=true&output=csv';

async function loadRecruitData() {
  try {
    const res = await fetch(RECRUIT_CSV + '&_=' + Date.now());
    const text = await res.text();
    const rows = text.trim().split('\n').slice(1); // 첫 줄(헤더) 제외
    const data = {};
    rows.forEach(row => {
      const cols = row.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      if (cols[0]) data[cols[0]] = { start: cols[1], end: cols[2] };
    });
    return data;
  } catch (e) {
    console.warn('모집 데이터 로드 실패 (하드코딩 값 사용):', e);
    return null;
  }
}

function getStatus(start, end) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const s = new Date(start);
  const e = new Date(end); e.setHours(23, 59, 59, 999);
  if (today < s) return 'upcoming';
  if (today > e) return 'closed';
  return 'open';
}

function fmtPeriod(start, end) {
  const f = d => { const dt = new Date(d); return `${dt.getMonth()+1}/${dt.getDate()}`; };
  return `${f(start)} ~ ${f(end)}`;
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
    const badge  = card.querySelector('.recruit-status');
    const action = card.querySelector('.challenge-action');
    const periodEl = card.querySelector('.recruit-period');
    const periodStrong = card.querySelector('.recruit-period strong');

    if (periodStrong) periodStrong.textContent = fmtPeriod(start, end);

    if (status === 'upcoming') {
      if (badge)    { badge.textContent = '⏰ 모집 예정'; badge.className = 'recruit-status status-upcoming'; }
      if (action)   action.textContent = '모집 예정';
      if (periodEl) {
        periodEl.classList.add('is-upcoming');
        // 달력 이모지 앞에 텍스트 강조
        const strong = periodEl.querySelector('strong');
        if (strong) periodEl.innerHTML = `📅 <span style="font-size:11.5px;font-weight:700;color:var(--text-muted)">모집 시작일</span> <strong>${fmtPeriod(start, end)}</strong>`;
      }
      card.classList.add('is-disabled');
    } else if (status === 'closed') {
      if (badge)  { badge.textContent = '모집 마감'; badge.className = 'recruit-status status-closed'; }
      if (action) action.textContent = '모집 마감';
    } else {
      if (badge)  { badge.textContent = '🔥 모집 중'; badge.className = 'recruit-status status-recruiting'; }
    }
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

  // 칩 텍스트 업데이트
  if (chip) {
    const strongEl = chip.querySelector('strong');
    if (strongEl) strongEl.textContent = fmtPeriod(start, end);
    if (status !== 'open') {
      chip.innerHTML = (status === 'upcoming' ? '⏰ 모집 예정 ' : '❌ 모집 마감 ') + fmtPeriod(start, end);
      chip.style.background = status === 'closed' ? 'rgba(120,120,120,.1)' : 'rgba(214,51,132,.08)';
    }
  }

  // 버튼 비활성화
  if (status !== 'open') {
    document.querySelectorAll('.apply-btn').forEach(btn => {
      btn.style.opacity = '.55';
      btn.style.filter = 'grayscale(.4)';
      btn.style.cursor = 'not-allowed';
      btn.textContent = status === 'upcoming' ? '⏰ 모집 예정' : '❌ 모집 마감';
    });
  }

  // handleApply에서 사용할 상태 저장
  window._recruitStatus = status;
}
