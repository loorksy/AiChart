import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-livecost-"));
process.env.DB_PATH = join(dir, "cost.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "cost-test-secret";
delete process.env.DATABASE_URL;

/**
 * The live cost profile, against a real database.
 *
 * The honesty rules under test are the module's reason to exist: numbers only
 * above a minimum sample, fallbacks labelled as fallbacks, staleness part of
 * the answer. A cost model that guesses confidently is worse than the static
 * multipliers it replaced.
 */

let db: typeof import("@/lib/db");
let cost: typeof import("@/lib/strategies/liveCostProfile");

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  cost = await import("@/lib/strategies/liveCostProfile");
});

async function seedSamples(input: {
  symbol: string;
  session: string;
  spreads: number[];
  ageMs?: number;
}): Promise<void> {
  const at = Date.now() - (input.ageMs ?? 60_000);
  for (const spread of input.spreads) {
    await db.execute(
      "INSERT INTO cost_samples (symbol, session, spread_pips, observed_at) VALUES (?,?,?,?)",
      [input.symbol, input.session, spread, at],
    );
  }
}

/** N samples around a median with a few wide outliers. */
function spreadSamples(median: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) =>
    i % 10 === 9 ? median * 2.4 : median + (i % 5) * 0.05,
  );
}

describe("aggregation honesty", () => {
  it("reports nothing for a session below the minimum sample", async () => {
    await seedSamples({ symbol: "GBPUSD", session: "asia", spreads: [2, 2.1, 2.2] });
    const profile = await cost.getLiveCostProfile("GBPUSD");
    const asia = profile.sessions.find((s) => s.session === "asia")!;
    assert.equal(asia.sampleCount, 3);
    // Three observations are a count, not a spread. The nulls are the honesty.
    assert.equal(asia.typicalSpreadPips, null);
    assert.equal(asia.expandedSpreadPips, null);
  });

  it("reports median, expansion, and modelled slippage above the minimum", async () => {
    await seedSamples({
      symbol: "EURUSD",
      session: "london",
      spreads: spreadSamples(1.0, 40),
    });
    const profile = await cost.getLiveCostProfile("EURUSD");
    const london = profile.sessions.find((s) => s.session === "london")!;
    assert.equal(london.sampleCount, 40);
    assert.ok(london.typicalSpreadPips != null && london.typicalSpreadPips >= 1);
    assert.ok(
      london.expandedSpreadPips! > london.typicalSpreadPips!,
      "p90 must sit above the median",
    );
    // Dispersion proxy: a jumpy spread fills away from the quote.
    assert.ok(london.estimatedSlippagePips! >= 0);
    assert.equal(profile.source, "live_ea_quotes");
  });

  it("marks a profile stale when the freshest sample is old", async () => {
    await seedSamples({
      symbol: "USDJPY",
      session: "asia",
      spreads: spreadSamples(1.8, 30),
      ageMs: 3 * 24 * 60 * 60 * 1000,
    });
    const profile = await cost.getLiveCostProfile("USDJPY");
    assert.equal(profile.stale, true, "last week's samples must say they are last week's");
    assert.ok(profile.freshnessMs! > 24 * 60 * 60 * 1000);
  });
});

describe("the labelled fallback", () => {
  it("answers from the live profile when it can", async () => {
    // EURUSD london seeded above with fresh samples.
    const answer = await cost.expectedSpreadFor(
      "EURUSD",
      0.9,
      new Date("2026-07-27T09:30:00Z"), // london
    );
    assert.equal(answer.source, "live_ea_quotes");
    assert.ok(answer.expectedSpreadPips != null);
    assert.ok(answer.sampleCount >= 20);
  });

  it("falls back to the static model AND says so", async () => {
    const answer = await cost.expectedSpreadFor(
      "AUDNZD", // never sampled
      1.5,
      new Date("2026-07-27T03:00:00Z"), // asia
    );
    // The label is the point: a modelled number posing as a measured one is the
    // failure this module was built to remove.
    assert.equal(answer.source, "static_model");
    assert.ok(answer.expectedSpreadPips! > 1.5, "asia multiplier shapes the observed quote");
    assert.equal(answer.sampleCount, 0);
  });

  it("returns unavailable rather than inventing when there is no quote either", async () => {
    const answer = await cost.expectedSpreadFor("AUDNZD", null);
    assert.equal(answer.source, "unavailable");
    assert.equal(answer.expectedSpreadPips, null);
  });

  it("does not answer live from a stale profile", async () => {
    // USDJPY has enough samples but they are three days old.
    const answer = await cost.expectedSpreadFor(
      "USDJPY",
      1.8,
      new Date("2026-07-27T03:00:00Z"), // asia — the seeded session
    );
    assert.equal(answer.source, "static_model", "stale live data falls back, labelled");
    assert.equal(answer.stale, true);
  });
});
