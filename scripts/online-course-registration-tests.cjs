// 실제 Edge 본문을 외부 연결 없이 실행해 공개 범위·권한·중복 등록·과정 연결을 확인한다.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
function setup(options={}){
 let handler;const calls=[];
 const tables={members:[{id:'actor',role:options.role||'admin',agreed_at:'yes',terms_version:options.noConsent?'old':'2026-10-05'}],online_courses:options.courses||[{id:'first',title:'기존 강의',published:true,revision:1,price:79000,access_days:14,sale_open:true},{id:'private',title:'비공개 강의',published:false,revision:1}],online_lessons:[]};
 const client={auth:{getUser:async()=>({data:{user:options.noUser?null:{id:'actor'}}})},from(table){let rows=tables[table]||[],error=null;const q={select(){return q},eq(k,v){rows=rows.filter(x=>x[k]===v);return q},order(){return q},range(a,b){rows=rows.slice(a,b+1);return q},insert(value){if(options.writeFailure)error={code:'XX000'};else if(tables[table].some(x=>x.id===value.id))error={code:'23505'};else tables[table].push({...value,revision:1,description:'',purchase_notice:null});return q},maybeSingle:async()=>({data:rows[0]||null,error}),then(resolve,reject){return Promise.resolve({data:rows,error:options.readFailure?{code:'XX000'}:error}).then(resolve,reject)}};return q},rpc:async(n,a)=>{calls.push({n,a});return {data:{ok:true,courseId:a.p_course},error:null}}};
 const code=stripTypeScriptTypes(fs.readFileSync('supabase/functions/online-course/index.ts','utf8').replace(/^import .*?\r?\n/m,''));
 vm.runInNewContext(code,{createClient:()=>client,Deno:{serve:f=>handler=f,env:{get:()=> 'https://test.invalid'}},Request,Response,console:{error(){}},crypto:globalThis.crypto});
 return {tables,calls,run:async body=>{const r=await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)}));return {status:r.status,...await r.json()}}};
}
(async()=>{
 const request={action:'admin-create-course',title:'새 면접 강의',requestId:'12345678-1234-4123-8123-123456789abc',published:true,sale_open:true,price:1};
 for(const opt of [{noUser:true},{role:'member'},{noConsent:true}]){const h=setup(opt),r=await h.run(request);assert.equal(r.ok,false);assert.equal(h.tables.online_courses.length,2);}
 let h=setup();for(const override of [{title:''},{title:' '},{title:'x'.repeat(101)},{requestId:'../existing'},{requestId:'first'}])assert.equal((await h.run({...request,...override})).error,'invalid_fields');
 const r=await h.run(request);assert.equal(r.ok,true);assert.equal(r.course.id,'course-'+request.requestId);assert.equal(r.course.published,false);assert.equal(r.course.sale_open,false);assert.equal(r.course.price,null);assert.equal(r.course.access_days,14);
 const duplicate=await h.run({...request,title:'재시도에서 다른 제목'});assert.equal(duplicate.course.title,request.title);assert.equal(h.tables.online_courses.length,3);
 assert.equal((await h.run({action:'catalog-list'})).courses.length,1);
 assert.equal((await h.run({action:'catalog',courseId:r.course.id})).error,'not_published');
 h.tables.online_courses.find(x=>x.id===r.course.id).published=true;
 const listed=await h.run({action:'catalog-list'});assert.equal(listed.courses.length,2);assert.ok(!JSON.stringify(listed).includes('revision'));assert.ok(!JSON.stringify(listed).includes('비공개'));
 assert.equal((await h.run({action:'catalog',courseId:r.course.id})).course.title,request.title);
 await h.run({action:'order',courseId:r.course.id,amount:49000,accessDays:21,accepted:true});assert.equal(h.calls[0].a.p_course,r.course.id);assert.equal(h.calls[0].a.p_member,'actor');
 assert.equal(h.tables.online_courses[0].price,79000);
 h=setup({courses:Array.from({length:205},(_,i)=>({id:'c'+i,title:'과정'+i,published:true}))});assert.equal((await h.run({action:'catalog-list'})).courses.length,205);
 h=setup({courses:[]});assert.deepEqual((await h.run({action:'catalog-list'})).courses,[]);
 h=setup({readFailure:true});assert.equal((await h.run({action:'catalog-list'})).ok,false);
 h=setup({writeFailure:true});assert.equal((await h.run(request)).error,'save_failed');assert.equal(h.tables.online_courses.length,2);
 h=setup({noUser:true});assert.equal((await h.run({action:'admin-delete-course',courseId:'first',revision:1,title:'기존 강의'})).status,401);
 h=setup({role:'member'});assert.equal((await h.run({action:'admin-delete-course',courseId:'first',revision:1,title:'기존 강의'})).status,403);assert.equal(h.calls.length,0);
 h=setup();assert.equal((await h.run({action:'admin-delete-course',courseId:'first',revision:1,title:'기존 강의',actor:'other'})).ok,true);assert.equal(h.calls[0].n,'oc_admin_delete_course');assert.equal(h.calls[0].a.p_actor,'actor');assert.equal(h.calls[0].a.p_course,'first');
 h=setup({courses:[]});const empty=await h.run({action:'admin-load'});assert.equal(empty.ok,true);assert.equal(empty.course,null);assert.deepEqual(empty.lessons,[]);
 console.log('새 과정 등록·공개 목록 검증 통과: 관리자/동의·비공개 기본값·중복 재시도·기존 과정 보존·과정별 결제·205개 조회·오류 처리');
})().catch(e=>{console.error(e);process.exitCode=1});
