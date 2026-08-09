/**
 * The Quant Agent's LLM trading-analysis orchestrator (Wave 1).
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/services/fast_analysis.py` (`analyze`, the
 * collect → prompt → LLM → constrain → persist pipeline) plus the
 * fence-strip/substring repair ladder and `default_structure` from
 * `app/services/llm.py:1400-1442`.
 *
 * What changed, and why:
 *
 *  - THE SPLIT. Upstream is one process that fetches data, calls the model and
 *    computes every score. `quant-agent/` here has no outbound network at all,
 *    so the pipeline is cut in two: web collects the candles, calls the LLM and
 *    persists; quant-agent owns every number — the objective scores, the
 *    multi-timeframe consensus, the trend outlook, the price-level constraint,
 *    the indicator veto and the consensus override. This file never adjusts a
 *    price level or a decision itself; when it looks like it is deciding
 *    something, it is copying a field quant-agent returned.
 *  - NO ENSEMBLE, NO ASYNC JOB, NO IN-FLIGHT LOCK HERE. Upstream's optional
 *    multi-model vote and its Celery/thread submission path are not ported;
 *    the route owns the one in-flight guard this needs.
 *  - ONE WRITE. Upstream inserts a pending row, finalises it, and then deletes
 *    the duplicate row `analyze()` wrote on its own. This writes exactly one
 *    row, at the end, success or failure.
 *  - A FAILED RUN IS STILL A ROW. Upstream's route surfaces failures as HTTP
 *    500 plus a `fail_pending_task` row. Here the pipeline never throws past
 *    this function for a data/service/model failure: it persists
 *    `status: "failed"` with the reason and returns it, because the history
 *    surface is built to show a failed analysis and silently losing the
 *    attempt is worse than showing why it did not work.
 */
import { randomUUID } from "node:crypto";
import { DEFAULT_LOCALE, type AppLocale } from "@/lib/i18n";
import { callLLM, type AnthropicResponse } from "@/lib/llm";
import { createLogger } from "@/lib/logger";
import { normalizeInterval } from "@/lib/intervals";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { finalizeQuantAnalysis, scoreQuantAnalysis } from "../client";
import {
  createQuantAnalysis,
  listRecentQuantAnalysesForSymbol,
  type CreateQuantAnalysisInput,
} from "../analysisStore";
import type {
  FinalizeQuantAnalysisParams,
  QuantAgentCallerContext,
  QuantAnalysisDecision,
  QuantAnalysisFinalizeResult,
  QuantAnalysisLlmOutput,
  QuantAnalysisRecord,
  QuantAnalysisScoreResult,
  ScoreQuantAnalysisParams,
} from "../types";
import {
  collectQuantAnalysisInputs,
  type CollectQuantAnalysisInputsOptions,
  type QuantAnalysisCollection,
} from "./collect";
import { buildAnalysisPrompt, formatMemoryContext } from "./prompt";

const log = createLogger("quant_agent:analysis");

/**
 * Upstream sends `DEFAULT_MAX_TOKENS = 16_384`. `clampMaxTokens` in
 * `lib/anthropic.ts` caps every request in this codebase at 4096, so asking
 * for more is silently trimmed — this states the real ceiling instead of
 * pretending to a budget the transport will not honour.
 */
const ANALYSIS_MAX_TOKENS = 4096;

const MEMORY_RECALL_LIMIT = 3;

/** Injection seam — mirrors `QuantAgentChatDeps` so tests can stub every edge. */
export interface QuantAnalysisDeps {
  collectInputs: (
    options: CollectQuantAnalysisInputsOptions,
  ) => Promise<QuantAnalysisCollection>;
  scoreAnalysis: (
    context: QuantAgentCallerContext,
    params: ScoreQuantAnalysisParams,
  ) => Promise<QuantAnalysisScoreResult>;
  finalizeAnalysis: (
    context: QuantAgentCallerContext,
    params: FinalizeQuantAnalysisParams,
  ) => Promise<QuantAnalysisFinalizeResult>;
  callLLM: typeof callLLM;
  listRecentAnalyses: (
    userId: number,
    symbol: string,
    limit: number,
  ) => Promise<QuantAnalysisRecord[]>;
  createAnalysis: (
    userId: number,
    input: CreateQuantAnalysisInput,
  ) => Promise<QuantAnalysisRecord>;
}

