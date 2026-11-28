// 저장소와 인증 응답만 대체하고 실제 Edge 핸들러를 실행한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');

const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/challenge-week-video/index.ts'), 'utf8');
const code = stripTypeScriptTypes(source.replace(/^import [^\n]*\n/m, ''));
const bucket = 'challenge-room-video';
const objectPath = 'round-id/1/upload-id.webm';
const uid = 'e31dc08a-f1e2-4f54-8a28-f21f9d902e18';
const sharedPath = 'curriculum/expression/1/' + uid + '.mp4';

function fixture({authorized = true, rpcResult, storageError = false} = {}) {
  const calls = {rpc: [], reads: [], uploads: [], removals: []};
  let serve;
  const client = {
    auth: {async getUser(jwt) {
      assert.equal(jwt, 'member-jwt');
      return {data: {user: authorized ? {id: uid} : null}};
    }},
    async rpc(name, args) {
      calls.rpc.push(structuredClone({name, ...args}));
      return rpcResult?.(name, args) || {data: {upload_id: uid, path: objectPath, contentType: 'video/webm'}};
    },
    storage: {from(name) {
      assert.equal(name, bucket);
      return {
        async createSignedUploadUrl(key, options) {
          calls.uploads.push({key, ...options});
          return storageError ? {error: {}} : {data: {token: 'upload-ticket'}};
        },
        async createSignedUrl(key, seconds) {
          calls.reads.push({key, seconds});
          return storageError ? {error: {}} : {data: {signedUrl: 'https://storage.example.test/signed/video'}};
        },
        async remove(keys) {
          calls.removals.push(...keys);
          return {error: storageError ? {} : null};
        },
      };
    }},
  };
  vm.runInNewContext(code, {
    createClient: () => client,
    Deno: {serve: handler => {serve = handler;}, env: {get: name => ({
      SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-key',
    })[name]}},
    Date, Request, Response,
  });
  async function post(body, jwt = 'member-jwt') {
    const headers = {'Content-Type': 'application/json'};
    if (jwt) headers.Authorization = 'Bearer ' + jwt;
    const response = await serve(new Request('https://edge.example.test', {method: 'POST', headers, body: JSON.stringify(body)}));
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return {status: response.status, body: await response.json()};
  }
  return {calls, post};
}

