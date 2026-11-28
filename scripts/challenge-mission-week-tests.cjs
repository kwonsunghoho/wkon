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
const privateClip = 'https://media.example.test/storage/v1/object/sign/challenge-room-video/sample.mp4';

function memberFixture() {
  const uid = 'b0000000-0000-4000-8000-000000000001';
  const id = n => 'a0000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const archived = location.search.includes('archived');
  const uploaded = location.search.includes('uploaded');
  const sameRound = location.search.includes('same_round');
  const courses = sameRound ? ['spinning','expression','answer','voice'] : ['voice'];
  const dates = ['2026-11-23','2026-11-24','2026-11-25','2026-11-26','2026-11-27','2026-11-30'];
  const opened = () => dates.map((date,i)=>({id:id(i+1),day_no:i+1,release_date:date,title:'연습 '+(i+1)}))
    .filter(m=>Date.parse(m.release_date+'T00:00:00+09:00')<=Date.now());
  const session = {user:{id:uid}};
  window.commands = [];
  window.mountedPush = [];
  window.YT = {PlayerState:{ENDED:0,PLAYING:1},Player:class {
    constructor(el,options) { this.events=options.events; this.time=0; window.testPlayer=this; queueMicrotask(()=>this.events.onReady({target:this})); }
    loadVideoById(selection) { window.commands.push(selection); this.time=selection.startSeconds; this.events.onStateChange({target:this,data:1}); }
    getCurrentTime() { return this.time; }
    destroy() {}
  }};
  window.MONC = {requireSession:async()=>session,requireConsent:async()=>true,getSession:async()=>session,
    sb:{functions:{invoke:async(name,{body})=>{
      if (name!=='challenge-week-video' || body.action!=='play') throw new Error(name);
      window.commands.push(body);
      if (window.denyVideo) return {error:{message:'forbidden'}};
      return {data:{ok:true,url:'https://media.example.test/storage/v1/object/sign/challenge-room-video/sample.mp4?token=fixture',urlExpiresAt:new Date(Date.now()+600000).toISOString()}};
    }},rpc:async(name,{p_action:a,p_data:p})=>{
      if (name!=='challenge_room') throw new Error(name);
      const cohorts=courses.map((code,i)=>({round:7,challenge:code,missions:opened().map(m=>({...m,
        id:id(i*10+m.day_no),title:(sameRound?code+' ':'')+m.title}))}));
      const cohort=cohorts.find(c=>c.missions.some(m=>m.id===p.id)), m=cohort?.missions.find(m=>m.id===p.id);
      if (a==='home') return {data:{server_now:new Date().toISOString(),
        history:sameRound?cohorts.map(c=>({challenge:c.challenge,round:7,day_no:1,mission_id:c.missions[0].id,
          title:c.challenge+' 제출',created_at:'2026-11-24T01:00:00Z'})):[],cohorts:archived?[]:cohorts}};
      if (a==='mission' && m) return {data:{mission:{...m,body:'연습',round:7,challenge:cohort.challenge,eligible:!archived,
        chapter:(!archived&&m.day_no!==2)?(uploaded
          ? {provider:'storage',week_no:1,start_seconds:2,end_seconds:5}
          : {provider:'youtube',video_id:'abcdef12345',week_no:1,start_seconds:8,end_seconds:12}):null},answers:[]}};
      return {error:{message:'미공개'}};
    }}};
  window.ChallengePush = {mount(el,settings){window.mountedPush.push([settings.challenge,settings.roundId]);}};
}

