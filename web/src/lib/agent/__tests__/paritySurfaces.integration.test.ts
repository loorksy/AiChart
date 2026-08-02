import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-parity-surfaces-"));
process.env.DB_PATH = join(dir, "parity-surfaces.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "parity-surfaces-secret";
process.env.VISION_DECISION_V1 = "0";
process.env.FEATURE_AGENT_SKILLS = "0";
process.env.CASE_MEMORY_V1 = "0";
process.env.AGENT_RUN_TRACE_V1 = "0";
process.env.AUTO_EXECUTION_STAGE = "off";
delete process.env.DATABASE_URL;
delete process.env.OANDA_API_TOKEN;

let db: typeof import("@/lib/db");
let candleRepository: typeof import("@/lib/candles/candleRepository");
let orchestrator: typeof import("@/lib/agent/orchestrator");
let parity: typeof import("@/lib/agent/parityLog");
let revisions: typeof import("@/lib/recommendations/canonical/revisions");
let userId = 0;
/**
 * Frozen to a mid-session Wednesday (2026-07-15 12:00 UTC), NOT Date.now().
 * The live clock made this suite fail every weekend: with forex closed, the
 * "last closed bar" anchor steps back to Friday's close instead of 15 minutes,
 * so the two surfaces were compared against different bars. A fixture that
 * changes meaning by the day of the week tests the calendar, not parity.
 */
const fixtureNow = Date.UTC(2026, 6, 15, 12, 0, 0);

/**
 * `skipWeekends` is off for the daily series on purpose.
 *
 * A weekday-only DAILY seed reads as roughly 28% of calendar days missing, so
 * the coverage check could classify this fixture as a data outage and return an
 * operational blocker instead of a decision — and whether it did depended on
 * the wall clock at the moment the suite ran. This test is about Platform/MCP
 * parity, so its data is seeded contiguously and the gap detector is left to
 * the suites that actually test it.
 */
function fixtureBars(
  count: number,
  intervalMs: number,
  endAt: number,
  start: number,
  skipWeekends = true,
) {
  const times: number[] = [];
  let cursor = endAt;
  while (times.length < count) {
    const day = new Date(cursor).getUTCDay();
    if (!skipWeekends || times.length === 0 || (day !== 0 && day !== 6)) {
      times.push(cursor);
    }
    cursor -= intervalMs;
  }
  return times.reverse().map((time, index) => {
    const center = start + index * 0.000015 + Math.sin(index / 4) * 0.00035;
    return {
      time,
      open: center - 0.00004,
      high: center + 0.0002,
      low: center - 0.0002,
      close: center + 0.00004,
      volume: 100 + index,
      complete: true,
    };
  });
}

function modelAnswer(user: string): string {
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
      throw new Error("reference candles did not produce grounded levels");
    }
    selectedTradeCandidateId = null;
  }

  return JSON.stringify({
    direction,
    planType: "conditional",
    selectedTradeCandidateId,
    proposedLevels,
    timeframeRoles: { lead: "15m", context: "1h", timing: "15m" },
    activationCondition: "Wait for a confirming close at the selected entry.",
    invalidationRule: "A close beyond the selected stop invalidates the plan.",
    alternativeScenario: "Switch only after the opposite structure break.",
    validityCandles: 7,
    confidence: 0.64,
    summary: "The shared fixture produced one decision on one evidence snapshot.",
    keyReasons: ["The same stored candles and evidence menu were used."],
    riskWarnings: ["The plan remains conditional."],
    publicReasoningSummary: ["Both surfaces read the same immutable bundle."],
    decisionTrace: {
      hypotheses: [
        {
          scenario: "Continuation from the selected level.",
          supporting: ["Stored structure and a grounded candidate."],
          opposing: ["Execution cost can still widen."],
        },
      ],
      chosenBecause: "It has the strongest grounded structure.",
      planTypeBecause: "Price must confirm before entry.",
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
  parity = await import("@/lib/agent/parityLog");
  revisions = await import("@/lib/recommendations/canonical/revisions");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["parity-surfaces@example.com", "x", "user", "active"],
  );
  await candleRepository.upsertCandles(
    "EURUSD",
    "15m",
    fixtureBars(650, 15 * 60_000, fixtureNow, 1.08),
  );
  await candleRepository.upsertCandles(
    "EURUSD",
    "1h",
    fixtureBars(260, 60 * 60_000, fixtureNow, 1.075),
  );
  await candleRepository.upsertCandles(
    "EURUSD",
    "1d",
    fixtureBars(130, 24 * 60 * 60_000, fixtureNow, 1.06, false),
  );
});

