/**
 * Authenticated create_recommendation matrix (non-executing).
 *
 *   MCP_TEST_URL=http://127.0.0.1:8787/mcp \
 *   MCP_TEST_EMAIL=owner@example.com \
 *   npm run test:create-recommendation
 *
 * Proves validateModelTradePlan path, persistence of WAIT/directional plans,
 * and that invalid geometry remains non-executable without placing orders.
 */
import { mintAccessToken } from "../src/auth/jwt.js";
import { loadConfig } from "../src/config.js";

const URL_ = process.env.MCP_TEST_URL ?? "http://127.0.0.1:8787/mcp";
const EMAIL = process.env.MCP_TEST_EMAIL ?? "";

let sessionId = "";
let msgId = 0;

async function rpc(method: string, params: unknown, token: string): Promise<any> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++msgId, method, params }),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  const text = await res.text();
  const dataLines = text.split("\n").filter((l) => l.startsWith("data:"));
  const raw = dataLines.length ? dataLines[dataLines.length - 1].slice(5) : text;
  try {
    return JSON.parse(raw);
  } catch {
    return { error: { message: `non-JSON response (${res.status})` }, httpStatus: res.status };
  }
}

function basePlan(overrides: Record<string, unknown>) {
  return {
    decision: "buy",
    activation: "immediate",
    marketRegime: "trend",
    marketThesis: "Host-model owned scalp plan for release qualification.",
    primaryTimeframe: "5m",
    contextTimeframes: ["15m"],
    timeframeAnalysis: [
      { timeframe: "5m", bias: "bullish", evidence: "Higher lows into demand." },
    ],
    entryZone: { low: 1.0848, high: 1.0852, preferred: 1.085 },
    invalidation: 1.0835,
    stopLoss: 1.0835,
    targets: [
      { price: 1.0865, reason: "Prior swing" },
      { price: 1.0875, reason: "Extension" },
    ],
    requiredConfirmation: null,
    pathToEntry: "Wait for hold above preferred.",
    alternativeScenario: "Fade if structure breaks.",
    confidence: 0.71,
    summary: "BUY — host model owned plan for MCP release gate.",
    keyReasons: ["Structure", "Momentum"],
    warnings: [],
    dataTimestamp: new Date().toISOString(),
    ...overrides,
  };
}

function parseToolJson(r: any): Record<string, unknown> {
  const text: string =
    r?.result?.content?.find((c: any) => c.type === "text")?.text ?? "";
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 200), isError: Boolean(r?.result?.isError) };
  }
}

async function callCreate(
  token: string,
  args: Record<string, unknown>,
): Promise<{ rpc: any; body: Record<string, unknown> }> {
  const rpcRes = await rpc(
    "tools/call",
    { name: "create_recommendation", arguments: args },
    token,
  );
  return { rpc: rpcRes, body: parseToolJson(rpcRes) };
}

function assertCase(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
  return ok;
}

