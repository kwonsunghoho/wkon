/* 전체 메뉴의 펼침 상태만 관리한다. 권한·집계·저장 동작은 기존 관리자 코드가 맡는다. */
(function(){
 'use strict';
 let initialized=false,wasMobile=null;
 const media=matchMedia('(max-width:880px)');
 function sync(){
  const groups=[...document.querySelectorAll('#tabs .ad-menu-group')];
  const mobile=media.matches;
  if(wasMobile!==mobile){
   document.body.classList.remove('navopen');
   document.getElementById('mtMenu')?.setAttribute('aria-expanded','false');
   document.querySelectorAll('.shell>.smain,.shell>.mtop').forEach(n=>n.removeAttribute('inert'));
   groups.forEach(g=>{g.open=!mobile||!!g.querySelector('.tabbtn.active');g.querySelector('summary').tabIndex=mobile?0:-1;});
   wasMobile=mobile;
  }
  document.querySelector('#tabs .tabbtn.active')?.closest('.ad-menu-group')?.setAttribute('open','');
 }
 function init(){if(initialized)return sync();initialized=true;media.addEventListener('change',sync);document.querySelectorAll('#tabs .ad-menu-group').forEach(g=>g.addEventListener('toggle',()=>{if(!media.matches&&!g.open)g.open=true;}));sync();}
 window.MONCAdminUI={init,sync};
})();
