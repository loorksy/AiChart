/**
 * Probe create_recommendation error payloads (sanitized).
 */
import { mintAccessToken } from "../mcp/src/auth/jwt.js";
import { loadConfig } from "../mcp/src/config.js";
import { SAMPLE_ARGS } from "../mcp/src/tools/sampleArgs.js";

const URL_ = process.env.MCP_TEST_URL ?? "http://127.0.0.1:8788/mcp";
const EMAIL = process.env.MCP_TEST_EMAIL ?? "";

let sessionId = "";
let msgId = 0;

async function rpc(method, params, token) {
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
  return JSON.parse(raw);
}

function basePlan(overrides = {}) {
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

async function call(token, name, args) {
  const r = await rpc("tools/call", { name, arguments: args }, token);
  const text = r?.result?.content?.find((c) => c.type === "text")?.text ?? "";
  return { error: r.error, isError: r.result?.isError, text: text.slice(0, 2500) };
}

async function main() {
  if (!EMAIL) throw new Error("MCP_TEST_EMAIL required");
  const cfg = loadConfig();
  const minted = await mintAccessToken(
    cfg.authSecret,
    { email: EMAIL, clientId: "probe-create", scopes: ["mcp:tools"] },
    1,
  );
  await rpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "probe", version: "1" },
    },
    minted.token,
  );
  await rpc("notifications/initialized", {}, minted.token).catch(() => {});

  const cases = [
    ["sample_wait", SAMPLE_ARGS.create_recommendation],
    [
      "wait_plan",
      {
        symbol: "EURUSD",
        timeframe: "5m",
        model_id: "probe-wait",
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
      },
    ],
    [
      "buy_plan",
      {
        symbol: "EURUSD",
        timeframe: "5m",
        action: "buy",
        model_id: "probe-buy",
        quote_age_ms: 400,
        current_price: 1.085,
        tick_size: 0.00001,
        model_plan: basePlan({ decision: "buy" }),
      },
    ],
    [
      "conditional_buy",
      {
        symbol: "EURUSD",
        timeframe: "5m",
        model_id: "probe-cond",
        quote_age_ms: 400,
        current_price: 1.085,
        tick_size: 0.00001,
        model_plan: basePlan({
          decision: "buy",
          activation: "conditional",
          requiredConfirmation: "Hold above 1.0852",
        }),
      },
    ],
  ];

  for (const [name, args] of cases) {
    const out = await call(minted.token, "create_recommendation", args);
    console.log("====", name, "====");
    console.log(JSON.stringify(out, null, 2));
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
