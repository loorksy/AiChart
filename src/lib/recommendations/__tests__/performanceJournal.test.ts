/**
 * The XAUUSD conditional-sell transcript, replayed candle by candle.
 *
 * The incident (2026-08-26 screenshots): a conditional SELL — entry 4658.78
 * (zone 4656.17–4661.40), stop 4667.29, targets 4613.23 / 4577.93 / 4573.40,
 * activation "price reaches 4658.78 then rejects it: wick through the level
 * and a 15m candle CLOSE below it", invalidation "a 15m candle CLOSE above
 * 4667.29 kills the idea". Price rose into the zone, wicked to ~4670 — through
 * the stop INTRABAR, with no 15m close above it — closed below the entry
 * exactly as the plan predicted, and fell hard. The tracker left the plan
 * "بانتظار التفعيل"; the old chat evaluator would have called the same wick a
 * stop-out. Both contradict the plan's own words.
 *
 * These tests replay that exact tape and pin the contract:
 *  - the rejection candle ACTIVATES the plan, with the honest fill price
 *    (the confirming candle's close), and its own wick cannot stop it out;
 *  - the entry is recorded in the canonical store (the recommendations
 *    section) and counts in performance — as active once entered, as a WIN
 *    once the move pays;
 *  - a 15m CLOSE beyond the stop still kills it (close-mode is not immortality);
 *  - touch-mode plans (a live market fill's protective stop) still die on a touch;
 *  - the stop itself is CONSTRUCTED with a safety margin beyond the structural
 *    level, so this rejection wick would not have tagged it in the first place;
 *  - the chat/Telegram status adapter reports the same activation from the
 *    same canonical evaluator — entered at X, +N points, stop safe because no
 *    close above — with no data-vendor naming.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, test } from "node:test";

// Env FIRST relative to every db-touching import: modules that reach @/lib/db
// are imported dynamically inside the tests, after these bindings.
const dir = mkdtempSync(join(tmpdir(), "lonora-transcript-replay-"));
process.env.DB_PATH = join(dir, "replay.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "replay-test-secret";
delete process.env.DATABASE_URL;
delete process.env.TELEGRAM_BOT_TOKEN;

import {
  evaluateRecommendation,
  type EvaluateInput,
  type TrackerCandle,
} from "@/lib/recommendations/recommendationStatus";
import {
  applyStopSafetyBuffer,
  resolveInvalidationMode,
} from "@/lib/recommendations/entrySemantics";
import type { ActivationRule } from "@/lib/recommendations/activationRule";
import { deriveLifecycleEvents } from "@/lib/recommendations/lifecycleEvents";
import { computeRecommendationStats } from "@/lib/recommendations/recommendationStats";
import { gatedTrackedPlan } from "@/lib/recommendations/__tests__/fixtures/completePlan";

// ── The transcript's numbers ────────────────────────────────────────────────
const ENTRY = 4658.78;
const STOP = 4667.29;
const TARGETS = [4613.23, 4577.93, 4573.4];
const WICK_HIGH = 4670.0; // intrabar THROUGH the stop, no 15m close above
const REJECTION_CLOSE = 4655.0; // the honest fill: the confirming candle's close

/** The plan's own condition, as the synthesizer stores it (tolerance explicit
 *  so the replay grades the exact prices the transcript shows). */
const REJECTION_RULE: ActivationRule = {
  kind: "rejection_confirmed",
  level: ENTRY,
  direction: "below",
  tolerance: 0,
  timeframe: "15m",
};

const T = Date.UTC(2026, 0, 5, 12, 0, 0); // a Monday; all bars long closed
const BAR = 15 * 60_000;

function candle(i: number, o: number, h: number, l: number, c: number): TrackerCandle {
  return { time: T + i * BAR, open: o, high: h, low: l, close: c };
}

/** The tape from the screenshots: rise into the zone, the rejection wick, the fall. */
const CREATION = candle(0, 4640.0, 4646.0, 4638.0, 4645.0);
const RISE = candle(1, 4645.0, 4652.0, 4643.0, 4650.4);
const INTO_ZONE = candle(2, 4650.4, 4656.5, 4648.2, 4655.1); // zone touched, level not pierced
const REJECTION = candle(3, 4655.1, WICK_HIGH, 4652.8, REJECTION_CLOSE); // wick 4670, close below entry
const FALL = candle(4, REJECTION_CLOSE, 4657.2, 4644.9, 4646.3); // heading toward TP1

