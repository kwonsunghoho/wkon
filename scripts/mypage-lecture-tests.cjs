// 운영 연결 없이 실제 마이페이지 함수를 합성 데이터와 375px 화면에서 검증한다.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const html=fs.readFileSync('mypage.html','utf8');
const code=html.slice(html.indexOf('    async function loadMyApplications('),html.indexOf('    // ── 크레딧 지갑'));
const app={payment_status:'paid',lecture_id:'l',slot_ids:['s1','s2'],challenges:[{lecture_id:'l',slot_id:'s1',slot:'2099-11-19 17:00'},{lecture_id:'l',slot_id:'s2',slot:'2099-11-21 19:00'}]};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'});
 try {
 const page=await browser.newPage({viewport:{width:375,height:812}});
 await page.route('**/*',r=>r.abort());
 const css=['tokens.css'].filter(fs.existsSync).map(p=>fs.readFileSync(p,'utf8')).join('\n')+html.match(/<style>([\s\S]*?)<\/style>/)[1];
 const section=html.slice(html.indexOf('        <details class="v2-fold" id="sec-apps"'),html.indexOf('        <details class="v2-fold" id="sec-ba"'));
 await page.setContent('<style>'+css+'</style><main style="padding:20px"><h1>마이페이지</h1><div id="upWrap"></div>'+section+'</main>');
 await page.evaluate(source=>{
  window.esc=s=>String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;');window.fmtLecDate=s=>s;
  window.cfg={};window.filters=[];
  window.MONC={sb:{from(table){const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},in(){return q},then(resolve,reject){if(cfg.throws)return Promise.reject(new Error('offline')).then(resolve,reject);return Promise.resolve({data:table==='applications'?cfg.apps||[]:table==='special_lectures'?[{id:'l',title:'검증용 특강',lecture_date:'2020-01-01'}]:cfg.slots||[],error:cfg.error?{message:'offline'}:null}).then(resolve,reject)}};return q}}};
  window.eval(source+'\nwindow.readApps=loadMyApplications;window.readLectures=loadMyLectures;');
 },code);
 await page.evaluate(async()=>{cfg.error=true;await readApps('member-test')});
 assert.match(await page.locator('#myApps').innerText(),/불러오지 못/);
 assert.equal(await page.locator('#sec-apps').getAttribute('open'),'');
 assert.deepEqual(await page.evaluate(()=>filters),[['member_id','member-test']]);
 // 재시도 버튼은 실제 새로고침을 연결했는지 함수 본문에서도 확인한다.
 assert.match(code,/retryMyApps.*addEventListener\('click', \(\) => location.reload\(\)\)/);
 fs.mkdirSync('outputs/mypage-check',{recursive:true});
 await page.screenshot({path:'outputs/mypage-check/error-375.png'});
 await page.evaluate(async a=>{cfg={};document.getElementById('sec-apps').style.display='none';await readLectures([a])},app);
 assert.equal(await page.locator('#upWrap .v2-up').count(),2);
 assert.match(await page.locator('#upWrap').innerText(),/2099-11-21/);
 await page.screenshot({path:'outputs/mypage-check/schedule-375.png'});
 await page.evaluate(async a=>{cfg={slots:[{id:'s1',lecture_id:'l',slot_date:'2099-12-01',start_time:'13:00',end_time:'16:00'}]};await readLectures([a,a])},app);
 assert.equal(await page.locator('#upWrap .v2-up').count(),2);
 assert.match(await page.locator('#upWrap').innerText(),/2099-12-01/);
 await page.evaluate(async a=>{document.getElementById('upWrap').innerHTML='';await readLectures([{...a,payment_status:'refunded'}])},app);
 assert.equal(await page.locator('#upWrap .v2-up').count(),0);
 await page.evaluate(async()=>{cfg={throws:true};await readApps('member-test')});
 assert.match(await page.locator('#myApps').innerText(),/다시 확인/);
 await page.evaluate(async()=>{cfg={};const a=await readApps('member-test');if(a.length)throw Error('빈 신청 오류')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=375),true);
 await Promise.all([page.waitForEvent('framenavigated'),page.locator('#retryMyApps').click()]);
 console.log('신청 조회 실패·예외·회원 필터·다중 일정·명세 복구·날짜 변경·중복·환불·375px 검사 통과');
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
