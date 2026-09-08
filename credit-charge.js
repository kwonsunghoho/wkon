/* ══════════════════════════════════════════════════════════════════════════
   크레딧 충전 공용 창구 (2026-09-08 신설)

   왜 필요한가: 충전 코드가 **세 벌 복붙**이었다(mypage 지갑 · polish 충전함 ·
   ai-killer 충전함). 미결 기록 규약(pay-pending.js)·주문 맥락 customData·
   verify-payment 호출·결제 복귀 처리가 각각 따로 적혀 있어서, 한 곳만 고치면
   나머지가 조용히 어긋난다. 돈이 걸린 자리라 한 벌로 모은다.

   화면은 페이지가 그린다 — 이 파일은 **결제와 확인만** 한다.
   (첨삭의 인라인 충전함은 그대로 둔다는 오너 결정 2026-09-08 — 겉모습은 페이지,
    속은 이 파일.)

   쓰는 법:
       <script src="pay-pending.js?v=1"></script>
       <script src="pay-methods.js?v=3"></script>
       <script src="credit-charge.js?v=1"></script>
       const packs = await moncCredit.loadPacks();
       await moncCredit.charge(packId, { button, onDone, onFail });
       await moncCredit.handleReturn({ onDone, onFail });

   ⚠️ 규칙(어기면 돈이 새거나 이중 결제가 난다)
     ① 미결 기록은 결제창을 열기 **전에** add — 떠난 뒤엔 남길 기회가 없다.
     ② 확답(200 본문)일 때만 drop — 네트워크로 끊긴 확인은 다음 방문이 이어서 한다.
     ③ 금액·개수는 화면이 정하지 않는다. 서버(verify-payment)가 site_config.credit_packs 를
        다시 읽어 검증한다 — 여기서 보내는 건 팩 id 뿐이다.
     ④ customData 의 k:'credit' 은 웹훅(portone-webhook)이 브라우저 없이 충전을
        끝내는 방아쇠다 — 빼지 말 것.
   ⚠️ 이 파일을 고치면 싣는 페이지들의 ?v= 도 같이 올린다(인앱 웹뷰 캐시).
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.moncCredit) return;                // 중복 주입 방지

  var PENDING_KEY = 'monc_pending_credit_pay';  // ⚠️ 세 화면이 같은 키를 쓴다(공용 회복)
  /* 단가 폴백 — 지갑 RPC 가 없거나 미적용 환경일 때만 쓴다. 원장은 site_config.credit_costs.
     ⚠️ 여기 값을 '지급량 조절'로 쓰지 말 것(credits.md — 폴백은 안전값이다). */
  var COST_FALLBACK = { sojae: 5, ai_killer: 5, polish: 15 };

  var _wallet = null;      // 마지막으로 읽은 credit_wallet()
  var _packs = [];         // 마지막으로 읽은 충전 상품
  var _restore = null;     // 결제창에서 뒤로 왔을 때 버튼만 되돌린다(bfcache)

  function sb() { return window.MONC && window.MONC.sb; }

  /* 지갑 — 잔액·오늘 무료·단가. 실패하면 null(화면이 카드째 숨기게 한다). */
  async function loadWallet() {
    try {
      var r = await sb().rpc('credit_wallet');
      if (!r.error && r.data) { _wallet = r.data; return _wallet; }
    } catch (e) {}
    // credit_wallet 미적용(구 원장) — 잔액만이라도
    try {
      var b = await sb().rpc('credit_balance');
      if (b.data != null) { _wallet = { balance: Number(b.data) || 0, daily_left: 0, costs: null }; return _wallet; }
    } catch (e) {}
    return null;
  }

  function wallet() { return _wallet; }
  function balance() { return Number(_wallet && _wallet.balance) || 0; }
  function dailyLeft() { return Number(_wallet && _wallet.daily_left) || 0; }
  function cost(tool) {
    var c = (_wallet && _wallet.costs) || {};
    return Number(c[tool]) || COST_FALLBACK[tool] || 0;
  }

  /* 충전 상품 — site_config.credit_packs. 화면은 이 값을 보여주기만 한다.
     ⚠️ tool 이 'ai_killer' 인 팩이 크레딧 팩이다(지갑은 도구 공용 — 이름만 옛 것). */
  async function loadPacks() {
    try {
      var r = await sb().from('site_config').select('value').eq('key', 'credit_packs').maybeSingle();
      _packs = Array.isArray(r.data && r.data.value)
        ? r.data.value.filter(function (p) { return p && p.tool === 'ai_killer'; })
        : [];
    } catch (e) { _packs = []; }
    return _packs;
  }
  function packs() { return _packs; }
  function findPack(id) {
    for (var i = 0; i < _packs.length; i++) if (String(_packs[i].id) === String(id)) return _packs[i];
    return null;
  }

  /* 복귀 주소 — 지금 주소의 질의문자를 **살린 채** payresult·pk 만 얹는다.
     (credits.html 의 ?back= 이 결제 복귀에서 사라지면 돌아갈 곳을 잃는다.) */
  function returnUrl(packId) {
    var p = new URLSearchParams(location.search);
    p.set('payresult', '1');
    p.set('pk', packId);
    return location.origin + location.pathname + '?' + p.toString();
  }

  /* 결제 — 팩 하나를 산다.
     opts: { button, onDone(data), onFail(msg), onVerifyFail(msg) }
       onFail       결제 자체가 안 됨(취소·실패·모듈 없음) — 없으면 alert
       onVerifyFail 결제는 됐는데 충전 확인 실패 — 없으면 onFail 이 받는다
     ⚠️ 두 실패는 사용자에게 뜻이 다르다(다시 결제 vs 기다렸다 새로고침) — 쓰는 쪽이
        화면을 다르게 그릴 수 있게 나눠 둔다. */
  async function charge(packId, opts) {
    opts = opts || {};
    var pack = findPack(packId);
    if (!pack) return false;
    var fail = opts.onFail || function (m) { alert(m); };
    if (!window.PortOne || !window.moncPay) {
      fail('결제 모듈을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.'); return false;
    }
    // 결제수단 선택(토스페이·카카오페이) — 버튼 잠금·미결 기록보다 앞. 닫으면 아무 일 없다.
    var channelKey = await window.moncPay.choose();
    if (!channelKey) return false;

    var btn = opts.button || null;
    var orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = '결제 진행 중…'; }
    _restore = function () { if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = orig; } };

    try {
      var paymentId = 'monc-cr-' + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
      // ① 미결 기록은 결제창을 열기 전에
      window.moncPends.add(PENDING_KEY, { paymentId: paymentId, packId: packId });
      if (window.moncBeacon) window.moncBeacon('pay_open', { k: 'credit' });   // 결제 시도 계측(퍼널)

      var sess = null;
      try { sess = await window.MONC.getSession(); } catch (e) {}
      var res = await window.PortOne.requestPayment({
        storeId: window.moncPay.storeId, channelKey: channelKey,
        paymentId: paymentId, orderName: '몬크 크레딧 ' + (Number(pack.count) || 0) + '개',
        totalAmount: Number(pack.price), currency: 'CURRENCY_KRW', payMethod: 'EASY_PAY',
        // ④ 주문 맥락 — 웹훅이 브라우저 없이도 충전을 끝내는 데 쓴다
        customData: JSON.stringify({ k: 'credit', uid: (sess && sess.user && sess.user.id) || null, pk: packId }),
        redirectUrl: returnUrl(packId),
      });
      // 여기부터 PC(팝업) 경로. 모바일은 위에서 페이지가 떠나 도달하지 않는다.
      if (res && res.code) {
        // 결제 자체가 안 됐다(취소·실패) — 미결 아님, 기록을 지운다.
        window.moncPends.drop(PENDING_KEY, paymentId);
        fail('결제가 완료되지 않았어요.\n' + (res.message || res.code));
        return false;
      }
      if (btn) btn.textContent = '충전 확인 중…';
      return await complete(paymentId, packId, {
        onDone: opts.onDone, onFail: opts.onVerifyFail || opts.onFail,
      });
    } catch (e) {
      fail('결제 중 오류가 발생했어요: ' + (e && e.message ? e.message : e));
      return false;
    } finally {
      _restore = null;
      if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = orig; }
    }
  }

  /* 충전 확인 — verify-payment. quiet = 자가 회복 경로(실패 문구 없이 기록만).
     ② 확답(200 본문)일 때만 미결 기록을 지운다. */
  async function complete(paymentId, packId, opts) {
    opts = opts || {};
    try {
      var r = await sb().functions.invoke('verify-payment', {
        body: { paymentId: paymentId, creditPack: packId },
      });
      if (r.data) window.moncPends.drop(PENDING_KEY, paymentId);
      if (r.error || !r.data || !r.data.ok) {
        if (!opts.quiet && opts.onFail) {
          opts.onFail('결제는 됐는데 충전 확인에 실패했어요. 잠시 뒤 새로고침해 보시고, '
            + '그래도 안 되면 알려 주세요(결제번호 ' + paymentId + ').');
        }
        return false;
      }
      await loadWallet();
      if (opts.onDone) opts.onDone(r.data);
      return true;
    } catch (e) {
      if (!opts.quiet && opts.onFail) opts.onFail('충전 확인에 실패했어요. 새로고침해 주세요.');
      return false;
    }
  }

  /* 결제 복귀 + 자가 회복 — 미결 기록 전부를 확인한다.
     저장소가 다 날아간 복귀(인앱 새 탭)여도 주소의 paymentId+pk 로 기록을 되살린다. */
  async function handleReturn(opts) {
    opts = opts || {};
    var p = new URLSearchParams(location.search);
    var came = p.get('payresult') === '1';
    var code = p.get('code'), message = p.get('message');
    var urlPid = p.get('paymentId'), urlPk = p.get('pk');
    if (came) {
      ['payresult', 'paymentId', 'code', 'message', 'pgCode', 'pgMessage', 'transactionType', 'txId', 'pk']
        .forEach(function (k) { p.delete(k); });
      history.replaceState(null, '', location.origin + location.pathname
        + (p.toString() ? '?' + p.toString() : '') + location.hash);
      if (code) {
        if (urlPid) window.moncPends.drop(PENDING_KEY, urlPid);
        (opts.onFail || function (m) { alert(m); })('결제가 완료되지 않았어요.\n' + (message || code));
        return;
      }
      if (urlPid && urlPk) window.moncPends.add(PENDING_KEY, { paymentId: urlPid, packId: urlPk });
    }
    var pends = window.moncPends.load(PENDING_KEY);
    for (var i = 0; i < pends.length; i++) {
      var rec = pends[i];
      var loud = came && (!urlPid || rec.paymentId === urlPid);
      await complete(rec.paymentId, rec.packId, {
        quiet: !loud, onDone: opts.onDone, onFail: opts.onVerifyFail || opts.onFail,
      });
    }
  }

  /* 결제창에서 **뒤로** 왔을 때 — 잠긴 버튼만 되돌린다.
     ⚠️ reload 하지 않는다(결제 복귀 화면 예외 — page-common.md). */
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted || !_restore) return;
    var r = _restore; _restore = null; r();
  });

  window.moncCredit = {
    PENDING_KEY: PENDING_KEY,
    COST_FALLBACK: COST_FALLBACK,
    loadWallet: loadWallet, wallet: wallet, balance: balance, dailyLeft: dailyLeft, cost: cost,
    loadPacks: loadPacks, packs: packs, findPack: findPack,
    charge: charge, complete: complete, handleReturn: handleReturn,
  };
})();
