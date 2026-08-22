/**
 * Phase B — the MCP path produces a complete recommendation at ZERO platform
 * LLM spend, and the gates keep their authority over the client's plan.
 *
 * The four required proofs, run against the REAL chain (real specialists over
 * injected candles, real gate builder, real recorder, real write boundary):
 *
 *  1. full path: client plan → G1–G7 in one call → recorded chain →
 *     createCanonicalRecommendation succeeds — with a fetch guard proving the
 *     whole run made zero network calls (so zero LLM calls of any kind);
 *  2. a plan failing a gate → a NAMED refusal (gate id + reason), and the
 *     recorded refusal blocks the write by name;
 *  3. a create without gate records → refused exactly as before;
 *  4. the stored recommendation carries its model source, and the outcome
 *     record separates mcp_client from platform_agent in computation.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-client-plan-chain-"));
process.env.DB_PATH = join(dir, "chain.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "chain-test-secret";
delete process.env.DATABASE_URL;

import type { AgentCandle } from "@/lib/agent/marketContext/detectors";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { NewsMacroResult } from "@/lib/agent/agents/newsMacroAgent";

let userId = 0;
let chain: typeof import("@/lib/agent/gates/clientPlanChain");
let lifecycle: typeof import("@/lib/recommendations/canonical");
let fixtures: typeof import("@/lib/recommendations/__tests__/fixtures/completePlan");

/** Every network call attempted while the guard is armed. */
const fetchAttempts: string[] = [];

const HOUR = 3_600_000;

/** A calm uptrend: enough closed bars for every detector, no gaps. */
function trendCandles(count: number, stepMs: number, endClose: number): AgentCandle[] {
  const out: AgentCandle[] = [];
  const start = Date.UTC(2026, 0, 5, 0, 0, 0); // a Monday — market open
  for (let i = 0; i < count; i++) {
    const close = endClose - (count - 1 - i) * 0.8 + Math.sin(i / 3) * 1.5;
    const open = close - 0.6;
    out.push({
      time: start + i * stepMs,
      open,
      high: Math.max(open, close) + 1.2,
      low: Math.min(open, close) - 1.2,
      close,
      volume: 1000 + (i % 7) * 25,
    });
  }
  return out;
}

/**
 * The market context the specialists read, computed by the REAL detectors
 * over synthetic candles — buildAgentMarketContext minus its network I/O.
 * marketOpen=false on purpose: the chain's default G7 quote policy then reads
 * the last CLOSE (the orchestrator's paused-tape policy), touching nothing.
 */
async function syntheticMarket(lastClose: number): Promise<AgentMarketContext> {
  const detectors = await import("@/lib/agent/marketContext/detectors");
  const current = trendCandles(160, HOUR, lastClose);
  const higher = trendCandles(120, 4 * HOUR, lastClose);
  const daily = trendCandles(90, 24 * HOUR, lastClose);
  const partial = {
    symbol: "XAUUSD",
    interval: "1h",
    higherInterval: "4h",
    currentPrice: lastClose,
    spread: null,
    atr: detectors.calculateAtr(current),
    marketRegime: detectors.detectMarketRegime(current),
    dataQuality: {
      currentTfCount: current.length,
      higherTfCount: higher.length,
      dailyCount: daily.length,
      sufficient: true,
      hasCriticalGaps: false,
    },
    marketOpen: false,
    currentTfCandles: current,
    higherTfCandles: higher,
    dailyCandles: daily,
    visibleCandles: current,
    majorLevels: detectors.detectMajorLevels(current, daily),
    liquidity: detectors.detectLiquidity(current),
    zones: detectors.detectSupplyDemandZones(current),
  };
  return partial as unknown as AgentMarketContext;
}

function calmNews(): NewsMacroResult {
  return {
    newsRisk: "low",
    biasImpact: "mixed",
    affectedCurrencies: ["USD"],
    upcomingEvents: [],
    tradeAllowed: true,
    reason: "calendar clear",
  };
}

function imminentHighImpactNews(now: number): NewsMacroResult {
  return {
    newsRisk: "high",
    biasImpact: "mixed",
    affectedCurrencies: ["USD"],
    upcomingEvents: [
      {
        title: "CPI (YoY)",
        time: new Date(now + 10 * 60_000).toISOString(),
        impact: "high",
        currency: "USD",
      },
    ] as NewsMacroResult["upcomingEvents"],
    tradeAllowed: false,
    reason: "high-impact event inside the blackout window",
  };
}

