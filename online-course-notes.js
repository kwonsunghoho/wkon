/* 본인 강의 필기. 공개 저장소·브라우저 저장소에 필기 내용을 남기지 않는다. */
(() => {
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const time=v=>{v=Math.max(0,Math.floor(v||0));return String(Math.floor(v/60)).padStart(2,'0')+':'+String(v%60).padStart(2,'0');};
 async function api(action,args={}){
  const r=await MONC.sb.functions.invoke('online-course',{body:{action,...args}});
  if(r.error||!r.data?.ok)throw Object.assign(new Error(''),{code:r.data?.error||'network'});
  return r.data;
 }
 const error=e=>e.code==='note_conflict'?'다른 화면에서 수정된 메모가 있습니다. 작성 내용을 복사한 뒤 최신 메모를 불러오세요.':'저장하지 못했습니다. 작성 내용은 이 화면에 남아 있습니다. 다시 저장해 주세요.';
 function editor(root,{ownerId,getTime,onJump,onSaved}){
  let lesson=null,pendingLesson=null,revision=0,saved='',timer,promise=null,loading=false,closed=false;
  root.innerHTML=`<div class="oc-note-heading"><strong>내 메모</strong><span>나만 볼 수 있어요</span></div><p class="oc-note-lesson"></p><label class="oc-note-label">강의 필기<textarea class="oc-note-body" maxlength="12000" rows="9" placeholder="기억할 내용과 연습할 부분을 적어두세요." disabled></textarea></label><div class="oc-note-tools"><button type="button" data-note="time" ${getTime?'':'hidden'}>현재 시간 넣기</button><button type="button" data-note="save">저장</button><span class="oc-note-count">0 / 12,000</span></div><p class="oc-note-status" role="status">메모를 불러오고 있습니다.</p><div class="oc-note-times" aria-label="메모한 영상 구간"></div><button type="button" class="oc-note-reload" data-note="reload" hidden>최신 메모 불러오기</button>`;
  const box=root.querySelector('textarea'),status=root.querySelector('.oc-note-status'),reload=root.querySelector('[data-note=reload]');
  const replacePrompt=document.createElement('div');replacePrompt.className='oc-note-replace';replacePrompt.hidden=true;
  replacePrompt.innerHTML='<p>작성 중인 내용을 복사해 두셨나요? 최신 메모로 바꾸면 이 화면의 미저장 내용은 사라집니다.</p><button type="button" data-note="replace">최신 메모로 바꾸기</button><button type="button" data-note="cancel-replace">계속 작성</button>';root.append(replacePrompt);
  const dirty=()=>!!lesson&&!loading&&box.value!==saved;
  function renderTimes(){
   root.querySelector('.oc-note-count').textContent=box.value.length.toLocaleString('ko-KR')+' / 12,000';
   const times=[...box.value.matchAll(/\[(\d{1,4}):([0-5]\d)\]/g)].map(m=>Number(m[1])*60+Number(m[2])).filter((x,i,a)=>x<lesson?.duration&&a.indexOf(x)===i);
   root.querySelector('.oc-note-times').innerHTML=times.map(s=>`<button type="button" data-note-time="${s}" ${onJump?'':'disabled'}>${time(s)} 구간 보기</button>`).join('');
  }
  async function flush(){
   clearTimeout(timer);
   if(closed||loading)return false;
   if(promise){const ok=await promise;return ok&&dirty()?flush():ok;}
   if(!dirty())return true;
   const body=box.value,id=lesson.id;
   status.textContent='저장 중…';reload.hidden=true;
   promise=(async()=>{
    try{
     const session=await MONC.getSession();if(session?.user.id!==ownerId)throw {code:'account_changed'};
     const r=await api('note-save',{lessonId:id,body,revision});
     if(closed)return false;
     revision=r.note.revision;saved=body;status.textContent='자동 저장됨';onSaved?.(body);return true;
    }catch(e){status.textContent=error(e);reload.hidden=e.code!=='note_conflict';return false;}
   })();
   const ok=await promise;promise=null;
   return ok&&dirty()?flush():ok;
  }
  async function select(next,initial){
   if(loading||closed)return false;
   if(!await flush())return false;
   if(loading||closed)return false;
   loading=true;pendingLesson=next;box.disabled=true;
   status.textContent='메모를 불러오고 있습니다.';
   try{const n=initial||(await api('notes',{lessonId:next.id})).notes[0];if(closed)return false;
    lesson=next;pendingLesson=null;root.querySelector('.oc-note-lesson').textContent=next.title;
    box.value=n?.body||'';saved=box.value;revision=n?.revision||0;box.disabled=false;status.textContent=saved?'자동 저장됨':'입력하면 자동으로 저장됩니다.';reload.hidden=true;renderTimes();
   }catch{pendingLesson=lesson||next;box.disabled=!lesson;status.textContent='메모를 불러오지 못했습니다. 최신 메모 불러오기를 눌러 주세요.';reload.hidden=false;return false;}
   finally{loading=false;}
   return true;
  }
  box.addEventListener('input',()=>{renderTimes();status.textContent='저장 대기 중…';clearTimeout(timer);timer=setTimeout(flush,700);});
  root.addEventListener('click',async e=>{
   const b=e.target.closest('button');if(!b||closed)return;
   if(b.dataset.note==='save'){await flush();return;}
   if(b.dataset.note==='reload'){
    if(dirty()){replacePrompt.hidden=false;return;}
    await select(pendingLesson||lesson);return;
   }
   if(b.dataset.note==='cancel-replace'){replacePrompt.hidden=true;box.focus();return;}
   if(b.dataset.note==='replace'){replacePrompt.hidden=true;const previous=saved;saved=box.value;if(!await select(pendingLesson||lesson))saved=previous;return;}
   if(b.dataset.note==='time'&&!box.disabled){const seconds=getTime?.();if(!Number.isFinite(seconds)){status.textContent='영상을 먼저 재생하면 현재 시간을 넣을 수 있습니다.';return;}
    const start=box.selectionStart,end=box.selectionEnd,text='['+time(seconds)+'] ';
    if(box.value.length-end+start+text.length>12000)return;
    box.setRangeText(text,start,end,'end');box.dispatchEvent(new Event('input'));box.focus();return;
   }
   if(b.dataset.noteTime!==undefined&&await flush())onJump?.(Number(b.dataset.noteTime));
  });
  const unload=e=>{if(dirty()){e.preventDefault();e.returnValue='';}},hide=()=>{if(document.hidden)flush();},online=()=>flush();
  window.addEventListener('beforeunload',unload);document.addEventListener('visibilitychange',hide);window.addEventListener('online',online);
  const sub=MONC.sb.auth?.onAuthStateChange((event,s)=>{if(!s||s.user.id!==ownerId){closed=true;clearTimeout(timer);box.value='';box.disabled=true;saved='';status.textContent='계정이 바뀌었습니다. 새로고침해 주세요.';}});
  return {select,flush,dirty,destroy(){closed=true;clearTimeout(timer);window.removeEventListener('beforeunload',unload);document.removeEventListener('visibilitychange',hide);window.removeEventListener('online',online);sub?.data?.subscription?.unsubscribe();root.replaceChildren();}};
 }
 async function mountMyPage(ownerId){
  const root=document.querySelector('#onlineLearning');if(!root)return;
  let closed=false;
  MONC.sb.auth?.onAuthStateChange((_event,s)=>{if(!s||s.user.id!==ownerId){closed=true;root.replaceChildren();root.hidden=true;}});
  try{
   const r=await api('notes'),notes=r.notes.filter(n=>n.body.trim());if(closed||(await MONC.getSession())?.user.id!==ownerId||!r.hasCourses&&!notes.length)return;
   root.hidden=false;
   root.innerHTML=`<div class="oc-my-heading"><div><h2>온라인 강의 · 내 메모</h2><p>강의에서 남긴 필기를 다시 펼쳐보세요.</p></div><a href="classroom.html">내 강의실 →</a></div>${notes.length?`<label class="oc-note-filter">강의 찾기<input type="search" placeholder="강의명 또는 메모 내용" aria-label="강의 메모 검색"></label><div class="oc-my-notes">${notes.map((n,i)=>`<details class="oc-my-note" data-note-index="${i}"><summary><span><small>${esc(n.courseTitle)}</small><strong>${esc(n.lessonTitle)}</strong><span class="oc-my-preview">${esc(n.body.slice(0,110))}</span></span><span aria-hidden="true">＋</span></summary><div class="oc-note-editor"></div>${n.enrollmentId?'':'<p class="oc-note-retained">수강이 끝나도 내 메모는 계속 확인하고 수정할 수 있습니다.</p>'}</details>`).join('')}</div>`:'<p class="oc-note-empty">아직 작성한 메모가 없습니다. 강의를 보면서 기억할 내용을 적어보세요.</p>'}`;
   root.querySelectorAll('details').forEach(detail=>{
    let mounted=false;detail.addEventListener('toggle',()=>{if(!detail.open||mounted)return;mounted=true;const n=notes[Number(detail.dataset.noteIndex)];
     const ed=editor(detail.querySelector('.oc-note-editor'),{ownerId,onSaved:body=>{n.body=body;detail.querySelector('.oc-my-preview').textContent=body.slice(0,110)||'내용이 없는 메모';},onJump:n.enrollmentId?seconds=>{location.href='classroom-watch.html?enrollment='+encodeURIComponent(n.enrollmentId)+'&lesson='+encodeURIComponent(n.lessonId)+'&at='+seconds;}:null});
     ed.select({id:n.lessonId,title:n.lessonTitle,duration:n.duration},n);
    });
   });
   root.querySelector('input')?.addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();root.querySelectorAll('details').forEach(d=>{const n=notes[Number(d.dataset.noteIndex)];d.hidden=!(n.courseTitle+' '+n.lessonTitle+' '+n.body).toLowerCase().includes(q);});});
  }catch{if(closed)return;root.hidden=false;root.innerHTML='<div class="oc-my-heading"><h2>온라인 강의 · 내 메모</h2><a href="classroom.html">내 강의실 →</a></div><p class="oc-note-empty">메모를 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.</p>';}
 }
 window.MONCCourseNotes={editor,mountMyPage};
})();
