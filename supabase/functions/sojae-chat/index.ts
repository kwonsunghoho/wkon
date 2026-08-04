// =============================================================================
// Supabase Edge Function: sojae-chat — 소재 발굴 AI 프록시 (v2 · 2026-07-30)
// =============================================================================
// 되묻기(stage=ask)   = Claude Haiku 4.5 (claude-haiku-4-5)   — 구조화 출력
// 다듬기(stage=refine) = Claude Sonnet 5 (claude-sonnet-5)     — 구조화 출력(카드+뼈대)
//
// ⚠️ 프롬프트 본문(교재 노하우)은 이 파일에 없다 — sojae_playbook 테이블(비공개)에서
//    매 요청 읽어 조립한다. 아래 FB_* 상수는 playbook 미시드·조회 실패 시 폴백(v1 수준)일 뿐.
//    내용 수정은 SQL Editor 에서 하면 재배포 없이 즉시 반영된다.
// ⚠️ 배포 상태는 프로브로 확인한다: 로그인 없이 POST {"probe":true} → version/features.
//    코드를 고치면 FN_VERSION 도 같이 올릴 것 — 밖에서 배포본을 아는 유일한 길이다.
// 배포(오너, Supabase 콘솔): 대시보드 > Edge Functions > sojae-chat > 코드 교체 > Deploy.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const FN_VERSION = "2026-08-04a";
// refund_server = 환급을 service_role 전용 refund_credit_for 로 이동(2026-08-04 보안)
const FN_FEATURES = ["ask_v2", "refine_v2", "materials", "playbook", "refund_server"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CAT_LABEL: Record<string, string> = {
  experience: "과거경험검증형",
  values: "직무핵심역량형",
  judgment: "상황대처형",
  company: "기업관심도형",
  personal: "개인신상형",
};

// ── 폴백 프롬프트(v1 수준) — playbook 미시드·조회 실패 시에만 쓴다 ─────────────
// ⚠️ 여기 있는 문구는 v1 부터 공개 레포에 있던 것이라 그대로 둬도 유출이 아니다.
//    새 노하우(교재 본문)를 이 상수들에 추가하지 말 것 — playbook 으로만.
const FB_ASK_CORE = `너는 승무원 면접 지원자의 소재 발굴을 돕는 인터뷰어야.
답을 대신 만들어주지 않고, 지원자 안에 있는 재료를 질문으로 끌어내.

[공통 규칙]
- 모범답안, 예시 답변을 주지 마. 지원자가 스스로 꺼내게 해.
- 질문은 한 번에 하나씩. 짧고 자연스럽게, 옆에서 대화하듯이.
- 지원자 답을 듣고 가장 파고들 지점 하나를 골라 더 구체적으로 물어.

[막힘 대응 — 지원자가 "모르겠어요/없어요"라고 하거나,
 "잘 안 떠올라요" 버튼을 누르거나, 답이 계속 겉돌면]
- 질문만 반복하지 마. 방식을 바꿔.
  1) 예시 던지기: "거창한 게 아니어도 돼요. 예를 들면…"
  2) 각도 바꾸기: 다른 방향의 질문으로 옆문 열기
  3) 실마리 잡기: 지원자가 흘린 말에서 소재 될 만한 걸 되비춰주기
- 막힘 대응 중엔 횟수 제한 없이 뭐라도 건질 때까지 함께 있어줘.
- 그래도 안 나오면: "오늘은 이 씨앗만 메모해두고 다음에 이어가요"로
  부드럽게 마무리.

[멈춤]
- 재료가 충분히 모였으면 더 묻지 말고 멈춰. 잘 나와도 6번 주고받기 안에서 멈춰(지치지 않게).`;

const FB_ASK_TYPES: Record<string, string> = {
  experience: `[이 유형 파고들기 — 과거경험검증형]
- 지원자가 추상적으로("사람을 좋아해서") 답하면 구체적 장면으로 끌어내.
  "그걸 느낀 구체적인 순간이 있었어요?"
- 경험이 나오면 상황은 짧게, 행동과 판단을 깊게 파.
- 막힘 예시: "꼭 대단한 일 아니어도 돼요. 알바하다 겪은 일,
  친구랑 있었던 일, 그런 일상도 좋은 소재예요."`,
  values: `[이 유형 파고들기 — 직무핵심역량형]
- 지원자가 사전적 정의로("팀워크란 서로 돕는 것") 답하면,
  그 생각을 경험에 묶어. "그렇게 생각하게 된 경험이 있어요?"
- 생각 → 그 생각의 근거가 된 실제 경험 → 그 경험의 구체적 장면 순으로.
- 막힘 예시: "어렵게 생각 말고, 그렇게 느낀 순간이 언제였는지부터요."`,
  judgment: `[이 유형 파고들기 — 상황대처형]
- 여기선 과거 경험이 아니라 '판단'을 다듬어. "그런 경험 있어요?"라고
  묻지 마. 이건 겪어본 적 없는 가상 상황이야.
- 지원자가 대처안을 내면, 판단의 빈틈을 찔러 정교하게 만들어.
- 막힘엔 경험 예시 말고 '판단 힌트'를 줘.`,
  company: `[이 유형 파고들기 — 기업관심도형]
- 정보를 자기 생각과 연결하게 해. 추천만 하면 "왜 그걸 골랐어요?
  그게 우리 항공사한테 어떤 의미가 있는데요?"로 파고들어.
- 지원자가 회사를 얼마나 알아봤는지, 그걸 자기 언어로 풀 수 있는지가 핵심.
- 막힘 예시: "정답을 찾는 게 아니에요. 왜 그게 끌렸는지가 중요해요."`,
  personal: `[이 유형 파고들기 — 개인신상형]
- 사소해 보이는 질문일수록 의도가 있어(취미·영화·바탕화면 = 성향과 가치관).
- 과대포장을 잡고, 솔직함과 그 사람다움이 드러나는 대답을 파내.
- 막힘 예시: "멋진 답이 아니어도 돼요. 실제의 나로 답하는 게 제일 강해요."`,
};

const FB_REFINE_CORE = `너는 승무원 면접 답변 코치야.
지원자가 방금 인터뷰에서 꺼낸 자기 경험을 재료로,
면접 답변의 '뼈대'를 잡아주는 게 네 역할이야.
완성된 답을 주는 게 아니라, 지원자가 자기 말로 채울 구조를 만들어줘.

[절대 하지 말 것]
- 그대로 외워 말하면 되는 완성 답변을 주지 마.
- 지원자가 말하지 않은 경험·사실을 지어내지 마. 오직 꺼낸 재료만 써.

[할 것]
- 지원자의 경험을 면접 답변 흐름으로 구조를 잡아줘.
- 각 부분에 지원자가 채울 방향을 알려줘.
- 지원자 재료 중 면접에서 강점이 될 부분을 짚어줘.

[유형별 주의]
- 상황대처형이면 경험 서술이 아니라 판단·대처 흐름으로 뼈대를 잡아.`;

// ── 출력 형식 안내(비밀 아님 — 형식 배관) ───────────────────────────────────
const ASK_FORMAT = `
[출력 형식 — 반드시 지켜]
- message: 지원자에게 보낼 다음 말(질문 하나, 또는 멈춤·마무리 멘트). 인사말·메타 설명 금지.
- materials_sufficient: 아래 재료가 충분히 모였으면 true.
- missing: 아직 안 모인 재료. scene(언제·어디서의 장면) / action(무엇을 어떤 순서로 했나)
  / judgment(왜 그렇게 판단했나) / result(결과·상대 반응) / feeling(그때 감정 한 줄) 중에서.
  materials_sufficient 가 true 면 빈 배열.
- 판정은 횟수가 아니라 재료 기준으로. 다만 대화가 6번을 넘겼으면 모인 것으로 정리하고 멈춰.`;

const REFINE_FORMAT = `
[출력 형식 — 반드시 지켜]
- card: 이 인터뷰에서 캐낸 소재를 '재사용 가능한 카드'로.
  title(경험 한 줄 제목) / one_line(요약) / scene(핵심 장면) / actions(행동·판단)
  / competencies(이 경험이 증거가 되는 역량 이름 1~3개, 한국어) / reinterpretation(역량 재해석 한 문장 —
  "나에게 ○○이란 …이다"처럼 이 사람 언어로).
- skeleton: 답변 뼈대. steps 는 2~4단계, 각 단계 what(무슨 내용)과 fill(지원자가 채울 방향).
  strengths(재료 중 강점 포인트) / closing(스스로 완성해보게 하는 한마디).
- 지원자가 말하지 않은 사실·숫자를 지어내지 마. 지원자가 채워야 할 빈 자리는 (괄호) 로 남겨.
- 완성 문장을 대신 써 주지 마 — fill 은 '방향'이다.`;

const HELP_MARKER =
  "(지원자가 '잘 안 떠올라요' 버튼을 눌렀습니다. 막힘 대응 방식으로 도와주세요.)";

// 비용 방어 캡 — v1 그대로
const MAX_HISTORY_ITEMS = 40;
const MAX_MSG_CHARS = 2000;
// ⚠️ 다듬기 재료 상한 4,000자(2026-07-27) — 되돌리지 말 것(원가 상한).
const MAX_MATERIALS_CHARS = 4000;
const MAX_QUESTION_CHARS = 300;

// ── 구조화 출력 스키마 ──────────────────────────────────────────────────────
const ASK_SCHEMA = {
  type: "object",
  properties: {
    message: { type: "string" },
    materials_sufficient: { type: "boolean" },
    missing: {
      type: "array",
      items: { type: "string", enum: ["scene", "action", "judgment", "result", "feeling"] },
    },
  },
  required: ["message", "materials_sufficient", "missing"],
  additionalProperties: false,
};

const REFINE_SCHEMA = {
  type: "object",
  properties: {
    card: {
      type: "object",
      properties: {
        title: { type: "string" },
        one_line: { type: "string" },
        scene: { type: "string" },
        actions: { type: "string" },
        competencies: { type: "array", items: { type: "string" } },
        reinterpretation: { type: "string" },
      },
      required: ["title", "one_line", "scene", "actions", "competencies", "reinterpretation"],
      additionalProperties: false,
    },
    skeleton: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: { what: { type: "string" }, fill: { type: "string" } },
            required: ["what", "fill"],
            additionalProperties: false,
          },
        },
        strengths: { type: "string" },
        closing: { type: "string" },
      },
      required: ["steps", "strengths", "closing"],
      additionalProperties: false,
    },
  },
  required: ["card", "skeleton"],
  additionalProperties: false,
};

