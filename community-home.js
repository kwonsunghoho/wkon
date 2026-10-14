/* 비회원에게도 공개된 글과 모집글만 소개 홈에서 읽는다. */
(function () {
  'use strict';
  const section=document.getElementById('homeCommunity');
  if(!section)return;
  const posts=document.getElementById('homeCommunityPosts'), studies=document.getElementById('homeCommunityStudies');
  const topics={prep:'승준정보',hair:'헤메&샵',free:'자유게시판'}, categories={question:'질문',info:'정보 공유',free:'자유글'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const path=(view,id)=>'community.html?view='+view+'&id='+encodeURIComponent(id);
  async function read(action,limit) {
    const result=await MONC.sb.rpc('community_read',{p_action:action,p_data:{limit}});
    if(result.error||!result.data?.ok)throw new Error('목록 오류');
    return result.data.items.slice(0,limit);
  }
  function failed(node,text) {
    node.innerHTML='<p class="home-community-status">'+text+'</p><button type="button" class="home-community-retry">다시 불러오기</button>';
    node.querySelector('button').addEventListener('click',()=>load(node===posts?'posts':'studies'));
  }
  async function load(action) {
    const node=action==='posts'?posts:studies;
    node.setAttribute('aria-busy','true');
    node.innerHTML='<p class="home-community-status" role="status">불러오는 중입니다.</p>';
    try {
      const rows=await read(action,action==='posts'?2:1);
      if(action==='posts')node.innerHTML=rows.map(p=>'<article class="home-community-row"><p class="home-community-meta">'+esc(topics[p.topic]||'승준정보')+' · '+esc(categories[p.category])+'</p><a class="home-community-title" href="'+path('thread',p.id)+'">'+esc(p.title)+'</a><div class="home-community-foot"><span>'+esc(p.nickname)+'</span><span>댓글 '+Number(p.comments)+'</span></div></article>').join('')||'<p class="home-community-status">첫 질문을 남겨 보세요. 글과 댓글은 누구나 읽을 수 있어요.</p>';
      else node.innerHTML=rows.map(s=>'<article class="home-community-study"><div class="home-community-foot"><span class="home-community-tag">모집 중</span><span>'+Number(s.members)+'/'+Number(s.capacity)+'명</span></div><a class="home-community-title" href="'+path('study',s.id)+'">'+esc(s.title)+'</a><p class="home-community-meta">'+esc(s.mode==='online'?'온라인':s.location)+' · '+esc(s.schedule)+'</p><span class="home-community-meta">'+esc(s.min_level?'몬크 Lv.'+s.min_level+' 이상':'레벨 조건 없음')+(s.require_experience?' · 면접 경험 인증':'')+'</span></article>').join('')||'<p class="home-community-status">함께 준비할 스터디를 모집해 보세요.</p>';
    }catch(e){failed(node,action==='posts'?'최근 글을 불러오지 못했어요.':'스터디를 불러오지 못했어요.');}
    finally{node.setAttribute('aria-busy','false');}
  }
  // 인트로 렌더를 늦추지 않도록 실제로 가까이 온 뒤 목록을 읽는다.
  if('IntersectionObserver' in window) {
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();load('posts');load('studies');}},{rootMargin:'300px'});
    observer.observe(section);
  }else{load('posts');load('studies');}
})();
