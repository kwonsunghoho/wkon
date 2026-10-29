// 실제 서버 본문을 실행해 학생/관리자 읽기와 서명 URL 발급 경계를 검증한다.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
const uid='00000000-0000-4000-8000-000000000001',eid='00000000-0000-4000-8000-000000000010',lid='00000000-0000-4000-8000-000000000021';
function setup(o={}){
 let handler;const signed=[],calls=[];const enrollment={id:eid,member_id:o.other?'other':uid,course_id:'expression-advanced',admin_preview:!!o.preview,started_at:o.unstarted?null:new Date().toISOString(),expires_at:o.expired?new Date(Date.now()-1000).toISOString():null,revoked_at:null};
 const tables={members:[{id:uid,role:o.role||'member',agreed_at:'yes',terms_version:'2026-10-05'}],online_courses:[{id:'expression-advanced',revision:1,published:false,sale_open:false}],online_enrollments:o.empty?[]:[enrollment],online_lessons:[{id:lid,course_id:'expression-advanced',published:o.published!==false,video_path:'private/video.mp4',duration_seconds:1200}],online_progress:[]};
 tables.online_course_notes=[{member_id:uid,lesson_id:lid,body:'본인 필기',revision:1},{member_id:'other',lesson_id:lid,body:'타인 필기',revision:1}];
 tables.online_lessons[0].chapters=[{seconds:0,title:'시작'},{seconds:15,title:'연습'}];
 const client={auth:{getUser:async()=>({data:{user:o.noUser?null:{id:uid}}})},from(t){let rows=tables[t]||[];const result=()=>({data:rows,error:null});const q={select(){return q},eq(k,v){rows=rows.filter(r=>r[k]===v);return q},in(k,a){rows=rows.filter(r=>a.includes(r[k]));return q},order(){return q},single:async()=>({data:rows[0],error:null}),maybeSingle:async()=>({data:rows[0],error:null}),then(resolve,reject){return Promise.resolve(result()).then(resolve,reject)}};return q},rpc:async(n,a)=>{calls.push({n,a});return{data:{ok:true,startedAt:enrollment.started_at||new Date().toISOString(),expiresAt:new Date(Date.now()+864e6).toISOString()},error:null}},storage:{from(){return{list:async()=>({data:o.missing?[]:[{name:'video.mp4'}],error:null}),createSignedUrl:async(path,ttl)=>{signed.push({path,ttl});return {data:{signedUrl:'https://private.invalid/video'},error:null}}}}}};
 const code=stripTypeScriptTypes(fs.readFileSync('supabase/functions/online-course/index.ts','utf8').replace(/^import .*?\r?\n/m,''));
 vm.runInNewContext(code,{createClient:()=>client,Deno:{serve:f=>handler=f,env:{get:()=> 'https://test.supabase.co'}},Request,Response,console:{error(){}},crypto:globalThis.crypto});
 return{signed,calls,run:async(action,rest={})=>{const r=await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({action,enrollmentId:eid,lessonId:lid,...rest})}));return{status:r.status,...await r.json()}}};
}
(async()=>{
 let h=setup({noUser:true});assert.equal((await h.run('play')).status,401);
 h=setup({other:true});assert.equal((await h.run('play')).error,'not_enrolled');assert.equal(h.signed.length,0);
 h=setup({expired:true});assert.equal((await h.run('play')).error,'access_expired');assert.equal(h.signed.length,0);
 h=setup({published:false});assert.equal((await h.run('play')).error,'lesson_unavailable');assert.equal(h.signed.length,0);
 h=setup({preview:true,published:false});assert.equal((await h.run('play')).error,'not_enrolled');assert.equal((await h.run('library')).enrollments.length,0);
 h=setup({role:'admin',preview:true,published:false,unstarted:true});assert.equal((await h.run('view')).lessons.length,1);assert.equal(h.calls.length,0);assert.equal((await h.run('play')).ok,true);assert.equal(h.signed[0].ttl,90);assert.equal(h.calls[0].a.p_member,uid);assert.equal(h.calls[0].n,'oc_start');
 h=setup({missing:true});assert.equal((await h.run('play')).error,'content_not_ready');assert.equal(h.calls.length,0);
 h=setup({empty:true});assert.equal((await h.run('library')).enrollments.length,0);
 h=setup();assert.equal((await h.run('catalog')).error,'not_published');assert.equal((await h.run('admin-classroom')).status,403);assert.equal((await h.run('progress',{position:-1})).error,'bad_progress');assert.equal((await h.run('progress',{position:137})).ok,true);assert.equal(h.calls[0].a.p_position,137);
 h=setup();let n=await h.run('notes');assert.equal(n.notes.length,1);assert.equal(n.notes[0].body,'본인 필기');assert.equal(n.notes[0].enrollmentId,eid);assert.ok(!JSON.stringify(n).includes('private/'));
 assert.equal((await h.run('notes',{lessonId:'other'})).notes.length,0);
 assert.equal((await h.run('note-save',{body:'메모',revision:0,memberId:'other'})).ok,true);assert.equal(h.calls[0].a.p_member,uid);assert.equal(h.calls[0].n,'oc_save_note');
 assert.equal((await h.run('note-save',{body:'x'.repeat(12001),revision:0})).error,'invalid_note');
 assert.equal((await h.run('note-save',{body:'메모',revision:-1})).error,'invalid_note');
 assert.equal((await h.run('view')).lessons[0].chapters[1].seconds,15);
 h=setup({expired:true});n=await h.run('notes');assert.equal(n.notes[0].body,'본인 필기');assert.equal(n.notes[0].enrollmentId,null);
 h=setup({role:'member',preview:true,published:false});assert.equal((await h.run('notes')).notes[0].enrollmentId,null);
 console.log('학생 Edge 검증 통과: 기존 재생/권한 경계·본인 필기만 조회·JWT 저장 주체·타인/자산 경로 비노출·만료 후 필기 보존·챕터 반환');
})().catch(e=>{console.error(e);process.exitCode=1});
