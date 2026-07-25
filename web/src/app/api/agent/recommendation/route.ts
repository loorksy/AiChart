import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { ApiError, handleError } from "@/lib/api";
import {
  logAudit,
  saveRecommendation,
  updateRecommendationChartUrl,
  updateRecommendationIntelligence,
} from "@/lib/store";
import { profileForInterval } from "@/lib/analysisProfile";
import { validateChartDrawings, type ChartDrawing } from "@/lib/chartDrawings";
import { attachChartToRecommendation } from "@/lib/recommendationChart";
import { agentChartUrls } from "@/lib/chartBridgeUrl";
import {
  canUseMt5ChartCapture,
  mt5ChartUrl,
  queueMt5ChartCapture,
} from "@/lib/eaChartDraw";
import {
  searchSimilarLessons,
  formatLessonsForPrompt,
} from "@/lib/tradeMemory";
import { normalizeIntentSymbol } from "@/lib/markets/resolve";
import type { Recommendation } from "@/lib/types";
import { DEFAULT_MARKET } from "@/lib/marketPolicy";
import {
  getStrategyBacktest,
  requireRecommendationEvidence,
} from "@/lib/strategies/evidence";
import { isBacktestStrategyId } from "@/lib/strategies/catalog";
import {
  applyVisualConfidencePenalty,
  buildVisualConfirmationAudit,
  normalizeTimeframesReviewed,
  normalizeVisualConfirmation,
} from "@/lib/recommendations/visualConfirmation";

