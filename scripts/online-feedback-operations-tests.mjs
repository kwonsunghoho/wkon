// 기존 실제 PostgreSQL 검증에 운영 알림·달력·보관 경계를 추가한다.
import {readFileSync} from 'node:fs';
let code=readFileSync('scripts/online-course-feedback-tests.mjs','utf8');
code=code.replace("const uid=n=>", "await db.exec(readFileSync('supabase/migrations/20261103083316_online_feedback_operations.sql','utf8'));\nconst uid=n=>");
code=code.replace("await db.exec('set role authenticated');", String.raw`
assert.equal((await db.query("select oc_feedback_due('2026-12-24T01:00:00Z')::text v")).rows[0].v,'2027-01-04 14:59:59+00');
assert.equal((await db.query("select oc_feedback_due('2027-12-31T01:00:00Z') v")).rows[0].v,null);
assert.equal((await db.query("select count(*)::int n from online_feedback_notifications where kind='submitted'")).rows[0].n,1);
assert.equal((await db.query("select count(*)::int n from online_feedback_notifications where kind='received'")).rows[0].n,1);
assert.equal((await db.query("select count(*)::int n from online_feedback_notifications where kind='replied'")).rows[0].n,1);
// 답변 전·30일 직전은 보존한다. 미제출 7일 경계만 정리한다.
assert.equal((await db.query('select * from oc_feedback_cleanup_claim()')).rows.length,0);
await db.exec("update online_course_feedback set replied_at=now()-interval '29 days 23 hours'");
assert.equal((await db.query('select * from oc_feedback_cleanup_claim()')).rows.length,0);
await db.exec("update online_course_feedback set replied_at=now()-interval '30 days'");
assert.equal((await db.query('select * from oc_feedback_cleanup_claim()')).rows.length,1);
assert.equal((await db.query('select * from oc_feedback_cleanup_claim()')).rows.length,0);
await db.exec("update online_feedback_uploads set cleanup_started_at=now()-interval '11 minutes' where used_at is not null");
assert.equal((await db.query('select * from oc_feedback_cleanup_claim()')).rows.length,1);
await db.exec('update online_feedback_uploads set deleted_at=now() where used_at is not null');
assert.equal((await db.query('select * from oc_feedback_cleanup_claim()')).rows.length,0);
assert.equal((await db.query('select feedback from online_course_feedback')).rows[0].feedback,'검증용 피드백');
await db.exec("update online_feedback_uploads set created_at=now()-interval '7 days' where used_at is null");
assert.equal((await db.query('select * from oc_feedback_cleanup_claim()')).rows.length,3);
await assert.rejects(()=>db.exec('update online_feedback_uploads set used_at=now() where used_at is null'),/upload_expired/);
await db.exec("update online_course_feedback set replied_at=null,reply_due_at=now()-interval '2 days'");
await db.query('select oc_feedback_remind()');await db.query('select oc_feedback_remind()');
assert.equal((await db.query("select count(*)::int n from online_feedback_notifications where kind='overdue'")).rows[0].n,1);
const mails=(await db.query('select * from oc_feedback_email_claim()')).rows;
assert.equal(mails.length,4);assert.equal((await db.query('select * from oc_feedback_email_claim()')).rows.length,0);
await db.exec('set role authenticated');
await assert.rejects(()=>db.query('select * from online_feedback_notifications'),/permission denied/);
await assert.rejects(()=>db.query('select oc_feedback_cleanup_claim()'),/permission denied/);
await assert.rejects(()=>db.query('select oc_feedback_email_claim()'),/permission denied/);
`);
await import('data:text/javascript;base64,'+Buffer.from(code.replace("'../outputs/course-test-runtime/node_modules/@electric-sql/pglite/dist/index.js'",JSON.stringify(new URL('../outputs/course-test-runtime/node_modules/@electric-sql/pglite/dist/index.js',import.meta.url).href))).toString('base64'));
console.log('운영 기능 SQL 검증 통과: 공휴일·연도 경계·알림 중복·30일/7일 경계·보관 후 본문 유지·재시도·직접 접근 차단');
