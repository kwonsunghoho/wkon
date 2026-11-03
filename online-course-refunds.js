/* 신청자 현황 안의 온라인 강의 주문·환불. 금액과 권한은 기존 서버가 판단한다. */
(() => {
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>Number(v||0).toLocaleString('ko-KR')+'원';
 const date=v=>v?new Date(v).toLocaleString('ko-KR'):'미시작';
 const states={pending:'결제 대기',paid:'결제 완료',cancelled:'결제 취소',refund_required:'취소 확인 중',refunded:'환불 처리'};
 const errors={already_started:'수강을 시작한 주문은 일반 환불 대상이 아닙니다. 법정 환불 사유는 별도로 검토해 주세요.',forbidden:'관리자 권한이 필요합니다.',not_ready:'온라인 강의 결제 내역을 불러올 수 없습니다.',refund_in_progress:'처리 중인 환불이 있습니다. 내역을 새로 불러와 상태를 확인해 주세요.',refund_amount_invalid:'환불 가능 금액이 변경됐습니다. 내역을 다시 확인해 주세요.',refund_request_mismatch:'이전에 요청한 금액과 다릅니다. 내역을 다시 확인해 주세요.',payment_lookup_failed:'결제사 조회에 실패했습니다. 잠시 후 다시 확인해 주세요.',payment_mismatch:'실제 결제 내역이 주문과 일치하지 않아 환불을 중단했습니다.'};
 let rows=[],loaded=false,loading=null,error='',message='',bad=false,onChange=()=>{},busy=false,identity=null,watching=false,epoch=0;
 const call=async(action,args={})=>{const r=await MONC.sb.functions.invoke('online-course',{body:{action:'admin-'+action,...args}});if(r.error||!r.data)throw Object.assign(Error('연결이 지연되고 있습니다. 내역을 다시 불러와 상태를 확인해 주세요.'),{code:[401,403].includes(r.error?.context?.status)?'forbidden':null});if(!r.data.ok)throw Object.assign(Error(errors[r.data.error]||'처리하지 못했습니다. 내역을 다시 확인해 주세요.'),{code:r.data.error});return r.data;};
 function status(text,isBad=false){message=text;bad=isBad;onChange();}
 async function load(force=false){
  if(loading)return loading;if(loaded&&!force)return;
  loaded=false;error='';message='';
  const generation=epoch;
  loading=(async()=>{try{
   const session=await MONC.getSession();
   if(!session?.user?.id)throw Object.assign(Error('로그인이 만료되었습니다. 다시 로그인해 주세요.'),{code:'not_authenticated'});
   identity=session.user.id;
   if(!watching){watching=true;MONC.sb.auth?.onAuthStateChange((_event,next)=>{if((next?.user?.id||null)===identity)return;identity=next?.user?.id||null;epoch++;rows=[];loaded=false;error='로그인이 변경되었습니다. 새로고침해 주세요.';document.querySelector('.oca-refund-dialog')?.close();onChange();});}
   const next=[],seen=new Set();
   for(let page=0;page<=10000;page++){
    const result=await call('orders',{scope:'all',page});
    if(result.scope!=='all')throw Error('온라인 강의 통합 조회 연결이 아직 적용되지 않았습니다.');
    if(!Array.isArray(result.orders))throw Error('결제 내역 형식을 확인하지 못했습니다.');
    let added=0;for(const row of result.orders){if(!row?.payment_id||seen.has(row.payment_id))continue;seen.add(row.payment_id);next.push(row);added++;}
    if(generation!==epoch)return;
    if(!result.more){rows=next;loaded=true;return;}
    if(!added||page===10000)throw Error('결제 내역을 끝까지 불러오지 못했습니다. 다시 불러와 주세요.');
   }
  }catch(e){error=e.message;if(['forbidden','not_authenticated','consent_required'].includes(e.code))rows=[];}finally{loading=null;onChange();}})();
  onChange();return loading;
 }
 async function refresh(){await load(true);}
 function applications(members=[]){
  const byId=new Map(members.map(member=>[member.id,member]));
  return rows.map(o=>{const member=byId.get(o.member_id);return{id:'online:'+o.payment_id,_onlineOrder:o,member_id:o.member_id,name:member?.name||o.memberName||'탈퇴 또는 이름 미등록',phone:member?.phone||o.memberPhone||'',created_at:o.created_at,total_price:o.amount,paid_amount:['paid','refunded'].includes(o.state)?o.amount:0,refunded_amount:o.refunded_amount||0,paid:o.state==='paid',refunded:o.state==='refunded',payment_status:o.state,payment_id:o.payment_id,challenges:[{type:'online',course_id:o.course_id,name:o.title}]};});
 }
 function note(){
  if(loaded&&!message)return '';
  const text=error?'온라인 강의 결제 조회 실패: '+error:loading?'온라인 강의 결제 내역을 불러오는 중입니다.':message||'온라인 강의 결제 내역을 아직 불러오지 않았습니다.';
  return '<div class="online-app-notice'+(error||bad?' err':'')+'" role="status">'+esc(text)+(error?'<button class="ad-sq" type="button" data-oc-action="retry">다시 불러오기</button>':'')+'</div>';
 }
 function row(a,formatDate){
  const o=a._onlineOrder,pending=(o.refunds||[]).find(f=>f.state==='pending'),remaining=o.amount-(o.refunded_amount||0);
  const action=pending?'check':remaining===o.amount&&o.state==='paid'&&!o.enrollment?.started_at?'refund':'';
  return `<div class="apl-row online-app-row" data-online-payment="${esc(o.payment_id)}"><div class="nm">${esc(a.name)} <span class="apl-tag">온라인 강의</span></div><div class="dt">${esc(formatDate(o.created_at))}</div><div class="ph"><b>${esc(a.phone||'전화 미입력')}</b></div><div class="ch">${esc(o.title)} <em>· ${money(o.amount)} · </em><b>${esc(states[o.state]||'상태 확인 필요')}</b></div><details class="online-app-detail"><summary>결제·수강 내역 <span aria-hidden="true">＋</span></summary><p class="oca-order-id">${esc(o.payment_id)}</p><dl><div><dt>결제액</dt><dd>${money(o.amount)}</dd></div><div><dt>환불 누계</dt><dd>${money(o.refunded_amount)}</dd></div><div><dt>수강 시작</dt><dd>${esc(date(o.enrollment?.started_at))}</dd></div><div><dt>수강 종료</dt><dd>${esc(o.enrollment?.expires_at?date(o.enrollment.expires_at):'시작 후 확정')}</dd></div></dl>${(o.refunds||[]).map(f=>`<p>${esc(date(f.created_at))} · ${money(f.amount)} · ${f.state==='succeeded'?'환불 완료':'확인 필요'}<br>${esc(f.reason)}</p>`).join('')}</details>${action?`<div class="act"><button type="button" class="ad-sq" data-oc-action="${action}">${pending?'환불 상태 확인':'미수강 전액 환불'}</button></div>`:o.enrollment?.started_at&&o.state==='paid'?'<p class="online-app-help">수강 시작 · 일반 환불 불가</p>':''}</div>`;
 }
 async function check(o){if(busy)return;const f=(o.refunds||[]).find(r=>r.state==='pending');if(!f)return;busy=true;status('같은 환불 요청의 상태를 확인하고 있습니다.');try{const r=await call('refund',{courseId:o.course_id,paymentId:o.payment_id,requestId:f.id,amount:f.amount,reason:f.reason});await refresh();status(r.warning||'환불과 수강권 회수를 확인했습니다.');}catch(e){status(e.message,true);}finally{busy=false;}}
  function openRefund(o,opener){
   const dialog=document.createElement('dialog');dialog.className='oca-refund-dialog';const id=crypto.randomUUID();let sending=false;
   dialog.innerHTML=`<form><h3>온라인 강의 환불</h3><p>${esc(o.memberName)} · ${esc(o.title)}</p><p><strong>전액 환불 ${money(o.amount)}</strong> · 미수강 주문</p><label class="oca-field">환불 사유<textarea name="reason" maxlength="300" required rows="3"></textarea></label><p class="oca-help">첫 재생 전 주문만 전액 환불합니다. 환불 완료 시 수강권이 종료되며 실제 결제수단으로 환불됩니다. 법정 환불 사유는 별도로 검토해 주세요.</p><label class="oca-check"><input type="checkbox" required><span>대상과 금액을 확인했습니다.</span></label><p role="status" class="oca-status"></p><div class="oca-refund-actions"><button class="oca-button secondary" type="button" data-close>닫기</button><button class="oca-button" type="submit">환불 실행</button></div></form>`;
   document.body.append(dialog);dialog.addEventListener('cancel',e=>{if(sending)e.preventDefault()});dialog.addEventListener('close',()=>{dialog.remove();opener.focus()});dialog.querySelector('[data-close]').onclick=()=>dialog.close();
   dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();if(sending)return;const form=e.currentTarget,amount=o.amount,reason=form.elements.reason.value.trim();if(!reason){form.elements.reason.focus();return} sending=true;form.querySelectorAll('button,input,textarea').forEach(n=>n.disabled=true);const note=form.querySelector('[role=status]');note.textContent='환불을 처리하고 있습니다. 창을 닫지 마세요.';
    try{const r=await call('refund',{courseId:o.course_id,paymentId:o.payment_id,requestId:id,amount,reason});dialog.close();await refresh();status(r.warning||'환불이 완료됐고 해당 수강권이 종료됐습니다.');}
    catch(err){note.textContent=err.message+' 닫은 뒤 내역을 새로 불러와 주세요.';form.querySelector('[data-close]').disabled=false;}
    finally{sending=false}
   };dialog.showModal();dialog.querySelector('[name=reason]').focus();
  }
 function bind(root,changed){
  onChange=changed;
  root.querySelectorAll('[data-oc-action]').forEach(button=>button.addEventListener('click',()=>{
   if(busy||loading||document.querySelector('.oca-refund-dialog[open]'))return;
   const action=button.dataset.ocAction;if(action==='retry'){load(true);return;}
   const payment=button.closest('[data-online-payment]')?.dataset.onlinePayment,o=rows.find(row=>row.payment_id===payment);if(!o)return;
   if(action==='refund')openRefund(o,button);if(action==='check')check(o);
  }));
 }
 window.MONCOnlineRefunds={load,applications,row,note,bind,ready:()=>loaded};
})();
