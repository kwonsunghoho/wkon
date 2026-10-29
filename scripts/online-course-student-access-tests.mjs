// 운영 DB와 무관한 인메모리 PostgreSQL로 금액·권한·기간 경계를 검증한다.
import { PGlite } from '../outputs/course-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key);
create table public.members(id uuid primary key,agreed_at timestamptz,terms_version text);
grant select on public.members to service_role;
create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid,bucket_id text);alter table storage.objects enable row level security;`);
await db.exec(readFileSync(new URL('../supabase/migrations/20261028102851_online_courses.sql',import.meta.url),'utf8'));

await db.exec("alter table members add column role text; alter table members add column phone text; alter table members add column verified_at timestamptz; create table academy_students(phone_norm text,status text,valid_until date); create function monc_norm_phone(text) returns text language sql immutable as 'select $1';");
await db.exec(readFileSync('supabase/migrations/20261029065133_online_course_student_preview.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/20261029120000_online_course_student_access.sql','utf8'));
const a='00000000-0000-4000-8000-000000000001';
await db.query("insert into auth.users values($1)",[a]);
await db.query("insert into members(id,agreed_at,terms_version,phone,verified_at) values($1,now(),'2026-10-05','01000000000',now())",[a]);
await db.exec("update online_courses set published=true,access_days=10; insert into academy_students values('01000000000','pending',current_date+30)");
const access=async(claim=false)=>(await db.query('select oc_course_access($1,$2,$3) as v',[a,'expression-advanced',claim])).rows[0].v;
assert.equal((await access()).kind,'purchase');
await db.exec("update academy_students set status='approved'");assert.equal((await access()).kind,'student');
const first=await access(true);assert.ok(first.enrollmentId);assert.equal((await access(true)).enrollmentId,first.enrollmentId);
assert.equal((await db.query('select started_at from online_enrollments')).rows[0].started_at,null);
await db.exec("update online_enrollments set started_at=now()-interval '11 days',expires_at=now()-interval '1 day'");assert.equal((await access(true)).kind,'expired');
await db.exec('set role authenticated');await assert.rejects(()=>access(true),/permission denied/);await db.exec('reset role');
console.log('재학생 승인·기간·무료 지급·중복 방지·미재생 기간 보존·만료·직접 호출 차단 통과');await db.close();
