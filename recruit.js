/* ── 모집 기간 연동 (Supabase challenge_rounds 단일 소스) ── */

/* challenge_rounds(Supabase)에서 챌린지별 "현재 기수"를 읽어
   {challenge: {start, end, round}} 형태로 반환.

   ⚠️⚠️ **상태는 네 갈래다. 둘로 줄이지 말 것** — 2026-08-02 하루에 양쪽으로 다 틀렸다.

     'open'/'upcoming'/'closed'  기수가 있고 기간을 안다
     'none'   조회 **성공** + 그 챌린지 행 없음 = admin 에 기수를 안 만들었다
              = **지금 모집하지 않는다.** 신청을 닫고 오픈 알림으로 보낸다.
     null     조회 **실패**(네트워크·권한) = 정말 모른다.
              '확인 중'이라고 말하고 **버튼은 살려 둔다** — 최종 판정은 어차피 DB 트리거와
              verify-payment 가 한다(브라우저가 장애로 길을 막을 이유가 없다).

   하루에 난 실사고 둘:
   ① 하드코딩 폴백(RECRUIT_FALLBACKS)에 6월 날짜가 박혀 있어 조회 실패 시 전부 'closed'.
      방문자에게는 오류가 아니라 "이 사이트는 모집이 끝났다"로 보였다.
   ② ①을 고치면서 'none' 과 null 을 같이 '키 없음'으로 두었더니, 소비처의 `|| 'open'`
      기본값 때문에 **기수가 하나도 없는데 전 챌린지가 신청 가능**해졌다(오너 지적).
   → 하드코딩 날짜 폴백 금지는 그대로. 대신 '모른다'와 '안 한다'를 반드시 가른다. */
async function loadRecruitDataFromSupabase() {
  if (!window.MONC || !window.MONC.sb) return null;
  // ⚠️ select('*') 유지 — start_mode 등 컬럼을 나열하면 마이그레이션 미적용 환경에서
  //    조회 전체가 400 난다(CLAUDE.md 데이터 안전 공통 규칙).
  const { data, error } = await window.MONC.sb
    .from('challenge_rounds')
    .select('*')
    .order('recruit_end', { ascending: true });
  if (error || !data) { console.warn('[MONC 모집] Supabase 조회 실패:', error); return null; }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const byChallenge = {};
  data.forEach(r => { (byChallenge[r.challenge] = byChallenge[r.challenge] || []).push(r); });

  const out = {};
  Object.entries(byChallenge).forEach(([ch, rounds]) => {
    // 현재 기수 = recruit_end >= 오늘 중 가장 이른 것, 없으면 가장 최근(마지막) 것.
    // 선착순(마감 없음 = recruit_end null)은 항상 '아직 안 끝난 것'으로 친다.
    const upcoming = rounds.filter(r => !r.recruit_end || new Date(r.recruit_end) >= today);
    const chosen = upcoming.length ? upcoming[0] : rounds[rounds.length - 1];
    out[ch] = {
      start: chosen.recruit_start, end: chosen.recruit_end, round: chosen.round,
      // 선착순 — 개강일 대신 '인원이 모이면 시작'. 미적용 환경엔 컬럼이 없어 false 로 떨어진다.
      fcfs: chosen.start_mode === 'fcfs',
    };
  });
  console.log('[MONC 모집] Supabase 데이터:', out);
  return out;
}

let _recruitDataPromise = null;
async function loadRecruitData() {
  if (_recruitDataPromise) return _recruitDataPromise;
  // 단일 소스 = Supabase challenge_rounds. 조회 실패나 미등록 챌린지는 null/누락으로
  // 두고, 호출부는 그것을 '마감'이 아니라 '모름'으로 다룬다(위 절 참조).
  // 구 구글 시트 CSV 폴백은 2026-07-23 제거 — admin 단일 관리.
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
  if (!s) { console.warn('[MONC 모집] 날짜 오류 — start:', start, 'end:', end); return 'upcoming'; }
  if (today < s) return 'upcoming';
  // 마감 없음(선착순) — 시작했으면 계속 모집 중. 마감은 admin 이 기수를 수정·삭제할 때 난다.
  if (!end) return 'open';
  const e = parseDate(end);
  if (!e) { console.warn('[MONC 모집] 날짜 오류 — start:', start, 'end:', end); return 'upcoming'; }
  e.setHours(23, 59, 59, 999);
  if (today > e) return 'closed';
  return 'open';
}

