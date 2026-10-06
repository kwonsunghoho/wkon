// 오래된 워터마크 사본만 정리한다. 대시보드의 service_role 호출 전용.
// 기본은 미리보기이며, 삭제에는 같은 cutoff와 미리보기 digest가 필요하다.
import { createClient } from "npm:@supabase/supabase-js@2";

const FN_VERSION = "2026-10-06d";
const BUCKET = "lab-files";
const TWO_DAYS = 48 * 60 * 60 * 1000;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// 단일 파일 시절의 <자료id>.pdf와 현재 <자료id>-<파일id>.pdf만 허용한다.
const COPY = new RegExp(`^wm/${UUID}/${UUID}(?:-${UUID})?\\.pdf$`, "i");
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});

async function allRows(db, table) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from(table).select("*").order("id").range(offset, offset + 999);
    if (error || !Array.isArray(data)) throw new Error("original_lookup_failed");
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function listAll(storage, prefix) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await storage.list(prefix, {
      limit: 1000, offset, sortBy: { column: "name", order: "asc" },
    });
    if (error || !Array.isArray(data)) throw new Error("storage_list_failed");
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.probe === true) return reply({ ok: true, version: FN_VERSION, bucket: BUCKET });
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // 대시보드 키와 런타임 키가 다를 수 있다. 다른 키는 같은 프로젝트의
  // Auth 관리자 API가 서명과 service_role 권한을 검증한 경우에만 허용한다.
  const authorization = req.headers.get("x-cleanup-authorization") || req.headers.get("Authorization") || "";
  let authorized = !!serviceKey && authorization === `Bearer ${serviceKey}`;
  if (!authorized && serviceKey && /^Bearer eyJ[\w.-]+$/.test(authorization)) {
    try {
      const token = authorization.slice(7);
      const verified = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/admin/users?page=1&per_page=1`, {
        headers: { Authorization: authorization, apikey: token },
        signal: AbortSignal.timeout(10000),
      });
      authorized = verified.ok;
      await verified.body?.cancel();
    } catch { authorized = false; }
  }
  if (!authorized) {
    return reply({ ok: false, code: "service_role_required" }, 403);
  }
  if (req.method !== "POST") return reply({ ok: false, code: "post_required" }, 405);
  let deleted = 0;
  try {
    const cutoff = body.cutoff ? Date.parse(body.cutoff) : Date.now() - TWO_DAYS;
    if (!Number.isFinite(cutoff) || cutoff > Date.now() - TWO_DAYS) {
      return reply({ ok: false, code: "cutoff_must_be_at_least_two_days_old" }, 400);
    }
    const db = createClient(Deno.env.get("SUPABASE_URL"), serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const originals = new Set((await Promise.all([
      allRows(db, "lab_resources"), allRows(db, "lab_resource_files"),
    ])).flat().map(row => row.storage_path).filter(Boolean));
    const storage = db.storage.from(BUCKET);
    const folders = (await listAll(storage, "wm"))
      .filter(row => !row.id && new RegExp(`^${UUID}$`, "i").test(row.name));
    const candidates = [];
    let recent = 0, protectedCount = 0;
    // 삭제 전에 목록을 끝까지 읽는다. 목록 실패 시 부분 삭제도 하지 않는다.
    for (let i = 0; i < folders.length; i += 16) {
      await Promise.all(folders.slice(i, i + 16).map(async folder => {
        const prefix = `wm/${folder.name}`;
        for (const file of await listAll(storage, prefix)) {
          const path = `${prefix}/${file.name}`;
          if (!file.id || !COPY.test(path)) continue;
          if (originals.has(path)) { protectedCount++; continue; }
          const changed = Date.parse(file.updated_at || file.created_at);
          if (!Number.isFinite(changed) || changed >= cutoff) { recent++; continue; }
          candidates.push({ path, id: file.id, changed, bytes: Number(file.metadata?.size) || 0 });
        }
      }));
    }
    candidates.sort((a, b) => a.path.localeCompare(b.path));
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256",
      new TextEncoder().encode(JSON.stringify(candidates))))]
      .map(byte => byte.toString(16).padStart(2, "0")).join("");
    const result = {
      version: FN_VERSION, cutoff: new Date(cutoff).toISOString(),
      count: candidates.length, mb: Math.round(candidates.reduce((n, f) => n + f.bytes, 0) / 104857.6) / 10,
      recent, protected: protectedCount, digest,
    };
    if (body.execute !== true) return reply({ ok: true, dryRun: true, ...result });
    if (body.digest !== digest || body.expectedCount !== candidates.length || !body.cutoff) {
      return reply({ ok: false, code: "preview_changed", ...result }, 409);
    }
    // storage.objects 직접 DELETE 금지. Storage API로 파일 실체까지 삭제한다.
    for (let i = 0; i < candidates.length; i += 100) {
      const batch = candidates.slice(i, i + 100).map(file => file.path);
      const { data, error } = await storage.remove(batch);
      if (error || !Array.isArray(data) || data.length !== batch.length) {
        return reply({ ok: false, code: "delete_incomplete", deleted, ...result }, 500);
      }
      deleted += data.length;
    }
    return reply({ ok: true, dryRun: false, deleted, ...result });
  } catch {
    return reply({ ok: false, code: "cleanup_failed", deleted }, 500);
  }
});
