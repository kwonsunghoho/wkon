// 실제 PostgreSQL 엔진(PGlite)에 합성 데이터만 넣는다. 운영 DB·결제 호출 없음.
// 실행: node scripts/lecture-multislot-tests.cjs --pg <@electric-sql/pglite 경로>
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const arg=process.argv.indexOf('--pg');
if(arg<0)throw Error('--pg 로컬 검증 엔진 경로가 필요합니다.');
const {PGlite}=require(path.resolve(process.argv[arg+1]));
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
let checks=0;
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function public.monc_is_student() returns boolean language sql stable as $$select coalesce(current_setting('test.student',true),'')='true'$$;
 create table members(id uuid primary key, name text, phone text);
 create table special_lectures(id uuid primary key, title text, price integer, capacity integer, seats_left integer, visible boolean default true);
 create table lecture_slots(id uuid primary key, lecture_id uuid references special_lectures, slot_date date, start_time time, label text, sort_order integer default 0, capacity integer, seats_left integer);
 create table applications(id uuid primary key default gen_random_uuid(),name text,phone text,member_id uuid,lecture_id uuid references special_lectures,slot_id uuid references lecture_slots, challenges jsonb, total_price integer, payment_id text unique, payment_status text default 'pending',refunded boolean default false,paid boolean default false);
 `);
 await db.exec(fs.readFileSync('supabase/migrations/20260725120000_duplicate_application_guard.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20260822130000_lecture_seats_live_only.sql','utf8'));
 const scalar=async(sql,p=[])=>Object.values((await db.query(sql,p)).rows[0])[0];
 const insert=async({who=1,slots=[11,12],legacy,phone,price,payment,status='paid',lecture=1,items=[]}={})=>db.query(
  'insert into applications(name,phone,member_id,lecture_id,slot_ids,slot_id,challenges,total_price,payment_id,payment_status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *',
  ['검증계정',phone||'test-phone-'+who,id(100+who),id(lecture),slots===null?null:slots.map(x=>x===null?null:id(x)),legacy?id(legacy):null,JSON.stringify(items),price===undefined?(status==='free'?0:110000*Math.max(slots?.length||0,1)):price,payment||null,status]);
 const rejects=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);checks++;};
 await db.query('insert into special_lectures(id,title,price,capacity) values($1,$2,110000,30),($3,$4,110000,5),($5,$6,110000,5)',[id(1),'검증용 특강',id(2),'별도 특강',id(3),'단일 특강']);
 for(const n of [11,12,13])await db.query("insert into lecture_slots(id,lecture_id,slot_date,start_time,capacity,seats_left) values($1,$2,'2026-11-17','14:00',10,10)",[id(n),id(1)]);
 await db.query("insert into lecture_slots(id,lecture_id,capacity) values($1,$2,5)",[id(21),id(2)]);
 // 구 단일 신청을 먼저 넣어 마이그레이션 후 호환성과 좌석을 확인한다.
 await db.query('insert into applications(name,phone,member_id,lecture_id,slot_id,challenges,total_price) values($1,$2,$3,$4,$5,$6,110000)', ['기존 검증계정','legacy',id(109),id(1),id(11),'[]']);
 const migration=fs.readFileSync('supabase/migrations/20261113120000_lecture_multi_slots.sql','utf8');
 await db.exec(migration); await db.exec(migration);
 assert.equal(await scalar('select seats_left from lecture_slots where id=$1',[id(11)]),9);checks++;
 let a=(await insert()).rows[0];
 assert.equal(a.challenges.length,2);assert.equal(a.total_price,220000);assert.equal(a.slot_id,null);checks+=3;
 assert.deepEqual((await db.query('select seats_left from lecture_slots where id=any($1) order by id',[[id(11),id(12)]])).rows.map(r=>r.seats_left),[8,9]);checks++;
 assert.equal(await scalar('select seats_left from special_lectures where id=$1',[id(1)]),27);checks++;
 await insert({slots:[13]});checks++;
 await rejects(()=>insert({slots:[11]}),'MC002');
 await rejects(()=>insert({who:2,phone:'test-phone-1',slots:[12]}),'MC002');
 await rejects(()=>insert({phone:'different-phone',slots:[13]}),'MC002');
 await rejects(()=>insert({slots:[12,13]}),'MC002');
 await rejects(()=>insert({who:2,slots:[11,11]}),'MC003');
 await rejects(()=>insert({who:2,slots:[11,null]}),'MC003');
 await rejects(()=>insert({who:2,slots:[11,21]}),'MC003');
 await rejects(()=>insert({who:2,slots:[]}), 'MC003');
 await rejects(()=>insert({who:2,slots:[11],legacy:12}),'MC003');
 await rejects(()=>insert({who:2,price:110000}),'MC003');
 const before=await scalar('select count(*)::int from applications');
 await db.query('update lecture_slots set capacity=1 where id=$1',[id(13)]);
 await rejects(()=>insert({who:2,slots:[12,13]}),'MC001');
 assert.equal(await scalar('select count(*)::int from applications'),before);checks++;
 await insert({who:2,slots:null,legacy:12});checks++;
 await rejects(()=>insert({who:9,slots:[11]}),'MC002');
 await insert({who:3,lecture:3,slots:[]});checks++;
 await rejects(()=>insert({who:3,lecture:3,slots:[]}), 'MC002');
 // 사라진 응답의 재확인은 중복 결제 성공 경로(23505)로 가야 한다.
 await insert({who:4,slots:[11,12],payment:'synthetic-payment'});
 await rejects(()=>insert({who:4,slots:[11,12],payment:'synthetic-payment'}),'23505');
 // 환불·취소 기준은 기존 정책 그대로 결제 한 건의 모든 좌석을 반환한다.
 await db.query("update applications set payment_status='partial_refunded' where id=$1",[a.id]);
 await insert({slots:[11,12]});checks++;
 // 무료 재학생 신청은 본인·자격을 서버에서 판정한다.
 await db.query('insert into members values($1,$2,$3)',[id(150),'검증 재학생','free-student']);
 const free=async()=>await scalar('select apply_free_lecture_slots($1,$2)',[id(1),[id(11),id(12)]]);
 assert.equal((await free()).code,'not_authenticated');checks++;
 await db.exec(`set test.uid='${id(150)}'`);
 assert.equal((await free()).code,'not_student');checks++;
 await db.exec("set test.student='true'");
 assert.equal((await free()).ok,true);checks++;
 const student=(await db.query('select * from applications where member_id=$1',[id(150)])).rows[0];
 assert.equal(student.total_price,0);assert.equal(student.challenges.length,2);checks+=2;
 assert.equal((await free()).code,'duplicate');checks++;
 // 챌린지의 같은 기수 중복 차단은 바뀌지 않는다.
 const ch=round=>db.query('insert into applications(name,phone,member_id,challenges,total_price) values($1,$2,$3,$4,33000)',['챌린지 검증','challenge-user',id(160),JSON.stringify([{challenge:'voice',round}])]);
 await ch(1);await rejects(()=>ch(1),'MC002');await ch(2);checks++;
 assert.equal(await scalar('select lecture_multislot_ready()'),true);checks++;
 // 부모 정원도 행 수가 아니라 신청 시간대 수로 센다.
 await db.query('update special_lectures set capacity=1 where id=$1',[id(2)]);
 await db.query('insert into lecture_slots(id,lecture_id,capacity) values($1,$2,5)',[id(22),id(2)]);
 await rejects(()=>insert({who:60,lecture:2,slots:[21,22]}),'MC001');
 await db.close();console.log('특강 SQL '+checks+'건 통과 — 운영 호출 없음');
})().catch(e=>{console.error(e);process.exitCode=1});
