import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentMarketContext } from "../../marketContext/buildAgentMarketContext";
import type { AgentRunContext } from "../../types";
import { buildCandleEnvelope } from "../candleEnvelope";
import type { NeutralMarketEvidence } from "../buildNeutralEvidence";
import { resolveContextTimeframes } from "../contextTimeframes";
import { buildMarketSnapshot, assertSnapshotImageFreshness } from "../marketSnapshot";
import type { ModelTradePlan } from "../modelTradePlan";
import {
  setCachedModelRegistry,
  type ModelCapabilityRecord,
} from "../modelRegistry";
import { callOpenAIResponses, ResponsesApiError } from "../openaiResponses";
import { runModelFirstDecision } from "../runModelFirstDecision";
import { validateTradePlanTechnically } from "../validatedTradePlan";

function candles(count = 90, start = 1_700_000_000) {
  return Array.from({ length: count }, (_, index) => ({
    time: start + index * 60,
    open: 1.1 + index * 0.00001,
    high: 1.101 + index * 0.00001,
    low: 1.099 + index * 0.00001,
    close: 1.1005 + index * 0.00001,
    volume: 100 + index,
  }));
}

function registryRecord(): ModelCapabilityRecord {
  return {
    id: "gpt-5.6-sol",
    displayName: "GPT-5.6 Sol",
    available: true,
    enabled: true,
    responsesApi: true,
    vision: true,
    structuredOutputs: true,
    reasoning: true,
    supportedReasoningValues: ["high", "medium", "low"],
    streaming: false,
    tools: false,
    contextTokens: null,
    deprecated: false,
    costTier: "standard",
    eligibleAsDefault: true,
    lastVerifiedAt: Date.now(),
    probeErrors: [],
  };
}

function validPlan(): ModelTradePlan {
  return {
    decision: "buy",
    activation: "immediate",
    marketRegime: "trend",
    marketThesis: "Fresh price structure supports a bounded long scenario.",
    primaryTimeframe: "5m",
    contextTimeframes: ["15m", "1h", "4h"],
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
    alternativeScenario: "Wait if the entry zone fails.",
    confidence: 0.7,
    dataTimestamp: new Date().toISOString(),
    summary: "A technically bounded buy plan from the supplied evidence.",
    keyReasons: ["Fresh quote", "Aligned structure"],
    warnings: [],
  };
}

function context(signal?: AbortSignal): AgentRunContext {
  return {
    requestId: "test-request",
    userId: 1,
    signal,
    emitActivity: () => {},
    emitDebug: () => {},
  };
}

describe("immutable snapshot contracts", () => {
  it("rejects non-chronological candle envelopes", () => {
    assert.throws(() =>
      buildCandleEnvelope({
        timeframe: "5m",
        role: "primary",
        source: "oanda",
        candles: [candles(2)[1]!, candles(2)[0]!],
      }),
    );
  });

  it("freezes actual bid/ask and complete canonical context metadata", () => {
    const primary = "5m";
    const { context: contextFrames } = resolveContextTimeframes(primary);
    const series = candles();
    const market = {
      symbol: "EURUSD",
      interval: primary,
      higherInterval: contextFrames[0],
      currentPrice: 9.99,
      spread: 0.5,
      marketOpen: true,
      currentTfCandles: series,
      higherTfCandles: series,
      dailyCandles: series,
      dataQuality: {
        sufficient: true,
        coverage: {
          timeframes: [{ interval: primary, source: "warehouse+oanda" }],
        },
      },
      sync: { ok: true },
    } as unknown as AgentMarketContext;
    const contextCandles = Object.fromEntries(
      contextFrames.map((timeframe) => [timeframe, series]),
    );
    const now = Date.now();
    const snapshot = buildMarketSnapshot({
      userId: 1,
      market,
      contextCandles,
      quote: {
        bid: 1.1001,
        ask: 1.1003,
        mid: 1.1002,
        spread: 0.0002,
        marketTimestamp: now,
        quoteAgeMs: 0,
        source: "oanda",
        pricePrecision: 5,
        tickSize: 0.00001,
      },
    });
    assert.equal(snapshot.bid, 1.1001);
    assert.equal(snapshot.ask, 1.1003);
    assert.equal(snapshot.mid, 1.1002);
    assert.equal(snapshot.envelopes.length, 1 + contextFrames.length);
    assert.ok(snapshot.envelopes.every((item) => item.source === "oanda"));
    assert.ok(snapshot.envelopes.every((item) => item.capturedAt === snapshot.serverTimestamp));
    assert.equal(
      assertSnapshotImageFreshness(
        snapshot,
        Object.fromEntries(snapshot.envelopes.map((item) => [item.timeframe, now])),
        now,
      ).ok,
      true,
    );
  });
});

