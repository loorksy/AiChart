import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDefaultAnalysisStructure,
  parseAnalysisOutput,
  runQuantAnalysis,
  type QuantAnalysisDeps,
} from "@/lib/quantAgent/analysis/runAnalysis";
import {
  resolveAnalysisTimeframes,
  toAnalysisTimeframeLabel,
  fromAnalysisTimeframeLabel,
  type QuantAnalysisCollection,
} from "@/lib/quantAgent/analysis/collect";
import type { AnthropicResponse } from "@/lib/llm";
import type {
  CreateQuantAnalysisInput,
} from "@/lib/quantAgent/analysisStore";
import type {
  FinalizeQuantAnalysisParams,
  QuantAnalysisFinalizeResult,
  QuantAnalysisRecord,
  QuantAnalysisScoreResult,
  ScoreQuantAnalysisParams,
} from "@/lib/quantAgent/types";

/**
 * The analysis orchestrator, driven entirely through its injection seam — no
 * candle feed, no quant-agent service, no model. What is under test is the
 * wiring: that quant-agent's numbers reach the row unaltered, that a model
 * which returns prose cannot take the run down, and that a run with no data
 * refuses instead of guessing.
 */

const LEG = { label: "neutral", qualifier: "neutral", score: 0 };

function collection(overrides: Partial<QuantAnalysisCollection> = {}): QuantAnalysisCollection {
  const indicators = {
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
    volatility_level: "low",
    trend: "uptrend",
    suggested_stop_loss: 4318.95,
    suggested_take_profit: 4377.15,
  };
  return {
    symbol: "XAUUSD",
    market: "forex",
    interval: "1h",
    primaryTimeframe: "1H",
    timeframes: {
      "1H": { indicators, collection_meta: { ok: true, degraded_inputs: [] } },
      "4H": { indicators, collection_meta: { ok: true, degraded_inputs: [] } },
    },
    primary: {
      label: "1H",
      interval: "1h",
      barCount: 300,
      indicators,
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
      volatilityLevel: "low",
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
    ...overrides,
  };
}

function scoreResult(overrides: Partial<QuantAnalysisScoreResult> = {}): QuantAnalysisScoreResult {
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
      timeframeCount: 4,
      votes: { BUY: 0, SELL: 1, HOLD: 3 },
      weightedScore: -8,
    },
    trendOutlook: { h24: { ...LEG }, d3: { ...LEG }, w1: { ...LEG }, m1: { ...LEG } },
    similarPatterns: [],
    dataQuality: { degraded: false, confidencePenalty: 0, missing: [] },
    ...overrides,
  };
}

const MODEL_JSON = {
  decision: "SELL",
  confidence: 71,
  summary: "Momentum is rolling over into resistance.",
  analysis: {
    technical: "RSI 64.4 with a bearish MACD cross.",
    fundamental: "No fundamental data was available.",
    sentiment: "No news or macro data was available.",
  },
  entry_price: 4342.23,
  stop_loss: 4359.34,
  take_profit: 4310.11,
  position_size_pct: 8,
  timeframe: "short",
  key_reasons: ["Bearish MACD cross", "Price in the upper band"],
  risks: ["The uptrend could resume"],
  technical_score: 38,
  fundamental_score: 50,
  sentiment_score: 50,
};

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
  finalizeCalls: FinalizeQuantAnalysisParams[];
  llmCalls: number;
}

