import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAnalysisFingerprint,
  runQuantAnalysis,
  type QuantAnalysisDeps,
} from "@/lib/quantAgent/analysis/runAnalysis";
import { formatMemoryContext } from "@/lib/quantAgent/analysis/prompt";
import type { QuantAnalysisCollection } from "@/lib/quantAgent/analysis/collect";
import type { AnthropicResponse } from "@/lib/llm";
import type {
  CreateQuantAnalysisInput,
  QuantAnalysisMemoryRow,
} from "@/lib/quantAgent/analysisStore";
import type {
  QuantAnalysisFinalizeResult,
  QuantAnalysisRecord,
  QuantAnalysisScoreResult,
  ScoreQuantAnalysisParams,
} from "@/lib/quantAgent/types";

/**
 * Memory recall end to end through the orchestrator's injection seam: stored
 * outcomes become score-call candidates, the ranked matches come back and land
 * in the prompt WITH their outcomes, and the fingerprint that makes the next
 * recall possible is written on the row.
 *
 * The claim being tested is the one the feature is for — that the agent's
 * answer is shaped by what happened last time — so what is asserted is the
 * prompt text, not just that a function was called.
 */

const LEG = { label: "neutral", qualifier: "neutral", score: 0 };

const INDICATORS = {
  current_price: 4342.23,
  rsi: { value: 64.4 },
  macd: { signal: "bearish" },
  moving_averages: { trend: "uptrend" },
  bollinger: { upper: 4358.33, lower: 4313.79 },
  price_position: 65.5,
  volume_ratio: 1.02,
  volatility_pct: 0.27,
  atr: 11.64,
  change_24h: -0.01,
  volatility_level: "medium",
  trend: "uptrend",
  suggested_stop_loss: 4318.95,
  suggested_take_profit: 4377.15,
};

const MODEL_JSON = {
  decision: "SELL",
  confidence: 71,
  summary: "s",
  analysis: { technical: "t", fundamental: "f", sentiment: "m" },
  entry_price: 4342.23,
  stop_loss: 4359.34,
  take_profit: 4310.11,
  position_size_pct: 8,
  timeframe: "short",
  key_reasons: ["r"],
  risks: ["k"],
  technical_score: 38,
  fundamental_score: 50,
  sentiment_score: 50,
};

function collection(): QuantAnalysisCollection {
  return {
    symbol: "XAUUSD",
    market: "forex",
    interval: "1h",
    primaryTimeframe: "1H",
    timeframes: {
      "1H": { indicators: INDICATORS, collection_meta: { ok: true, degraded_inputs: [] } },
    },
    primary: {
      label: "1H",
      interval: "1h",
      barCount: 300,
      indicators: INDICATORS,
      collectionMeta: { ok: true, degraded_inputs: [] },
    },
    promptFacts: {
      currentPrice: 4342.23,
      change24hPct: -0.01,
      rsiValue: 64.4,
      rsiSignal: "neutral",
      macdSignal: "bearish",
      macdTrend: "death_cross",
      maTrend: "uptrend",
      volatilityLevel: "medium",
      volatilityPct: 0.27,
      atr: 11.64,
      pricePosition: 65.5,
      support: 4313.79,
      resistance: 4358.33,
      pivot: 4336.04,
      suggestedStopLoss: 4318.95,
      suggestedTakeProfit: 4377.15,
      riskRewardRatio: 1.49,
    },
    missing: ["fundamentals", "news_sentiment", "macro", "analysis_memory"],
    degraded: false,
    warnings: [],
    primaryAsOfMs: 1_754_700_000_000,
    priceBasis: {
      status: "unlinked",
      delta: 0,
      brokerMid: null,
      referencePrice: 4342.23,
      divergenceRatio: null,
      suppressLevels: false,
    },
  };
}

function memoryRow(overrides: Partial<QuantAnalysisMemoryRow> = {}): QuantAnalysisMemoryRow {
  return {
    id: "mem-1",
    decision: "SELL",
    wasCorrect: true,
    priceAtAnalysis: 4400.5,
    realisedReturnPct: -4.11,
    indicators: {
      rsi: 63,
      macd_signal: "bearish",
      ma_trend: "uptrend",
      volatility_level: "medium",
      price_position: 66,
    },
    ...overrides,
  };
}

