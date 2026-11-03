// 신청자 현황의 전 과정 주문 조회: 관리자·동의·페이지·개인정보 범위·읽기 전용 검증.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),{stripTypeScriptTypes}=require('node:module');
function setup(role='admin'){
 let handler;const calls=[];
 const orders=Array.from({length:23},(_,i)=>({payment_id:'order-'+i,member_id:'member-'+i,course_id:i%2?'second':'expression-advanced',title:'검증 강의 '+i,created_at:'2026-11-03T00:00:00Z',amount:79000,state:'paid'}));
 const client={auth:{getUser:async()=>({data:{user:role==='anon'?null:{id:'actor'}}})},from(table){
  const filters=[],query={select(fields){calls.push({table,fields});return query},eq(key,value){filters.push([key,value]);return query},in(){return query},order(){return query},range(start,end){query.bounds=[start,end];return query},maybeSingle:async()=>({data:table==='members'?{id:'actor',role:role==='unagreed'?'admin':role,agreed_at:role==='unagreed'?null:'yes',terms_version:'2026-10-05'}:{id:'expression-advanced',revision:1}}),then(resolve,reject){
   let data=table==='online_orders'?orders.filter(o=>filters.every(([key,value])=>o[key]===value)):table==='members'?orders.map(o=>({id:o.member_id,name:'검증 회원',phone:'01000000000'})):[];
   if(query.bounds)data=data.slice(query.bounds[0],query.bounds[1]+1);return Promise.resolve({data}).then(resolve,reject);
  }};return query;
 },rpc(){throw Error('조회 중 RPC 쓰기 금지')}};
 vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/online-course/index.ts','utf8').replace(/^import .*\r?\n/m,'')),{createClient:()=>client,Deno:{serve:fn=>handler=fn,env:{get:()=> 'test'}},Request,Response,AbortSignal,console,fetch:()=>{throw Error('조회 중 외부 호출 금지')}});
 return {calls,async run(body){const response=await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({action:'admin-orders',...body})}));return{status:response.status,body:await response.json()}}};
}
(async()=>{
 for(const role of ['anon','member','unagreed']){const t=setup(role),r=await t.run({scope:'all'});assert.equal(r.body.ok,false);assert.equal(t.calls.filter(c=>c.table==='online_orders').length,0);}
 const t=setup(),first=await t.run({scope:'all',page:0});assert.equal(first.body.scope,'all');assert.equal(first.body.orders.length,20);assert.equal(first.body.more,true);assert.deepEqual([...new Set(first.body.orders.map(o=>o.course_id))],['expression-advanced','second']);assert.equal(first.body.orders[0].memberPhone,'01000000000');assert.equal(t.calls.some(c=>c.table==='online_courses'),false,'전 과정 주문 조회에 콘텐츠·파일 정리 호출 없음');
 const next=await t.run({scope:'all',page:1});assert.equal(next.body.orders.length,3);assert.equal(next.body.more,false);assert.equal(next.body.orders[0].payment_id,'order-20');
 const selected=await setup().run({courseId:'second',page:0});assert.equal(selected.body.scope,'course');assert.ok(selected.body.orders.every(o=>o.course_id==='second'));
 console.log('신청자 통합 주문 Edge: 관리자·동의·전체/과정별·페이지·전화·읽기 전용 통과');
})().catch(e=>{console.error(e);process.exitCode=1});