function harness(options: {
  collection?: QuantAnalysisCollection;
  score?: QuantAnalysisScoreResult;
  scoreError?: Error;
  collectError?: Error;
  finalizeError?: Error;
  llmText?: string;
  llmError?: Error;
} = {}): Harness {
  const writes: CreateQuantAnalysisInput[] = [];
  const scoreCalls: ScoreQuantAnalysisParams[] = [];
  const finalizeCalls: FinalizeQuantAnalysisParams[] = [];
  const state = { llmCalls: 0 };

  const deps: Partial<QuantAnalysisDeps> = {
    collectInputs: async () => {
      if (options.collectError) throw options.collectError;
      return options.collection ?? collection();
    },
    scoreAnalysis: async (_ctx, params) => {
      scoreCalls.push(params);
      if (options.scoreError) throw options.scoreError;
      return options.score ?? scoreResult();
    },
    finalizeAnalysis: async (_ctx, params) => {
      finalizeCalls.push(params);
      if (options.finalizeError) throw options.finalizeError;
      // The real service echoes llm_output back with `applied` attached; the
      // stub does the same so the mapping under test is the real mapping.
      return {
        ...params.llmOutput,
        applied: {
          entry_clamped: false,
          stop_defaulted: false,
          take_profit_defaulted: false,
          decision_overridden_by: null,
          confidence_adjusted_by: 0,
          indicator_conflicts: [],
        },
      } as QuantAnalysisFinalizeResult;
    },
    callLLM: (async () => {
      state.llmCalls += 1;
      if (options.llmError) throw options.llmError;
      return llmResponse(options.llmText ?? JSON.stringify(MODEL_JSON));
    }) as QuantAnalysisDeps["callLLM"],
    listRecentAnalyses: async () => [],
    createAnalysis: async (_userId, input) => {
      writes.push(input);
      return {
        id: `analysis-${writes.length}`,
        market: input.market,
        symbol: input.symbol,
        interval: input.interval,
        status: input.status,
        decision: input.decision ?? null,
        confidence: input.confidence ?? null,
        currentPrice: input.currentPrice ?? null,
        entryPrice: input.entryPrice ?? null,
        stopLoss: input.stopLoss ?? null,
        takeProfit: input.takeProfit ?? null,
        positionSizePct: input.positionSizePct ?? null,
        horizon: input.horizon ?? null,
        summary: input.summary ?? null,
        scores: input.scores ?? {
          technical: null,
          fundamental: null,
          sentiment: null,
          overall: null,
        },
        consensus: input.consensus ?? null,
        outlook: input.outlook ?? null,
        detail: input.detail ?? null,
        reasons: input.reasons ?? [],
        risks: input.risks ?? [],
        dataQuality: input.dataQuality ?? null,
        error: input.error ?? null,
        createdAt: new Date().toISOString(),
      } satisfies QuantAnalysisRecord;
    },
  };

  return {
    deps,
    writes,
    scoreCalls,
    finalizeCalls,
    get llmCalls() {
      return state.llmCalls;
    },
  };
}

test("timeframe expansion reproduces QuantDinger's consensus set plus both outlook horizons", () => {
  // 1H -> +4H,1D; 4H -> +1D; 1D -> +4H; anything else -> +1D,4H. Then 1W and
  // 1H are appended when absent — they feed the outlook and dilute agreement,
  // which is upstream's behaviour, not an accident.
  assert.deepEqual(resolveAnalysisTimeframes("1h").labels, ["1H", "4H", "1D", "1W"]);
  assert.deepEqual(resolveAnalysisTimeframes("4h").labels, ["4H", "1D", "1W", "1H"]);
  assert.deepEqual(resolveAnalysisTimeframes("1d").labels, ["1D", "4H", "1W", "1H"]);
  assert.deepEqual(resolveAnalysisTimeframes("15m").labels, ["15M", "1D", "4H", "1W", "1H"]);
  assert.equal(resolveAnalysisTimeframes("15m").primaryLabel, "15M");

  // A daily frame is always in the set, which is what makes the 24h change
  // measurable no matter how fine the primary timeframe is.
  for (const interval of ["1m", "5m", "1h", "4h", "1d", "1w"]) {
    assert.ok(
      resolveAnalysisTimeframes(interval).labels.includes("1D"),
      `${interval} still collects a daily series`,
    );
  }
});

test("the month frame does not collide with the one-minute weight bucket", () => {
  // quant-agent's base-weight table reads "1M" as ONE MINUTE (0.75, below 3M
  // and 5M). AiChart's "1M" is one MONTH, so a naive toUpperCase would hand a
  // monthly frame a scalping weight.
  assert.equal(toAnalysisTimeframeLabel("1m"), "1M", "the minute frame keeps upstream's label");
  assert.equal(toAnalysisTimeframeLabel("1M"), "1MO", "the month frame gets its own label");
  assert.equal(fromAnalysisTimeframeLabel("1M"), "1m");
  assert.equal(fromAnalysisTimeframeLabel("1MO"), "1M");
  for (const [interval, label] of [
    ["1h", "1H"],
    ["4h", "4H"],
    ["1d", "1D"],
    ["1w", "1W"],
    ["15m", "15M"],
  ] as const) {
    assert.equal(toAnalysisTimeframeLabel(interval), label);
    assert.equal(fromAnalysisTimeframeLabel(label), interval);
  }
});

