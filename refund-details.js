/* 환불 대상 표시·선택 공용. 금액과 항목의 최종 검증은 cancel-payment가 맡는다. */
(function () {
  'use strict';
  const names = { voice: '보신각', expression: '영합각', spinning: '스피닝', answer: '승자각', culture: '댄특완' };
  const cache = new Map();
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function label(c) {
    if (!c || typeof c !== 'object') return '항목명 미기록';
    if (c.type === 'lecture' || c.lecture_id) return (c.name || '특강') + (c.slot ? ' · ' + c.slot : '');
    return (names[c.challenge] || c.challenge || '항목명 미기록') + (c.round ? ' ' + c.round + '기' : '');
  }
  const money = n => Number(n || 0).toLocaleString('ko-KR') + '원';
  const date = v => v && Number.isFinite(new Date(v).getTime())
    ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v)) : '날짜 미기록';
  async function load(apps) {
    const ids = [...new Set(apps.filter(a => a.id && (a.refunded || Number(a.refunded_amount) > 0 || ['refunded', 'partial_refunded'].includes(a.payment_status))).map(a => a.id))];
    for (let i = 0; i < ids.length; i += 100) {
      const group = ids.slice(i, i + 100);
      try {
        let rows = [];
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await MONC.sb.rpc('application_refund_history', { p_application_ids: group }).range(offset, offset + 499);
          if (error) throw error;
          rows = rows.concat(data || []);
          if (!data || data.length < 500) break;
        }
        group.forEach(id => cache.set(id, rows.filter(r => r.application_id === id)));
      } catch (_) { group.forEach(id => cache.set(id, null)); }
    }
  }
  function history(a) {
    if (!a.refunded && !Number(a.refunded_amount) && !['refunded', 'partial_refunded'].includes(a.payment_status)) return '';
    const rows = cache.get(a.id);
    if (!rows) return '<ul class="refund-history"><li>환불 상세를 불러오지 못했습니다.<span>새로고침 후 다시 확인해 주세요.</span></li></ul>';
    if (!rows.length) return '<ul class="refund-history"><li>환불 항목·날짜 미기록</li></ul>';
    return '<ul class="refund-history" aria-label="환불 내역">' + rows.map(r => {
      const items = Array.isArray(r.items) && r.items.length ? r.items.map(label).join(', ') : '항목 미기록';
      return '<li><strong>환불 · ' + esc(items) + '</strong><div>환불액 ' + money(r.amount) + '</div><span>' + esc(date(r.created_at)) + '</span></li>';
    }).join('') + '</ul>';
  }
  function ask(app) {
    const items = Array.isArray(app.challenges) ? app.challenges : [];
    const remaining = Number(app.paid_amount || 0) - Number(app.refunded_amount || 0);
    return new Promise(resolve => {
      const dlg = document.createElement('dialog');
      dlg.className = 'refund-dialog';
      dlg.setAttribute('aria-labelledby', 'refund-title');
      dlg.innerHTML = '<form><h2 id="refund-title">환불 항목 선택</h2><p>' + esc(app.name || '신청자') + '님 · 환불 가능액 ' + money(remaining) + '</p>'
        + '<fieldset><legend>환불할 항목</legend>' + items.map((c, i) => '<label class="refund-choice"><input type="checkbox" name="item" value="' + i + '"' + (items.length === 1 ? ' checked' : '') + '><span>' + esc(label(c)) + '</span></label>').join('') + '</fieldset>'
        + '<label class="refund-amount-label" for="refund-amount">환불 금액(원)</label><input id="refund-amount" type="number" inputmode="numeric" min="1" max="' + remaining + '" step="1" required' + (items.length === 1 ? ' value="' + remaining + '"' : '') + '>'
        + '<p class="refund-error" role="alert" hidden></p><div class="refund-actions"><button type="button">취소</button><button type="submit">내용 확인</button></div></form>';
      document.body.appendChild(dlg);
      let result = null, selection = null;
      dlg.addEventListener('close', () => { dlg.remove(); resolve(result); }, { once: true });
      dlg.querySelector('button[type=button]').onclick = () => dlg.close();
      dlg.querySelector('form').onsubmit = event => {
        event.preventDefault();
        if (selection) { result = selection; dlg.close(); return; }
        const indexes = [...dlg.querySelectorAll('input[name=item]:checked')].map(el => Number(el.value));
        const amount = Number(dlg.querySelector('#refund-amount').value);
        const error = dlg.querySelector('.refund-error');
        const fail = message => { error.textContent = message; error.hidden = false; };
        if (!indexes.length) { fail('환불할 항목을 선택해 주세요.'); return; }
        if (!Number.isInteger(amount) || amount < 1 || amount > remaining) { fail('환불 가능액 안에서 정수 금액을 입력해 주세요.'); return; }
        // 남은 결제액 전체를 취소하면서 일부 항목만 기록하는 모순을 막는다.
        if (amount === remaining && !Number(app.refunded_amount) && indexes.length !== items.length) { fail('전액 환불은 모든 항목을 선택해 주세요.'); return; }
        selection = { amount, itemIndexes: indexes };
        dlg.querySelector('form').innerHTML = '<h2 id="refund-title">환불 내용 확인</h2><p>' + esc(app.name || '신청자') + '님</p><p><strong>' + esc(indexes.map(i => label(items[i])).join(', ')) + '</strong></p><p>환불액 <strong>' + money(amount) + '</strong></p><p>원결제수단으로 즉시 환불됩니다. 처리 후 되돌릴 수 없습니다.</p><div class="refund-actions"><button type="button">취소</button><button type="submit">환불 실행</button></div>';
        dlg.querySelector('button[type=button]').onclick = () => { dlg.close(); };
        dlg.querySelector('button[type=submit]').focus();
      };
      dlg.showModal();
    });
  }
  window.MONC_REFUNDS = { label, load, history, ask };
})();
