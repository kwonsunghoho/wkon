import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';

const bucket = 'challenge-room-video';
const ttl = 600;
const FN_VERSION = '2026-11-28.first-preview-54';
const curriculumActions = ['curriculum-upload', 'curriculum-commit', 'curriculum-cancel', 'curriculum-preview'];
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

function failure(message: string) {
  const code = /^challenge_video:(forbidden|not_found|locked|invalid_file|edit_conflict|upload_expired|upload_incomplete|invalid_ticket)$/.exec(message)?.[1];
  if (!code) return reply({ ok: false, error: 'temporarily_unavailable' }, 503);
  // 관리 화면은 기존 강의처럼 도메인 오류를 응답 본문에서 읽는다.
  return reply({ ok: false, error: code }, code === 'invalid_ticket' ? 403 : 200);
}

async function playbackUrl(db: ReturnType<typeof createClient>, original: string) {
  const storage = db.storage.from(bucket);
  const web = original.replace(/\.(mp4|webm)$/i, '.web-720p.mp4');
  // The caller supplies the path returned by the enrollment/admin RPC.
  if (web !== original) {
    try {
      const info = await storage.info(web);
      if (!info.error && info.data) {
        const signed = await storage.createSignedUrl(web, ttl);
        if (signed.data?.signedUrl) return signed.data.signedUrl;
      }
    } catch { /* Keep the original available during a rendition or storage lookup failure. */ }
  }
  return (await storage.createSignedUrl(original, ttl)).data?.signedUrl;
}

const previewLimit = 54;
const previewPath = (path: string) => path.replace(/\.(mp4|webm)$/i, '.intro-54.mp4');

async function makeIntro(sourceUrl: string) {
  const {Input, MP4, MATROSKA, UrlSource, Output, Mp4OutputFormat, BufferTarget, Conversion} = await import('npm:mediabunny@1.66.5');
  let received = 0;
  const source = new UrlSource(sourceUrl, {
    maxCacheSize: 4 * 1024 * 1024, getRetryDelay: () => null,
    fetchFn: async (url, init) => {
      const response = await fetch(url, init);
      if (!response.body) return response;
      const bounded = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > 48 * 1024 * 1024) throw Error('preview input budget');
          controller.enqueue(chunk);
        },
      }));
      return new Response(bounded, {status: response.status, headers: response.headers});
    },
  });
  const input = new Input({source, formats: [MP4, MATROSKA]});
  try {
    const target = new BufferTarget();
    const output = new Output({format: new Mp4OutputFormat({fastStart:'in-memory'}), target});
    const job = await Conversion.init({
      input, output, tracks:'primary', trim:{start:0,end:previewLimit}, tags:{},
      copy:{mode:'forced',boundaryPolicy:'shrink'}, showWarnings:false,
    });
    if (!job.isValid || job.discardedTracks.length) throw Error('preview format');
    await job.execute();
    if (!target.buffer?.byteLength) throw Error('preview empty');
    return target.buffer;
  } finally { input.dispose(); }
}

async function ensureFirstPreview(db: ReturnType<typeof createClient>, original: string) {
  const storage = db.storage.from(bucket);
  const path = previewPath(original);
  if (path === original) return null;
  const existing = await storage.info(path);
  if (!existing.data) {
    const source = await playbackUrl(db, original);
    if (!source) return null;
    const bytes = await makeIntro(source);
    const saved = await storage.upload(path, bytes, {contentType:'video/mp4',upsert:false});
    // 다른 요청이 먼저 같은 미리보기를 등록했다면 저장된 파일을 사용한다.
    if (saved.error && !(await storage.info(path)).data) return null;
  }
  return path;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return reply({ ok: false, error: 'method' }, 405);
  try {
    const body = await request.json().catch(() => null);
    if (body?.probe === true) return reply({ ok: true, version: FN_VERSION });
    if (!body || typeof body.action !== 'string') return reply({ ok: false, error: 'invalid_request' }, 400);
    const base = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!base || !key) return reply({ ok: false, error: 'temporarily_unavailable' }, 503);
    const db = createClient(base, key, { auth: { persistSession: false, autoRefreshToken: false } });
    if (body.action === 'cleanup') {
      if (typeof body.token !== 'string' || body.token.length !== 36) return reply({ ok: false, error: 'invalid_ticket' }, 403);
      const claim = await db.rpc('challenge_video_cleanup', { p_action: 'claim', p_data: { token: body.token } });
      if (claim.error) return failure(claim.error.message);
      let deleted = 0;
      for (const job of claim.data?.jobs || []) {
        let success = false;
        try {
          const playbackPath = job.path.replace(/\.(mp4|webm)$/i, '.web-720p.mp4');
          const removed = await db.storage.from(bucket).remove([...new Set([job.path, playbackPath, previewPath(job.path)])]);
          success = !removed.error;
        } catch { /* 임대 만료 후 다음 정리에서 재시도한다. */ }
        const done = await db.rpc('challenge_video_cleanup', {
          p_action: 'finish', p_data: { id: job.id, lease: job.lease, success },
        });
        if (success && !done.error && done.data?.ok) deleted++;
      }
      return reply({ ok: true, deleted });
    }
    const curriculum = curriculumActions.includes(body.action);
    if (!curriculum && !['admin-upload', 'admin-commit', 'admin-cancel', 'admin-preview', 'admin-first-preview', 'play'].includes(body.action)) {
      return reply({ ok: false, error: 'invalid_request' }, 400);
    }
    const token = /^Bearer (.+)$/i.exec(request.headers.get('Authorization') || '')?.[1];
    if (!token) return reply({ ok: false, error: 'unauthenticated' }, 401);
    const user = await db.auth.getUser(token);
    if (user.error || !user.data.user) return reply({ ok: false, error: 'unauthenticated' }, 401);
    const { action, ...input } = body;
    const firstPreview = action === 'admin-first-preview';
    if (firstPreview && (input.challenge !== 'voice' || input.week_no !== 1)) return reply({ok:false,error:'invalid_request'},400);
    const { data, error } = await db.rpc(curriculum ? 'challenge_curriculum_media' : 'challenge_video_media', {
      p_user: user.data.user.id, p_action: firstPreview ? 'admin-preview' : action, p_data: input,
    });
    if (error) return failure(error.message);
    if (action === 'admin-upload' || action === 'curriculum-upload') {
      const signed = await db.storage.from(bucket).createSignedUploadUrl(data.path, { upsert: false });
      if (signed.error || !signed.data?.token) return reply({ ok: false, error: 'upload_unavailable' }, 503);
      const endpoint = base.replace('.supabase.co', '.storage.supabase.co') + '/storage/v1/upload/resumable/sign';
      return reply({ ok: true, upload_id: data.upload_id, path: data.path, token: signed.data.token,
        bucket, contentType: data.contentType, endpoint });
    }
    if (firstPreview || action === 'play' || action === 'admin-preview' || action === 'curriculum-preview') {
      let url;
      if (firstPreview) {
        const path = await ensureFirstPreview(db, data.path);
        if (path) url = (await db.storage.from(bucket).createSignedUrl(path, ttl)).data?.signedUrl;
      } else url = await playbackUrl(db, data.path);
      if (!url) return reply({ ok: false, error: 'media_unavailable' }, 503);
      return reply({ ok: true, url, urlExpiresAt: new Date(Date.now() + ttl * 1000).toISOString() });
    }
    return reply({ ok: true });
  } catch { return reply({ ok: false, error: 'temporarily_unavailable' }, 503); }
});
