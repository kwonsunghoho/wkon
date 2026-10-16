(function(){
 'use strict';
 const U=MONC_OPS_UTIL,$=s=>document.querySelector(s),E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const S={tab:'today',date:U.today(),view:'month',category:'전체',scope:'mine',status:'open',query:'',archived:false,assignee:'',filters:false,weeks:8,events:[],items:[],staff:[],selected:new Set(),loading:false};
 const labels={todo:'대기',doing:'진행 중',review:'검수 대기',rejected:'반려',done:'완료'};
 const dialog=$('#opsDialog');let pending=null,focusBefore=null;
 const name=id=>S.staff.find(x=>x.id===id)?.name||'이전 직원';
 const stamp=v=>v?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'—';
 const dateLabel=d=>new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'short'}).format(U.parseYmd(d));
 const errorText=e=>({staff_required:'학원 운영 권한이 없습니다. 원장님에게 권한 등록을 요청해 주세요.',forbidden:'이 작업을 처리할 권한이 없습니다.',consent_required:'로그인과 필수 동의를 다시 확인해 주세요.',conflict:'다른 사람이 먼저 변경했습니다. 입력은 남겨 두었습니다. 창을 닫고 최신 내용을 확인해 주세요.',assignment_locked:'진행 중인 업무의 담당자·검수자는 바로 바꿀 수 없습니다.',work_staff_required:'담당자와 검수자는 업무 권한이 있는 직원을 골라 주세요.',self_review:'담당자와 검수자는 서로 달라야 합니다.',reject_note_required:'반려 사유를 입력해 주세요.',forbidden_transition:'상태가 바뀌었거나 처리 권한이 없습니다. 최신 내용을 확인해 주세요.',request_conflict:'재시도 요청이 달라졌습니다. 내용을 확인하고 다시 시도해 주세요.',self_disable:'본인 권한을 비활성화할 수 없습니다.'}[e.message]||(/PGRST202|PGRST205/.test(e.code||'')?'운영 기능의 DB 설정이 아직 적용되지 않았습니다.':e.message||'불러오지 못했습니다. 다시 시도해 주세요.'));
 async function api(a,p={}){const {data,error}=await MONC.sb.rpc('operations_api',{p_action:a,p});if(error)throw error;return data;}
 async function write(a,p){const sig=JSON.stringify([a,p]);if(!pending||pending.sig!==sig)pending={sig,id:crypto.randomUUID()};const r=await api(a,{...p,request_id:pending.id});pending=null;return r;}
 function message(t,bad=false){$('#opsMessage').textContent=t;$('#opsMessage').className=bad?'ops-error':'';}
 function options(rows,value){return rows.map(([v,t])=>`<option value="${E(v)}" ${v===value?'selected':''}>${E(t)}</option>`).join('');}
 function select(label,id,rows,value){return `<label>${E(label)}<select id="${id}">${options(rows,value)}</select></label>`;}
 function button(text,attrs=''){return `<button type="button" ${attrs}>${E(text)}</button>`;}
 function empty(t){return `<p class="ops-empty">${E(t)}</p>`;}
 function card(w){const late=w.due_date<U.today()&&w.status!=='done';return `<li><button class="ops-card" data-work="${w.id}"><span class="ops-tag ${late?'late':''}">${late?'기한 지남 · ':''}${E(w.type==='notice'?(w.status==='done'?'확인 완료':'공지 확인'):labels[w.status])}</span><strong>${E(w.title)}</strong><span class="ops-meta"><span>${E(name(w.assignee_id))}</span><span>${E(w.due_date?dateLabel(w.due_date)+' 마감':'직원 공지')}</span>${w.archived_at?'<span>보관됨</span>':''}</span></button></li>`;}
 function eventCard(e,check=false){return `<li>${check?`<label class="ops-checkrow"><input type="checkbox" data-pick="${e.id}" ${S.selected.has(e.id)?'checked':''}>일괄 변경에 선택</label>`:''}<button class="ops-card" data-event="${e.id}"><span class="ops-tag">${E(e.category)}</span><strong>${E(e.title)}</strong><span class="ops-meta"><span>${E(e.start_time?.slice(0,5)||'시간 미정')}${e.end_time?'–'+E(e.end_time.slice(0,5)):''}</span><span>${E((e.staff_ids||[]).map(name).concat(e.legacy_staff||[]).filter(Boolean).join(' · ')||'담당 미지정')}</span>${e.archived_at?'<span>보관됨</span>':''}</span></button></li>`;}
 function panel(title,body){return `<section class="ops-panel"><h3>${E(title)}</h3>${body}</section>`;}
 function monthBounds(){const d=U.parseYmd(S.date),y=d.getFullYear(),m=d.getMonth();return [U.ymd(new Date(y,m,1)),U.ymd(new Date(y,m+1,0))];}
 async function refresh(){
  if(S.loading)return;S.loading=true;$('#opsRefresh').disabled=true;message('불러오는 중…');
  try{
   let [start,end]=monthBounds();start=U.shift(start,-7);end=U.shift(end,7);
   if(S.view==='slots'&&S.tab==='schedule'){start=S.date;end=U.shift(start,90);}
   const jobs=[];if(S.schedule)jobs.push(api('schedule_list',{start,end,archived:S.archived}).then(r=>{S.events=r.items;}));
   if(S.work){const [workStart,workEnd]=monthBounds();jobs.push(api('work_list',{start:workStart,end:workEnd,archived:S.archived}).then(r=>{S.items=r.items;}));}
   await Promise.all(jobs);S.selected.clear();render();message('');
  }catch(e){message(errorText(e),true);$('#opsContent').innerHTML=empty('목록을 불러오지 못했습니다. 새로고침을 눌러 다시 확인해 주세요.');}
  finally{S.loading=false;$('#opsRefresh').disabled=false;}
 }
 function render(){
  document.querySelectorAll('[data-tab]').forEach(b=>{b.setAttribute('aria-current',b.dataset.tab===S.tab?'page':'false');b.hidden=b.dataset.tab==='staff'?!S.admin:b.dataset.tab==='schedule'?!S.schedule:b.dataset.tab==='work'?!S.work:false;});
  $('#opsTitle').textContent={today:'오늘의 운영',schedule:'학원 일정',work:'업무·공지',staff:'직원 권한'}[S.tab];
  $('#opsSubtitle').textContent=S.tab==='today'?dateLabel(U.today()):S.tab==='schedule'?'수업과 상담, 함께 확인할 일정':S.tab==='work'?'내가 맡은 일과 확인할 공지':'홈페이지 회원에게 필요한 메뉴만 연결합니다.';
  $('#opsTools').innerHTML='';
  if(S.tab==='today')renderToday();else if(S.tab==='schedule')renderSchedule();else if(S.tab==='work')renderWork();else renderStaff();
 }
 function renderToday(){
  const today=U.today(),mine=S.items.filter(w=>!w.archived_at&&w.assignee_id===S.me&&w.status!=='done'),review=S.items.filter(w=>!w.archived_at&&w.reviewer_id===S.me&&w.status==='review');
  const events=S.events.filter(e=>!e.archived_at&&e.date===today);
  $('#opsContent').innerHTML=`<div class="ops-grid">${S.schedule?panel('오늘 일정',events.length?`<ul class="ops-list">${events.map(e=>eventCard(e)).join('')}</ul>`:empty('오늘 등록된 일정이 없습니다.')):''}<div>${S.work?panel(`내 업무·공지 ${mine.length}건`,mine.length?`<ul class="ops-list">${mine.slice(0,8).map(card).join('')}</ul>`:empty('지금 처리할 업무가 없습니다.')):''}${S.work&&review.length?panel(`내가 검수할 것 ${review.length}건`,`<ul class="ops-list">${review.map(card).join('')}</ul>`):''}</div></div>`;
 }
 function renderSchedule(){
  $('#opsTools').innerHTML=`<div class="ops-filter">${select('보기','opView',[['month','월'],['week','주'],['day','일'],['slots','빈자리']],S.view)}<label>기준 날짜<input id="opDate" type="date" value="${S.date}"></label>${select('분류','opCategory',['전체',...U.categories].map(x=>[x,x]),S.category)}${button('일정 등록','id="opAddEvent" class="primary"')}</div><div class="ops-row">${button('이전','id="opPrev"')}${button('오늘','id="opToday"')}${button('다음','id="opNext"')}<label class="ops-checkrow"><input id="opArchived" type="checkbox" ${S.archived?'checked':''}>보관 일정 포함</label></div>`;
  let events=S.events.filter(e=>(S.archived||!e.archived_at)&&(S.category==='전체'||e.category===S.category));
  let html='';
  if(S.view==='slots'){
   const unknown=S.events.filter(e=>!e.archived_at&&e.category==='수업'&&!e.start_time);
   const source=S.events.filter(e=>!e.archived_at).map(e=>({...e,time:(e.start_time||'').slice(0,5)+(e.end_time?'~'+e.end_time.slice(0,5):'')}));
   const plans=MONC_OPS_SLOTS.buildDayPlans(source,S.date,Number(S.weeks));
   html=`${select('확인할 기간','opWeeks',[['4','4주'],['8','8주'],['12','12주']],String(S.weeks))}<p class="ops-caption">기준일부터 ${S.weeks}주 · 화~토 13:00–22:00 · 동시 2개 반 기준. 상담은 강의실을 차지하지 않습니다.</p>${unknown.length?`<p class="ops-error">시간 미정 수업 ${unknown.length}건이 계산에서 빠져 있습니다. 해당 일정을 먼저 확인해 주세요.</p>`:''}<div class="ops-grid">${plans.map(p=>panel('일월화수목금토'[p.weekday]+'요일',p.openings.length?p.openings.map(o=>`<div class="ops-slot"><strong>${MONC_OPS_SLOTS.rangeLabel(o.start,o.end)}</strong><span>${E(MONC_OPS_SLOTS.fitsLabel(o.fits))}</span><p class="ops-caption">${o.status==='partial'?'일부 주차만 가능 · 실제 날짜 확인 필요':o.status==='free2'?S.weeks+'주 내내 2개 반 여유':S.weeks+'주 내내 1개 반 이상 여유'}</p></div>`).join(''):empty('연속으로 넣을 수 있는 자리가 없습니다.'))).join('')}</div>`;
  }else if(S.view==='month'){
   const [first,last]=monthBounds(),offset=U.parseYmd(first).getDay();
   html=`<div class="ops-calendar-wrap"><div class="ops-calendar" aria-label="월 달력">${['일','월','화','수','목','금','토'].map(x=>`<span>${x}</span>`).join('')}${'<span></span>'.repeat(offset)}`;
   for(let d=first;d<=last;d=U.shift(d,1)){const n=events.filter(e=>e.date===d).length;html+=`<button data-day="${d}" aria-label="${E(dateLabel(d))}, 일정 ${n}건" class="${d===U.today()?'is-today':''} ${d===S.date?'selected':''}"><b>${+d.slice(-2)}</b><small>${n?n+'건':''}</small></button>`;}html+='</div></div>';
   html+=panel(dateLabel(S.date),events.filter(e=>e.date===S.date).length?`<ul class="ops-list">${events.filter(e=>e.date===S.date).map(e=>eventCard(e,true)).join('')}</ul>`:empty('등록된 일정이 없습니다.'));
  }else{
   const start=S.view==='day'?S.date:U.shift(S.date,-U.parseYmd(S.date).getDay()),days=Array.from({length:S.view==='day'?1:7},(_,i)=>U.shift(start,i));
   html=`<div class="${S.view==='week'?'ops-week':''}">${days.map(d=>`<section><h3>${E(dateLabel(d))}</h3>${events.filter(e=>e.date===d).length?`<ul class="ops-list">${events.filter(e=>e.date===d).map(e=>eventCard(e,true)).join('')}</ul>`:empty('일정 없음')}</section>`).join('')}</div>`;
  }
  if(S.view!=='slots')html+=`<div class="ops-batch"><p><strong id="opSelected">${S.selected.size}건 선택</strong></p><div class="ops-actions">${button('제목 일괄 수정','data-batch="title"')}${button('선택 보관','data-batch="archive"')}${S.archived?button('선택 복원','data-batch="restore"'):''}</div></div>`;
  $('#opsContent').innerHTML=html;
 }
 function renderWork(){
  $('#opsTools').innerHTML=`<div class="ops-filter">${select('목록','opScope',[['mine','내 업무'],['review','내가 검수할 것'],['all','전체 현황'],['notice','직원 공지']],S.scope)}${button('업무·공지 등록','id="opAddWork" class="primary"')}</div><details id="opFilters" class="ops-filter-more" ${S.filters?'open':''}><summary>필터 · 검색${S.status!=='open'||S.assignee||S.query||S.archived?' · 적용 중':''}</summary><div class="ops-filter">${select('처리 상태','opStatus',[['open','미완료'],['all','전체 상태'],...Object.entries(labels)],S.status)}<label>완료 기록 기준 월<input id="opMonth" type="month" value="${S.date.slice(0,7)}"></label>${select('담당자','opAssignee',[['','전체 직원'],...S.staff.map(s=>[s.id,s.name])],S.assignee)}<label>제목 검색<input id="opSearch" type="search" value="${E(S.query)}" placeholder="찾을 업무 제목"></label><label class="ops-checkrow"><input id="opArchived" type="checkbox" ${S.archived?'checked':''}>보관 항목 포함</label></div></details>`;
  $('#opFilters').ontoggle=()=>{S.filters=$('#opFilters').open;};
  const items=S.items.filter(w=>(S.archived||!w.archived_at)&&(S.scope==='all'||S.scope==='mine'&&w.assignee_id===S.me||S.scope==='review'&&w.reviewer_id===S.me&&w.status==='review'||S.scope==='notice'&&w.type==='notice')&&(S.status==='all'||S.status==='open'&&w.status!=='done'||w.status===S.status)&&(!S.assignee||w.assignee_id===S.assignee)&&w.title.includes(S.query));
  $('#opsContent').innerHTML=panel(`${items.length}건`,items.length?`<ul class="ops-list">${items.map(card).join('')}</ul>`:empty('이 조건의 업무·공지가 없습니다.'));
 }
 function renderStaff(){
  $('#opsTools').innerHTML=`<form id="opMemberSearch" class="ops-filter"><label>홈페이지 회원 찾기<input name="query" minlength="2" required placeholder="이름 또는 이메일"></label><button class="primary">회원 검색</button></form><div id="opMembers"></div>`;
  $('#opsContent').innerHTML=panel('등록된 직원',S.staff.map(s=>`<div class="ops-staff-row ops-row"><div><strong>${E(s.name)}</strong><p class="ops-caption">${s.active?[s.schedule?'일정':'',s.work?'업무·공지':''].filter(Boolean).join(' · ')||'메뉴 미부여':'비활성'}${!s.member_id?' · 계정 연결 없음':''}</p></div>${s.member_id?button('권한 수정',`data-staff="${s.id}"`):''}</div>`).join(''));
 }
 function show(title,html){focusBefore=document.activeElement;$('#opsDialogTitle').textContent=title;$('#opsDialogBody').innerHTML=html;$('#opsDialogMessage').textContent='';if(!dialog.open)dialog.showModal();}
 function close(){dialog.close();focusBefore?.focus();}
 async function run(fn,done){const buttons=[...dialog.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);$('#opsDialogMessage').textContent='저장 중…';try{await fn();if(done)await done();else{close();await refresh();message('저장했습니다.');}}catch(e){$('#opsDialogMessage').textContent=errorText(e);$('#opsDialogMessage').className='ops-error';}finally{buttons.forEach(b=>b.disabled=false);}}
 function checks(staff,selected,key){return `<div class="ops-checks">${staff.map(s=>`<label class="ops-checkrow"><input type="checkbox" name="${key}" value="${s.id}" ${selected.includes(s.id)?'checked':''}>${E(s.name)}</label>`).join('')}</div>`;}
 async function editEvent(event){
  const series=event?(await api('schedule_series',{id:event.id})).items:[];
  show(event?'일정 수정':'일정 등록',`<form class="ops-form" id="opEventForm">${event?select('변경 범위','efScope',[['single','이 일정만'],['series',`반복 일정 전체 ${series.length}건`]],'single'):''}<label>제목<input name="title" required maxlength="160" value="${E(event?.title||'')}"></label><div class="ops-fields">${select('분류','efCategory',U.categories.map(x=>[x,x]),event?.category||'수업')}${select('등록 방식','efMode',[['single','하루'],['range','기간 중 매일'],['weekly','매주 요일'],['custom','날짜 직접 지정']],'single')}</div><div class="ops-fields"><label>시작 날짜<input name="start" type="date" required value="${event?.date||S.date}"></label><label>종료 날짜<input name="end" type="date" value="${event?.date||S.date}"></label></div><fieldset><legend>매주 요일</legend><div class="ops-checks">${['일','월','화','수','목','금','토'].map((d,i)=>`<label class="ops-checkrow"><input name="weekday" type="checkbox" value="${i}">${d}</label>`).join('')}</div></fieldset><label>직접 지정 날짜 · 한 줄에 하나<textarea name="dates">${event?.date||S.date}</textarea></label><div class="ops-fields"><label>시작 시간<input type="time" name="start_time" value="${event?.start_time?.slice(0,5)||''}"></label><label>종료 시간<input type="time" name="end_time" value="${event?.end_time?.slice(0,5)||''}"></label></div><fieldset><legend>담당 선생님</legend>${checks(S.staff.filter(s=>s.active),event?.staff_ids||[],'staff')}</fieldset>${event?.legacy_staff?`<p class="ops-caption">이전 담당 표기: ${E(event.legacy_staff)}</p>`:''}<label>내용<textarea name="body" maxlength="12000">${E(event?.body||'')}</textarea></label><p id="efPreview" class="ops-caption"></p><button class="primary">적용 날짜 확인</button></form>`);
  const f=$('#opEventForm');let ready=null;const modeFields=()=>{const mode=$('#efMode').value;f.elements.start.parentElement.hidden=mode==='custom';f.elements.start.required=mode!=='custom';f.elements.end.parentElement.hidden=!['range','weekly'].includes(mode);f.elements.end.required=['range','weekly'].includes(mode);f.querySelector('fieldset').hidden=mode!=='weekly';f.elements.dates.parentElement.hidden=mode!=='custom';};$('#efMode').onchange=modeFields;modeFields();
  if(event)$('#efScope').onchange=()=>{if($('#efScope').value==='series'){$('#efMode').value='custom';f.elements.dates.value=series.map(e=>e.date).join('\n');}else{$('#efMode').value='single';f.elements.start.value=event.date;}modeFields();ready=null;};
  f.oninput=()=>{ready=null;f.querySelector('button.primary').textContent='적용 날짜 확인';};
  f.onsubmit=ev=>{ev.preventDefault();try{
   const data=new FormData(f),mode=$('#efMode').value,dates=mode==='custom'?[...new Set(data.get('dates').split(/\s+/).filter(Boolean))]:U.dates(data.get('start'),data.get('end'),mode,data.getAll('weekday').map(Number));
   if(!dates.length||dates.length>400||dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||U.ymd(U.parseYmd(d))!==d))throw Error('날짜를 확인해 주세요.');
   const scope=event?$('#efScope').value:'single',expected=event?(scope==='series'?series:[event]).map(({id,revision})=>({id,revision})):[];
   if(event&&scope==='single'&&dates.length!==1)throw Error('이 일정만 수정할 때는 날짜를 하나만 골라 주세요.');
   const p={title:data.get('title'),body:data.get('body'),category:$('#efCategory').value,dates,scope,expected,start_time:data.get('start_time'),end_time:data.get('end_time'),staff_ids:data.getAll('staff'),legacy_staff:event?.legacy_staff||''};
   if(ready!==JSON.stringify(p)){ready=JSON.stringify(p);$('#efPreview').textContent=`${dates.length}건 적용: ${dates.slice(0,10).join(', ')}${dates.length>10?' …':''}${expected.length?' · 기존 '+expected.length+'건을 교체합니다.':''}`;f.querySelector('button.primary').textContent=`${dates.length}건 저장`;return;}
   run(()=>write('schedule_save',p));
  }catch(e){$('#opsDialogMessage').textContent=errorText(e);}};
 }
 function eventDetail(e){show(e.title,`<span class="ops-tag">${E(e.category)}</span><p>${E(dateLabel(e.date))} · ${E(e.start_time?.slice(0,5)||'시간 미정')}${e.end_time?'–'+E(e.end_time.slice(0,5)):''}</p><p>${E((e.staff_ids||[]).map(name).join(' · '))} ${E(e.legacy_staff)}</p><div class="ops-detail-body">${E(e.body)}</div><div class="ops-actions">${!e.archived_at?button('일정 수정','id="opEditEvent"'):''}${button(e.archived_at?'일정 복원':'일정 보관','id="opArchiveEvent"')}</div>`);if(!e.archived_at)$('#opEditEvent').onclick=()=>editEvent(e).catch(err=>message(errorText(err),true));$('#opArchiveEvent').onclick=()=>run(()=>write('schedule_batch',{expected:[{id:e.id,revision:e.revision}],operation:e.archived_at?'restore':'archive'}));}
 function batch(op){const selected=S.events.filter(e=>S.selected.has(e.id));if(!selected.length){message('변경할 일정을 먼저 선택해 주세요.',true);return;}show('선택 일정 '+({title:'제목 수정',archive:'보관',restore:'복원'}[op]),`<form id="opBatchForm" class="ops-form"><p>${selected.length}건에 적용합니다.</p><ul>${selected.map(e=>`<li>${E(e.date)} · ${E(e.title)}</li>`).join('')}</ul>${op==='title'?'<label>새 제목<input name="title" required maxlength="160"></label>':''}<button class="primary">${selected.length}건 ${op==='title'?'수정':op==='archive'?'보관':'복원'}</button></form>`);$('#opBatchForm').onsubmit=ev=>{ev.preventDefault();run(()=>write('schedule_batch',{operation:op,title:new FormData(ev.target).get('title'),expected:selected.map(({id,revision})=>({id,revision}))}));};}
 function editWork(detail){
  const w=detail?.item,assigned=w?(w.type==='notice'?detail.group.map(x=>x.assignee_id):[w.assignee_id]):[],staff=S.staff.filter(s=>s.active&&s.work&&s.member_id||assigned.includes(s.id)||s.id===w?.reviewer_id);
  show(w?'업무·공지 수정':'업무·공지 등록',`<form id="opWorkForm" class="ops-form">${select('종류','wfType',[['task','업무'],['notice','직원 공지']],w?.type||'task')}<label>제목<input name="title" required maxlength="160" value="${E(w?.title||'')}"></label><label>내용<textarea name="body" maxlength="16000">${E(w?.body||'')}</textarea></label><fieldset><legend>담당자 · 공지는 받는 사람</legend>${checks(staff,assigned,'assignee')}</fieldset><div id="wfTask"><div class="ops-fields"><label>마감일<input type="date" name="due_date" value="${w?.due_date||S.date}"></label>${select('검수자','wfReviewer',[['','검수 없이 완료'],...staff.map(s=>[s.id,s.name])],w?.reviewer_id||'')}</div><div class="ops-fields">${select('반복','wfRepeat',[['','반복 없음'],['weekly','매주'],['monthly','매월']],w?.recurrence?.split(':')[0]||'')}${select('반복 요일','wfWeekday',['일','월','화','수','목','금','토'].map((x,i)=>[String(i),x+'요일']),w?.recurrence?.split(':')[1]||'1')}<label id="wfMonthday">반복 날짜<input name="repeatDay" type="number" min="1" max="31" value="${w?.recurrence?.split(':')[1]||'1'}"><span class="ops-caption">해당 날짜가 없는 달은 마지막 날에 마감합니다.</span></label></div></div><button class="primary">저장</button></form>`);
  const f=$('#opWorkForm');$('#wfType').disabled=!!w;const update=()=>{const task=$('#wfType').value==='task',r=$('#wfRepeat').value;$('#wfTask').hidden=!task;f.elements.due_date.required=task;$('#wfWeekday').parentElement.hidden=r!=='weekly';$('#wfMonthday').hidden=r!=='monthly';f.elements.repeatDay.required=task&&r==='monthly';f.elements.repeatDay.disabled=!task||r!=='monthly';f.elements.due_date.disabled=!task;};$('#wfType').onchange=update;$('#wfRepeat').onchange=update;update();
  f.onsubmit=ev=>{ev.preventDefault();const d=new FormData(f),type=$('#wfType').value,repeat=$('#wfRepeat').value;run(()=>write('work_save',{id:w?.id||'',revision:w?.revision,type,title:d.get('title'),body:d.get('body'),assignees:d.getAll('assignee'),reviewer_id:type==='task'?$('#wfReviewer').value:'',due_date:type==='task'?d.get('due_date'):'',recurrence:type==='task'&&repeat?repeat+':'+(repeat==='weekly'?$('#wfWeekday').value:d.get('repeatDay')):'',expected:detail?.group.map(({id,revision})=>({id,revision}))||[]}));};
 }
 async function workDetail(id){
  const r=await api('work_detail',{id}),w=r.item;let actions=[];
  if(!w.archived_at){
   if(w.assignee_id===S.me){if(w.type==='notice'&&w.status==='todo')actions.push(['done','공지 확인']);if(w.type==='task'&&['todo','rejected'].includes(w.status))actions.push(['doing','업무 시작']);if(w.type==='task'&&w.status==='doing')actions.push(w.reviewer_id?['review','검수 요청']:['done','완료 처리']);}
   if(w.type==='task'&&w.reviewer_id===S.me&&w.status==='review')actions.push(['done','검수 승인'],['rejected','사유와 함께 반려']);
   if(w.type==='task'&&S.admin&&w.status==='done')actions.push(['todo','대기로 되돌리기']);
  }
  const manage=S.admin||w.author_id===S.me;
  show(w.title,`<span class="ops-tag">${E(w.type==='notice'?'직원 공지':labels[w.status])}</span><dl class="ops-detail-meta"><div><dt>담당자</dt><dd>${E(name(w.assignee_id))}</dd></div><div><dt>검수자</dt><dd>${w.reviewer_id?E(name(w.reviewer_id)):'없음'}</dd></div><div><dt>마감</dt><dd>${E(w.due_date||'없음')}</dd></div><div><dt>처음 열람</dt><dd>${E(stamp(w.first_opened_at))}</dd></div></dl><div class="ops-detail-body">${E(w.body)}</div>${w.type==='notice'?`<h3>받는 사람별 확인</h3><ul>${r.group.map(i=>`<li>${E(name(i.assignee_id))} · ${i.status==='done'?'확인 완료 '+E(stamp(i.completed_at)):'미확인'}</li>`).join('')}</ul>`:''}${actions.some(x=>x[0]==='rejected')?'<label>반려 사유<textarea id="opReject" maxlength="8000"></textarea></label>':''}<div class="ops-actions">${actions.map(([to,label])=>button(label,`data-transition="${to}" class="primary"`)).join('')}${manage&&!w.archived_at?button('내용 수정','id="opEditWork"'):''}${manage?button(w.archived_at?'복원':'보관','id="opArchiveWork"'):''}</div><h3>댓글</h3>${r.comments.map(c=>`<div class="ops-history"><strong>${E(name(c.actor_id))}</strong> <span class="ops-caption">${E(stamp(c.created_at))}</span><p>${E(c.body)}</p></div>`).join('')||'<p class="ops-caption">아직 댓글이 없습니다.</p>'}${!w.archived_at?'<form id="opComment" class="ops-form"><label>댓글 내용<textarea name="body" required maxlength="8000"></textarea></label><button>댓글 등록</button></form>':''}<details><summary>처리 이력 ${r.history.length}건</summary>${r.history.map(h=>`<div class="ops-history"><strong>${E(name(h.actor_id))}</strong> · ${E(stamp(h.created_at))}<p>${E(h.action==='work_transition'?(labels[h.before_data?.status]||'')+' → '+(labels[h.after_data?.status]||''):h.action==='work_archive'?'보관 상태 변경':h.action==='recipient_remove'?'공지 수신 대상에서 제외':'내용 등록·수정')}${h.note?'\n'+E(h.note):''}</p></div>`).join('')}</details>`);
  dialog.querySelectorAll('[data-transition]').forEach(b=>b.onclick=()=>run(()=>write('work_transition',{id,revision:w.revision,to:b.dataset.transition,note:$('#opReject')?.value||''}),async()=>{await refresh();await workDetail(id);}));
  if($('#opEditWork'))$('#opEditWork').onclick=()=>editWork(r);
  if($('#opArchiveWork'))$('#opArchiveWork').onclick=()=>run(()=>write('work_archive',{id,revision:w.revision,restore:!!w.archived_at}));
  if($('#opComment'))$('#opComment').onsubmit=ev=>{ev.preventDefault();const body=new FormData(ev.target).get('body');run(()=>write('work_comment',{id,body}),()=>workDetail(id));};
 }
 function editStaff(m,s){show('직원 권한',`<form id="opStaffForm" class="ops-form"><label>표시 이름<input name="name" maxlength="80" required value="${E(s?.name||m.name||'')}"></label><label class="ops-checkrow"><input name="active" type="checkbox" ${s?.active!==false?'checked':''}>활성 직원</label><label class="ops-checkrow"><input name="schedule" type="checkbox" ${s?.schedule?'checked':''}>일정 공유</label><label class="ops-checkrow"><input name="work" type="checkbox" ${s?.work?'checked':''}>업무·공지 공유</label><button class="primary">권한 저장</button></form>`);$('#opStaffForm').onsubmit=ev=>{ev.preventDefault();const d=new FormData(ev.target);run(()=>write('staff_save',{member_id:s?.member_id||m.id,revision:s?.revision,name:d.get('name'),active:d.has('active'),schedule:d.has('schedule'),work:d.has('work')}),async()=>{Object.assign(S,await api('bootstrap'));close();render();});};}
 $('#opsClose').onclick=close;$('#opsRefresh').onclick=refresh;
 document.addEventListener('click',ev=>{
  const b=ev.target.closest('button');if(!b)return;
  const safe=fn=>Promise.resolve().then(fn).catch(e=>message(errorText(e),true));
  if(b.dataset.tab){S.tab=b.dataset.tab;S.archived=false;S.date=U.today();refresh();}
  if(b.dataset.work)safe(()=>workDetail(b.dataset.work));
  if(b.dataset.event)eventDetail(S.events.find(e=>e.id===b.dataset.event));
  if(b.dataset.day){S.date=b.dataset.day;render();}
  if(b.dataset.batch)batch(b.dataset.batch);
  if(b.dataset.staff){const s=S.staff.find(x=>x.id===b.dataset.staff);editStaff({},s);}
  if(b.id==='opAddEvent')safe(()=>editEvent());if(b.id==='opAddWork')editWork();
  if(['opPrev','opNext','opToday'].includes(b.id)){if(b.id==='opToday')S.date=U.today();else{const dir=b.id==='opPrev'?-1:1;if(S.view==='month'){const d=U.parseYmd(S.date);S.date=U.ymd(new Date(d.getFullYear(),d.getMonth()+dir,1));}else S.date=U.shift(S.date,dir*(S.view==='week'?7:1));}refresh();}
 });
 document.addEventListener('change',ev=>{
  const t=ev.target;if(t.dataset.pick){if(t.checked)S.selected.add(t.dataset.pick);else S.selected.delete(t.dataset.pick);$('#opSelected').textContent=S.selected.size+'건 선택';return;}
  const keys={opView:'view',opDate:'date',opCategory:'category',opScope:'scope',opStatus:'status',opAssignee:'assignee',opWeeks:'weeks'};
  if(keys[t.id]){S[keys[t.id]]=t.value;if(['opDate','opView'].includes(t.id))refresh();else render();}
  if(t.id==='opMonth'){S.date=t.value+'-01';refresh();}if(t.id==='opArchived'){S.archived=t.checked;refresh();}
 });
 document.addEventListener('input',ev=>{if(ev.target.id==='opSearch'){const el=ev.target,pos=el.selectionStart;S.query=el.value;renderWork();$('#opSearch').focus();$('#opSearch').setSelectionRange(pos,pos);}});
 document.addEventListener('submit',async ev=>{if(ev.target.id!=='opMemberSearch')return;ev.preventDefault();try{const r=await api('members',{query:new FormData(ev.target).get('query')});$('#opMembers').innerHTML=r.items.length?`<ul class="ops-list">${r.items.map((m,i)=>`<li><button class="ops-card" data-member-index="${i}"><strong>${E(m.name)}</strong><span>${E(m.email)}</span></button></li>`).join('')}</ul>`:empty('일치하는 회원이 없습니다.');$('#opMembers').querySelectorAll('button').forEach(b=>b.onclick=()=>{const m=r.items[+b.dataset.memberIndex];editStaff(m,S.staff.find(s=>s.member_id===m.id));});}catch(e){message(errorText(e),true);}});
 window.addEventListener('pageshow',e=>{if(e.persisted&&!dialog.open&&S.me)refresh();});
 async function init(){try{if(!await MONC.requireSession()||!await MONC.requireConsent())return;Object.assign(S,await api('bootstrap'));$('#opsIdentity').textContent=name(S.me);$('#opsAdmin').hidden=!S.admin;$('#opsApp').hidden=false;await refresh();}catch(e){message(errorText(e),true);}}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!dialog.open&&S.me)refresh();});
 init();
})();
