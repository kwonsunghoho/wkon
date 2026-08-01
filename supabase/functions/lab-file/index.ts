// =============================================================================
// Supabase Edge Function: lab-file — 연구실 자료 열람/다운로드 (2026-08-01)
// =============================================================================
// 이 함수가 파일로 가는 유일한 문이다. 브라우저는 자료의 storage_path 를 절대 모르고,
// 버킷(lab-files)은 비공개라 서명 URL 없이는 열리지 않는다.
//
// 흐름: JWT 로 회원 확인 → 자료 조회(service_role) → (필요시) 비밀번호 대조
//       → PDF 면 받는 사람 표시(워터마크) → 60초 서명 URL 발급 → 기록 남기기
//
// ⚠️ 판정은 전부 서버가 한다. 브라우저가 보낸 delivery·access·회원 여부를 믿지 않는다.
// ⚠️ 실패도 HTTP 200 + code 로 답한다 — non-2xx 면 supabase-js 가 본문을 감춰
//    브라우저가 "비밀번호가 틀렸어요" 같은 안내를 못 띄운다(프로젝트 공통 규칙).
// ⚠️ 배포 상태는 프로브로 확인한다: POST {"probe":true} → version/features.
//    코드를 고치면 FN_VERSION 도 같이 올릴 것.
// 배포(오너, Supabase 콘솔): 대시보드 > Edge Functions > lab-file > 코드 교체 > Deploy.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb, degrees } from "npm:pdf-lib@1.17.1";