const LAST_CLOSE = 4000;

function runChain(
  plan: Partial<import("@/lib/agent/gates/clientPlanChain").ClientPlan>,
  deps: Partial<import("@/lib/agent/gates/clientPlanChain").ClientPlanChainDeps> = {},
) {
  return chain.runClientPlanGateChain(
    {
      userId,
      symbol: "XAUUSD",
      interval: "1h",
      plan: {
        direction: "buy",
        declaredEntryType: "market",
        planType: "immediate",
        entry: LAST_CLOSE,
        stopLoss: LAST_CLOSE - 10,
        targets: [LAST_CLOSE + 10, LAST_CLOSE + 20],
        activationRule: null,
        ...plan,
      },
      visualTimeframes: ["1h", "4h"],
    },
    {
      buildMarket: async () => syntheticMarket(LAST_CLOSE),
      runNews: async () => calmNews(),
      newsProviderConfigured: () => true,
      ...deps,
    },
  );
}

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  chain = await import("@/lib/agent/gates/clientPlanChain");
  lifecycle = await import("@/lib/recommendations/canonical");
  fixtures = await import("@/lib/recommendations/__tests__/fixtures/completePlan");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["client-plan@example.com", "x", "user", "active"],
  );
  await db.execute(
    `INSERT INTO user_entitlements (user_id, plan_status) VALUES (?, 'active')
     ON CONFLICT (user_id) DO UPDATE SET plan_status = 'active'`,
    [userId],
  );
  // The zero-spend guard: ANY network call from here on — an LLM provider, an
  // embedding, a data feed — explodes loudly. The chain must run on injected
  // data and stored records alone.
  globalThis.fetch = ((input: unknown) => {
    const url = String(input);
    fetchAttempts.push(url);
    throw new Error(`network forbidden in zero-spend test: ${url}`);
  }) as unknown as typeof fetch;
});

