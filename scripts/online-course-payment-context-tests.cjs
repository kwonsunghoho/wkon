// 외부 통신 없이 실제 Edge 함수 본문을 실행해 결제 검증 경계를 확인한다.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const order={payment_id:'monc-course-test',member_id:'member-a',course_id:'expression-advanced',amount:10000,state:'pending'};
function harness(file,options={}){
 const calls=[],rpc=[],updates=[];let handler;
 const pay={status:'PAID',storeId:'store-a2a17822-a4c8-4d25-ac38-939772dfb6d5',amount:{total:10000,cancelled:0},currency:'KRW',paidAt:new Date().toISOString(),customer:{id:'member-a'},channel:{type:'LIVE'},customData:JSON.stringify({k:'online-course',oid:order.payment_id,cid:order.course_id,uid:'member-a'}),...options.pay};
 const supa={auth:{getUser:async()=>({data:{user:options.noUser?null:{id:'member-a'}},error:null})},from(table){let update=null;const q={select(){return q},eq(){return q},update(v){update=v;updates.push(v);return q},limit(){return q},maybeSingle:async()=>({data:options.noOrder?null:order,error:options.dbError?{code:'XX000'}:null}),then(resolve,reject){return Promise.resolve({data:update,error:null}).then(resolve,reject)}};return q;},rpc:async(name,args)=>{rpc.push({name,args});return {data:options.rpcResult||{ok:true},error:options.rpcError?{}:null};}};
 const fetch=async(url,init)=>{calls.push({url,init});if(url.includes('/functions/v1/online-course-payment'))return new Response(JSON.stringify({ok:true}),{status:200});if(url.endsWith('/cancel'))return new Response(JSON.stringify({cancellation:{status:options.refundPending?'REQUESTED':'SUCCEEDED'}}),{status:options.refundFailure?502:200});return new Response(JSON.stringify(pay),{status:options.lookupStatus||200});};
 let source=fs.readFileSync(file,'utf8').replace(/^import .*?\r?\n/m,'');source=stripTypeScriptTypes(source);
 vm.runInNewContext(source,{createClient:()=>supa,Deno:{env:{get:k=>({SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',PORTONE_API_SECRET:'portone'}[k])},serve:f=>handler=f},fetch,Response,Request,console:{error(){}},URL,Date,JSON,Number,String,Math,crypto:globalThis.crypto,Uint8Array,TextEncoder,atob,btoa});
 return {calls,rpc,updates,async run(body,auth='service'){const response=await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(body)}));return {status:response.status,...await response.json()};}};
}
const path='supabase/functions/online-course-payment/index.ts';
(async()=>{
 let h=harness(path);assert.equal((await h.run({paymentId:order.payment_id},'user-token')).status,403);assert.equal(h.calls.length,0);
 h=harness(path);assert.equal((await h.run({paymentId:order.payment_id,memberId:'member-b'})).error,'order_owner_mismatch');assert.equal(h.calls.length,0);
 h=harness(path,{pay:{amount:{total:1}}});assert.equal((await h.run({paymentId:order.payment_id})).error,'amount_mismatch');assert.equal(h.rpc.length,0);
 h=harness(path,{pay:{currency:'USD'}});assert.equal((await h.run({paymentId:order.payment_id})).error,'amount_mismatch');
 h=harness(path,{pay:{status:'READY'}});assert.equal((await h.run({paymentId:order.payment_id})).error,'not_paid');assert.equal(h.rpc.length,0);
 h=harness(path);assert.equal((await h.run({paymentId:order.payment_id,memberId:'member-a'})).ok,true);assert.equal(h.rpc[0].name,'oc_settle');
 h=harness(path,{pay:{customData:'{}'}});assert.equal((await h.run({paymentId:order.payment_id})).refunded,true);assert.equal(h.rpc[0].name,'oc_revoke');assert.ok(h.calls.find(c=>c.url.endsWith('/cancel')).init.headers['Idempotency-Key'].startsWith('"course-refund-'));
 h=harness(path,{pay:{channel:{type:'TEST'}}});assert.equal((await h.run({paymentId:order.payment_id})).refunded,true);assert.ok(!h.rpc.some(r=>r.name==='oc_settle'));
 h=harness(path,{rpcError:true});assert.equal((await h.run({paymentId:order.payment_id})).status,503);assert.ok(!h.calls.some(c=>c.url.endsWith('/cancel')));
 h=harness(path,{pay:{status:'CANCELLED',amount:{total:10000,cancelled:10000}}});assert.equal((await h.run({paymentId:order.payment_id})).terminal,true);assert.equal(h.rpc[0].name,'oc_revoke');
 h=harness(path,{pay:{customData:'{}'},refundPending:true});assert.equal((await h.run({paymentId:order.payment_id})).error,'refund_pending');assert.equal(h.rpc.length,0);
 h=harness(path,{pay:{customData:'{}'},rpcError:true});const refund=await h.run({paymentId:order.payment_id});assert.equal(refund.refunded,true);assert.equal(refund.error,'revoke_failed');assert.equal(refund.status,503);
 h=harness('supabase/functions/verify-payment/index.ts');assert.equal((await h.run({paymentId:order.payment_id,courseId:order.course_id,memberId:'member-b'},'user-token')).ok,true);assert.equal(JSON.parse(h.calls[0].init.body).memberId,'member-a');
 h=harness('supabase/functions/verify-payment/index.ts',{noUser:true});assert.equal((await h.run({paymentId:order.payment_id,courseId:order.course_id})).status,401);assert.equal(h.calls.length,0);
 const ctx={k:'online-course',oid:order.payment_id,cid:order.course_id,uid:order.member_id};
 for(const customData of [ctx,JSON.stringify(ctx),JSON.stringify(JSON.stringify(ctx))]){h=harness(path,{pay:{customData}});assert.equal((await h.run({paymentId:order.payment_id})).ok,true);assert.ok(!h.calls.some(c=>c.url.endsWith('/cancel')))}
 for(const customData of [JSON.stringify(JSON.stringify({...ctx,uid:'other'})),JSON.stringify(JSON.stringify(JSON.stringify(ctx))),'null','[]','invalid']){h=harness(path,{pay:{customData}});assert.equal((await h.run({paymentId:order.payment_id})).refunded,true);assert.ok(!h.rpc.some(r=>r.name==='oc_settle'))}
 h=harness(path,{pay:{customData:JSON.stringify(JSON.stringify(ctx)),customer:{id:'other'}}});assert.equal((await h.run({paymentId:order.payment_id})).refunded,true);
 assert.ok(fs.readFileSync('online-course.js','utf8').includes("customData:{k:'online-course'"));
 console.log('온라인 강의 실제 주문 형식 및 Edge 검증 통과: 서비스 전용·JWT 소유자·금액·통화·미결제·정상 지급·문맥 변조·테스트 결제·환불·재시도');
})().catch(e=>{console.error(e);process.exitCode=1});
