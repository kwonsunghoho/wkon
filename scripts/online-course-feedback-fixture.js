/* 5542 로컬 서버 전용. 운영 SDK를 로드하기 전에 주입한다. */
(()=>{if(location.hostname!=='127.0.0.1'||location.port!=='5542')throw Error('로컬 검증 전용');const qs=new URLSearchParams(location.search),key='monc_feedback_fixture',uid='00000000-0000-4000-8000-000000000001';if(qs.has('reset'))localStorage.removeItem(key);const read=()=>JSON.parse(localStorage.getItem(key)||'null');const save=s=>localStorage.setItem(key,JSON.stringify(s));const user={user:{id:uid},access_token:'local-test-only'};
 async function invoke(fn,{body:b}){let f=read(),data={ok:true};if(fn!=='online-course-feedback')return{data:{ok:true},error:null};
  if(b.action==='view')data={ok:true,title:'영합각 심화',courseId:'expression-advanced',enrollmentId:'00000000-0000-4000-8000-000000000010',deadline:qs.has('expired')?'2026-10-29T14:59:00Z':'2026-11-13T14:59:00Z',eligible:!f&&!qs.has('expired')&&!qs.has('unstarted'),reason:qs.has('unstarted')?'not_started':'submission_closed',submission:f?{...f,draft:undefined,revision:undefined}:null};
  if(b.action==='submit'){if(f)data={ok:false,error:'already_submitted'};else{f={id:crypto.randomUUID(),body:b.body,submittedAt:new Date().toISOString(),hasVideo:!!b.uploadId,feedback:null,repliedAt:null,draft:'',revision:0};save(f);}}
  if(b.action==='admin-list')data={ok:true,hasMore:false,rows:f&&(b.filter!=='pending'||!f.repliedAt)?[{...f,name:'검증용 수강생'}]:[]};
  if(b.action==='admin-reply'){if(f.revision!==b.revision)data={ok:false,error:'edit_conflict'};else{f.draft=b.body;f.revision++;if(b.publish){f.feedback=b.body;f.repliedAt=new Date().toISOString();}save(f);}}
  if(b.action==='upload')data={ok:true,id:crypto.randomUUID(),endpoint:'/local-upload',bucket:'local',path:'local.mp4',token:'local-only',contentType:'video/mp4'};
  if(b.action==='summary')data={ok:true,rows:f?[{course_id:'expression-advanced',replied_at:f.repliedAt}]:[]};
  return{data,error:null};
 }
 const query=()=>{let q=new Proxy({},{get(_t,k){if(k==='then')return r=>Promise.resolve({data:[],count:0,error:null}).then(r);if(k==='single'||k==='maybeSingle')return async()=>({data:null,error:null});return()=>q;}});return q;};
 window.MONC={getSession:async()=>user,requireSession:async()=>user,requireConsent:async()=>true,requireAdmin:async()=>qs.get('admin')==='1',getMyProfile:async()=>({name:'검증용 수강생',role:qs.has('admin')?'admin':'member'}),getMyApplications:async()=>[],getMyWallet:async()=>({balance:0}),studentStatus:async()=>null,sb:{from:query,rpc:async()=>({data:null,error:null}),functions:{invoke},auth:{getSession:async()=>({data:{session:user}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}};
 window.tus={Upload:class{constructor(file,options){this.options=options;}start(){this.options.onProgress(100,100);this.options.onSuccess();}}};
 document.addEventListener('DOMContentLoaded',()=>{const el=document.createElement('p');el.textContent='로컬 검증 · 실제 제출·저장 없음';el.style.cssText='font-size:12px;color:#747b85;margin:16px 0';document.querySelector('main').append(el);});
})();
