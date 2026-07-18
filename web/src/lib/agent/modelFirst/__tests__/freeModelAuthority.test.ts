/**
 * Free-model authority + candidate-domain absence tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toFinalResult,
  runModelFirstDecision,
} from "../runModelFirstDecision";
import { validateModelTradePlan } from "../validatedTradePlan";
import { buildDrawingsFromValidatedModelPlan } from "../buildDrawingsFromValidatedModelPlan";
import { failureKindToDecision } from "../technicalOutcome";
import { buildAgentFallbackResult } from "../../fallback";
import type { ModelTradePlan } from "../modelTradePlan";
import type { AgentRunContext } from "../../types";
import { MODEL_FIRST_SYSTEM_PROMPT } from "../modelTradePlan";

const ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
const WEB_SRC = join(ROOT, "web", "src");

const PROHIBITED = [
  "TradeCandidate",
  "buildTradeCandidates",
  "selectedTradeCandidateId",
  "tradeCandidates",
  "candidatesResult",
  "selectedCandidate",
  "runRiskAgent",
  "runFinalDecisionSynthesizer",
  "runTradingPlaybook",
  "scorePoi",
  "MODEL_FIRST_MODE",
  "getModelFirstMode",
];

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (
        name === "node_modules" ||
        name === ".next" ||
        name === "dist" ||
        name === "__tests__" ||
        name === "__fixtures__"
      ) {
        continue;
      }
      walkTsFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(name) && !name.includes(".test.")) out.push(full);
  }
  return out;
}

function plan(over: Partial<ModelTradePlan> = {}): ModelTradePlan {
  return {
    decision: "buy",
    activation: "immediate",
    marketRegime: "trend",
    marketThesis: "Bullish structure with a clear continuation path on the primary timeframe.",
    primaryTimeframe: "5m",
    contextTimeframes: ["15m", "1h"],
    timeframeAnalysis: [
      { timeframe: "5m", bias: "bullish", evidence: "Higher lows" },
    ],
    entryZone: { low: 1.1, high: 1.101, preferred: 1.1005 },
    invalidation: 1.0985,
    stopLoss: 1.099,
    targets: [
      { price: 1.102, reason: "First objective" },
      { price: 1.103, reason: "Second objective" },
    ],
    requiredConfirmation: null,
    pathToEntry: null,
    alternativeScenario: "Fade if zone fails.",
    confidence: 0.72,
    summary: "Buy plan from independent model analysis of the supplied evidence.",
    keyReasons: ["structure", "momentum"],
    warnings: [],
    dataTimestamp: new Date().toISOString(),
    ...over,
  };
}

describe("repository candidate-domain scan (active web/src)", () => {
  it("rejects prohibited trade-proposal identifiers in active source", () => {
    const files = walkTsFiles(WEB_SRC);
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(WEB_SRC, file).replace(/\\/g, "/");
      // Leak-detector source intentionally lists forbidden authority key names.
      if (rel.endsWith("modelFirst/buildNeutralEvidence.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const token of PROHIBITED) {
        if (text.includes(token)) hits.push(`${rel}:${token}`);
      }
    }
    assert.deepEqual(hits, [], `prohibited tokens remain:\n${hits.join("\n")}`);
  });

  it("prompt never mentions candidates", () => {
    assert.doesNotMatch(MODEL_FIRST_SYSTEM_PROMPT, /candidate/i);
  });
});

describe("free-model decision distribution", () => {
  it("model BUY remains BUY", () => {
    const p = plan({ decision: "buy", activation: "immediate" });
    const validated = validateModelTradePlan({ plan: p, currentPrice: 1.1005 });
    const result = toFinalResult(p, validated);
    assert.equal(result.decision, "buy");
    assert.equal(result.recommendation.action, "buy");
  });

  it("model SELL remains SELL", () => {
    const p = plan({
      decision: "sell",
      activation: "immediate",
      entryZone: { low: 1.1, high: 1.101, preferred: 1.1005 },
      stopLoss: 1.102,
      invalidation: 1.1025,
      targets: [
        { price: 1.099, reason: "tp1" },
        { price: 1.098, reason: "tp2" },
      ],
    });
    const validated = validateModelTradePlan({ plan: p, currentPrice: 1.1005 });
    const result = toFinalResult(p, validated);
    assert.equal(result.decision, "sell");
  });

  it("conditional BUY remains BUY not WAIT", () => {
    const p = plan({
      decision: "buy",
      activation: "conditional",
      requiredConfirmation: "Touch demand and hold",
    });
    const validated = validateModelTradePlan({ plan: p, currentPrice: 1.105 });
    const result = toFinalResult(p, validated);
    assert.equal(result.decision, "buy");
    assert.equal(result.recommendation.activationClass, "conditional");
    assert.notEqual(result.decision, "wait");
  });

  it("conditional SELL remains SELL not WAIT", () => {
    const p = plan({
      decision: "sell",
      activation: "conditional",
      entryZone: { low: 1.1, high: 1.101, preferred: 1.1005 },
      stopLoss: 1.102,
      invalidation: 1.1025,
      targets: [
        { price: 1.099, reason: "tp1" },
        { price: 1.098, reason: "tp2" },
      ],
      requiredConfirmation: "Reject supply",
    });
    const result = toFinalResult(
      p,
      validateModelTradePlan({ plan: p, currentPrice: 1.09 }),
    );
    assert.equal(result.decision, "sell");
  });

  it("model WAIT remains WAIT only from successful model output", () => {
    const p = plan({
      decision: "wait",
      activation: "none",
      entryZone: { low: null, high: null, preferred: null },
      stopLoss: null,
      invalidation: null,
      targets: [],
      summary: "No sufficient edge on the primary timeframe right now.",
      marketThesis: "Mixed structure without a clear path.",
    });
    const result = toFinalResult(
      p,
      validateModelTradePlan({ plan: p, currentPrice: 1.1 }),
    );
    assert.equal(result.decision, "wait");
  });

  it("invalid BUY levels keep BUY with execution withheld", () => {
    const p = plan({
      decision: "buy",
      stopLoss: 1.2,
      targets: [{ price: 1.0, reason: "wrong" }],
    });
    const validated = validateModelTradePlan({ plan: p, currentPrice: 1.1005 });
    assert.equal(validated.decision, "buy");
    assert.equal(validated.executionReady, false);
    const result = toFinalResult(p, validated);
    assert.equal(result.decision, "buy");
    assert.equal(result.recommendation.executionReadiness, "technically_unavailable");
    assert.equal(result.recommendation.entry, undefined);
  });

  it("invalid SELL levels keep SELL — not WAIT", () => {
    const p = plan({
      decision: "sell",
      stopLoss: 1.0,
      targets: [{ price: 1.2, reason: "wrong" }],
    });
    const validated = validateModelTradePlan({ plan: p, currentPrice: 1.1005 });
    const result = toFinalResult(p, validated);
    assert.equal(result.decision, "sell");
    assert.notEqual(result.decision, "wait");
  });

  it("model timeout maps to model_timeout not WAIT", () => {
    assert.equal(failureKindToDecision("timeout"), "model_timeout");
    const fb = buildAgentFallbackResult("timeout", [], "en", "model_timeout");
    assert.equal(fb.decision, "model_timeout");
    assert.notEqual(fb.decision, "wait");
  });

  it("invalid model output maps to invalid_model_output not WAIT", () => {
    assert.equal(
      failureKindToDecision("invalid_model_output"),
      "invalid_model_output",
    );
  });

  it("drawings come from model plan without trade-proposal IDs", () => {
    const p = plan();
    const validated = validateModelTradePlan({ plan: p, currentPrice: 1.1005 });
    const result = toFinalResult(p, validated);
    const drawings = buildDrawingsFromValidatedModelPlan({
      decision: result,
      validated,
      lastCandleTime: 1,
    });
    assert.equal(drawings.shouldDraw, true);
    assert.equal(drawings.drawingIntent, "trade_setup");
    assert.ok(drawings.selectedZones.length >= 1);
  });

  it("runModelFirstDecision never calls a trade-proposal fallback on failure", async () => {
    const ctx: AgentRunContext = {
      requestId: "t",
      emitActivity: () => {},
    };
    const out = await runModelFirstDecision(
      ctx,
      {
        evidence: {
          scalpingContext: {} as never,
          snapshot: {
            snapshotId: "s",
            symbol: "EURUSD",
            primaryTimeframe: "5m",
            timeframeSelectionSource: "user",
            contextTimeframes: [],
            bid: 1.1,
            ask: 1.101,
            mid: 1.1005,
            spread: 0.001,
            quoteAgeMs: 100,
            serverTimestamp: Date.now(),
            sourceHealth: "ok",
            fingerprint: "f",
          },
          candleEnvelopes: [],
          narrative: null,
          structure: null,
          liquidity: null,
          supplyDemand: null,
          mtf: null,
          news: { newsRisk: "unknown", reason: "n/a", upcomingEvents: [] },
          chartDrawingsSummary: [],
          visionImages: [],
          userMessage: "analyze",
        } as never,
        images: [],
        currentPrice: 1.1,
      },
      {
        apiKey: "sk-test",
        callResponses: async () => {
          throw new Error("provider down");
        },
      },
    );
    assert.equal(out.result, null);
    assert.ok(out.failureKind);
    assert.notEqual(out.failureKind, undefined);
  });
});
