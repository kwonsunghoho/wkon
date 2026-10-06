// 운영에 접근하지 않고 실제 정리 함수의 인증·보존·미리보기 검증을 실행한다.
import assert from 'node:assert/strict';
import fs from 'node:fs';

let handler, removed, failLookup, files, failLog = false;
const runLogs = [];
const uid = '11111111-1111-1111-1111-111111111111';
const rid = '22222222-2222-2222-2222-222222222222';
const fid = '33333333-3333-3333-3333-333333333333';
const path = `wm/${uid}/${rid}-${fid}.pdf`;
const cutoff = new Date(Date.now() - 3 * 86400000).toISOString();
const old = { id: 'object-1', name: `${rid}-${fid}.pdf`, updated_at: '2026-01-01T00:00:00Z', metadata: { size: 1024 } };
let originalPaths = [];
globalThis.Deno = { env: { get: k => k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'secret' : 'https://example.invalid' }, serve: f => { handler = f; } };
globalThis.__cleanupClient = {
  from: table => table === 'lab_storage_cleanup_runs' ? {
    insert: row => ({ select: () => ({ single: async () => {
      if (failLog) return { data: null, error: {} };
      runLogs.push(row); return { data: { id: String(runLogs.length) }, error: null };
    } }) }),
    update: row => ({ eq: async (_, id) => { Object.assign(runLogs[Number(id)-1], row); return { error: null }; } }),
  } : ({ select: () => ({ order: () => ({ range: async () => ({
    data: originalPaths.map(storage_path => ({ storage_path })), error: failLookup ? {} : null,
  }) }) }) }),
  storage: { from: bucket => {
    assert.equal(bucket, 'lab-files');
    return {
      list: async prefix => ({ data: prefix === 'wm' ? [{ name: uid, id: null }] : files, error: null }),
      remove: async paths => { removed.push(...paths); return { data: paths.map(name => ({ name })), error: null }; },
    };
  } },
};
const source = fs.readFileSync(new URL('../supabase/functions/lab-storage-cleanup/index.ts', import.meta.url), 'utf8')
  .replace('import { createClient } from "npm:@supabase/supabase-js@2";', 'const createClient = () => globalThis.__cleanupClient;');
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
async function call(body, token = 'secret') {
  const r = await handler(new Request('https://example.invalid', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
removed = []; files = [old];
assert.equal((await call({ probe: true }, 'anon')).body.version, '2026-10-06e');
assert.equal((await call({ execute: true }, 'anon')).status, 403);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://example.invalid/auth/v1/admin/users?page=1&per_page=1');
  assert.equal(options.headers.apikey, 'eyJtest.signature');
  return new Response('', { status: 403 });
};
assert.equal((await call({ cutoff }, 'eyJtest.signature')).status, 403);
globalThis.fetch = async () => new Response('{}', { status: 200 });
assert.equal((await call({ cutoff }, 'eyJtest.signature')).body.dryRun, true);
globalThis.fetch = originalFetch;
assert.equal((await call({ cutoff: new Date().toISOString() })).status, 400);
let preview = (await call({ cutoff })).body;
assert.equal(preview.count, 1); assert.equal(removed.length, 0);
assert.equal((await call({ execute: true, cutoff, digest: 'wrong', expectedCount: 1 })).status, 409);
assert.equal(removed.length, 0);
assert.equal((await call({ execute: true, cutoff, digest: preview.digest, expectedCount: 1 })).body.deleted, 1);
assert.deepEqual(removed, [path]);
removed = []; originalPaths = [path];
assert.equal((await call({ cutoff })).body.count, 0);
originalPaths = []; files = [{ ...old, updated_at: new Date().toISOString() }, { ...old, name: 'original.pdf' }];
assert.equal((await call({ cutoff })).body.count, 0);
files = [{ ...old, updated_at: 'invalid' }];
assert.equal((await call({ cutoff })).body.count, 0);
files = [{ ...old, name: `${rid}.pdf` }];
assert.equal((await call({ cutoff })).body.count, 1);
failLookup = true;
assert.equal((await call({ execute: true, cutoff, digest: preview.digest, expectedCount: 1 })).status, 500);
assert.equal(removed.length, 0);
failLookup = false;
files = [old, { ...old, id: 'recent', name: `${rid}-${fid}-${uid}.pdf`, updated_at: new Date().toISOString() }];
assert.equal((await call({ scheduled: true }, 'anon')).status, 403);
let scheduled = await call({ scheduled: true, cutoff: '2099-01-01T00:00:00Z' });
assert.equal(scheduled.body.deleted, 1);
assert.deepEqual(removed, [path]);
assert.equal(runLogs.at(-1).status, 'succeeded');
assert.equal(runLogs.at(-1).mode, 'scheduled');
assert.ok(Date.parse(scheduled.body.cutoff) <= Date.now() - 48 * 3600000);
removed = []; failLog = true;
assert.equal((await call({ scheduled: true })).body.code, 'run_log_unavailable');
assert.equal(removed.length, 0);
console.log('통과: 관리자 인증·예약 실행·48시간 고정·기존/신규 파일명·원본/최근 파일 보존·미리보기·실행 기록·실패 시 삭제 차단');
