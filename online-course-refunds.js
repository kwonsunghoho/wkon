/* 온라인 강의 주문·환불. 금액 검증과 취소는 관리자 인증 서버가 처리한다. */
(() => {
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>Number(v||0).toLocaleString('ko-KR')+'원';
 const date=v=>v?new Date(v).toLocaleString('ko-KR'):'미시작';
 const states={pending:'결제 대기',paid:'결제 완료',cancelled:'결제 취소',refund_required:'취소 확인 중',refunded:'환불 처리'};
 const errors={already_started:'수강을 시작한 주문은 일반 환불 대상이 아닙니다. 법정 환불 사유는 별도로 검토해 주세요.',forbidden:'관리자 권한이 필요합니다.',not_ready:'결제 내역을 불러올 수 없습니다.',refund_in_progress:'처리 중인 환불이 있습니다. 내역을 새로 불러와 상태를 확인해 주세요.',refund_amount_invalid:'환불 가능 금액이 변경됐습니다. 내역을 다시 확인해 주세요.',refund_request_mismatch:'이전에 요청한 금액과 다릅니다. 내역을 다시 확인해 주세요.',payment_lookup_failed:'결제사 조회에 실패했습니다. 잠시 후 다시 확인해 주세요.',payment_mismatch:'실제 결제 내역이 주문과 일치하지 않아 환불을 중단했습니다.'};
 window.MONCOnlineRefunds={mount(root,courseId){
  root.querySelector('#oca-orders')?.remove();
  const area=document.createElement('details');area.id='oca-orders';area.className='oca-section oca-orders';
  area.innerHTML='<summary>결제·환불 내역</summary><div class="oca-orders-tools"><button type="button" class="oca-button secondary" data-orders="reload">새로 불러오기</button></div><p class="oca-status" role="status"></p><div class="oca-order-list"></div><div class="oca-orders-pages"></div>';
  root.append(area);let page=0,rows=[],busy=false,loaded=false;
  const status=(text,bad=false)=>{const n=area.querySelector('.oca-status');n.textContent=text;n.classList.toggle('is-error',bad)};
  const call=async(action,args={})=>{const r=await MONC.sb.functions.invoke('online-course',{body:{action:'admin-'+action,courseId,...args}});if(r.error||!r.data)throw Error('연결이 지연되고 있습니다. 내역을 다시 불러와 상태를 확인해 주세요.');if(!r.data.ok)throw Error(errors[r.data.error]||'처리하지 못했습니다. 내역을 다시 확인해 주세요.');return r.data};
  async function load(){if(busy)return;busy=true;status('결제 내역을 불러오고 있습니다.');try{
   const r=await call('orders',{page});rows=r.orders;loaded=true;
   area.querySelector('.oca-order-list').innerHTML=rows.length?rows.map((o,i)=>{
    const pending=o.refunds.find(x=>x.state==='pending'),remaining=o.amount-o.refunded_amount;
    return `<article class="oca-order"><h4>${esc(o.memberName)}</h4><p>${esc(o.title)} · ${esc(states[o.state]||o.state)}</p><p class="oca-order-id">${esc(o.payment_id)}</p><dl><div><dt>결제액</dt><dd>${money(o.amount)}</dd></div><div><dt>환불 누계</dt><dd>${money(o.refunded_amount)}</dd></div><div><dt>수강 시작</dt><dd>${date(o.enrollment?.started_at)}</dd></div><div><dt>구매일</dt><dd>${date(o.created_at)}</dd></div></dl>${o.refunds.map(f=>`<p class="oca-help">${date(f.created_at)} · ${money(f.amount)} · ${f.state==='succeeded'?'환불 완료':'확인 필요'}<br>${esc(f.reason)}</p>`).join('')}${pending?`<button type="button" class="oca-button secondary" data-orders="check" data-index="${i}">환불 상태 확인</button>`:remaining===o.amount&&o.state==='paid'&&!o.enrollment?.started_at?`<button type="button" class="oca-button secondary" data-orders="refund" data-index="${i}">미수강 전액 환불</button>`:o.enrollment?.started_at&&o.state==='paid'?'<p class="oca-help">수강 시작 · 일반 환불 불가</p>':''}</article>`;
   }).join(''):'<p class="oca-empty">이 과정의 결제 내역이 없습니다. 관리자·재학생 무료 수강은 결제 내역에 포함되지 않습니다.</p>';
   area.querySelector('.oca-orders-pages').innerHTML=`<button class="oca-button secondary" type="button" data-orders="prev" ${page===0?'disabled':''}>이전</button><span>${page+1}페이지</span><button class="oca-button secondary" type="button" data-orders="next" ${!r.more?'disabled':''}>다음</button>`;status('');
  }catch(e){status(e.message,true)}finally{busy=false}}
  async function check(o){if(busy)return;busy=true;status('같은 환불 요청의 상태를 확인하고 있습니다.');const f=o.refunds.find(r=>r.state==='pending');try{const r=await call('refund',{paymentId:o.payment_id,requestId:f.id,amount:f.amount,reason:f.reason});busy=false;await load();status(r.warning||'환불과 수강권 회수를 확인했습니다.')}catch(e){status(e.message,true)}finally{busy=false}}
  function openRefund(o,opener){
   const dialog=document.createElement('dialog');dialog.className='oca-refund-dialog';const id=crypto.randomUUID();let sending=false;
   dialog.innerHTML=`<form><h3>온라인 강의 환불</h3><p>${esc(o.memberName)} · ${esc(o.title)}</p><p><strong>전액 환불 ${money(o.amount)}</strong> · 미수강 주문</p><label class="oca-field">환불 사유<textarea name="reason" maxlength="300" required rows="3"></textarea></label><p class="oca-help">첫 재생 전 주문만 전액 환불합니다. 환불 완료 시 수강권이 종료되며 실제 결제수단으로 환불됩니다. 법정 환불 사유는 별도로 검토해 주세요.</p><label class="oca-check"><input type="checkbox" required><span>대상과 금액을 확인했습니다.</span></label><p role="status" class="oca-status"></p><div class="oca-refund-actions"><button class="oca-button secondary" type="button" data-close>닫기</button><button class="oca-button" type="submit">환불 실행</button></div></form>`;
   document.body.append(dialog);dialog.addEventListener('cancel',e=>{if(sending)e.preventDefault()});dialog.addEventListener('close',()=>{dialog.remove();opener.focus()});dialog.querySelector('[data-close]').onclick=()=>dialog.close();
   dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();if(sending)return;const form=e.currentTarget,amount=o.amount,reason=form.elements.reason.value.trim();if(!reason){form.elements.reason.focus();return} sending=true;form.querySelectorAll('button,input,textarea').forEach(n=>n.disabled=true);const note=form.querySelector('[role=status]');note.textContent='환불을 처리하고 있습니다. 창을 닫지 마세요.';
    try{const r=await call('refund',{paymentId:o.payment_id,requestId:id,amount,reason});dialog.close();await load();status(r.warning||'환불이 완료됐고 해당 수강권이 종료됐습니다.');}
    catch(err){note.textContent=err.message+' 닫은 뒤 내역을 새로 불러와 주세요.';form.querySelector('[data-close]').disabled=false;}
    finally{sending=false}
   };dialog.showModal();dialog.querySelector('[name=reason]').focus();
  }
  area.addEventListener('toggle',()=>{if(area.open&&!loaded)load()});area.addEventListener('click',e=>{const b=e.target.closest('[data-orders]');if(!b||busy)return;const action=b.dataset.orders;if(action==='reload')load();if(action==='prev'){page--;load()}if(action==='next'){page++;load()}if(action==='refund')openRefund(rows[Number(b.dataset.index)],b);if(action==='check')check(rows[Number(b.dataset.index)]);});
 }};
})();