function llmResponse(text: string): AnthropicResponse {
  return {
    id: "msg_test",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

interface Harness {
  deps: Partial<QuantAnalysisDeps>;
  writes: CreateQuantAnalysisInput[];
  scoreCalls: ScoreQuantAnalysisParams[];
  prompts: string[];
  /** The system prompt, where the DATA AVAILABILITY block lives. */
  systemPrompts: string[];
}

function harness(options: {
  memory?: QuantAnalysisMemoryRow[];
  memoryError?: Error;
  similarPatterns?: QuantAnalysisScoreResult["similarPatterns"];
}): Harness {
  const writes: CreateQuantAnalysisInput[] = [];
  const scoreCalls: ScoreQuantAnalysisParams[] = [];
  const prompts: string[] = [];
  const systemPrompts: string[] = [];

  const deps: Partial<QuantAnalysisDeps> = {
    collectInputs: async () => collection(),
    listRecentAnalyses: async () => {
      if (options.memoryError) throw options.memoryError;
      return options.memory ?? [];
    },
    scoreAnalysis: async (_ctx, params) => {
      scoreCalls.push(params);
      return {
        objectiveByTimeframe: {
          "1H": {
            technicalScore: -12.4,
            fundamentalScore: 50,
            sentimentScore: null,
            macroScore: null,
            overallScore: -12.4,
            decision: "HOLD",
            absScore: 12.4,
          },
        },
        consensus: {
          decision: "HOLD",
          score: -8,
          agreement: 0.75,
          timeframeCount: 2,
          votes: { BUY: 0, SELL: 1, HOLD: 1 },
          weightedScore: -8,
        },
        trendOutlook: { h24: { ...LEG }, d3: { ...LEG }, w1: { ...LEG }, m1: { ...LEG } },
        similarPatterns: options.similarPatterns ?? [],
        dataQuality: { degraded: false, confidencePenalty: 0, missing: [] },
      } satisfies QuantAnalysisScoreResult;
    },
    finalizeAnalysis: async (_ctx, params) =>
      ({
        ...params.llmOutput,
        applied: {
          entry_clamped: false,
          stop_defaulted: false,
          take_profit_defaulted: false,
          decision_overridden_by: null,
          confidence_adjusted_by: 0,
          indicator_conflicts: [],
        },
      }) as QuantAnalysisFinalizeResult,
    callLLM: (async (params: { system: string; messages: { content: string }[] }) => {
      prompts.push(params.messages.map((message) => message.content).join("\n"));
      systemPrompts.push(params.system);
      return llmResponse(JSON.stringify(MODEL_JSON));
    }) as unknown as QuantAnalysisDeps["callLLM"],
    createAnalysis: async (_userId, input) => {
      writes.push(input);
      return { id: "row-1", createdAt: new Date().toISOString() } as QuantAnalysisRecord;
    },
  };

  return { deps, writes, scoreCalls, prompts, systemPrompts };
}

test("memory: stored outcomes are pushed to the scorer and the ranked match reaches the prompt", async () => {
  const h = harness({
    memory: [memoryRow(), memoryRow({ id: "mem-2", wasCorrect: false })],
    similarPatterns: [
      { id: "mem-1", similarityScore: 1.09, decision: "SELL", wasCorrect: true },
      { id: "mem-2", similarityScore: 0.82, decision: "BUY", wasCorrect: false },
    ],
  });

  await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: h.deps });

  // The candidate pool went out in the wire shape the service validates.
  assert.deepEqual(h.scoreCalls[0]!.memoryCandidates, [
    {
      id: "mem-1",
      decision: "SELL",
      was_correct: true,
      indicators: memoryRow().indicators,
    },
    {
      id: "mem-2",
      decision: "SELL",
      was_correct: false,
      indicators: memoryRow().indicators,
    },
  ]);

  const prompt = h.prompts[0]!;
  assert.match(prompt, /Historical patterns with similar conditions:/);
  assert.match(
    prompt,
    /- Decision: SELL at \$4400\.5 \(Outcome: Correct, Return: -4\.11%\)/,
    "the outcome clause is upstream's format, and the return is the measured one",
  );
  assert.match(prompt, /- Decision: BUY at \$4400\.5 \(Outcome: Incorrect, Return: -4\.11%\)/);
});

test("memory: a stored analysis records the fingerprint that makes the NEXT recall possible", async () => {
  const h = harness({});

  await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: h.deps });

  assert.deepEqual(h.writes[0]!.indicators, {
    rsi: 64.4,
    macd_signal: "bearish",
    ma_trend: "uptrend",
    volatility_level: "medium",
    price_position: 65.5,
  });
});

test("memory: an empty history says so, and stored-but-unmatched says something different", async () => {
  const empty = harness({});
  await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: empty.deps });
  assert.match(empty.prompts[0]!, /No prior analyses of this symbol are stored yet\./);

  // Candidates existed; none cleared quant-agent's similarity floor. Saying
  // "nothing is stored" here would be false.
  const unmatched = harness({ memory: [memoryRow()], similarPatterns: [] });
  await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: unmatched.deps });
  assert.match(unmatched.prompts[0]!, /none matched the current conditions closely enough/);
  assert.doesNotMatch(unmatched.prompts[0]!, /No prior analyses of this symbol are stored yet\./);
});

