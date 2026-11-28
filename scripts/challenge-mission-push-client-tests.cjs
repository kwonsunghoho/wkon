const fs = require('node:fs'), path=require('node:path'), vm=require('node:vm'), assert=require('node:assert/strict');
const fromSite=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
class Element {
  children=[]; attrs={}; events={};
  setAttribute(k,v){this.attrs[k]=v;}
  replaceChildren(...children){this.children=children;}
  addEventListener(k,v){this.events[k]=v;}
}
async function fixture(mode='default',challenge='voice'){
  let permissionCalls=0,local=null,enabled=false;
  const rpcs=[];
  const reg={active:true,pushManager:{getSubscription:async()=>local,subscribe:async()=>local={
    endpoint:'https://fcm.googleapis.com/test',toJSON:()=>({endpoint:local.endpoint,keys:{p256dh:'x',auth:'y'}}),
  }}};
  const navigator={platform:'test',userAgent:mode==='ios'?'iPhone':'desktop',serviceWorker:{
    async register(url,opts){assert.equal(opts.scope,'https://monc.ai.kr/challenge-mission.html');return reg;},
  }};
  const Notification={async requestPermission(){permissionCalls++;return mode==='denied'?'denied':'granted';}};
  const sb={functions:{invoke:async()=>({data:{publicKey:'Zml4dHVyZQ'}})},rpc:async(fn,args)=>{
    assert.equal(fn,'challenge_room');assert.equal(args.p_data.round,3);assert.equal(args.p_data.challenge,challenge);rpcs.push(args.p_action);
    if(args.p_action==='push-enable')enabled=true;
    if(args.p_action==='push-disable')enabled=false;
    return {data:{ok:true,enabled}};
  }};
  const context={window:{Notification,PushManager:{},isSecureContext:true},navigator,document:{
    baseURI:'https://monc.ai.kr/challenge-mission.html?id=abc',createElement:()=>new Element(),
  },matchMedia:()=>({matches:false}),URL,Notification,atob,Uint8Array};
  vm.runInNewContext(fromSite('challenge-push.js'),context);
  const container=new Element();
  const run=()=>context.window.ChallengePush.mount(container,{sb,roundId:3,challenge});
  await run();
  assert.equal(permissionCalls,0);
  let [btn,hint]=container.children;
  if(mode==='ios'){assert.equal(btn.hidden,true);assert.match(hint.textContent,/홈 화면/);return;}
  await btn.events.click();
  if(mode==='denied'){assert.equal(rpcs.length,0);assert.match(hint.textContent,/허용/);return;}
  assert.equal(enabled,true);assert.equal(btn.attrs['aria-pressed'],'true');
  await run();[btn,hint]=container.children;assert.equal(btn.attrs['aria-pressed'],'true');
  await btn.events.click();assert.equal(enabled,false);assert.deepEqual(rpcs,['push-enable','push-status','push-disable']);
}
(async()=>{
  for(const mode of ['default','denied','ios'])await fixture(mode);
  for(const program of ['spinning','expression','answer'])await fixture('default',program);
  const handlers={},notes=[],opened=[];
  const self={addEventListener:(name,fn)=>handlers[name]=fn,location:{href:'https://monc.ai.kr/challenge-mission-sw.js'},
    registration:{showNotification:async(title,opts)=>notes.push({title,...opts})}, clients:{matchAll:async()=>[],openWindow:async u=>opened.push(u)}};
  vm.runInNewContext(fromSite('challenge-mission-sw.js'),{self,URL});
  const mission='12345678-1111-4111-a111-123456789111';
  let waiting;
  handlers.push({data:{json:()=>({mission,day:1})},waitUntil:p=>waiting=p});await waiting;
  handlers.notificationclick({notification:{data:notes[0].data,close(){}},waitUntil:p=>waiting=p});await waiting;
  assert.equal(opened[0],'https://monc.ai.kr/challenge-mission.html?id='+mission);
  for (const [challenge,label] of Object.entries({voice:'보신각',spinning:'스피닝',expression:'영합각',answer:'승자각'})) {
    handlers.push({data:{json:()=>({mission,day:2,challenge,round:3})},waitUntil:p=>waiting=p});
    await waiting;
    const notice=notes.at(-1);
    assert.ok((notice.title+' '+notice.body).includes(label));
    assert.match(notice.body,/DAY 2/);
  }
  console.log('Push opt-in, decline, restore state, disable, iOS guidance, direct mission click passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