(async()=>{
  const browser=await chromium.launch({...(process.argv[3]?{executablePath:process.argv[3]}:{}),args:['--no-sandbox']});
  try {
    const ctx=await browser.newContext({viewport:{width:375,height:822},serviceWorkers:'block'});
    const external=[],errors=[];
    const fixtureRoute=async route=>{
      const url=new URL(route.request().url());
      if (url.origin+url.pathname===privateClip) {
        const fixturePath = process.argv[4] || path.join(site,'video/bq-candidate.mp4');
        const bytes = fs.readFileSync(fixturePath);
        const match = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
        if (!match) return route.fulfill({contentType:'video/mp4',body:bytes,headers:{'accept-ranges':'bytes'}});
        const start=Number(match[1]), end=match[2] ? Math.min(Number(match[2]),bytes.length-1) : bytes.length-1;
        return route.fulfill({status:206,contentType:'video/mp4',headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${bytes.length}`},body:bytes.subarray(start,end+1)});
      }
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
    const native = await freshPage();
    // 금요일 자정 이후에는 목요일 DAY 4와 금요일 DAY 5가 모두 열려 있다.
    await native.clock.setFixedTime(new Date('2026-11-27T00:10:00+09:00'));
    await native.goto(origin+'/challenge-mission.html?uploaded=1&id='+id(3));
    const play = native.locator('[data-chapter-play]'), full = native.locator('[data-chapter-full]');
    await play.waitFor();
    assert.equal(await full.getAttribute('href'),null);
    assert.deepEqual(await native.evaluate(()=>commands),[]);
    await native.evaluate(()=>{window.denyVideo=true});
    await play.click();
    await native.waitForFunction(()=>commands.length===1 && document.querySelector('[data-chapter-play]:enabled'));
    assert.equal(await native.locator('video[src]').count(),0);
    await native.evaluate(()=>{window.denyVideo=false});
    await play.click();
    const video=native.locator('.chapter-screen video');
    await native.waitForFunction(()=>{const v=document.querySelector('.chapter-screen video'); return v && !v.paused && v.currentTime>=2 && v.currentTime<5});
    assert.deepEqual(await native.evaluate(()=>commands.at(-1)),{action:'play',id:id(3)});
    await video.evaluate(v=>{v.currentTime=5.1});
    await play.waitFor();
    await full.click();
    await native.waitForFunction(()=>{const v=document.querySelector('.chapter-screen video'); return v && !v.paused && v.currentTime<2});
    await video.evaluate(v=>{v.currentTime=7});
    await native.waitForFunction(()=>{const v=document.querySelector('.chapter-screen video');return v && v.currentTime>=7});
    const beforeRenewal=await native.evaluate(()=>commands.length);
    await video.evaluate(v=>{v.dispatchEvent(new Event('error'))});
    await native.waitForFunction(count=>{
      const v=document.querySelector('.chapter-screen video');
      return commands.length===count+1 && v && !v.paused && v.currentTime>=7;
    },beforeRenewal);
    // 같은 원본의 동일 구간을 사용하는 두 DAY를 각각 선택하고 다시 연다.
    const sharedSegmentStarted = () => native.waitForFunction(()=>{
      const v=document.querySelector('.chapter-screen video');
      return v && !v.paused && v.currentTime>=2 && v.currentTime<5;
    });
    for (const day of [4,5]) {
      await native.getByRole('link',{name:new RegExp('DAY '+day+',')}).click();
      const heading = native.getByRole('heading',{name:'연습 '+day,exact:true});
      await heading.waitFor();
      const dayUrl = new URL(native.url());
      assert.equal(dayUrl.searchParams.get('id'),id(day));
      dayUrl.searchParams.set('uploaded','1');
      for (const reopen of [false,true]) {
        if (reopen) { await native.goto(dayUrl.href); await heading.waitFor(); }
        const panel = native.getByRole('region',{name:'DAY '+day+' 영상'});
        assert.equal(await panel.locator('.chapter-caption span').textContent(),'0:02 – 0:05');
        assert(await panel.getByRole('button',{name:'이번 주 영상 전체 보기'}).isVisible());
        assert.equal(await video.count(),0);
        await panel.getByRole('button',{name:'챕터 재생'}).click();
        await sharedSegmentStarted();
        assert.deepEqual(await native.evaluate(()=>commands.at(-1)),{action:'play',id:id(day)});
        await video.evaluate(v=>{v.currentTime=4.75;});
        const replay = panel.getByRole('button',{name:'챕터 다시 보기'});
        await replay.waitFor();
        assert.equal(await video.count(),0);
        await replay.click();
        await sharedSegmentStarted();
        assert.deepEqual(await native.evaluate(()=>commands.at(-1)),{action:'play',id:id(day)});
      }
    }
    const simultaneous=await freshPage();
    await simultaneous.clock.setFixedTime(new Date(fixtureNow));
    await simultaneous.goto(origin+'/challenge-mission.html?round=7&same_round=1');
    await simultaneous.getByRole('heading',{name:'voice 연습 3'}).waitFor();
    assert.deepEqual(await simultaneous.evaluate(()=>mountedPush.at(-1)),['voice',7]);
    const scopes=simultaneous.locator('#mission-cohort');
    assert.deepEqual((await scopes.locator('option').evaluateAll(options=>options.map(o=>o.value))).filter(Boolean).sort(),['answer:7','expression:7','spinning:7','voice:7']);
    await scopes.selectOption('spinning:7');
    await simultaneous.getByRole('heading',{name:'spinning 연습 3'}).waitFor();
    assert.deepEqual(await simultaneous.evaluate(()=>mountedPush.at(-1)),['spinning',7]);
    assert(await simultaneous.locator('a[href="submit.html?ch=spinning"]').isVisible());
    await simultaneous.locator('#history-link').click();
    await simultaneous.getByText('spinning 제출').waitFor();
    assert.equal(await simultaneous.getByText('voice 제출').count(),0);
    await simultaneous.goBack();
    await simultaneous.getByRole('heading',{name:'spinning 연습 3'}).waitFor();
    await simultaneous.getByRole('button',{name:'2주차',exact:true}).click();
    await simultaneous.getByRole('heading',{name:'2주차 미션은 아직 열리지 않았어요'}).waitFor();
    const selectedURL=new URL(simultaneous.url());
    assert.equal(selectedURL.searchParams.get('challenge'),'spinning');
    assert.equal(selectedURL.searchParams.get('round'),'7');
    const byId=await freshPage();
    await byId.clock.setFixedTime(new Date(fixtureNow));
    await byId.goto(origin+'/challenge-mission.html?id='+id(21)+'&same_round=1');
    await byId.getByRole('heading',{name:'answer 연습 1'}).waitFor();
    assert.deepEqual(await byId.evaluate(()=>mountedPush.at(-1)),['answer',7]);
    assert(await byId.locator('a[href="submit.html?ch=answer"]').isVisible());
    await byId.locator('#mission-cohort').selectOption('expression:7');
    await byId.getByRole('heading',{name:'expression 연습 3'}).waitFor();
    assert(await byId.locator('a[href="submit.html?ch=expression"]').isVisible());
    const unavailable=await freshPage();
    await unavailable.clock.setFixedTime(new Date(fixtureNow));
    await unavailable.goto(origin+'/challenge-mission.html?round=99&challenge=answer&same_round=1');
    await unavailable.locator('#mission-content[aria-busy="false"]').waitFor();
    assert.equal(await unavailable.locator('[data-chapter-play],#mission-submit').count(),0);
    assert.deepEqual(await unavailable.evaluate(()=>mountedPush),[]);
    assert.deepEqual(external,[]); assert.deepEqual(errors,[]);
    console.log('통과: 주차·요일 이동, 초안, KST 자정/잠금, YouTube 챕터, 업로드 MP4 구간/전체 재생, 다른 DAY의 같은 구간 재생·다시 열기, 접근 거부/재서명/복습');
  } finally { await browser.close(); }
})().catch(err=>{console.error(err);process.exitCode=1;});
