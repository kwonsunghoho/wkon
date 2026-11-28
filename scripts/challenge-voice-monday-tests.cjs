/* 독립 Postgres에서 실제 보신각 주간 편성·신청·기존 미션방 접근을 확인한다. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {PGlite} = require('@electric-sql/pglite');
const files = path.join(__dirname, '../supabase/migrations');
const sql = file => fs.readFileSync(path.join(files,file),'utf8');
async function test() {
  const db = new PGlite();
  const q = async (query, params=[]) => (await db.query(query,params)).rows;
  const one = async (query, params=[]) => Object.values((await q(query,params))[0])[0];
  const voice = round => ({challenge:'voice',round,price:30000});
  const mondaySql = "challenge_room_data.first_mission_monday((now() at time zone 'Asia/Seoul')::date)";
  try {
    await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/challenge-room-schema.sql'),'utf8'));
    await db.exec(`alter table public.challenge_rounds alter column id set default gen_random_uuid(),
      add recruit_start date, add recruit_end date, add start_mode text default 'scheduled', add created_at timestamptz default now(),
      add unique(challenge,round);
      alter table public.members add name text default '회원', add phone text default '01012340000';
      alter table public.applications add name text, add phone text, add payment_id text, add total_price int;
      create function public.monc_norm_phone(text) returns text language sql immutable as $$select nullif(regexp_replace($1,'[^0-9]','','g'),'')$$;
      create function public.monc_app_live(boolean,text) returns boolean language sql immutable as $$select not coalesce($1,false) and coalesce($2,'pending') not in ('refunded','cancelled','canceled','failed','partial_refunded')$$;
      create function public.monc_is_student() returns bool language sql as $$select auth.uid() is not null$$;
      grant insert,select on public.applications to service_role;`);
    for(const file of ['20261126105000_challenge_room_midnight.sql','20261127090000_challenge_mission_weekly_chapters.sql',
      '20261127110000_challenge_week_video_storage.sql','20261128090000_challenge_room_four_challenges.sql',
      '20261128110000_challenge_chapter_reuse.sql']) await db.exec(sql(file));
    const legacy=randomUUID(), member=randomUUID(), other=randomUUID();
    await q("insert into public.members(id,role,agreed_at) values($1,'member',now()),($2,'member',now())",[member,other]);
    await q("insert into public.challenge_rounds(id,challenge,round) values($1,'voice',6)",[legacy]);
    await q("insert into public.applications(member_id,paid,challenges) values($1,true,$2)",[other,JSON.stringify([voice(6)])]);
    for(const week of [1,2]) {
      const file=randomUUID();
      await q(`insert into challenge_room_data.video_uploads(id,round_id,week_no,actor_id,original_name,mime_type,bytes,path,expected_revision,status)
        values($1,$2,$3,$4,'source.mp4','video/mp4',100,$5,0,'committed')`,[file,legacy,week,member,week+'.mp4']);
      await q('insert into challenge_room_data.week_videos(round_id,week_no,upload_id) values($1,$2,$3)',[legacy,week,file]);
    }
    await q(`with inserted as (insert into challenge_room_data.missions(round_id,day_no,release_date,title,body)
      select $1,i,date '2020-01-06'+i-1+(case when i>5 then 2 else 0 end),'연습 '||i,'첫 문장' from generate_series(1,10) i returning id)
      insert into challenge_room_data.mission_chapters select id,2,5 from inserted`,[legacy]);
    await db.exec("create function challenge_room_data.previous_permission_probe() returns int language sql as 'select 1'; revoke all on function challenge_room_data.previous_permission_probe() from public; grant execute on function challenge_room_data.previous_permission_probe() to authenticated");
    await db.exec(sql('20261128120000_challenge_shared_curriculum.sql'));
    assert.equal(await one("select has_function_privilege('authenticated','challenge_room_data.previous_permission_probe()','execute')"),true);
    await db.exec(sql('20261128140000_voice_monday_admissions.sql'));
    await db.exec('select challenge_room_data.prepare_voice_weeks()');
    const weeks=await q('select round,id,program_start::text as day from public.challenge_rounds where weekly_voice order by program_start');
    assert.equal(weeks.length,2);
    assert.equal(await one("select count(*)::int from challenge_room_data.missions where round_id=$1",[weeks[0].id]),10);
    assert.equal(await one("select count(distinct upload_id)::int from challenge_room_data.week_videos"),2);
    assert.equal(await one("select count(*)::int from challenge_room_data.week_videos where not curriculum_copy"),2);
    const extra=randomUUID();
    await q("insert into public.challenge_rounds(id,challenge,round) values($1,'answer',91)",[extra]);
    await assert.rejects(q("insert into challenge_room_data.week_videos(round_id,week_no,upload_id) select $1,week_no,upload_id from challenge_room_data.week_videos where round_id=$2 and week_no=1",[extra,legacy]),error=>error.code==='23505');
    assert.equal(await one("select count(*)::int from challenge_room_data.curriculum_days where challenge='voice'"),10);
    assert.equal(await one("select (challenges->0->>'round')::int from public.applications where member_id=$1",[other]),6);
    const insert = async (date, items) => one(`insert into public.applications(member_id,paid,payment_status,payment_id,voice_paid_at,challenges)
      values($1,false,'paid',$2,$3,$4::jsonb) returning challenges`,[member,randomUUID(),date,JSON.stringify(items)]);
    await db.exec('set role service_role');
    const dateOf = (offset,hour) => new Date(Date.parse(weeks[0].day+'T00:00:00+09:00')+offset*86400000+hour*3600000).toISOString();
    const delayedLegacy=await insert('2020-09-01T12:00:00+09:00',[voice(6)]);
    assert.equal(delayedLegacy[0].round,6);
    const secondItem={challenge:'answer',round:4,price:30000};
    for(const [offset,hour,expected] of [[-3,18,0],[-2,23,0],[-1,23.99,0],[0,0,0],[0,23.99,0],[1,0,1]]) {
      const items=await insert(dateOf(offset,hour),[secondItem,voice(weeks[0].round)]);
      assert.deepEqual(items,[secondItem,voice(weeks[expected].round)]);
    }
    await db.exec('reset role');
    const bank=await one("insert into public.applications(phone,paid,payment_status,challenges,voice_paid_at) values('01098760000',false,'pending',$1,'2000-01-01') returning id",[JSON.stringify([voice(6)])]);
    assert.equal(await one('select voice_paid_at from public.applications where id=$1',[bank]),null);
    await q("update public.applications set challenges=$2 where id=$1",[bank,JSON.stringify([voice(weeks[1].round)])]);
    await q('update public.applications set paid=true where id=$1',[bank]);
    assert.equal(await one("select (challenges->0->>'round')::int from public.applications where id=$1",[bank]),weeks[0].round);
    await q("select set_config('request.jwt.claim.sub',$1,false)",[other]);
    await db.exec('set role authenticated');
    const free=await one("select public.apply_free_challenges(array['voice'])");
    assert.equal(free.ok,true); assert.equal(free.items[0].round,weeks[0].round);
    const home=await one("select public.challenge_room('home','{}')");
    const room=home.cohorts.find(x=>x.round===weeks[0].round);
    assert.equal(room.weekly_start,weeks[0].day);
    const kstToday=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
    assert.equal(room.missions.length,weeks[0].day===kstToday?1:0);
    assert.equal(home.cohorts.some(x=>x.round===weeks[1].round),false);
    await db.exec('reset role');
    await q("update public.applications set refunded=true where member_id=$1 and payment_status='free'",[other]);
    assert.equal(await one('select challenge_room_data.eligible($1,$2)',[other,weeks[0].id]),false);
    await db.exec(sql('20261128152000_admin_voice_participation.sql'));
    await db.exec(sql('20261128165000_voice_first_assignment.sql'));
    const staff=randomUUID();
    await q("insert into public.members(id,role,agreed_at) values($1,'admin',now())",[staff]);
    const applicationsBefore=await one('select count(*)::int from public.applications');
    const staffCall=action=>one('select public.admin_voice_participation($1)',[action]);
    await db.exec('set role authenticated');
    await assert.rejects(staffCall('join'),e=>e.code==='42501');
    assert.deepEqual(await staffCall('rounds'),[]);
    await db.exec('reset role');
    await q("select set_config('request.jwt.claim.sub',$1,false)",[staff]);
    await db.exec('set role authenticated');
    const joined=await staffCall('join');
    assert.equal(joined.round,weeks[0].round);
    assert.deepEqual(await staffCall('join'),joined);
    assert.deepEqual(await staffCall('rounds'),[joined.round]);
    const staffHome=await one("select public.challenge_room('home','{}')");
    assert.deepEqual(staffHome.cohorts.map(r=>r.round),[joined.round]);
    await assert.rejects(q("select * from challenge_room_data.admin_voice_entries"),e=>e.code==='42501');
    const preview=await one("select public.challenge_room('admin-list',$1)",[JSON.stringify(joined)]);
    assert.ok(preview.missions.some(m=>m.day_no===1));
    await db.exec('reset role');
    assert.equal(await one('select count(*)::int from public.applications'),applicationsBefore);
    assert.ok((await one("select public.challenge_video_media($1,'admin-preview',$2)",[staff,JSON.stringify({...joined,week_no:1})])).path);
    // 다음 기수는 테스트 당일 요일과 무관하게 첫 공개 전이다.
    await q("insert into challenge_room_data.admin_voice_entries values($1,$2)",[staff,weeks[1].id]);
    const beforeDay=await one("select id from challenge_room_data.missions where round_id=$1 and day_no=1",[weeks[1].id]);
    const secondDay=await one("select id from challenge_room_data.missions where round_id=$1 and day_no=2",[weeks[1].id]);
    const challenge=(action,data)=>one('select public.challenge_room($1,$2)',[action,JSON.stringify(data)]);
    const mediaAccess=(path,op)=>one('select public.challenge_room_audio_access($1,$2)',[path,op]);
    const request=randomUUID(), audioPath=staff+'/'+beforeDay+'/'+request+'.webm';
    await db.exec('set role authenticated');
    assert.equal((await challenge('home',{})).cohorts.find(c=>c.round===weeks[1].round).admin_first_day,beforeDay);
    assert.equal((await challenge('mission',{id:beforeDay})).mission.admin_preview,true);
    await assert.rejects(challenge('mission',{id:secondDay}),/not_found/);
    assert.equal(await mediaAccess(audioPath,'upload'),true);
    await q("insert into storage.objects(bucket_id,name) values('challenge-room-audio',$1)",[audioPath]);
    const payload={id:beforeDay,request_id:request,file_id:request,extension:'webm',body:'연습',shared:true};
    const saved=await challenge('submit',payload);
    assert.deepEqual(await challenge('submit',payload),saved);
    assert.equal((await challenge('mission',{id:beforeDay})).answers[0].shared,false);
    assert.equal(await mediaAccess(audioPath,'read'),true);
    assert.equal(await mediaAccess(audioPath,'cleanup'),false);
    await db.exec('reset role');
    const paidRow=await one("insert into public.applications(member_id,paid,challenges) values($1,true,$2) returning id",[other,JSON.stringify([voice(weeks[0].round)])]);
    await q("update public.applications set challenges=$2 where id=$1",[paidRow,JSON.stringify([voice(weeks[1].round)])]);
    assert.equal(await one('select challenge_room_data.eligible($1,$2)',[other,weeks[1].id]),true);
    await q("select set_config('request.jwt.claim.sub',$1,false)",[other]);
    await db.exec('set role authenticated');
    await assert.rejects(challenge('mission',{id:beforeDay}),/not_found/);
    await assert.rejects(challenge('submit',payload),/not_found/);
    assert.equal(await mediaAccess(audioPath,'read'),false);
    await db.exec('reset role');
    await q("select set_config('request.jwt.claim.sub',$1,false)",[staff]);
    await q("update public.members set role='member' where id=$1",[staff]);
    assert.equal(await one('select challenge_room_data.eligible($1,$2)',[staff,weeks[0].id]),false);
    await db.exec('set role authenticated');
    await assert.rejects(staffCall('join'),e=>e.code==='42501');
    await assert.rejects(one("select public.challenge_room('admin-list',$1)",[JSON.stringify(joined)]),e=>e.code==='42501');
    await db.exec('reset role');
    await q("update public.members set role='admin',agreed_at=null where id=$1",[staff]);
    await db.exec('set role authenticated');
    await assert.rejects(staffCall('join'),e=>e.code==='42501');
    await db.exec('reset role; set role anon');
    await assert.rejects(staffCall('join'),e=>e.code==='42501');
    await db.exec('reset role');
    console.log('PASS 관리자 본인 무료 입장·반복 입장·공통 과제 기수·1일차 영상 미리보기, 일반회원·미동의·권한 회수·익명 제한, 참가 신청 건수 보존');
    console.log('PASS 보신각 기존 자료·신청 보존, 월요일 두 기수/동일 원본, 한국시간 금~월 및 화요일 경계, 간편·이체·무료 배정, 입장·환불');
  } finally { await db.close(); }
}
test().catch(error=>{console.error(error);process.exitCode=1});
