/* ── 챌린지 콘텐츠 열림 판정(round-gate) — mypage 제출 카드 · submit.html · admin 기수 목록 공용 ──
   2026-09-03 오너 지적: 4기 진행 중에 5기(선착순 모집) 결제자가 결제 직후 문항·제출 칸을 봤다.
   결제 여부만 보고 카드를 그렸고, 기수 시작일은 어디서도 안 읽었기 때문.
   규칙: 신청한 기수의 **시작 전엔 문항·제출 칸을 열지 않는다.** 판정은 이 파일 한 곳(페이지에 복사 금지).

   기수 한 행의 시작 판정 roundStartOf(r, all) → { start: 'YYYY-MM-DD'|null, pending: bool }
     ① program_start 가 있으면 그날.
     ② 없으면 모집 마감(recruit_end) 다음 날 — 선착순도 같다(모집 중인 기수는 시작 전이다).
     ③ 둘 다 없으면(선착순·마감 없음):
        · 같은 챌린지에 더 높은 기수가 등록돼 있으면 → 시작한 것으로 본다(start null · 열림).
          5기를 열었다는 건 4기는 시작했다는 뜻이다.
        · 가장 높은 기수면 → 시작일 미정 = 잠김(pending). 공개 화면도 이 기수를 '선착순 모집 중'으로
          말하므로 회원 화면만 열어 두면 앞뒤가 안 맞는다. admin 에서 '프로그램 시작'을 넣으면 그날부터 열린다.
   조회 실패(startMap null)는 연다 — 진행 중인 기수를 장애로 잠그지 않는다.
   ⚠️ 이 판정은 '카드를 그릴지'만 정한다. 업로드 허용의 원장은 DB RLS(is_challenge_participant). */
(function () {
  'use strict';
  if (window.MONC_GATE) return;

  const pad = n => (n < 10 ? '0' : '') + n;
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayYmd = () => ymd(new Date());
  const nextDay = s => {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    d.setDate(d.getDate() + 1);
    return ymd(d);
  };

  function roundStartOf(r, all) {
    if (!r) return { start: null, pending: false };
    if (r.program_start) return { start: String(r.program_start).slice(0, 10), pending: false };
    if (r.recruit_end) return { start: nextDay(r.recruit_end), pending: false };
    const later = (all || []).some(x => x && x.challenge === r.challenge && Number(x.round) > Number(r.round));
    return { start: null, pending: !later };
  }

  /* {'voice#5': {start, pending}, …}. 조회 실패면 null. */
  async function loadRoundStartMap() {
    if (!window.MONC || !window.MONC.sb) return null;
    try {
      // select('*') 유지 — program_start·start_mode 를 나열하면 미적용 환경에서 400(CLAUDE.md).
      const { data, error } = await window.MONC.sb.from('challenge_rounds').select('*');
      if (error || !data) return null;
      const map = {};
      data.forEach(r => { map[r.challenge + '#' + r.round] = roundStartOf(r, data); });
      return map;
    } catch (_) { return null; }
  }

  /* 한 챌린지에 결제한 기수들(번호 배열) 중 화면에 쓸 기수를 고른다.
     시작한 기수가 있으면 그중 최신(4기 진행 중 + 5기 결제 → 4기 카드 유지),
     하나도 안 시작했으면 가장 먼저 시작할 기수(시작일 미정은 맨 뒤)를 잠근 채 돌려준다.
     → { round, start, locked, pending }. startMap 이 null(조회 실패)이면 최신 기수·열림. */
  function pickContentRound(challenge, rounds, startMap, todayStr) {
    const list = Array.from(new Set((rounds || []).map(r => Number(r) || null)));
    if (!list.length) return { round: null, start: null, locked: false, pending: false };
    const today = todayStr || todayYmd();
    const info = list.map(r => {
      const g = (startMap && r != null && startMap[challenge + '#' + r]) || { start: null, pending: false };
      const locked = !!startMap && (g.pending || !!(g.start && today < g.start));
      return { round: r, start: g.start, locked: locked, pending: !!startMap && g.pending };
    });
    const open = info.filter(x => !x.locked);
    if (open.length) return open.reduce((a, b) => ((b.round || 0) > (a.round || 0) ? b : a));
    const key = x => x.start || '9999-99-99';
    return info.reduce((a, b) => (key(b) < key(a) ? b : a));
  }

  /* admin 목록·화면 문구용 — 한 기수가 학생에게 지금 어떻게 보이는지 한 줄. */
  function gateLabel(g, todayStr) {
    const today = todayStr || todayYmd();
    if (!g) return '';
    if (g.pending) return '학생 화면 잠김 · 시작일을 넣으면 열려요';
    if (g.start && today < g.start) return '학생 화면 ' + g.start.slice(5).replace('-', '/') + ' 열림';
    return '학생 화면 열림';
  }

  window.MONC_GATE = { roundStartOf, loadRoundStartMap, pickContentRound, gateLabel, todayYmd };
})();
