// 실제 PostgreSQL에서 관리자 저장·기존 구매 조건 보존·동시 편집을 검증한다.
import {PGlite} from '../outputs/course-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.members(id uuid primary key,role text,agreed_at timestamptz,terms_version text);grant select on public.members to service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;`);

for(const name of ['20261028102851_online_courses.sql','20261029052754_online_course_admin.sql','20261029110517_online_course_video_cleanup.sql','20261030010000_online_course_feedback.sql','20261104104732_online_course_delete.sql']){if(name==='20261030010000_online_course_feedback.sql')await db.exec('alter table online_enrollments add column admin_preview boolean not null default false');await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));}
const admin='00000000-0000-4000-8000-000000000001',member='00000000-0000-4000-8000-000000000002',cid='delete-test';
await db.query('insert into auth.users values($1),($2)',[admin,member]);await db.query("insert into members values($1,'admin',now(),'2026-10-05'),($2,'member',now(),'2026-10-05')",[admin,member]);
const create=()=>db.query("insert into online_courses(id,title,access_days) values($1,'삭제 검증',14)",[cid]);
const remove=(actor=admin,rev=1,title='삭제 검증')=>db.query('select oc_admin_delete_course($1,$2,$3,$4) v',[actor,cid,rev,title]).then(r=>r.rows[0].v);
await create();assert.equal((await remove(member)).error,'forbidden');assert.equal((await remove(admin,2)).error,'edit_conflict');assert.equal((await remove(admin,1,'다른 과정')).error,'edit_conflict');
await db.exec("update online_courses set published=true where id='delete-test'");assert.equal((await remove()).error,'course_is_public');await db.exec("update online_courses set published=false where id='delete-test'");
await db.query("insert into online_orders(payment_id,member_id,course_id,title,amount,access_days,purchase_notice,state) values('order',$1,$2,'검증',79000,14,'검증','pending')",[member,cid]);assert.equal((await remove()).error,'course_has_history');await db.exec("delete from online_orders where payment_id='order'");
await db.query("insert into online_orders(payment_id,member_id,course_id,title,amount,access_days,purchase_notice,state) values('enroll',$1,'expression-advanced','검증',79000,14,'검증','paid')",[member]);
await db.query("insert into online_enrollments(payment_id,member_id,course_id,access_days) values('enroll',$1,$2,14)",[member,cid]);assert.equal((await remove()).error,'course_has_history');await db.exec("delete from online_enrollments where payment_id='enroll'");
const path=cid+'/00000000-0000-4000-8000-000000000021/video/00000000-0000-4000-8000-000000000022.mp4';
await db.query("insert into online_lessons(course_id,position,chapter,title,video_path,material_path) values($1,1,'묶음','영상',$2,$3)",[cid,path,cid+'/material/file.pdf']);await db.query("insert into storage.objects(bucket_id,name) values('online-course-assets',$1),('online-course-assets','other/file.mp4')",[cid+'/orphan.mp4']);
await db.query("insert into online_course_edits(actor_id,course_id,action,target_id,changed_fields) values($1,$2,'add','test','{}')",[admin,cid]);
await db.exec('set role authenticated');await assert.rejects(()=>remove(),/permission denied/);await db.exec('reset role');
await db.exec('grant usage on schema storage to service_role; grant select on storage.objects to service_role; set role service_role');let r=await remove();assert.equal(r.ok,true);assert.equal(r.lessons,1);assert.equal((await remove()).ok,true);await db.exec('reset role');
assert.equal((await db.query('select count(*) n from online_courses where id=$1',[cid])).rows[0].n,0);assert.equal((await db.query('select count(*) n from online_course_edits where course_id=$1',[cid])).rows[0].n,0);
const queued=(await db.query('select path from online_video_cleanup')).rows.map(x=>x.path);assert.equal(queued.length,3);assert.ok(!queued.includes('other/file.mp4'));
assert.equal((await db.query("select count(*) n from online_courses where id='expression-advanced'")).rows[0].n,1);
const jobs=(await db.query('select oc_claim_video_cleanup() v')).rows[0].v;assert.equal(jobs.length,3);
await db.close();console.log('과정 삭제 SQL 검증 통과: 권한·공개/이력 차단·이름/버전·파일 예약·기존 과정 보존·재시도');