describe("reference Platform/MCP surface parity", () => {
  it("runs both real surface labels on one frozen Evidence Snapshot with unexplained=0", async () => {
    const originalNow = Date.now;
    Date.now = () => fixtureNow;
    try {
      const run = (surface: "platform" | "mcp") =>
        orchestrator.runUnifiedChartAgent({
          surface,
          purpose: "reevaluation",
          // One frozen snapshot replayed through both surfaces — the session
          // clock of the day the suite runs is not part of the comparison.
          timeBasis: "replay" as const,
          userMessage: "Analyze EURUSD from the shared parity fixture.",
          chartContext: {
            symbol: "EURUSD",
            interval: "15m",
            dataSource: "oanda",
          },
          requestContext: {
            requestId: `parity-${surface}`,
            userId,
            emitActivity: () => {},
          },
          account: null,
          canExecute: false,
          synthesizerDeps: {
            configured: true,
            callModel: async (_system, user) => modelAnswer(user),
          },
        });

      const platformResult = await run("platform");
      const mcpResult = await run("mcp");
      assert.ok(platformResult.evidenceSnapshot);
      assert.deepEqual(
        mcpResult.evidenceSnapshot,
        platformResult.evidenceSnapshot,
        "surface metadata leaked into the brain's Evidence Snapshot",
      );
      assert.deepEqual(mcpResult.recommendation, platformResult.recommendation);

      const evidenceHash = revisions.evidenceFingerprint(
        platformResult.evidenceSnapshot!,
      );
      assert.equal(evidenceHash.length, 64, "the audit key must retain full SHA-256");
      type StoredPair = {
        evidence_hash: string;
        platform_decision: string;
        mcp_decision: string;
        direction: string;
        plan_type: string;
        entry_zone: string;
        stop: string;
        targets: string;
        execution_state: string;
        difference_classification: string | null;
        explained: number | string;
        explanation: string;
      };
      let pairs: StoredPair[] = [];
      for (let attempt = 0; attempt < 50 && pairs.length === 0; attempt += 1) {
        pairs = await db.query<StoredPair>(
          `SELECT evidence_hash, platform_decision, mcp_decision, direction,
                  plan_type, entry_zone, stop, targets, execution_state,
                  difference_classification, explained, explanation
             FROM decision_parity_comparisons
            WHERE evidence_hash = ?`,
          [evidenceHash],
        );
        if (!pairs.length) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }

      assert.equal(pairs.length, 1, "the paired parity audit row was not materialized");
      const pair = pairs[0]!;
      assert.equal(pair.evidence_hash, evidenceHash);
      assert.deepEqual(
        JSON.parse(pair.platform_decision),
        JSON.parse(pair.mcp_decision),
      );
      for (const column of [
        "direction",
        "plan_type",
        "entry_zone",
        "stop",
        "targets",
        "execution_state",
      ] as const) {
        const values = JSON.parse(pair[column]) as {
          platform: unknown;
          mcp: unknown;
        };
        assert.deepEqual(values.platform, values.mcp, `${column} diverged`);
      }
      assert.equal(pair.difference_classification, null);
      assert.equal(Number(pair.explained), 1);
      assert.ok(pair.explanation);

      const observations = await db.query<{ count: number | string }>(
        "SELECT COUNT(*) AS count FROM decision_parity WHERE evidence_hash = ?",
        [evidenceHash],
      );
      assert.equal(Number(observations[0]!.count), 2);

      const report = await parity.buildParityReport();
      assert.equal(report.totals.compared, 1);
      assert.equal(report.totals.identical, 1);
      assert.equal(report.totals.unexplained, 0);
      assert.equal(report.entries[0]?.evidenceHash, evidenceHash);
      assert.equal(report.entries[0]?.comparison.identical, true);
      // The anchor is the last CLOSED bar. The fixture's final bar opens AT
      // fixtureNow, so it is still forming at decision time and the anchor
      // steps back one 15m span — the same candle the MCP create path names,
      // which is exactly what lets the two surfaces pair.
      assert.equal(report.entries[0]?.marketTimestamp, fixtureNow - 15 * 60_000);
      assert.deepEqual(report.entries[0]?.timeframeSet, ["15m", "1h", "1d"]);

      const { metrics } = await import("@/lib/metrics");
      const metricValue = async (name: string) => {
        const metric = metrics.registry.getSingleMetric(name);
        assert.ok(metric, `${name} was not registered`);
        const data = await metric.get();
        return data.values.reduce((sum, value) => sum + Number(value.value), 0);
      };
      assert.equal(await metricValue("aichart_parity_comparisons"), 1);
      assert.equal(await metricValue("aichart_parity_differences"), 0);
      assert.equal(await metricValue("aichart_parity_unexplained"), 0);
    } finally {
      Date.now = originalNow;
    }
  });
});
