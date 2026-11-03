/* 공개 소개 API만 조회한다. 구매 연결은 결제 검증을 완료한 뒤 별도로 연다. */
(() => {
 'use strict';
 const state=document.getElementById('catalog-state'),retry=document.getElementById('catalog-retry'),list=document.getElementById('catalog-courses'),count=document.getElementById('catalog-count');
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let loading=false;
 async function load(){
  if(loading)return;loading=true;retry.hidden=true;state.hidden=false;state.textContent='강의를 불러오고 있습니다.';count.textContent='';list.replaceChildren();list.setAttribute('aria-busy','true');
  try{
   const {data,error}=await MONC.sb.functions.invoke('online-course',{body:{action:'catalog-list'}});
   if(error||!data?.ok||!Array.isArray(data.courses))throw new Error('unavailable');
   if(!data.courses.length){state.textContent='공개된 강의가 없습니다. 준비가 완료되면 이곳에서 안내합니다.';count.textContent='0개 과정';return;}
   list.innerHTML=data.courses.map((c,i)=>{
    const price=Number.isFinite(c.price)&&c.price>0?c.price.toLocaleString('ko-KR')+'원':'가격 안내 예정';
    const period=Number.isFinite(c.accessDays)&&c.accessDays>0?'첫 재생일부터 '+c.accessDays+'일':'수강 기간 안내 예정';
    return '<article class="catalog-course" aria-labelledby="catalog-course-title-'+i+'"><div class="catalog-cover" aria-hidden="true"><span>MONC · ONLINE</span><strong>'+esc(c.title)+'</strong><small>MONC INTERVIEW CLASS</small></div><div class="catalog-course-main"><p class="catalog-format">승무원 면접 · 온라인 심화과정'+(c.saleOpen?'':' · 판매 준비 중')+'</p><h3 id="catalog-course-title-'+i+'">'+esc(c.title)+'</h3><p class="catalog-description">'+esc(c.description)+'</p><dl class="catalog-facts"><div><dt>수강 기간</dt><dd>'+esc(period)+'</dd></div><div><dt>학습 방식</dt><dd>영상 학습 + 개별 피드백 1회</dd></div></dl><div class="catalog-course-bottom"><strong class="catalog-price">'+esc(price)+'</strong><a class="catalog-button" href="course.html?course='+encodeURIComponent(c.id)+'">강의 자세히 보기</a></div></div></article>';
   }).join('');
   count.textContent=data.courses.length+'개 과정';state.hidden=true;
  }catch{state.textContent='강의를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';retry.hidden=false;}
  finally{loading=false;list.setAttribute('aria-busy','false');}
 }
 retry.addEventListener('click',load);
 window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
 load();
})();
