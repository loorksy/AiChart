/**
 * The evidence card, connected.
 *
 * `evidenceCard.ts` was written to close a specific gap: the strategy factory
 * validated backtests for years and none of it reached the operator, who saw a
 * bare confidence number and never the WHY. `buildEvidenceCard` was written,
 * tested, declared on `AgentResult`, and RENDERED by the chat panel — and it
 * had no caller anywhere outside its own unit test, so the field was never
 * assigned and the card could never appear. Every piece existed; the connection
 * did not.
 *
 * That is invisible to a type checker (an optional field is legally absent) and
 * to a unit test (the builder works perfectly on inputs nobody supplies). So
 * half of this file tests the lookup's behaviour and the other half tests that
 * it is actually WIRED — the part that was missing.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-evidence-card-"));
process.env.DB_PATH = join(dir, "evidence.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "evidence-card-secret";
delete process.env.DATABASE_URL;

const SRC = path.join(import.meta.dirname, "..", "..", "..");

let support: typeof import("@/lib/strategies/supportSummary");
let db: typeof import("@/lib/db");

const OWNER = 1;
const OTHER = 2;

/** Seed a backtest and the deployment minted from it. */
async function seed(over: {
  user: number;
  strategyId: string;
  symbol?: string;
  timeframe?: string;
  state?: string;
  tradeCount?: number;
  winRate?: number | null;
  profitFactor?: number | null;
  validation?: string;
  low?: number;
  high?: number;
  liveSampleSize?: number;
  liveWinRate?: number | null;
}) {
  const now = Date.now();
  const symbol = over.symbol ?? "XAUUSD";
  const timeframe = over.timeframe ?? "1h";
  const id = await db.insertReturningId(
    `INSERT INTO strategy_backtests
       (user_id, strategy_id, strategy_version, symbol, timeframe, job_id, status,
        trade_count, win_rate, profit_factor, calibrated_confidence,
        confidence_low, confidence_high, validation_json, created_at, updated_at)
     VALUES (?,?,'1',?,?,?,'eligible',?,?,?,?,?,?,?,?,?)`,
    [
      over.user,
      over.strategyId,
      symbol,
      timeframe,
      `job_${over.strategyId}_${over.user}`,
      over.tradeCount ?? 250,
      over.winRate === undefined ? 0.56 : over.winRate,
      over.profitFactor === undefined ? 1.6 : over.profitFactor,
      55,
      over.low ?? 48,
      over.high ?? 62,
      over.validation ?? JSON.stringify({ walk_forward: { passed: true } }),
      now,
      now,
    ],
  );
  await db.execute(
    `INSERT INTO strategy_deployments
       (user_id, strategy_id, symbol, timeframe, backtest_id, state, expected_win_rate,
        calibrated_confidence, confidence_low, confidence_high, live_sample_size,
        live_win_rate, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      over.user,
      over.strategyId,
      symbol,
      timeframe,
      id,
      over.state ?? "active",
      0.55,
      55,
      over.low ?? 48,
      over.high ?? 62,
      over.liveSampleSize ?? 0,
      over.liveWinRate ?? null,
      now,
    ],
  );
}

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  for (const id of [OWNER, OTHER]) {
    await db.execute(
      "INSERT INTO users (id, email, password_hash, role, status) VALUES (?,?,?,?,?)",
      [id, `u${id}@example.com`, "x", "user", "active"],
    );
  }
  support = await import("@/lib/strategies/supportSummary");
});

describe("the evidence card lookup", () => {
  it("says nothing rather than showing an empty card", async () => {
    // A card of zeros reads as a strategy that lost. Nothing found is a
    // different claim from nothing worked, and only one of them is true here.
    const card = await support.getEvidenceCard({
      userId: OWNER,
      symbol: "XAUUSD",
      timeframe: "1h",
    });
    assert.equal(card, null);
  });

  it("carries the numbers the operator cannot get from a confidence score", async () => {
    await seed({ user: OWNER, strategyId: "ema_trend_v1" });
    const card = await support.getEvidenceCard({
      userId: OWNER,
      symbol: "XAUUSD",
      timeframe: "1h",
    });
    assert.ok(card);
    assert.equal(card.strategyId, "ema_trend_v1");
    assert.equal(card.tradeCount, 250);
    assert.equal(card.profitFactor, 1.6);
    assert.equal(card.walkForward, "passed");
    assert.equal(card.deploymentState, "active");
    assert.equal(card.meetsExecutionGates, true);
  });

  it("canonicalises the frame instead of reading 'nothing found'", async () => {
    // "M15"/"60"/"H1" spellings silently matched nothing for months elsewhere in
    // this codebase; the card must not reintroduce that.
    const card = await support.getEvidenceCard({
      userId: OWNER,
      symbol: "XAUUSD",
      timeframe: "H1",
    });
    assert.equal(card?.strategyId, "ema_trend_v1");
  });

  it("shows platform evidence to an operator who owns none", async () => {
    // The backtest pipeline writes its rows under one configured user. Scoping
    // strictly to the asker is why every other operator read "unavailable"
    // forever despite the factory having done the work.
    const card = await support.getEvidenceCard({
      userId: OTHER,
      symbol: "XAUUSD",
      timeframe: "1h",
    });
    assert.equal(card?.strategyId, "ema_trend_v1");
  });

  it("treats an unreadable walk-forward blob as not evaluated, never as passed", async () => {
    // The verdict is one of the gates this card exists to SHOW. Defaulting a
    // corrupt blob open would let it render as execution-grade.
    await seed({
      user: OWNER,
      strategyId: "corrupt_v1",
      timeframe: "4h",
      validation: "{not json",
    });
    const card = await support.getEvidenceCard({
      userId: OWNER,
      symbol: "XAUUSD",
      timeframe: "4h",
    });
    assert.equal(card?.walkForward, "not_evaluated");
    assert.equal(card?.meetsExecutionGates, false);
    assert.equal(card?.shortfallReason, "walk_forward_not_evaluated");
  });

  it("does not present a suspended deployment as evidence", async () => {
    await seed({
      user: OWNER,
      strategyId: "suspended_v1",
      timeframe: "5m",
      state: "suspended",
    });
    assert.equal(
      await support.getEvidenceCard({ userId: OWNER, symbol: "XAUUSD", timeframe: "5m" }),
      null,
    );
  });

  it("names the same strategy the grade names", async () => {
    // Two lookups over one table, shown side by side in one answer. If they
    // ordered differently the card would describe a strategy the grade was not
    // talking about, and the operator would have no way to tell.
    await seed({
      user: OWNER,
      strategyId: "wide_shadow_v1",
      timeframe: "15m",
      state: "shadow",
      low: 30,
      high: 80,
    });
    await seed({
      user: OWNER,
      strategyId: "tight_active_v1",
      timeframe: "15m",
      state: "active",
      low: 50,
      high: 60,
    });
    const card = await support.getEvidenceCard({
      userId: OWNER,
      symbol: "XAUUSD",
      timeframe: "15m",
    });
    const grade = await support.getStatisticalSupport({
      userId: OWNER,
      symbol: "XAUUSD",
      timeframe: "15m",
    });
    assert.equal(card?.strategyId, "tight_active_v1");
    assert.equal(grade.strategyId, card?.strategyId);
  });
});

describe("the card reaches the surface that renders it", () => {
  // The half that was actually broken. Each of these passed for as long as the
  // card was dead, EXCEPT the assignment — which is the whole point.
  const orchestrator = readFileSync(
    path.join(SRC, "lib", "agent", "orchestrator.ts"),
    "utf8",
  );

  it("is looked up during the run", () => {
    assert.match(orchestrator, /getEvidenceCard\(/);
  });

  it("is assigned onto the result", () => {
    // Without this line every other piece of the chain is decoration.
    assert.match(
      orchestrator,
      /evidenceCard: evidenceCard \?\? undefined/,
      "a declared field nobody assigns renders nothing, forever",
    );
  });

  it("is looked up alongside the grade, not after it", () => {
    // Evidence that arrives after the decision is the same as none — the
    // premise supportSummary.ts was built on. A second serial await here would
    // spend that budget twice on one table.
    const parallel = orchestrator.indexOf("Promise.all([");
    const grade = orchestrator.indexOf("getStatisticalSupport({");
    const card = orchestrator.indexOf("getEvidenceCard({");
    assert.ok(parallel > 0 && parallel < grade && grade < card);
  });

  it("is rendered, through the card layer that now owns the render path", () => {
    // This arm used to read the panel directly for `result?.evidenceCard`, and
    // it FAILED when the card layer took the render path over — correctly, and
    // that is the point of writing it as a connection check. Following the new
    // path rather than deleting the arm: the deriver turns the field into an
    // `evidence_strategy` card, and the card renderer draws it with the same
    // component the panel used to call itself.
    const derive = readFileSync(
      path.join(SRC, "lib", "agent", "cards", "deriveCards.ts"),
      "utf8",
    );
    assert.match(derive, /result\.evidenceCard/, "the deriver must read the field");
    assert.match(derive, /kind: "evidence_strategy"/);

    const cards = readFileSync(
      path.join(SRC, "components", "agent", "cards", "AgentCards.tsx"),
      "utf8",
    );
    assert.match(cards, /case "evidence_strategy":/);
    assert.match(cards, /<AgentEvidenceCard card=\{card\.card\} \/>/);

    const panel = readFileSync(
      path.join(SRC, "components", "agent", "SmartChartAgentPanel.tsx"),
      "utf8",
    );
    assert.match(panel, /<AgentCards\b/, "and the panel must actually mount the card layer");
  });
});
