/* 과제 원문은 제출 버전으로 고정한다. 자동 저장은 초안만, 공개된 피드백은 수정하지 않는다. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id), desk=$('academy').dataset.mode==='teacher';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={draft:'작성 중',submitted:'피드백 대기',revision_requested:'수정 요청',approved:'완료',text:'글',video:'영상',audio:'음성'};
  const date=s=>s?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(s)):'';
  const msg=(text,error=false,id='acMessage')=>{const el=$(id);if(el){el.textContent=text;el.classList.toggle('ac-error',error);}};
  let boot,user,offset=0,current=null,dirty=false,blocked=false,timer,saveTail=Promise.resolve(),uploadTicket=null,uploadedId=null,resumeUpload=null,recorder=null,recordStream=null,busyUpload=false,submitRequest=null;
  const friendly=e=>/PGRST202|PGRST205|42P01/.test(e.code||'')?'수업 기능을 준비하고 있어요. 등록이 끝나면 이용할 수 있어요.':
    /conflict|40001|new_version/.test((e.code||'')+' '+e.message)?'다른 화면에서 기록이 바뀌었어요. 입력한 글을 복사한 뒤 최신 기록을 다시 불러와 주세요.':
    /42501|forbidden|read_only/.test((e.code||'')+' '+e.message)?'이 작업을 할 권한이 없거나 제출 가능한 기간이 지났어요.':
    /empty_feedback/.test(e.message)?'피드백을 작성해 주세요.':/empty_body/.test(e.message)?'제출할 글을 작성해 주세요.':
    /published_review/.test(e.message)?'이미 전달한 피드백은 수정할 수 없어요.':/invalid_quote/.test(e.message)?'선택한 문장이 원문과 일치하는지 확인해 주세요.':
    '처리하지 못했어요. 입력 내용은 그대로 두었으니 다시 시도해 주세요.';
  async function api(action,p={}){const {data,error}=await MONC.sb.rpc('academy_api',{p_action:action,p});if(error)throw error;return data;}
  async function guarded(fn,target='acMessage'){
    try{await fn();}catch(e){msg(friendly(e),true,target);return false;}return true;
  }
  const backupKey=()=>current?'monc_academy_draft:'+user+':'+current.work.id+(desk?':review':''):null;
  function backup(){try{if(current)sessionStorage.setItem(backupKey(),JSON.stringify({revision:current.work.revision,body:$('acBody')?.value,feedback:$('acFeedback')?.value}));}catch(_){} }
  function clearBackup(){try{sessionStorage.removeItem(backupKey());}catch(_){} }
  function changed(){dirty=true;backup();msg('저장 중…',false,'acSaveStatus');clearTimeout(timer);timer=setTimeout(()=>{flush().catch(()=>{});},1000);}
  function mine(){return current?.versions[0]?.reviews.find(x=>x.author_id===user)||null;}
  function reviewPayload(){return {work_id:current.work.id,version_id:current.versions[0].id,revision:current.work.revision,
    review_revision:mine()?.revision||0,body:$('acFeedback').value,suggestion:'',notes:[]};}
  async function flush(){
    clearTimeout(timer);
    const run=async()=>{
      if(!dirty||!current)return;
      if(blocked)throw new Error('conflict');
      const cid=current.work.id,body=$('acBody')?.value,payload=desk?reviewPayload():null;
      msg('저장 중…',false,'acSaveStatus');
      try{
        const r=await api(desk?'review_save':'draft',desk?payload:{work_id:cid,revision:current.work.revision,body});
        if(!current||current.work.id!==cid)return;
        if(desk){let m=mine();if(!m){m={author_id:user};current.versions[0].reviews.push(m);}Object.assign(m,{revision:r.review_revision,body:payload.body,suggestion:payload.suggestion,notes:payload.notes});}
        else {current.work.revision=r.revision;current.work.draft=body;}
        dirty=desk?JSON.stringify(reviewPayload())!==JSON.stringify({...payload,review_revision:r.review_revision}):$('acBody').value!==body;
        if(!dirty)clearBackup();else backup();
        msg(dirty?'추가 변경을 저장하고 있어요.':'저장됨',false,'acSaveStatus');
        if(dirty)timer=setTimeout(()=>{flush().catch(()=>{});},300);
      }catch(e){
        blocked=/conflict|40001|new_version/.test((e.code||'')+' '+e.message);
        msg(friendly(e),true,'acSaveStatus');throw e;
      }
    };
    saveTail=saveTail.catch(()=>{}).then(run);return saveTail;
  }
  async function fillBoot(){
    boot=await api('bootstrap');
    if(desk&&!boot.teacher){msg('담당 수업이 등록된 선생님만 이용할 수 있어요.',true);return false;}
    if(!desk)$('acDeskLink').hidden=!boot.teacher;
    if(desk){
      const prev=$('acCourse').value;
      $('acCourse').innerHTML=boot.courses.filter(x=>x.can_teach).map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('');
      if(boot.courses.some(x=>x.id===prev))$('acCourse').value=prev;
      $('acAdmin').hidden=!boot.admin;
    }else{
      $('acEnrollment').innerHTML=boot.enrollments.map(e=>`<option value="${esc(e.id)}">${esc(boot.courses.find(c=>c.id===e.course_id)?.title||'수업')}${e.status==='completed'?' · 수료':''}</option>`).join('');
    }
    $('acList').hidden=false;msg('');return true;
  }
  async function list(){
    const id=desk?$('acCourse').value:$('acEnrollment').value;
    if(!id){$('acTasks').innerHTML='<li class="ac-muted">등록된 수업이 없어요. 수강 등록 여부를 확인해 주세요.</li>';$('acNext').disabled=true;$('acPrevious').disabled=true;return;}
    const r=await api(desk?'queue':'tasks',desk?{course_id:id,state:$('acFilter').value,offset}:{enrollment_id:id,offset});
    $('acTasks').innerHTML=r.items.length?r.items.map((t,i)=>`<li><button type="button" class="ac-task" data-task="${i}"><span class="ac-status">${esc(labels[t.state])} · ${esc(labels[t.kind])}</span><strong>${esc(t.title)}</strong><span class="ac-muted">${desk?esc(t.display_name)+' · 최근 변경 '+date(t.updated_at):'마감 '+date(t.due_at)}</span></button></li>`).join(''):'<li class="ac-muted">'+(desk?'이 상태의 제출물이 없어요.':'등록된 과제가 없어요.')+'</li>';
    $('acPrevious').disabled=offset===0;$('acNext').disabled=r.items.length<30;
    $('acTasks').querySelectorAll('[data-task]').forEach(b=>b.onclick=()=>guarded(()=>open(r.items[Number(b.dataset.task)].task_id||r.items[Number(b.dataset.task)].id,desk?r.items[Number(b.dataset.task)].enrollment_id:id)));
  }
  async function open(taskId,enrollmentId){
    await flush();stopRecording();
    const data=await api('open',{task_id:taskId,enrollment_id:enrollmentId});
    current=data;current.enrollment_id=enrollmentId;dirty=false;blocked=false;uploadedId=null;uploadTicket=null;resumeUpload=null;submitRequest=null;
    $('acList').hidden=true;$('acEditor').hidden=false;msg('');renderEditor();$('acEditor').scrollIntoView({block:'start'});
  }
  // 이전 형식의 의견도 한 피드백으로 읽을 수 있게 합친다.
  function feedbackText(r){
    return [r?.body,r?.suggestion,...(r?.notes||[]).map(n=>[n.quote,n.comment].filter(Boolean).join('\n'))].filter(Boolean).join('\n\n');
  }
  function publishedHtml(v){
    return (v?.reviews||[]).filter(r=>r.published_at).map(r=>`<article class="ac-review"><h3>피드백 · ${esc(r.author_name||'선생님')}</h3><span class="ac-meta">${esc(date(r.published_at))} · ${esc(labels[r.decision])}</span><p>${esc(feedbackText(r))}</p></article>`).join('');
  }
  function renderEditor(){
    const {task:t,work:w,versions:vs}=current,v=vs[0],canEdit=!desk&&current.writable&&['draft','revision_requested'].includes(w.state);
    const r=mine();
    const canReview=desk&&vs.length&&!r?.published_at;
    $('acEditor').innerHTML=`<div class="ac-actions"><button id="acBack" type="button">← 과제 목록</button></div><div class="ac-card"><span class="ac-status">${esc(labels[w.state])} · ${esc(labels[t.kind])}</span><h1>${esc(t.title)}</h1><p class="ac-meta">${desk?esc(current.student)+' · ':''}마감 ${esc(date(t.due_at))}</p><p class="ac-prompt">${esc(t.prompt)}</p></div>
      <div class="${desk?'ac-split':''}"><div>
      ${vs.length?`<div class="ac-card"><h2>제출</h2><p class="ac-meta">${esc(date(v.submitted_at))}${v.late?' · 지각':''}</p><label for="acSource">학생 원문</label><textarea id="acSource" class="ac-source" readonly>${esc(v.body)}</textarea>${v.media?`<div class="ac-file"><p>${esc(v.media.name)}</p><p class="ac-meta">${esc(date(v.media.expires_at))}까지 보관</p><div id="acPlayer"><button type="button" id="acPlay">제출 파일 열기</button></div></div>`:''}${publishedHtml(v)}</div>`:''}
      ${!desk?`<div class="ac-card"><h2>${canEdit?(w.state==='revision_requested'?'피드백을 반영해 수정하기':'과제 작성'):'제출 상태'}</h2>${canEdit?`<label for="acBody">${t.kind==='text'?'내 글':'함께 남길 글 · 선택'}</label><textarea id="acBody" maxlength="30000">${esc(w.draft)}</textarea>${t.kind!=='text'?`<div class="ac-file"><label for="acFile">${esc(labels[t.kind])} 파일 · 최대 50MB</label><input id="acFile" type="file" accept="${esc(t.kind)}/*"><p class="ac-meta">영상·음성은 업로드일부터 2개월 보관해요.</p>${t.kind==='audio'?'<div class="ac-actions"><button id="acRecord" type="button">음성 녹음 시작</button><button id="acStopRecord" type="button" disabled>녹음 종료</button></div>':''}<progress id="acProgress" max="100" value="0" aria-label="파일 업로드 진행률" hidden></progress><p id="acUploadStatus" class="ac-notice" role="status"></p><button id="acRetryUpload" type="button" hidden>업로드 다시 시도</button></div>`:''}<p id="acSaveStatus" class="ac-notice" role="status" aria-live="polite">저장됨</p><div class="ac-actions"><button id="acSave" type="button">임시 저장</button><button id="acSubmit" class="ac-primary" type="button">제출</button></div>`:`<p class="ac-muted">${w.state==='submitted'?'선생님이 확인 중이에요. 피드백이 도착하면 이곳에서 확인할 수 있어요.':w.state==='approved'?'피드백이 완료됐어요. 원문과 피드백은 위 기록에서 확인할 수 있어요.':'수강 기간이 끝나 과거 기록만 확인할 수 있어요.'}</p>`}</div>`:''}
      </div>${desk?`<div class="ac-card"><h2>피드백</h2>${canReview?`<label for="acFeedback">피드백</label><textarea id="acFeedback" maxlength="16000">${esc(feedbackText(r))}</textarea><p id="acSaveStatus" class="ac-notice" role="status" aria-live="polite">${r?'임시 저장된 피드백':'학생에게 전달하기 전까지 선생님만 볼 수 있어요.'}</p><div class="ac-actions"><button id="acSave" type="button">임시 저장</button><button id="acRevision" type="button">수정 요청 전달</button><button id="acApprove" class="ac-primary" type="button">피드백 전달</button></div>`:'<p class="ac-muted">학생에게 피드백을 전달했어요.</p>'}</div>`:''}</div>`;
    $('acBack').onclick=()=>guarded(async()=>{if(busyUpload||recorder?.state==='recording'){msg('업로드 또는 녹음이 끝난 뒤 이동해 주세요.',true);return;}await flush();stopRecording();current=null;dirty=false;$('acEditor').hidden=true;$('acList').hidden=false;await list();});
    if($('acPlay'))$('acPlay').onclick=()=>guarded(async()=>{
      const data=await MONC_MEDIA.read(v.media.id);
      if(data.expired){$('acPlayer').textContent='보관기간이 끝나 파일을 재생할 수 없어요. 제출 기록과 피드백은 남아 있어요.';return;}
      const el=document.createElement(t.kind==='video'?'video':'audio');el.controls=true;el.preload='none';el.src=data.url;$('acPlayer').replaceChildren(el);
    });
    if(canEdit){
      $('acBody').oninput=changed;$('acSave').onclick=()=>guarded(flush,'acSaveStatus');
      $('acSubmit').onclick=()=>guarded(submit,'acSaveStatus');
      if($('acFile'))$('acFile').onchange=()=>{const f=$('acFile').files[0];if(f)upload(f);};
      if($('acRecord')){$('acRecord').onclick=()=>guarded(record,'acUploadStatus');$('acStopRecord').onclick=()=>stopRecording();}
    }
    if(canReview){
      $('acFeedback').oninput=changed;
      $('acSave').onclick=()=>guarded(flush,'acSaveStatus');
      $('acRevision').onclick=()=>guarded(()=>publish('revision_requested'),'acSaveStatus');
      $('acApprove').onclick=()=>guarded(()=>publish('approved'),'acSaveStatus');
    }
    if(canEdit||canReview){
      let kept;try{kept=JSON.parse(sessionStorage.getItem(backupKey()));}catch(_){}
      if(kept){
        const b=document.createElement('button');b.type='button';b.textContent='저장되지 않은 입력 복원';b.onclick=()=>{
          if(canEdit)$('acBody').value=kept.body||'';
          else $('acFeedback').value=feedbackText({body:kept.feedback,suggestion:kept.suggestion,notes:kept.notes});
          b.remove();changed();
        };$('acSaveStatus').after(b);
      }
    }
  }
  async function submit(){
    if(busyUpload||recorder?.state==='recording')throw new Error('upload_busy');
    if(current.task.kind!=='text'&&!uploadedId){msg('영상·음성 파일을 먼저 업로드해 주세요.',true,'acSaveStatus');return;}
    $('acSubmit').disabled=true;
    try{
      await flush();submitRequest=submitRequest||crypto.randomUUID();
      await api('submit',{work_id:current.work.id,revision:current.work.revision,body:$('acBody').value,media_id:uploadedId,request_id:submitRequest});
      clearBackup();dirty=false;await open(current.task.id,current.enrollment_id);msg('과제를 제출했어요.');
    }finally{if($('acSubmit'))$('acSubmit').disabled=false;}
  }
  async function publish(decision){
    $('acApprove').disabled=true;$('acRevision').disabled=true;
    try{await flush();await api('review_publish',{...reviewPayload(),decision});clearBackup();dirty=false;await open(current.task.id,current.enrollment_id);msg('학생에게 피드백을 전달했어요.');}
    finally{if($('acApprove')){$('acApprove').disabled=false;$('acRevision').disabled=false;}}
  }
  async function upload(file){
    if(busyUpload)return;
    if(!file.size||file.size>50*1024*1024||!file.type.startsWith(current.task.kind+'/')){msg('종류에 맞는 50MB 이하 파일을 선택해 주세요.',true,'acUploadStatus');return;}
    uploadedId=null;uploadTicket=null;resumeUpload=null;
    async function attempt(){
      busyUpload=true;$('acFile').disabled=true;$('acRetryUpload').hidden=true;$('acProgress').hidden=false;
      msg('파일을 업로드하고 있어요.',false,'acUploadStatus');
      try{
        uploadTicket=uploadTicket||await MONC_MEDIA.prepare(current.work.id,file);
        if(resumeUpload){await resumeUpload();resumeUpload=null;}
        else if(!uploadTicket.uploaded){await MONC_MEDIA.upload(uploadTicket,file,n=>{$('acProgress').value=n;});}
        uploadTicket.uploaded=true;
        const result=await MONC_MEDIA.finish(uploadTicket.id);uploadedId=result.id;
        msg(file.name+' · 업로드 완료. 아래 제출 버튼을 눌러 주세요.',false,'acUploadStatus');
      }catch(e){if(e.resume)resumeUpload=e.resume;msg(e.message||'업로드를 완료하지 못했어요.',true,'acUploadStatus');$('acRetryUpload').hidden=false;$('acRetryUpload').onclick=attempt;}
      finally{busyUpload=false;$('acFile').disabled=false;}
    }
    await attempt();
  }
  async function record(){
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){msg('이 브라우저에서는 녹음 파일을 선택해 올려 주세요.',true,'acUploadStatus');return;}
    recordStream=await navigator.mediaDevices.getUserMedia({audio:true});
    const mime=['audio/mp4','audio/webm;codecs=opus','audio/ogg;codecs=opus'].find(x=>MediaRecorder.isTypeSupported(x));
    recorder=new MediaRecorder(recordStream,mime?{mimeType:mime}:undefined);const chunks=[];
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{const type=recorder.mimeType;const f=new File(chunks,'과제-녹음.'+(type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm'),{type});recordStream.getTracks().forEach(t=>t.stop());$('acRecord').disabled=false;$('acStopRecord').disabled=true;upload(f);};
    recorder.start();$('acRecord').disabled=true;$('acStopRecord').disabled=false;msg('녹음 중이에요. 끝나면 녹음 종료를 눌러 주세요.',false,'acUploadStatus');
  }
  function stopRecording(){if(recorder?.state==='recording')recorder.stop();}
  async function formWork(form,fn,target){const buttons=form.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);try{await guarded(fn,target);}finally{buttons.forEach(b=>b.disabled=false);}}
  function setupDesk(){
    $('acCourse').onchange=()=>guarded(async()=>{offset=0;await list();});$('acFilter').onchange=$('acCourse').onchange;
    $('acTaskForm').onsubmit=ev=>{ev.preventDefault();formWork(ev.currentTarget,async()=>{
      if(!$('acCourse').value)throw new Error('no_course');
      await api('create_task',{course_id:$('acCourse').value,title:$('acTaskTitle').value,prompt:$('acTaskPrompt').value,kind:$('acTaskKind').value,due_at:$('acTaskDue').value+':00+09:00'});
      msg('과제를 등록했어요. 학생의 내 수업에 표시됩니다.',false,'acTaskMessage');$('acTaskForm').reset();
    },'acTaskMessage');};
    $('acCourseForm').onsubmit=ev=>{ev.preventDefault();formWork(ev.currentTarget,async()=>{await api('create_course',{title:$('acNewCourse').value});await fillBoot();await list();msg('수업을 만들었어요.',false,'acAdminMessage');},'acAdminMessage');};
    $('acMemberSearch').onsubmit=ev=>{ev.preventDefault();formWork(ev.currentTarget,async()=>{const r=await api('members',{query:$('acSearch').value});$('acMember').innerHTML=r.items.map(m=>`<option value="${esc(m.id)}">${esc(m.name)} · ${esc(m.email)}</option>`).join('');$('acStudentName').value=r.items[0]?.name||'';msg(r.items.length?'이름과 이메일을 확인하고 연결해 주세요.':'일치하는 가입 회원이 없어요.',false,'acAdminMessage');},'acAdminMessage');};
    $('acEnrollForm').onsubmit=ev=>{ev.preventDefault();formWork(ev.currentTarget,async()=>{await api('enroll',{course_id:$('acCourse').value,member_id:$('acMember').value,name:$('acStudentName').value,starts_on:$('acStart').value,ends_on:$('acEnd').value});msg('학생을 등록했어요. 기존 무료 혜택 설정은 그대로입니다.',false,'acAdminMessage');},'acAdminMessage');};
    for(const [id,enabled] of [['acAddTeacher',true],['acRemoveTeacher',false]])$(id).onclick=()=>guarded(async()=>{if(!$('acMember').value||!$('acCourse').value)throw new Error('selection_required');await api('set_staff',{course_id:$('acCourse').value,member_id:$('acMember').value,enabled});msg(enabled?'선택한 수업의 선생님 권한을 부여했어요.':'선택한 수업의 선생님 권한을 해제했어요.',false,'acAdminMessage');},'acAdminMessage');
  }
  window.addEventListener('beforeunload',e=>{if(dirty||busyUpload||recorder?.state==='recording'){backup();e.preventDefault();e.returnValue='';}});
  window.addEventListener('pagehide',()=>{if(recordStream)recordStream.getTracks().forEach(t=>t.stop());});
  async function init(){
    const session=await MONC.requireSession();if(!session||!(await MONC.requireConsent()))return;user=session.user.id;
    if(!await fillBoot())return;
    if(desk){setupDesk();if(boot.admin){const usage=await api('media_usage');$('acUsage').textContent='수업·챌린지 미디어 '+(usage.bytes/1e9).toFixed(2)+'GB · 삭제 대기 '+usage.expired+'개 · 삭제 실패 '+usage.failed+'개';}}
    else $('acEnrollment').onchange=()=>guarded(async()=>{offset=0;await list();});
    $('acPrevious').onclick=()=>guarded(async()=>{offset=Math.max(0,offset-30);await list();});$('acNext').onclick=()=>guarded(async()=>{offset+=30;await list();});
    await list();
  }
  guarded(init);
})();
