// 커뮤니티 서류·샘플의 업로드/열람/삭제. 모든 접근은 확인한 JWT와 서버 원장으로 판단한다.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const FN_VERSION = '2026-10-14a';
const BUCKET = 'community-private';
const TTL = 60;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const safePath = (value: unknown) => typeof value === 'string' && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|png|jpg|txt|mp3|wav|m4a|mp4|webm)$/i.test(value);
function fileFormat(bytes: Uint8Array, kind: string): { ext: string; mime: string } | null {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  if (kind === 'text') {
    try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (text.trim().length > 0 && text.length <= 10000) return { ext: 'txt', mime: 'text/plain; charset=utf-8' }; } catch (_) {}
    return null;
  }
  if (kind === 'proof') {
    if (ascii(0, 5) === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' };
    if (bytes[0] === 137 && ascii(1, 3) === 'PNG' && bytes[4] === 13 && bytes[5] === 10) return { ext: 'png', mime: 'image/png' };
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (kind === 'audio') {
    if (ascii(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224)) return { ext: 'mp3', mime: 'audio/mpeg' };
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return { ext: 'wav', mime: 'audio/wav' };
    if (ascii(4, 4) === 'ftyp') return { ext: 'm4a', mime: 'audio/mp4' };
    if (bytes[0] === 26 && bytes[1] === 69 && bytes[2] === 223 && bytes[3] === 163) return { ext: 'webm', mime: 'audio/webm' };
  }
  if (kind === 'video') {
    if (ascii(4, 4) === 'ftyp') return { ext: 'mp4', mime: 'video/mp4' };
    if (bytes[0] === 26 && bytes[1] === 69 && bytes[2] === 223 && bytes[3] === 163) return { ext: 'webm', mime: 'video/webm' };
  }
  return null;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ ok: false, code: 'bad_method' }, 405);
  const multipart = (req.headers.get('content-type') || '').includes('multipart/form-data');
  if (multipart && !/^Bearer\s+\S+$/i.test(req.headers.get('authorization') || '')) return reply({ ok: false, code: 'login_required' });
  if (Number(req.headers.get('content-length') || 0) > 45 * 1024 * 1024) return reply({ ok: false, code: 'file_too_large' }, 413);
  let body: Record<string, any> = {};
  let form: FormData | null = null;
  try {
    if (multipart) { form = await req.formData(); body = { action: form.get('action'), kind: form.get('kind'), title: form.get('title'), scope: form.get('scope') }; }
    else body = await req.json();
  } catch (_) { return reply({ ok: false, code: 'bad_request' }); }
  if (body.probe === true) return reply({ ok: true, fn: 'community-file', version: FN_VERSION, features: ['private_upload', 'scoped_samples', 'proof_retention_30', 'cleanup'], url_ttl: TTL });
  const url = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!url || !serviceKey || !anon) return reply({ ok: false, code: 'not_ready' });
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    if (body.action === 'cleanup') {
      // 예약 호출의 원래 자격을 보존한다. 헤더의 존재나 JWT 본문만으로 허용하지 않는다.
      const cleanupAuth = req.headers.get('x-cleanup-authorization') || auth;
      let authorized = cleanupAuth === `Bearer ${serviceKey}`;
      // 대시보드 키와 런타임 키가 달라도 같은 프로젝트의 관리자 API가 검증해야 한다.
      if (!authorized && /^Bearer eyJ[\w.-]+$/.test(cleanupAuth)) {
        try {
          const verified = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
            headers: { Authorization: cleanupAuth, apikey: cleanupAuth.slice(7) },
            signal: AbortSignal.timeout(10000),
          });
          authorized = verified.ok;
          await verified.body?.cancel();
        } catch (_) { authorized = false; }
      }
      if (!authorized) return reply({ ok: false, code: 'service_role_required' }, 403);
      let deleted = 0;
      for (let batch = 0; batch < 10; batch++) {
        const { data, error } = await service.rpc('community_cleanup_candidates');
        if (error) return reply({ ok: false, code: 'cleanup_query_failed', deleted });
        if (!data?.length) break;
        if (data.length > 100 || data.some((item: any) => !uuid(item.id) || !safePath(item.path))) return reply({ ok: false, code: 'bad_storage_path', deleted });
        const removal = await service.storage.from(BUCKET).remove(data.map((item: any) => item.path));
        if (removal.error) return reply({ ok: false, code: 'cleanup_remove_failed', deleted });
        const marked = await service.rpc('community_assets_mark_deleted', { p_ids: data.map((item: any) => item.id) });
        if (marked.error) return reply({ ok: false, code: 'cleanup_record_failed', deleted });
        deleted += data.length;
      }
      return reply({ ok: true, deleted, version: FN_VERSION });
    }
    if (!token || token === auth) return reply({ ok: false, code: 'login_required' });
    // JWT 정보만 믿지 않고 삭제된 계정도 여기서 차단한다.
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await client.auth.getUser(token);
    if (userError || !userData.user) return reply({ ok: false, code: 'login_required' });
    const userId = userData.user.id;
    if (body.action === 'upload') {
      if (!form) return reply({ ok: false, code: 'bad_request' });
      const file = form.get('file');
      const kind = String(body.kind || '');
      const title = String(body.title || '').trim();
      const scope = String(body.scope || 'private');
      if (!(file instanceof File) || !['proof', 'text', 'audio', 'video'].includes(kind) || !title || title.length > 100 || !['private','organizer','members'].includes(scope)) return reply({ ok: false, code: 'bad_request' });
      const max = kind === 'proof' ? 8 * 1024 * 1024 : kind === 'text' ? 40 * 1024 : kind === 'audio' ? 20 * 1024 * 1024 : 40 * 1024 * 1024;
      if (file.size < 1 || file.size > max) return reply({ ok: false, code: 'file_too_large' });
      const profile = await client.rpc('community_member', { p_action: 'profile', p_data: {} });
      if (profile.error || !profile.data?.item || profile.data.item.blocked) return reply({ ok: false, code: profile.error ? 'not_ready' : 'profile_required' });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = fileFormat(bytes, kind);
      if (!format) return reply({ ok: false, code: 'bad_file_type' });
      const storagePath = userId + '/' + crypto.randomUUID() + '.' + format.ext;
      // 먼저 파일 원장을 만들어 실패한 업로드도 정리 대상에서 빠지지 않게 한다.
      const registered = await service.rpc('community_asset_create', { p_actor: userId, p_kind: kind, p_title: title, p_path: storagePath, p_mime: format.mime, p_size: bytes.length, p_scope: kind === 'proof' ? 'private' : scope });
      if (registered.error) return reply({ ok: false, code: 'asset_record_failed' });
      const stored = await service.storage.from(BUCKET).upload(storagePath, bytes, { contentType: format.mime, upsert: false });
      if (stored.error) { await service.rpc('community_asset_expire', { p_id: registered.data }); return reply({ ok: false, code: 'upload_failed' }); }
      const complete = await service.rpc('community_asset_complete', { p_id: registered.data });
      if (complete.error) { await service.rpc('community_asset_expire', { p_id: registered.data }); return reply({ ok: false, code: 'asset_record_failed' }); }
      return reply({ ok: true, id: registered.data });
    }
    if (body.action === 'read' || body.action === 'delete') {
      if (!uuid(body.id)) return reply({ ok: false, code: 'bad_request' });
      const access = await service.rpc('community_asset_access', { p_actor: userId, p_id: body.id, p_delete: body.action === 'delete' });
      if (access.error || !access.data || !safePath(access.data.path)) return reply({ ok: false, code: 'forbidden' });
      if (body.action === 'delete') {
        const removed = await service.storage.from(BUCKET).remove([access.data.path]);
        if (removed.error) return reply({ ok: false, code: 'delete_failed' });
        const marked = await service.rpc('community_asset_mark_deleted', { p_id: body.id });
        return reply(marked.error ? { ok: false, code: 'delete_record_failed' } : { ok: true });
      }
      const signed = await service.storage.from(BUCKET).createSignedUrl(access.data.path, TTL);
      if (signed.error || !signed.data?.signedUrl) return reply({ ok: false, code: 'file_failed' });
      return reply({ ok: true, url: signed.data.signedUrl, mime: access.data.mime, kind: access.data.kind, title: access.data.title, expires_in: TTL });
    }
    return reply({ ok: false, code: 'bad_action' });
  } catch (_) {
    // 서류 본문·파일 경로·JWT는 로그에 남기지 않는다.
    return reply({ ok: false, code: 'error' });
  }
});