// ── 되묻기 대화 이력 → messages (v1 그대로) ─────────────────────────────────
function toMessages(
  history: unknown,
  help: boolean,
): Array<{ role: string; content: string }> {
  const msgs: Array<{ role: string; content: string }> = [];
  // deno-lint-ignore no-explicit-any
  const items = (Array.isArray(history) ? history : []).slice(-MAX_HISTORY_ITEMS) as any[];
  for (const h of items) {
    if (!h || typeof h.content !== "string" || !h.content.trim()) continue;
    const content = h.content.slice(0, MAX_MSG_CHARS);
    if (h.role === "user") {
      msgs.push({ role: "user", content });
    } else if (h.role === "help") {
      msgs.push({ role: "user", content: HELP_MARKER });
    } else if (h.role === "researcher") {
      if (msgs.length === 0) continue; // 첫 메시지가 assistant 면 400
      msgs.push({ role: "assistant", content });
    }
  }
  if (help && (msgs.length === 0 || msgs[msgs.length - 1].role !== "user")) {
    msgs.push({ role: "user", content: HELP_MARKER });
  }
  if (msgs.length === 0) {
    msgs.push({
      role: "user",
      content: "(인터뷰를 시작해 주세요. 첫 되묻기 질문 하나로 시작해요.)",
    });
  }
  return msgs;
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

// Anthropic 응답에서 text 블록만 모아 JSON 파싱 (구조화 출력이라 전체가 JSON)
// deno-lint-ignore no-explicit-any
function parseStructured(data: any): any {
  if (data.stop_reason === "refusal") throw new Error("ai_refused");
  const raw = (data.content || [])
    // deno-lint-ignore no-explicit-any
    .filter((b: any) => b.type === "text")
    // deno-lint-ignore no-explicit-any
    .map((b: any) => b.text)
    .join("")
    .trim();
  if (!raw) throw new Error("ai_empty");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("ai_bad_json");
  }
}

