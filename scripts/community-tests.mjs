// 운영 DB와 분리된 PostgreSQL에서 실제 SQL 권한·상태 전이를 검사한다.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const deps=process.argv[process.argv.indexOf('--deps')+1];
if(!deps || !process.argv.includes('--deps')) throw new Error('임시 테스트 의존성 경로를 --deps로 지정하세요.');
const {PGlite}=await import(pathToFileURL(path.resolve(deps,'node_modules/@electric-sql/pglite/dist/index.js')));
const {pg_trgm}=await import(pathToFileURL(path.resolve(deps,'node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js')));
const db=new PGlite({extensions:{pg_trgm}});
const ids={a:'00000000-0000-4000-8000-000000000011',b:'00000000-0000-4000-8000-000000000012',c:'00000000-0000-4000-8000-000000000013',admin:'00000000-0000-4000-8000-000000000021'};
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create schema extensions;
create table auth.users(id uuid primary key);create table public.members(id uuid primary key references auth.users(id) on delete cascade,name text,phone text,agreed_at timestamptz,terms_version text,role text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
insert into auth.users values ${Object.values(ids).map(v=>`('${v}')`).join(',')};
insert into public.members select id,'테스트 회원','010-0000-0000',now(),'2026-10-05',case when id='${ids.admin}' then 'admin' else 'member' end from auth.users;`);
await db.exec(await fs.readFile(path.join(root,'supabase/migrations/20261013090000_community.sql'),'utf8'));
let checks=0;
async function call(role,uid,fn,action,data={}){
  await db.exec(`reset role;set request.jwt.claim.sub='${uid||''}';set role ${role};`);
  try{return (await db.query(`select public.${fn}($1,$2::jsonb) result`,[action,JSON.stringify(data)])).rows[0].result;}finally{await db.exec('reset role');}
}
async function ok(name,fn){await fn();checks++;process.stdout.write('통과: '+name+'\n');}
async function denied(fn,part){await assert.rejects(fn,err=>!part||String(err.message).includes(part));}
const member=(u,a,d)=>call('authenticated',u,'community_member',a,d);
const admin=(a,d)=>call('authenticated',ids.admin,'community_admin',a,d);
const read=(a,d)=>call('anon',null,'community_read',a,d);
const profiles={};
await ok('비회원 쓰기·회원 관리 권한 차단',async()=>{
  await denied(()=>call('anon',null,'community_member','profile-save',{nickname:'거짓회원'}));
  await denied(()=>call('authenticated',ids.a,'community_admin','queue'),'forbidden');
  await db.exec('set role authenticated');await denied(()=>db.query('select public.community_cleanup_candidates()'));await denied(()=>db.query('select public.community_asset_access($1,$2,false)',[ids.a,ids.b]));await db.exec('reset role');
  await db.exec('set role authenticated');await denied(()=>db.query('select * from monc_community.profiles'));await db.exec('reset role');
});
await ok('프로필 저장과 닉네임 중복 방지',async()=>{
 for(const [key,u] of Object.entries(ids)) profiles[key]=(await member(u,'profile-save',{nickname:'테스트'+key,goals:'공통',skills:['basic','voice'],sample_scope:'organizer'})).item;
 await denied(()=>member(ids.b,'profile-save',{nickname:'테스트a'}));
 await denied(()=>member(ids.a,'profile-save',{nickname:'테스트a',skills:['invalid']}),'bad_skills');
});
let post,comment,study,proof,asset;
await ok('게시글 공개 검색·댓글 검색과 타인 수정 차단',async()=>{
 post=(await member(ids.a,'post-save',{category:'question',title:'지원서 경력 질문',body:'회차 안내를 확인하고 싶습니다.'})).id;
 comment=(await member(ids.b,'comment-save',{post_id:post,body:'댓글에서만 나오는 검색어 테스트단어'})).id;
 assert.equal((await read('posts',{q:'테스트단어'})).items.length,1);
 await denied(()=>member(ids.b,'post-save',{id:post,category:'free',title:'가짜 수정',body:'이 내용은 수정할 수 없어야 합니다.'}),'forbidden');
 assert.equal((await read('thread',{id:post})).item.comments.length,1);
 assert.ok((await member(ids.a,'notices')).items.some(v=>v.kind==='thread'));
});
await ok('게시판 주제를 글 종류와 별도로 저장·검색',async()=>{
 const id=(await member(ids.a,'post-save',{topic:'hair',category:'question',title:'헤메 예약 질문',body:'면접일 예약 시간을 질문합니다.'})).id;
 assert.equal((await read('thread',{id})).item.topic,'hair');
 assert.ok((await read('posts',{topic:'hair'})).items.every(p=>p.topic==='hair'));
 assert.ok(!(await read('posts',{topic:'prep'})).items.some(p=>p.id===id));
 await member(ids.a,'post-save',{id,topic:'free',category:'info',title:'예약 확인 안내',body:'예약 전 확인한 정보를 공유합니다.'});
 assert.equal((await read('thread',{id})).item.topic,'free');
 await denied(()=>member(ids.a,'post-save',{topic:'invalid',category:'info',title:'없는 주제',body:'허용한 게시판만 저장되어야 합니다.'}),'check constraint');
});
await ok('인증 원본은 서비스 함수만 접근·관리자 심사만 승인',async()=>{
 await db.exec('reset role');
 asset=(await db.query('select public.community_asset_create($1,$2,$3,$4,$5,$6,$7) id',[ids.b,'proof','테스트 인증 원본',ids.b+'/11111111-1111-4111-8111-111111111111.pdf','application/pdf',100,'private'])).rows[0].id;
 proof=(await member(ids.b,'proof-submit',{airline:'테스트항공',year:2026,stage:'최종면접 진출',asset_id:asset})).id;
 await denied(()=>call('authenticated',ids.b,'community_admin','proof-decide',{id:proof,decision:'approve'}),'forbidden');
 await denied(()=>db.query('select public.community_asset_access($1,$2,false)',[ids.a,asset]),'forbidden');
 await admin('proof-decide',{id:proof,decision:'approve'});
 assert.equal((await member(ids.b,'profile')).item.certificates.length,1);
 const expires=(await db.query('select expires_at>now()+interval \'29 days\' and expires_at<now()+interval \'31 days\' valid from monc_community.assets where id=$1',[asset])).rows[0].valid;
 assert.equal(expires,true);
 await denied(()=>admin('proof-decide',{id:proof,decision:'approve'}),'already_processed');
});
await ok('실력은 관리자 평가만 부여·준비 항목과 구분',async()=>{
 await admin('assessment-save',{profile_id:profiles.b.id,level:2,skills:['voice'],method:'test',date:'2026-10-13'});
 const p=(await member(ids.b,'profile')).item;assert.equal(p.assessment.level,2);assert.deepEqual(p.assessment.skills,['voice']);
 await member(ids.b,'profile-save',{nickname:'테스트b',skills:['basic','voice'],level:3,confirmed_skills:['feedback']});
 assert.equal((await member(ids.b,'profile')).item.assessment.level,2);
});
let appB,appC;
await ok('스터디 조건·중복지원·정원·모집자 권한을 서버에서 판단',async()=>{
 const ownerAsset=(await db.query('select public.community_asset_create($1,$2,$3,$4,$5,$6,$7) id',[ids.a,'proof','모집자 가상 인증',ids.a+'/33333333-3333-4333-8333-333333333333.pdf','application/pdf',100,'private'])).rows[0].id;
 const ownerProof=(await member(ids.a,'proof-submit',{airline:'테스트항공',year:2026,stage:'최종면접 진출',asset_id:ownerAsset})).id;
 await admin('proof-decide',{id:ownerProof,decision:'approve'});
 await admin('assessment-save',{profile_id:profiles.a.id,level:2,skills:['voice'],method:'class',date:'2026-10-13'});
 await denied(()=>member(ids.c,'study-save',{title:'본인이 미달하는 모집글',mode:'online',schedule:'매주 저녁',description:'모집자도 조건을 만족해야 합니다.',capacity:3,min_level:3}),'not_eligible');
 study=(await member(ids.a,'study-save',{title:'테스트 실전 스터디',goals:'공통',mode:'online',schedule:'수요일 저녁',description:'같이 답변과 추가 질문을 연습합니다.',capacity:2,min_level:2,require_experience:true,required_skills:['basic']})).id;
 await denied(()=>member(ids.c,'apply',{id:study,message:'함께 연습하고 싶습니다.'}),'not_eligible');
 appB=(await member(ids.b,'apply',{id:study,message:'함께 연습하고 싶습니다.'})).id;
 assert.equal((await member(ids.b,'apply',{id:study,message:'다시 지원한 메시지입니다.'})).duplicate,true);
 await denied(()=>member(ids.c,'application-decide',{id:appB,decision:'accept'}),'forbidden');
 await member(ids.a,'application-decide',{id:appB,decision:'accept'});
 assert.equal((await read('study',{id:study})).item.members,2);
 await member(ids.a,'study-guide',{id:study,guide:'승인된 참여자만 보는 모임 안내입니다.'});
 assert.equal((await member(ids.b,'study-state',{id:study})).member_guide,'승인된 참여자만 보는 모임 안내입니다.');
 assert.equal((await member(ids.c,'study-state',{id:study})).member_guide,null);
 assert.equal((await read('study',{id:study})).item.member_guide,undefined);
 await denied(()=>member(ids.b,'apply',{id:study,message:'또 지원할 수 없어요.'}),'already_joined');
});
await ok('샘플은 실제 지원 관계의 모집자만 확인',async()=>{
 const sample=(await db.query('select public.community_asset_create($1,$2,$3,$4,$5,$6,$7) id',[ids.b,'text','테스트 답변',ids.b+'/22222222-2222-4222-8222-222222222222.txt','text/plain',20,'organizer'])).rows[0].id;
 assert.ok((await db.query('select public.community_asset_access($1,$2,false) item',[ids.a,sample])).rows[0].item.path);
 assert.equal((await member(ids.a,'profile',{id:profiles.b.id})).item.samples.length,1);
 assert.equal((await member(ids.c,'profile',{id:profiles.b.id})).item.samples.length,0);
 await denied(()=>db.query('select public.community_asset_access($1,$2,false)',[ids.c,sample]),'forbidden');
 await member(ids.b,'study-leave',{id:study});
 assert.equal((await member(ids.a,'profile',{id:profiles.b.id})).item.samples.length,0);
 await denied(()=>db.query('select public.community_asset_access($1,$2,false)',[ids.a,sample]),'forbidden');
});
await ok('승인 직전 실력 변경을 다시 확인',async()=>{
 appB=(await member(ids.b,'apply',{id:study,message:'다시 함께 연습하고 싶습니다.'})).id;
 await admin('assessment-revoke',{profile_id:profiles.b.id});
 await denied(()=>member(ids.a,'application-decide',{id:appB,decision:'accept'}),'not_eligible');
 await member(ids.b,'application-withdraw',{id:appB});
});
await ok('모집 종료는 지원을 닫고 기존 팀을 유지',async()=>{
 const open=(await member(ids.a,'study-save',{title:'누구나 참여하는 스터디',mode:'online',schedule:'토요일 오전',description:'처음 준비하는 회원들과 답변을 만듭니다.',capacity:3})).id;
 appC=(await member(ids.c,'apply',{id:open,message:'처음부터 함께 준비하고 싶습니다.'})).id;
 await member(ids.a,'study-close',{id:open});
 assert.equal((await member(ids.c,'activity')).applications.find(v=>v.id===appC).status,'closed');
 assert.equal((await read('study',{id:open})).item.members,1);
 await denied(()=>member(ids.a,'application-decide',{id:appC,decision:'accept'}),'already_processed');
});
await ok('신고 후 숨김과 게시자 수정으로 공개 복구 금지',async()=>{
 await member(ids.b,'report',{id:post,type:'post',reason:'개인정보가 들어 있어 확인을 부탁합니다.'});
 const r=(await admin('queue')).reports[0];await admin('report-resolve',{id:r.id,decision:'hide'});
 await member(ids.a,'post-save',{id:post,category:'question',title:'수정한 제목',body:'내용을 수정해도 자동으로 공개되지 않습니다.'});
 assert.equal((await read('thread',{id:post})).item,null);
});
await ok('계정 파기 즉시 원본 차단·본문 파기·파일 정리 대상 반영',async()=>{
 await db.query('delete from auth.users where id=$1',[ids.b]);
 assert.equal((await db.query('select count(*)::int n from monc_community.profiles where user_id=$1',[ids.b])).rows[0].n,0);
 await denied(()=>member(ids.b,'profile'),'login_required');
 assert.ok((await db.query('select public.community_cleanup_candidates() items')).rows[0].items.length>=2);
 assert.equal((await db.query('select body from monc_community.comments where id=$1',[comment])).rows[0].body,'삭제된 댓글입니다.');
});
await ok('원본 정리 예약은 자격 증명을 비공개 보관소에서 읽고 회원 실행 차단',async()=>{
 await db.exec(`create schema vault;create schema net;create schema cron;
 create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('monc_lab_cleanup_service_role','가상 서비스 자격');
 create table net.test_requests(url text,headers jsonb,body jsonb,timeout_ms integer);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$begin insert into net.test_requests values(url,headers,body,timeout_milliseconds);return 1;end$$;
 create table cron.test_jobs(name text,schedule text,command text);
 create function cron.schedule(job_name text,schedule text,command text) returns bigint language plpgsql as $$begin insert into cron.test_jobs values(job_name,schedule,command);return 1;end$$;`);
 const schedule=(await fs.readFile(path.join(root,'supabase/migrations/20261013091000_community_cleanup.sql'),'utf8')).replace(/create extension if not exists pg_(cron|net)[^;]*;/g,'');
 await db.exec(schedule);
 await db.exec('set role authenticated');await denied(()=>db.query('select public.monc_run_community_cleanup()'));await db.exec('reset role');
 await db.query('select public.monc_run_community_cleanup()');
 const request=(await db.query('select * from net.test_requests')).rows[0];assert.deepEqual(request.body,{action:'cleanup'});assert.equal(request.headers.Authorization,'Bearer 가상 서비스 자격');assert.equal(request.headers['x-cleanup-authorization'],'Bearer 가상 서비스 자격');
 assert.equal((await db.query('select schedule from cron.test_jobs')).rows[0].schedule,'20 * * * *');
});
await db.close();process.stdout.write(`완료: ${checks}개 실제 PostgreSQL 동작 검사 통과\n`);