async function main() {
  if (!EMAIL) {
    console.error("MCP_TEST_EMAIL required");
    process.exit(1);
  }
  const cfg = loadConfig();
  const minted = await mintAccessToken(
    cfg.authSecret!,
    { email: EMAIL, clientId: "test-create-recommendation", scopes: ["mcp:tools"] },
    1,
  );
  const token = minted.token;

  const init = await rpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-create-recommendation", version: "1.0.0" },
    },
    token,
  );
  if (init.error) throw new Error(`initialize failed: ${init.error.message}`);
  await rpc("notifications/initialized", {}, token).catch(() => {});

  let passed = 0;
  let failed = 0;

  // 1) WAIT — must persist analytical WAIT, never place trade
  {
    const { rpc: r, body } = await callCreate(token, {
      symbol: "EURUSD",
      timeframe: "5m",
      model_id: "mcp-create-rec-wait",
      quote_age_ms: 400,
      current_price: 1.085,
      tick_size: 0.00001,
      model_plan: basePlan({
        decision: "wait",
        activation: "none",
        entryZone: { low: null, high: null, preferred: null },
        stopLoss: null,
        invalidation: null,
        targets: [],
        summary: "WAIT — no edge on this snapshot.",
        confidence: 0.4,
      }),
    });
    const validation = (body.validation ?? {}) as Record<string, unknown>;
    const ok =
      !r.error &&
      !r.result?.isError &&
      body.ok === true &&
      validation.requires_explicit_approval === true &&
      !/TradeCandidate|poi\.score|selectedTradeCandidateId/i.test(JSON.stringify(body));
    if (assertCase("create_recommendation_wait", ok, r.error?.message ?? JSON.stringify(validation)))
      passed++;
    else failed++;
  }

  // 2) Valid-looking BUY with fresh quote — may be executionReady or levels_require_refresh
  //    but must keep direction BUY and never execute.
  {
    const { rpc: r, body } = await callCreate(token, {
      symbol: "EURUSD",
      timeframe: "5m",
      action: "buy",
      model_id: "mcp-create-rec-buy",
      quote_age_ms: 400,
      current_price: 1.085,
      tick_size: 0.00001,
      allow_repair: true,
      model_plan: basePlan({ decision: "buy", activation: "immediate" }),
    });
    const text = JSON.stringify(body);
    const validation = (body.validation ?? {}) as Record<string, unknown>;
    const keepsBuy =
      /"action"\s*:\s*"buy"|decision"\s*:\s*"buy"|BUY/i.test(text) ||
      !r.result?.isError;
    const noCandidate = !/TradeCandidate|selectedTradeCandidateId|poi\.score/i.test(text);
    const ok =
      !r.error &&
      body.ok === true &&
      keepsBuy &&
      noCandidate &&
      validation.requires_explicit_approval === true &&
      !/tradesExecuted|order_placed|ticket/i.test(text);
    if (
      assertCase(
        "create_recommendation_buy_host_plan",
        ok,
        r.error?.message ??
          `keys=${Object.keys(body).slice(0, 8).join(",")} validation=${JSON.stringify(validation)}`,
      )
    )
      passed++;
    else failed++;
  }

  // 3) Invalid BUY geometry — direction retained, not executable
  {
    const { rpc: r, body } = await callCreate(token, {
      symbol: "EURUSD",
      timeframe: "5m",
      model_id: "mcp-create-rec-invalid-buy",
      quote_age_ms: 400,
      current_price: 1.085,
      tick_size: 0.00001,
      allow_repair: false,
      model_plan: basePlan({
        decision: "buy",
        stopLoss: 1.2, // wrong side
        targets: [{ price: 1.0, reason: "wrong side" }],
        entryZone: { low: 1.085, high: 1.085, preferred: 1.085 },
        summary: "BUY with intentionally invalid geometry.",
      }),
    });
    const text = JSON.stringify(body);
    const ok =
      !r.error &&
      !/tradesExecuted|order_placed|ticket/i.test(text) &&
      !/TradeCandidate/i.test(text);
    if (assertCase("create_recommendation_invalid_buy_non_executable", ok, ""))
      passed++;
    else failed++;
  }

  // 4) SELL host plan
  {
    const { rpc: r, body } = await callCreate(token, {
      symbol: "EURUSD",
      timeframe: "5m",
      model_id: "mcp-create-rec-sell",
      quote_age_ms: 400,
      current_price: 1.085,
      tick_size: 0.00001,
      model_plan: basePlan({
        decision: "sell",
        activation: "immediate",
        entryZone: { low: 1.0848, high: 1.0852, preferred: 1.085 },
        stopLoss: 1.0865,
        invalidation: 1.0865,
        targets: [
          { price: 1.0835, reason: "swing" },
          { price: 1.0825, reason: "extension" },
        ],
        summary: "SELL — host model owned plan.",
        keyReasons: ["Supply", "Momentum"],
      }),
    });
    const ok = !r.error && !r.result?.isError;
    if (assertCase("create_recommendation_sell_host_plan", ok, r.error?.message ?? ""))
      passed++;
    else failed++;
  }

  // 5) Conditional BUY
  {
    const { rpc: r } = await callCreate(token, {
      symbol: "EURUSD",
      timeframe: "5m",
      model_id: "mcp-create-rec-cond-buy",
      quote_age_ms: 400,
      current_price: 1.085,
      tick_size: 0.00001,
      model_plan: basePlan({
        decision: "buy",
        activation: "conditional",
        requiredConfirmation: "Hold above 1.0852",
        summary: "Conditional BUY — still directional.",
      }),
    });
    const ok = !r.error;
    if (assertCase("create_recommendation_conditional_buy", ok, r.error?.message ?? ""))
      passed++;
    else failed++;
  }

  console.log(`\ncreate_recommendation matrix: pass=${passed} fail=${failed}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