test("parse ladder: clean JSON, fenced JSON, prose-wrapped JSON, then the default structure", () => {
  const fallback = buildDefaultAnalysisStructure(100);

  assert.equal(parseAnalysisOutput('{"decision":"BUY"}', fallback).decision, "BUY");
  assert.equal(
    parseAnalysisOutput('```json\n{"decision":"SELL"}\n```', fallback).decision,
    "SELL",
    "a fenced block is unwrapped",
  );
  assert.equal(
    parseAnalysisOutput('Here you go:\n{"decision":"HOLD"}\nHope that helps.', fallback).decision,
    "HOLD",
    "the first { to the last } is retried when a straight parse fails",
  );

  const broken = parseAnalysisOutput("I cannot produce JSON right now.", fallback);
  assert.equal(broken.decision, "HOLD", "the default structure is conservative by construction");
  assert.equal(broken.confidence, 50);
  assert.equal(broken.stop_loss, 95, "current_price * 0.95");
  assert.equal(broken.take_profit, 105, "current_price * 1.05");
  assert.match(broken.report ?? "", /Failed to parse analysis result JSON/);
  assert.match(broken.report ?? "", /I cannot produce JSON right now\./);
  assert.equal(broken.analysis, undefined, "upstream's default structure carries no analysis key");
});

test("default structure carries no fabricated market reading", () => {
  const fallback = buildDefaultAnalysisStructure(2000);
  assert.equal(fallback.entry_price, 2000);
  assert.equal(fallback.technical_score, 50);
  assert.equal(fallback.fundamental_score, 50);
  assert.equal(fallback.sentiment_score, 50);
  assert.deepEqual(fallback.key_reasons, ["Unable to analyze"]);
  assert.deepEqual(fallback.risks, ["Analysis error"]);
});

test("happy path: quant-agent's numbers reach the stored row unaltered", async () => {
  const h = harness();
  const record = await runQuantAnalysis({
    userId: 7,
    symbol: "XAUUSD",
    market: "forex",
    interval: "1h",
    locale: "en",
    deps: h.deps,
  });

  assert.equal(h.writes.length, 1, "exactly one row is written per run");
  assert.equal(record.status, "completed");
  assert.equal(record.decision, "SELL");
  assert.equal(record.confidence, 71);
  assert.equal(record.currentPrice, 4342.23);
  assert.equal(record.entryPrice, 4342.23);
  assert.equal(record.stopLoss, 4359.34);
  assert.equal(record.takeProfit, 4310.11);
  assert.equal(record.positionSizePct, 8);
  assert.equal(record.horizon, "short");
  assert.deepEqual(record.reasons, ["Bearish MACD cross", "Price in the upper band"]);
  assert.deepEqual(record.risks, ["The uptrend could resume"]);
  assert.deepEqual(record.detail, MODEL_JSON.analysis);
  assert.equal(record.error, null);

  // The consensus block is copied, never recomputed here.
  assert.deepEqual(record.consensus, {
    decision: "HOLD",
    score: -8,
    agreement: 0.75,
    timeframeCount: 4,
  });
  assert.deepEqual(record.outlook, {
    h24: { ...LEG },
    d3: { ...LEG },
    w1: { ...LEG },
    m1: { ...LEG },
  });

  // `overall` is the primary frame's -100..+100 objective score remapped:
  // 50 + (-12.4 * 0.5) = 43.8 -> 44.
  assert.deepEqual(record.scores, {
    technical: 38,
    fundamental: 50,
    sentiment: 50,
    overall: 44,
  });
});

test("absent components are reported, never invented, and memory is sent empty", async () => {
  const h = harness({
    score: scoreResult({
      dataQuality: { degraded: false, confidencePenalty: 0, missing: ["news"] },
    }),
  });
  const record = await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: h.deps });

  assert.deepEqual(
    h.scoreCalls[0]!.memoryCandidates,
    [],
    "no indicator snapshot or validated outcome exists, so no candidate is offered",
  );
  assert.deepEqual(
    record.dataQuality?.missing.sort(),
    ["analysis_memory", "fundamentals", "macro", "news", "news_sentiment"],
    "web's structural absences are unioned with quant-agent's own",
  );
  assert.equal(
    record.dataQuality?.degraded,
    false,
    "a permanently absent component is not a degraded collection",
  );

  // The one honest answer about news and macro: they can never be claimed.
  assert.equal(h.finalizeCalls[0]!.hasMajorNews, false);
  assert.equal(h.finalizeCalls[0]!.hasMacroEvent, false);
  assert.deepEqual(
    h.finalizeCalls[0]!.dataQuality,
    { degraded: false, confidencePenalty: 0, missing: ["news"] },
    "the score's data quality is handed back so the confidence haircut still applies",
  );
});

