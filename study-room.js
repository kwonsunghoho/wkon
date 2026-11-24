(function roomApp() {
  'use strict';
  const root = document.getElementById('room');
  const editor = document.getElementById('editor');
  const form = document.getElementById('task-form');
  const params = new URLSearchParams(location.search);
  const roomId = params.get('id');
  const fromLog = params.get('tab') === 'log';
  const back = fromLog ? '<a class="back" href="mypage.html#sec-study-log">마이페이지 · 내 기록</a>' : `<a class="back" href="community.html?view=study&amp;id=${encodeURIComponent(roomId||'')}">스터디 모집글</a>`;
  const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const id = () => crypto.randomUUID();
  const modes = {text:'글쓰기', record:'직접 녹음', file:'파일 첨부'};
  const tabs = {task:'이번 과제',team:'팀원 답변',log:'내 성장일지'};
  const fmt = s => new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
  const button = (cmd,label,attrs='') => `<button type="button" data-cmd="${cmd}" ${attrs}>${label}</button>`;
  const drafts = new Map();
  let uid, room, taskId, tab=fromLog?'log':'task', peerId, editId, requestId, busy=false, recorder, mic, micTicket=0;
  let message='', error='', started=false;
  const task = () => room.tasks.find(t=>t.id===taskId);
  const mine = t => t?.answers.find(a=>a.mine);
  function draft(){
    if(!drafts.has(taskId)) drafts.set(taskId,{mode:'text',text:'',file:null,url:null,id:id()});
    return drafts.get(taskId);
  }
  function clearDraft(d){if(d?.url) URL.revokeObjectURL(d.url);}
  function stopMic(){
    micTicket++;
    if(recorder){recorder.onstop=null;if(recorder.state!=='inactive') recorder.stop();recorder=null;}
    mic?.getTracks().forEach(t=>t.stop());mic=null;
  }
  async function rpc(action,data={}){
    const res=await MONC.sb.rpc('study_room',{p_room:roomId,p_action:action,p_data:data});
    if(res.error) throw res.error;
    return res.data;
  }
  function human(e){
    const s=String(e?.message||'');
    if(/forbidden|login_required|42501/.test(s))return '이 스터디의 승인된 참여자만 이용할 수 있습니다.';
    if(/deadline/.test(s))return '제출 마감 시간이 지났습니다.';
    if(/already_submitted|duplicate key/.test(s))return '제출된 답변이 있습니다. 새로고침해서 확인해 주세요.';
    return e?.userMessage||'처리하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.';
  }
  async function refresh(){
    const data=await rpc('read');
    if(!started)return;
    room=data;
    if(!task()){
      const next=room.tasks.find(t=>!mine(t)&&Date.parse(t.due)>Date.now());
      const latest=room.tasks.at(-1);
      taskId=(tab==='log'?latest:(next||latest))?.id;
    }
    render();
  }
  function notice(text){return `<p role="status">${esc(text)}</p>`;}
  function history(before){
    return room.tasks.filter(t=>t.week<before).flatMap(t=>(mine(t)?.notes||[]).map(n=>({...n,week:t.week})));
  }
  function notes(list){
    return list.map(n=>`<div class="note"><b>${esc(n.name)}</b>${n.week?` · ${n.week}주차`:''}<p>${esc(n.body)}</p></div>`).join('');
  }
  function asset(a){
    if(a.body!=null)return `<p class="answer">${esc(a.body)}</p>`;
    return `<div data-asset="${esc(a.id)}"><p>${esc(a.file_name)}</p><div class="actions">${button('file-open','첨부 열기',`data-id="${esc(a.id)}"`)}</div><div class="media"></div></div>`;
  }
  function homework(t){
    const a=mine(t);
    if(a)return `<h3>내가 제출한 답변</h3>${asset(a)}<hr><h3>받은 피드백</h3>${notes(a.notes)||notice('팀원의 첫 피드백을 기다리고 있어요.')}`;
    if(room.status==='ended'||Date.parse(t.due)<=Date.now())return notice('제출이 마감되었습니다.');
    const d=draft(),previous=history(t.week).at(-1);
    const tip=previous?`<blockquote><b>지난 ${previous.week}주차에 받은 피드백</b><p>${esc(previous.body)}</p></blockquote>`:'';
    let input;
    if(d.mode==='text')input=`<label>답변 또는 키워드<textarea id="body" maxlength="10000" placeholder="답변 방향이나 핵심 키워드를 적어주세요.">${esc(d.text)}</textarea></label>`;
    else if(d.mode==='record')input=`<div class="actions">${button(recorder?'stop':'record',recorder?'녹음 마치기':'녹음 시작')}</div>`;
    else input=`<label>사진·영상·녹음·문서 (최대 40MB)<input id="upload" type="file" accept="audio/*,video/*,.png,.jpg,.jpeg,.webp,.gif,.avif,.heic,.heif,.pdf,.docx,.hwp,.hwpx,.txt"></label>`;
    const file=d.mode==='text'?null:d.file;
    return `${tip}<h3>내 과제 제출</h3><div class="modes">${Object.entries(modes).map(([k,v])=>button('mode',v,`data-mode="${k}" aria-pressed="${k===d.mode}"`)).join('')}</div>${input}
      ${file?`<p>${esc(file.name)}</p>${file.type.startsWith('audio/')?`<audio controls src="${esc(d.url)}"></audio>`:''}`:''}
      <div class="actions">${button('send',d.mode==='text'?'글 제출':'답변 제출',`class="primary" ${d.mode!=='text'&&(!file||recorder)?'disabled':''}`)}</div>`;
  }
  function panel(t){
    if(!t)return notice(room.role==='owner'?'첫 과제를 등록해 주세요.':'조장이 첫 과제를 올리면 여기에 표시됩니다.');
    if(tab==='task')return `<p class="meta">${t.week}주차 면접 연습 질문</p><h2>${esc(t.question)}</h2><p class="muted">${esc(fmt(t.due))} 마감</p><hr>${homework(t)}`;
    if(tab==='log'){
      const list=history(t.week+1);
      return `<p class="meta">나만 보기</p><h2>내 성장일지</h2><p>${t.week}주차까지 받은 피드백 ${list.length}개</p>${notes(list)||notice('내 제출물에 달린 피드백이 여기에 모입니다.')}`;
    }
    const a=t.answers.find(a=>a.id===peerId)||t.answers.find(a=>!a.mine)||t.answers[0];
    if(!a)return '<h2>팀원 답변</h2>'+notice('이번 주에 제출한 답변이 없습니다.');
    peerId=a.id;
    return `<h2>팀원 답변</h2><label>확인할 답변<select id="peer">${t.answers.map(v=>`<option value="${esc(v.id)}" ${v.id===a.id?'selected':''}>${esc(v.name)}${v.mine?' (나)':''}</option>`).join('')}</select></label>
      ${asset(a)}<hr><h3>한 줄 피드백</h3>${notes(a.notes)||notice('아직 남긴 피드백이 없습니다.')}
      ${!a.mine&&room.status!=='ended'?`<form id="note"><label>이 답변에서 어떤 점이 궁금했나요?<textarea name="body" maxlength="300" required></textarea></label><button class="primary">피드백 남기기</button></form>`:''}`;
  }
  function render(){
    if(!room)return;
    const t=task(),canEdit=room.role==='owner'&&room.status!=='ended';
    root.innerHTML=`<header><div class="wrap">${back}<p class="meta">우리 스터디</p><h1>${esc(room.title)}</h1>
      <p class="muted">${room.members.length}명 참여 · ${esc(room.schedule)}</p>
      ${t?`<div class="picker" role="group" aria-label="주차 선택"><b>주차 선택</b>${room.tasks.map(v=>button('week',`${v.id===taskId?'✓ ':''}${v.week}주차`,`data-id="${esc(v.id)}" aria-pressed="${v.id===taskId}"`)).join('')}</div>`:''}
      <nav class="tabs" aria-label="스터디 메뉴">${Object.entries(tabs).map(([k,v])=>button('tab',v,`data-tab="${k}" ${tab===k?'aria-current="page"':''}`)).join('')}</nav></div></header>
      <div class="wrap content"><section class="sheet"><div role="alert" id="error">${esc(error)}</div>${message?notice(message):''}
      ${canEdit&&tab==='task'?`<div class="actions">${button('add','과제 올리기')}${t?button('edit','이번 과제 수정'):''}</div>`:''}${panel(t)}</section>
      <aside><h3>모임 안내</h3><p>${esc(t?.notice||'등록된 공지가 없습니다.')}</p>${t?`<hr><h3>팀 제출 현황</h3><p>${t.answers.filter(a=>room.members.some(m=>m.id===a.member)).length} / ${room.members.length}명</p>
      ${canEdit?`<ul class="roster">${room.members.map(m=>`<li><span>${esc(m.name)}</span><b>${t.answers.some(a=>a.member===m.id)?'제출':'미제출'}</b></li>`).join('')}</ul>`:''}`:''}</aside></div>`;
  }
  function pickFile(file){
    if(!file||!file.size||file.size>41943040)throw {userMessage:'1바이트 이상 40MB 이하의 파일을 선택해 주세요.'};
    const d=draft();clearDraft(d);d.file=file;d.url=URL.createObjectURL(file);render();
  }
  async function record(){
    if(!window.MediaRecorder||!navigator.mediaDevices?.getUserMedia)throw {userMessage:'이 브라우저에서 직접 녹음할 수 없습니다. 파일 첨부를 이용해 주세요.'};
    const ticket=++micTicket;
    let media;
    try{media=await navigator.mediaDevices.getUserMedia({audio:true});}catch{throw {userMessage:'마이크 권한을 허용하거나 파일 첨부를 이용해 주세요.'};}
    if(ticket!==micTicket){media.getTracks().forEach(t=>t.stop());return;}
    mic=media;
    try{
      const r=new MediaRecorder(mic);const parts=[];recorder=r;
      r.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};
      r.onstop=()=>{const type=r.mimeType||'audio/webm';stopMic();try{pickFile(new File(parts,'면접 답변.'+(type.includes('mp4')?'m4a':'webm'),{type}));}catch(e){error=human(e);render();}};
      r.start();render();
    }catch(e){stopMic();throw e;}
  }
  async function fileCall(body){
    const {data,error:fail}=await MONC.sb.functions.invoke('study-room-file',{body});
    if(fail||!data?.ok)throw {userMessage:'첨부를 처리하지 못했습니다. 파일 형식과 마감 시간을 확인한 뒤 다시 시도해 주세요.'};
    return data;
  }
  async function saveAnswer(){
    const d=draft(),t=task();
    if(d.mode==='text'){
      if(!d.text.trim())throw {userMessage:'답변이나 키워드를 입력해 주세요.'};
      await rpc('text',{id:d.id,task:t.id,body:d.text.trim()});
    }else{
      if(!d.file)throw {userMessage:'제출할 파일을 선택해 주세요.'};
      const fd=new FormData();fd.set('room',roomId);fd.set('task',t.id);fd.set('id',d.id);fd.set('file',d.file);await fileCall(fd);
    }
    clearDraft(d);drafts.delete(t.id);message='답변을 제출했습니다.';await refresh();
  }
  function showEditor(edit){
    const t=edit?task():null;editId=t?.id;requestId=editId||id();
    form.elements.question.value=t?.question||'';form.elements.notice.value=t?.notice||'';
    form.elements.due.value=t?new Date(Date.parse(t.due)+9*3600000).toISOString().slice(0,16):'';
    form.querySelector('[data-error]').textContent='';editor.showModal();
  }
  async function run(fn){
    if(busy)return;busy=true;error='';message='';
    try{await fn();}catch(e){error=human(e);const target=editor.open?form.querySelector('[data-error]'):document.getElementById('error');if(target)target.textContent=error;}
    finally{busy=false;}
  }
  root.addEventListener('click',e=>{
    const b=e.target.closest('[data-cmd]');if(!b||!room)return;
    run(async()=>{
      const cmd=b.dataset.cmd;
      if(['week','tab','mode'].includes(cmd)){
        stopMic();
        if(cmd==='week'){taskId=b.dataset.id;peerId=null;}
        if(cmd==='tab')tab=b.dataset.tab;
        if(cmd==='mode')draft().mode=b.dataset.mode;
        render();return;
      }
      if(cmd==='record')await record();
      if(cmd==='stop'&&recorder?.state==='recording')recorder.stop();
      if(cmd==='send')await saveAnswer();
      if(cmd==='add'||cmd==='edit')showEditor(cmd==='edit');
      if(cmd==='file-open'){
        const a=task().answers.find(a=>a.id===b.dataset.id);
        const {url}=await fileCall({action:'read',room:roomId,id:a.id});
        const box=b.closest('[data-asset]').querySelector('.media');
        const media=a.mime.startsWith('audio/')?'audio':a.mime.startsWith('video/')?'video':a.mime.startsWith('image/')?'img':null;
        if(media){const node=document.createElement(media);node.src=url;if(media==='img'){node.className='asset-image';node.alt='제출한 사진';}else node.controls=true;box.replaceChildren(node);}
        const signed=await fileCall({action:'read',room:roomId,id:a.id,download:true});
        const link=document.createElement('a');link.href=signed.url;link.textContent='파일 다운로드';if(!media)box.replaceChildren();box.append(link);
      }
    });
  });
  root.addEventListener('input',e=>{if(e.target.id==='body')draft().text=e.target.value;});
  root.addEventListener('change',e=>{
    if(e.target.id==='peer'&&!busy){peerId=e.target.value;render();}
    if(e.target.id==='upload')run(()=>pickFile(e.target.files[0]));
  });
  root.addEventListener('submit',e=>{
    if(e.target.id!=='note')return;e.preventDefault();
    const f=e.target,body=f.elements.body.value.trim();
    run(async()=>{if(!body)throw {userMessage:'피드백을 입력해 주세요.'};
      f.dataset.request||=id();await rpc('note',{id:f.dataset.request,answer:peerId,body});message='피드백을 남겼습니다.';await refresh();});
  });
  editor.querySelector('[data-cmd=close]').onclick=()=>{if(!busy)editor.close()};
  form.onsubmit=e=>{e.preventDefault();run(async()=>{
    const question=form.elements.question.value.trim();if(!question)throw {userMessage:'연습 질문을 입력해 주세요.'};
    await rpc(editId?'edit-task':'create-task',{id:requestId,question,due:form.elements.due.value+':00+09:00',notice:form.elements.notice.value.trim()});
    taskId=requestId;editor.close();message='과제를 저장했습니다.';await refresh();
  });};
  function lock(){
    stopMic();for(const d of drafts.values())clearDraft(d);drafts.clear();started=false;room=null;editor.close();root.innerHTML='';
  }
  window.addEventListener('pagehide',lock);
  window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
  async function start(){
    try{
      if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(roomId||''))throw {userMessage:'스터디 모집글에서 우리 스터디를 열어주세요.'};
      if(!await MONC.requireConsent())return;
      const session=await MONC.getSession();uid=session?.user.id;if(!uid)throw {userMessage:'로그인 후 이용해 주세요.'};
      started=true;MONC.sb.auth.onAuthStateChange((event,next)=>{if(started&&next?.user.id!==uid){lock();location.reload();}});
      await refresh();
    }catch(e){root.innerHTML=`<div class="wrap">${back}<p role="alert">${esc(human(e))}</p></div>`;}
  }
  start();
})();
