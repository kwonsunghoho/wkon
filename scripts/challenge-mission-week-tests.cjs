/* 실제 참여자 HTML을 로컬 응답으로 열어 자정 경계와 주차 이동을 검사한다.
   node scripts/challenge-mission-week-tests.cjs <playwright 패키지 경로> [Chromium 실행 파일] */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.argv[2] || 'playwright');
const site = path.resolve(__dirname,'..');
const origin = 'http://127.0.0.1:43218';
const fixtureNow = Date.parse('2026-11-25T14:59:50Z');
const id = n => 'a0000000-0000-4000-8000-'+String(n).padStart(12,'0');

function memberFixture() {
  const uid = 'b0000000-0000-4000-8000-000000000001';
  const id = n => 'a0000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const archived = location.search.includes('archived');
  const dates = ['2026-11-23','2026-11-24','2026-11-25','2026-11-26','2026-11-27','2026-11-30'];
  const opened = () => dates.map((date,i)=>({id:id(i+1),day_no:i+1,release_date:date,title:'연습 '+(i+1)}))
    .filter(m=>Date.parse(m.release_date+'T00:00:00+09:00')<=Date.now());
  const session = {user:{id:uid}};
  window.commands = [];
  window.YT = {PlayerState:{ENDED:0,PLAYING:1},Player:class {
    constructor(el,options) { this.events=options.events; this.time=0; window.testPlayer=this; queueMicrotask(()=>this.events.onReady({target:this})); }
    loadVideoById(selection) { window.commands.push(selection); this.time=selection.startSeconds; this.events.onStateChange({target:this,data:1}); }
    getCurrentTime() { return this.time; }
    destroy() {}
  }};
  window.MONC = {requireSession:async()=>session,requireConsent:async()=>true,getSession:async()=>session,
    sb:{rpc:async(name,{p_action:a,p_data:p})=>{
      if (name!=='challenge_room') throw new Error(name);
      const ms=opened(), m=ms.find(x=>x.id===p.id);
      if (a==='home') return {data:{server_now:new Date().toISOString(),history:[],cohorts:archived?[]:[{round:7,challenge:'voice',missions:ms}]}};
      if (a==='mission' && m) return {data:{mission:{...m,body:'연습',round:7,challenge:'voice',eligible:!archived,
        chapter:(!archived&&m.day_no!==2)?{provider:'youtube',video_id:'abcdef12345',week_no:1,start_seconds:8,end_seconds:12}:null},answers:[]}};
      return {error:{message:'미공개'}};
    }}};
  window.ChallengePush = {mount(){}};
}