function fmtPeriod(start, end) {
  const f = d => { const dt = parseDate(d); return dt ? `${dt.getMonth()+1}/${dt.getDate()}` : '?'; };
  // 마감 없음(선착순)은 '8/6 ~' 로 연다 — '?' 를 찍으면 오류처럼 읽힌다
  return end ? `${f(start)} ~ ${f(end)}` : `${f(start)} ~`;
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
    /* ⚠️ HTML 하드코딩 날짜로 폴백하지 않는다 — 모르면 칩을 아예 안 그린다(hidden 유지).
       카드는 흑백 처리도 안 하고 클릭도 열려 있다. 파일 맨 위 실사고 기록 참조. */
    const start = d && d.start;
    const end   = d && d.end;
    const fcfs  = !!(d && d.fcfs);   // 선착순 — 마감일 없이 열려 있을 수 있다
    /* ⚠️ 조회 성공 + 기수 미등록('none')과 조회 실패(모름)를 가른다.
       미등록이면 '다음 기수 준비 중'이라고 말한다 — 모르는 게 아니라 안 하는 것이다. */
    if (!start || (!end && !fcfs)) {
      if (!data) return;                       // 조회 실패 — 칩을 안 그린다(구 동작 유지)
      window._challengeStatuses = window._challengeStatuses || {};
      window._challengeStatuses[id] = 'none';
      card.classList.add('is-dim');
      const c0 = card.querySelector('.ch-st');
      if (c0) { c0.textContent = '다음 기수 준비 중'; c0.className = 'ch-st is-closed'; c0.hidden = false; }
      return;
    }

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
      /* ⚠️ '마감 · ' 접두를 붙이지 말 것(2026-07-27 카드가 2열 격자가 되면서).
         카드 안 텍스트 폭이 131px 이라 14px 활자로 9자가 한 줄인데, 구 문구
         '마감 · 다음 기수 준비 중'(13자)은 두 줄이 되어 그 칸만 키워 격자를 어긋나게 했다.
         사진이 이미 흑백이라 모집 중이 아님은 그림으로 전달되고, 남은 한 줄은
         '마감'보다 '다음이 있다'를 말하는 편이 기다리는 사람에게 쓸모 있다. */
      chip.textContent = '다음 기수 준비 중';
      chip.className = 'ch-st is-closed';
    } else if (fcfs && !end) {
      // 선착순 — D-day 가 없다. 마감이 날짜가 아니라 인원이라는 것만 말한다.
      chip.textContent = '모집 중 · 선착순';
      chip.className = 'ch-st is-open';
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

/* ── 카드 없이도 전체 챌린지 상태 로드 (신청 페이지·홈 칩 공용) ──
   ⚠️ 상태를 모르는 챌린지는 **키를 아예 안 넣는다.** 소비처(apply.applyStatuses ·
   apply.reorderCards · challenges.heroReorder · index.challengeChip)는 전부 '키 없음'을
   이미 안전하게 다룬다 — 카드를 비활성하지 않고, 정렬은 가운데, 개수는 안 센다.
   여기서 하드코딩 날짜를 다시 넣으면 그 안전장치가 통째로 무력해진다(파일 맨 위 실사고). */
const CHALLENGE_IDS = ['voice', 'expression', 'spinning', 'answer'];

async function loadChallengeStatuses() {
  if (window._challengeStatuses) return;
  let data = null;
  try { data = await loadRecruitData(); } catch(e) {}
  window._challengeStatuses = {};
  /* 조회 자체가 실패했는가(= 네트워크·권한 문제). 행이 없어서 비는 것과 구분해
     화면이 "정보를 못 불러왔다"고 말할 수 있게 한다. */
  window._recruitLoadFailed = !data;
  CHALLENGE_IDS.forEach(id => {
    const d = data ? data[id] : null;
    // 선착순(d.fcfs)은 마감일이 없어도 정상 기수다 — 'none' 으로 떨어뜨리면 안 된다.
    if (!d || !d.start || (!d.end && !d.fcfs)) {
      /* ⚠️⚠️ 여기서 '모른다'와 '모집을 안 한다'를 갈라야 한다(2026-08-02 실사고).
         조회가 **성공**했는데 그 챌린지 행이 없다 = admin 에 기수를 안 만들었다
         = **지금 모집하지 않는다.** 신청을 열면 안 된다.
         조회가 **실패**했다 = 정말 모른다. 그때만 버튼을 살려 둔다(서버가 재판정한다).
         구 코드는 둘 다 '키 없음'으로 두었고, 소비처의 `|| 'open'` 기본값 때문에
         **기수가 하나도 없는 상태에서 전 챌린지가 신청 가능**했다. */
      if (data) window._challengeStatuses[id] = 'none';
      return;
    }
    window._challengeStatuses[id] = getStatus(d.start, d.end);

    window._challengeRounds = window._challengeRounds || {};
    if (d.round != null) window._challengeRounds[id] = d.round;
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
  /* ⚠️ chip.dataset 하드코딩 날짜로 폴백하지 않는다 — 그 값이 과거면 히어로가
     '모집 마감 6/1 ~ 6/28' 을 **확정 문구로** 출력했다(2026-08-02 실사고). 파일 맨 위 참조. */
  const start = d && d.start;
  const end   = d && d.end;
  const fcfs  = !!(d && d.fcfs);   // 선착순 — 마감·개강일 대신 '인원이 모이면 시작'
  /* status 세 갈래를 구분한다 —
       'open'/'upcoming'/'closed' : 기수가 있고 기간을 안다
       'none'                     : 조회 성공 + 이 챌린지 기수가 없다 = 모집 안 함
       null                       : 조회 실패 = 정말 모른다(버튼 살려 둠) */
  const status = (start && (end || fcfs)) ? getStatus(start, end) : (data ? 'none' : null);
  const dday   = (status && status !== 'none') ? getDday(start, end, status) : null;

  if (chip) {
    chip.style.opacity = '';
    if (!status) {
      /* 모를 때는 '마감'도 '준비 중'도 아니다 — 못 불러왔다고 말하고 다시 시도할 길을 준다.
         아래 .apply-btn 비활성 블록이 status 를 요구하므로 신청 버튼은 살아 있다. */
      chip.textContent = '모집 기간을 불러오지 못했어요 · 새로고침';
      chip.style.background = '';
    } else if (status === 'none') {
      // 기수가 아직 없다 — 날짜를 지어내지 않고 '준비 중'만 말한다
      chip.textContent = '다음 기수 준비 중';
      chip.style.background = 'rgba(120,120,120,.1)';
    } else if (status === 'open') {
      chip.innerHTML = (fcfs && !end)
        // 선착순 — 기간 대신 마감 방식을 말한다(날짜가 없는데 '~ ?' 를 찍으면 오류처럼 읽힌다)
        ? `선착순 모집 중 · <strong>인원이 모이면 바로 시작</strong>`
        : dday
          ? `모집 <strong>${fmtPeriod(start, end)}</strong> ${makeDdayChip(dday, status)}`
          : `모집 <strong>${fmtPeriod(start, end)}</strong>`;
      chip.style.background = '';
    } else {
      chip.innerHTML = (status === 'upcoming' ? '모집 예정 ' : '모집 마감 ') + fmtPeriod(start, end);
      chip.style.background = status === 'closed' ? 'rgba(120,120,120,.1)' : 'rgba(214,51,132,.08)';
    }
  }

  if (status && status !== 'open') {
    const label = status === 'upcoming' ? '모집 예정'
                : status === 'none'     ? '다음 기수 준비 중'
                : '모집 마감';
    document.querySelectorAll('.apply-btn').forEach(btn => {
      btn.style.opacity = '.55';
      btn.style.filter = 'grayscale(.4)';
      btn.style.cursor = 'not-allowed';
      btn.textContent = label;
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
  if (!data) return;   // 모르면 뱃지를 안 띄운다(hidden 유지) — 하드코딩 날짜 폴백 금지
  let best = null;
  Object.values(data).forEach(d => {
    if (!d || !d.start || (!d.end && !d.fcfs)) return;
    const st = getStatus(d.start, d.end);
    const dd = getDday(d.start, d.end, st);
    /* 선착순(마감 없음)은 D-day 가 없다 — 날짜 마감보다 덜 급한 것으로 치고(num 최대),
       날짜 기수가 하나도 없을 때만 '선착순 모집 중'이 뜬다. */
    if (!dd && !(st === 'open' && d.fcfs && !d.end)) return;
    const num = !dd ? 9999 : (dd === 'D-Day' ? 0 : parseInt(dd.replace('D-', ''), 10));
    const rank = st === 'open' ? 0 : (st === 'upcoming' ? 1 : 2);
    if (!best || rank < best.rank || (rank === best.rank && num < best.num)) {
      best = { rank, num, dday: dd, status: st, fcfs: !dd };
    }
  });
  if (!best || best.status === 'closed') return;
  const label = best.fcfs
    ? '선착순 모집 중'
    : best.status === 'open'
      ? (best.dday === 'D-Day' ? '오늘 마감' : `모집 중 · ${best.dday} 마감`)
      : (best.dday === 'D-Day' ? '오늘 오픈' : `다음 모집 ${best.dday}`);
  badges.forEach(el => { el.textContent = label; el.hidden = false; });
}
