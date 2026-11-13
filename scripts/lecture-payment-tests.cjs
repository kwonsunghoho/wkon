// 실제 Edge Function을 가짜 DB·결제사로 실행한다. 외부 결제·환불 호출은 없다.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const slots=[id(11),id(12)],uid=id(100),lid=id(1);
async function run(kind='verify',extra={},cfg={}) {
 let handler,saved,cancels=0;
 const lec={id:lid,title:'검증용 특강',price:110000};
 const cd={k:'lecture',uid,lid,slots,name:'검증 회원',phone:'synthetic-phone'};
 const pay={status:'PAID',amount:{total:220000},customData:JSON.stringify({...cd,...cfg.cd}),...cfg.pay};
 const client={auth:{getUser:async()=>({data:{user:cfg.noUser?null:{id:uid}}})},rpc:async()=>({data:!cfg.notReady}),from(table){
  let mode='read',payload;const filters={};
  const q={select(){return q},eq(k,v){filters[k]=v;return q},insert(p){mode='insert';payload=p;return q},single(){return q},maybeSingle(){return q},
   then(resolve,reject){let data=null,error=null;
    if(mode==='insert'){if(table==='applications'){saved=payload;error=cfg.insertError||null}return Promise.resolve({error}).then(resolve,reject)}
    if(table==='special_lectures')data=cfg.noLecture?null:lec;
    if(table==='lecture_slots'){data=(cfg.singleNoSlots?[]:slots.map(id=>({id,lecture_id:lid,slot_date:'2026-11-17',start_time:'14:00:00'})));if(cfg.slotReadFail)error={message:'synthetic read failure'};}
    if(table==='applications')data=cfg.already?{id:'app'}:null;
    if(table==='site_config')data={value:filters.key==='challenge_price'?33000:false};
    return Promise.resolve({data,error}).then(resolve,reject);
   }};return q}};
 const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/'+(kind==='verify'?'verify-payment':'portone-webhook')+'/index.ts','utf8').replace(/^import .*$/m,''));
 vm.runInNewContext(source,{Deno:{env:{get:key=>key==='PORTONE_WEBHOOK_SECRET'?undefined:'synthetic'},serve:f=>handler=f},createClient:()=>client,Response,console:{error(){}},crypto:require('node:crypto').webcrypto,fetch:async url=>{
  if(String(url).endsWith('/cancel')){cancels++;return{ok:true,json:async()=>({cancellation:{}})}}
  return{ok:true,json:async()=>pay};
 }});
 const body=kind==='verify'?{paymentId:'synthetic-payment',lectureId:lid,slotIds:slots,applicant:{name:'검증 회원',phone:'synthetic-phone'},...extra}:{type:'Transaction.Paid',data:{paymentId:'synthetic-payment'},...extra};
 const response=await handler(new Request('https://test.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
 return{body:await response.json(),status:response.status,saved,cancels};
}
(async()=>{
 let checks=0;
 for(const kind of ['verify','webhook']){
  let r=await run(kind);assert.equal(r.body.ok,true);assert.equal(r.saved.total_price,220000);assert.deepEqual(Array.from(r.saved.slot_ids),slots);assert.equal(r.saved.challenges.length,2);assert.equal(r.saved.member_id,uid);checks+=5;
  r=await run(kind,{}, {already:true});assert.equal(r.saved,undefined);assert.equal(r.cancels,0);checks+=2;
  r=await run(kind,{}, {pay:{amount:{total:110000}}});assert.equal(r.saved,undefined);checks++;
  for(const code of ['MC001','MC002','MC003']){r=await run(kind,{}, {insertError:{code,message:'synthetic'}});assert.equal(r.cancels,1);assert.equal(r.body.refunded,true);assert.equal(r.status,200);checks+=3;}
  r=await run(kind,{}, {insertError:{code:'23505',message:'duplicate payment'}});assert.equal(r.cancels,0);assert.equal(r.body.ok,true);checks+=2;
  r=await run(kind,{}, {slotReadFail:true});assert.equal(r.status,500);assert.equal(r.cancels,0);assert.equal(r.saved,undefined);checks+=3;
 }
 for(const ids of [[slots[0],slots[0]],[slots[0],id(999)],[null],[], 'invalid']){const r=await run('verify',{slotIds:ids});assert.equal(r.body.error,'slot_not_found');assert.equal(r.saved,undefined);checks+=2;}
 let r=await run('verify',{slotIds:[slots[0]]},{pay:{amount:{total:110000}}});assert.equal(r.body.error,'order_mismatch');assert.equal(r.saved,undefined);checks+=2;
 r=await run('verify',{}, {noUser:true});assert.equal(r.body.error,'login_required');assert.equal(r.saved,undefined);checks+=2;
 // 구 단일 시간대 주문과 과거 미결 기록의 복귀도 받는다.
 r=await run('verify',{slotIds:undefined,slotId:slots[0]}, {pay:{amount:{total:110000},customData:JSON.stringify({k:'lecture',uid,lid,slot:slots[0]})}});
 assert.equal(r.body.ok,true);assert.equal(r.saved.slot_id,slots[0]);assert.equal(r.saved.total_price,110000);checks+=3;
 r=await run('verify',{probe:true});assert.equal(r.body.lectureMultiSlot,true);assert.equal(r.saved,undefined);checks+=2;
 r=await run('verify',{probe:true},{notReady:true});assert.equal(r.body.lectureMultiSlot,false);checks++;
 console.log('특강 결제·웹훅 '+checks+'건 통과 — 운영 호출 없음');
})().catch(e=>{console.error(e);process.exitCode=1});
