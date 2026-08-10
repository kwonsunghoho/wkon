/* ══════════════════════════════════════════════════════════════════════════
   미결 결제 기록 공용 창구 (2026-08-10 — 연구실 실사고 "결제했는데 또 결제창"의 일반화)

   왜 필요한가: 모바일 결제는 결제사로 나갔다가 페이지가 새로 뜬다. 주문 정보를
   sessionStorage 에 두면 **탭 단위**라 앱 전환·인앱 복귀가 새 탭으로 떨어지는 순간
   기록이 사라진다 — verify-payment 가 영영 안 불려 돈만 나가고 지급이 안 된다.
   연구실 자료에서 실제로 났던 사고(2026-08-09~10)와 같은 구멍이 챌린지·특강·크레딧·
   이용권 결제 전부에 있었다.

   규칙 셋(쓰는 쪽이 지킬 것):
   ① 기록은 결제창을 열기 **전에** add() — 떠난 뒤엔 남길 기회가 없다.
   ② 확답(성공, 또는 서버가 200 본문으로 준 확정 실패·환불)일 때만 drop() —
      네트워크로 끊긴 확인은 기록을 남겨 다음 방문이 조용히 이어서 확인한다.
   ③ 자가 회복(quiet)에서는 실패 알림을 띄우지 않는다 — 결제 직후가 아니다.

   ⚠️ 챌린지·특강(applications 저장)의 재확인은 appsRetrySafe() 가 true 일 때만.
      구버전 verify-payment 에 같은 결제를 다시 보내면 중복신청 트리거(MC002)가
      payment_id 를 안 보고 걸려 **정상 결제를 전액 환불**해 버린다. 2026-08-10b 부터
      payment_id 사전 확인이 들어가 재시도가 안전하다.
   ⚠️ 이 파일을 고치면 싣는 페이지들의 ?v= 도 같이 올린다(인앱 웹뷰 캐시).
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.moncPends) return;                 // 중복 주입 방지

  var MAX_AGE = 7 * 864e5;   // 이보다 오래 확답을 못 받은 기록은 접는다(재시도 의미 없음)

  function load(key) {
    var list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
    if (!Array.isArray(list)) list = (list && list.paymentId) ? [list] : [];
    // 구버전(sessionStorage 단건) 기록도 거둔다 — 이 배포 전에 결제하고 돌아온 사람 몫
    try {
      var old = JSON.parse(sessionStorage.getItem(key) || 'null');
      sessionStorage.removeItem(key);
      if (old && old.paymentId && !list.some(function (p) { return p.paymentId === old.paymentId; })) list.push(old);
    } catch (e) {}
    var cut = Date.now() - MAX_AGE;
    return list.filter(function (p) { return p && p.paymentId && (!p.ts || p.ts > cut); });
  }

  function save(key, list) {
    try {
      if (list && list.length) localStorage.setItem(key, JSON.stringify(list));
      else localStorage.removeItem(key);
    } catch (e) {}
  }

  window.moncPends = {
    load: load,
    add: function (key, rec) {
      rec.ts = rec.ts || Date.now();
      var l = load(key);
      if (!l.some(function (p) { return p.paymentId === rec.paymentId; })) l.push(rec);
      save(key, l);
    },
    drop: function (key, paymentId) {
      save(key, load(key).filter(function (p) { return p.paymentId !== paymentId; }));
    },
    /* 챌린지·특강 재확인 가드 — 위 ⚠️ 참조. 프로브 한 번으로 서버 판을 확인한다.
       확인이 안 되면(구버전·네트워크) false — 기록은 남고 다음 방문에 또 본다. */
    appsRetrySafe: function () {
      if (!window.MONC || !window.MONC.sb) return Promise.resolve(false);
      return window.MONC.sb.functions.invoke('verify-payment', { body: { probe: true } })
        .then(function (r) {
          var v = r && r.data && r.data.version;
          return !!v && String(v) >= '2026-08-10b';
        })
        .catch(function () { return false; });
    }
  };
})();