(async()=>{
  const browser=await chromium.launch({...(process.argv[3]?{executablePath:process.argv[3]}:{}),args:['--no-sandbox']});
  try {
    const ctx=await browser.newContext({viewport:{width:375,height:822},serviceWorkers:'block'});
    const external=[],errors=[];
    const fixtureRoute=async route=>{
      const url=new URL(route.request().url());
      if (url.origin!==origin) { external.push(url.href); return route.abort(); }
      const file=url.pathname.slice(1);
      if (file==='challenge-mission.html') {
        const html=fs.readFileSync(path.join(site,file),'utf8').replace(/<script\b[^>]+src="(?:https:[^"]*|nav\.js[^"]*|inapp\.js[^"]*|scroll-keep\.js[^"]*|challenge-push\.js[^"]*)"[^>]*><\/script>/g,'');
        return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
      }
      if (file==='supabase-config.js') return route.fulfill({contentType:'text/javascript; charset=utf-8',body:'('+memberFixture.toString()+')()'});
      if (['challenge-mission.js','challenge-mission.css','challenge-chapter.js'].includes(file)) return route.fulfill({path:path.join(site,file)});
      return route.fulfill({contentType:file.endsWith('.css')?'text/css':'text/plain',body:''});
    };
    await ctx.route('**/*',fixtureRoute);
    const freshPage=async()=>{
      const isolated=await browser.newContext({viewport:{width:375,height:822},serviceWorkers:'block'});
      await isolated.route('**/*',fixtureRoute);
      const p=await isolated.newPage(); p.setDefaultTimeout(4000); p.on('pageerror',e=>errors.push(e.message)); return p;
    };
    const page=await ctx.newPage(); page.setDefaultTimeout(3500);
    page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install({time:new Date(fixtureNow-1000)});
    await page.clock.pauseAt(new Date(fixtureNow));
    await page.goto(origin+'/challenge-mission.html');
    const checkTitle = title=>page.getByRole('heading',{name:title,exact:true}).waitFor();
    await checkTitle('연습 3');
    assert.equal(await page.locator('.mission-day[aria-disabled=true]').count(),2);
    assert.equal(await page.locator('[data-week="1"]').getAttribute('aria-pressed'),'true');
    await page.locator('#mission-body').fill('답변 초안');
    await page.locator('#mission-file').setInputFiles({name:'연습.wav',mimeType:'audio/wav',buffer:Buffer.from([82,73,70,70])});
    await page.getByRole('button',{name:'2주차',exact:true}).click();
    await checkTitle('2주차 미션은 아직 열리지 않았어요');
    assert.equal(await page.locator('.mission-day[aria-disabled=true]').count(),5);
    assert.equal(await page.locator('.chapter-full,[data-chapter-play]').count(),0);
    await page.getByRole('button',{name:'1주차',exact:true}).click(); await checkTitle('연습 3');
    assert.equal(await page.locator('#mission-body').inputValue(),'답변 초안');
    assert.match(await page.locator('#mission-file-info').textContent(),/연습.wav/);
    await page.getByRole('link',{name:/DAY 2,/}).click(); await checkTitle('연습 2');
    assert.equal(await page.locator('.chapter-full,[data-chapter-play]').count(),0);
    await page.goBack(); await checkTitle('연습 3');
    await page.clock.fastForward(11000);
    await page.getByRole('link',{name:'오늘 미션 열기'}).waitFor();
    assert.equal(await page.locator('#mission-body').inputValue(),'답변 초안');
    assert.match(await page.locator('#mission-file-info').textContent(),/연습.wav/);
    await page.getByRole('link',{name:'오늘 미션 열기'}).click(); await checkTitle('연습 4');
    assert.equal(await page.locator('.chapter-full').getAttribute('href'),'https://www.youtube.com/watch?v=abcdef12345');
    await page.getByRole('button',{name:'챕터 재생'}).click();
    await page.waitForFunction(()=>commands.length===1);
    assert.deepEqual(await page.evaluate(()=>commands[0]),{videoId:'abcdef12345',startSeconds:8,endSeconds:12});
    await page.evaluate(()=>{testPlayer.time=12;}); await page.clock.runFor(300);
    await page.getByRole('button',{name:'챕터 다시 보기'}).click();
    await page.waitForFunction(()=>commands.length===2);
    assert.equal(await page.evaluate(()=>commands[1].startSeconds),8);
    const idle=await freshPage();
    await idle.clock.install({time:new Date(fixtureNow-1000)}); await idle.clock.pauseAt(new Date(fixtureNow));
    await idle.goto(origin+'/challenge-mission.html');
    await idle.getByRole('heading',{name:'연습 3'}).waitFor();
    await idle.clock.fastForward(11000);
    await idle.getByRole('heading',{name:'연습 4'}).waitFor();
    const early=await freshPage();
    const firstOpen=Date.parse('2026-11-22T14:59:50Z');
    await early.clock.install({time:new Date(firstOpen-1000)}); await early.clock.pauseAt(new Date(firstOpen));
    await early.goto(origin+'/challenge-mission.html');
    await early.getByRole('heading',{name:'아직 열린 미션이 없어요'}).waitFor();
    assert.equal(await early.locator('.chapter-full,[data-chapter-play]').count(),0);
    await early.clock.fastForward(11000); await early.getByRole('heading',{name:'연습 1'}).waitFor();
    const archive=await freshPage();
    await archive.goto(origin+'/challenge-mission.html?id='+id(3)+'&archived=1');
    await archive.getByRole('heading',{name:'연습 3'}).waitFor();
    assert.equal(await archive.locator('.chapter-full,[data-chapter-play],#mission-submit').count(),0);
    assert.deepEqual(external,[]); assert.deepEqual(errors,[]);
    console.log('통과: 주차·요일 선택·뒤로가기·글/파일 초안·KST 자정 갱신·기간 잠금·챕터 시작/종료/다시보기·전체 영상 링크');
  } finally { await browser.close(); }
})().catch(err=>{console.error(err);process.exitCode=1;});
