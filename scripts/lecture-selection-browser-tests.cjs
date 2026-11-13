// 신청·결제 SDK·운영 DB를 제거한 실제 특강 신청 HTML을 375px부터 검증한다.
// node scripts/lecture-selection-browser-tests.cjs --deps <node_modules>
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const {chromium}=require(path.join(opt('--deps'),'playwright'));
const base=opt('--url','http://127.0.0.1:5511'),out=path.resolve(opt('--out','outputs/home-full/lecture-multi-checks'));
const config=fs.readFileSync('supabase-config.js','utf8');
const helpers=config.slice(config.indexOf('  const DUP_ERRCODE'),config.indexOf('  // 챌린지 참가비 —'));
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const lid=id(1),sid=[11,12,13,14,15].map(id);
const stub=`
window.__calls=[]; window.__apps=[];window.__ready=true;
const p=new URLSearchParams(location.search);const uid='${id(100)}';
const lec={id:'${lid}',title:'대한항공 임원면접 특강 원데이',price:110000,visible:true,lecture_date:'2026-11-17',recruit_start:'2026-11-01',recruit_end:'2026-11-30',seats_left:20,capacity:25,show_seats:false,instructor:'몬크 연구진',subtitle:'검토용 신청 화면',description:'',content:''};
window.__slots=${JSON.stringify(sid.map((id,i)=>({id,lecture_id:lid,slot_date:['2026-11-17','2026-11-18','2026-11-19','2026-11-19','2026-11-21'][i],start_time:['14:00','13:00','17:00','19:00','19:00'][i],end_time:['17:00','16:00','20:00','22:00','22:00'][i],seats_left:5,capacity:5,sort_order:i})))};
if(p.has('full'))__slots[1].seats_left=0;
if(p.has('noslots'))__slots=[];
if(p.has('free'))lec.price=0;
if(p.has('deposit'))lec.price_kind='deposit';
function entry(ids){return ids.length?ids.map(id=>{const s=__slots.find(s=>s.id===id);return{type:'lecture',lecture_id:lec.id,name:lec.title,price:lec.price,slot_id:id,slot:s.slot_date+' '+s.start_time}}):[{type:'lecture',lecture_id:lec.id,name:lec.title,price:lec.price}]}
function save(ids,paid){const a={id:'stub-'+__apps.length,lecture_id:lec.id,slot_ids:ids,slot_id:ids.length===1?ids[0]:null,challenges:entry(ids),member_id:uid,phone:'synthetic',total_price:lec.price*Math.max(ids.length,1),payment_status:paid?'paid':'pending'};__apps.push(a);ids.forEach(id=>{__slots.find(s=>s.id===id).seats_left--});return a}
if(p.has('applied'))save(['${sid[0]}'],false);
if(p.has('allapplied'))save([...__slots.map(s=>s.id)],false);
if(p.has('cancelled'))__apps.push({lecture_id:lec.id,slot_id:'${sid[0]}',payment_status:'cancelled',challenges:entry(['${sid[0]}'])});
window.MONC={getSession:async()=>p.has('guest')?null:{user:{id:uid},access_token:'local-stub'},getMyProfile:async()=>p.has('guest')?null:{id:uid,name:'검토 회원',phone:'01000000000',role:'member'},requireConsent:async()=>true,requireVerified:async()=>true,studentStatus:async()=>({student:p.has('student')}),saveMyProfile:async()=>({ok:true}),sb:{
auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
rpc:async(fn,body)=>{__calls.push({fn,body});return{data:fn==='lecture_multislot_ready'?__ready:[]}},
functions:{invoke:async(fn,{body})=>{__calls.push({fn,body});if(body.probe)return{data:{version:'2026-11-13-lecture-multi',lectureMultiSlot:__ready}};if(body.paymentId){save(body.slotIds||[body.slotId].filter(Boolean),true);return{data:{ok:true}}}return{data:{ok:true}}}},
from(table){let payload;const q={select(){return q},eq(){return q},in(){return q},order(){return q},single(){return q},maybeSingle(){return q},insert(v){payload=v;return q},then(resolve,reject){if(payload){__calls.push({table,payload});__apps.push({...payload,payment_status:'pending'});(payload.slot_ids||[payload.slot_id].filter(Boolean)).forEach(id=>__slots.find(s=>s.id===id).seats_left--);return Promise.resolve({error:null}).then(resolve,reject)}return Promise.resolve({data:table==='special_lectures'?{...lec,price:window.__changedPrice??lec.price}:table==='lecture_slots'?__slots.map(s=>({...s})):table==='applications'?__apps:[],error:table==='lecture_slots'&&window.__slotReadFail?{message:'검증용 조회 실패'}:null}).then(resolve,reject)}};return q}
}};
(function(){const sb=MONC.sb;${helpers}
Object.assign(MONC,{programKey,applicationProgramKeys,isLiveApplication,isDuplicateError,myAppliedPrograms});})();
MONC.applyFreeLecture=async(lid,ids)=>{__calls.push({fn:'applyFreeLecture',lid,ids});save(ids,false);return{ok:true}};
window.moncPay={storeId:'local-stub',channels:{toss:'stub',kakao:'stub'},kakaoReady:()=>true};
window.PortOne={requestPayment:async(order)=>{__calls.push({fn:'requestPayment',order});return {}}};
if(p.has('return'))localStorage.setItem('monc_pending_lecture_pay',JSON.stringify([{paymentId:'stub-return',lectureId:lec.id,slotIds:['${sid[0]}','${sid[1]}'],applicant:{name:'검토 회원',phone:'01000000000',member_id:uid},n:1}]));
`;
let html=fs.readFileSync('lecture.html','utf8')
 .replace(/<script\b[^>]*src="(?:https:[^"]+|supabase-config\.js[^\"]*|pay-methods\.js[^\"]*)"[^>]*><\/script>/g,'')
 .replace(/<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?clarity\.ms(?:(?!<\/script>)[\s\S])*?<\/script>/g,'')
 .replace('<head>','<head><script>'+stub+'</script>');