test("memory: a failed recall is reported as a failure, never as an empty history", async () => {
  const h = harness({ memoryError: new Error("db down") });

  const record = await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: h.deps });

  assert.match(h.prompts[0]!, /Memory retrieval failed\./);
  assert.deepEqual(h.scoreCalls[0]!.memoryCandidates, []);
  // The analysis itself still completes — a memory read must never take it down.
  assert.equal(record.id, "row-1");
  assert.equal(h.writes[0]!.status, "completed");
});

test("memory: `analysis_memory` stops being reported as unavailable once something is recalled", async () => {
  const recalled = harness({
    memory: [memoryRow()],
    similarPatterns: [{ id: "mem-1", similarityScore: 1.09, decision: "SELL", wasCorrect: true }],
  });
  await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: recalled.deps });
  assert.ok(!recalled.writes[0]!.dataQuality!.missing.includes("analysis_memory"));
  assert.ok(
    recalled.writes[0]!.dataQuality!.missing.includes("macro"),
    "the components that really have no source are still reported",
  );

  const none = harness({});
  await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: none.deps });
  assert.ok(
    none.writes[0]!.dataQuality!.missing.includes("analysis_memory"),
    "an empty recall is still an absence and is still reported as one",
  );
});

/**
 * The prompt must not both hand the model a validated outcome and tell it that
 * validated outcomes are unavailable. It did exactly that until the `missing`
 * list passed to `buildAnalysisPrompt` got the same `withRecalledMemory` filter
 * the stored row already had — the DATA AVAILABILITY block said "NOT AVAILABLE
 * ... validated outcomes of past analyses. You must NOT ... recall ... any of
 * the unavailable inputs", two paragraphs above "(Outcome: Correct, Return:
 * -4.11%)". That instructs the model to disregard the whole memory feature, and
 * no assertion on the memory block alone can catch it.
 */
test("memory: a recalled outcome is not simultaneously declared unavailable in the prompt", async () => {
  const recalled = harness({
    memory: [memoryRow()],
    similarPatterns: [{ id: "mem-1", similarityScore: 1.09, decision: "SELL", wasCorrect: true }],
  });
  await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: recalled.deps });

  const system = recalled.systemPrompts[0]!;
  const user = recalled.prompts[0]!;
  assert.match(user, /\(Outcome: Correct, Return: -4\.11%\)/, "precondition: an outcome was recalled");
  for (const [where, text] of [
    ["system", system],
    ["user", user],
  ] as const) {
    assert.doesNotMatch(
      text,
      /validated outcomes of past analyses/,
      `the ${where} prompt still declares recalled memory unavailable`,
    );
    // The components that really have no source must still be declared.
    assert.match(text, /news headlines and news sentiment/);
  }
});

test("memory: with nothing recalled, the prompt still declares past outcomes absent", async () => {
  const none = harness({});
  await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: none.deps });
  assert.match(none.systemPrompts[0]!, /validated outcomes of past analyses/);
  assert.match(none.prompts[0]!, /validated outcomes of past analyses/);
});

test("buildAnalysisFingerprint uses upstream's neutral defaults for missing string axes", () => {
  assert.deepEqual(
    buildAnalysisFingerprint({
      current_price: null,
      rsi: null,
      macd: null,
      moving_averages: null,
      bollinger: null,
      price_position: null,
      volume_ratio: null,
      volatility_pct: null,
      atr: null,
      change_24h: null,
    }),
    {
      rsi: null,
      macd_signal: "neutral",
      ma_trend: "sideways",
      volatility_level: "normal",
      price_position: null,
    },
  );
});

test("formatMemoryContext keeps upstream's truthiness test on the return clause", () => {
  const zeroReturn = formatMemoryContext([
    { decision: "HOLD", currentPrice: 100, wasCorrect: true, actualReturnPct: 0 },
  ]);
  assert.match(zeroReturn, /- Decision: HOLD at \$100 \(Outcome: Correct\)$/m);
  assert.doesNotMatch(zeroReturn, /Return:/, "upstream's `if p.get(...)` drops an exact 0.0");

  const nullReturn = formatMemoryContext([
    { decision: "BUY", currentPrice: 100, wasCorrect: false, actualReturnPct: null },
  ]);
  assert.match(nullReturn, /\(Outcome: Incorrect\)$/m);
});