describe("model-first outbound safety", () => {
  it("blocks contaminated evidence before provider I/O", async () => {
    setCachedModelRegistry([registryRecord()]);
    let calls = 0;
    const outcome = await runModelFirstDecision(
      context(),
      {
        evidence: { selectedCandidate: { id: "forbidden" } } as unknown as NeutralMarketEvidence,
        images: [],
        preferredModelId: "gpt-5.6-sol",
        preferredReasoning: "high",
        currentPrice: 1.1002,
        quoteAgeMs: 0,
        tickSize: 0.0001,
      },
      {
        apiKey: "test-key",
        callResponses: async () => {
          calls += 1;
          throw new Error("must not be called");
        },
      },
    );
    assert.equal(calls, 0);
    assert.equal(outcome.usedLLM, false);
    assert.deepEqual(outcome.candidateLeakKeys, ["selectedCandidate"]);
  });

  it("propagates cancellation and records safe provider metadata", async () => {
    setCachedModelRegistry([registryRecord()]);
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const plan = validPlan();
    const outcome = await runModelFirstDecision(
      context(controller.signal),
      {
        evidence: { snapshot: { symbol: "EURUSD" } } as unknown as NeutralMarketEvidence,
        images: [],
        preferredModelId: "gpt-5.6-sol",
        preferredReasoning: "high",
        currentPrice: 1.1005,
        quoteAgeMs: 0,
        tickSize: 0.0001,
      },
      {
        apiKey: "test-key",
        callResponses: async (params) => {
          observedSignal = params.signal;
          return {
            text: JSON.stringify(plan),
            responseId: "resp_test",
            model: params.model,
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
            rawStatus: 200,
          };
        },
      },
    );
    assert.equal(observedSignal, controller.signal);
    assert.equal(outcome.result?.decision, "buy");
    assert.deepEqual(outcome.responseIds, ["resp_test"]);
    assert.deepEqual(outcome.tokenUsage, {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    });
  });

  it("rejects a provider model substitution", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          id: "resp_substitution",
          model: "gpt-5.5",
          output_text: '{"ok":true}',
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    try {
      await assert.rejects(
        () =>
          callOpenAIResponses({
            apiKey: "test-key",
            model: "gpt-5.6-sol",
            inputText: "test",
            store: false,
          }),
        (error: unknown) =>
          error instanceof ResponsesApiError && error.code === "model_substitution",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("complete technical validator", () => {
  it("accepts a fresh, aligned two-target plan", () => {
    const result = validateTradePlanTechnically({
      plan: validPlan(),
      currentPrice: 1.1005,
      quoteAgeMs: 0,
      tickSize: 0.0001,
    });
    assert.equal(result.executionReady, true);
    assert.deepEqual(result.technicalErrors, []);
  });

  it("does not rewrite trade activation and reports missing technical fields", () => {
    const plan = {
      ...validPlan(),
      activation: "none" as const,
      invalidation: null,
      targets: [{ price: 1.102, reason: "Only one" }],
    };
    const result = validateTradePlanTechnically({
      plan,
      currentPrice: null,
      quoteAgeMs: null,
      tickSize: 0.0001,
    });
    assert.equal(result.activation, "none");
    assert.equal(result.executionReady, false);
    assert.ok(result.technicalErrors.includes("trade_activation_missing"));
    assert.ok(result.technicalErrors.includes("two_targets_required"));
    assert.ok(result.technicalErrors.includes("invalidation_missing"));
    assert.ok(result.technicalErrors.includes("quote_missing"));
  });
});
