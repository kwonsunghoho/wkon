// 실제 운영 SQL을 메모리 PostgreSQL에서 실행한다. 운영 회원·Storage는 호출하지 않는다.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stage=repo;
const dependencyRoot=process.argv[process.argv.indexOf('--deps')+1];
if(!process.argv.includes('--deps')||!dependencyRoot)throw new Error('--deps로 테스트 의존성 경로를 지정하세요.');
const deps=path.join(dependencyRoot,'node_modules/@electric-sql/pglite/dist');
const {PGlite}=await import(pathToFileURL(path.join(deps,'index.js')));
const {pg_trgm}=await import(pathToFileURL(path.join(deps,'contrib/pg_trgm.js')));
export async function database(){
 const db=new PGlite({extensions:{pg_trgm}});
 const ids={a:'00000000-0000-4000-8000-000000000011',b:'00000000-0000-4000-8000-000000000012',admin:'00000000-0000-4000-8000-000000000021'};
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create schema extensions;
 create table auth.users(id uuid primary key);create table public.members(id uuid primary key references auth.users(id) on delete cascade,name text,phone text,agreed_at timestamptz,terms_version text,role text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 insert into auth.users values ${Object.values(ids).map(id=>`('${id}')`).join(',')};
 insert into public.members select id,'가상 회원','010-0000-0000',now(),'2026-10-05',case when id='${ids.admin}' then 'admin' else 'member' end from auth.users;`);
 await db.exec(await fs.readFile(path.join(repo,'supabase/migrations/20261013090000_community.sql'),'utf8'));
 await db.exec(await fs.readFile(path.join(stage,'supabase/migrations/20261015102632_community_operator.sql'),'utf8'));
 async function call(who,fn,action,data={}){await db.exec(`reset role;set request.jwt.claim.sub='${ids[who]||''}';set role ${who?'authenticated':'anon'};`);try{return(await db.query(fn==='community_guides'?'select public.community_guides($1) result':`select public.${fn}($1,$2::jsonb) result`,fn==='community_guides'?[data.p_scope||'']:[action,JSON.stringify(data)])).rows[0].result;}finally{await db.exec('reset role');}}
 const member=(who,a,d)=>call(who,'community_member',a,d),op=(a,d)=>call('admin','community_operator',a,d);
 const a=(await member('a','profile-save',{nickname:'예시회원A',skills:['basic']})).item;
 const b=(await member('b','profile-save',{nickname:'예시회원B',skills:['basic']})).item;
 const post=(await member('a','post-save',{topic:'prep',category:'question',title:'예시 지원서 질문',body:'가상 데이터로 작성한 관리자 확인용 질문입니다.'})).id;
 const comment=(await member('b','comment-save',{post_id:post,body:'화면 검증을 위한 예시 댓글입니다.'})).id;
 const study=(await member('a','study-save',{title:'예시 온라인 면접 스터디',mode:'online',schedule:'토요일 오전 10시',description:'화면 검증을 위한 가상 스터디 모집글입니다.',capacity:4,min_level:0,required_skills:[]})).id;
 await member('b','apply',{id:study,message:'함께 답변을 연습하고 싶은 가상 지원입니다.'});
 const asset=(await db.query('select public.community_asset_create($1,$2,$3,$4,$5,$6,$7) id',[ids.b,'proof','가상 인증 원본',ids.b+'/proof.pdf','application/pdf',100,'private'])).rows[0].id;
 const proof=(await member('b','proof-submit',{airline:'예시항공',year:2026,stage:'1차 면접 진출',asset_id:asset})).id;
 await member('b','report',{type:'post',id:post,reason:'예시 신고 사유입니다.'});
 return {db,ids,call,member,op,a,b,post,comment,study,asset,proof};
}
if(process.argv.includes('--test')){
 const {db,ids,call,member,op,a,b,post,comment,study,asset,proof}=await database();let n=0;
 async function test(label,fn){await fn();n++;process.stdout.write('통과: '+label+'\n');}
 await test('비회원·일반 회원 운영 권한 차단',async()=>{await assert.rejects(()=>call('','community_operator','overview'));await assert.rejects(()=>call('a','community_operator','overview'),/forbidden/);await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from monc_community.board_guides'));await db.exec('reset role');});
 await test('실제 집계와 관리 목록',async()=>{const r=await op('overview');assert.equal(r.proofs,1);assert.equal(r.reports,1);for(const action of ['posts','comments','studies','proofs','reports'])assert.equal((await op(action)).items.length,1);assert.equal((await op('profiles',{q:'예시'})).items.length,2);});
 await test('사유 필수·게시글 숨김 및 복원',async()=>{await assert.rejects(()=>op('moderate',{id:post,type:'post',decision:'hide'}),/reason_required/);await op('moderate',{id:post,type:'post',decision:'hide',note:'테스트 숨김'});assert.equal((await call('','community_read','thread',{id:post})).item,null);await op('moderate',{id:post,type:'post',decision:'restore',note:'테스트 복원'});assert.ok((await call('','community_read','thread',{id:post})).item);});
 await test('댓글 숨김·복원·삭제 댓글 복원 거부',async()=>{await op('moderate',{id:comment,type:'comment',decision:'hide',note:'댓글 조치'});assert.equal((await op('comments',{status:'hidden'})).items.length,1);await op('moderate',{id:comment,type:'comment',decision:'restore',note:'댓글 복원'});await member('a','report',{type:'comment',id:comment,reason:'삭제 전 접수된 댓글 신고'});const cr=(await op('reports')).items.find(r=>r.target_type==='comment');await member('b','comment-delete',{id:comment});await assert.rejects(()=>op('moderate',{id:comment,type:'comment',decision:'restore',note:'삭제 복원 거부'}),/not_found/);await assert.rejects(()=>op('report-resolve',{id:cr.id,decision:'hide',note:'삭제 댓글 숨김 거부'}),/not_found/);await op('report-resolve',{id:cr.id,decision:'dismiss',note:'이미 삭제된 댓글의 신고 종결'});});
 await test('스터디 상태 보존·대기 지원 종료·종료 지원 유지',async()=>{await op('moderate',{id:study,type:'study',decision:'hide',note:'모집글 숨김'});assert.equal((await db.query('select status from monc_community.applications')).rows[0].status,'closed');await op('moderate',{id:study,type:'study',decision:'restore',note:'모집글 복원'});assert.equal((await op('studies')).items[0].status,'open');assert.equal((await db.query('select status from monc_community.applications')).rows[0].status,'closed');});
 await test('서류 확인 항목 필수·중복 심사 거부·30일 보관',async()=>{await assert.rejects(()=>op('proof-decide',{id:proof,decision:'approve',note:'확인 완료'}),/checks_required/);await op('proof-decide',{id:proof,decision:'approve',checks:[true,true,true],note:'원본 확인 완료'});await assert.rejects(()=>op('proof-decide',{id:proof,decision:'reject',note:'중복 심사 거부'}),/already_processed/);assert.equal((await db.query('select active from monc_community.certificates')).rows[0].active,true);const r=(await db.query('select expires_at>now()+interval \'29 days\' valid from monc_community.assets where id=$1',[asset])).rows[0];assert.equal(r.valid,true);});
 await test('실력검증 등록·취소·회원 이용 상태',async()=>{await op('assessment-save',{profile_id:b.id,level:2,skills:['voice'],method:'test',date:'2026-10-13',note:'발성 평가 확인'});assert.equal((await op('profiles',{q:'예시회원B'})).items[0].level,2);await op('assessment-revoke',{profile_id:b.id,note:'평가 취소 사유'});await op('member-block',{profile_id:b.id,blocked:true,note:'이용 제한 사유'});assert.equal((await op('profiles',{q:'예시회원B'})).items[0].blocked,true);await op('member-block',{profile_id:b.id,blocked:false,note:'이용 제한 해제'});});
 await test('이용 안내 공개·수정·고정 해제·비공개 기록 차단',async()=>{await op('guide-save',{scope:'prep',title:'승준정보 이용 안내',body:'관리자 확인용 가상 이용 안내입니다.',active:true,note:'첫 공지 등록'});const r=await call('','community_guides','',{p_scope:'prep'});assert.equal(r.items.length,1);assert.equal(r.items[0].updated_by,undefined);await op('guide-save',{scope:'prep',title:'수정한 이용 안내',body:'수정한 가상 안내입니다.',active:false,note:'공지 고정 해제'});assert.equal((await call('','community_guides','',{p_scope:'prep'})).items.length,0);});
 await test('신고 종결·사유와 처리자 이력·일반 회원 조회 차단',async()=>{const report=(await op('reports')).items[0];await op('report-resolve',{id:report.id,decision:'dismiss',note:'내용 확인 후 종결'});assert.equal((await op('reports',{status:'pending'})).items.length,0);const history=(await op('history')).items;assert.ok(history.length>10);assert.ok(history.every(r=>r.details.note&&r.actor));await assert.rejects(()=>call('b','community_operator','history'),/forbidden/);});
 await test('동의 없는 관리자의 접근 차단',async()=>{await db.query('update public.members set agreed_at=null where id=$1',[ids.admin]);await assert.rejects(()=>op('overview'),/login_required/);});
 await db.close();process.stdout.write('완료: '+n+'개 실제 PostgreSQL 검사 통과\n');
}
