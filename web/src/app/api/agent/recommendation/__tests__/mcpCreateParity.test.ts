/**
 * Deferred #10, closed: the MCP-hosted model writing its own plan records a
 * parity observation — the one producer that could genuinely diverge from the
 * platform was invisible to the comparison until now.
 *
 * Exercised through the REAL route handler (auth included), because the
 * recording lives there: a unit test on parityLog alone would prove nothing
 * about this surface.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { NextRequest } from "next/server";

const dir = mkdtempSync(join(tmpdir(), "aichart-mcp-parity-"));
process.env.DB_PATH = join(dir, "parity.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "mcp-parity-test-secret";
process.env.AICHART_SERVICE_TOKEN = "test-service-token";
process.env.AICHART_SINGLE_USER = "0";
delete process.env.DATABASE_URL;

const EMAIL = "mcp-parity@example.com";

function signedHeaders(): Record<string, string> {
  const sig = createHmac("sha256", process.env.AICHART_SERVICE_TOKEN!)
    .update(EMAIL)
    .digest("hex");
  return {
    authorization: `Bearer ${process.env.AICHART_SERVICE_TOKEN}`,
    "x-aichart-user-email": EMAIL,
    "x-aichart-user-sig": sig,
    "content-type": "application/json",
  };
}

function completePayload() {
  return {
    symbol: "EURUSD",
    action: "buy",
    plan_type: "conditional",
    confidence: 70,
    rationale: "Structure is bullish and the demand zone held twice.",
    factors: ["demand zone"],
    timeframe: "15m",
    entry: 1.1,
    stop_loss: 1.09,
    take_profit: 1.12,
    activation_condition: "A 15m candle closes above 1.1010 after the retest.",
    activation_rule: { kind: "candle_close_above", level: 1.101 },
    invalidation_rule: "A full 15m close below 1.09 kills the idea.",
    alternative_scenario: "Losing 1.09 flips the bias toward 1.08.",
    validity_candles: 24,
  };
}

async function post(body: unknown) {
  const { POST } = await import("@/app/api/agent/recommendation/route");
  const req = new NextRequest("http://localhost/api/agent/recommendation", {
    method: "POST",
    headers: signedHeaders(),
    body: JSON.stringify(body),
  });
  return POST(req);
}

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  const userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [EMAIL, "x", "user", "active"],
  );
  // A paid entitlement: the route charges real quota, and a trial user burns
  // out after three calls — which is a subscription test, not a parity one.
  await db.execute(
    "INSERT INTO user_entitlements (user_id, plan_status, trial_interactions_used, trial_in_flight, subscription_expires_at) VALUES (?,?,?,?,?)",
    [userId, "active", 0, 0, Date.now() + 30 * 24 * 3600_000],
  );
  // The parity anchor: a CLOSED warehouse candle for the plan's symbol+interval.
  const candles = await import("@/lib/candles/candleRepository");
  const base = Date.now() - 60 * 60_000;
  await candles.upsertCandles(
    "EURUSD",
    "15m",
    Array.from({ length: 4 }, (_, index) => ({
      time: base + index * 15 * 60_000,
      open: 1.1,
      high: 1.102,
      low: 1.098,
      close: 1.101,
      volume: 100,
      complete: true,
    })),
  );
});

describe("MCP create_recommendation parity observation", () => {
  it("records an mcp-surface observation anchored to the closed candle", async () => {
    const res = await post(completePayload());
    assert.equal(res.status, 200, await res.text().catch(() => ""));

    const db = await import("@/lib/db");
    const rows = await db.query<{
      surface: string;
      parity_key: string | null;
      decision_json: string;
    }>("SELECT surface, parity_key, decision_json FROM decision_parity WHERE surface = ?", [
      "mcp",
    ]);
    assert.equal(rows.length, 1, "exactly one mcp observation");
    assert.ok(rows[0]!.parity_key, "the observation carries the parity key");
    assert.match(rows[0]!.parity_key!, /^EURUSD\|15m\|\d+$/);
    const decision = JSON.parse(rows[0]!.decision_json);
    assert.equal(decision.direction, "buy");
    assert.equal(decision.planType, "conditional");
  });

  it("a client retry updates the same observation — never a second row", async () => {
    const res = await post(completePayload());
    assert.equal(res.status, 200);

    const db = await import("@/lib/db");
    const rows = await db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM decision_parity WHERE surface = ?",
      ["mcp"],
    );
    // Same decision moment, same user → same observation id → one row.
    assert.equal(Number(rows[0]!.n), 1);
  });

  it("pairs with a platform observation on the same moment into a comparison", async () => {
    const db = await import("@/lib/db");
    const parity = await import("@/lib/agent/parityLog");
    const mcpRow = await db.queryOne<{ parity_key: string; market_timestamp: number }>(
      "SELECT parity_key, market_timestamp FROM decision_parity WHERE surface = ?",
      ["mcp"],
    );
    assert.ok(mcpRow);

    await parity.recordDecisionForParity({
      evidenceHash: "platform-snapshot-hash-for-the-same-moment",
      parityKey: mcpRow!.parity_key,
      symbol: "EURUSD",
      interval: "15m",
      timeframeSet: ["15m", "1h", "1d"],
      marketTimestamp: Number(mcpRow!.market_timestamp),
      surface: "platform",
      decision: {
        direction: "buy",
        planType: "conditional",
        entryLow: null,
        entryHigh: null,
        stopLoss: 1.09,
        targets: [1.12],
        executionState: "awaiting_activation",
        blocked: false,
        imagesFor: [],
        providers: [],
      },
    });

    const comparisons = await db.query<{ explained: number | null; difference_classification: string | null }>(
      "SELECT explained, difference_classification FROM decision_parity_comparisons",
      [],
    );
    assert.equal(comparisons.length, 1, "the pair materialized one comparison");
  });

  it("an invalid payload records nothing at all — no row, no observation", async () => {
    const db = await import("@/lib/db");
    const beforeRecs = await db.queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM recommendations",
      [],
    );
    const res = await post({
      ...completePayload(),
      activation_condition: undefined,
      activation_rule: undefined,
    });
    assert.equal(res.status, 400);
    const afterRecs = await db.queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM recommendations",
      [],
    );
    assert.equal(Number(afterRecs!.n), Number(beforeRecs!.n), "no partial write");
    const observations = await db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM decision_parity WHERE surface = ?",
      ["mcp"],
    );
    assert.equal(Number(observations[0]!.n), 1, "still only the earlier observation");
  });
});
