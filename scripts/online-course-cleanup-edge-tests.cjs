const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
const lid='00000000-0000-4000-8000-000000000001';
function setup(o={}){
 let handler,committed=false;const removed=[],calls=[];
 const lesson={id:lid,course_id:'expression-advanced',revision:1,video_path:'old.mp4',material_path:null};
 const client={auth:{getUser:async()=>({data:{user:{id:'admin'}}})},from(t){const rows=t==='members'?[{role:o.member?'member':'admin',agreed_at:'yes',terms_version:'2026-10-05'}]:t==='online_lessons'?[lesson]:t==='online_video_cleanup'?(o.removeFail?[{path:'old.mp4'}]:[]):[{id:'expression-advanced',revision:1}];const q={select(){return q},eq(){return q},neq(){return q},limit(){return q},order(){return q},maybeSingle:async()=>({data:rows[0]}),then(r){return Promise.resolve({data:rows}).then(r)}};return q},rpc:async(n,a)=>{calls.push(n);if(n==='oc_admin_save'){committed=!o.saveFail;return {data:o.saveFail?{ok:false,error:'edit_conflict'}:{ok:true,lesson}}}if(n==='oc_claim_video_cleanup'){assert.ok(committed||o.load);return {data:[{path:'old.mp4',lease:'lease'}]}}return {data:null}},storage:{from(){return {list:async()=>({data:[{name:'00000000-0000-4000-8000-000000000002.mp4',id:'id',metadata:{size:100,mimetype:'video/mp4'}}]}),remove:async paths=>{assert.ok(committed||o.load);removed.push(...paths);if(o.throw)throw Error('offline');return {error:o.removeFail?{}:null}}}}}};
 vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/online-course/index.ts','utf8').replace(/^import .*\r?\n/m,'')),{createClient:()=>client,Deno:{env:{get:()=>''},serve:f=>handler=f},Request,Response,console});
 return {removed,calls,run:async()=>{const r=await handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({action:o.load?'admin-load':'admin-lesson',lessonId:lid,values:{revision:1,title:'강의',chapter:'기본',position:1,duration_seconds:10,published:true,video_path:`expression-advanced/${lid}/video/00000000-0000-4000-8000-000000000002.mp4`,video_name:'new.mp4',material_path:null,material_name:null}})}));return r.json()}};
}
(async()=>{
 // 파일 확인은 업로드된 경로의 정확한 이름으로 응답한다.

 for(const options of [{},{removeFail:true},{throw:true},{saveFail:true},{load:true},{member:true}]){
  const h=setup(options),r=await h.run();
  if(options.member){assert.equal(r.error,'forbidden');assert.equal(h.removed.length,0)}
  else if(options.saveFail){assert.equal(r.ok,false);assert.equal(h.removed.length,0)}
  else {assert.equal(r.ok,true);assert.equal(h.removed.length,1);if(options.removeFail||options.throw)assert.equal(r.cleanup.pending,true)}
 }
 console.log('영상 정리 Edge: 저장 성공 후 삭제·저장 실패 보호·삭제 실패에도 저장 성공·관리자 조회 재시도·회원 차단 통과');
})().catch(e=>{console.error(e);process.exitCode=1});

