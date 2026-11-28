/* PGlite로 운영 마이그레이션/RPC를 실행한다. Playwright 경로를 주면 실제 관리자 폼도 같은 DB에 연결한다. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const site=path.resolve(__dirname,'..');
const migration=name=>fs.readFileSync(path.join(site,'supabase/migrations',name),'utf8');
const segments=[[0,6],[4,9],[9,15],[2,5],[2,5]];
const daySpec=day=>({day_no:day,title:'연습 '+day,body:'DAY '+day+' 미션 안내',
  chapter_start_seconds:segments[(day-1)%5][0],chapter_end_seconds:segments[(day-1)%5][1]});
const offset=(ymd,days)=>new Date(Date.parse(ymd+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);

async function run() {
  const db=new PGlite(), admin=randomUUID(), member=randomUUID(), outsider=randomUUID();
  const q=async(sql,args)=>(await db.query(sql,args)).rows;
  const scalar=async(sql,args)=>Object.values((await q(sql,args))[0])[0];
  const root=()=>db.exec('reset role');
  async function user(id) {
    await root();
    await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);
    await db.exec('set role authenticated');
  }
  const edge=async()=>{await root();await db.exec('set role service_role')};
  const call=(actor,action,data)=>scalar('select public.'+actor+'($1,$2::jsonb)',[action,JSON.stringify(data)]);
  const rpc=(action,data)=>call('challenge_curriculum',action,data);
  const room=(action,data)=>call('challenge_room',action,data);
  const media=(name,id,action,data)=>scalar('select public.'+name+'($1,$2,$3::jsonb)',[id,action,JSON.stringify(data)]);
  const commonMedia=(action,data,id=admin)=>media('challenge_curriculum_media',id,action,data);
  const courseMedia=(action,data,id=admin)=>media('challenge_video_media',id,action,data);
  const challenge='spinning', course={challenge}, cohort=round=>({challenge,round});
  const readyState=()=>rpc('admin-curriculum',course);
  const storageBucket='challenge-room-video';
  async function storeObject(objectName, size, contentType) {
    await root();
    await q('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)',[
      storageBucket,objectName,JSON.stringify({size,mimetype:contentType})]);
  }
  async function original(week,name,revision=0) {
    await edge();
    const payload={...course,week_no:week,name,size:128,contentType:'video/mp4',expected_source_revision:revision};
    const intent=await commonMedia('curriculum-upload',payload);
    await storeObject(intent.path,payload.size,payload.contentType);
    await edge();
    await commonMedia('curriculum-commit',{upload_id:intent.upload_id});
    await commonMedia('curriculum-commit',{upload_id:intent.upload_id});
    await user(admin);
    return intent.path;
  }
  const save=(day,revision,extra)=>rpc('admin-curriculum-save',{...course,...daySpec(day),...extra,expected_revision:revision});
  const schedule=(round,start,revision)=>rpc('admin-curriculum-schedule',{...cohort(round),start_date:start,expected_revision:revision});
  try {
    await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/challenge-room-schema.sql'),'utf8'));
    for (const file of ['20261126105000_challenge_room_midnight.sql','20261127090000_challenge_mission_weekly_chapters.sql',
      '20261127110000_challenge_week_video_storage.sql','20261128090000_challenge_room_four_challenges.sql']) {
      await db.exec(migration(file));
    }
    for(const [id,role] of [[admin,'admin'],[member,'member'],[outsider,'member']]) await q('insert into public.members values($1,now(),$2)',[id,role]);
    const monday=await scalar("select (date_trunc('week',now() at time zone 'Asia/Seoul')::date+14)::text");
    const rounds=[];
    for (const code of ['spinning','answer','voice']) {
      for (const number of [73,74,75,76]) {
        const start=offset(monday,number===74?14:0), id=randomUUID();
        await q('insert into public.challenge_rounds values($1,$2,$3,$4)',[id,code,number,start]);
        rounds.push({id,challenge:code,round:number,program_start:start,recruit_start:offset(monday,-14),recruit_end:offset(monday,-7)});
      }
    }
    await q("insert into public.applications(member_id,paid,payment_status,refunded,challenges) values($1,true,'paid',false,$2::jsonb),($3,true,'paid',false,$4::jsonb)",[
      member,JSON.stringify([cohort(73)]),outsider,JSON.stringify([{challenge:'voice',round:73}])]);
    // A partial manual cohort and an unambiguous legacy upload predate the upgrade.
    await user(admin);
    const legacy=await room('admin-save',{...cohort(76),...daySpec(1),chapter_start_seconds:null,chapter_end_seconds:null,release_date:monday});
    const legacyCohort={challenge:'voice',round:76,week_no:1};
    await edge();
    const old=await courseMedia('admin-upload',{...legacyCohort,name:'레거시.mp4',size:74,contentType:'video/mp4'});
    await storeObject(old.path,74,'video/mp4');
    await edge();
    await courseMedia('admin-commit',{upload_id:old.upload_id});
    await root();
    await db.exec(migration('20261128110000_challenge_chapter_reuse.sql'));
    await db.exec(migration('20261128120000_challenge_shared_curriculum.sql'));
    await db.exec(migration('20261128213500_sync_pending_chapter_ranges.sql'));
    await user(outsider);
    await assert.rejects(()=>rpc('admin-curriculum',course));
    await assert.rejects(()=>commonMedia('curriculum-preview',{...course,week_no:1}));
    await edge();
    await assert.rejects(()=>commonMedia('curriculum-preview',legacyCohort,outsider));
    assert.equal((await commonMedia('curriculum-preview',legacyCohort)).path,old.path);
    await user(admin);
    await assert.rejects(()=>rpc('admin-curriculum',{challenge:'culture'}));
    let state=await readyState();
    assert.equal(state.ready,false);
    assert.deepEqual(state.week_videos,[]);
    await assert.rejects(()=>schedule(73,monday,state.revision),/incomplete/);
    const first=await original(1,'1주차.mp4'), second=await original(2,'2주차.mp4');
    state=await readyState();
    let revision=state.revision;
    for(let day=1;day<=9;day++) revision=(await save(day,revision)).revision;
    await assert.rejects(()=>schedule(73,monday,revision),/incomplete/);
    await assert.rejects(()=>save(10,revision-1),/edit_conflict/);
    for (const [start,end] of [[5,5],[5,2],[-1,5],[0,86401]]) {
      await assert.rejects(()=>save(10,revision,{chapter_start_seconds:start,chapter_end_seconds:end}),/bad_chapter/);
    }
    revision=(await save(10,revision)).revision;
    state=await readyState();
    assert.equal(state.ready,true);
    assert.equal(state.days.length,10);
    assert.deepEqual((await room('admin-list',cohort(73))).missions,[]);
    assert.equal((await rpc('admin-curriculum',{challenge:'answer'})).ready,false);
    await assert.rejects(()=>schedule(73,offset(monday,-7),revision),/bad_schedule/);
    await assert.rejects(()=>schedule(73,offset(monday,5),revision),/bad_schedule/);
    await assert.rejects(()=>schedule(76,monday,revision),/schedule_conflict/);
    assert.deepEqual((await room('admin-list',cohort(76))).missions.map(m=>m.id),[legacy.id]);
    for (const [number,start] of [[73,monday],[74,offset(monday,14)]]) {
      const attempts=await Promise.all([schedule(number,start,revision),schedule(number,start,revision)]);
      assert(attempts.every(result=>result.mission_count===10));
      assert.equal(attempts.filter(result=>result.idempotent).length,1);
      assert.equal((await schedule(number,start,revision)).idempotent,true);
      const rows=(await room('admin-list',cohort(number))).missions;
      assert.deepEqual(rows.map(row=>row.day_no),[1,2,3,4,5,6,7,8,9,10]);
      assert.deepEqual(rows.map(row=>row.release_date),rows.map((_,i)=>offset(start,i+(i>4?2:0))));
      assert.deepEqual(rows.map(row=>[row.chapter_start_seconds,row.chapter_end_seconds]),[...segments,...segments]);
      assert(rows.every(row=>new Date(row.opens_at).getUTCHours()===15));
      await edge();
      for (const [week,source] of [[1,first],[2,second]]) assert.equal((await courseMedia('admin-preview',{...cohort(number),week_no:week})).path,source);
      await user(admin);
    }
    await assert.rejects(()=>schedule(73,offset(monday,7),revision),/schedule_conflict/);
    const previousRevision=revision;
    const startsAt = async number => (await room('admin-list',cohort(number))).missions[0].chapter_start_seconds;
    // Save twice through the real admin RPC, including the previously missed zero.
    for (const start of [3,0]) {
      revision=(await save(1,revision,{chapter_start_seconds:start})).revision;
      for (const n of [73,74]) assert.equal(await startsAt(n),start);
    }
    const third=await original(1,'다음 기수용.mp4',state.week_videos.find(v=>v.week_no===1).revision);
    revision=(await readyState()).revision;
    revision=(await save(1,revision,{title:'다음 기수 미션',chapter_start_seconds:2})).revision;
    assert((await schedule(73,monday,previousRevision)).idempotent);
    await schedule(75,monday,revision);
    const existing=(await room('admin-list',cohort(73))).missions[0];
    assert.equal(existing.title,'연습 1');
    assert.equal(await startsAt(73),0);
    assert.equal(await startsAt(75),2);
    assert.equal((await room('admin-list',cohort(75))).missions[0].title,'다음 기수 미션');
    await assert.rejects(()=>room('admin-delete',{...cohort(73),id:existing.id}),/locked/);
    await edge();
    assert.equal((await courseMedia('admin-preview',{...cohort(73),week_no:1})).path,first);
    assert.equal((await courseMedia('admin-preview',{...cohort(74),week_no:1})).path,first);
    assert.equal((await courseMedia('admin-preview',{...cohort(75),week_no:1})).path,third);
    await assert.rejects(()=>courseMedia('play',{id:existing.id},member));
    await user(admin);
    const sourceRev=async()=>(await readyState()).week_videos.find(v=>v.week_no===1).revision;
    const templateOnly=await original(1,'공통 전용.mp4',await sourceRev());
    async function disposable(paths) {
      await root();
      await q("update challenge_room_data.video_uploads set expires_at=now()-interval '2 days' where path=any($1::text[])",[paths]);
      return (await q("select u.path from challenge_room_data.unused_videos g join challenge_room_data.video_uploads u on g.id=u.id where u.path=any($1::text[]) order by u.path",[paths])).map(x=>x.path);
    }
    assert.deepEqual(await disposable([first,second,third,templateOnly]),[]);
    await user(admin);
    const replacement=await original(1,'새 공통 전용.mp4',await sourceRev());
    assert.deepEqual(await disposable([first,second,third,templateOnly,replacement]),[templateOnly]);
    // 기수는 커리큘럼보다 먼저 생기거나 날짜 미정으로 모집을 시작할 수도 있다.
    const insertRound=async(code,n,ymd)=>{
      const id=randomUUID();
      await root();
      await q('insert into public.challenge_rounds values($1,$2,$3,$4)',[id,code,n,ymd]);
      return id;
    };
    const scheduleState=async n=>{
      await user(admin);
      return (await rpc('admin-curriculum',cohort(n))).round_schedule;
    };
    const move=async(id,date)=>{
      await root();
      await q('update public.challenge_rounds set program_start=$1 where id=$2',[date,id]);
    };
    const readDays=async n=>{await user(admin);return (await room('admin-list',cohort(n))).missions;};
    const newCohort=await insertRound(challenge,77,offset(monday,5));
    assert.equal((await scheduleState(77)).start_date,offset(monday,7));
    const beforeMove=await readDays(77),ids=beforeMove.map(row=>row.id);
    assert.equal(ids.length,10);
    for(const weeks of [2,1]) {
      const shifted=offset(monday,weeks*7);
      await move(newCohort,shifted);
      assert.equal((await scheduleState(77)).start_date,shifted);
      const actual=await readDays(77);
      assert.deepEqual(actual.map(row=>row.id),ids);
      assert.deepEqual(actual.map(row=>[row.title,row.body,row.chapter_start_seconds,row.chapter_end_seconds]),
        beforeMove.map(row=>[row.title,row.body,row.chapter_start_seconds,row.chapter_end_seconds]));
      assert.deepEqual(actual.map(row=>row.release_date),ids.map((_,i)=>offset(shifted,i+(i>=5?2:0))));
    }
    await move(newCohort,offset(monday,7));
    assert.deepEqual((await readDays(77)).map(row=>row.id),ids);
    await assert.rejects(()=>move(newCohort,null),/schedule_locked/);
    await assert.rejects(()=>move(newCohort,offset(monday,-28)),/schedule_locked/);
    await root();
    const device=await scalar("insert into challenge_room_data.devices(member_id,endpoint,p256dh,auth_key) values($1,'https://fixture.invalid','x','y') returning id",[member]);
    await q("insert into challenge_room_data.push_deliveries(mission_id,device_id,member_id,enabled_at,state) values($1,$2,$3,now(),'sent')",[ids[0],device,member]);
    await assert.rejects(()=>move(newCohort,offset(monday,21)),/schedule_locked/);
    assert.equal((await scheduleState(77)).start_date,offset(monday,7));
    const pending=await insertRound(challenge,78,null);
    assert.equal((await scheduleState(78)).state,'empty');
    await move(pending,offset(monday,1));
    assert.equal((await scheduleState(78)).start_date,offset(monday,7));
    await insertRound(challenge,79,null);
    await user(admin);
    await schedule(79,monday,(await readyState()).revision);
    await root();
    assert.equal(await scalar('select program_start::text from public.challenge_rounds where challenge=$1 and round=79',[challenge]),monday);
    await insertRound('answer',77,monday);
    await user(admin);
    assert.equal((await rpc('admin-curriculum',{challenge:'answer',round:77})).round_schedule.state,'empty');
    await root();
    // This isolated clock fixture moves only DAY 1 into the past after testing immutability above.
    await db.exec('alter table challenge_room_data.missions disable trigger curriculum_locked_mission');
    await q('update challenge_room_data.missions set release_date=$1::date-28 where id=$2',[monday,existing.id]);
    await db.exec('alter table challenge_room_data.missions enable trigger curriculum_locked_mission');
    await assert.rejects(()=>move(rounds.find(r=>r.challenge===challenge&&r.round===73).id,offset(monday,7)),/schedule_locked/);
    await edge();
    assert.equal((await courseMedia('play',{id:existing.id},member)).path,first);
    await assert.rejects(()=>courseMedia('play',{id:existing.id},outsider));
    await root();
    await q('update public.applications set refunded=true where member_id=$1',[member]);
    await edge();
    await assert.rejects(()=>courseMedia('play',{id:existing.id},member));
    await root();
    console.log('PASS 공통 원본·10일 커리큘럼, 서로 다른 월요일·KST 자정 일정, 동일 원본 재사용, 중복/충돌/권한, 레거시·환불, 버전별 원본과 콘텐츠');
    if (process.argv[2]) await browserTest({admin,rounds,monday,user,edge,rpc,room,commonMedia,storeObject,root,q});
  } finally { await db.close(); }
}

async function browserTest({admin,rounds,monday,user,edge,rpc,room,commonMedia,storeObject,root,q}) {
  const {chromium}=require(process.argv[2]);
  const {dashboardDatabase}=require('./challenge-week-upload-admin-tests.cjs');
  const browser=await chromium.launch({...(process.argv[3]?{executablePath:process.argv[3]}:{}),args:['--no-sandbox']});
  const origin='http://127.0.0.1:43332';
  let queue=Promise.resolve(),uploads=0;
  const errors=[];
  const serial=async(fn)=>{
    const next=queue.then(fn);
    queue=next.catch(()=>{});
    return next;
  };
  function browserFixture() {
    window.MONC={getSession:async()=>({access_token:'fixture'}),sb:{
      rpc:(name,{p_action,p_data})=>window.challengeRequest(name,p_action,p_data),
      functions:{invoke:(name,{body})=>window.challengeRequest(name,body.action,body)}
    }};
    window.tus={Upload:class {
      constructor(file,options){this.file=file;this.options=options}
      async start(){
        const {metadata,onSuccess,onError}=this.options;
        try{await window.storeUpload(metadata.objectName,this.file.size,metadata.contentType);onSuccess()}catch(error){onError(error)}
      }
      async abort(){}
    }};
  }
  try {
    const page=await browser.newPage({viewport:{width:375,height:900},serviceWorkers:'block'});
    page.setDefaultTimeout(4500);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',dialog=>dialog.accept());
    await root();
    await q('create unique index if not exists test_browser_round_identity on public.challenge_rounds(challenge,round)');
    await page.exposeFunction('registerChallengeRounds',payload=>serial(async()=>{
      const saved=[];
      try {
        await root();
        for (const row of payload) {
          const [entry]=await q('insert into public.challenge_rounds (id,challenge,round,program_start) values ($1,$2,$3,$4) on conflict(challenge,round) do update set program_start=excluded.program_start returning id',
            [randomUUID(),row.challenge,row.round,row.program_start]);
          saved.push({...row,id:entry.id});
        }
        return {data:saved,error:null};
      } catch(error){return {error:{message:error.message}}}
    }));
    await page.exposeFunction('storeUpload',(name,size,type)=>serial(async()=>{await storeObject(name,size,type);uploads++;}));
    await page.exposeFunction('challengeRequest',(name,action,data)=>serial(async()=>{
      try {
        if (name==='challenge-week-video') {
          await edge();
          const result=await commonMedia(action,data);
          return {data:{ok:true,...result,bucket:'challenge-room-video',token:'fixture',endpoint:origin+'/upload'}};
        }
        await user(admin);
        if (name==='challenge_curriculum') return {data:await rpc(action,data)};
        if (name==='challenge_room') return {data:await room(action,data)};
        return {data:[]};
      } catch(e){return {error:{message:e.message}}}
    }));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if (url.origin!==origin) return route.fulfill({body:'',contentType:'text/javascript'});
      if (url.pathname==='/supabase-config.js') {
        const body='('+browserFixture.toString()+')();('+dashboardDatabase.toString()+')('+JSON.stringify({rounds,slow:false})+');';
        return route.fulfill({body,contentType:'text/javascript; charset=utf-8'});
      }
      const file=path.join(site,url.pathname.slice(1));
      return fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({status:404,body:''});
    });
    await page.goto(origin+'/admin.html');
    await page.locator('#msDashboardUpload').click();
    await page.locator('#msChallenge').selectOption('answer');
    // 공통 영상과 DAY 편집은 기수를 선택하지 않아도 사용할 수 있다.
    for (const week of [1,2]) {
      await page.locator('#mcWeek'+week).click();
      await page.locator('#mcWeekVideo').getByRole('button',{name:/등록|업로드/}).click();
      const form=page.locator('#msWeekForm');
      await form.locator('input[type=file]').setInputFiles({name:`공통 ${week}주차.mp4`,mimeType:'video/mp4',buffer:Buffer.from('mp4 '+week)});
      await form.locator('[type=submit]').click();
      await page.locator('#mcWeekVideo').getByText(`공통 ${week}주차.mp4`,{exact:false}).waitFor();
      for (let slot=1;slot<=5;slot++) {
        const n=(week-1)*5+slot, spec=daySpec(n);
        await page.locator('#mcDays').getByRole('button',{name:'DAY '+n+' 편집',exact:true}).click();
        const editor=page.locator('#mcDayForm');
        await editor.locator('[name=title]').fill(spec.title);
        await editor.locator('[name=body]').fill(spec.body);
        await editor.locator('[name=start]').fill(Math.floor(spec.chapter_start_seconds/60)+':'+String(spec.chapter_start_seconds%60).padStart(2,'0'));
        const endField=editor.locator('[name=end]');
        if (n===5) {
          await endField.fill(await editor.locator('[name=start]').inputValue());
          await editor.locator('[type=submit]').click();
          assert.equal(await endField.evaluate(input=>input.validity.valid),false);
          assert(await editor.isVisible());
        }
        await endField.fill(Math.floor(spec.chapter_end_seconds/60)+':'+String(spec.chapter_end_seconds%60).padStart(2,'0'));
        await editor.locator('[type=submit]').click();
        await editor.waitFor({state:'hidden'});
      }
    }
    assert.equal(uploads,2);
    for(const [number,move] of [[73,0],[74,14]]) {
      await page.locator('#msRound').selectOption(String(number));
      const start=offset(monday,move);
      await page.locator('#mcStart').fill(start);
      await page.locator('#mcSchedule').click();
      await page.waitForFunction(()=>document.querySelector('#mcSchedule')?.disabled);
      await serial(async()=>{
        await user(admin);
        const snapshot=await rpc('admin-curriculum',{challenge:'answer',round:number});
        assert.equal(snapshot.round_schedule.state,'scheduled');
        assert.equal(snapshot.round_schedule.start_date,start);
        const days=(await room('admin-list',{challenge:'answer',round:number})).missions;
        assert.deepEqual(days.map(d=>[d.chapter_start_seconds,d.chapter_end_seconds]),[...segments,...segments]);
        assert.deepEqual(days.slice(3,5).map(d=>d.release_date),[offset(start,3),offset(start,4)]);
      });
    }
    assert.equal(uploads,2);
    for(const width of [375,1280]) {
      await page.setViewportSize({width,height:900});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    await page.locator('#mcRecruit').click();
    assert.equal(await page.locator('#rfChallenge').inputValue(),'answer');
    await page.locator('#rfRound').fill('87');
    await page.locator('#rfMode').selectOption('fcfs');
    await page.locator('#rfStart').fill(monday);
    await page.locator('#rfProgram').fill(offset(monday,5));
    await page.locator('#roundSubmitBtn').click();
    const confirmation=page.locator('#rfMissionResult');
    await confirmation.getByText(/87기.*10일 미션 예약됨/).waitFor();
    assert((await confirmation.innerText()).includes(offset(monday,7)));
    await serial(async()=>{
      await user(admin);
      assert.equal((await room('admin-list',{challenge:'answer',round:87})).missions.length,10);
    });
    assert.deepEqual(errors,[]);
    console.log('PASS 실제 관리자 브라우저 → 공통 영상 2개·DAY 10개 저장 → 기존 두 기수 직접 예약 + 새 선착순 기수 자동 예약 및 결과 표시 (실제 RPC, 가상 비공개 전송)');
  } finally {await browser.close()}
}

run().catch(error=>{console.error(error);process.exitCode=1});