export const defaultQuantAnalysisDeps: QuantAnalysisDeps = {
  collectInputs: collectQuantAnalysisInputs,
  scoreAnalysis: scoreQuantAnalysis,
  finalizeAnalysis: finalizeQuantAnalysis,
  callLLM,
  listRecentAnalyses: listRecentQuantAnalysesForSymbol,
  createAnalysis: createQuantAnalysis,
};

function extractText(res: AnthropicResponse): string {
  return res.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * `default_structure` (`fast_analysis.py:996-1010`), verbatim — including the
 * absence of an `analysis` key, which is what makes the three detail strings
 * come out empty when parsing failed.
 */
export function buildDefaultAnalysisStructure(currentPrice: number): QuantAnalysisLlmOutput {
  return {
    decision: "HOLD",
    confidence: 50,
    summary: "Analysis failed",
    entry_price: currentPrice,
    stop_loss: currentPrice * 0.95,
    take_profit: currentPrice * 1.05,
    position_size_pct: 10,
    timeframe: "medium",
    key_reasons: ["Unable to analyze"],
    risks: ["Analysis error"],
    technical_score: 50,
    fundamental_score: 50,
    sentiment_score: 50,
  };
}

/**
 * `safe_call_llm`'s repair ladder (`llm.py:1400-1442`), step for step:
 * strip a leading ``` fence (and a trailing one), parse; on a parse failure
 * retry on the substring from the first `{` to the last `}`; if that also
 * fails, return `default_structure` with the raw output recorded under
 * `report`. There is deliberately NO retry and NO re-prompt — upstream has
 * neither, and a second call on a model that just emitted prose is a second
 * bill for the same answer.
 */
export function parseAnalysisOutput(
  responseText: string,
  defaultStructure: QuantAnalysisLlmOutput,
): QuantAnalysisLlmOutput {
  let cleanText = responseText.trim();
  if (cleanText.startsWith("```")) {
    const firstNewline = cleanText.indexOf("\n");
    if (firstNewline !== -1) cleanText = cleanText.slice(firstNewline + 1);
    if (cleanText.endsWith("```")) cleanText = cleanText.slice(0, -3);
  }
  cleanText = cleanText.trim();

  try {
    return JSON.parse(cleanText) as QuantAnalysisLlmOutput;
  } catch {
    const start = responseText.indexOf("{");
    const end = responseText.lastIndexOf("}") + 1;
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(responseText.slice(start, end)) as QuantAnalysisLlmOutput;
      } catch {
        // Falls through to the default structure below, exactly as upstream's
        // bare `except: pass` does.
      }
    }
    return {
      ...defaultStructure,
      report: `Failed to parse analysis result JSON. Raw output (partial): ${
        responseText ? responseText.slice(0, 500) : "N/A"
      }`,
    };
  }
}

const DECISIONS: readonly QuantAnalysisDecision[] = ["BUY", "SELL", "HOLD"];

function coerceDecision(value: unknown): QuantAnalysisDecision {
  const upper = String(value ?? "").toUpperCase();
  return (DECISIONS as readonly string[]).includes(upper)
    ? (upper as QuantAnalysisDecision)
    : "HOLD";
}

function coerceHorizon(value: unknown): "short" | "medium" | "long" | null {
  const lower = String(value ?? "").toLowerCase();
  return lower === "short" || lower === "medium" || lower === "long" ? lower : null;
}