test("a short collection is degraded, and quant-agent's own degradation is honoured", async () => {
  const degradedCollection = collection({ degraded: true });
  const h = harness({ collection: degradedCollection });
  const record = await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: h.deps });
  assert.equal(record.dataQuality?.degraded, true);

  const h2 = harness({
    score: scoreResult({
      dataQuality: { degraded: true, confidencePenalty: 15, missing: [] },
    }),
  });
  const record2 = await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: h2.deps });
  assert.equal(record2.dataQuality?.degraded, true);
});

test("no candles means no analysis — the run refuses instead of guessing a price", async () => {
  const empty = collection({
    primary: null,
    timeframes: {},
    promptFacts: { ...collection().promptFacts, currentPrice: null },
  });
  const h = harness({ collection: empty });
  const record = await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: h.deps });

  assert.equal(record.status, "failed");
  assert.equal(record.decision, null, "a failed run asserts no direction");
  assert.equal(record.currentPrice, null);
  assert.match(record.error ?? "", /تعذّر جلب شموع التحليل/);
  assert.equal(h.scoreCalls.length, 0, "nothing is asked of quant-agent");
  assert.equal(h.llmCalls, 0, "and the model is never billed for it");
});

test("a quant-agent failure becomes a visible failed row, not a lost run", async () => {
  const h = harness({ scoreError: new Error("Quant Agent Service is disabled") });
  const record = await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: h.deps });

  assert.equal(record.status, "failed");
  assert.equal(record.error, "Quant Agent Service is disabled");
  assert.equal(record.currentPrice, 4342.23, "what we did learn is still recorded");
  assert.equal(h.llmCalls, 0, "the model is not called once scoring is already lost");

  const h2 = harness({ finalizeError: new Error("constraint service unreachable") });
  const record2 = await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: h2.deps });
  assert.equal(record2.status, "failed");
  assert.equal(record2.error, "constraint service unreachable");
});

test("an unparseable model answer still completes, with the repair recorded on the row", async () => {
  const h = harness({ llmText: "Sorry, I would rather write an essay." });
  const record = await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: h.deps });

  assert.equal(record.status, "completed", "the deterministic layers all succeeded");
  assert.equal(record.decision, "HOLD", "the conservative default carries through");
  assert.equal(record.confidence, 50);
  assert.match(record.error ?? "", /Failed to parse analysis result JSON/);
  assert.deepEqual(
    record.detail,
    { technical: "", fundamental: "", sentiment: "" },
    "the default structure has no analysis key, so the detail strings stay empty",
  );
  assert.equal(h.llmCalls, 1, "no retry and no re-prompt — upstream has neither");
});

test("an LLM transport failure is carried forward, not thrown away", async () => {
  const h = harness({ llmError: new Error("provider overloaded") });
  const record = await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: h.deps });
  assert.equal(record.status, "completed");
  assert.match(record.error ?? "", /Analysis failed: provider overloaded/);
  assert.equal(h.finalizeCalls.length, 1, "the default structure is still constrained");
});

test("a model answer whose analysis is one string is filed under technical only", async () => {
  const h = harness({
    llmText: JSON.stringify({ ...MODEL_JSON, analysis: "One long blob of prose." }),
  });
  const record = await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: h.deps });
  assert.deepEqual(record.detail, {
    technical: "One long blob of prose.",
    fundamental: "",
    sentiment: "",
  });
});

test("an unknown decision string is coerced to HOLD, never passed through", async () => {
  const h = harness({ llmText: JSON.stringify({ ...MODEL_JSON, decision: "MOON", timeframe: "eternal" }) });
  const record = await runQuantAnalysis({ userId: 7, symbol: "XAUUSD", deps: h.deps });
  assert.equal(record.decision, "HOLD");
  assert.equal(record.horizon, null, "an unrecognised horizon is absent, not guessed");
});

test("a non-forex market is a caller error, not a stored failure", async () => {
  const h = harness();
  await assert.rejects(
    () => runQuantAnalysis({ userId: 7, symbol: "BTCUSDT", market: "crypto", deps: h.deps }),
    /الفوركس/,
  );
  assert.equal(h.writes.length, 0, "a rejected request writes no history row");
});