describe("Phase B: client plan → gates → recommendation at zero platform spend", () => {
  it("runs G1–G7 over the client's plan in one call, records the chain, and the write succeeds — with zero network calls", async () => {
    const result = await runChain({});
    assert.equal(result.allowed, true, JSON.stringify(result.vetoedBy));
    assert.equal(result.refusalAr, null);
    assert.equal(result.entryType, "market");
    assert.deepEqual(
      result.verdicts.map((v) => v.id),
      ["G1", "G2", "G3", "G4", "G5", "G6", "G7"],
      "the full chain ran, in its forced order",
    );
    assert.ok(result.verdicts.every((v) => v.status === "pass"));

    // The recorded chain is the currency the unchanged write boundary accepts.
    const created = await lifecycle.createCanonicalRecommendation({
      userId,
      analysisId: result.analysisId,
      symbol: "XAUUSD",
      market: "forex",
      timeframe: "1h",
      direction: "buy",
      entry: LAST_CLOSE,
      stopLoss: LAST_CLOSE - 10,
      targets: [LAST_CLOSE + 10, LAST_CLOSE + 20],
      confidence: 66,
      source: "agent",
      decisionSource: "mcp_client",
      decisionModel: "claude-test-client",
      ...fixtures.canonicalCompletePlan(),
    });
    assert.ok(created.recommendationId > 0);
    assert.equal(created.decisionSource, "mcp_client");
    assert.equal(created.decisionModel, "claude-test-client");

    assert.deepEqual(
      fetchAttempts,
      [],
      "the whole path — specialists, gates, record, write — touched the network",
    );
  });

  it("names the gate when an imminent high-impact event refuses the plan, and the recorded refusal blocks the write by name", async () => {
    const result = await runChain(
      {},
      { runNews: async () => imminentHighImpactNews(Date.now()) },
    );
    assert.equal(result.allowed, false);
    assert.equal(result.vetoedBy?.id, "G1", "the news gate is the one that fell");
    assert.equal(result.vetoedBy?.status, "veto");
    assert.ok(result.vetoedBy?.reasonAr, "the refusal carries its reason");
    assert.ok(result.refusalAr, "the operator-language summary names the refusal");

    await assert.rejects(
      () =>
        lifecycle.createCanonicalRecommendation({
          userId,
          analysisId: result.analysisId,
          symbol: "XAUUSD",
          market: "forex",
          timeframe: "1h",
          direction: "buy",
          entry: LAST_CLOSE,
          stopLoss: LAST_CLOSE - 10,
          targets: [LAST_CLOSE + 10],
          confidence: 60,
          source: "agent",
          decisionSource: "mcp_client",
          ...fixtures.canonicalCompletePlan(),
        }),
      (err: { code?: string; message: string }) => {
        assert.equal(err.code, "RECOMMENDATION_GATES_INCOMPLETE");
        // The chain stopped at the veto, so the recorded set is partial — the
        // unchanged boundary refuses it as an incomplete chain, naming the
        // unanswered gates. The VETO's own name and reason reached the client
        // in the chain result asserted above.
        assert.match(
          err.message,
          /have no recorded verdict/,
          "the write refusal names what the record lacks",
        );
        return true;
      },
    );
  });

  it("names G7 when the live price says the entry has been and gone", async () => {
    // A buy entry far BELOW the current price: price moved past it by many
    // ATRs, so the final revalidation must refuse reachability.
    const result = await runChain({
      entry: LAST_CLOSE - 60,
      stopLoss: LAST_CLOSE - 70,
      targets: [LAST_CLOSE - 50, LAST_CLOSE - 40],
    });
    assert.equal(result.allowed, false);
    assert.equal(result.vetoedBy?.id, "G7", "the live-price gate is the one that fell");
    assert.equal(result.vetoedBy?.status, "veto");
    assert.ok(result.vetoedBy?.reasonAr, "the refusal says why the plan no longer stands");
  });

  it("still refuses a create whose analysis has no gate records at all", async () => {
    await assert.rejects(
      () =>
        lifecycle.createCanonicalRecommendation({
          userId,
          analysisId: "never-ran-anywhere",
          symbol: "XAUUSD",
          market: "forex",
          timeframe: "1h",
          direction: "buy",
          entry: LAST_CLOSE,
          stopLoss: LAST_CLOSE - 10,
          targets: [LAST_CLOSE + 10],
          confidence: 60,
          source: "agent",
          decisionSource: "mcp_client",
          ...fixtures.canonicalCompletePlan(),
        }),
      (err: { code?: string; message: string }) => {
        assert.equal(err.code, "RECOMMENDATION_GATES_INCOMPLETE");
        assert.match(err.message, /no gate records exist/);
        return true;
      },
    );
  });

  it("keeps the two records apart: source on the row, in the tracked read, in the stats, and in the counters", async () => {
    // A platform-agent row next to the mcp_client row from the first test.
    const platformPlan = await fixtures.gatedCompletePlan(userId);
    const platformRec = await lifecycle.createCanonicalRecommendation({
      userId,
      symbol: "XAUUSD",
      market: "forex",
      timeframe: "1h",
      direction: "sell",
      entry: LAST_CLOSE + 5,
      stopLoss: LAST_CLOSE + 15,
      targets: [LAST_CLOSE - 5],
      confidence: 55,
      source: "agent-tracker",
      decisionModel: "platform-model-x",
      ...platformPlan,
    });
    // No decisionSource passed → the default names the platform, never a client.
    assert.equal(platformRec.decisionSource, "platform_agent");
    assert.equal(platformRec.decisionModel, "platform-model-x");

    const store = await import("@/lib/recommendations/recommendationStore");
    const tracked = await store.listTrackedRecommendations(userId, { limit: 50 });
    const bySource = new Map(tracked.map((rec) => [rec.decisionSource, rec]));
    assert.ok(bySource.has("mcp_client"), "the MCP row keeps its source in the tracked read");
    assert.ok(bySource.has("platform_agent"), "the platform row keeps its source");
    assert.equal(bySource.get("mcp_client")?.decisionModel, "claude-test-client");

    const { computeRecommendationStats } = await import(
      "@/lib/recommendations/recommendationStats"
    );
    const stats = computeRecommendationStats(tracked);
    const groups = new Map(stats.byDecisionSource.map((group) => [group.key, group]));
    assert.equal(groups.get("mcp_client")?.total, 1);
    assert.equal(groups.get("platform_agent")?.total, 1);

    const { readRecommendationCounters } = await import(
      "@/lib/recommendations/usageCounters"
    );
    const counters = await readRecommendationCounters(userId);
    const counts = Object.fromEntries(
      counters.map((counter) => [counter.decisionSource, counter.count]),
    );
    assert.equal(counts["mcp_client"], 1, "one MCP creation counted");
    assert.equal(counts["platform_agent"], 1, "one platform creation counted");
  });
});
