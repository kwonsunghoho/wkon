/* =============================================================================
 * MONC 소재 발굴 — "오늘의 문제" 공용 로직
 * sojae.html · mypage.html · admin.html 이 공유한다. (supabase-config.js 다음에 로드)
 *
 * ⚠️ 이전엔 이 로직이 세 파일에 복제돼 있었고 날짜를 기기 로컬 시계로 계산해서,
 *    시간대가 다른 사용자끼리 "전원 공통 문제"가 어긋날 수 있었다.
 *    → 여기 한 곳으로 통합 + KST(Asia/Seoul) 기준으로 고정.
 * ============================================================================= */
(function () {
  // BEI 5유형(2026-07-30 교재 정렬). 코드 4종은 데이터 호환을 위해 유지, personal 만 신설.
  // ⚠️ 코드명을 바꾸지 말 것 — questions·answers 두 테이블의 기존 데이터가 이 코드로 저장돼 있다.
  const CAT_LABEL = {
    experience: '과거경험검증형',
    values: '직무핵심역량형',
    judgment: '상황대처형',
    company: '기업관심도형',
    personal: '개인신상형',
  };

  // ── 난이도 4단계(2026-08-05) + KE20 섹션(2026-08-28) ─────────────────────
  // ⚠️ 코드명은 questions.level 체크 제약과 짝이다(마이그레이션 20260805120000,
  //    ke20 은 20260828120000). 라벨만 여기서 바꾼다 — DB 는 코드만 안다(유형 CAT_LABEL 과 같은 규칙).
  // ke20 은 난이도 단계가 아니라 대한항공 대비 프로젝트 전용 섹션이다 — 순환·고정·필터는
  // 난이도와 같은 축(level)을 그대로 탄다(별도 컬럼을 만들면 로직이 두 축으로 쪼개진다).
  const LEVELS = ['basic', 'mid', 'advanced', 'deep', 'ke20'];
  const LEVEL_LABEL = { basic: '초급', mid: '중급', advanced: '고급', deep: '심화', ke20: 'KE20' };
  const LEVEL_DESC = {
    basic: '면접 준비를 막 시작했다면. 나를 소개하는 기본 문항',
    mid: '실제 면접에서 자주 나오는 문항',
    advanced: '꼬리질문·압박까지 이어지는 문항',
    deep: '돌발 상황과 대처를 묻는 문항',
    ke20: '대한항공 대비 프로젝트 문항',
  };
  const DEFAULT_LEVEL = 'basic';
  // ⚠️ level 은 마이그레이션 미적용 환경에서 아예 없는 컬럼이다. 그때는 전부 초급으로 본다
  //    (조회 조건에 level 을 넣으면 400 — 사이트 관례대로 받아서 거른다).
  function levelOf(q) {
    const v = (q || {}).level;
    return LEVEL_LABEL[v] ? v : DEFAULT_LEVEL;
  }
  // 학생이 마지막에 고른 난이도. 값은 코드 문자열 하나뿐이라 localStorage 로 충분하다.
  const LEVEL_KEY = 'monc_sojae_level_v1';
  function getLevel() {
    try {
      const v = localStorage.getItem(LEVEL_KEY);
      return LEVEL_LABEL[v] ? v : DEFAULT_LEVEL;
    } catch (_) { return DEFAULT_LEVEL; }
  }
  function setLevel(v) {
    if (!LEVEL_LABEL[v]) return;
    try { localStorage.setItem(LEVEL_KEY, v); } catch (_) {}
  }

  // KST(Asia/Seoul) 기준 'YYYY-MM-DD'. 기기 시간대와 무관하게 전원 동일한 '오늘'.
  function todayStr() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  }
  // KST 자정마다 1씩 증가하는 정수(자동 순환 인덱스). 전원 동일.
  function dayIndex() {
    return Math.floor(Date.parse(todayStr() + 'T00:00:00Z') / 86400000);
  }
  // 안정 정렬: created_at asc, 동률(시드 일괄 INSERT)이면 id asc. DB order 와 동일 규칙.
  function sortPool(rows) {
    return (rows || []).slice().sort((a, b) =>
      a.created_at === b.created_at ? (a.id < b.id ? -1 : 1)
        : (a.created_at < b.created_at ? -1 : 1));
  }
  // 활성 + (지정 시) 그 난이도의 문제만. 정렬은 sortPool 규칙.
  function poolOf(rows, level) {
    const active = (rows || []).filter(q => q.active);
    return sortPool(level ? active.filter(q => levelOf(q) === level) : active);
  }
  // 이미 로드된 문제 배열에서 오늘 노출될 문제를 계산(순수 함수). admin 목록 배지용.
  // 규칙: 오늘 고정(scheduled_date=오늘) 우선, 없으면 활성 풀 날짜 자동 순환.
  // level 을 주면 그 난이도 안에서만 계산한다(난이도마다 오늘의 문제가 하나씩 있다).
  function pickEffective(rows, level) {
    const pool = poolOf(rows, level);
    if (!pool.length) return null;
    const t = todayStr();
    const pinned = pool.find(q => q.scheduled_date === t);
    if (pinned) return pinned;
    return pool[dayIndex() % pool.length];
  }
  // 활성 문제 풀 전체를 한 번에 받는다(난이도별 갈래·개수를 화면이 직접 세야 해서).
  // ⚠️ level 을 select 조건(.eq)에 넣지 않는다 — 마이그레이션 미적용 환경에서 400 이 난다.
  //    문항 풀은 100개 안팎이라 전부 받아 거르는 편이 쿼리도 하나로 준다.
  async function fetchQuestionPool(sb) {
    try {
      const { data } = await sb.from('questions').select('*').eq('active', true)
        .order('created_at', { ascending: true }).order('id', { ascending: true });
      return data || [];
    } catch (_) { return []; }
  }
  // DB에서 오늘의 문제 한 행 로드(sojae/mypage용). 실패/빈 풀이면 null.
  // level 을 안 주면 학생이 마지막에 고른 난이도를 쓴다. 그 난이도가 비어 있으면
  // 전체 풀로 물러선다 — 난이도를 나누기 전에 만든 문제뿐인 환경에서도 화면이 빈손이 아니게.
  async function fetchTodayQuestion(sb, level) {
    const rows = await fetchQuestionPool(sb);
    if (!rows.length) return null;
    return pickEffective(rows, level || getLevel()) || pickEffective(rows);
  }

  window.SOJAE = {
    CAT_LABEL, LEVELS, LEVEL_LABEL, LEVEL_DESC, DEFAULT_LEVEL,
    levelOf, getLevel, setLevel,
    todayStr, dayIndex, sortPool, poolOf, pickEffective, fetchQuestionPool, fetchTodayQuestion,
  };
})();
