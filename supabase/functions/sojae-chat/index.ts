// =============================================================================
// Supabase Edge Function: sojae-chat — 소재 발굴 AI 프록시
// =============================================================================
// 되묻기(stage=ask)   = Claude Haiku 4.5  (claude-haiku-4-5)
// 다듬기(stage=refine) = Claude Sonnet 5  (claude-sonnet-5)
//
// 프롬프트 원본(수정 시 여기도 동기화):
//   docs/prompts/sojae-ask.md  /  docs/prompts/sojae-refine.md
//
// 배포(오너, Supabase 콘솔): docs/sojae-ai-setup.md 참고
//   - Edge Functions > Deploy new function > 이름 sojae-chat > 이 코드 붙여넣기
//   - Secrets 에 ANTHROPIC_API_KEY 등록
//   - Verify JWT 는 기본(ON) 유지 → 로그인 회원만 호출 가능(키 남용 방지)
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CAT_LABEL: Record<string, string> = {
  experience: "경험 발굴형",
  values: "가치관형",
  judgment: "상황 판단형",
  company: "정보·기업 분석형",
};

// ── 되묻기(Haiku) 프롬프트 — 공통(안정 프리픽스, 캐시 대상) ─────────────────
const ASK_COMMON = `너는 승무원 면접 지원자의 소재 발굴을 돕는 인터뷰어야.
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

[멈춤 — 구체적 경험·상황·감정이 충분히 나왔으면]
- 더 묻지 말고: "좋아요, 답변을 만들 재료가 충분히 모였어요."
- 잘 나오는 경우는 최대 2~3번 주고받고 멈춰(지치지 않게).`;

// ── 되묻기 유형별 지침 ─────────────────────────────────────────────────────
const ASK_TYPES: Record<string, string> = {
  experience: `[이 유형 파고들기 — 경험 발굴형]
- 지원자가 추상적으로("사람을 좋아해서") 답하면 구체적 장면으로 끌어내.
  "그걸 느낀 구체적인 순간이 있었어요?"
- 경험이 나오면 STAR로 파: 어떤 상황(S), 뭘 해야 했고(T),
  구체적으로 뭘 했고(A), 결과가 어땠는지(R). 특히 A(행동)를 깊게.
- 막힘 예시: "꼭 대단한 일 아니어도 돼요. 알바하다 겪은 일,
  친구랑 있었던 일, 그런 일상도 좋은 소재예요."`,
  values: `[이 유형 파고들기 — 가치관형]
- 지원자가 사전적 정의로("팀워크란 서로 돕는 것") 답하면,
  그 생각을 경험에 묶어. "그렇게 생각하게 된 경험이 있어요?"
- 생각 → 그 생각의 근거가 된 실제 경험 → 그 경험의 구체적 장면 순으로.
- 막힘 예시: "어렵게 생각 말고, 그렇게 느낀 순간이 언제였는지부터요."`,
  judgment: `[이 유형 파고들기 — 상황 판단형]
- 여기선 과거 경험이 아니라 '판단'을 다듬어. "그런 경험 있어요?"라고
  묻지 마. 이건 겪어본 적 없는 가상 상황이야.
- 지원자가 대처안을 내면, 판단의 빈틈을 찔러 정교하게 만들어.
  "누구한테 먼저 다가갈래요?", "이게 안전 규정 문제인지
  서비스 문제인지에 따라 접근이 다를 텐데 어떻게 봐요?"
- 막힘엔 경험 예시 말고 '판단 힌트'를 줘. "이런 상황은 보통
  안전이 걸렸는지부터 봐요. 등받이는 이착륙 때 안전 규정이거든요."`,
  company: `[이 유형 파고들기 — 정보·기업 분석형]
- 정보를 자기 생각과 연결하게 해. 추천만 하면 "왜 그걸 골랐어요?
  그게 우리 항공사한테 어떤 의미가 있는데요?"로 파고들어.
- 지원자가 회사를 얼마나 알아봤는지, 그걸 자기 언어로 풀 수 있는지가
  핵심. 단순 정보 나열에서 그치지 않게.
- 막힘 예시: "정답을 찾는 게 아니에요. 왜 그게 끌렸는지,
  그걸 통해 뭘 보여주고 싶은지가 중요해요."`,
};