function clampScore(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function finiteOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coerceStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/**
 * `detailed_analysis` string-coercion guard (`fast_analysis.py:1234-1239`):
 * a model that returned `analysis` as one string gets it filed under
 * `technical`, with the other two left empty rather than duplicated.
 */
function coerceDetail(
  value: QuantAnalysisLlmOutput["analysis"],
): { technical: string; fundamental: string; sentiment: string } {
  if (typeof value === "string") {
    return { technical: value, fundamental: "", sentiment: "" };
  }
  return {
    technical: value?.technical ?? "",
    fundamental: value?.fundamental ?? "",
    sentiment: value?.sentiment ?? "",
  };
}

/**
 * `_calculate_overall_score` (`fast_analysis.py:1727-1750`) — the branch that
 * always wins in practice: the primary timeframe's −100..+100 objective score
 * remapped onto the 0..100 scale the four score bars share.
 */
function overallScoreFrom(objectiveOverall: number | null): number | null {
  if (objectiveOverall == null || !Number.isFinite(objectiveOverall)) return null;
  return Math.max(0, Math.min(100, Math.round(50 + objectiveOverall * 0.5)));
}

export interface RunQuantAnalysisInput {
  userId: number;
  symbol: string;
  market?: string;
  interval?: string;
  locale?: AppLocale;
  requestId?: string;
  /** Partial overrides for tests; production passes nothing. */
  deps?: Partial<QuantAnalysisDeps>;
}

export class QuantAnalysisInputError extends Error {}

/**
 * Runs one analysis end to end and returns the stored row.
 *
 * Throws only for a caller mistake (unsupported market, blank symbol). Every
 * runtime failure past that point becomes a persisted `failed` row.
 */
export async function runQuantAnalysis(
  input: RunQuantAnalysisInput,
): Promise<QuantAnalysisRecord> {
  const deps = { ...defaultQuantAnalysisDeps, ...input.deps };
  const marketErr = rejectNonForexMarket(input.market);
  if (marketErr) throw new QuantAnalysisInputError(marketErr);
  const market = resolveActiveMarket(input.market ?? DEFAULT_MARKET);
  const interval = normalizeInterval(input.interval ?? "1h");
  const symbol = input.symbol.trim();
  if (!symbol) throw new QuantAnalysisInputError("رمز غير صالح.");
  const locale = input.locale ?? DEFAULT_LOCALE;
  const requestId = input.requestId ?? randomUUID();
  const context: QuantAgentCallerContext = { userId: input.userId, requestId };

  const persistFailure = async (
    reason: string,
    partial: Partial<CreateQuantAnalysisInput> = {},
  ): Promise<QuantAnalysisRecord> => {
    log.warn("quant_agent.analysis.failed", { symbol, interval, requestId, reason });
    return deps.createAnalysis(input.userId, {
      market,
      symbol,
      interval,
      status: "failed",
      error: reason,
      ...partial,
    });
  };

  let collection: QuantAnalysisCollection;
  try {
    collection = await deps.collectInputs({ symbol, market, interval });
  } catch (error) {
    return persistFailure(error instanceof Error ? error.message : String(error));
  }

  const currentPrice = collection.promptFacts.currentPrice;
  const primaryIndicators =
    collection.timeframes[collection.primaryTimeframe]?.indicators ??
    collection.primary?.indicators ??
    null;
  if (currentPrice == null || primaryIndicators == null) {
    // No price means no analysis. Upstream would happily prompt with a price
    // of 0 and let the ±10% clamp collapse every level onto zero; refusing is
    // the only honest answer when the feed produced nothing.
    return persistFailure("تعذّر جلب شموع التحليل لهذا الرمز والإطار الزمني.", {
      dataQuality: { degraded: true, missing: collection.missing },
    });
  }

  let score: QuantAnalysisScoreResult;
  try {
    score = await deps.scoreAnalysis(context, {
      market,
      symbol: collection.symbol,
      primaryTimeframe: collection.primaryTimeframe,
      currentPrice,
      timeframes: collection.timeframes,
      // Empty by construction: nothing in Wave 1 stores an indicator snapshot
      // or a validated outcome, so there is no candidate to score similarity
      // against. Reported through `missing` rather than faked.
      memoryCandidates: [],
    });
  } catch (error) {
    return persistFailure(error instanceof Error ? error.message : String(error), {
      currentPrice,
      dataQuality: { degraded: true, missing: collection.missing },
    });
  }

  let memoryContext: string;
  try {
    const priors = await deps.listRecentAnalyses(
      input.userId,
      collection.symbol,
      MEMORY_RECALL_LIMIT,
    );
    memoryContext = formatMemoryContext(priors);
  } catch (error) {
    // Upstream's own wording for this path — a memory read failing must never
    // take the analysis down with it.
    log.warn("quant_agent.analysis.memory_failed", {
      symbol,
      error: error instanceof Error ? error.message : String(error),
    });
    memoryContext = "Memory retrieval failed.";
  }

  const { systemPrompt, userPrompt } = buildAnalysisPrompt({
    symbol: collection.symbol,
    market,
    interval,
    locale,
    facts: collection.promptFacts,
    missing: collection.missing,
    memoryContext,
  });

  const defaultStructure = buildDefaultAnalysisStructure(currentPrice);
  let llmOutput: QuantAnalysisLlmOutput;
  try {
    const res = await deps.callLLM(
      {
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: ANALYSIS_MAX_TOKENS,
      },
      { tier: "deep" },
    );
    llmOutput = parseAnalysisOutput(extractText(res), defaultStructure);
  } catch (error) {
    // Upstream's outer `except` arm: the default structure carries the reason
    // forward under `report` instead of losing the run.
    llmOutput = {
      ...defaultStructure,
      report: `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let finalized: QuantAnalysisFinalizeResult;
  try {
    finalized = await deps.finalizeAnalysis(context, {
      market,
      symbol: collection.symbol,
      currentPrice,
      indicators: primaryIndicators,
      llmOutput,
      // Permanently false: no news feed and no macro series sit behind this
      // engine, so upstream's "a major event excuses the indicator conflict"
      // override can never be truthfully claimed.
      hasMajorNews: false,
      hasMacroEvent: false,
      consensus: score.consensus,
      // Handed straight back so the confidence keeps upstream's
      // quality_multiplier haircut; omitting it would assert undegraded inputs.
      dataQuality: score.dataQuality,
    });
  } catch (error) {
    return persistFailure(error instanceof Error ? error.message : String(error), {
      currentPrice,
      dataQuality: {
        degraded: true,
        missing: mergeMissing(collection.missing, score.dataQuality.missing),
      },
    });
  }

  const objective = score.objectiveByTimeframe[collection.primaryTimeframe] ?? null;
  const detail = coerceDetail(finalized.analysis);
  const parseFailureReport = typeof finalized.report === "string" ? finalized.report : null;

  const record = await deps.createAnalysis(input.userId, {
    market,
    symbol: collection.symbol,
    interval,
    status: "completed",
    decision: coerceDecision(finalized.decision),
    confidence: clampScore(finalized.confidence),
    currentPrice,
    entryPrice: finiteOrNull(finalized.entry_price),
    stopLoss: finiteOrNull(finalized.stop_loss),
    takeProfit: finiteOrNull(finalized.take_profit),
    positionSizePct: finiteOrNull(finalized.position_size_pct),
    horizon: coerceHorizon(finalized.timeframe),
    summary: typeof finalized.summary === "string" ? finalized.summary : null,
    scores: {
      technical: clampScore(finalized.technical_score),
      fundamental: clampScore(finalized.fundamental_score),
      sentiment: clampScore(finalized.sentiment_score),
      overall: overallScoreFrom(objective?.overallScore ?? score.consensus.score),
    },
    consensus: {
      decision: score.consensus.decision,
      score: score.consensus.score,
      agreement: score.consensus.agreement,
      timeframeCount: score.consensus.timeframeCount,
    },
    outlook: score.trendOutlook,
    detail,
    reasons: coerceStringList(finalized.key_reasons),
    risks: coerceStringList(finalized.risks),
    dataQuality: {
      // Structural absence is NOT degradation — it is a permanent property of
      // this platform. Degradation means a frame we asked for came back short
      // or empty, or quant-agent penalised the inputs it received.
      degraded: collection.degraded || score.dataQuality.degraded,
      missing: mergeMissing(collection.missing, score.dataQuality.missing),
    },
    // A completed run still records that the model's own JSON had to be
    // repaired — the row is real, the caveat travels with it.
    error: parseFailureReport,
  });

  log.info("quant_agent.analysis.completed", {
    id: record.id,
    symbol: record.symbol,
    interval: record.interval,
    decision: record.decision,
    confidence: record.confidence,
    agreement: score.consensus.agreement,
    degraded: record.dataQuality?.degraded ?? false,
  });

  return record;
}

function mergeMissing(local: string[], remote: string[]): string[] {
  return Array.from(new Set([...local, ...remote]));
}
