// 운영 통신을 차단하고 홈·공통 메뉴의 실제 브라우저 동작을 검증한다.
// 실행: node scripts/home-navigation-tests.mjs --deps <node_modules> --out <출력 폴더>
// 선택: --public-data <공개 조회 스냅샷> / --url <로컬 서버> / --browser <Chrome 실행 파일>
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const args=process.argv.slice(2);
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const deps=option('--deps');
if(!deps)throw new Error('--deps 경로가 필요합니다.');
const {chromium}=await import(pathToFileURL(path.join(deps,'playwright/index.mjs')));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(option('--out',path.join(root,'outputs/home-navigation')));
await fs.mkdir(output,{recursive:true});
const base=option('--url','http://127.0.0.1:5500');
const browser=await chromium.launch({headless:true,...(option('--browser')?{executablePath:option('--browser')}:{})});
const snapshot=option('--public-data')?JSON.parse(await fs.readFile(option('--public-data'),'utf8')):null;
const fixture={
 reviews:[{kind:'challenge',quote:'화면 검증 전용 챌린지 후기입니다.',challenge:'보신각'},{kind:'ke20',quote:'화면 검증 전용 수업 후기입니다.'},{kind:'consult',quote:'홈에서 숨겨야 할 상담 후기'}],
 posts:{ok:true,items:Array.from({length:4},(_,i)=>({id:'post-'+i,topic:'prep',title:'검증용 공개 글 '+i,created_at:'2026-10-20T00:00:00Z'}))},
 studies:{ok:true,items:Array.from({length:4},(_,i)=>({id:'study-'+i,title:'검증용 모집글 '+i,status:i===2?'closed':'open',members:i===1?4:1,capacity:4,created_at:'2026-10-20T00:00:00Z'}))}
};
const report={widths:[],checks:[],errors:[]};
const stub=(state,data)=>`
window.__testState=${JSON.stringify(state)};window.__testData=${JSON.stringify(data)};window.__events=[];window.__reads=[];
window.moncBeacon=(event,meta)=>window.__events.push({event,meta});
async function result(key){window.__reads.push(key);if(window.__testState.mode==='delay')await new Promise(r=>setTimeout(r,600));if(window.__testState.mode==='error')return {error:{message:'검증용 오류'}};if(window.__testState.mode==='empty')return{data:key==='reviews'?[]:{ok:true,items:[]}};return{data:window.__testData[key]};}
function query(table){const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,in:()=>q,then:(resolve,reject)=>result(table==='reviews'?'reviews':'other').then(resolve,reject)};return q;}
window.MONC={
 getSession:async()=>{if(window.__testState.auth==='slow')await new Promise(r=>setTimeout(r,200));return window.__testState.auth==='guest'?null:{user:{id:'local-test'}}},
 getMyProfile:async()=>{if(window.__testState.profileFail)throw Error('검증용 실패');return{name:'화면 검증 회원',role:window.__testState.auth==='admin'?'admin':'member'}},
 requireConsent:async()=>false,loadConfig:async()=>({}),
 sb:{from:query,rpc:async(name,args)=>{window.__lastRpc={name,args};return result(args.p_action);},auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}
};
`;
async function makePage(state={},data=fixture,width=375){
 const context=await browser.newContext({viewport:{width,height:812},reducedMotion:'reduce'});
 const page=await context.newPage();
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url.startsWith(base+'/supabase-config.js'))return route.fulfill({contentType:'text/javascript',body:stub({auth:'guest',mode:'normal',...state},data)});
  if(!url.startsWith(base+'/'))return route.abort();
  if(!['GET','HEAD'].includes(route.request().method()))throw Error('운영 쓰기 차단');
  return route.continue();
 });
 await page.goto(base+'/index.html');
 await page.evaluate(()=>document.fonts.ready);
 return {page,context};
}
async function noOverflow(page,label){
 const result=await page.evaluate(()=>{
  const width=innerWidth;
  return {width,scroll:document.documentElement.scrollWidth,escaped:Array.from(document.querySelectorAll('main a, main h1, main h2, #navbar a, #navbar button, #mobileMenu[open] a, #mobileMenu[open] button')).filter(el=>{
   const r=el.getBoundingClientRect();return r.width && (r.left<-.5 || r.right>width+.5 || el.scrollWidth>el.clientWidth+1);
  }).map(el=>el.textContent.trim()||el.getAttribute('aria-label'))};
 });
 assert.ok(result.scroll<=result.width, label+': 문서 넘침');
 assert.deepEqual(result.escaped,[],label+': 잘림 '+JSON.stringify(result.escaped));
 return result;
}
try{
 for(const width of [320,360,375,390,430,768,1280]){
  const {page,context}=await makePage({},snapshot||fixture,width);
  await noOverflow(page,'메인 '+width);
  const layout=await page.evaluate(()=>({
   width:innerWidth,quickTop:document.querySelector('.home-shortcuts').getBoundingClientRect().top,
   quickRows:new Set(Array.from(document.querySelectorAll('.home-shortcuts a'),el=>Math.round(el.getBoundingClientRect().top))).size,
   sections:Array.from(document.querySelectorAll('main > section'),el=>({id:el.id||el.className,y:Math.round(el.getBoundingClientRect().top+scrollY)}))
  }));
  // 오너가 원래 100svh 창문 인트로 보존을 확정했다. 바로가기는 그 아래 본문에 둔다.
  if(width>=360&&width<=430)assert.equal(layout.quickRows,1);
  assert.equal(await page.locator('#heroIntro').evaluate(el=>el.clientHeight),812);
  report.widths.push(layout);
  await page.locator('#doors').scrollIntoViewIfNeeded();
  await page.locator('#homeReviews[aria-busy=false]').waitFor();
  assert.equal(await page.locator('.home-review').count(),2);
  await page.locator('#homeCommunity').scrollIntoViewIfNeeded();
  await page.locator('#homeCommunityPosts[aria-busy=false]').waitFor();
  if(!snapshot)assert.equal(await page.locator('#homeCommunityPosts article').count(),3);
  await page.evaluate(()=>window.scrollTo(0,0));
  if([375,390,1280].includes(width))await page.screenshot({path:path.join(output,'home-'+width+'.png'),fullPage:true});
  if(width===375)await page.screenshot({path:path.join(output,'home-first-375.png')});
  await page.locator('#hamburger').click();
  assert.equal(await page.locator('#mobileMenu').evaluate(el=>el.open),true);
  await noOverflow(page,'메뉴 '+width);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'menuClose');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overflow),'hidden');
  const last=page.locator('#mobileMenu .mm-social a').last();
  await last.focus();await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.closest('a').getAttribute('href')),'index.html');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'네이버 블로그');
  await last.scrollIntoViewIfNeeded();
  const bottom=await last.boundingBox();
  assert.ok(bottom.y+bottom.height<=812);
  const sizes=await page.locator('#mobileMenu a, #mobileMenu button').evaluateAll(nodes=>nodes.filter(el=>el.getClientRects().length&&el.getBoundingClientRect().height<44).map(el=>el.textContent));
  assert.deepEqual(sizes,[]);
  await page.locator('.mm-scroll').evaluate(el=>el.scrollTop=0);
  await page.locator('#menuClose').focus();
  if([375,390,1280].includes(width))await page.screenshot({path:path.join(output,'menu-'+width+'.png')});
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.getElementById('hamburger').getAttribute('aria-expanded')==='false');
  assert.equal(await page.locator('#mobileMenu').evaluate(el=>el.open),false);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'hamburger');
  assert.notEqual(await page.evaluate(()=>getComputedStyle(document.body).overflow),'hidden');
  await context.close();
 }
 report.checks.push('7개 폭·바로가기 한 줄·메뉴 44px·끝 항목·Escape·포커스 순환·복귀');
 for(const auth of ['guest','member','admin','slow']){
  const {page,context}=await makePage({auth});
  if(auth==='slow')await page.waitForTimeout(300);
  assert.match(await page.locator('.nav-my').getAttribute('href'),auth==='guest'?/^login.html\?returnTo=/:/^mypage.html$/);
  await page.locator('#hamburger').click();
  assert.equal(await page.locator('#menuAdmin').isVisible(),auth==='admin');
  await page.locator('#mobileMenu a[href="community.html?view=board&topic=hair"]').click();
  await page.waitForURL('**/community.html?view=board&topic=hair');
  assert.equal(await page.locator('#mobileMenu').evaluate(el=>el.open),false);
  await page.locator('#hamburger').click();
  assert.equal(await page.locator('#mobileMenu [aria-current=page]').textContent(),'헤메&샵');
  await page.locator('#menuClose').click();
  await context.close();
 }
 report.checks.push('비로그인·회원·관리자·지연 인증·링크 이동·현재 위치');
 {
  const {page,context}=await makePage();
  await page.locator('#homeCommunity').scrollIntoViewIfNeeded();
  await page.locator('#homeCommunityPosts[aria-busy=false]').waitFor();
  assert.equal(await page.locator('#homeCommunityPosts article').count(),3);
  assert.deepEqual(await page.evaluate(()=>window.__lastRpc.args),{p_action:'posts',p_data:{limit:3,topic:'prep'}});
  await page.locator('#homePostsTab').focus();await page.keyboard.press('ArrowRight');
  await page.locator('#homeCommunityStudies[aria-busy=false]').waitFor();
  assert.equal(await page.locator('#homeStudiesTab').getAttribute('aria-selected'),'true');
  assert.deepEqual(await page.locator('#homeCommunityStudies .home-community-tag').allTextContents(),['모집 중','정원 마감','모집 종료']);
  assert.equal(await page.locator('#homeCommunityStudies time').count(),3);
  await page.locator('#homeStudiesTab').press('Home');
  assert.equal(await page.locator('#homePostsTab').getAttribute('aria-selected'),'true');
  // 공개 데이터의 HTML은 해석하지 않고 글자로 표시한다.
  await page.evaluate(()=>{window.__testData.posts.items[0].title='<img src=x onerror=alert(1)>';});
  await page.locator('#homeStudiesTab').click();await page.locator('#homePostsTab').click();
  await page.locator('#homeCommunityPosts[aria-busy=false]').waitFor();
  assert.equal(await page.locator('#homeCommunityPosts img').count(),0);
  await context.close();
 }
 report.checks.push('탭 키보드·서버 주제 필터·최대 3건·실제 상태·날짜·HTML 이스케이프');
 for(const mode of ['empty','error','delay']){
  const {page,context}=await makePage({mode});
  await page.locator('#doors').scrollIntoViewIfNeeded();
  if(mode==='delay')assert.equal(await page.locator('#homeReviews').getAttribute('aria-busy'),'true');
  await page.locator('#homeReviews[aria-busy=false]').waitFor();
  if(mode==='empty')assert.match(await page.locator('#homeReviews').textContent(),/공개 후기가 없습니다/);
  if(mode==='error'){
   assert.match(await page.locator('#homeReviews').textContent(),/불러오지 못했습니다/);
   await page.evaluate(()=>window.__testState.mode='normal');
   await page.locator('.home-retry').click();
   await page.locator('#homeReviews[aria-busy=false]').waitFor();
   assert.equal(await page.locator('.home-review').count(),2);
   await page.evaluate(()=>window.__testState.mode='error');
  }
  await page.locator('#homeCommunity').scrollIntoViewIfNeeded();
  await page.locator('#homeCommunityPosts[aria-busy=false]').waitFor();
  if(mode==='empty')assert.match(await page.locator('#homeCommunityPosts').textContent(),/아직 공개된/);
  if(mode==='error'){
   assert.match(await page.locator('#homeCommunityPosts').textContent(),/불러오지 못했습니다/);
   await page.locator('#homeCommunityPosts button').scrollIntoViewIfNeeded();
   await page.waitForTimeout(100);
   await page.evaluate(()=>window.__testState.mode='normal');
   await page.locator('#homeCommunityPosts button').click();
   await page.locator('#homeCommunityPosts[aria-busy=false]').waitFor();
   assert.equal(await page.locator('#homeCommunityPosts article').count(),3);
   await page.evaluate(()=>window.__testState.mode='error');
   await page.locator('#homeStudiesTab').click();await page.locator('#homePostsTab').click();
   await page.locator('#homeCommunityPosts[aria-busy=false]').waitFor();
   assert.match(await page.locator('#homeCommunityPosts').textContent(),/이전 정보를/);
  }
  await noOverflow(page,mode);
  await context.close();
 }
 report.checks.push('지연·빈 목록·실패·재시도 성공·갱신 실패 시 이전 목록');
 {
  const {page,context}=await makePage();
  // 브라우저 글자 크기 확대를 모사하며 큰 글자에서도 정보가 잘리지 않는지 본다.
  await page.addStyleTag({content:'main > :not(#heroIntro) :is(h1,h2,h3,p,a,button,span), #mobileMenu :is(a,h2,span) {font-size:200% !important;}'});
  await noOverflow(page,'큰 글자');
  await page.locator('#hamburger').click();
  await noOverflow(page,'큰 글자 메뉴');
  await context.close();
 }
 {
  const {page,context}=await makePage();
  const links=await page.locator('a[href]').evaluateAll(nodes=>nodes.map(el=>el.getAttribute('href')));
  await page.locator('#hamburger').click();
  for(const href of links.filter(h=>!h.startsWith('http')&&!h.startsWith('#'))){
   const file=href.split(/[?#]/)[0];
   await fs.access(path.join(root,file));
  }
  const required=['challenges.html','apply.html','lectures.html','tools.html','answers.html','sojae.html','polish.html','games.html','lab-airline.html','news.html','community.html?view=activity','reviews-list.html?kind=challenge','reviews-list.html?kind=ke20','researchers.html','consult.html','tools.html#community'];
  for(const href of required)assert.ok(links.includes(href),'기존 기능 누락: '+href);
  assert.equal(await page.locator('#stickyCta').count(),0);
  assert.equal(await page.locator('.nav-space-switch').count(),0);
  await page.locator('#menuClose').click();
  await page.locator('.home-shortcuts a[href="tools.html"]').click();
  await page.waitForURL('**/tools.html');
  await context.close();
 }
 report.checks.push('기존 기능 경로·로컬 목적지 존재·하단 고정바 제거·큰 글자');
 {
  const {page,context}=await makePage();
  await page.evaluate(()=>document.addEventListener('click',event=>{if(event.target.closest('a'))event.preventDefault();}));
  await page.locator('.home-hero .home-primary').click();
  await page.locator('.home-shortcuts a[href="tools.html"]').click();
  await page.locator('#hamburger').click();
  await page.locator('#mobileMenu a[href="lectures.html"]').click();
  assert.deepEqual(await page.evaluate(()=>window.__events.map(item=>item.event)),['home_challenge_hero','home_shortcut','menu_destination']);
  await context.close();
 }
 {
  const {page,context}=await makePage({profileFail:true,auth:'member'});
  await page.locator('#hamburger').click();
  assert.equal(await page.locator('#menuAdmin').isVisible(),false);
  await context.close();
 }
 report.checks.push('키보드와 동일한 click 계측·관리자 프로필 조회 실패 시 비노출');
 assert.deepEqual(report.errors,[]);
 console.log(JSON.stringify(report,null,2));
} finally {
 await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2));
 await browser.close();
}