// ── 다듬기(Sonnet) 프롬프트 — 안정 프리픽스(캐시 대상) ──────────────────────
const REFINE_SYSTEM = `너는 승무원 면접 답변 코치야.
지원자가 방금 인터뷰에서 꺼낸 자기 경험을 재료로,
면접 답변의 '뼈대'를 잡아주는 게 네 역할이야.
완성된 답을 주는 게 아니라, 지원자가 자기 말로 채울 구조를 만들어줘.

[절대 하지 말 것]
- 그대로 외워 말하면 되는 완성 답변을 주지 마. 외운 티 나고 그 사람 것이 아니게 돼.
- 지원자가 말하지 않은 경험·사실을 지어내지 마. 오직 꺼낸 재료만 써.

[할 것]
- 지원자의 경험을 면접 답변 흐름으로 구조를 잡아줘.
  어떤 순서로 말하면 좋을지, 어디에 무게를 둘지.
- 각 부분에 지원자가 채울 방향을 알려줘.
  "여기선 그때 느낀 감정을 한 문장으로", "이 경험을 지원동기와 연결해 마무리".
- 지원자 재료 중 면접에서 강점이 될 부분을 짚어줘.
- 마지막에 지원자가 스스로 완성해볼 수 있게 한마디 덧붙여.

[유형별 주의]
- 상황판단형(기내 상황)이면, 경험 서술이 아니라 판단·대처 흐름으로 뼈대를 잡아.
  "이런 경험이 있었다"가 아니라 "나는 이 상황을 이렇게 판단하고,
  이렇게 대처하겠다" 흐름으로.
- 나머지 유형은 지원자가 꺼낸 경험을 중심으로 구조를 잡아.

[형식]
- 뼈대는 2~4개 흐름 단계로.
- 각 단계마다: 무슨 내용을 / 지원자가 어떻게 채울지.
- 완성 문장이 아니라 '방향'으로.`;

// 막힘 버튼을 눌렀을 때 모델에 전달하는 user 턴
const HELP_MARKER =
  "(지원자가 '잘 안 떠올라요' 버튼을 눌렀습니다. 막힘 대응 방식으로 도와주세요.)";

// ── 되묻기 대화 이력 → Anthropic messages 변환 ──────────────────────────────
// 규칙: 첫 메시지는 user 여야 함(선행 인사말 assistant 는 생략 — 문제는 system 에 있음).
//       연속 같은 role 은 API 가 한 턴으로 합쳐줌(허용).
// 비용 방어: 인증된 사용자라도 초대형 페이로드로 토큰 과금을 유발하지 못하게 캡
const MAX_HISTORY_ITEMS = 40;      // 최근 40개 턴만
const MAX_MSG_CHARS = 2000;        // 메시지당 2,000자
// ⚠️ 다듬기 재료 상한 4,000자(2026-07-27, 구 8,000자). 다듬기는 Sonnet 5 라 되묻기(Haiku)보다
//    10배 비싸고, 입력 길이가 그대로 원가다. 실제 되묻기 대화가 4,000자를 넘는 일은 드문데
//    상한만 8,000자로 열려 있어 최악 원가가 두 배였다. 줄여도 정상 사용은 잘리지 않는다.
const MAX_MATERIALS_CHARS = 4000;  // 다듬기 재료 최대 4,000자
const MAX_QUESTION_CHARS = 300;    // 폴백 문제 텍스트 최대 300자

