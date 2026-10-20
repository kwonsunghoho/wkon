/* 선택한 탭의 공개 목록만 읽는다. 기존 RPC의 공개 범위와 최신순 정렬을 유지한다. */
(function () {
  'use strict';
  const section=document.getElementById('homeCommunity');
  if(!section)return;
  const nodes={posts:document.getElementById('homeCommunityPosts'),studies:document.getElementById('homeCommunityStudies')};
  const tabs=Array.from(section.querySelectorAll('[data-community-tab]'));
  const busy={}, rendered={}, lastAttempt={};
  let selected='posts', visible=false, timer=null;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const path=(view,id)=>'community.html?view='+view+'&id='+encodeURIComponent(id)+(view==='thread'?'&topic=prep':'');
  function dateHtml(value) {
    const date=new Date(value);
    if(!value||Number.isNaN(date.getTime()))return '';
    return '<time datetime="'+esc(date.toISOString())+'">'+esc(new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'numeric',day:'numeric',timeZone:'Asia/Seoul'}).format(date))+'</time>';
  }
  function rowHtml(row,action) {
    let status='';
    if(action==='studies'){
      if(row.status==='closed')status='모집 종료';
      else if(row.status==='open') status=row.members!=null && row.capacity!=null && Number.isFinite(Number(row.members)) && Number.isFinite(Number(row.capacity)) && Number(row.members)>=Number(row.capacity)?'정원 마감':'모집 중';
    }
    return '<article class="home-community-row"><a class="home-community-title" href="'+path(action==='posts'?'thread':'study',row.id)+'">'+esc(row.title)+'</a><div class="home-community-meta">'+
      (status?'<span class="home-community-tag">'+status+'</span>':'')+dateHtml(row.created_at)+'</div></article>';
  }
  function retry(node,action,text) {
    node.innerHTML='<p class="home-community-status" role="status">'+text+'</p><button type="button" class="home-community-retry">다시 불러오기</button>';
    node.querySelector('button').addEventListener('click',()=>load(action));
  }
  async function load(action) {
    if(busy[action])return;
    const node=nodes[action];
    busy[action]=true;
    lastAttempt[action]=Date.now();
    node.setAttribute('aria-busy','true');
    const retryButton=node.querySelector('.home-community-retry');
    if(retryButton)retryButton.disabled=true;
    else if(rendered[action]===undefined)node.innerHTML='<p class="home-community-status" role="status">공개 목록을 불러오는 중입니다.</p>';
    let timeout;
    try{
      if(!window.MONC?.sb)throw new Error('연결 없음');
      const data={limit:3};
      if(action==='posts')data.topic='prep';
      const result=await Promise.race([
        MONC.sb.rpc('community_read',{p_action:action,p_data:data}),
        new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('시간 초과')),12000);})
      ]);
      if(result.error || !result.data?.ok || !Array.isArray(result.data.items))throw new Error('목록 오류');
      const rows=result.data.items.slice(0,3), snapshot=JSON.stringify(rows);
      node.querySelector('.home-community-stale')?.remove();
      if(rendered[action]!==snapshot) {
        node.innerHTML=rows.map(row=>rowHtml(row,action)).join('')||
          '<p class="home-community-status" role="status">'+(action==='posts'?'아직 공개된 승준정보 글이 없습니다.':'현재 공개된 모집 중 스터디가 없습니다.')+'</p>';
        rendered[action]=snapshot;
      }
    } catch(error) {
      if(rendered[action]===undefined) retry(node,action,action==='posts'?'승준정보를 불러오지 못했습니다.':'스터디 모집글을 불러오지 못했습니다.');
      else if(!node.querySelector('.home-community-stale')) {
        const message=document.createElement('div');
        message.className='home-community-stale';
        message.innerHTML='<p class="home-community-status" role="status">목록을 갱신하지 못해 이전 정보를 표시하고 있습니다.</p><button type="button" class="home-community-retry">다시 불러오기</button>';
        message.querySelector('button').addEventListener('click',()=>load(action));
        node.appendChild(message);
      }
    } finally {
      clearTimeout(timeout);busy[action]=false;node.setAttribute('aria-busy','false');
      node.querySelectorAll('button').forEach(button=>button.disabled=false);
    }
  }
  // 로딩·오류 문구 높이 변화로 관찰 경계에 재진입해도 요청이 연속 발생하지 않게 한다.
  function refresh(){if(visible&&!document.hidden && Date.now()-(lastAttempt[selected]||0)>1000)load(selected);}
  function sync(){clearInterval(timer);timer=null;if(visible&&!document.hidden){refresh();timer=setInterval(refresh,30000);}}
  function select(tab) {
    selected=tab.dataset.communityTab;
    tabs.forEach(button=>{
      const active=button===tab;
      button.setAttribute('aria-selected',String(active));
      button.tabIndex=active?0:-1;
      document.getElementById(button.getAttribute('aria-controls')).hidden=!active;
    });
    clearInterval(timer);timer=null;
    if(visible&&!document.hidden){load(selected);timer=setInterval(refresh,30000);}
  }
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>select(tab));
    tab.addEventListener('keydown',event=>{
      let next;
      if(event.key==='ArrowRight')next=(index+1)%tabs.length;
      if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
      if(event.key==='Home')next=0;
      if(event.key==='End')next=tabs.length-1;
      if(next===undefined)return;
      event.preventDefault();tabs[next].focus();select(tabs[next]);
    });
  });
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('pagehide',()=>{clearInterval(timer);timer=null;});
  window.addEventListener('pageshow',sync);
  if('IntersectionObserver' in window){
    new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);sync();}).observe(section);
  }else{visible=true;sync();}
})();