// 뼈대를 v1 형태의 평문으로 병합 — 구버전 화면(message 만 아는)이 그대로 그릴 수 있게.
// deno-lint-ignore no-explicit-any
function legacyMessage(card: any, skeleton: any): string {
  const marks = ["①", "②", "③", "④", "⑤"];
  // deno-lint-ignore no-explicit-any
  const steps = (skeleton.steps || []).map((s: any, i: number) =>
    `${marks[i] || (i + 1) + "."} ${s.what}\n→ ${s.fill}`
  ).join("\n\n");
  return [
    `[소재 카드] ${card.title}`,
    card.reinterpretation,
    "",
    "답변 뼈대 — 이 순서로 말해보세요",
    "",
    steps,
    "",
    `강점 포인트: ${skeleton.strengths}`,
    "",
    skeleton.closing,
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // ⚠️ 차감해 놓고 결과를 못 주면 반드시 되돌려야 한다 → catch 에서도 보이도록 try 밖.
  //    member 를 같이 들고 다닌다 — 환급은 service_role 로 부르므로 auth.uid() 가 없다.
  let charged: { ref: string; member: string } | null = null;
  try {
    // deno-lint-ignore no-explicit-any
    const body: any = await req.json();

    // ── 배포 확인용 프로브 — 로그인 없이 버전·기능만(내용은 안 나간다) ─────
    if (body.probe === true) {
      let playbookKeys: number | null = null;
      let materialsTable: number | null = null;
      try {
        const admin = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const p = await admin.from("sojae_playbook")
          .select("key", { count: "exact", head: true }).eq("active", true);
        playbookKeys = p.error ? null : (p.count ?? 0);
        const m = await admin.from("sojae_materials")
          .select("id", { count: "exact", head: true });
        materialsTable = m.error ? null : (m.count ?? 0);
      } catch (_) { /* 표가 없으면 null */ }
      return json({
        fn: "sojae-chat",
        version: FN_VERSION,
        features: FN_FEATURES,
        playbook_keys: playbookKeys,     // null=표 미생성 / 0=미시드 / 9=전체 시드
        materials_table: materialsTable, // null=표 미생성(카드 저장 생략으로 degrade)
        has_api_key: !!Deno.env.get("ANTHROPIC_API_KEY"),
      }, 200);
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY 미설정" }, 500);

    // 로그인 회원만 (게이트웨이 verify_jwt + 이중 확인). RLS 도 사용자 권한으로 적용됨.
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return json({ error: "로그인이 필요합니다" }, 401);

    // 쓰기·비공개 조회 전용 — playbook 읽기와 카드 저장은 service role 만 가능(RLS)
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const stage = body.stage === "refine" ? "refine" : "ask";

    // ── playbook 로드 — 실패·미시드 키는 폴백으로(조용히 죽지 않는다) ──────
    const pb: Record<string, string> = {};
    try {
      const { data: rows } = await admin.from("sojae_playbook")
        .select("key, content").eq("active", true);
      (rows || []).forEach((r: { key: string; content: string }) => {
        if (r.content && r.content.trim()) pb[r.key] = r.content;
      });
    } catch (_) { /* 폴백으로 진행 */ }

    // 문제는 서버에서 재조회(신뢰 원천). 실패 시 클라이언트가 보낸 category 만 사용.
    let qContent = "";
    let category =
      typeof body.category === "string" && CAT_LABEL[body.category]
        ? body.category
        : "experience";
    if (body.question_id) {
      const { data: q, error: qErr } = await supa
        .from("questions")
        .select("content, category")
        .eq("id", body.question_id)
        .single();
      if (qErr) console.error("question fetch failed:", qErr.message, "id=", body.question_id);
      if (q) {
        qContent = q.content;
        if (CAT_LABEL[q.category]) category = q.category;
      }
    }
    if (!qContent && typeof body.question_text === "string") {
      qContent = body.question_text.slice(0, MAX_QUESTION_CHARS);
    }
    const catLabel = CAT_LABEL[category];

    // ── 다듬기에서만 차감 (되묻기 대화는 무료) — v1 로직 그대로 ─────────────
    // ⚠️ 세션 단위 과금으로 되돌리지 말 것(2026-07-27 오너 확정 — CLAUDE.md 참조).
    type Wallet = { used?: string; cost?: number; balance?: number; daily_left?: number };
    let spent: Wallet | null = null;
    if (stage === "refine") {
      // 차감 키 = '<문제id>#<이전 차감 횟수>' — 재전송에 두 번 깎이지 않는다(AI킬러와 동일).
      const keyBase = body.question_id ? String(body.question_id) : "noq";
      const { count } = await supa
        .from("credit_ledger")
        .select("id", { count: "exact", head: true })
        .eq("member_id", user.id)
        .eq("tool", "sojae")
        .in("reason", ["use", "free_use"])
        .like("ref", `${keyBase}#%`);
      const payRef = `${keyBase}#${count ?? 0}`;

      const { data: spentRaw, error: spendErr } = await supa.rpc("spend_credit", {
        p_tool: "sojae",
        p_ref: payRef,
        p_free_ref: null,
      });
      if (spendErr) {
        const msg = String(spendErr.message || "");
        // ⚠️ 두 응답 모두 반드시 200 — non-2xx 면 supabase-js 가 사유를 숨겨
        //    화면이 폴백(가짜 뼈대)을 그린다(CLAUDE.md 소재 발굴 항목).
        if (msg.includes("no_credit")) {
          return json({ error: "크레딧이 모자라요.", code: "no_credit" }, 200);
        }
        console.error("spend_credit failed", msg);
        return json(
          { error: "다듬기를 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.", code: "spend_failed" },
          200,
        );
      }
      spent = (spentRaw ?? null) as Wallet | null;
      // 'already' 는 이번 호출이 깎은 게 아니다 → 실패해도 환급하면 안 된다.
      if (spent?.used !== "already") charged = { ref: payRef, member: user.id };
    }

    // ── 프롬프트 조립 + 호출 ────────────────────────────────────────────────
    // deno-lint-ignore no-explicit-any
    let reqBody: any;
    if (stage === "ask") {
      // ⚠️ Haiku 4.5 는 output_config.effort 미지원(400) — effort 를 넣지 말 것.
      const core = pb.ask_core || FB_ASK_CORE;
      const typed = pb["ask_" + category] || FB_ASK_TYPES[category] || "";
      const cabin = category === "judgment" ? (pb.cabin_knowledge || "") : "";
      const stable = [core, typed, cabin].filter(Boolean).join("\n\n") + "\n" + ASK_FORMAT;
      reqBody = {
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        output_config: { format: { type: "json_schema", schema: ASK_SCHEMA } },
        system: [
          // 안정 프리픽스 = prompt caching 대상(내용이 같으면 캐시 히트 유지).
          { type: "text", text: stable, cache_control: { type: "ephemeral" } },
          { type: "text", text: `오늘의 문제: ${qContent}\n문제 유형: ${catLabel}` },
        ],
        messages: toMessages(body.history, !!body.help),
      };
    } else {
      // ⚠️ max_tokens 는 상한이지 청구액이 아니다(8192 유지). 원가 손잡이는 effort 와 재료 상한.
      const core = pb.refine_core || FB_REFINE_CORE;
      const dict = pb.competency_dict || "";
      const stable = [core, dict].filter(Boolean).join("\n\n") + "\n" + REFINE_FORMAT;
      const materials = (typeof body.materials === "string" ? body.materials : "")
        .slice(0, MAX_MATERIALS_CHARS);
      reqBody = {
        model: "claude-sonnet-5",
        max_tokens: 8192,
        output_config: { effort: "medium", format: { type: "json_schema", schema: REFINE_SCHEMA } },
        system: [{ type: "text", text: stable, cache_control: { type: "ephemeral" } }],
        messages: [{
          role: "user",
          content:
            `오늘의 문제: ${qContent}\n문제 유형: ${catLabel}\n지원자가 꺼낸 재료:\n${materials}`,
        }],
      };
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(reqBody),
    });
    // ⚠️ 아래부터는 던져서 catch 가 환급까지 처리하게 한다.
    if (!res.ok) {
      console.error("anthropic error", res.status, await res.text());
      throw new Error("ai_failed");
    }
    const data = await res.json();
    const parsed = parseStructured(data);

    if (stage === "ask") {
      return json({
        message: String(parsed.message || ""),
        materials_sufficient: !!parsed.materials_sufficient,
        missing: Array.isArray(parsed.missing) ? parsed.missing : [],
      }, 200);
    }

    // ── refine: 소재 카드 자동 저장(서랍) ───────────────────────────────────
    // ⚠️ 저장 실패는 뼈대를 막지 않는다(degrade — 표 미생성이면 card_saved:false 로만).
    let cardSaved = false;
    if (body.question_id && parsed.card) {
      try {
        const { error: upErr } = await admin.from("sojae_materials").upsert({
          member_id: user.id,
          question_id: body.question_id,
          title: String(parsed.card.title || "").slice(0, 200),
          one_line: String(parsed.card.one_line || ""),
          scene: String(parsed.card.scene || ""),
          actions: String(parsed.card.actions || ""),
          competencies: Array.isArray(parsed.card.competencies)
            ? parsed.card.competencies.slice(0, 5) : [],
          reinterpretation: String(parsed.card.reinterpretation || ""),
        }, { onConflict: "member_id,question_id" });
        cardSaved = !upErr;
        if (upErr) console.error("material upsert failed", upErr.message);
      } catch (e) { console.error("material upsert threw", e); }
    }

    return json({
      // 구버전 화면 호환 — message 만 아는 화면도 뼈대를 읽을 수 있다.
      message: legacyMessage(parsed.card, parsed.skeleton),
      card: parsed.card,
      skeleton: parsed.skeleton,
      card_saved: cardSaved,
      used: spent?.used,
      cost: spent?.cost,
      balance: spent?.balance,
      daily_left: spent?.daily_left,
    }, 200);
  } catch (e) {
    // ⚠️ 차감했는데 결과를 못 준 경우 반드시 되돌린다.
    // ⚠️ 환급은 **service_role 로만** 부른다(2026-08-04). 사용자 JWT 로 부르던 구 방식은
    //    같은 RPC 를 브라우저에도 열어 둬야 해서, 학생이 결과를 받은 뒤 스스로 환급해
    //    유료 기능을 공짜로 쓸 수 있었다. 대상 회원은 charged.member 가 들고 있다.
    // ⚠️ 마이그레이션 20260804150000 이 먼저 적용돼 있어야 한다 — 없으면 환급이 실패해
    //    학생이 크레딧을 잃는다(로그로만 남는다).
    if (charged) {
      const adminRef = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { error } = await adminRef.rpc("refund_credit_for", {
        p_member: charged.member,
        p_tool: "sojae",
        p_ref: charged.ref,
      });
      if (error) console.error("refund failed", error.message, charged.ref);
    }
    console.error(e);
    if (charged) {
      return json(
        { error: "다듬기에 실패했어요. 크레딧은 돌려드렸습니다.", code: "failed", refunded: true },
        200,
      );
    }
    return json({ error: "서버 오류" }, 500);
  }
});