function toMessages(
  history: unknown,
  help: boolean,
): Array<{ role: string; content: string }> {
  const msgs: Array<{ role: string; content: string }> = [];
  const items = (Array.isArray(history) ? history : []).slice(-MAX_HISTORY_ITEMS);
  for (const h of items) {
    if (!h || typeof h.content !== "string" || !h.content.trim()) continue;
    const content = h.content.slice(0, MAX_MSG_CHARS);
    if (h.role === "user") {
      msgs.push({ role: "user", content });
    } else if (h.role === "help") {
      msgs.push({ role: "user", content: HELP_MARKER });
    } else if (h.role === "researcher") {
      if (msgs.length === 0) continue; // 첫 메시지가 assistant 가 되면 400
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // ⚠️ 차감해 놓고 결과를 못 주면 반드시 되돌려야 한다 → catch 에서도 보이도록 try 밖에 둔다.
  let charged: { ref: string } | null = null;
  // deno-lint-ignore no-explicit-any
  let supaRef: any = null;
  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY 미설정" }, 500);

    // 로그인 회원만 (게이트웨이 verify_jwt + 이중 확인). RLS 도 사용자 권한으로 적용됨.
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    supaRef = supa;
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return json({ error: "로그인이 필요합니다" }, 401);

    // ⚠️ 구 members.sojae_enabled 권한 게이트는 2026-07-27 폐지 — 크레딧으로 통제한다.
    //    회원이면 누구나 되묻기는 무료, 다듬기에서만 차감한다(아래 '다듬기에서만 차감' 블록).

    const body = await req.json();
    const stage = body.stage === "refine" ? "refine" : "ask";

    // 문제는 서버에서 재조회(신뢰 원천). 실패 시 클라이언트가 보낸 category 만 사용.
    let qContent = "";
    let category =
      typeof body.category === "string" && ASK_TYPES[body.category]
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
        if (ASK_TYPES[q.category]) category = q.category;
      }
    }
    // DB 조회 실패/미제공 시 클라이언트가 보낸 문제 텍스트로 폴백(캡 적용) — 화면과 AI 컨텍스트 불일치 방지
    if (!qContent && typeof body.question_text === "string") {
      qContent = body.question_text.slice(0, MAX_QUESTION_CHARS);
    }
    const catLabel = CAT_LABEL[category];

    // ── 다듬기에서만 차감 (되묻기 대화는 무료) ────────────────────────────
    // ⚠️ 되묻기(Haiku)는 1회 약 5원, 다듬기(Sonnet 5)는 약 50~150원으로 10배 이상 차이난다.
    //    그래서 "한 세션에 얼마"가 아니라 **비싼 호출 하나에 요금을 붙인다.** 대화는 무료라
    //    말만 해보고 나가는 사람이 손해 보지 않고, 결과물을 받을 때만 낸다.
    //    ⚠️ 세션 단위로 묶는 방식으로 되돌리지 말 것 — 다듬기를 몇 번 눌러도 같은 값이라
    //       하루 무료 한도가 원가 상한 노릇을 못 하게 된다(2026-07-27 오너와 확정).
    let spent:
      | { used?: string; cost?: number; balance?: number; daily_left?: number }
      | null = null;
    if (stage === "refine") {
      // 차감 키 = '<문제id>#<이전 차감 횟수>'. 같은 키로 다시 부르면 spend_credit 이
      // used='already' 로 통과시켜 네트워크 재전송에 두 번 깎이지 않는다. 다음 다듬기는
      // 번호가 하나 올라가 새로 차감된다(= 누를 때마다 과금). AI킬러와 같은 방식.
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
        // ⚠️ 여기서 나가는 두 응답 모두 반드시 200 이다. non-2xx 면 supabase-js 가 data 를
        //    null 로 만들고 본문을 error.context 에 숨겨서, 화면이 사유를 못 띄운 채
        //    폴백(가짜 뼈대)을 보여준다 — "안 깎였는데 결과가 나왔다"가 되는 자리.
        if (msg.includes("no_credit")) {
          return json({ error: "크레딧이 모자라요.", code: "no_credit" }, 200);
        }
        console.error("spend_credit failed", msg);
        return json(
          { error: "다듬기를 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.", code: "spend_failed" },
          200,
        );
      }
      spent = spentRaw as typeof spent;
      // 'already' 는 이번 호출이 깎은 게 아니다 → 실패해도 환급하면 안 된다(남의 차감을 되돌린다).
      if (spent?.used !== "already") charged = { ref: payRef };
    }

    let model: string;
    let maxTokens: number;
    let system: unknown[];
    let messages: unknown[];

    if (stage === "ask") {
      model = "claude-haiku-4-5";
      maxTokens = 1024;
      system = [
        // 안정 프리픽스(공통+유형별) = prompt caching 대상.
        // ※ 모델별 최소 캐시 프리픽스(수천 토큰)보다 짧으면 조용히 캐시가 안 걸릴 수 있음(무해).
        {
          type: "text",
          text: ASK_COMMON + "\n\n" + ASK_TYPES[category],
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: `오늘의 문제: ${qContent}\n문제 유형: ${catLabel}` },
      ];
      messages = toMessages(body.history, !!body.help);
    } else {
      model = "claude-sonnet-5";
      // ⚠️ max_tokens 는 '상한'이지 '청구액'이 아니다 — 여유를 줄여도 원가는 안 줄고 답만 잘린다.
      //    Sonnet 5 는 adaptive thinking 이 기본 ON 이라 thinking 이 이 한도를 같이 쓴다.
      //    원가를 줄이는 실제 손잡이는 아래 effort(생각 깊이)와 위의 재료 글자수 상한이다.
      maxTokens = 8192;
      system = [
        { type: "text", text: REFINE_SYSTEM, cache_control: { type: "ephemeral" } },
      ];
      const materials = (typeof body.materials === "string" ? body.materials : "").slice(0, MAX_MATERIALS_CHARS);
      messages = [
        {
          role: "user",
          content:
            `오늘의 문제: ${qContent}\n문제 유형: ${catLabel}\n지원자가 꺼낸 재료:\n${materials}`,
        },
      ];
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      // ⚠️ 다듬기만 effort 를 medium 으로 낮춘다. Sonnet 5 는 기본 high 라 생각을 길게 하는데,
      //    '재료를 뼈대로 정리한다'는 정해진 일에는 그만큼이 필요 없다. 출력 토큰이 곧 원가라
      //    이게 원가를 줄이는 가장 직접적인 손잡이다(품질 저하가 보이면 high 로 되돌릴 것).
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages,
        ...(stage === "refine" ? { output_config: { effort: "medium" } } : {}),
      }),
    });
    // ⚠️ 아래부터는 던져서 catch 가 환급까지 처리하게 한다(여기서 바로 return 하면 차감이 남는다).
    if (!res.ok) {
      console.error("anthropic error", res.status, await res.text());
      throw new Error("ai_failed");
    }
    const data = await res.json();
    // Sonnet 5 는 thinking 블록이 섞여 올 수 있음 → text 블록만 추출
    const text = (data.content || [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("ai_empty");

    const out: Record<string, unknown> = { message: text };
    if (stage === "ask") {
      // 프롬프트의 [멈춤] 신호 → 클라이언트가 다듬기 버튼 노출 트리거로 사용
      out.materials_sufficient = /재료가 충분/.test(text);
    } else {
      // 화면이 남은 크레딧을 바로 갱신할 수 있게 지갑 상태를 함께 돌려준다.
      out.used = spent?.used;
      out.cost = spent?.cost;
      out.balance = spent?.balance;
      out.daily_left = spent?.daily_left;
    }
    return json(out, 200);
  } catch (e) {
    // ⚠️ 차감했는데 결과를 못 준 경우 반드시 되돌린다.
    //    유료는 refund 행 추가, 무료는 free_use 행 삭제(한도 복구) — RPC 가 알아서 나눈다.
    if (charged && supaRef) {
      const { error } = await supaRef.rpc("refund_credit", {
        p_tool: "sojae",
        p_ref: charged.ref,
      });
      if (error) console.error("refund failed", error.message, charged.ref);
    }
    console.error(e);
    // 환급했다는 사실을 알려야 사용자가 '깎였는데 못 받았다'로 오해하지 않는다.
    if (charged) {
      return json(
        { error: "다듬기에 실패했어요. 크레딧은 돌려드렸습니다.", code: "failed", refunded: true },
        200,
      );
    }
    return json({ error: "서버 오류" }, 500);
  }
});
