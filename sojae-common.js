/* =============================================================================
 * MONC 소재 발굴 — "오늘의 문제" 공용 로직
 * sojae.html · mypage.html · admin.html 이 공유한다. (supabase-config.js 다음에 로드)
 *
 * ⚠️ 이전엔 이 로직이 세 파일에 복제돼 있었고 날짜를 기기 로컬 시계로 계산해서,
 *    시간대가 다른 사용자끼리 "전원 공통 문제"가 어긋날 수 있었다.
 *    → 여기 한 곳으로 통합 + KST(Asia/Seoul) 기준으로 고정.
 * ============================================================================= */
(function () {
  const CAT_LABEL = {
    experience: '경험 발굴형',
    values: '가치관형',
    judgment: '상황 판단형',
    company: '정보·기업 분석형',
  };

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
  // 이미 로드된 문제 배열에서 오늘 노출될 문제를 계산(순수 함수). admin 목록 배지용.
  // 규칙: 오늘 고정(scheduled_date=오늘) 우선, 없으면 활성 풀 날짜 자동 순환.
  function pickEffective(rows) {
    const active = (rows || []).filter(q => q.active);
    if (!active.length) return null;
    const t = todayStr();
    const pinned = active.find(q => q.scheduled_date === t);
    if (pinned) return pinned;
    return sortPool(active)[dayIndex() % active.length];
  }
  // DB에서 오늘의 문제 한 행 로드(sojae/mypage용). 실패/빈 풀이면 null.
  async function fetchTodayQuestion(sb) {
    try {
      const t = todayStr();
      const pin = await sb.from('questions').select('*').eq('active', true).eq('scheduled_date', t).limit(1);
      if (pin.data && pin.data.length) return pin.data[0];
      const pool = await sb.from('questions').select('*').eq('active', true)
        .order('created_at', { ascending: true }).order('id', { ascending: true });
      if (pool.data && pool.data.length) return pool.data[dayIndex() % pool.data.length];
    } catch (_) {}
    return null;
  }

  window.SOJAE = { CAT_LABEL, todayStr, dayIndex, sortPool, pickEffective, fetchTodayQuestion };
})();
