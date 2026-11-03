// 홈 소식 갱신·NEW·읽음·특강 이동 검증. 운영 SDK와 통신은 전부 차단한다.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const args=process.argv.slice(2),opt=(key,value)=>args.includes(key)?args[args.indexOf(key)+1]:value;
const {chromium}=require(path.join(opt('--deps'),'playwright'));
const base=opt('--url','http://127.0.0.1:5511'),root=path.resolve(__dirname,'..'),output=path.resolve(opt('--out','outputs/home-full/news-checks'));
const actions=['studies','posts','lectures'],ids={studies:'homeCommunityStudies',posts:'homeCommunityPosts',lectures:'homeCommunityLectures'};
const stub=`window.__feeds=Object.fromEntries(['studies','posts','lectures'].map(action=>[action,Array.from({length:3},(_,i)=>({id:action+'-old-'+i,title:'검증용 기존 소식 '+i,visible:true,status:'open',members:1,capacity:4,created_at:new Date(Date.now()-30*86400000).toISOString()}))]));window.__fail=[];window.__counts={};window.__query=[];
async function feed(action){window.__counts[action]=(window.__counts[action]||0)+1;if(window.__fail.includes(action))return {error:{message:'검증용 실패'}};return{data:action==='lectures'?window.__feeds[action]:{ok:true,items:window.__feeds[action]}};}
function query(table){var q={select:()=>q,eq:(key,value)=>{window.__query.push([table,key,value]);return q},order:(key,value)=>{window.__query.push([table,key,value]);return q},limit:value=>{window.__query.push([table,'limit',value]);return q},then:(resolve,reject)=>(table==='special_lectures'?feed('lectures'):Promise.resolve({data:[]})).then(resolve,reject)};return q;}
window.MONC={getSession:async()=>null,getMyProfile:async()=>null,sb:{from:query,rpc:async(name,args)=>feed(args.p_action)}};window.moncBeacon=()=>{};`;
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'});
 const errors=[];
 async function make(extra=''){
  const context=await browser.newContext({viewport:{width:375,height:812},reducedMotion:'reduce'});
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(base+'/supabase-config.js'))return route.fulfill({contentType:'text/javascript',body:stub+extra});if(!url.startsWith(base+'/'))return route.abort();if(!['GET','HEAD'].includes(route.request().method()))throw Error('외부 쓰기 차단');if(url===base+'/consult.html')return route.fulfill({contentType:'text/html; charset=utf-8',body:fs.readFileSync(path.join(root,'consult.html'),'utf8')});return route.continue()});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install();await page.goto(base+'/index.html');return{context,page};
 }
 async function settle(page){await page.locator('#homeCommunity').scrollIntoViewIfNeeded();for(const id of Object.values(ids))await page.locator('#'+id+'[aria-busy=false]').waitFor();}
 async function tick(page){await page.clock.fastForward(31000);await settle(page);}
 try{
  const {context,page}=await make();await settle(page);
  assert.equal(await page.locator('.new-indicator:visible').count(),0,'이전 소식을 처음 열었다고 NEW로 표시하지 않음');
  assert.ok((await page.evaluate(()=>__query)).some(q=>q[0]==='special_lectures'&&q[1]==='visible'&&q[2]===true),'공개 특강만 조회');
  await page.locator('#homeCommunityPosts summary').click();await page.locator('#homeCommunityPosts summary').focus();
  await page.evaluate(()=>{for(const action of ['studies','posts','lectures']){__feeds[action]=[{id:action+'-new',title:'새 글 <img src=x onerror="window.__xss=1">',visible:true,status:'open',created_at:'2020-01-01T00:00:00Z'},...__feeds[action].slice(0,2)];}});
  await tick(page);
  assert.equal(await page.locator('.new-indicator:visible').count(),3,'갱신 중 새로 공개된 과거 작성 특강도 NEW');
  for(const id of Object.values(ids)){assert.equal(await page.locator('#'+id+'>article .home-community-title').isVisible(),true,'접지 않은 최신 제목');assert.equal(await page.locator('#'+id+'>article img').count(),0,'제목은 HTML로 실행하지 않음');}
  assert.ok(await page.locator('#homeCommunityPosts details').evaluate(e=>e.open),'갱신 후 더보기 유지');
  assert.equal(await page.evaluate(()=>document.activeElement.tagName),'SUMMARY','갱신 후 초점 유지');
  const latest=await page.locator('#homeCommunity .choice-feed-shell').evaluateAll(shells=>shells.map(shell=>({action:shell.dataset.feedKind,href:shell.querySelector('a').getAttribute('href')})));
  await page.evaluate(()=>document.addEventListener('click',event=>{if(event.target.closest('a[data-feed-item]'))event.preventDefault()}));
  for(const action of actions)await page.locator('#'+ids[action]+'>article a').click();
  assert.equal(await page.locator('.new-indicator:visible').count(),0,'제목을 읽으면 NEW 해제');
  for(const action of actions)assert.ok(await page.evaluate(action=>JSON.parse(localStorage.getItem('monc_home_news_v1_'+action)).read.includes(action+'-new'),action));
  const rows=await page.evaluate(()=>__feeds);
  await page.route(base+'/supabase-config.js*',route=>route.fulfill({contentType:'text/javascript',body:stub+'window.__feeds='+JSON.stringify(rows)+';'}));
  await page.reload();await settle(page);assert.equal(await page.locator('.new-indicator:visible').count(),0,'새로고침 후 읽음 유지');
  await page.evaluate(()=>{window.__fail=['studies','posts','lectures']});await tick(page);
  assert.equal(await page.locator('.home-community-stale').count(),3,'갱신 실패 때 이전 목록과 실패 안내 유지');
  assert.equal(await page.locator('.new-indicator:visible').count(),0,'실패를 새 소식으로 오인하지 않음');
  await page.evaluate(()=>{window.__fail=[]});
  for(const action of actions){await page.locator('#'+ids[action]+' .home-community-retry').click();await page.locator('#'+ids[action]+'[aria-busy=false]').waitFor();}
  assert.equal(await page.locator('.home-community-stale').count(),0,'재시도 복구');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  const before=await page.evaluate(()=>JSON.stringify(__counts));await page.clock.fastForward(62000);assert.equal(await page.evaluate(()=>JSON.stringify(__counts)),before,'숨은 탭은 조회하지 않음');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});await settle(page);
  for(const {action,href} of latest){
   await page.route(base+'/'+href,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>선택한 공개 소식 상세</h1>'}));
   await page.locator('#'+ids[action]+'>article a').click();assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,'/'+href);await page.locator('h1').waitFor();await page.goBack();await settle(page);
  }
  await context.close();
  const second=await make(`for(const action of ['studies','posts','lectures'])__feeds[action]=[{id:action+'-recent',title:'최근 등록 소식 검증',visible:true,created_at:new Date().toISOString()}];Object.defineProperty(Storage.prototype,'getItem',{value:()=>{throw Error('검증용 저장 차단')}});Object.defineProperty(Storage.prototype,'setItem',{value:()=>{throw Error('검증용 저장 차단')}});`);
  await settle(second.page);assert.equal(await second.page.locator('.new-indicator:visible').count(),3,'첫 방문 최근 7일 글과 특강 NEW, 저장 차단에도 정상');
  await second.page.clock.fastForward(7*86400000+1000);await settle(second.page);assert.equal(await second.page.locator('.new-indicator:visible').count(),0,'7일 뒤 NEW 만료');
  await second.context.close();assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({checks:['세 종류 실제 조회 경로·30초 갱신','처음 방문한 과거 글은 NEW 제외·새로 공개된 특강 NEW','최신 제목 상시 노출·더보기와 초점 유지','읽음 해제·새로고침 유지·저장 차단','갱신 실패·재시도·숨은 탭 중지·7일 만료','스터디·게시글·특강 상세 이동·제목 HTML 무해화'],errors},null,2));
  console.log('홈 소식 3종: 갱신·NEW·읽음·오류·저장 차단·상세 이동 통과');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
