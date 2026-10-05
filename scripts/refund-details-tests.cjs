// 환불 함수 회귀 검사 — 인증·DB·포트원은 스텁이며 실제 결제는 호출하지 않는다.
const {readFileSync}=require('node:fs');
const {stripTypeScriptTypes}=require('node:module');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const src=stripTypeScriptTypes(readFileSync('supabase/functions/cancel-payment/index.ts','utf8').replace(/^import .*$/m,''));
async function test(body, config={}) {
 let handler,calls=0,saved,updated;
 const app={id:'app',payment_id:'pay',paid_amount:66000,refunded_amount:0,challenges:[{challenge:'voice',round:5},{challenge:'answer',round:5}],...config.app};
 const client={auth:{getUser:async()=>({data:{user:config.noUser?null:{id:'admin'}}})},from(table){const q={select(){return q},eq(){return q},single:async()=> table==='members'?{data:{role:config.role||'admin'}}:{data:app},limit:async()=>({error:config.notReady?{}:null}),update(p){updated=p;return {eq:async()=>({error:config.writeFail?{}:null})}},insert:async p=>{saved=p;return {error:config.writeFail?{}:null}}};return q}};
 vm.runInNewContext(src,{Deno:{env:{get:()=> 'test'},serve:f=>handler=f},createClient:()=>client,Response,console:{error(){}},fetch:async()=>{calls++;return {ok:!config.pgFail,status:502,json:async()=>({cancellation:{id:'cancel'}})}}});
 const res=await handler(new Request('https://test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
 return {body:await res.json(),status:res.status,calls,saved,updated};
}
(async()=>{
 const base={applicationId:'app',amount:33000,itemIndexes:[1]};
 for(const [label,body,cfg,err] of [
 ['로그인',base,{noUser:true},'unauthorized'],['권한',base,{role:'member'},'forbidden'],
 ['누락',{...base,itemIndexes:undefined},{},'invalid_items'],['남의 항목',{...base,itemIndexes:[2]},{},'invalid_items'],
 ['중복',{...base,itemIndexes:[1,1]},{},'invalid_items'],['문자 인덱스',{...base,itemIndexes:['1']},{},'invalid_items'],
 ['초과',{...base,amount:66001},{},'amount_exceeds'],['전액 일부',{...base,amount:66000},{},'invalid_items'],
 ['미적용',base,{notReady:true},'not_ready']]) {const r=await test(body,cfg);assert.equal(r.body.error,err,label);assert.equal(r.calls,0,label);}
 let r=await test({...base,items:[{challenge:'FAKE'}]});assert.equal(r.body.ok,true);assert.deepEqual(JSON.parse(JSON.stringify(r.saved.items)),[{challenge:'answer',round:5}]);assert.equal(r.body.payment_status,'partial_refunded');
 r=await test({...base,amount:66000,itemIndexes:[0,1]});assert.equal(r.body.payment_status,'refunded');assert.equal(r.updated.refunded,true);
 r=await test(base,{writeFail:true});assert.equal(r.body.ok,true);assert.ok(r.body.warning);assert.equal(r.calls,1);
 r=await test(base,{pgFail:true});assert.equal(r.body.error,'cancel_failed');assert.equal(r.saved,undefined);
 r=await test({probe:true});assert.equal(r.body.refundItems,true);assert.equal(r.calls,0);
 r=await test(base,{app:{refunded_amount:33000}});assert.equal(r.body.refunded_amount,66000);
 console.log('서버 검사 15건 통과 — 실제 외부 호출 없음');
})().catch(e=>{console.error(e);process.exit(1)});