const FN_VERSION = "2026-08-01f";
const FN_FEATURES = ["signed_url", "password", "watermark", "view_mode", "audit", "external_url", "paid", "multi_file"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "lab-files";
const URL_TTL = 60;            // 서명 URL 수명(초) — 링크를 퍼뜨려도 곧 죽는다
const FAIL_LIMIT = 5;          // 비밀번호 연속 실패 허용 횟수
const FAIL_WINDOW_MIN = 10;    // 그 실패를 세는 시간(분)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ── 워터마크 ────────────────────────────────────────────────────────────────
// PDF 각 페이지에 '받은 사람'을 흐리게 얹는다. 퍼졌을 때 어디서 나갔는지 드러나는 게 목적.
// ⚠️ pdf-lib 기본 폰트는 한글을 못 그린다 — 그래서 이메일·날짜 같은 ASCII 만 찍는다.
//    한글 이름까지 넣으려면 폰트 파일 임베드가 필요하다(2단계).
async function stampPdf(bytes: Uint8Array, mark: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  for (const page of pages) {
    const { width, height } = page.getSize();
    // 대각선 큰 글씨 — 화면 캡처로도 같이 찍힌다
    page.drawText(mark, {
      x: width * 0.08,
      y: height * 0.34,
      size: Math.max(12, Math.min(26, width / 22)),
      font,
      color: rgb(0.11, 0.23, 0.42),
      opacity: 0.13,
      rotate: degrees(32),
    });
    // 하단 고정 줄 — 대각선을 잘라내도 남는다
    page.drawText(mark, {
      x: 24,
      y: 16,
      size: 8,
      font,
      color: rgb(0.11, 0.23, 0.42),
      opacity: 0.42,
    });
  }
  return await pdf.save();
}

// 워터마크 문구 — ASCII 로만. 회원 식별에 필요한 최소치(이메일 + 회원 id 앞자리 + 날짜)
function markText(email: string, uid: string): string {
  const safe = (email || "").replace(/[^\x20-\x7E]/g, "") || "MONC member";
  const day = new Date().toISOString().slice(0, 10);
  return `${safe} | ${uid.slice(0, 8)} | ${day} | MONC LAB`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // req.json() 은 한 번만 읽을 수 있다 — 여기서 읽고 재사용한다
  const body: any = await req.json().catch(() => ({}));

  if (body.probe === true) {
    return json({
      ok: true,
      fn: "lab-file",
      version: FN_VERSION,
      features: FN_FEATURES,
      bucket: BUCKET,
      url_ttl: URL_TTL,
    });
  }

  try {
    const resourceId = String(body.resourceId || "").trim();
    const password = typeof body.password === "string" ? body.password : "";
    if (!resourceId) return json({ error: "자료를 찾을 수 없어요.", code: "bad_request" });

    // ── 1. 회원 확인 — 지급·열람 대상은 body 가 아니라 JWT 가 정한다
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: { user } } = await supa.auth.getUser();
    if (!user) {
      return json({ error: "로그인하면 자료를 보실 수 있어요.", code: "need_login" });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── 2. 자료 조회 — 공개된 자료만
    const { data: res, error: resErr } = await admin
      .from("lab_resources")
      .select("*")
      .eq("id", resourceId)
      .maybeSingle();

    if (resErr) {
      // 테이블 미생성(PGRST205) 도 여기로 온다 — 마이그레이션 전이면 조용히 멈춘다
      return json({ error: "자료실 준비가 아직 안 됐어요.", code: "not_ready" });
    }
    if (!res || !res.published) {
      return json({ error: "지금은 볼 수 없는 자료예요.", code: "not_found" });
    }

    // ── 3. 열람 방식 — 화면 전용 자료를 다운로드로 요청해도 서버가 막는다
    // 외부 링크(영상관 유튜브)는 애초에 받을 파일이 없으므로 늘 '열람'이다
    const isLink = !!res.external_url;
    const wantDownload = !isLink && body.mode !== "view";
    if (wantDownload && res.delivery === "view") {
      return json({
        error: "이 자료는 화면에서만 볼 수 있어요.",
        code: "view_only",
      });
    }

    // ── 3-b. 유료 자료 — 산 사람만 연다 (2026-08-01)
    // 값은 자료마다 붙는다(price 0 = 무료). 비밀번호보다 먼저 본다 —
    // 돈을 안 낸 사람에게 비밀번호부터 묻는 건 순서가 뒤집힌 것이다.
    // ⚠️ 조회 자체가 실패하면(테이블 미생성 등) 열어 주지 말고 멈춘다 —
    //    여기서 통과시키면 유료 자료가 영구 무료가 된다(프로젝트 공통 규칙).
    if (Number(res.price) > 0) {
      const { data: buy, error: buyErr } = await admin
        .from("lab_purchases")
        .select("id")
        .eq("resource_id", res.id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (buyErr) return json({ error: "자료실 준비가 아직 안 됐어요.", code: "not_ready" });
      if (!buy) {
        return json({
          error: "구매하시면 바로 보실 수 있어요.",
          code: "need_purchase",
          price: Number(res.price),
          title: res.title,
        });
      }
    }

    // ── 4. 비밀번호 — 대조는 서버에서. 연속 실패는 잠근다
    if (res.access === "password") {
      const since = new Date(Date.now() - FAIL_WINDOW_MIN * 60_000).toISOString();
      const { count: fails } = await admin
        .from("lab_downloads")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("resource_id", res.id)
        .eq("kind", "fail")
        .gte("created_at", since);

      if ((fails ?? 0) >= FAIL_LIMIT) {
        return json({
          error: `비밀번호를 여러 번 틀렸어요. ${FAIL_WINDOW_MIN}분 뒤에 다시 시도해 주세요.`,
          code: "locked",
        });
      }
      if (!password) {
        return json({ error: "비밀번호가 필요한 자료예요.", code: "need_password" });
      }

      const { data: ok, error: pwErr } = await admin
        .rpc("lab_check_password", { p_id: res.id, p_pw: password });

      if (pwErr) return json({ error: "자료실 준비가 아직 안 됐어요.", code: "not_ready" });
      if (ok !== true) {
        await admin.from("lab_downloads").insert({
          resource_id: res.id, user_id: user.id, kind: "fail",
          ua: req.headers.get("user-agent") ?? null,
        });
        const left = Math.max(0, FAIL_LIMIT - ((fails ?? 0) + 1));
        return json({
          error: left > 0
            ? `비밀번호가 맞지 않아요. (${left}번 더 시도할 수 있어요)`
            : "비밀번호가 맞지 않아요.",
          code: "bad_password",
        });
      }
    }

    // ── 5-a. 외부 링크(유튜브) — 회원·비밀번호를 통과한 뒤에만 링크를 넘긴다.
    //         ⚠️ 워터마크를 찍을 수 없다(우리 파일이 아니다). 링크가 한 번 새면 그걸로
    //            열리므로, 영상은 유튜브 쪽 '미등록' 설정과 이 기록이 유일한 방어다.
    if (isLink) {
      await admin.from("lab_downloads").insert({
        resource_id: res.id,
        user_id: user.id,
        kind: "view",
        ua: req.headers.get("user-agent") ?? null,
      });
      return json({
        ok: true,
        url: res.external_url,
        external: true,
        title: res.title,
        mode: "view",
        watermarked: false,
      });
    }

    // ── 5-b. 어떤 파일을 줄지 고른다 (2026-08-01)
    // 자료 하나에 파일이 여러 개일 수 있다(상·하편) — 값·구매는 자료 단위 그대로고,
    // 여기서는 "무엇을 받을지"만 정한다.
    const { data: fileRows, error: filesErr } = await admin
      .from("lab_resource_files")
      .select("id, storage_path, label, file_ext, file_size")
      .eq("resource_id", res.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    // deno-lint-ignore no-explicit-any
    let list: any[] = filesErr ? [] : (fileRows || []);
    // 파일 표가 아직 없거나(마이그레이션 전) 백필 전이면 옛 단일 경로로 떨어진다.
    if (!list.length && res.storage_path) {
      list = [{
        id: "legacy", storage_path: res.storage_path,
        label: null, file_ext: res.file_ext, file_size: res.file_size,
      }];
    }
    if (!list.length) return json({ error: "받을 파일이 아직 없어요.", code: "no_file" });

    // deno-lint-ignore no-explicit-any
    let picked: any = null;
    if (body.fileId) {
      // ⚠️ 브라우저가 보낸 fileId 는 이 자료의 파일 목록 '안에서만' 찾는다 —
      //    남의 자료 파일 id 를 넣어도 걸리지 않게 한다.
      picked = list.filter((f) => String(f.id) === String(body.fileId))[0] || null;
      if (!picked) return json({ error: "그 파일을 찾을 수 없어요.", code: "file_missing" });
    } else if (list.length === 1) {
      picked = list[0];
    } else {
      // 여러 개 — 무엇을 받을지 화면이 고르게 한다.
      // ⚠️ storage_path 는 절대 내보내지 않는다(파일로 가는 문은 이 함수뿐).
      // ⚠️ label 이 없으면 '파일 1·2'로 부른다 — 저장 파일명은 난수라 보여줄 게 못 된다.
      return json({
        ok: true,
        code: "pick_file",
        title: res.title,
        files: list.map((f, i) => ({
          id: f.id,
          label: f.label || `파일 ${i + 1}`,
          ext: f.file_ext || null,
          size: f.file_size || null,
        })),
      });
    }

    const isPdf = (picked.file_ext || "").toLowerCase() === "pdf" ||
      String(picked.storage_path).toLowerCase().endsWith(".pdf");
    let signPath = picked.storage_path as string;

    // 워터마크 — PDF 만. 원본을 건드리지 않고 사본을 만들어 그 사본을 내준다
    if (res.watermark && isPdf) {
      const { data: file, error: dlErr } = await admin.storage.from(BUCKET).download(picked.storage_path);
      if (dlErr || !file) {
        return json({ error: "파일을 준비하지 못했어요.", code: "file_missing" });
      }
      try {
        const stamped = await stampPdf(new Uint8Array(await file.arrayBuffer()), markText(user.email ?? "", user.id));
        // 사본은 회원별·파일별 임시 경로에 둔다. 같은 경로를 재사용해 쌓이지 않게 한다.
        signPath = `wm/${user.id}/${res.id}-${picked.id}.pdf`;
        const { error: upErr } = await admin.storage.from(BUCKET)
          .upload(signPath, stamped, { contentType: "application/pdf", upsert: true });
        if (upErr) signPath = picked.storage_path;   // 사본 실패 시 원본으로 — 열람은 막지 않는다
      } catch (_e) {
        signPath = picked.storage_path;              // 손상·암호화 PDF 등
      }
    }

    // 받는 파일 이름 — 파일이 여럿이면 제목만으로는 뭘 받았는지 구분이 안 된다
    const dlName = (list.length > 1 && picked.label)
      ? `${res.title} - ${picked.label}`
      : res.title;

    const { data: signed, error: signErr } = await admin.storage.from(BUCKET)
      .createSignedUrl(signPath, URL_TTL, wantDownload
        ? { download: `${dlName}.${picked.file_ext || "pdf"}` }
        : undefined);

    if (signErr || !signed?.signedUrl) {
      return json({ error: "파일을 준비하지 못했어요.", code: "file_missing" });
    }

    // ── 6. 기록 — 누가 언제 무엇을 열었는지. 유출 추적의 근거다
    await admin.from("lab_downloads").insert({
      resource_id: res.id,
      user_id: user.id,
      kind: wantDownload ? "download" : "view",
      ua: req.headers.get("user-agent") ?? null,
    });

    return json({
      ok: true,
      url: signed.signedUrl,
      expiresIn: URL_TTL,
      title: res.title,
      fileLabel: list.length > 1 ? (picked.label || null) : null,
      mode: wantDownload ? "download" : "view",
      watermarked: !!(res.watermark && isPdf && signPath !== picked.storage_path),
    });
  } catch (e) {
    return json({ error: "잠시 뒤에 다시 시도해 주세요.", code: "unexpected", detail: String(e) });
  }
});