function transcriptPlan(
  over: Partial<EvaluateInput["recommendation"]> = {},
): EvaluateInput["recommendation"] {
  return {
    direction: "sell",
    entryType: "confirmation_close",
    entry: ENTRY,
    stopLoss: STOP,
    targets: TARGETS,
    planType: "conditional",
    activationRule: REJECTION_RULE,
    status: "pending_entry",
    outcome: "pending",
    createdAt: T,
    createdCandleTime: T,
    expiresAt: T + 6 * 3_600_000,
    validityCandles: 8,
    ...over,
  };
}

describe("invalidation-mode defaults match the plans' own wording", () => {
  it("a conditional plan with an activation rule grades its stop on the CLOSE", () => {
    assert.equal(
      resolveInvalidationMode({
        entryType: "confirmation_close",
        planType: "conditional",
        activationRule: REJECTION_RULE,
      }),
      "close",
    );
  });

  it("a plain immediate market fill keeps touch semantics — a live stop is an order", () => {
    assert.equal(
      resolveInvalidationMode({ entryType: "market", planType: null, activationRule: null }),
      "touch",
    );
  });
});

describe("the transcript: touch + rejection close activates; the wick cannot kill it", () => {
  it("activates on the rejection candle with the honest fill price", () => {
    const r = evaluateRecommendation({
      recommendation: transcriptPlan(),
      candles: [CREATION, RISE, INTO_ZONE, REJECTION, FALL],
      now: T + 5 * BAR,
    });
    assert.equal(r.triggered, true, "the plan's own condition occurred — it must fill");
    assert.equal(r.status, "triggered");
    assert.equal(r.outcome, "pending");
    assert.equal(r.triggeredAt, REJECTION.time);
    assert.equal(
      r.effectiveEntry,
      REJECTION_CLOSE,
      "graded on the confirming candle's close, never the nominal level",
    );
    assert.equal(
      r.slHitAt,
      undefined,
      "the 4670 wick pierced the stop INTRABAR before the position existed — not a stop-out",
    );
    assert.equal(r.activationEvidence?.kind, "rejection_confirmed");
    assert.equal(r.activationEvidence?.at, REJECTION.time);
  });

  it("a later wick through the stop with a close back inside is a rejection, not a stop-out", () => {
    // After the fill, ANOTHER candle spikes to 4671 but closes back at 4652:
    // close-mode invalidation survives it (this is beyond the fill-candle
    // exemption — the mode itself must hold on every later candle).
    const laterWick = candle(5, 4646.3, 4671.0, 4644.0, 4652.0);
    const r = evaluateRecommendation({
      recommendation: transcriptPlan(),
      candles: [CREATION, RISE, INTO_ZONE, REJECTION, FALL, laterWick],
      now: T + 6 * BAR,
    });
    assert.equal(r.status, "triggered");
    assert.equal(r.slHitAt, undefined);
  });

  it("replaying a sweep over a persisted fill does not re-grade pre-fill candles", () => {
    // Sweep 2 sees the same tape with triggeredAt/effectiveEntry already
    // stored. The rejection candle's wick must stay pre-trade.
    const r = evaluateRecommendation({
      recommendation: transcriptPlan({
        status: "triggered",
        triggeredAt: REJECTION.time,
        effectiveEntry: REJECTION_CLOSE,
      }),
      candles: [CREATION, RISE, INTO_ZONE, REJECTION, FALL],
      now: T + 5 * BAR,
    });
    assert.equal(r.status, "triggered");
    assert.equal(r.slHitAt, undefined);
    assert.equal(r.effectiveEntry, REJECTION_CLOSE);
  });

  it("a 15m candle CLOSE above the stop DOES kill the idea entirely", () => {
    const closeAbove = candle(5, 4646.3, 4669.8, 4645.0, 4668.4); // closes beyond 4667.29
    const r = evaluateRecommendation({
      recommendation: transcriptPlan(),
      candles: [CREATION, RISE, INTO_ZONE, REJECTION, FALL, closeAbove],
      now: T + 6 * BAR,
    });
    assert.equal(r.status, "sl_hit");
    assert.equal(r.outcome, "loss");
    assert.equal(r.slHitAt, closeAbove.time);
  });

  it("touch-mode plans still stop on a wick touch", () => {
    // A live market fill's protective stop is an order at a broker — it fills
    // on any trade at the level, wick included.
    const wickTouch = candle(1, 4650.0, 4668.0, 4648.0, 4650.5); // high ≥ 4667.29, closes back
    const r = evaluateRecommendation({
      recommendation: {
        direction: "sell",
        entryType: "market",
        entry: 4650.0,
        stopLoss: STOP,
        targets: TARGETS,
        status: "triggered",
        outcome: "pending",
        createdAt: T,
        createdCandleTime: T,
        expiresAt: T + 6 * 3_600_000,
        triggeredAt: T,
      },
      candles: [wickTouch],
      now: T + BAR,
    });
    assert.equal(r.status, "sl_hit");
    assert.equal(r.outcome, "loss");
  });
});