const schema = z
  .object({
    symbol: z.string().min(1),
    action: z.enum(["buy", "sell", "wait"]),
    // Retained for WAIT/backward compatibility. BUY/SELL confidence is always
    // replaced by server-owned calibrated evidence below.
    confidence: z.number().min(0).max(100).optional(),
    strategy_id: z.string().min(3).max(128).nullish(),
    strategy_version: z.string().min(1).max(64).nullish(),
    backtested_confidence: z.number().min(0).max(100).nullish(),
    market_regime: z.string().min(3).max(64).nullish(),
    entry: z.number().positive().nullish(),
    stop_loss: z.number().positive().nullish(),
    take_profit: z.number().positive().nullish(),
    timeframe: z.string().default("1h"),
    rationale: z.string().min(1),
    factors: z.array(z.string()).min(1).max(8),
    pattern_name: z.string().nullish(),
    chart_drawings: z.array(z.record(z.string(), z.unknown())).optional(),
    // Audit-only visual confirmation. Optional so recommendations written
    // before multi-timeframe review existed keep working unchanged.
    visual_confirmation: z
      .union([
        z.enum(["confirmed", "contradicted", "not_checked"]),
        z.boolean(),
      ])
      .nullish(),
    timeframes_reviewed: z.array(z.string().min(1).max(16)).max(8).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.action === "wait") return;
    for (const field of [
      "strategy_id",
      "backtested_confidence",
      "market_regime",
      "entry",
      "stop_loss",
      "take_profit",
    ] as const) {
      if (body[field] == null) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required for BUY/SELL recommendations`,
        });
      }
    }
    if (
      body.entry != null &&
      body.stop_loss != null &&
      body.take_profit != null
    ) {
      const valid =
        body.action === "buy"
          ? body.stop_loss < body.entry && body.entry < body.take_profit
          : body.take_profit < body.entry && body.entry < body.stop_loss;
      if (!valid) {
        ctx.addIssue({
          code: "custom",
          path: ["entry"],
          message: "Entry, stop loss, and take profit geometry is invalid for the action",
        });
      }
    }
  });

/**
 * Bridge: records a structured recommendation and renders its annotated
 * chart. Returns the chart URL the agent can download and send to Telegram.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());
    const normalizedSymbol = normalizeIntentSymbol(body.symbol, DEFAULT_MARKET);

    let deployment: Awaited<ReturnType<typeof requireRecommendationEvidence>> | null = null;
    let backtest: Awaited<ReturnType<typeof getStrategyBacktest>> = null;
    if (body.action !== "wait") {
      if (!body.strategy_id || !isBacktestStrategyId(body.strategy_id)) {
        throw new ApiError(409, "strategy_id is not present in the backtested strategy catalog");
      }
      try {
        deployment = await requireRecommendationEvidence({
          userId,
          strategyId: body.strategy_id,
          symbol: normalizedSymbol,
          timeframe: body.timeframe,
          claimedBacktestedConfidence: body.backtested_confidence!,
        });
      } catch (error) {
        throw new ApiError(
          409,
          error instanceof Error ? error.message : "Backtest evidence is invalid",
        );
      }
      backtest = await getStrategyBacktest(userId, deployment.backtestId);
      if (!backtest || backtest.status !== "eligible") {
        throw new ApiError(409, "Backtest is not eligible for recommendations");
      }
    }
    const calibratedConfidence =
      deployment?.calibratedConfidence ?? Math.max(0, Math.min(100, body.confidence ?? 0));

    // Visual review is a confirmation layer on top of the statistical gates
    // above — it can only lower the DISPLAYED confidence when the chart
    // contradicts the numbers, never raise it and never replace the evidence.
    const visualConfirmation = normalizeVisualConfirmation(body.visual_confirmation);
    const timeframesReviewed = normalizeTimeframesReviewed(body.timeframes_reviewed);
    const visualAdjustment = applyVisualConfidencePenalty(
      calibratedConfidence,
      visualConfirmation,
    );
    const displayedConfidence = visualAdjustment.confidence;

    const profile = profileForInterval(body.timeframe);
    const drawings = validateChartDrawings(
      (body.chart_drawings ?? []) as unknown as ChartDrawing[],
      body.action,
      displayedConfidence,
      profile,
    );

    const similarLessons = await searchSimilarLessons(userId, {
      symbol: body.symbol,
      pattern: body.pattern_name ?? undefined,
      limit: 3,
    });
    const memoryBlock = formatLessonsForPrompt(similarLessons);
    const rationale =
      memoryBlock && !body.rationale.includes("دروس مشابهة")
        ? `${body.rationale}\n\n${memoryBlock}`
        : body.rationale;

    const rec = await saveRecommendation(userId, {
      symbol: normalizedSymbol,
      action: body.action,
      confidence: displayedConfidence,
      entry: body.entry ?? null,
      stop_loss: body.stop_loss ?? null,
      take_profit: body.take_profit ?? null,
      timeframe: body.timeframe,
      rationale,
      factors: body.factors,
      pattern_name: body.pattern_name ?? null,
      chart_drawings_json: drawings.length ? JSON.stringify(drawings) : null,
      analysis_tier: profile.tier,
      context_json: JSON.stringify({
        evidence_source: deployment ? "validated_backtest" : "wait_decision",
        deployment_state: deployment?.state ?? null,
        market_regime: body.market_regime ?? null,
        ...buildVisualConfirmationAudit(
          visualConfirmation,
          timeframesReviewed,
          visualAdjustment,
        ),
      }),
      backtested_confidence: deployment?.calibratedConfidence ?? null,
      confidence_low: deployment?.confidenceLow ?? null,
      confidence_high: deployment?.confidenceHigh ?? null,
      backtest_id: deployment?.backtestId ?? null,
      market_regime: body.market_regime ?? null,
      strategy_id: body.strategy_id ?? null,
      strategy_version:
        body.strategy_version ?? backtest?.strategyVersion ?? null,
      source: "agent",
      market: DEFAULT_MARKET,
    });

    await updateRecommendationIntelligence(rec.id, {
      memory_refs_json: similarLessons.length
        ? JSON.stringify(similarLessons.map((l) => l.id))
        : null,
    });

    await logAudit(
      userId,
      "agent_recommendation",
      `${rec.symbol} ${rec.action} ${rec.confidence}% strategy=${body.strategy_id ?? "none"} backtest=${deployment?.backtestId ?? "none"} regime=${body.market_regime ?? "none"} visual=${visualConfirmation}${visualAdjustment.applied ? `(-${visualAdjustment.penaltyPct}% from ${visualAdjustment.baseConfidence})` : ""} tf_reviewed=${timeframesReviewed.join("/") || "none"} (#${rec.id})`,
    );

    const mt5 = await canUseMt5ChartCapture(userId, body.symbol);
    let enriched: Recommendation = {
      ...rec,
      memory_refs_json: similarLessons.length
        ? JSON.stringify(similarLessons.map((l) => l.id))
        : null,
    };
    let chartUrl: string;
    let mt5Pending = false;

    if (mt5.ok && rec.action !== "wait") {
      await queueMt5ChartCapture(userId, {
        recommendationId: rec.id,
        symbol: body.symbol,
        interval: body.timeframe,
        drawings,
        entry: body.entry ?? null,
        stop_loss: body.stop_loss ?? null,
        take_profit: body.take_profit ?? null,
      });
      chartUrl = mt5ChartUrl(rec.id);
      await updateRecommendationChartUrl(rec.id, chartUrl);
      enriched = { ...enriched, chart_image_url: chartUrl };
      mt5Pending = true;
    } else {
      const attached = await attachChartToRecommendation(userId, enriched, {
        notify: false,
        drawings,
      });
      enriched = attached.rec;
      chartUrl = `/api/agent/chart/${enriched.id}`;
    }

    return NextResponse.json({
      ok: true,
      recommendation: enriched,
      similar_lessons: similarLessons,
      ...agentChartUrls(chartUrl),
      mt5_pending: mt5Pending,
      mt5_symbol: mt5.mt5Symbol ?? null,
      mt5_unavailable_reason: mt5.ok ? null : mt5.reason ?? null,
      visual_review: {
        visual_confirmation: visualConfirmation,
        timeframes_reviewed: timeframesReviewed,
        confidence_penalty_applied: visualAdjustment.applied,
        confidence_penalty_pct: visualAdjustment.applied
          ? visualAdjustment.penaltyPct
          : 0,
        confidence_before_penalty: visualAdjustment.applied
          ? visualAdjustment.baseConfidence
          : null,
        note:
          "Audit only. Visual review never grants execution authority — see backtest_evidence.execution_eligible.",
      },
      backtest_evidence:
        deployment == null
          ? null
          : {
              backtest_id: deployment.backtestId,
              calibrated_confidence: deployment.calibratedConfidence,
              confidence_interval: [deployment.confidenceLow, deployment.confidenceHigh],
              deployment_state: deployment.state,
              execution_eligible: deployment.state === "active",
            },
    });
  } catch (e) {
    return handleError(e);
  }
}
