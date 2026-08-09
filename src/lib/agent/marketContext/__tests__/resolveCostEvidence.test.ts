import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-costevidence-"));
process.env.DB_PATH = join(dir, "cost.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "cost-evidence-test-secret";
delete process.env.DATABASE_URL;

/**
 * The resolution ladder end to end, against a real (empty) database.
 *
 * The user-facing bug this pins: with no observed quote, no cost_samples and
 * a static branch that required an observation, `resolveCostEvidence` could
 * only answer "unavailable" — so the LLM told the operator the spread was
 * unavailable while the platform's own ticker displayed it. Rung 1 must win
 * when a quote is supplied, and the static model must answer when everything
 * else is empty.
 */

let costEvidence: typeof import("@/lib/agent/marketContext/costEvidence");
let sessionSpread: typeof import("@/lib/strategies/sessionSpread");

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  costEvidence = await import("@/lib/agent/marketContext/costEvidence");
  sessionSpread = await import("@/lib/strategies/sessionSpread");
});

describe("rung 1 — the observed quote", () => {
  it("returns observed_quote when a fresh bid/ask is supplied", async () => {
    const now = 1_700_000_000_000;
    const evidence = await costEvidence.resolveCostEvidence({
      symbol: "EURUSD",
      referencePrice: 1.09,
      observedOverride: { bid: 1.09, ask: 1.09012, observedAt: now - 900 },
      now,
    });
    assert.equal(evidence.source, "observed_quote");
    assert.ok(Math.abs(evidence.spreadPrice! - 0.00012) < 1e-9, "PRICE units: ask - bid");
    assert.ok(Math.abs(evidence.spreadPips! - 1.2) < 1e-6, "the same spread in pips");
    assert.equal(evidence.bid, 1.09);
    assert.equal(evidence.ask, 1.09012);
    assert.equal(evidence.freshnessMs, 900);
    assert.equal(evidence.fallbackUsed, false);
    assert.equal(evidence.fallbackReason, null);
  });

  it("never presents a stale quote as live — it falls to the static model, saying why", async () => {
    const now = 1_700_000_000_000;
    const evidence = await costEvidence.resolveCostEvidence({
      symbol: "EURUSD",
      referencePrice: 1.09,
      observedOverride: {
        bid: 1.09,
        ask: 1.09012,
        observedAt: now - 5 * 60_000, // beyond ANALYSIS_QUOTE_STALE_MS
      },
      now,
    });
    assert.equal(evidence.source, "static_fallback");
    assert.match(String(evidence.fallbackReason), /old/);
    assert.equal(evidence.bid, null, "a fallback rung never claims the quote's bid/ask");
  });
});

describe("rung 4 — the static model when everything else is empty", () => {
  it("answers static_fallback with the instrument-class figure, never unavailable", async () => {
    // No observedOverride, empty cost_samples: before the absolute table
    // existed this collapsed to "unavailable" and the model told the operator
    // the spread could not be read.
    const evidence = await costEvidence.resolveCostEvidence({
      symbol: "EURUSD",
      referencePrice: 1.1,
    });
    assert.equal(evidence.source, "static_fallback");
    const session = sessionSpread.sessionAt(new Date());
    const expectedPips = Number(
      (1.2 * sessionSpread.SESSION_SPREAD_MULTIPLIER[session]).toFixed(2),
    );
    assert.equal(evidence.spreadPips, expectedPips, "major-class 1.2 pips, session-shaped");
    assert.ok(
      Math.abs(evidence.spreadPrice! - expectedPips * 0.0001) < 1e-9,
      "price units derive from pips through the instrument's pip size",
    );
    assert.equal(evidence.fallbackUsed, true);
    assert.ok(String(evidence.fallbackReason).length > 0);
  });

  it("still answers unavailable for an instrument the model refuses to price", async () => {
    const evidence = await costEvidence.resolveCostEvidence({
      symbol: "BTCUSD",
      referencePrice: 60_000,
    });
    assert.equal(evidence.source, "unavailable");
    assert.equal(evidence.spreadPrice, null);
    assert.equal(evidence.spreadPips, null);
    assert.equal(evidence.fallbackUsed, true);
  });
});
