// 운영 회원과 분리한 PostgreSQL에서 주차별 저장과 참여 권한을 검증한다.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const deps=process.argv[process.argv.indexOf('--deps')+1];
if(!process.argv.includes('--deps'))throw new Error('--deps에 기존 커뮤니티 테스트 의존성 경로를 지정하세요.');
const pkg=path.resolve(deps,'node_modules/@electric-sql/pglite/dist');
const {PGlite}=await import(pathToFileURL(path.join(pkg,'index.js')));
const {pg_trgm}=await import(pathToFileURL(path.join(pkg,'contrib/pg_trgm.js')));
const db=new PGlite({extensions:{pg_trgm}});
const [leader,student,peer,outside,room,other,t1,t2,answer,note,attach]=Array.from({length:11},()=>randomUUID());
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;create schema extensions;
create table auth.users(id uuid primary key);
create table public.members(id uuid primary key references auth.users,name text,phone text,agreed_at timestamptz,terms_version text,role text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated,anon,service_role;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);`);
for(const file of ['20261013090000_community.sql','20261103130738_community_study_reopen.sql','20261124191000_study_room.sql','20261124200000_my_study_feedback.sql']){
  await db.exec(await fs.readFile(path.join(root,'supabase/migrations',file),'utf8'));
}
for(const [i,user] of [leader,student,peer,outside].entries()){
  await db.query('insert into auth.users values($1)',[user]);
  await db.query("insert into public.members values($1,'테스트 회원','01000000000',now(),'2026-10-05','member')",[user]);
  await db.query('insert into monc_community.profiles(user_id,nickname) values($1,$2)',[user,['조장','팀원가','팀원나','다른팀'][i]]);
}
for(const [r,owner] of [[room,leader],[other,outside]]){
  await db.query("insert into monc_community.studies(id,owner_id,title,mode,schedule,description,capacity) values($1,$2,'검증용 스터디','online','토요일','승인된 팀원 과제 검증용',4)",[r,owner]);
  await db.query('insert into monc_community.study_rooms values($1)',[r]);
  await db.query("insert into monc_community.study_members(study_id,user_id,role) values($1,$2,'owner')",[r,owner]);
}
for(const u of [student,peer])await db.query("insert into monc_community.study_members(study_id,user_id,role) values($1,$2,'member')",[room,u]);
async function call(u,action,data={},r=room,role='authenticated'){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[u||'']);
  await db.exec('set role '+role);
  try{return(await db.query('select public.study_room($1,$2,$3::jsonb) result',[r,action,JSON.stringify(data)])).rows[0].result;}
  finally{await db.exec('reset role');}
}
async function file(u,action,data,r=room){
  await db.exec('set role service_role');
  try{return(await db.query('select public.study_room_file($1,$2,$3,$4::jsonb) result',[u,r,action,JSON.stringify(data)])).rows[0].result;}
  finally{await db.exec('reset role');}
}
async function logs(user,role='authenticated'){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);
  await db.exec('set role '+role);
  try{return (await db.query('select room_id, note_count::int as count from public.my_study_feedback()')).rows;}
  finally{await db.exec('reset role');}
}
const q=(id,question)=>({id,question,due:'2099-12-20T21:00:00+09:00',notice:'모임 안내'});
await assert.rejects(()=>call(null,'read',{},room,'anon'));
assert.equal(await call(outside,'available'),false);
await assert.rejects(()=>call(outside,'read'));
await assert.rejects(()=>call(student,'create-task',q(t1,'잘못된 등록')));
await call(leader,'create-task',q(t1,'첫 질문'));await call(leader,'create-task',q(t1,'첫 질문'));
await call(leader,'create-task',q(t2,'두 번째 질문'));
await call(student,'text',{id:answer,task:t1,body:'안내판을 옮기자고 제안했습니다.'});
await call(student,'text',{id:answer,task:t1,body:'안내판을 옮기자고 제안했습니다.'});
await assert.rejects(()=>call(student,'text',{id:randomUUID(),task:t1,body:'중복'}));
await assert.rejects(()=>call(outside,'note',{id:randomUUID(),answer,body:'다른 팀 피드백'},other));
await assert.rejects(()=>call(student,'note',{id:randomUUID(),answer,body:'본인 피드백'}));
await call(peer,'note',{id:note,answer,body:'안내판을 어디에 두었나요?'});
await call(peer,'note',{id:note,answer,body:'안내판을 어디에 두었나요?'});
assert.deepEqual(await logs(student),[{room_id:room,count:1}]);
assert.deepEqual(await logs(peer),[]);assert.deepEqual(await logs(outside),[]);
await assert.rejects(()=>logs(null,'anon'));
const fresh=await call(student,'read');
assert.deepEqual(fresh.tasks.map(t=>t.week),[1,2]);assert.equal(fresh.tasks[0].answers.length,1);
assert.deepEqual(fresh.tasks[0].answers[0].notes,[{name:'팀원나',body:'안내판을 어디에 두었나요?'}]);
assert.equal(fresh.tasks[0].answers[0].mine,true);assert.equal((await call(peer,'read')).tasks[0].answers[0].mine,false);
assert(!JSON.stringify(fresh).includes(student));
assert.deepEqual(await call(student,'upload-check',{id:attach,task:t2}),{saved:false});
await file(student,'attach',{id:attach,task:t2,path:'가상파일키',name:'연습.wav',mime:'audio/wav'});
assert.deepEqual(await call(student,'upload-check',{id:attach,task:t2}),{id:attach,saved:true});
assert.equal((await file(peer,'read',{id:attach})).name,'연습.wav');
assert(!JSON.stringify(await call(peer,'read')).includes('가상파일키'));
await assert.rejects(()=>file(outside,'read',{id:attach},other));
await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from monc_community.room_answers'));
await assert.rejects(()=>db.query("select public.study_room_file($1,$2,'read',$3)",[student,room,'{}']));await db.exec('reset role');
await db.query("update monc_community.room_tasks set due_at=now()-interval '1 minute' where id=$1",[t2]);
await assert.rejects(()=>call(peer,'text',{id:randomUUID(),task:t2,body:'마감 후'}));
await db.query('delete from monc_community.study_members where study_id=$1 and user_id=$2',[room,peer]);
await assert.rejects(()=>file(peer,'read',{id:attach}));await assert.rejects(()=>call(peer,'read'));
await db.query("update monc_community.studies set status='ended' where id=$1",[room]);
assert.equal((await call(student,'read')).tasks.length,2);await assert.rejects(()=>call(leader,'create-task',q(randomUUID(),'종료 후')));
assert.deepEqual(await logs(student),[{room_id:room,count:1}]);
await db.query("insert into monc_community.study_members(study_id,user_id,role) values($1,$2,'member')",[other,student]);
const otherTask=randomUUID(),otherAnswer=randomUUID();
await call(outside,'create-task',q(otherTask,'다른 스터디 과제'),other);
await call(student,'text',{id:otherAnswer,task:otherTask,body:'두 번째 모임의 답변'},other);
await call(outside,'note',{id:randomUUID(),answer:otherAnswer,body:'다른 팀의 피드백'},other);
assert.deepEqual(await logs(student),[{room_id:other,count:1},{room_id:room,count:1}]);
await db.query('delete from monc_community.study_members where study_id=$1 and user_id=$2',[other,student]);
assert.deepEqual(await logs(student),[{room_id:room,count:1}]);
await db.query('update monc_community.profiles set blocked=true where user_id=$1',[student]);
assert.deepEqual(await logs(student),[]);
await db.query('update monc_community.profiles set blocked=false where user_id=$1',[student]);
await db.query("update public.members set terms_version='previous' where id=$1",[student]);
await assert.rejects(()=>call(student,'read'));assert.deepEqual(await logs(student),[]);
console.log('통과: 두 주차 · 조장/팀원/다른 팀 · 저장/피드백/재조회 · 첨부 권한 · 마감/종료/탈퇴/동의 · 중복 재시도');
await db.close();