describe("stop construction: a safety margin beyond the structural level", () => {
  it("would have placed this plan's stop beyond the 4670 rejection wick", () => {
    // The transcript's stop sat exactly ON the obvious swing (4667.29). With a
    // normal gold ATR (~10) the buffer pushes it past the wick that tagged it.
    const buffered = applyStopSafetyBuffer({
      direction: "sell",
      stopLoss: STOP,
      atr: 10,
      price: ENTRY,
    });
    assert.equal(buffered.buffered, true);
    assert.ok(
      buffered.stopLoss > WICK_HIGH,
      `buffered stop ${buffered.stopLoss} must clear the ${WICK_HIGH} rejection wick`,
    );
  });

  it("keeps a stop the producer already placed beyond the margin", () => {
    const already = applyStopSafetyBuffer({
      direction: "sell",
      stopLoss: 4675.0,
      structuralLevel: STOP,
      atr: 10,
      price: ENTRY,
    });
    assert.equal(already.buffered, false);
    assert.equal(already.stopLoss, 4675.0);
  });
});

test("the entry is recorded in the recommendations section and counts in performance", async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  const userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["transcript@replay.com", "x", "user", "active"],
  );
  const store = await import("@/lib/recommendations/recommendationStore");

  const created = await store.createTrackedRecommendation({
    ...(await gatedTrackedPlan(userId, {
      planType: "conditional",
      analysisId: "transcript-replay-1",
      symbol: "XAUUSD",
    })),
    id: "transcript-sell-1",
    userId,
    chatId: "c-transcript",
    symbol: "XAUUSD",
    interval: "15m",
    direction: "sell",
    entryType: "confirmation_close",
    entry: ENTRY,
    stopLoss: STOP,
    targets: TARGETS,
    invalidationLevel: STOP,
    invalidationMode: "close",
    activationRule: REJECTION_RULE,
    triggerCondition:
      "وصول السعر إلى 4658.78 ثم رفضه: اختراق بالذيل وإغلاق شمعة 15د تحته",
    validityCandles: 8,
    status: "pending_entry",
    outcome: "pending",
    createdAt: T,
    createdCandleTime: T,
    expiresAt: T + 6 * 3_600_000,
  });
  assert.equal(created.invalidationMode, "close", "the stop's meaning must round-trip the store");
  assert.equal(created.activationRule?.kind, "rejection_confirmed");

  // ── Sweep 1: the rejection happens. Same evaluator the tracker calls. ──
  const sweep1 = evaluateRecommendation({
    recommendation: created,
    candles: [CREATION, RISE, INTO_ZONE, REJECTION, FALL],
    now: T + 5 * BAR,
  });
  assert.equal(sweep1.status, "triggered");
  const afterEntry = await store.updateTrackedRecommendation(userId, created.id, {
    status: sweep1.status,
    outcome: sweep1.outcome,
    triggeredAt: sweep1.triggeredAt,
    effectiveEntry: sweep1.effectiveEntry,
    tp1HitAt: sweep1.tp1HitAt,
    tp2HitAt: sweep1.tp2HitAt,
    tp3HitAt: sweep1.tp3HitAt,
    slHitAt: sweep1.slHitAt,
    activationEvidence: sweep1.activationEvidence,
    lastCheckedAt: T + 5 * BAR,
  });
  assert.equal(afterEntry?.status, "triggered", "the recommendations section shows it ENTERED");
  assert.ok(afterEntry?.triggeredAt, "the activation timestamp is recorded");
  assert.equal(afterEntry?.effectiveEntry, REJECTION_CLOSE, "the honest fill is persisted");

  // The activation is an announced lifecycle event — the journal's entry line.
  const events = deriveLifecycleEvents({
    recommendation: {
      id: created.id,
      symbol: created.symbol,
      direction: created.direction,
      entry: created.entry,
      stopLoss: created.stopLoss,
      invalidationLevel: created.invalidationLevel,
      status: sweep1.status,
      outcome: sweep1.outcome,
    },
    previousStatus: "pending_entry",
    nextStatus: sweep1.status,
    currentPrice: FALL.close,
    atr: 8,
  });
  assert.ok(
    events.some((e) => e.type === "activated"),
    "the pending→triggered transition must announce the entry",
  );

  // Performance counts it as an ACTIVE entered trade, not a pending hope.
  const activeRows = await store.listActiveTrackedRecommendations({ userId });
  const activeRow = activeRows.find((r) => r.id === created.id);
  assert.equal(activeRow?.status, "triggered");
  const statsActive = computeRecommendationStats(activeRows);
  assert.equal(statsActive.active, 1, "an entered trade counts as active in performance");
  assert.equal(statsActive.pending, 0);

  // ── Sweep 2: the fall pays TP1, then a close through the stop ends it. ──
  const TP1_TOUCH = candle(5, 4646.3, 4648.0, 4610.5, 4615.0); // TP1 4613.23 touched
  const CLOSE_STOP = candle(6, 4615.0, 4670.0, 4614.0, 4668.0); // 15m close above 4667.29
  const sweep2 = evaluateRecommendation({
    recommendation: activeRow!,
    candles: [CREATION, RISE, INTO_ZONE, REJECTION, FALL, TP1_TOUCH, CLOSE_STOP],
    now: T + 7 * BAR,
  });
  assert.equal(sweep2.status, "tp1_hit");
  assert.equal(sweep2.outcome, "win_tp1", "TP1 banked before the stop-confirming close — a WIN");
  await store.updateTrackedRecommendation(userId, created.id, {
    status: sweep2.status,
    outcome: sweep2.outcome,
    triggeredAt: sweep2.triggeredAt,
    effectiveEntry: sweep2.effectiveEntry,
    tp1HitAt: sweep2.tp1HitAt,
    slHitAt: sweep2.slHitAt,
    lastCheckedAt: T + 7 * BAR,
  });

  const allRows = await store.listTrackedRecommendations(userId);
  const finalRow = allRows.find((r) => r.id === created.id);
  assert.equal(finalRow?.outcome, "win_tp1");
  assert.ok(finalRow?.triggeredAt, "the win is a TRIGGERED completion, not an untriggered expiry");
  const statsFinal = computeRecommendationStats(allRows);
  assert.equal(statsFinal.wins, 1, "the transcript's trade lands in performance as a win");
  assert.equal(statsFinal.completedTriggered, 1);
  assert.equal(statsFinal.breakdown.win_tp1, 1);
});

