// 승인된 차콜 메인의 화면·이동·공개 데이터 상태를 운영 통신 없이 검증한다.
// 실행: node scripts/home-journal-tests.cjs --deps <node_modules> --out <출력 폴더>
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),cp=require('child_process');
const args=process.argv.slice(2),opt=(n,d)=>args.includes(n)?args[args.indexOf(n)+1]:d;
const deps=opt('--deps'),base=opt('--url','http://127.0.0.1:5511'),out=path.resolve(opt('--out','outputs/home-full/approved-checks'));
if(!deps)throw Error('--deps 경로가 필요합니다.');
const {chromium}=require(path.join(deps,'playwright'));
const root=path.resolve(__dirname,'..');
const original=cp.execFileSync('git',['show','origin/main:index.html'],{cwd:root,encoding:'utf8'});
const current=fs.readFileSync(path.join(root,'index.html'),'utf8');
const intro=s=>s.match(/<section class="hero-intro"[\s\S]*?<\/section>/)[0];
assert.equal(intro(current).replace(/\r\n/g,'\n'),intro(original).replace(/\r\n/g,'\n'),'창문 인트로 마크업 보존');
for(const file of ['home-intro.js','home-intro.css','nav.js','nav.css']){
 assert.equal(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n'),cp.execFileSync('git',['show','origin/main:'+file],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n'),file+' 원본 보존');
}
assert.ok(!current.includes('outputs/home-full'),'시안 파일 참조 없음');
assert.ok(!current.includes('컨설팅 현장</figcaption>'),'삭제 요청 캡션 없음');
const stub=auth=>`
window.__mode='normal';window.__events=[];window.__rpcs=[];window.__reads=[];
window.moncBeacon=(event,meta)=>window.__events.push({event,meta});
async function result(key){
 if(window.__mode==='error')return {error:{message:'검증용 연결 실패'}};
 if(window.__mode==='empty')return {data:key==='reviews'?[]:{ok:true,items:[]}};
 if(key==='reviews'){
  var rows=[{kind:'challenge',challenge:'영합각',quote:'검증용 챌린지 후기입니다. '+('직접 연습하며 남긴 공개 후기의 원문을 확인하는 검증 문장입니다. ').repeat(6)},{kind:'ke20',quote:'검증용 수업 후기입니다. '+('원문을 바꾸지 않고 공개 후기를 보여주는지 확인합니다. ').repeat(6)},{kind:'consult',quote:'노출하면 안 되는 상담 후기'}];
  if(window.__mode==='keonly')rows=rows.filter(r=>r.kind==='ke20');
  if(window.__mode==='image')rows=[{kind:'ke20',url:'${base}/images/og-image.png'}];
  return{data:rows};
 }
 return{data:{ok:true,items:Array.from({length:4},(_,i)=>({id:key+'-'+i,title:'검증용 공개 '+key+' '+i,status:i===2?'closed':'open',members:i===1?4:1,capacity:4,created_at:'2026-10-29T00:00:00Z'}))}};
}
function query(table){window.__reads.push(table);var q={select:()=>q,eq:(key,value)=>{window.__reads.push([key,value]);return q},order:()=>q,then:(resolve,reject)=>result(table).then(resolve,reject)};return q}
window.MONC={getSession:async()=>${JSON.stringify(auth)}==='guest'?null:{user:{id:'local-test'}},getMyProfile:async()=>({name:'검증용 회원',role:${JSON.stringify(auth)}==='admin'?'admin':'member'}),sb:{from:query,rpc:async(name,args)=>{window.__rpcs.push({name,args});return result(args.p_action)}}};
`;
fs.mkdirSync(out,{recursive:true});
const report={widths:[],checks:[],errors:[]};
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:opt('--browser','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe')});
async function make(width=375,auth='guest'){
 const context=await browser.newContext({viewport:{width,height:812},reducedMotion:'reduce'});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/*',r=>{const url=r.request().url();if(url.startsWith(base+'/supabase-config.js'))return r.fulfill({contentType:'text/javascript',body:stub(auth)});if(!url.startsWith(base+'/'))return r.abort();if(!['GET','HEAD'].includes(r.request().method()))throw Error('운영 쓰기 차단');return r.continue()});
 await page.goto(base+'/index.html');await page.evaluate(()=>document.fonts.ready);
 await page.waitForFunction(()=>document.querySelectorAll('.monc-person').length===6,{},{timeout:10000}).catch(async error=>{console.error(JSON.stringify(await page.evaluate(()=>({ready:document.readyState,researchers:typeof window.MONC_RESEARCHERS,host:!!document.getElementById('homeResearchers'),scripts:[...document.scripts].map(s=>s.src)}))));console.error(report.errors);throw error});
 return{page,context};
}
async function loadData(page){await page.locator('#doors').scrollIntoViewIfNeeded();await page.locator('#homeReviews[aria-busy=false]').waitFor();await page.locator('#homeCommunity').scrollIntoViewIfNeeded();await page.locator('#homeCommunityPosts[aria-busy=false]').waitFor();await page.locator('#homeCommunityStudies[aria-busy=false]').waitFor()}
async function layout(page){
 const m=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,small:[...document.querySelectorAll('.home-journal *')].filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<12).map(e=>e.className),sections:[...document.querySelectorAll('.home-journal>section')].map(e=>({id:e.id||e.className,top:Math.round(e.getBoundingClientRect().top+scrollY)}))}));
 assert.ok(m.scroll<=m.width,'가로 넘침 '+JSON.stringify(m));assert.deepEqual(m.small,[]);return m;
}
try{
 for(const width of [320,375,768,1280]){
  console.log(width+'px 화면·동작 검증');
  const {page,context}=await make(width);await loadData(page);report.widths.push(await layout(page));
  assert.equal(await page.locator('#heroIntro').evaluate(e=>e.clientHeight),812);
  assert.equal(await page.locator('.home-journal>section').first().getAttribute('id'),'researchFeatures');
  assert.equal(await page.locator('.home-journal h1').textContent(),'나에게 맞는 준비.');
  assert.equal(await page.locator('.journal-scene,.opening-copy').count(),0);
  assert.equal(await page.locator('.journal-online figcaption').count(),0);
  assert.equal(await page.locator('.journal-online img').getAttribute('src'),'images/hero-expression.webp');
  assert.equal(await page.locator('.home-journal').evaluate(e=>e.innerText.includes('↗')),false);
  assert.equal(await page.locator('.service-card').first().evaluate(e=>e.offsetHeight),await page.locator('.service-card').last().evaluate(e=>e.offsetHeight));
  assert.equal(await page.locator('.monc-person img').first().evaluate(e=>getComputedStyle(e).filter),'none');
  assert.equal(await page.locator('.home-review').count(),2);assert.equal(await page.locator('.home-program-links').isVisible(),false);
  assert.deepEqual(await page.locator('.monc-person h3').allTextContents(),await page.evaluate(()=>MONC_RESEARCHERS.map(p=>p.name)));
  await page.locator('#homeResearcherNext').click();await page.waitForFunction(()=>document.getElementById('homeResearcherCount').textContent==='2 / 6');
  await page.locator('#homeResearchers').press('ArrowLeft');await page.waitForFunction(()=>document.getElementById('homeResearcherCount').textContent==='1 / 6');
  await page.locator('.person-details summary').first().click();assert.ok(await page.locator('.person-details').first().evaluate(e=>e.open));await page.locator('.person-details summary').first().click();
  await page.locator('.review-original summary').first().click();assert.ok(await page.locator('.review-original').first().evaluate(e=>e.open));await layout(page);await page.locator('.review-original summary').first().click();
  assert.equal(await page.locator('#homeCommunityPosts article').count(),3);
  assert.deepEqual(await page.locator('#homeCommunityStudies .home-community-tag').allTextContents(),['모집 중','정원 마감','모집 종료']);
  assert.deepEqual(await page.evaluate(()=>window.__rpcs.find(r=>r.args.p_action==='posts').args.p_data),{limit:3,topic:'prep'});
  await page.evaluate(()=>scrollTo(0,0));await page.waitForFunction(()=>document.querySelector('.home-contact-float').hidden);assert.equal(await page.locator('.home-contact-float').isVisible(),false);
  await page.locator('.hcta-main').click();assert.equal(new URL(page.url()).hash,'#researchFeatures');
  await page.waitForFunction(()=>Math.abs(document.getElementById('researchFeatures').getBoundingClientRect().top-88)<3);
  await page.waitForFunction(()=>!document.querySelector('.home-contact-float').hidden);assert.equal(await page.locator('.home-contact-float').isVisible(),true);
  await page.locator('#homeContact').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.home-contact-float').hidden);
  assert.equal(await page.locator('.home-kakao-button').getAttribute('href'),'https://pf.kakao.com/_iajxnX/chat');
  assert.equal(await page.locator('.home-kakao-button').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(254, 229, 0)');
  const small=await page.locator('.home-journal a,.home-journal button,.home-journal summary,.home-contact-float').evaluateAll(es=>es.filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').filter(e=>{var r=e.getBoundingClientRect();return r.width<44||r.height<44}).map(e=>e.textContent.trim()));assert.deepEqual(small,[],'터치 영역');
  await page.locator('#hamburger').click();assert.ok(await page.locator('#mobileMenu').evaluate(e=>e.open));
  for(const name of ['교육 과정','면접 연습','자료·정보','커뮤니티','수강 후기']){await page.getByRole('button',{name,exact:true}).click();assert.equal(await page.locator('.mm-group-toggle[aria-expanded=true]').count(),1)}
  await page.keyboard.press('Escape');assert.equal(await page.locator('#mobileMenu').evaluate(e=>e.open),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'hamburger');
  await page.locator('.home-journal').evaluate(async e=>{for(const img of e.querySelectorAll('img'))img.loading='eager';await Promise.all([...e.querySelectorAll('img')].map(i=>i.decode().catch(()=>{})))});
  await page.evaluate(()=>scrollTo(0,0));if([375,1280].includes(width))await page.screenshot({path:path.join(out,'home-'+width+'.png'),fullPage:true});
  await context.close();
 }
 report.checks.push('4개 폭·창문 원본·사진 컬러·캡션 제거·연구진/후기 펼침·메뉴·공개 목록·44px');
 for(const auth of ['guest','member','admin']){const {page,context}=await make(375,auth);await page.waitForFunction(()=>document.querySelector('.nav-my').getAttribute('href'));assert.match(await page.locator('.nav-my').getAttribute('href'),auth==='guest'?/^login.html/:/^mypage.html/);assert.equal(await page.locator('.nav-admin').isVisible(),auth==='admin');await context.close()}
 for(const mode of ['empty','error','keonly','image']){
  const {page,context}=await make();await page.evaluate(m=>window.__mode=m,mode);await loadData(page);
  if(mode==='error'){assert.ok(await page.locator('.home-retry').isVisible());await page.evaluate(()=>window.__mode='normal');await page.locator('.home-retry').click();await page.locator('#homeReviews[aria-busy=false]').waitFor();assert.equal(await page.locator('.home-review').count(),2);await page.locator('#homeCommunityPosts .home-community-retry').click();await page.locator('#homeCommunityPosts[aria-busy=false]').waitFor();assert.equal(await page.locator('#homeCommunityPosts article').count(),3)}
  if(mode==='empty'){assert.equal(await page.locator('.home-review').count(),0);assert.ok(await page.locator('.home-program-links').isVisible())}
  if(mode==='keonly'){assert.equal(await page.locator('.home-review').count(),1);assert.ok(await page.locator('[data-review-list=challenge]').isVisible())}
  if(mode==='image'){assert.equal(await page.locator('.home-review img').count(),1);await page.locator('.home-review img').evaluate(e=>e.dispatchEvent(new Event('error')));assert.equal(await page.locator('.home-review img').count(),0)}
  await layout(page);await context.close();
 }
 const {page,context}=await make();await loadData(page);
 const linkChecks=[['.journal-online .button','online-courses.html'],['.journal-challenge .button','challenges.html'],['.tool-card[href="sojae.html"]','sojae.html'],['.tool-card[href="polish.html"]','polish.html'],['.tool-card[href="lab-airline.html"]','lab-airline.html'],['.tool-card[href="games.html"]','games.html'],['.people-section .text-link','researchers.html'],['.community-links a[href="community.html?view=studies"]','community.html?view=studies'],['.community-links a[href="community.html?view=board&topic=prep"]','community.html?view=board&topic=prep'],['.community-links a[href="lectures.html"]','lectures.html']];
 for(const [selector,destination] of linkChecks){await page.route(base+'/'+destination,r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<p>이동 검증</p>'}));await page.locator(selector).first().click();assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,'/'+destination);assert.equal(await page.locator('p').textContent(),'이동 검증');await page.goBack()}
 const kakao='https://pf.kakao.com/_iajxnX/chat';
 await context.route(kakao,r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<p>카카오채널 이동 검증</p>'}));
 for(const selector of ['.home-kakao-button','.home-contact-float']){
  if(selector.includes('float')){await page.locator('#tools').scrollIntoViewIfNeeded();await page.waitForFunction(()=>!document.querySelector('.home-contact-float').hidden)}
  const popupPromise=page.waitForEvent('popup');await page.locator(selector).click();const popup=await popupPromise;await popup.waitForLoadState();assert.equal(popup.url(),kakao);assert.equal(await popup.locator('p').textContent(),'카카오채널 이동 검증');await popup.close();
 }
 await page.evaluate(()=>{document.querySelectorAll('.home-journal *').forEach(e=>e.style.fontSize=(parseFloat(getComputedStyle(e).fontSize)*2)+'px')});await layout(page);await context.close();
 report.checks.push('회원별 메뉴·빈 후기·오류 재시도·한 종류 후기·이미지 오류·실제 목적지 이동·글자 200%');
 assert.deepEqual(report.errors,[]);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});


