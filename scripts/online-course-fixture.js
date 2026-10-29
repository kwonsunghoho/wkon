/* 5521 로컬 검증 서버에서만 주입한다. 운영 화면에서 로드하지 않는다. */
(() => {
 if(location.hostname!=='127.0.0.1'||!['5521','5531'].includes(location.port))throw new Error('로컬 검증 전용');
 const key='monc_course_fixture_v1',uid='00000000-0000-4000-8000-000000000001',eid='00000000-0000-4000-8000-000000000010';
 const qs=new URLSearchParams(location.search);if(qs.has('reset'))localStorage.removeItem(key);
 let state=JSON.parse(localStorage.getItem(key)||'{"enrollment":null,"progress":[]}');
 const persist=()=>localStorage.setItem(key,JSON.stringify(state));
 const course={id:'expression-advanced',title:'영합각 심화',description:'영상과 연습 자료로 혼자 학습하는 승무원 영상면접 심화과정입니다.',price:10000,accessDays:10,saleOpen:true,purchaseNotice:'수강 기간은 첫 재생일부터 10일입니다. 가격·강의 구성·구매 안내는 검증용 예시이며 결제가 발생하지 않습니다.'};
 const lessons=[{id:'00000000-0000-4000-8000-000000000021',position:1,title:'재생 동작 확인용 영상',chapter:'기능 검증용 목차',duration:30,hasVideo:true,hasMaterial:true},{id:'00000000-0000-4000-8000-000000000022',position:2,title:'회차 이동 확인용 영상',chapter:'기능 검증용 목차',duration:30,hasVideo:true,hasMaterial:false}];
 const enroll=()=>{if(!state.enrollment)state.enrollment={id:eid,course_id:course.id,title:course.title,access_days:course.accessDays,started_at:null,expires_at:null,revoked_at:null,created_at:new Date().toISOString()};persist();};
 lessons[0].chapters=[{seconds:0,title:'시작 구간 (검증용)'},{seconds:10,title:'연습 구간 (검증용)'},{seconds:20,title:'정리 구간 (검증용)'}];
 if(qs.get('scenario')==='enrolled')enroll();
 if(qs.get('scenario')==='expired'){enroll();state.enrollment.started_at=new Date(Date.now()-(course.accessDays+1)*864e5).toISOString();state.enrollment.expires_at=new Date(Date.now()-864e5).toISOString();persist();}
 const ended=()=>state.enrollment?.revoked_at||state.enrollment?.expires_at&&Date.parse(state.enrollment.expires_at)<=Date.now();
 async function invoke(fn,{body:b}){
  if(fn!=='online-course'&&fn!=='verify-payment')return {data:{ok:true,programs:[]},error:null};
  if(fn==='verify-payment'){enroll();return {data:{ok:true},error:null};}
  let data={ok:true,serverNow:new Date().toISOString()};
  if(b.action==='notes'||b.action==='note-save'){
   state=JSON.parse(localStorage.getItem(key)||'null')||state;state.notes=state.notes||{};
   if(qs.has('noteFailure')||b.action==='note-save'&&qs.has('noteSaveFailure'))return {data:{ok:false,error:'save_failed'},error:null};
   if(b.action==='note-save'){
    const old=state.notes[b.lessonId]||{body:'',revision:0};
    if(b.revision!==old.revision&&b.body!==old.body)return {data:{ok:false,error:'note_conflict'},error:null};
    state.notes[b.lessonId]={body:b.body,revision:old.revision+1,updatedAt:new Date().toISOString()};persist();return {data:{ok:true,note:state.notes[b.lessonId]},error:null};
   }
   const notes=Object.entries(state.notes).filter(([id])=>!b.lessonId||id===b.lessonId).map(([id,n])=>{const l=lessons.find(l=>l.id===id);return {...n,lessonId:id,lessonTitle:l.title,courseTitle:course.title,courseId:course.id,duration:l.duration,enrollmentId:ended()?null:eid};});
   return {data:{ok:true,notes,hasCourses:!!state.enrollment},error:null};
  }
  if(b.action==='catalog')data={...data,course,lessons};
  else if(b.action==='order')data=state.enrollment&&!ended()?{ok:false,error:'already_enrolled'}:{ok:true,paymentId:'local-course-payment',courseId:course.id,title:course.title,amount:10000,accessDays:course.accessDays};
  else if(b.action==='library')data.enrollments=state.enrollment?[{...state.enrollment,progress:state.progress}]:[];
  else if(!state.enrollment)data={ok:false,error:'not_enrolled'};
  else if(b.action==='view')data={...data,course,enrollment:{...state.enrollment},lessons,progress:state.progress.map(p=>({...p})),expired:!!ended()};
  else if(ended())data={ok:false,error:'access_expired'};
  else if(b.action==='play'){
   if(!state.enrollment.started_at){state.enrollment.started_at=new Date().toISOString();state.enrollment.expires_at=new Date(Date.now()+state.enrollment.access_days*864e5).toISOString();persist();}
   data={...data,startedAt:state.enrollment.started_at,expiresAt:state.enrollment.expires_at,url:location.origin+'/outputs/course-test-runtime/test-video.mp4',urlExpiresAt:new Date(Date.now()+9e4).toISOString()};
  }else if(b.action==='progress'){let p=state.progress.find(p=>p.lesson_id===b.lessonId);if(!p){p={lesson_id:b.lessonId,completed:false};state.progress.push(p);}p.position_seconds=b.position;p.updated_at=new Date().toISOString();p.completed=p.completed||b.position>=28;persist();}
  else if(b.action==='material')data=state.enrollment.started_at?{...data,url:location.origin+'/outputs/course-test-runtime/test-material.txt'}:{ok:false,error:'start_video_first'};
  return {data,error:null};
 }
 const query=()=>{let q=new Proxy({},{get(_t,k){if(k==='then')return(resolve)=>Promise.resolve({data:[],count:0,error:null}).then(resolve);if(k==='single'||k==='maybeSingle')return async()=>({data:null,error:null});return()=>q;}});return q;};
 window.MONC={getSession:async()=>({user:{id:uid}}),requireSession:async()=>({user:{id:uid}}),getMyProfile:async()=>({name:'검증용 수강생',role:'member'}),getMyApplications:async()=>[],getMyWallet:async()=>({balance:0}),studentStatus:async()=>null,requireConsent:async()=>true,sb:{from:query,rpc:async()=>({data:null,error:{message:'검증 범위 밖'}}),functions:{invoke},auth:{getSession:async()=>({data:{session:{user:{id:uid}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}};
 window.moncPay={storeId:'local-only',choose:async()=>'local-only'};
 window.PortOne={requestPayment:async()=>{enroll();return {paymentId:'local-course-payment'};}};
 document.addEventListener('DOMContentLoaded',()=>{const banner=document.createElement('div');banner.className='oc-test-banner';banner.innerHTML='<strong>기능 검증 · 실제 결제 없음</strong><span>가격·목차는 예시 · 수강 기간 10일</span><a href="course.html?reset=1">처음부터</a><a href="classroom-watch.html?enrollment='+eid+'&scenario=expired">만료 확인</a>';(document.querySelector('main')||document.querySelector('#main')||document.body).prepend(banner);const style=document.createElement('style');style.textContent='.oc-test-banner{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;font-size:12px;padding:12px 0;margin-bottom:20px;border-bottom:1px solid #ddd;color:#454c55}.oc-test-banner strong{font-weight:700}.oc-test-banner a{display:inline-flex;align-items:center;min-height:44px;text-decoration:underline}';document.head.append(style);});
})();