fs.mkdirSync(out,{recursive:true});
const review=html.replace('<head>','<head><base href="../../../">').replace('<body>','<body><div style="padding:10px;text-align:center;background:#E4EAF1;font-size:13px">검토용 화면 · 실제 신청과 결제는 발생하지 않습니다.</div>');
fs.writeFileSync(path.join(out,'preview.html'),review);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:opt('--chrome','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe')});
 const context=await browser.newContext({viewport:{width:375,height:1200},reducedMotion:'reduce'});const errors=[];
 await context.route('**/*',route=>{const req=route.request();if(!req.url().startsWith(base+'/'))return route.abort();if(!['GET','HEAD'].includes(req.method()))throw Error('검증 중 실제 쓰기 차단');if(new URL(req.url()).pathname==='/lecture.html')return route.fulfill({contentType:'text/html; charset=utf-8',body:html});return route.continue()});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const open=async(q='')=>{await page.goto(base+'/lecture.html?id='+lid+q);await page.waitForSelector('#memberBadge[style*="block"], .lc-logingate');await page.addStyleTag({content:'html{scroll-behavior:auto!important}'});await page.evaluate(()=>document.fonts.ready);};
 const pick=async(i)=>page.locator('.lc-slot').nth(i).click();
 await open();assert.equal(await page.locator('input[name=lcSlot]:checked').count(),0);
 await page.locator('#tossBtn').click();assert.match(await page.locator('#lcErrSlot').innerText(),/골라/);
 await pick(0);await pick(1);assert.equal(await page.locator('input[name=lcSlot]:checked').count(),2);
 assert.equal(await page.locator('.pay-total .a').innerText(),'220,000원');assert.match(await page.locator('#selectionSummary').innerText(),/110,000원 × 2/);
 assert.equal(await page.locator('.lc-sticky .info .p').innerText(),'220,000원');
 await page.locator('#appConsent').check();await page.locator('#bankBtn').click();await page.locator('.bt-modal.open').waitFor({timeout:3000}).catch(async e=>{console.log(JSON.stringify({errors,state:await page.evaluate(()=>({calls:__calls,form:document.getElementById('applyBox').innerText,consent:document.getElementById('appConsent')?.checked}))}));throw e});assert.equal(await page.locator('.bt-amount .v').innerText(),'220,000원');await page.keyboard.press('Escape');
 await page.locator('#applyBox h2').click();await page.evaluate(()=>scrollTo(0,document.getElementById('applyBox').getBoundingClientRect().top+scrollY-76));await page.screenshot({path:path.join(out,'lecture-multi-select-375.png')});
 await page.locator('#tossBtn').click();await page.waitForFunction(()=>__apps.length===1);await page.waitForFunction(()=>document.querySelectorAll('.lc-slot.is-applied').length===2);
 const order=await page.evaluate(()=>__calls.find(c=>c.fn==='requestPayment').order);assert.equal(order.totalAmount,220000);assert.deepEqual(order.customData.slots,sid.slice(0,2));assert.equal(await page.locator('input[name=lcSlot]:disabled').count(),2);
 await pick(2);await page.locator('#appConsent').check();await page.locator('#kakaoBtn').click();await page.waitForFunction(()=>__apps.length===2);
 await open('&applied');assert.equal(await page.locator('input[name=lcSlot]:disabled').count(),1);await pick(1);assert.equal(await page.locator('.pay-total .a').innerText(),'110,000원');
 await page.evaluate(()=>{document.activeElement?.blur();scrollTo({top:document.getElementById('applyBox').getBoundingClientRect().top+scrollY-76,behavior:'instant'})});await page.waitForFunction(()=>Math.abs(document.getElementById('applyBox').getBoundingClientRect().top-76)<2);await page.screenshot({path:path.join(out,'lecture-multi-applied-375.png')});
 await open('&cancelled');assert.equal(await page.locator('input[name=lcSlot]:disabled').count(),0);
 await open('&allapplied');assert.equal(await page.locator('#stickyGo').isDisabled(),true);assert.equal(await page.locator('input[name=lcSlot]:disabled').count(),5);assert.ok(!(await page.locator('#appliedNote').innerText()).includes('추가로'));
 await open('&full');assert.equal(await page.locator('input[name=lcSlot]:disabled').count(),1);
 await open('&student');await pick(0);await pick(1);assert.equal(await page.locator('.pay-total .a').innerText(),'무료');await page.locator('#appConsent').check();await page.locator('#stuFreeBtn').click();await page.waitForFunction(()=>__apps.length===1);assert.equal((await page.evaluate(()=>__calls.find(c=>c.fn==='applyFreeLecture').ids)).length,2);
 await open('&free');await pick(0);await pick(1);await page.locator('#appConsent').check();await page.locator('#freeBtn').click();await page.waitForFunction(()=>__apps.length===1);assert.equal((await page.evaluate(()=>__calls.find(c=>c.table==='applications').payload)).slot_ids.length,2);
 await open('&deposit');await pick(0);await pick(1);assert.equal(await page.locator('.pay-total .l').innerText(),'총 예약금');assert.equal(await page.locator('.lc-sticky .info .p').innerText(),'예약금 220,000원');
 await open();await pick(0);await pick(1);await page.locator('#appConsent').check();await page.evaluate(()=>__ready=false);await page.locator('#tossBtn').click();assert.match(await page.locator('#lcErrSlot').innerText(),/준비 중/);assert.equal(await page.evaluate(()=>__calls.filter(c=>c.fn==='requestPayment').length),0);
 await open('&guest');assert.equal(await page.locator('#tossBtn').count(),0);assert.match(await page.locator('.lc-loginbtn').getAttribute('href'),/login/);
 await open('&noslots');await page.locator('#appConsent').check();await page.locator('#tossBtn').click();await page.waitForFunction(()=>__apps.length===1);assert.equal(await page.locator('#tossBtn').count(),0);
 await open('&return&payresult=1&paymentId=stub-return');await page.waitForFunction(()=>__apps.length===1);assert.equal(await page.evaluate(()=>localStorage.getItem('monc_pending_lecture_pay')),null);await page.waitForFunction(()=>document.querySelectorAll('.lc-slot.is-applied').length===2);assert.equal(new URL(page.url()).searchParams.has('payresult'),false);
 await open();await pick(0);await pick(1);await page.locator('#appConsent').check();await page.evaluate(()=>__changedPrice=120000);await page.locator('#tossBtn').click();assert.equal(await page.evaluate(()=>__calls.filter(c=>c.fn==='requestPayment').length),0);assert.equal(await page.locator('.pay-total .a').innerText(),'240,000원');
 await open();await pick(0);await pick(1);await page.locator('#appConsent').check();await page.evaluate(()=>__slotReadFail=true);await page.locator('#tossBtn').click();await page.waitForFunction(()=>__apps.length===1);assert.equal(await page.evaluate(()=>__calls.find(c=>c.fn==='requestPayment').order.totalAmount),220000);
 for(const width of [375,320,768,1280]){await page.setViewportSize({width,height:1050});await open();await pick(0);await pick(1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);const sizes=await page.locator('.lc-slot').evaluateAll(rows=>rows.map(r=>r.getBoundingClientRect().height));assert.ok(sizes.every(h=>h>=44));if(width===1280)await page.screenshot({path:path.join(out,'lecture-multi-1280.png'),fullPage:true});}
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({widths:[375,320,768,1280],checks:['두 개 선택·해제·합산액·동의·계좌 안내','토스·카카오 결제·추가 신청·기존 시간대 잠금','재학생 무료·무료·예약금·단일 일정·로그인','서버 미준비 시 결제 전 차단·터치 44px·가로 넘침'],errors},null,2));
 await browser.close();console.log('특강 신청 화면·금액·각 신청 경로·모바일 4개 폭 검사 통과');
})().catch(e=>{console.error(e);process.exit(1)});
