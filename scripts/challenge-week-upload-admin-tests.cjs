/* 실제 주차 관리자 폼에서 파일 선택, 전송 실패, 최종 등록 재시도, 취소를 검사한다. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.argv[2] || 'playwright');
const site = path.resolve(__dirname, '..');

function adminFixture() {
  const intents = new Map();
  const old = {challenge:'voice',round:2,week_no:1,provider:'youtube',video_url:'https://www.youtube.com/watch?v=oldWeek0001',locked:false};
  const missions=[];
  window.registered = [old];
  window.operations = [];
  window.transfers = [];
  window.listedCohorts = [];
  window.MONC = {
    getSession:async () => ({access_token:'test-session'}),
    sb:{
      rpc:async (name,{p_action,p_data}) => {
        if (name!=='challenge_room') throw Error(name);
        if (p_action==='admin-save') {
          const id='day-'+p_data.challenge+'-'+p_data.round+'-'+p_data.day_no;
          missions.push({...p_data,id,opens_at:p_data.release_date+'T00:00:00+09:00'});
          return {data:{id}};
        }
        if (p_action!=='admin-list') throw Error(name+' '+p_action);
        window.listedCohorts.push([p_data.challenge,p_data.round]);
        const matches=row=>row.challenge===p_data.challenge && row.round===p_data.round;
        return {data:{missions:structuredClone(missions.filter(matches)),week_videos:structuredClone(registered.filter(matches))}};
      },
      functions:{invoke:async (name,{body}) => {
        if (name!=='challenge-week-video') throw Error(name);
        operations.push(body);
        switch (body.action) {
          case 'admin-upload': {
            const id='upload-'+operations.length;
            intents.set(id,body);
            return {data:{ok:true,upload_id:id,token:'signature',path:id,bucket:'challenge-room-video',contentType:body.contentType,endpoint:'https://host.example.test/upload/resumable/sign'}};
          }
          case 'admin-commit': {
            if (window.failCommit) return {error:{message:'unavailable'}};
            const intent=intents.get(body.upload_id);
            registered=registered.filter(row=>row.week_no!==intent.week_no || row.round!==intent.round || row.challenge!==intent.challenge);
            registered.push({round:intent.round,challenge:intent.challenge,week_no:intent.week_no,file_name:intent.name,provider:'storage',locked:false});
            return {data:{ok:true}};
          }
          case 'admin-cancel': intents.delete(body.upload_id); return {data:{ok:true}};
          case 'admin-preview': return {data:{ok:true,url:URL.createObjectURL(new Blob([],{type:'video/mp4'}))}};
          default: throw Error(body.action);
        }
      }}
    }
  };
  window.tus={Upload:class {
    constructor(file,options) {this.file=file;this.options=options}
    start() {
      const options=this.options, file=this.file;
      transfers.push({chunk:options.chunkSize,metadata:options.metadata,headers:options.headers});
      options.onProgress(1,file.size);
      if (window.transferState==='hold') return;
      if (window.transferState==='fail') options.onError(new Error('interrupted'));
      else options.onSuccess();
    }
    async abort() {}
  }};
}

// 관리자 진입 가드, 대시보드 탭 전환, 기수 목록은 실제 페이지에서 동작한다.
function dashboardDatabase({rounds,slow}) {
  const stub=window.MONC;
  stub.requireAdmin=async()=>({id:'qa',name:'운영자'});
  stub.requireConsent=async()=>true;
  stub.sb.from=table=>{
    const query=new Proxy({}, {get(_,key) {
      if (key!=='then') return ()=>query;
      return (resolve,reject)=> {
        if (table==='challenge_rounds') {
          window.roundRequests=(window.roundRequests||0)+1;
          if (slow) {
            const prior=window.releaseRoundList;
            window.releaseRoundList=()=>{prior?.();resolve({data:rounds,error:null})};
            return;
          }
        }
        Promise.resolve({data:table==='challenge_rounds'?rounds:[],count:0,error:null}).then(resolve,reject);
      };
    }});
    return query;
  };
}

async function dashboardEntry(browser) {
  const origin='http://127.0.0.1:43239';
  const assets=path.resolve(process.argv[4]||site);
  const errors=[];
  const rounds=[7,8].map(n=>({id:'round-'+n,round:n,challenge:'voice',recruit_start:'2027-01-01',recruit_end:'2027-01-07',program_start:'2027-01-11'}));
  async function visit(width,query='',items=rounds,slow=false) {
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    const page=await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url()), file=decodeURIComponent(url.pathname.slice(1));
      if (url.origin!==origin) return route.fulfill({body:'',contentType:'text/javascript'});
      if (file==='supabase-config.js') {
        const body='('+adminFixture.toString()+')();('+dashboardDatabase.toString()+')('+JSON.stringify({rounds:items,slow})+');';
        return route.fulfill({body,contentType:'text/javascript; charset=utf-8'});
      }
      for (const dir of [site,assets]) {
        const candidate=path.join(dir,file);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return route.fulfill({path:candidate});
      }
      return route.fulfill({status:404,body:''});
    });
    await page.goto(origin+'/admin.html'+query);
    await page.locator('body.authed').waitFor();
    return page;
  }
  const direct='?tab=rounds&focus=voice-upload';
  const opened=page=>page.locator('#panel-rounds.active #missionSchedule[open]');
  for (const width of [375,1280]) {
    const page=await visit(width);
    const shortcut=page.locator('#msDashboardUpload');
    await shortcut.waitFor();
    const box=await shortcut.boundingBox();
    assert(box && box.y>=0 && box.y<900 && box.x>=0 && box.x+box.width<=width+1);
    assert.equal(await shortcut.innerText(),'챌린지 영상 업로드');
    await shortcut.click();
    await opened(page).waitFor();
    const challenge=page.locator('#msChallenge');
    assert.equal(await challenge.inputValue(),'');
    await challenge.selectOption('voice');
    await page.getByRole('button',{name:'2주차 영상 등록'}).click();
    const file=page.locator('#msWeekForm input[type=file]');
    await file.setInputFiles({name:'대기중.mp4',mimeType:'video/mp4',buffer:Buffer.from('demo')});
    await page.locator('#msChallengeUpload').click();
    await file.waitFor();
    assert.equal(await file.evaluate(el=>el.files[0].name),'대기중.mp4');
    // 뒤로 가기는 첫 화면, 앞으로 가기는 동일한 업로드 진입점으로 이동한다.
    await page.goBack();
    await shortcut.waitFor();
    await page.goForward();
    await opened(page).waitFor();
    await page.close();
  }
  const delayed=await visit(375,direct+'&round=7',rounds,true);
  await opened(delayed).waitFor();
  await delayed.waitForFunction(()=>typeof window.releaseRoundList==='function');
  await delayed.locator('#msChallengeUpload').click();
  await delayed.evaluate(()=>window.releaseRoundList());
  const select=delayed.locator('#msRound');
  await delayed.getByRole('button',{name:'2주차 영상 등록'}).waitFor();
  assert.equal(await select.inputValue(),'7');
  assert.deepEqual(await delayed.evaluate(()=>window.listedCohorts),[['voice',7]]);
  await select.selectOption('8');
  await delayed.waitForURL(url=>url.searchParams.get('round')==='8');
  await delayed.close();
  const empty=await visit(375,direct,[]);
  await opened(empty).waitFor();
  await empty.locator('#msStatus').getByText(/기수.*등록/).waitFor();
  assert.equal(await empty.locator('#msWeekForm input:visible').count(),0);
  await empty.close();
  const codes=['voice','spinning','expression','answer'];
  // 같은 번호를 가진 기수, 그리고 다른 상품에만 기수가 있는 경우를 함께 재현한다.
  const items=codes.filter(code=>code!=='answer').map(code=>({...rounds[0],id:'round-'+code,challenge:code}));
  const expanded=await visit(375,'?tab=rounds&focus=challenge-upload&challenge=spinning&round=7',items,true);
  await expanded.clock.setFixedTime(new Date('2026-11-27T11:00:00Z'));
  await opened(expanded).waitFor();
  await expanded.waitForFunction(()=>typeof window.releaseRoundList==='function');
  await expanded.locator('#msChallengeUpload').click();
  await expanded.evaluate(()=>releaseRoundList());
  const programs=expanded.locator('#msChallenge'), weekOne=expanded.getByRole('button',{name:'1주차 영상 등록'});
  await weekOne.waitFor();
  assert.deepEqual(await expanded.evaluate(()=>listedCohorts),[['spinning',7]]);
  assert.deepEqual((await programs.locator('option').evaluateAll(options=>options.map(o=>o.value))).filter(Boolean).sort(),[...codes].sort());
  await weekOne.click();
  const weekForm=expanded.locator('#msWeekForm');
  await weekForm.locator('input[type=file]').setInputFiles({name:'스피닝.mp4',mimeType:'video/mp4',buffer:Buffer.from('sample')});
  expanded.once('dialog',dialog=>dialog.dismiss());
  await programs.selectOption('expression');
  assert.equal(await programs.inputValue(),'spinning');
  assert.equal(await weekForm.locator('input[type=file]').evaluate(input=>input.files[0].name),'스피닝.mp4');
  await weekForm.locator('[type=submit]').click();
  await expanded.locator('#msWeekVideos').getByText('스피닝.mp4').waitFor();
  const uploaded=await expanded.evaluate(()=>operations.find(o=>o.action==='admin-upload'));
  assert.deepEqual([uploaded.challenge,uploaded.round,uploaded.week_no],['spinning',7,1]);
  await expanded.getByRole('button',{name:'미션 추가'}).click();
  const dayForm=expanded.locator('#msForm');
  await dayForm.locator('[name=title]').fill('스피닝 연습');
  await dayForm.locator('[name=body]').fill('오늘의 문장을 읽어보세요');
  await dayForm.locator('[name=withChapter]').check();
  await dayForm.locator('[name=date]').fill('2027-01-11');
  await dayForm.locator('[name=chapterStart]').fill('0:00');
  await dayForm.locator('[name=chapterEnd]').fill('0:15');
  await dayForm.locator('[type=submit]').click();
  await expanded.locator('#msList').getByText(/스피닝 연습/).waitFor();
  for (const [day,date,start,end] of [[3,'2027-01-13','0:12','0:20'],[4,'2027-01-14','0:02','0:05'],[5,'2027-01-15','0:02','0:05']]) {
    await expanded.getByRole('button',{name:'미션 추가'}).click();
    await dayForm.locator('[name=day]').selectOption(String(day));
    await dayForm.locator('[name=title]').fill('반복 듣기 '+day);
    await dayForm.locator('[name=body]').fill('오늘의 구간을 연습하세요.');
    await dayForm.locator('[name=withChapter]').check();
    await dayForm.locator('[name=date]').fill(date);
    await dayForm.locator('[name=chapterStart]').fill(start);
    const endField=dayForm.locator('[name=chapterEnd]');
    if (day===5) {
      await endField.fill(start);
      await dayForm.locator('[type=submit]').click();
      assert.equal(await endField.evaluate(input=>input.validity.valid),false);
      assert(await dayForm.isVisible());
    }
    await endField.fill(end);
    await dayForm.locator('[type=submit]').click();
    const saved=expanded.locator('#msList .ms-row').filter({hasText:'DAY '+day+' · 반복 듣기 '+day});
    await saved.waitFor();
    const metadata=await saved.locator('.ms-meta').innerText();
    assert(metadata.includes(date) && metadata.includes(start+'–'+end));
  }
  await programs.selectOption('expression');
  await weekOne.waitFor();
  assert.equal(await expanded.locator('#msWeekVideos').getByText('스피닝.mp4').count(),0);
  assert.equal(await expanded.locator('#msList').getByText(/스피닝 연습/).count(),0);
  await programs.selectOption('answer');
  await expanded.waitForFunction(()=>!document.querySelector('#msRound').value);
  assert.equal(await expanded.locator('#msWeekVideos button:enabled').count(),0);
  assert.equal(await expanded.evaluate(()=>listedCohorts.some(([program])=>program==='answer')),false);
  await programs.selectOption('spinning');
  await expanded.locator('#msWeekVideos').getByText('스피닝.mp4').waitFor();
  await expanded.close();
  assert.deepEqual(errors,[]);
  console.log('PASS 관리자 첫 화면·챌린지 바로가기, 파일 선택 유지, 뒤로/앞으로, 기수 지정/지연/빈 목록, 375·1280px');
}

(async()=>{
  const browser=await chromium.launch({...(process.argv[3]?{executablePath:process.argv[3]}:{}),args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:375,height:812},locale:'ko-KR'});
    const errors=[], requests=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route(/^https?:/,route=>{requests.push(route.request().url());return route.abort()});
    const html=fs.readFileSync(path.join(site,'admin.html'),'utf8');
    const panel=html.match(/<details class="les-wrap" id="missionSchedule">[\s\S]*?<\/details>/)[0];
    const css=html.match(/<style>([\s\S]*?)<\/style>/)[1];
    await page.setContent('<style>'+css+'</style><body class="authed"><main class="smain"><div class="rounds-wrap">'+panel+'</div></main>');
    await page.evaluate(adminFixture);
    await page.addScriptTag({path:path.join(site,'challenge-mission-admin.js')});
    await page.evaluate(()=>MONCMissionSchedule.setRounds([{challenge:'voice',round:2}]));
    await page.locator('#missionSchedule summary').click();
    await page.locator('#msChallenge').selectOption('voice');
    await page.getByRole('button',{name:'1주차 영상 수정'}).click();
    const form=page.locator('#msWeekForm'), input=form.locator('input[type=file]'), submit=form.locator('[type=submit]');
    const select=(name,mimeType)=>input.setInputFiles({name,mimeType,buffer:Buffer.from('sample')});
    await select('잘못된 파일.png','image/png');
    await submit.click();
    assert(await input.evaluate(el=>!el.validity.valid));
    assert.deepEqual(await page.evaluate(()=>operations),[]);
    await select('보신각 1주차.mp4','video/mp4');
    await page.evaluate(()=>{window.transferState='fail'});
    await submit.click();
    await page.waitForFunction(()=>operations.some(o=>o.action==='admin-cancel'));
    assert.equal(await page.evaluate(()=>registered[0].provider),'youtube');
    await page.evaluate(()=>{window.transferState='ok';window.failCommit=true});
    await submit.click();
    await page.waitForFunction(()=>operations.some(o=>o.action==='admin-commit'));
    assert.equal(await page.evaluate(()=>registered[0].provider),'youtube');
    await page.evaluate(()=>{window.failCommit=false});
    await submit.click();
    await page.locator('#msWeekVideos').getByText('보신각 1주차.mp4').waitFor();
    const result=await page.evaluate(()=>({operations,transfers}));
    assert.equal(result.transfers.length,2);
    assert.equal(result.transfers[1].chunk,6*1024*1024);
    assert.equal(result.transfers[1].metadata.bucketName,'challenge-room-video');
    assert.equal(result.transfers[1].headers['x-signature'],'signature');
    const commits=result.operations.filter(op=>op.action==='admin-commit');
    assert.equal(commits.length,2);
    assert.equal(commits[0].upload_id,commits[1].upload_id);
    await page.getByRole('button',{name:'1주차 원본 영상 보기'}).click();
    await page.locator('#msWeekPreview video[src]').waitFor();
    await page.locator('#msPreviewClose').click();
    assert.equal(await page.locator('#msWeekPreview video[src]').count(),0);
    await page.getByRole('button',{name:'2주차 영상 등록'}).click();
    await page.evaluate(()=>{window.transferState='hold'});
    await select('2주차.webm','video/webm');
    await submit.click();
    await page.locator('#msTransfer progress').waitFor();
    await page.locator('#msStopTransfer').click();
    await page.waitForFunction(()=>operations.filter(op=>op.action==='admin-cancel').length===2);
    assert.equal(await page.evaluate(()=>registered.length),1);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
    console.log('PASS 보신각 관리자 · 파일 검증, 중단·취소, 기존 영상 유지, 완료 재시도, 375px 미리보기');
    await dashboardEntry(browser);
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
