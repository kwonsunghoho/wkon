/* 온라인 강의 알림. 로그인·동의 후 본인 알림만 읽고 읽음 상태를 서버에 저장한다. */
(()=>{'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let host,loading=false;
 async function refresh(){
  if(loading||document.hidden)return;loading=true;
  try{
   const session=await MONC.getSession();if(!session){host?.remove();host=null;return;}
   const r=await MONC.sb.functions.invoke('online-course-feedback',{body:{action:'notifications'}});
   if(r.error||!r.data?.ok)return;
   if((await MONC.getSession())?.user.id!==session.user.id)return;
   const rows=r.data.rows||[];if(!rows.length)return;
   if(!host){host=document.createElement('section');host.className='course-notifications';host.setAttribute('aria-label','온라인 강의 알림');const learning=document.querySelector('#onlineLearning');if(learning)learning.insertAdjacentElement('beforebegin',host);else document.querySelector('main').insertAdjacentElement('afterbegin',host);}
   const open=host.querySelector('details')?.open,unread=rows.filter(n=>!n.read_at).length;
   host.innerHTML=`<details ${open?'open':''}><summary>온라인 강의 알림${unread?` <span>${unread}개 안 읽음</span>`:''}</summary><ul>${rows.map(n=>`<li><a href="course-feedback.html${n.admin_only?'?admin=1':''}" data-notice="${esc(n.id)}"><strong>${esc(n.title)}${n.read_at?'':' · 새 알림'}</strong><p>${esc(n.body)}</p><small>${new Date(n.created_at).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})}</small></a></li>`).join('')}</ul><p class="course-notice-status" role="status"></p></details>`;
   host.querySelectorAll('a[data-notice]').forEach(a=>a.addEventListener('click',async e=>{e.preventDefault();try{const x=await MONC.sb.functions.invoke('online-course-feedback',{body:{action:'notification-read',id:a.dataset.notice}});if(x.error||!x.data?.ok)throw Error();location.href=a.getAttribute('href');}catch{host.querySelector('.course-notice-status').textContent='읽음 상태를 저장하지 못했습니다. 다시 누르거나 과제·피드백에서 확인해 주세요.';}}));
  }finally{loading=false;}
 }
 document.addEventListener('DOMContentLoaded',()=>{MONC.sb.auth?.onAuthStateChange(()=>{host?.remove();host=null;});refresh().catch(()=>{});setInterval(()=>refresh().catch(()=>{}),60000);});
 window.addEventListener('focus',()=>refresh().catch(()=>{}));
})();
