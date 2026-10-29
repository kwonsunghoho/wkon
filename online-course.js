/* 실제 강의 연결. 화면의 시간·금액으로 권한을 부여하지 않고 서버 응답만 사용한다. */
(() => {
 'use strict';
 const $=s=>document.querySelector(s), page=document.body.dataset.coursePage;
 const params=new URLSearchParams(location.search), courseId=params.get('course')||'expression-advanced';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=v=>{v=Math.max(0,Math.floor(Number(v)||0));return String(Math.floor(v/60)).padStart(2,'0')+':'+String(v%60).padStart(2,'0');};
 const day=v=>new Date(v).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
 const money=v=>Number(v).toLocaleString('ko-KR')+'원';
 const messages={not_ready:'강의를 준비하고 있습니다. 잠시 후 다시 확인해 주세요.',not_published:'아직 판매 준비 중인 과정입니다.',not_for_sale:'아직 판매가 시작되지 않았습니다.',content_not_ready:'영상 또는 자료를 준비하고 있습니다.',not_authenticated:'로그인이 필요합니다.',consent_required:'로그인 화면에서 이용 동의를 확인해 주세요.',purchase_consent_required:'가격·기간과 이용 안내를 확인하고 체크해 주세요.',offer_changed:'판매 조건이 변경되었습니다. 새로고침 후 다시 확인해 주세요.',already_enrolled:'이미 수강 중인 과정입니다. 내 강의실에서 확인해 주세요.',not_enrolled:'이 계정에 해당하는 수강권을 찾을 수 없습니다.',access_expired:'수강 기간이 종료되었거나 이용이 취소되었습니다.',lesson_unavailable:'이 강의는 현재 이용할 수 없습니다.',start_video_first:'첫 영상을 재생하면 연습 자료도 이용할 수 있습니다.',not_paid:'결제 완료를 아직 확인하지 못했습니다. 다시 결제하지 말고 잠시 후 내 강의실에서 확인해 주세요.',payment_failed:'결제가 완료되지 않았습니다.',refunded:'결제가 취소되어 수강권이 지급되지 않았습니다.',refund_required:'결제 취소를 확인 중입니다. 추가로 결제하지 말아 주세요.',refund_pending:'결제 취소를 확인 중입니다. 잠시 후 다시 확인해 주세요.',save_failed:'진도를 저장하지 못했습니다. 연결이 회복되면 다시 저장합니다.'};
 let session=null, offset=0, library=[], filter='active', view=null, selected=null, busy=false, saveQueue=Promise.resolve(), savedTime=0, mediaExpires=0, repeatA=null,repeatB=null,loadedLesson=null,mediaReady=false,lastRecovery=0;
 let noteEditor=null,switching=false,initialJump=null;
 const video=$('#course-video');
 if(video)video.addEventListener('contextmenu',e=>e.preventDefault());
 function message(text,id='course-message'){const el=$('#'+id);if(el){el.textContent=text||'';el.hidden=!text;}}
 function errorText(e){return messages[e?.code]||'연결을 확인한 뒤 다시 시도해 주세요.';}
 async function call(action,args={}){const r=await MONC.sb.functions.invoke('online-course',{body:{action,courseId,...args}});if(r.error)throw Object.assign(new Error('network'),{code:'network'});if(!r.data?.ok)throw Object.assign(new Error(r.data?.error||'unavailable'),{code:r.data?.error});if(r.data.serverNow)offset=Date.parse(r.data.serverNow)-Date.now();return r.data;}
 async function guard(){session=await MONC.getSession();if(!session){location.href='login.html?returnTo='+encodeURIComponent(location.pathname+location.search);return false;}return await MONC.requireConsent();}
 const pendingKey=()=>`monc_pending_online_course:${session.user.id}`;
 async function verify(paymentId,cid=courseId,quiet=false){
  const r=await MONC.sb.functions.invoke('verify-payment',{body:{paymentId,courseId:cid}});
  if(r.error||!r.data){if(!quiet)message('결제 확인이 지연되고 있습니다. 다시 결제하지 말고 내 강의실에서 확인해 주세요.');return null;}
  if(r.data.ok||r.data.terminal)moncPends.drop(pendingKey(),paymentId);
  if(!r.data.ok&&!quiet)message(messages[r.data.error]||'결제 확인이 지연되고 있습니다. 잠시 후 다시 확인해 주세요.');
  return r.data.ok?true:r.data.error==='not_paid'||r.data.error==='payment_failed'?false:null;
 }
 async function recover(){if(!session||!window.moncPends)return;for(const p of moncPends.load(pendingKey()))await verify(p.paymentId,p.courseId,true);}
 async function catalog(){
  let c=null,access=null;
  async function refreshAccess(){
   session=await MONC.getSession();
   access=session?await call('access'):null;
   const direct=access&&(access.enrollmentId||['admin','student'].includes(access.kind));
   $('#purchase-button').textContent=direct?(access.kind==='admin'?'관리자 바로보기':access.kind==='student'?'재학생 무료 수강':'강의 바로보기'):'수강 신청';
   $('#purchase-consent-wrap').hidden=!!direct||!c?.saleOpen;
   $('#course-price').textContent=direct?(access.kind==='student'?'재학생 무료':access.kind==='admin'?'관리자 무료 열람':'수강권 보유'):c?.price?money(c.price):'준비 중';
   if(direct)$('#course-sale-note').textContent=access.kind==='student'?'재학생 무료 · 첫 재생일부터 수강 기간이 시작됩니다.':'결제 없이 강의실로 바로 이동합니다.';
  }
  try{const r=await call('catalog');c=r.course;$('#course-description').textContent=c.description;$('#course-price').textContent=c.price?money(c.price):'준비 중';$('#course-period').textContent=c.accessDays?`첫 재생일부터 ${c.accessDays}일`:'준비 중';$('#purchase-consent-wrap').hidden=!c.saleOpen;$('#course-purchase-notice').textContent=c.purchaseNotice||'';$('#course-purchase-notice').hidden=!c.purchaseNotice;$('#course-sale-note').textContent=c.saleOpen?'결제 후 내 강의실에서 시작할 수 있습니다.':'판매 준비 중입니다.';
   if(r.lessons.length){const groups=[...new Set(r.lessons.map(l=>l.chapter))];$('#course-curriculum').innerHTML=groups.map((g,i)=>`<details ${i===0?'open':''}><summary>${esc(g)}</summary><ol>${r.lessons.filter(l=>l.chapter===g).map(l=>`<li>${esc(l.title)}<span>${fmt(l.duration)}</span></li>`).join('')}</ol></details>`).join('');}
  }catch(e){if(e.code!=='not_published')message(errorText(e));}
  $('#purchase-button').addEventListener('click',async()=>{
   if(busy)return;
   try{await refreshAccess();}catch(e){message(errorText(e));return;}
   if(access&&(access.enrollmentId||['admin','student'].includes(access.kind))){
    if(!(await guard()))return;
    busy=true;$('#purchase-button').disabled=true;
    try{const r=await call('access',{claim:true});if(!r.enrollmentId)throw {code:'not_enrolled'};location.href='classroom-watch.html?enrollment='+encodeURIComponent(r.enrollmentId);}
    catch(e){message(errorText(e));}finally{busy=false;$('#purchase-button').disabled=false;}return;
   }
   if(!c?.saleOpen){message('현재 판매 준비 중입니다. 가격·기간·강의가 확정되면 신청할 수 있습니다.');return;}
   if(!$('#purchase-consent').checked){message(messages.purchase_consent_required);$('#purchase-consent').focus();return;}
   if(!(await guard()))return;
   const channelKey=await moncPay.choose();if(!channelKey)return;
   busy=true;$('#purchase-button').disabled=true;message('결제를 준비하고 있습니다.');
   try{
    await recover();
    const order=await call('order',{amount:c.price,accessDays:c.accessDays,accepted:true});
    if(order.reused){const checked=await verify(order.paymentId,order.courseId,true);if(checked){location.href='classroom.html';return;}if(checked===null){message('이전 결제 확인이 지연되고 있습니다. 잠시 후 내 강의실에서 확인해 주세요.');return;}}
    // 이전 주문의 조건을 숨긴 채 결제하지 않는다.
    if(order.amount!==c.price||order.accessDays!==c.accessDays){message('이전 미결 주문의 조건이 달라 확인이 필요합니다. 고객센터로 문의해 주세요.');return;}
    moncPends.add(pendingKey(),{paymentId:order.paymentId,courseId:order.courseId});
    const profile=await MONC.getMyProfile();
    const redirectUrl=new URL('course.html',location.href);redirectUrl.searchParams.set('course',order.courseId);redirectUrl.searchParams.set('payresult','1');
    const res=await PortOne.requestPayment({storeId:moncPay.storeId,channelKey,paymentId:order.paymentId,orderName:'몬크 · '+order.title,totalAmount:order.amount,currency:'KRW',payMethod:'EASY_PAY',customer:{customerId:session.user.id,fullName:profile?.name||undefined,phoneNumber:profile?.phone||undefined},customData:JSON.stringify({k:'online-course',oid:order.paymentId,cid:order.courseId,uid:session.user.id}),redirectUrl:redirectUrl.href});
    if(res?.code){message('결제창이 종료되었습니다. 결제 여부는 내 강의실에서 다시 확인할 수 있습니다.');return;}
    if(await verify(order.paymentId,order.courseId))location.href='classroom.html';
   }catch(e){message(errorText(e));}finally{busy=false;$('#purchase-button').disabled=false;}
  });
  session=await MONC.getSession();
  if(session){if(params.get('paymentId')){moncPends.add(pendingKey(),{paymentId:params.get('paymentId'),courseId});if(await verify(params.get('paymentId'))){location.href='classroom.html';return;}}await recover();}
  try{await refreshAccess();}catch(e){message('수강 권한을 확인하지 못했습니다. 새로고침 후 다시 확인해 주세요.');return;}
  $('#purchase-button').disabled=false;
 }
 const ended=e=>!!(view&&view.enrollment===e&&view.expired)||!!e.revoked_at||!!e.expires_at&&Date.parse(e.expires_at)<=Date.now()+offset;
 function drawLibrary(){
  const rows=library.filter(e=>filter==='ended'?ended(e):!ended(e));
  $('#course-library').innerHTML=rows.length?rows.map(e=>{
   const progress=e.progress||[],last=progress.slice().sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at))[0];
   const state=e.revoked_at?'이용 취소':ended(e)?'수강 종료':e.started_at?'수강 중':'학습 전';
   const period=e.started_at?`${day(e.expires_at)}까지`:`첫 재생일부터 ${e.access_days}일`;
   return `<article class="course-card recent"><div class="oc-library-cover" aria-hidden="true"><span>MONC · INTERVIEW CLASS</span><strong>${esc(e.title)}</strong><small>승무원 영상면접 심화과정</small></div><div class="course-content"><div class="course-topline"><span class="course-level">온라인 심화과정</span><span class="course-period">${e.admin_preview?'관리자 테스트 · ':''}${state}</span></div><h2>${esc(e.title)}</h2><p class="course-description">영상을 보고 내 메모로 정리하며 학습합니다.</p><div class="resume-context"><span>${progress.filter(p=>p.completed).length}강 학습 완료</span><p>${e.started_at?'최근 학습 위치 '+fmt(last?.position_seconds):'아직 수강 기간이 시작되지 않았습니다.'}</p></div><a class="resume-action" href="classroom-watch.html?enrollment=${encodeURIComponent(e.id)}${last?'&lesson='+encodeURIComponent(last.lesson_id):''}"><strong>${ended(e)?'수강 기록 보기':e.started_at?'이어서 학습하기':'강의실 입장'}</strong><span aria-hidden="true">→</span></a><p class="course-until">${esc(period)}</p></div></article>`;
  }).join(''):`<p class="oc-empty">${filter==='ended'?'종료된 강의가 없습니다.':'아직 구매한 강의가 없습니다.'}</p>`;
 }
 async function loadLibrary(){if(!(await guard()))return;await recover();const r=await call('library');library=r.enrollments;drawLibrary();document.querySelectorAll('[data-course-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.courseFilter;document.querySelectorAll('[data-course-filter]').forEach(t=>t.setAttribute('aria-pressed',String(t===b)));drawLibrary();}));}
 function enrollmentArgs(){return {enrollmentId:view.enrollment.id,lessonId:selected?.id};}
 function period(){const e=view.enrollment;$('#watch-period').textContent=(e.admin_preview?'관리자 테스트 · ':'')+(e.revoked_at?'이용이 취소된 수강권입니다.':ended(e)?'수강 기간이 종료되었습니다.':e.started_at?`${day(e.expires_at)}까지 수강 가능`:`첫 재생일부터 ${e.access_days}일 동안 수강`); }
 function stopAccess(){view.expired=true;mediaReady=false;loadedLesson=null;video.pause();video.removeAttribute('src');video.load();$('#oc-controls').hidden=true;$('#oc-video-cover').hidden=false;$('#first-play-note').textContent=messages.access_expired;$('#oc-start').disabled=true;period();}
 function drawLessons(){const groups=[...new Set(view.lessons.map(l=>l.chapter))];$('#watch-lessons').innerHTML=groups.map(g=>`<details class="chapter" ${view.lessons.some(l=>l.chapter===g&&l.id===selected?.id)?'open':''}><summary>${esc(g)}</summary><div class="chapter-content">${view.lessons.filter(l=>l.chapter===g).map(l=>`<button class="lesson-row" data-lesson="${esc(l.id)}" aria-current="${l.id===selected?.id}"><span>${l.position}</span><span><strong>${esc(l.title)}</strong><small>${fmt(l.duration)}</small></span><span class="lesson-state">${view.progress.some(p=>p.lesson_id===l.id&&p.completed)?'완료':l.id===selected?.id?'현재':''}</span></button>${l.id===selected?.id&&l.chapters?.length?`<div class="oc-chapters" aria-label="영상 구간">${l.chapters.map(c=>`<button data-chapter-seconds="${Number(c.seconds)}"><span>${fmt(c.seconds)}</span><strong>${esc(c.title)}</strong></button>`).join('')}</div>`:''}`).join('')}</div></details>`).join('');markChapter();}
 function markChapter(){const list=[...document.querySelectorAll("[data-chapter-seconds]")];const last=mediaReady?list.filter(b=>Number(b.dataset.chapterSeconds)<=video.currentTime).at(-1):null;list.forEach(b=>b.setAttribute("aria-current",String(b===last)));}
 async function jump(seconds){if(ended(view.enrollment)){message(messages.access_expired);return;}repeatA=null;repeatB=null;if(mediaReady)await seekTo(seconds);else await play(seconds);}
 function selectLesson(l){initialJump=null;message('');message('','progress-status');mediaReady=false;loadedLesson=null;video.pause();video.removeAttribute('src');video.load();selected=l;repeatA=null;repeatB=null;$('#oc-repeat-panel').hidden=true;$('#oc-repeat').setAttribute('aria-expanded','false');$('#oc-repeat-status').textContent='';$('#oc-controls').hidden=true;$('#oc-video-cover').hidden=false;$('#watch-lesson-title').textContent=l.title;$('#video-lesson-title').textContent=l.title;$('#watch-lesson-number').textContent=`${view.lessons.indexOf(l)+1} / ${view.lessons.length}강`;$('#first-play-note').textContent=view.enrollment.started_at?'재생 버튼을 누르면 이어서 학습합니다.':`처음 재생하면 ${view.enrollment.access_days}일의 수강 기간이 시작됩니다.`;$('#oc-start').disabled=!l.hasVideo||ended(view.enrollment);$('#oc-next').disabled=view.lessons.indexOf(l)===view.lessons.length-1;period();drawLessons();if(ended(view.enrollment))stopAccess();}
 // 현재 선택 항목과 실제로 로드된 영상의 신원을 분리한다.
 function save(){
  if(!view||!loadedLesson||!mediaReady||busy||!video.currentSrc||!view.enrollment.started_at||ended(view.enrollment))return saveQueue;
  const args={enrollmentId:view.enrollment.id,lessonId:loadedLesson.id,position:Math.floor(video.currentTime)},duration=loadedLesson.duration;
  saveQueue=saveQueue.catch(()=>false).then(async()=>{
   try{await call('progress',args);const p=view.progress.find(p=>p.lesson_id===args.lessonId),completed=duration>0&&args.position>=duration*.95;
    if(p){p.position_seconds=args.position;p.completed=p.completed||completed;p.updated_at=new Date().toISOString();}
    else view.progress.push({lesson_id:args.lessonId,position_seconds:args.position,completed,updated_at:new Date().toISOString()});
    message('학습 위치 저장됨','progress-status');drawLessons();return true;
   }catch(e){message(messages.save_failed,'progress-status');if(e.code==='access_expired')stopAccess();return false;}
  });return saveQueue;
 }
 function mediaEvent(name,run){return new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);video.removeEventListener(name,ready);video.removeEventListener('error',failed);};
  const ready=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error('media_unavailable'));};
  const timer=setTimeout(failed,60000);video.addEventListener(name,ready,{once:true});video.addEventListener('error',failed,{once:true});run();
 });}
 async function play(resumeOverride,autoplay=true){
  if(busy||switching||!selected||ended(view.enrollment))return;
  const id=selected.id,resume=typeof resumeOverride==='number'?resumeOverride:loadedLesson?.id===id&&mediaReady?video.currentTime:initialJump??view.progress.find(p=>p.lesson_id===id)?.position_seconds??0;
  busy=true;mediaReady=false;$('#oc-start').disabled=true;message('영상을 불러오고 있습니다.');
  try{
   const r=await call('play',enrollmentArgs());if(selected.id!==id)return;
   view.enrollment.started_at=r.startedAt;view.enrollment.expires_at=r.expiresAt;period();mediaExpires=Date.parse(r.urlExpiresAt)-offset;
   await mediaEvent('loadedmetadata',()=>{video.preload='auto';video.src=r.url;video.load();});
   const target=resume>=video.duration-1?0:Math.max(0,resume);
   if(target>0)await mediaEvent('seeked',()=>{video.currentTime=target;});
   loadedLesson=selected;mediaReady=true;initialJump=null;savedTime=Date.now();video.playbackRate=Number($('#oc-speed').value);
   $('#oc-video-cover').hidden=true;$('#oc-controls').hidden=false;message('');period();
   if(autoplay)await video.play();
  }catch(e){mediaReady=false;message(errorText(e));$('#oc-video-cover').hidden=false;$('#first-play-note').textContent='영상을 불러오지 못했습니다. 다시 재생해 주세요.';if(e.code==='access_expired')stopAccess();}
  finally{busy=false;if(mediaReady){$('#oc-seek').max=video.duration;$('#oc-seek').value=video.currentTime;$('#oc-time').textContent=fmt(video.currentTime)+' / '+fmt(video.duration);}$('#oc-start').disabled=ended(view.enrollment)||!selected.hasVideo;}
 }
 async function seekTo(position){
  if(busy||!mediaReady||!Number.isFinite(video.duration))return;
  const target=Math.max(0,Math.min(video.duration,position));
  if(Date.now()>=mediaExpires){const autoplay=!video.paused;await save();await play(target,autoplay);save();}
  else {message('선택한 구간을 불러오고 있습니다.');video.currentTime=target;}
 }
 async function switchLesson(l){if(busy||switching||!l||l===selected)return;switching=true;try{video.pause();if(await save()===false)return;if(!await noteEditor.flush()){message('메모 저장을 확인한 뒤 이동할 수 있습니다. 아래 내 메모의 저장 상태를 확인해 주세요.');return;}if(!await noteEditor.select(l)){message('다음 강의의 메모를 불러오지 못했습니다. 잠시 후 다시 이동해 주세요.');return;}selectLesson(l);}finally{switching=false;}}
 async function recoverVideo(){
  if(busy||!mediaReady||Date.now()<mediaExpires||Date.now()-lastRecovery<30000)return;
  lastRecovery=Date.now();const position=video.currentTime;await save();await play(position);
 }
 async function watch(){
  if(!(await guard()))return;const eid=params.get('enrollment');if(!eid)throw {code:'not_enrolled'};
  view=await call('view',{enrollmentId:eid});$('#watch-course-name').textContent=view.course.title;$('.list-course>span').textContent=view.course.title;
  if(!view.lessons.length){message('강의가 아직 등록되지 않았습니다.');$('#oc-start').disabled=true;$('#first-play-note').textContent='강의 등록 준비 중입니다.';return;}
  noteEditor=MONCCourseNotes.editor($('#watch-notes'),{ownerId:session.user.id,getTime:()=>mediaReady&&loadedLesson?.id===selected?.id?video.currentTime:null,onJump:jump});
  selectLesson(view.lessons.find(l=>l.id===params.get('lesson'))||view.lessons[0]);
  noteEditor.select(selected);
  const at=Number(params.get('at'));if(params.has('at')&&Number.isFinite(at)&&at>=0&&at<selected.duration)initialJump=at;
  $('#watch-lessons').addEventListener('click',e=>{const chapter=e.target.closest('[data-chapter-seconds]');if(chapter){if(!busy&&!switching)jump(Number(chapter.dataset.chapterSeconds));return;}const button=e.target.closest('[data-lesson]');if(!button||busy||switching)return;switchLesson(view.lessons.find(l=>l.id===button.dataset.lesson));});
  $('#oc-start').addEventListener('click',play);$('#oc-play').addEventListener('click',async()=>{if(video.paused){if(Date.now()>=mediaExpires)await play();else video.play().catch(()=>message('재생 버튼을 다시 눌러 주세요.'));}else video.pause();});
  video.addEventListener('play',()=>{$('#oc-play').textContent='Ⅱ';$('#oc-play').setAttribute('aria-label','일시정지');});
  video.addEventListener('pause',()=>{$('#oc-play').textContent='▶';$('#oc-play').setAttribute('aria-label','재생');save();});video.addEventListener('ended',save);video.addEventListener('seeked',()=>{if(mediaReady&&!busy)message('');save();});video.addEventListener('error',()=>{if(busy)return;if(mediaReady&&Date.now()>=mediaExpires){recoverVideo();return;}video.pause();$('#oc-video-cover').hidden=false;$('#first-play-note').textContent='영상 연결이 끊겼습니다. 재생 버튼을 눌러 이어서 시청하세요.';});
  video.addEventListener('stalled',recoverVideo);video.addEventListener('waiting',()=>{setTimeout(()=>{if(!video.paused&&video.readyState<3)recoverVideo();},3000);});
  video.addEventListener('timeupdate',()=>{if(!mediaReady||busy)return;markChapter();if(ended(view.enrollment)){stopAccess();return;}if(repeatA!==null&&repeatB!==null&&video.currentTime>=repeatB)seekTo(repeatA);$('#oc-seek').max=Number.isFinite(video.duration)?video.duration:selected.duration;$('#oc-seek').value=video.currentTime;$('#oc-time').textContent=fmt(video.currentTime)+' / '+fmt(video.duration);if(Date.now()-savedTime>15000){savedTime=Date.now();save();}});
  $('#oc-seek').addEventListener('change',()=>seekTo(Number($('#oc-seek').value))); 
  $('#oc-back').addEventListener('click',()=>{seekTo(video.currentTime-10);});$('#oc-forward').addEventListener('click',()=>{seekTo(video.currentTime+10);});$('#oc-speed').addEventListener('change',()=>{video.playbackRate=Number($('#oc-speed').value);});
  $('#oc-next').addEventListener('click',()=>{if(busy)return;switchLesson(view.lessons[view.lessons.indexOf(selected)+1]);});
  $('#oc-outline').addEventListener('click',()=>{const collapsed=$('.watch-grid').classList.toggle('is-outline-collapsed');$('#oc-outline').setAttribute('aria-expanded',String(!collapsed));$('#oc-outline').textContent=collapsed?'목차 펼치기':'목차 접기';});
  $('#oc-fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('.oc-video-stage').requestFullscreen();}catch{message('이 브라우저에서는 전체 화면을 사용할 수 없습니다.');}});
  $('#oc-repeat').addEventListener('click',()=>{const open=$('#oc-repeat-panel').hidden;$('#oc-repeat-panel').hidden=!open;$('#oc-repeat').setAttribute('aria-expanded',String(open));});
  $('#oc-mark-a').addEventListener('click',()=>{repeatA=video.currentTime;repeatB=null;$('#oc-repeat-status').textContent='시작 '+fmt(repeatA)+' · 끝점을 지정하세요.';});
  $('#oc-mark-b').addEventListener('click',()=>{if(repeatA===null){$('#oc-repeat-status').textContent='먼저 시작점을 지정하세요.';return;}if(video.currentTime<=repeatA){$('#oc-repeat-status').textContent='끝점은 시작점보다 뒤에 지정하세요.';return;}repeatB=video.currentTime;$('#oc-repeat-status').textContent=fmt(repeatA)+'–'+fmt(repeatB)+' 구간을 반복합니다.';});
  $('#oc-repeat-clear').addEventListener('click',()=>{repeatA=null;repeatB=null;$('#oc-repeat-status').textContent='구간 반복을 해제했습니다.';});
  setInterval(()=>{if(ended(view.enrollment)&&video.currentSrc)stopAccess();},1000);
  setInterval(async()=>{try{const r=await call('view',{enrollmentId:view.enrollment.id});view.enrollment=r.enrollment;if(r.expired)stopAccess();}catch{video.pause();message('수강 권한을 확인하지 못했습니다. 연결을 확인해 주세요.');}},60000);
  document.querySelectorAll('a[href="classroom.html"]').forEach(a=>a.addEventListener('click',async e=>{e.preventDefault();if(busy)return;video.pause();if(await save()===false)return;if(await noteEditor.flush())location.href=a.href;else message('메모 저장을 확인한 뒤 이동할 수 있습니다. 아래 내 메모의 저장 상태를 확인해 주세요.');}));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)save();});
 }
 window.addEventListener('pageshow',e=>{if(e.persisted){if(page==='catalog'){busy=false;$('#purchase-button').disabled=false;recover();}else location.reload();}});
 window.addEventListener('pagehide',()=>{if(video)video.pause();});
 async function init(){try{if(!window.MONC?.sb)throw {code:'not_ready'};if(page==='catalog')await catalog();if(page==='library')await loadLibrary();if(page==='watch')await watch();MONC.sb.auth?.onAuthStateChange((event,s)=>{if(session&&(!s||s.user.id!==session.user.id)){if(video){video.pause();video.removeAttribute('src');}location.reload();}});}catch(e){message(errorText(e));if($('#course-library'))$('#course-library').innerHTML='<p class="oc-empty">강의실을 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.</p>';if($('#oc-start'))$('#oc-start').disabled=true;}}
 init();
})();