async function verify() {
  const upload = {action: 'admin-upload', round: 3, week_no: 1, name: '보신각.webm', size: 5412000, contentType: 'video/webm'};
  const noSession = fixture({authorized: false});
  for (const jwt of [null, 'member-jwt']) {
    assert.equal((await noSession.post(upload, jwt)).status, 401);
  }
  assert.equal(noSession.calls.rpc.length, 0);

  const rejected = fixture({rpcResult: () => ({error: {message: 'challenge_video:forbidden'}})});
  for (const action of ['admin-upload', 'admin-preview', 'curriculum-upload', 'curriculum-preview', 'curriculum-commit', 'curriculum-cancel', 'play']) {
    assert.equal((await rejected.post({action})).body.error, 'forbidden');
  }
  assert.equal(rejected.calls.reads.length + rejected.calls.uploads.length, 0);

  const ok = fixture();
  const result = await ok.post({...upload, p_user: 'other-user', path: 'untrusted-path'});
  assert.equal(result.body.bucket, bucket);
  assert.equal(result.body.token, 'upload-ticket');
  assert.match(result.body.endpoint, /\/resumable\/sign$/);
  assert.deepEqual(ok.calls.uploads, [{key: objectPath, upsert: false}]);
  assert.equal(ok.calls.rpc[0].p_user, uid);
  assert.equal(ok.calls.rpc[0].name, 'challenge_video_media');
  for (const action of ['admin-commit', 'admin-cancel']) {
    assert.deepEqual((await ok.post({action, upload_id: uid})).body, {ok: true});
  }
  for (const action of ['play', 'admin-preview']) {
    const now = Date.now();
    const fields = action === 'play' ? {id: uid} : {challenge: 'voice', round: 3, week_no: 1};
    const {body} = await ok.post({action, ...fields, path: 'untrusted-path'});
    assert.deepEqual(Object.keys(body).sort(), ['ok', 'url', 'urlExpiresAt']);
    const expires = Date.parse(body.urlExpiresAt) - now;
    assert.ok(expires >= 599000 && expires <= 601000);
    assert.deepEqual(ok.calls.reads.at(-1), {key: objectPath, seconds: 600});
  }
  const outage = fixture({storageError: true});
  assert.equal((await outage.post(upload)).status, 503);
  assert.equal((await outage.post({action: 'play'})).status, 503);

  const source = {challenge: 'expression', week_no: 1, name: '첫째 주.mp4', contentType: 'video/mp4',
    size: 2147483648, expected_source_revision: 0};
  const library = fixture({rpcResult: (_name, args) => {
    if (args.p_action === 'curriculum-upload' && args.p_data.expected_source_revision === 3) {
      return {error: {message: 'challenge_video:edit_conflict'}};
    }
    return {data: {upload_id: uid, path: sharedPath, contentType: source.contentType}};
  }});
  const newFile = await library.post({action: 'curriculum-upload', ...source});
  assert.equal(newFile.body.path, sharedPath);
  assert.equal(newFile.body.bucket, bucket);
  assert.equal(newFile.body.contentType, source.contentType);
  assert.deepEqual(library.calls.uploads, [{key: sharedPath, upsert: false}]);
  assert.deepEqual(library.calls.rpc[0], {name: 'challenge_curriculum_media', p_user: uid,
    p_action: 'curriculum-upload', p_data: source});
  const stale = await library.post({action: 'curriculum-upload', ...source, expected_source_revision: 3});
  assert.equal(stale.body.error, 'edit_conflict');
  assert.equal(library.calls.uploads.length, 1);
  for (const action of ['curriculum-commit', 'curriculum-cancel']) {
    assert.deepEqual((await library.post({action, upload_id: uid})).body, {ok: true});
    assert.equal(library.calls.rpc.at(-1).name, 'challenge_curriculum_media');
  }
  const preview = await library.post({action: 'curriculum-preview', challenge: 'expression', week_no: 1});
  assert.deepEqual(Object.keys(preview.body).sort(), ['ok', 'url', 'urlExpiresAt']);
  assert.equal(library.calls.rpc.at(-1).name, 'challenge_curriculum_media');
  // A released mission signs its materialized week's source through the enrollment RPC on initial playback and renewal.
  for (let attempt = 0; attempt < 2; attempt++) {
    const played = await library.post({action: 'play', id: uid});
    assert.deepEqual(Object.keys(played.body).sort(), ['ok', 'url', 'urlExpiresAt']);
    assert.deepEqual(library.calls.rpc.at(-1), {name: 'challenge_video_media', p_user: uid, p_action: 'play', p_data: {id: uid}});
    assert.deepEqual(library.calls.reads.at(-1), {key: sharedPath, seconds: 600});
  }
  assert.equal(library.calls.removals.length, 0);

  const cleanup = fixture({rpcResult: (_name, {p_action}) => p_action === 'claim'
    ? {data: {jobs: [{id: uid, path: objectPath, lease: 'lease'}]}} : {data: {ok: true}}});
  assert.equal((await cleanup.post({action: 'cleanup', token: 'invalid'})).status, 403);
  const token = '9c0bf4be-9148-497c-b066-45fbfea81f0f';
  assert.equal((await cleanup.post({action: 'cleanup', token}, null)).body.deleted, 1);
  assert.deepEqual(cleanup.calls.removals, [objectPath]);
  assert.equal(cleanup.calls.rpc.at(-1).p_data.success, true);
  console.log('주차 영상 Edge 통과 · 본인 인증, 주차별 권한, 비공개 업로드·재생 서명, 저장·취소, 저장소 장애, 정리');
}
verify().catch(error => {console.error(error); process.exitCode = 1;});
