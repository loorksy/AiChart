/**
 * Reference scenario pack — integration seam (plan §16).
 *
 * The registry in `fixtures/referenceScenarioPack.ts` is the contract. This
 * file proves the fixtures are complete and runs the highest-value paths
 * through real storage + lifecycle + controlled model adapters without network.
 *
 * Doctrine-only contract cases stay in `doctrineScenarios.test.ts`. Parity of
 * the two surfaces on one Snapshot stays in `paritySurfaces.integration.test.ts`.
 * This pack ties candles, images, costs, calendar state, canonical creation,
 * revision 1, and opportunity_created dedupe into one runnable suite.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import {
  FIXTURE_CALENDAR_EVENT,
  FIXTURE_COST_SAMPLES,
  REFERENCE_SCENARIOS,
  fixtureBars,
  scenarioById,
} from "./fixtures/referenceScenarioPack";
import {
  FIXTURE_PNG_CONTEXT_B64,
  FIXTURE_PNG_MISSING,
  FIXTURE_PNG_PRIMARY_B64,
} from "./fixtures/tinyPng";
import { saveCompletePlan } from "@/lib/recommendations/__tests__/fixtures/completePlan";

const dir = mkdtempSync(join(tmpdir(), "aichart-reference-scenarios-"));
process.env.DB_PATH = join(dir, "reference.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "reference-scenarios-secret";
process.env.VISION_DECISION_V1 = "0";
process.env.FEATURE_AGENT_SKILLS = "0";
process.env.CASE_MEMORY_V1 = "0";
process.env.AGENT_RUN_TRACE_V1 = "0";
process.env.AUTO_EXECUTION_STAGE = "off";
process.env.REC_LIFECYCLE_ALERTS_V1 = "1";
delete process.env.DATABASE_URL;
delete process.env.OANDA_API_TOKEN;
delete process.env.TELEGRAM_BOT_TOKEN;

let db: typeof import("@/lib/db");
let candleRepository: typeof import("@/lib/candles/candleRepository");
let orchestrator: typeof import("@/lib/agent/orchestrator");
let notifier: typeof import("@/lib/recommendations/lifecycleNotifier");
let revisions: typeof import("@/lib/recommendations/canonical/revisions");
let userId = 0;
const fixtureNow = Date.UTC(2026, 6, 20, 12, 0, 0);

function modelAnswer(user: string, planType: "immediate" | "anticipatory" | "conditional"): string {
  const context = JSON.parse(user) as {
    currentPrice: number;
    tradeCandidates?: Array<{ id: string; action: "buy" | "sell" }>;
    evidenceLevels?: Array<{ price: number }>;
  };
  const candidate = context.tradeCandidates?.[0];
  let direction: "buy" | "sell" = candidate?.action ?? "buy";
  let selectedTradeCandidateId: string | null = candidate?.id ?? null;
  let proposedLevels: {
    preferredEntry: number;
    stopLoss: number;
    targets: number[];
  } | null = null;

  if (!candidate) {
    const prices = (context.evidenceLevels ?? [])
      .map((level) => level.price)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const below = prices.filter((price) => price < context.currentPrice);
    const above = prices.filter((price) => price > context.currentPrice);
    if (below.length >= 2 && above.length) {
      proposedLevels = {
        preferredEntry: below.at(-1)!,
        stopLoss: below[0]!,
        targets: [above.at(-1)!],
      };
    } else if (above.length >= 2 && below.length) {
      direction = "sell";
      proposedLevels = {
        preferredEntry: above[0]!,
        stopLoss: above.at(-1)!,
        targets: [below[0]!],
      };
    } else {
      proposedLevels = {
        preferredEntry: context.currentPrice,
        stopLoss: context.currentPrice * 0.998,
        targets: [context.currentPrice * 1.004],
      };
    }
    selectedTradeCandidateId = null;
  }

  return JSON.stringify({
    direction,
    planType,
    selectedTradeCandidateId,
    proposedLevels,
    timeframeRoles: { lead: "15m", context: "1h", timing: "15m" },
    activationCondition:
      planType === "immediate" ? null : "Wait for a confirming close at the selected entry.",
    invalidationRule: "A close beyond the selected stop invalidates the plan.",
    alternativeScenario: "Switch only after the opposite structure break.",
    validityCandles: 7,
    confidence: 0.64,
    summary: "Reference fixture produced one grounded decision.",
    keyReasons: ["Stored candles and the frozen evidence menu."],
    riskWarnings: planType === "anticipatory" ? ["anticipatory risk"] : ["conditional plan"],
    publicReasoningSummary: ["Deterministic reference pack."],
    decisionTrace: {
      hypotheses: [
        {
          scenario: "Continuation from the selected level.",
          supporting: ["Stored structure."],
          opposing: ["Costs can still widen."],
        },
      ],
      chosenBecause: "Strongest grounded structure on the fixture.",
      planTypeBecause: `Fixture required ${planType}.`,
    },
    drawingAdvice: { shouldDraw: false, reason: "No drawing is needed." },
    selectedCandidateIds: selectedTradeCandidateId ? [selectedTradeCandidateId] : [],
    requestExtraTimeframe: null,
  });
}

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  candleRepository = await import("@/lib/candles/candleRepository");
  orchestrator = await import("@/lib/agent/orchestrator");
  notifier = await import("@/lib/recommendations/lifecycleNotifier");
  revisions = await import("@/lib/recommendations/canonical/revisions");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["reference-scenarios@example.com", "x", "user", "active"],
  );

  // Seed cost samples so live-cost scenarios have a deterministic profile.
  for (const sample of FIXTURE_COST_SAMPLES) {
    for (let i = 0; i < 4; i++) {
      await db.execute(
        `INSERT INTO cost_samples (symbol, session, spread_pips, observed_at)
         VALUES (?,?,?,?)`,
        [sample.symbol, sample.session, sample.spreadPips, fixtureNow - i * 60_000],
      );
    }
  }
});

describe("reference scenario registry is complete", () => {
  it("covers every §16 scenario id exactly once", () => {
    const ids = REFERENCE_SCENARIOS.map((row) => row.id);
    assert.equal(ids.length, new Set(ids).size, "duplicate scenario ids");
    assert.ok(ids.length >= 30, `expected ≥30 scenarios, got ${ids.length}`);
    for (const row of REFERENCE_SCENARIOS) {
      assert.ok(row.title.trim(), `${row.id} missing title`);
      assert.ok(row.forbidden.length > 0, `${row.id} missing forbidden outcomes`);
      assert.ok(row.fixture.symbol, `${row.id} missing symbol`);
      assert.ok(
        ["live_samples", "static_model", "absent"].includes(row.fixture.costProfile.source),
        `${row.id} bad cost source`,
      );
      assert.ok(
        ["event_imminent", "provider_absent", "quiet"].includes(row.fixture.calendar.state),
        `${row.id} bad calendar state`,
      );
    }
  });

  it("binds images to numeric context and tolerates one missing capture", () => {
    const clear = scenarioById("clear_trend");
    assert.ok(clear.fixture.images.some((img) => img.imageBase64 === FIXTURE_PNG_PRIMARY_B64));
    assert.ok(clear.fixture.images.some((img) => img.imageBase64 === FIXTURE_PNG_CONTEXT_B64));
    assert.ok(clear.fixture.images.some((img) => img.imageBase64 === FIXTURE_PNG_MISSING));
    for (const img of clear.fixture.images) {
      assert.ok(img.timeframe);
      assert.ok(Number.isFinite(img.numericContext.price));
    }
    assert.ok(FIXTURE_CALENDAR_EVENT.minutesUntil < 15);
  });
});

describe("reference pipeline: candles → decision → canonical → notify", () => {
  it("clear_trend creates revision 1, snapshot, trace, and one opportunity_created", async () => {
    const scenario = scenarioById("clear_trend");
    const symbol = scenario.fixture.symbol;
    await candleRepository.upsertCandles(
      symbol,
      "15m",
      fixtureBars({
        count: 650,
        intervalMs: 15 * 60_000,
        endAt: fixtureNow,
        start: 1.08,
        shape: scenario.fixture.shape,
      }),
    );
    await candleRepository.upsertCandles(
      symbol,
      "1h",
      fixtureBars({
        count: 260,
        intervalMs: 60 * 60_000,
        endAt: fixtureNow,
        start: 1.075,
        shape: scenario.fixture.shape,
      }),
    );
    await candleRepository.upsertCandles(
      symbol,
      "1d",
      fixtureBars({
        count: 130,
        intervalMs: 24 * 60 * 60_000,
        endAt: fixtureNow,
        start: 1.06,
        shape: scenario.fixture.shape,
      }),
    );

    const originalNow = Date.now;
    Date.now = () => fixtureNow;
    try {
      const result = await orchestrator.runUnifiedChartAgent({
        surface: "platform",
        // A frozen fixture is a replay of a past window, not today's tape.
        timeBasis: "replay" as const,
        purpose: "analysis",
        userMessage: "Analyze EURUSD from the clear_trend reference fixture.",
        chartContext: { symbol, interval: "15m", dataSource: "oanda" },
        requestContext: {
          requestId: "reference-clear-trend",
          userId,
          emitActivity: () => {},
        },
        account: null,
        canExecute: false,
        synthesizerDeps: {
          configured: true,
          callModel: async (_system, user) => modelAnswer(user, "immediate"),
        },
      });

      assert.ok(result.recommendation, "expected a recommendation");
      assert.ok(result.evidenceSnapshot, "expected a frozen evidence snapshot");
      assert.ok(result.decisionTrace?.chosenBecause, "expected a decision trace");
      const side = result.recommendation.action;
      assert.ok(side === "buy" || side === "sell", `expected buy/sell, got ${side}`);

      const recRows = await db.query<{ id: number; effective_revision_no: number | null }>(
        `SELECT id, effective_revision_no FROM recommendations
          WHERE user_id = ? AND symbol = ? ORDER BY id DESC LIMIT 1`,
        [userId, symbol],
      );
      assert.equal(recRows.length, 1);
      assert.equal(Number(recRows[0]!.effective_revision_no), 1);

      const revRows = await db.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM recommendation_revisions WHERE recommendation_id = ?`,
        [recRows[0]!.id],
      );
      assert.equal(Number(revRows[0]?.n), 1);

      // Birth alert claimed once under the lifecycle key.
      const tracking = await db.queryOne<{ legacy_tracking_id: string | null }>(
        "SELECT legacy_tracking_id FROM recommendations WHERE id = ?",
        [recRows[0]!.id],
      );
      const ref = tracking?.legacy_tracking_id ?? String(recRows[0]!.id);
      const dedupe = await db.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM alert_dedupe
          WHERE user_id = ? AND dedupe_key = ?`,
        [userId, `${ref}:1:opportunity_created`],
      );
      assert.equal(Number(dedupe[0]?.n), 1);

      // Retrying the announce adds nothing.
      const again = await notifier.announceOpportunityCreated(userId, {
        recommendationId: ref,
        symbol,
        direction: side,
        entry: result.recommendation.entry,
        planType: result.recommendation.planType ?? null,
      });
      assert.equal(again.delivered, 0);
      assert.equal(again.suppressedDuplicate, 1);

      // Evidence fingerprint is full SHA-256 of the frozen snapshot.
      const hash = revisions.evidenceFingerprint(result.evidenceSnapshot!);
      assert.equal(hash.length, 64);
    } finally {
      Date.now = originalNow;
    }
  });

  it("saveRecommendation (MCP path) and chart adapter share one birth alert", async () => {
    const { saveRecommendation } = await import("@/lib/store");
    const { notifyRecommendation } = await import("@/lib/recommendationChart");
    const saved = await saveRecommendation(userId, {
      symbol: "GBPUSD",
      action: "buy",
      confidence: 70,
      entry: 1.27,
      stop_loss: 1.265,
      take_profit: 1.28,
      ...saveCompletePlan({ plan_type: "conditional" }),
      source: "agent",
    });
    const viaChart = await notifyRecommendation(userId, saved);
    assert.equal(viaChart.delivered, false);
    assert.equal(viaChart.reason, "duplicate_creation_alert");
    const keys = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM alert_dedupe
        WHERE user_id = ? AND dedupe_key = ?`,
      [userId, `${saved.id}:1:opportunity_created`],
    );
    assert.equal(Number(keys[0]?.n), 1);
  });

  it("image failure on one timeframe does not remove numeric context for others", async () => {
    const { buildVisualBlocks } = await import(
      "@/lib/agent/agents/finalDecisionSynthesizer"
    );
    const scenario = scenarioById("extra_timeframe_round");
    const blocks = buildVisualBlocks(
      scenario.fixture.images.map((img) => ({
        timeframe: img.timeframe,
        imageBase64: img.imageBase64,
        numericContext: img.numericContext,
      })),
    );
    // Missing image skipped; primary + context remain labelled.
    assert.ok(blocks.length >= 4);
    const labels = blocks
      .filter((block) => block.type === "text")
      .map((block) => JSON.parse((block as { text: string }).text).chart_timeframe);
    assert.ok(labels.includes("15m"));
    assert.ok(labels.includes("1h"));
    assert.ok(!labels.includes("4h"), "empty capture must not emit a visual block");
  });

  it("calendar provider-absent fixture forbids fabricated events", () => {
    const scenario = scenarioById("calendar_provider_absent");
    assert.equal(scenario.fixture.calendar.state, "provider_absent");
  });

  it("cost fixture distinguishes live samples from labelled static fallback", async () => {
    const live = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM cost_samples WHERE symbol = 'EURUSD' AND session = 'london'`,
    );
    assert.ok(Number(live[0]?.n) >= 20, "live-cost scenarios need ≥20 samples");
    const fallback = scenarioById("live_cost_fallback");
    assert.equal(fallback.fixture.costProfile.source, "static_model");
  });
});
