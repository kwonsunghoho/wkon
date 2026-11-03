/* 실제 공개 소식 세 가지를 갱신한다. 읽음 기록에는 공개 글 ID만 브라우저에 저장한다. */
(function () {
  'use strict';
  const section=document.getElementById('homeCommunity');
  if(!section)return;
  const nodes={posts:document.getElementById('homeCommunityPosts'),studies:document.getElementById('homeCommunityStudies'),lectures:document.getElementById('homeCommunityLectures')};
  const labels={posts:'게시글 소식',studies:'모집 소식',lectures:'특강 소식'};
  const empty={posts:'아직 등록된 글이 없습니다.',studies:'아직 모집 중인 글이 없습니다.',lectures:'아직 공개된 특강이 없습니다.'};
  const actions=Object.keys(nodes).filter(action=>nodes[action]);
  const busy={},rendered={},lastAttempt={},current={},states={};
  const WEEK=7*24*60*60*1000;
  let visible=false,timer=null;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const key=action=>'monc_home_news_v1_'+action;
  const validId=value=>typeof value==='string'&&value.length>0&&value.length<=200;
  function readState(action){
    let value;
    try{value=JSON.parse(localStorage.getItem(key(action)));}catch(_){}
    return {ready:value?.ready===true,known:new Set(Array.isArray(value?.known)?value.known.filter(validId).slice(-100):[]),read:new Set(Array.isArray(value?.read)?value.read.filter(validId).slice(-100):[]),fresh:new Map(Array.isArray(value?.fresh)?value.fresh.filter(pair=>Array.isArray(pair)&&validId(pair[0])&&Number.isFinite(pair[1])).slice(-100):[])};
  }
  function save(action){
    const state=states[action];
    state.known=new Set([...state.known].slice(-100));state.read=new Set([...state.read].slice(-100));state.fresh=new Map([...state.fresh].slice(-100));
    try{localStorage.setItem(key(action),JSON.stringify({ready:state.ready,known:[...state.known].slice(-100),read:[...state.read].slice(-100),fresh:[...state.fresh].slice(-100)}));}catch(_){}
  }
  actions.forEach(action=>{states[action]=readState(action);});
  function isNew(action,id){
    const state=states[action],at=state.fresh.get(id),age=Date.now()-at;
    return !state.read.has(id)&&Number.isFinite(at)&&age>=0&&age<=WEEK;
  }
  function updateBadge(action){
    const shell=nodes[action].closest('.choice-feed-shell');
    const fresh=(current[action]||[]).some(row=>isNew(action,row.id));
    shell.querySelector('.new-indicator').hidden=!fresh;
    shell.querySelector('.new-indicator').setAttribute('aria-label',labels[action]+'에 새 소식이 있습니다');
  }
  function notice(action,rows){
    const state=states[action],now=Date.now();let arrivals=0;
    for(const [id,at] of state.fresh)if(now-at>WEEK||now<at)state.fresh.delete(id);
    for(const row of rows){
      if(!state.known.has(row.id)){
        const created=Date.parse(row.created_at),recent=Number.isFinite(created)&&created<=now&&now-created<=WEEK;
        if(!state.read.has(row.id)&&(state.ready||recent)){state.fresh.set(row.id,state.ready?now:created);arrivals++;}
        state.known.add(row.id);
      }
    }
    state.ready=true;save(action);return arrivals;
  }
  function dateHtml(value){
    const date=new Date(value);
    return !value||Number.isNaN(date.getTime())?'':'<time datetime="'+esc(date.toISOString())+'">'+esc(new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'numeric',day:'numeric',timeZone:'Asia/Seoul'}).format(date))+'</time>';
  }
  function rowHtml(row,action){
    let status='',date=dateHtml(row.created_at);
    if(action==='studies'){
      if(row.status==='closed')status='모집 종료';
      else if(row.status==='open')status=row.members!=null&&row.capacity!=null&&Number.isFinite(Number(row.members))&&Number.isFinite(Number(row.capacity))&&Number(row.members)>=Number(row.capacity)?'정원 마감':'모집 중';
    }
    if(action==='lectures'){date=dateHtml(row.lecture_date);status=date?'일정':'일정은 상세에서 확인';}
    const href=action==='lectures'?'lecture.html?id='+encodeURIComponent(row.id):'community.html?view='+(action==='posts'?'thread':'study')+'&id='+encodeURIComponent(row.id)+(action==='posts'?'&topic=prep':'');
    return '<article class="home-community-row"><a class="home-community-title" href="'+esc(href)+'" data-feed-action="'+action+'" data-feed-item="'+esc(row.id)+'" title="'+esc(row.title)+'"'+(action==='lectures'?' data-home-action="home_lecture_service"':'')+'><span>'+esc(row.title)+'</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></a><div class="home-community-meta">'+(status?'<span class="home-community-tag">'+status+'</span>':'')+date+'</div></article>';
  }
  function render(action,rows){
    const node=nodes[action],snapshot=JSON.stringify(rows),shell=node.closest('.choice-feed-shell');
    node.querySelector('.home-community-stale')?.remove();shell.dataset.empty=String(rows.length===0);
    if(rendered[action]!==snapshot){
      const open=node.querySelector('details')?.open,active=document.activeElement,href=node.contains(active)?active.getAttribute('href'):null,summary=node.contains(active)&&active.tagName==='SUMMARY';
      node.innerHTML=rows.length?rowHtml(rows[0],action)+(rows.length>1?'<details class="community-feed"'+(open?' open':'')+'><summary><span>소식 더보기</span><span aria-hidden="true">＋</span></summary>'+rows.slice(1).map(row=>rowHtml(row,action)).join('')+'</details>':''):'<p class="home-community-status" role="status">'+empty[action]+'</p>';
      if(href)[...node.querySelectorAll('a')].find(link=>link.getAttribute('href')===href)?.focus({preventScroll:true});
      else if(summary)node.querySelector('summary')?.focus({preventScroll:true});
      rendered[action]=snapshot;
    }
    updateBadge(action);
  }
  function retry(node,action,text){
    node.innerHTML='<p class="home-community-status" role="status">'+text+'</p><button type="button" class="home-community-retry">다시 불러오기</button>';
    node.querySelector('button').addEventListener('click',()=>load(action));
  }
  async function load(action){
    if(busy[action])return;
    const node=nodes[action];busy[action]=true;lastAttempt[action]=Date.now();node.setAttribute('aria-busy','true');
    node.querySelectorAll('button').forEach(button=>button.disabled=true);
    let timeout;
    try{
      if(!window.MONC?.sb)throw new Error('연결 없음');
      const request=action==='lectures'?MONC.sb.from('special_lectures').select('*').eq('visible',true).order('created_at',{ascending:false}).limit(3):MONC.sb.rpc('community_read',{p_action:action,p_data:action==='posts'?{limit:3,topic:'prep'}:{limit:3}});
      const result=await Promise.race([request,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('시간 초과')),12000);})]);
      if(result.error||(action==='lectures'?!Array.isArray(result.data):!result.data?.ok||!Array.isArray(result.data.items)))throw new Error('목록 오류');
      const rows=(action==='lectures'?result.data:result.data.items).filter(row=>row&&validId(row.id)&&typeof row.title==='string'&&row.title.trim()&&(action!=='lectures'||row.visible!==false)).slice(0,3);
      const hadData=rendered[action]!==undefined,arrivals=notice(action,rows);current[action]=rows;render(action,rows);
      if(hadData&&arrivals)node.closest('.choice-feed-shell').querySelector('.feed-announcement').textContent='새 '+labels[action]+'이 도착했습니다.';
    }catch(_){
      const shell=node.closest('.choice-feed-shell');shell.dataset.empty='false';
      if(rendered[action]===undefined)retry(node,action,labels[action]+'을 불러오지 못했습니다.');
      else if(!node.querySelector('.home-community-stale')){
        const message=document.createElement('div');message.className='home-community-stale';
        retry(message,action,'소식을 갱신하지 못해 이전 정보를 표시하고 있습니다.');node.append(message);
      }
    }finally{clearTimeout(timeout);busy[action]=false;node.setAttribute('aria-busy','false');node.querySelectorAll('button').forEach(button=>button.disabled=false);}
  }
  section.addEventListener('click',event=>{
    const link=event.target.closest('a[data-feed-item]');if(!link)return;
    const action=link.dataset.feedAction;if(!states[action])return;
    states[action].read.add(link.dataset.feedItem);save(action);updateBadge(action);
  });
  window.addEventListener('storage',event=>{actions.forEach(action=>{if(event.key===key(action)){states[action]=readState(action);updateBadge(action);}});});
  // 보이는 동안만 갱신하고, 돌아왔을 때도 중복 요청 없이 바로 확인한다.
  function refresh(){if(visible&&!document.hidden)actions.forEach(action=>{if(Date.now()-(lastAttempt[action]||0)>1000)load(action);});}
  function sync(){clearInterval(timer);timer=null;if(visible&&!document.hidden){refresh();timer=setInterval(refresh,30000);}}
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('pagehide',()=>{clearInterval(timer);timer=null;});
  window.addEventListener('pageshow',sync);
  if('IntersectionObserver' in window)new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);sync();}).observe(section);
  else{visible=true;sync();}
})();
