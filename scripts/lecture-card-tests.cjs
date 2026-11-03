// 특강 목록의 마감 표시를 검사한다. 신청·결제·운영 통신은 실행하지 않는다.
// node scripts/lecture-card-tests.cjs --deps <node_modules> --out <출력 폴더>
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const source=fs.readFileSync(path.join(root,'lecture-common.js'),'utf8'),now='2026-11-03T03:00:00Z';
class FixedDate extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return Date.parse(now)}}
const sandbox={window:{},Date:FixedDate};vm.runInNewContext(source,sandbox);const LEC=sandbox.window.LEC;
const base={id:'test-course',title:'검증용 특강',subtitle:'특강 안내',lecture_date:'2026-11-06',recruit_start:'2026-10-01',recruit_end:'2026-11-20',seats_left:10,price:30000,thumb_url:'images/hero-expression.webp',_slots:[]};
const state=(extra,time=now)=>LEC.cardState({...base,...extra},new Date(time));
assert.equal(state({lecture_date:'2026-11-02'}).state,'ended','모집 기간이 남아도 전체 일정이 끝났으면 종료');
assert.equal(state({_slots:[{slot_date:'2026-10-01'},{slot_date:'2026-11-06'}],lecture_date:'2026-10-01'}).state,'open','마지막 일정이 남으면 종료하지 않음');
assert.equal(state({_slots:[{slot_date:'2026-11-03',end_time:'11:00:00'}]}).state,'ended','한국 시간으로 오늘의 종료 시각 반영');
assert.equal(state({_slots:[{slot_date:'2026-11-03',end_time:'13:00:00'}]}).state,'open','끝나지 않은 오늘 일정 유지');
assert.equal(state({_slots:[{slot_date:'2026-11-03'}]}).state,'open','종료 시각이 없으면 오늘 전체를 종료로 단정하지 않음');
assert.equal(state({lecture_date:'2026-11-03'},'2026-11-03T15:01:00Z').state,'ended','UTC 날짜가 같아도 한국 날짜가 지났으면 종료');
assert.equal(state({seats_left:0,recruit_start:'2026-11-05',show_seats:false}).label,'정원 마감','모집 예정·좌석 숨김이어도 정원 0은 마감 표시');
assert.equal(state({recruit_end:'2026-11-02'}).label,'신청 마감');
assert.equal(state({recruit_start:'2026-11-05'}).state,'upcoming');
assert.equal(state({_slots:undefined,lecture_date:'2026-11-01'}).state,'unknown','시간대 조회 실패 시 최초 날짜만으로 종료하지 않음');
assert.equal(state({_slots:[{slot_date:'2026-02-31'}]}).state,'unknown','존재하지 않는 날짜로 종료하지 않음');
assert.equal(state({_slots:[{slot_date:'확인 중'}]}).state,'unknown');
assert.equal(state({lecture_date:null}).state,'open','날짜 없는 상시 특강 유지');
assert.equal(LEC.status('2026-10-01','2026-11-20'),'open','기존 신청·상세용 모집 판정 유지');
const outHtml=LEC.cardHtml({...base,lecture_date:'2026-11-01'}),openHtml=LEC.cardHtml({...base,price_kind:'deposit'});
assert.ok(outHtml.includes('특강 종료')&&outHtml.includes('특강 안내 보기')&&!outHtml.includes('lx-price'));
assert.ok(openHtml.includes('예약금')&&openHtml.includes('30,000원'),'모집 중인 상품의 금액·이름 유지');
assert.ok(!LEC.cardHtml({...base,title:'<img src=x onerror=alert(1)>',lecture_date:'2026-11-01'}).includes('<img src=x'),'제목 이스케이프');
console.log('날짜·시간대·한국 시간·좌석·누락·가격·이스케이프 검사 통과');
if(!opt('--deps'))process.exit(0);
const {chromium}=require(path.join(opt('--deps'),'playwright')),url=opt('--url','http://127.0.0.1:5511'),out=path.resolve(opt('--out','outputs/home-full/lecture-a-checks'));
fs.mkdirSync(out,{recursive:true});
const records=[
 {...base,id:'ended',title:'모집 기간보다 먼저 끝난 특강',lecture_date:'2026-11-02'},
 {...base,id:'open',title:'모집 중인 특강',price_kind:'deposit'},
 {...base,id:'multi',title:'다음 일정이 남은 특강',lecture_date:'2026-10-01',_slots:[{slot_date:'2026-10-01'},{slot_date:'2026-11-10'}]},
 {...base,id:'sold',title:'정원이 찬 특강',seats_left:0,recruit_start:'2026-11-05',show_seats:false},
 {...base,id:'soon',title:'모집 예정 특강',recruit_start:'2026-11-05',price:0,price_label:'상담 시 안내'},
 {...base,id:'no-photo',title:'사진 없는 종료 특강',lecture_date:'2026-11-01',thumb_url:''},
 {...base,id:'deadline',title:'신청 기간이 끝난 특강',recruit_end:'2026-11-02'}
];
const fixtures=`window.__mode='normal';window.__slotFailure=false;window.__writes=0;window.moncBeacon=()=>{};
const fixtureLectures=${JSON.stringify(records.map(({_slots,...l})=>l))};const fixtureSlots=${JSON.stringify(records.flatMap(l=>l._slots.map(s=>({...s,lecture_id:l.id}))))};
window.MONC={getSession:async()=>null,getMyProfile:async()=>null,sb:{from:table=>{const q={select:()=>q,eq:()=>q,order:()=>q,in:()=>q,then:(resolve,reject)=>Promise.resolve(window.__mode==='error'?{error:{message:'검증용 실패'}}:table==='lecture_slots'&&window.__slotFailure?{error:{message:'검증용 일정 조회 실패'}}:{data:window.__mode==='empty'?[]:table==='lecture_slots'?fixtureSlots:fixtureLectures.map(l=>({...l}))}).then(resolve,reject)};return q;}}};`;
const original=fs.readFileSync(path.join(root,'lectures.html'),'utf8');
const html=original.replace(/<script\b[^>]*src="https:[^"]+"[^>]*><\/script>/g,'').replace(/<script src="supabase-config\.js"><\/script>/,()=>'<script>'+fixtures+'</script>');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'}),report={widths:[],errors:[],checks:[]};
 try{
  const context=await browser.newContext({viewport:{width:375,height:812},reducedMotion:'reduce'});
  await context.addInitScript(({at})=>{const RealDate=Date;window.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[at]))}static now(){return RealDate.parse(at)}}},{at:now});
  await context.route('**/*',r=>{if(!r.request().url().startsWith(url+'/'))return r.abort();if(!['GET','HEAD'].includes(r.request().method()))throw Error('운영 쓰기 차단');const u=new URL(r.request().url());if(u.pathname==='/lectures.html')return r.fulfill({contentType:'text/html; charset=utf-8',body:html});if(u.pathname==='/lecture.html')return r.fulfill({contentType:'text/html; charset=utf-8',body:'<title>검증용 특강 안내</title><p>안내 페이지 이동 완료</p>'});return r.continue()});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url+'/lectures.html');await page.waitForSelector('#lxGrid .lx-card');await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.lx-card').count(),7);assert.equal(await page.locator('.is-out').count(),4);assert.equal(await page.locator('.lx-closed-cover strong').first().textContent(),'특강 종료');assert.equal(await page.locator('.is-out .lx-price').count(),0);
  assert.deepEqual(await page.locator('.lx-card').evaluateAll(es=>es.slice(0,3).map(e=>e.dataset.lectureState)),['open','open','upcoming'],'모든 일정 조회 후 신청 중·예정 우선 정렬');
  assert.equal(await page.locator('.lx-card[data-lecture-state=open] .lx-price').count(),2);assert.ok((await page.locator('.is-out').evaluateAll(es=>es.map(e=>getComputedStyle(e).opacity))).every(v=>v==='1'),'마감 정보 글자는 선명하게 유지');
  for(const width of [375,320,768,1280]){
   await page.setViewportSize({width,height:812});const metrics=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,cards:[...document.querySelectorAll('.lx-card')].map(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height}})}));assert.ok(metrics.overflow<=0);assert.ok(metrics.cards.every(r=>r.width>=44&&r.height>=44));report.widths.push(metrics);
   if([375,1280].includes(width)){await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:path.join(out,'lectures-'+width+'.png'),fullPage:true});}
  }
  await page.setViewportSize({width:375,height:812});await page.locator('.is-out').first().focus();assert.equal(await page.locator('.is-out').first().evaluate(e=>getComputedStyle(e).outlineWidth),'3px');await page.locator('.is-out').first().press('Enter');await page.waitForURL('**/lecture.html?id=ended');assert.equal(await page.locator('p').textContent(),'안내 페이지 이동 완료');
  await page.goto(url+'/lectures.html');await page.waitForSelector('.lx-card');await page.evaluate(async()=>{__slotFailure=true;await load()});assert.equal(await page.locator('[data-lecture-state=ended]').count(),0);assert.equal(await page.locator('[data-lecture-state=unknown]').count(),3,'확인하지 못한 과거 일정은 안내 상태로 구분');
  await page.evaluate(async()=>{__slotFailure=false;__mode='empty';await load()});assert.ok((await page.locator('#lxState').textContent()).includes('준비 중'));
  await page.evaluate(async()=>{__mode='error';await load()});assert.ok((await page.locator('#lxState').textContent()).includes('불러오지 못했어요'));
  await page.evaluate(async()=>{__mode='normal';await load()});await page.evaluate(()=>{document.querySelectorAll('main *').forEach(e=>e.style.fontSize=(parseFloat(getComputedStyle(e).fontSize)*2)+'px')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'200% 글자 가로 넘침');
  assert.deepEqual(report.errors,[]);report.checks=['단일·여러 일정·한국 시간·정원·기간·알 수 없는 일정','실제 신청·결제 호출 차단·금액 유지','상세 키보드 이동·조회 실패·빈 목록·일정 실패·200% 글자'];fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
