import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';

const bucket = 'challenge-room-video';
const ttl = 600;
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return reply({ ok: false, error: 'method' }, 405);
  try {
    const body = await request.json().catch(() => null);
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
          const removed = await db.storage.from(bucket).remove([job.path]);
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
    if (!curriculum && !['admin-upload', 'admin-commit', 'admin-cancel', 'admin-preview', 'play'].includes(body.action)) {
      return reply({ ok: false, error: 'invalid_request' }, 400);
    }
    const token = /^Bearer (.+)$/i.exec(request.headers.get('Authorization') || '')?.[1];
    if (!token) return reply({ ok: false, error: 'unauthenticated' }, 401);
    const user = await db.auth.getUser(token);
    if (user.error || !user.data.user) return reply({ ok: false, error: 'unauthenticated' }, 401);
    const { action, ...input } = body;
    const { data, error } = await db.rpc(curriculum ? 'challenge_curriculum_media' : 'challenge_video_media', {
      p_user: user.data.user.id, p_action: action, p_data: input,
    });
    if (error) return failure(error.message);
    if (action === 'admin-upload' || action === 'curriculum-upload') {
      const signed = await db.storage.from(bucket).createSignedUploadUrl(data.path, { upsert: false });
      if (signed.error || !signed.data?.token) return reply({ ok: false, error: 'upload_unavailable' }, 503);
      const endpoint = base.replace('.supabase.co', '.storage.supabase.co') + '/storage/v1/upload/resumable/sign';
      return reply({ ok: true, upload_id: data.upload_id, path: data.path, token: signed.data.token,
        bucket, contentType: data.contentType, endpoint });
    }
    if (action === 'play' || action === 'admin-preview' || action === 'curriculum-preview') {
      const signed = await db.storage.from(bucket).createSignedUrl(data.path, ttl);
      if (signed.error || !signed.data?.signedUrl) return reply({ ok: false, error: 'media_unavailable' }, 503);
      return reply({ ok: true, url: signed.data.signedUrl, urlExpiresAt: new Date(Date.now() + ttl * 1000).toISOString() });
    }
    return reply({ ok: true });
  } catch { return reply({ ok: false, error: 'temporarily_unavailable' }, 503); }
});
