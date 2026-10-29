/* 공개 소개 API만 조회한다. 구매 연결은 결제 검증을 완료한 뒤 별도로 연다. */
(() => {
 'use strict';
 const state=document.getElementById('catalog-state'),retry=document.getElementById('catalog-retry'),list=document.getElementById('catalog-courses'),count=document.getElementById('catalog-count');
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const duration=s=>Number.isFinite(s)&&s>0?`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`:'시간 안내 예정';
 let loading=false;
 async function load(){
  if(loading)return;loading=true;retry.hidden=true;state.hidden=false;state.textContent='강의를 불러오고 있습니다.';count.textContent='';list.replaceChildren();list.setAttribute('aria-busy','true');
  try{
   // 현재 운영 과정은 하나다. 비공개 응답에서는 과정 정보를 만들거나 노출하지 않는다.
   const {data,error}=await MONC.sb.functions.invoke('online-course',{body:{action:'catalog',courseId:'expression-advanced'}});
   if(error)throw new Error('network');
   if(data?.error==='not_published'){state.textContent='공개된 강의가 없습니다. 준비가 완료되면 이곳에서 안내합니다.';count.textContent='0개 과정';return;}
   if(!data?.ok||!data.course)throw new Error('unavailable');
   const c=data.course,lessons=Array.isArray(data.lessons)?data.lessons:[];
   const price=Number.isFinite(c.price)&&c.price>0?c.price.toLocaleString('ko-KR')+'원':'가격 안내 예정';
   const period=Number.isFinite(c.accessDays)&&c.accessDays>0?'첫 재생일부터 '+c.accessDays+'일':'수강 기간 안내 예정';
   list.innerHTML=`<article class="catalog-course" aria-labelledby="catalog-course-title"><div class="catalog-cover" aria-hidden="true"><span>INTERVIEW · ADVANCED</span><strong>${esc(c.title)}</strong><small>MONC ONLINE CLASS</small></div><div class="catalog-course-main"><p class="catalog-format">승무원 면접 · 온라인 심화과정</p><h3 id="catalog-course-title">${esc(c.title)}</h3><p class="catalog-description">${esc(c.description)}</p><dl class="catalog-facts"><div><dt>수강 기간</dt><dd>${esc(period)}</dd></div>${lessons.length?`<div><dt>강의 구성</dt><dd>총 ${lessons.length}강</dd></div>`:''}<div><dt>학습 방식</dt><dd>개별 피드백 없는 자율 학습</dd></div></dl><div class="catalog-course-bottom"><strong class="catalog-price">${esc(price)}</strong>${c.saleOpen?`<a class="catalog-button" href="course.html?course=${encodeURIComponent(c.id)}">수강 신청</a>`:'<button class="catalog-button" type="button" disabled>판매 준비 중</button>'}</div></div><details class="catalog-details"><summary>강의 구성과 수강 안내</summary>${lessons.length?`<ol>${lessons.map(l=>`<li>${esc(l.title)}<span>${esc(duration(l.duration))}</span></li>`).join('')}</ol>`:'<p>강의 구성을 준비하고 있습니다.</p>'}<p>구매한 강의는 내 강의실에서 시청할 수 있습니다. 강의별 메모와 영상 구간 이동을 지원합니다.</p>${c.purchaseNotice?`<p>${esc(c.purchaseNotice)}</p>`:''}</details></article>`;
   count.textContent='1개 과정';state.hidden=true;
  }catch{state.textContent='강의를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';retry.hidden=false;}
  finally{loading=false;list.setAttribute('aria-busy','false');}
 }
 retry.addEventListener('click',load);
 window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
 load();
})();
