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
import {
  canonicalStrategySymbol,
  canonicalStrategyTimeframe,
  storageStrategyTimeframe,
} from "@/lib/strategies/matchingKeys";
import type { Recommendation } from "@/lib/types";
import { DEFAULT_MARKET } from "@/lib/marketPolicy";
import {
  getStrategyBacktest,
  requireRecommendationEvidence,
} from "@/lib/strategies/evidence";
import { isBacktestStrategyId } from "@/lib/strategies/catalog";
import { FEATURES } from "@/lib/agent/featureFlags";
import {
  applyVisualConfidencePenalty,
  buildVisualConfirmationAudit,
  normalizeTimeframesReviewed,
  normalizeVisualConfirmation,
} from "@/lib/recommendations/visualConfirmation";

/** How much verified statistical weight sits behind a recommendation. */
type StatisticalSupport = "strong" | "moderate" | "weak" | "unavailable";

const schema = z
  .object({
    symbol: z.string().min(1),
    action: z.enum(["buy", "sell", "wait"]),
    /**
     * How the plan is entered — the contract's second layer. Optional in the
     * SCHEMA so a legacy client is not broken at parse time, then required for a
     * new buy/sell below: a direction with no plan type does not say whether to
     * act now or wait for a condition.
     */
    plan_type: z.enum(["immediate", "anticipatory", "conditional"]).optional(),
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
    // WAIT is not an analytical outcome (docs/UNIFIED_AGENT_PLAN.md — decision 1).
    // Existing `wait` rows stay readable; writing a NEW one is refused, because
    // this is the one externally reachable write path and leaving it open kept
    // the exact asymmetry the doctrine exists to remove: the platform engine
    // cannot express a wait, and an MCP-hosted model still could.
    //
    // The alternative is never silence: either a direction with a plan type, or
    // a named operational blocker when the market genuinely cannot be read.
    if (body.action === "wait") {
      // Gated by AGENT_DOCTRINE_V3 — the ONLY reversible part of phase A. Off is
      // a narrow escape hatch for an un-updated MCP client: it may still record
      // something instead of failing every call. It does not resurrect WAIT
      // inside the engine, whose contract has no such value structurally.
      if (!FEATURES.agentDoctrineV3()) return;
      ctx.addIssue({
        code: "custom",
        path: ["action"],
        message:
          "WAIT is not an analytical outcome. Return a direction (buy or sell) with a plan type — immediate, anticipatory, or conditional — or report the operational blocker that prevents reading the market.",
      });
      return;
    }
    // The plan type is required alongside the levels for the same reason: the
    // direction says what, the levels say where, and the plan type says when.
    if (body.plan_type == null) {
      ctx.addIssue({
        code: "custom",
        path: ["plan_type"],
        message:
          "plan_type is required for BUY/SELL: immediate (enter now), anticipatory (structure still forming), or conditional (waits for a stated trigger)",
      });
    }
    // Levels are required because a direction without them is not a plan.
    // Strategy evidence is NOT: a recommendation with no matching backtest is
    // recorded as direct analysis and labelled as such, never refused
    // (docs/UNIFIED_AGENT_PLAN.md §11).
    for (const field of ["entry", "stop_loss", "take_profit"] as const) {
      if (body[field] == null) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required for BUY/SELL recommendations`,
        });
      }
    }
    // Claiming statistical backing without naming the strategy behind it is the
    // one thing that IS refused — an unbacked number is worse than none.
    if (body.backtested_confidence != null && !body.strategy_id) {
      ctx.addIssue({
        code: "custom",
        path: ["strategy_id"],
        message:
          "backtested_confidence requires the strategy_id it came from; omit both for a direct-analysis recommendation",
      });
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
    // Matching keys are CANONICAL (XAUUSD, 1h) so deployment lookups, decay
    // tracking, and execution eligibility all join. Broker-suffixed raw
    // symbols stay in body.symbol for the MT5 capture path below.
    const normalizedSymbol = canonicalStrategySymbol(body.symbol);
    const storedTimeframe = storageStrategyTimeframe(body.timeframe);

    // Statistical evidence is GRADED here, not demanded. When the agent names a
    // strategy we verify it and let the server own the confidence; when it does
    // not, the recommendation is still recorded — labelled as direct analysis
    // with no statistical support, which is what the operator then sees.
    // Verification failures downgrade the label instead of refusing the plan;
    // the only refusal is a confidence claim we could not substantiate.
    let deployment: Awaited<ReturnType<typeof requireRecommendationEvidence>> | null = null;
    let backtest: Awaited<ReturnType<typeof getStrategyBacktest>> = null;
    let statisticalSupport: StatisticalSupport = "unavailable";
    let supportDetail: string | null = null;

    if (body.action !== "wait" && body.strategy_id) {
      if (!isBacktestStrategyId(body.strategy_id)) {
        supportDetail = "strategy_id is not present in the backtested strategy catalog";
      } else if (!canonicalStrategyTimeframe(body.timeframe)) {
        supportDetail = `timeframe "${body.timeframe}" is not a research timeframe`;
      } else {
        try {
          deployment = await requireRecommendationEvidence({
            userId,
            strategyId: body.strategy_id,
            symbol: normalizedSymbol,
            timeframe: body.timeframe,
            claimedBacktestedConfidence: body.backtested_confidence ?? undefined,
          });
          backtest = await getStrategyBacktest(userId, deployment.backtestId);
          if (backtest?.status === "eligible") {
            statisticalSupport = deployment.state === "active" ? "strong" : "moderate";
            supportDetail = `validated backtest ${deployment.backtestId} (${deployment.state})`;
          } else {
            statisticalSupport = "weak";
            supportDetail = "matched strategy has no eligible backtest yet";
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Backtest evidence is invalid";
          // A confidence number we cannot substantiate is refused outright:
          // labelling it would still put an unearned figure in front of the
          // operator. A bare strategy_id just loses its claim to support.
          if (body.backtested_confidence != null) {
            throw new ApiError(409, `Unverifiable backtested_confidence: ${message}`);
          }
          supportDetail = message;
        }
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
      plan_type: body.plan_type ?? null,
      confidence: displayedConfidence,
      entry: body.entry ?? null,
      stop_loss: body.stop_loss ?? null,
      take_profit: body.take_profit ?? null,
      timeframe: storedTimeframe,
      rationale,
      factors: body.factors,
      pattern_name: body.pattern_name ?? null,
      chart_drawings_json: drawings.length ? JSON.stringify(drawings) : null,
      analysis_tier: profile.tier,
      context_json: JSON.stringify({
        evidence_source: deployment
          ? "validated_backtest"
          : body.action === "wait"
            ? "wait_decision"
            : "direct_analysis",
        statistical_support: statisticalSupport,
        statistical_support_detail: supportDetail,
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
      // Always told, never implied: how much statistical weight is behind this
      // plan, including "none — direct analysis".
      statistical_support: {
        level: statisticalSupport,
        detail:
          supportDetail ??
          (statisticalSupport === "unavailable"
            ? "No matching validated strategy — recommendation rests on direct analysis."
            : null),
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
