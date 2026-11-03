const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),{stripTypeScriptTypes}=require('module');
const id='00000000-0000-4000-8000-000000000001',fileId='00000000-0000-4000-8000-000000000002';
function setup(o={}){
 let handler,deleted=[],updates=[],fetches=[],claims=0;
 const now=new Date().toISOString();
 const tables={members:[{id,role:o.admin?'admin':'member',agreed_at:now,terms_version:'2026-10-05'}],online_course_feedback:[{id,member_id:id,course_id:'expression-advanced',upload_id:fileId,replied_at:o.expired?new Date(Date.now()-31*864e5).toISOString():null}],online_feedback_uploads:[{id:fileId,member_id:id,course_id:'expression-advanced',deleted_at:o.deleted?now:null,path:'feedback/'+id+'/'+fileId+'.mp4'}],online_feedback_notifications:[{id,member_id:id,admin_only:false,title:'접수'},{id:fileId,member_id:'other',admin_only:false},{id:'admin',member_id:id,admin_only:true}],online_feedback_jobs:[{id}]};
 const sb={auth:{getUser:async()=>({data:{user:{id}}}),admin:{getUserById:async()=>({data:{user:{email:'test@example.invalid'}}})}},from(t){let rows=tables[t]||[];const q={select(){return q},insert(){return q},update(v){updates.push({t,v});return q},eq(k,v){rows=rows.filter(r=>r[k]===v);return q},order(){return q},limit(){return q},maybeSingle:async()=>({data:rows[0]}),single:async()=>({data:rows[0]}),then(r){return Promise.resolve({data:rows}).then(r)}};return q;},rpc:async n=>{
  if(n==='oc_feedback_cleanup_claim')return{data:o.clean?[{id:fileId,member_id:id,path:o.badPath?'lessons/keep.mp4':'feedback/'+id+'/'+fileId+'.mp4',cleanup_started_at:now}]:[]};
  if(n==='oc_feedback_email_claim'){claims++;return{data:[{id,member_id:id,admin_only:false,title:'접수',body:'내용',email_claimed_at:now}]};}return{data:null};
 },storage:{from(){return{remove:async paths=>{deleted.push(...paths);return{error:o.storageFail?Error('failed'):null}},createSignedUrl:async()=>({data:{signedUrl:'private.invalid'}})}}}};
 const code=stripTypeScriptTypes(fs.readFileSync('supabase/functions/online-course-feedback/index.ts','utf8').replace(/^import .*\r?\n/m,''));
 vm.runInNewContext(code,{createClient:()=>sb,Deno:{serve:f=>handler=f,env:{get:k=>k==='SUPABASE_SERVICE_ROLE_KEY'?'server-secret':k==='SUPABASE_URL'?'https://test.invalid':o.email?'configured':undefined}},Request,Response,AbortSignal,fetch:async(url,opts)=>{fetches.push({url,opts});return new Response('{}',{status:o.mailFail?500:200})},crypto:globalThis.crypto});
 return{deleted,updates,fetches,get claims(){return claims},run:async(action,b={},token='member')=>{const r=await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({action,...b})}));return{status:r.status,...await r.json()}}};
}
(async()=>{
 let h=setup();assert.equal((await h.run('scheduled')).status,403);assert.equal(h.deleted.length,0);
 let r=await h.run('notifications');assert.equal(r.rows.length,1);assert.equal(r.rows[0].title,'접수');
 h=setup({expired:true});assert.equal((await h.run('media',{id})).error,'video_expired');
 h=setup({deleted:true});assert.equal((await h.run('media',{id})).error,'video_expired');
 h=setup({clean:true});r=await h.run('scheduled',{},'server-secret');assert.equal(r.deleted,1);assert.equal(r.emailConfigured,false);assert.equal(h.claims,0);assert.equal(h.fetches.length,0);
 h=setup({clean:true,badPath:true});r=await h.run('scheduled',{},'server-secret');assert.equal(h.deleted.length,0);assert.equal(r.ok,false);
 h=setup({clean:true,storageFail:true});r=await h.run('scheduled',{},'server-secret');assert.equal(r.deleted,0);assert.ok(!h.updates.some(x=>x.v.deleted_at));
 h=setup({email:true});r=await h.run('scheduled',{},'server-secret');assert.equal(r.sent,1);assert.equal(h.fetches[0].opts.headers['Idempotency-Key'],'monc-feedback-'+id);
 h=setup({email:true,mailFail:true});r=await h.run('scheduled',{},'server-secret');assert.equal(r.sent,0);assert.ok(h.updates.some(x=>x.v.email_state==='failed'));
 console.log('운영 Edge 검증 통과: 일정 인증·본인 알림·보관 만료·경로 보호·삭제 실패 재시도·메일 미연결/중복키/실패');
})();
