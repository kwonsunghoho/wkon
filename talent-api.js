// 비회원 접수 전용. 회원 세션·분석 스크립트를 불러오지 않는다.
window.submitTalentApplication=async function(payload){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
 try{const res=await fetch('https://apzwauiumhmsvrgffjis.supabase.co/functions/v1/talent-submit',{method:'POST',headers:{'Content-Type':'application/json','apikey':'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwendhdWl1bWhtc3ZyZ2ZmamlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NzQ1ODYsImV4cCI6MjA5ODU1MDU4Nn0.RzqVWeNhGe3bWzEIwU1HZ7hjE1bhQxIxJcvSFTjrN_Y','Authorization':'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwendhdWl1bWhtc3ZyZ2ZmamlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NzQ1ODYsImV4cCI6MjA5ODU1MDU4Nn0.RzqVWeNhGe3bWzEIwU1HZ7hjE1bhQxIxJcvSFTjrN_Y'},body:JSON.stringify(payload),signal:controller.signal});
 const data=await res.json().catch(()=>({}));if(!res.ok||!data.ok){const e=new Error(data.code||'unavailable');throw e;}return data;
 }finally{clearTimeout(timer);}
};

window.checkTalentReady=async function(){try{const result=await window.submitTalentApplication({probe:true});return result.ready===true;}catch{return false;}};