test("the chat/Telegram status reply reports the same activation, in profit, no vendor", async () => {
  // Dynamic import: this adapter's chain reaches @/lib/db via the session store.
  const { evaluateRecommendationStatus } = await import(
    "@/lib/agent/recommendation/evaluateRecommendationStatus"
  );
  type ActiveRecommendation = import("@/lib/agent/sessionRecommendation").ActiveRecommendation;
  type AgentMarketContext =
    import("@/lib/agent/marketContext/buildAgentMarketContext").AgentMarketContext;

  const recommendation: ActiveRecommendation = {
    id: "transcript-sell-chat",
    analysisId: "transcript-replay-chat",
    sessionId: "s-transcript",
    symbol: "XAUUSD",
    interval: "15m",
    createdAt: T,
    createdCandleTime: T,
    direction: "sell",
    planType: "conditional",
    entryType: "confirmation_close",
    entry: ENTRY,
    stopLoss: STOP,
    invalidationMode: "close",
    targets: TARGETS,
    status: "pending_entry",
    activationRule: REJECTION_RULE,
    invalidationLevel: STOP,
    invalidationRule: "إغلاق شمعة 15د فوق 4667.29 يُبطل الفكرة نهائياً",
    validityCandles: 8,
    summary: "",
    keyReasons: [],
    riskWarnings: [],
    publicReasoningSummary: [],
  };
  const market = {
    symbol: "XAUUSD",
    interval: "15m",
    higherInterval: "1h",
    currentPrice: FALL.close,
    atr: 8,
    currentTfCandles: [CREATION, RISE, INTO_ZONE, REJECTION, FALL],
    higherTfCandles: [],
    dailyCandles: [],
  } as unknown as AgentMarketContext;

  const evaluation = evaluateRecommendationStatus({ recommendation, market });
  assert.equal(evaluation.status, "triggered", "same verdict as the canonical tracker");
  assert.equal(evaluation.triggered, true);
  assert.equal(evaluation.invalidated, false);
  assert.equal(evaluation.effectiveEntry, REJECTION_CLOSE, "entered at the honest fill");
  assert.ok(
    (evaluation.pointsFromEntry ?? 0) > 0,
    "sell filled at 4655 with price at 4646.3 — the reply must say IN PROFIT",
  );
  assert.equal(evaluation.invalidationMode, "close");
  assert.match(evaluation.reason, /دخلت الصفقة عند 4655/, "cites the fill price");
  assert.match(evaluation.reason, /لا يُضرب إلا بإغلاق/, "explains the close-confirmed stop");
  assert.doesNotMatch(evaluation.reason, /OANDA|أواندا|مصدر البيانات/i, "no vendor naming");
});
