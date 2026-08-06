import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { ApiError, handleError } from "@/lib/api";
import {
  logAudit,
  saveRecommendation,
  updateRecommendationIntelligence,
} from "@/lib/store";
import { profileForInterval } from "@/lib/analysisProfile";
import { validateChartDrawings, type ChartDrawing } from "@/lib/chartDrawings";
import { attachChartToRecommendation } from "@/lib/recommendationChart";
import { agentChartUrls } from "@/lib/chartBridgeUrl";
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
import { criticalAlert, metrics } from "@/lib/metrics";
import { validateCompletePlan } from "@/lib/recommendations/canonical/planContract";
import {
  activationRuleSchema,
  normalizeActivationRule,
} from "@/lib/recommendations/activationRule";
import { deriveExecutionState, type PlanType } from "@/lib/agent/trading/tradePlan";
import { getUnifiedPrice } from "@/lib/markets";
import { getCandles, getLatestClosedCandle } from "@/lib/candles/candleRepository";
import { atr as computeAtr } from "@/lib/indicators";
import {
  assessTradability,
  type TradabilityAssessment,
} from "@/lib/recommendations/tradability";
import { parityKeyFor, recordDecisionForParity } from "@/lib/agent/parityLog";
import { createHash } from "node:crypto";
import { createLogger } from "@/lib/logger";
import {
  applyVisualConfidencePenalty,
  buildVisualConfirmationAudit,
  normalizeTimeframesReviewed,
  normalizeVisualConfirmation,
} from "@/lib/recommendations/visualConfirmation";

const log = createLogger("api.agent.recommendation");

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
    /**
     * The rest of the plan contract (docs/UNIFIED_AGENT_PLAN.md layers 2–3).
     * Nullish at parse level so the message the model gets back comes from the
     * shared contract check below — one voice, both surfaces — rather than a
     * bare "required" per field. execution_state is deliberately NOT accepted:
     * it is a server fact, derived after parse.
     */
    entry_low: z.number().positive().nullish(),
    entry_high: z.number().positive().nullish(),
    activation_condition: z.string().trim().min(8).max(400).nullish(),
    activation_rule: activationRuleSchema.nullish(),
    invalidation_rule: z.string().trim().min(8).max(400).nullish(),
    alternative_scenario: z.string().trim().min(8).max(400).nullish(),
    validity_candles: z.number().int().min(1).max(96).nullish(),
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
      // The counter that must stay at zero. A write reaching here means some
      // client still believes WAIT is an analytical outcome.
      criticalAlert("hidden_wait_write", { source: "agent_recommendation_api" });
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

    // The Complete Plan Contract — the same function the canonical creator
    // enforces. Running it here turns what would be a 500 at the write path
    // into a 400 the model can self-correct on, with one shared voice.
    // Paths already refused above (plan_type, levels) are skipped; so is
    // executionState, which is server-derived after parse.
    const skip = new Set(["planType", "executionState", "entry", "stopLoss", "targets"]);
    const pathMap: Record<string, string> = {
      entryZone: "entry_low",
      activationCondition: "activation_condition",
      activationRule: "activation_rule",
      invalidationRule: "invalidation_rule",
      alternativeScenario: "alternative_scenario",
      validityCandles: "validity_candles",
    };
    const contractIssues = validateCompletePlan({
      direction: body.action,
      planType: body.plan_type,
      // Placeholder for the non-null leg only; the real value is derived
      // server-side after parse and never trusted from the client.
      executionState: "awaiting_activation",
      entry: body.entry,
      entryLow: body.entry_low ?? body.entry,
      entryHigh: body.entry_high ?? body.entry,
      stopLoss: body.stop_loss,
      targets: body.take_profit != null ? [body.take_profit] : [],
      activationCondition: body.activation_condition,
      activationRule: body.activation_rule,
      invalidationRule: body.invalidation_rule,
      alternativeScenario: body.alternative_scenario,
      validityCandles: body.validity_candles,
    }).filter((entry) => !skip.has(entry.path));
    if (contractIssues.length > 0) {
      // The Platform-only counter was why this gap was invisible in telemetry.
      metrics.invalidLevelRecommendations.inc({ source: "mcp" });
    }
    for (const entry of contractIssues) {
      ctx.addIssue({
        code: "custom",
        path: [pathMap[entry.path] ?? entry.path],
        message: entry.message,
      });
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

    // Execution state is a server fact — layer 3 belongs to whoever can see
    // the live price, never to the caller's claim. Conditional plans are
    // forced to awaiting_activation inside the derivation, and an unreadable
    // price fails to the same safe side.
    const entryLow = body.entry_low ?? body.entry ?? null;
    const entryHigh = body.entry_high ?? body.entry ?? null;
    let executionState: string | null = null;
    let tradability: TradabilityAssessment | null = null;
    if (body.action !== "wait" && body.plan_type != null) {
      // getUnifiedPrice reads the operator's BROKER mid, which is 0 whenever
      // no broker connection is live — so every immediate plan created through
      // this surface read `awaiting_activation` even with price sitting inside
      // the entry zone. The warehouse close is a real observed price and is the
      // honest second source; only when neither exists do we fail safe.
      let currentPrice: number | null = null;
      try {
        const { price } = await getUnifiedPrice(body.symbol, DEFAULT_MARKET, userId);
        currentPrice = price > 0 ? price : null;
      } catch {
        currentPrice = null;
      }
      if (currentPrice == null) {
        try {
          const lastClosed = await getLatestClosedCandle({
            symbol: normalizedSymbol,
            interval: storedTimeframe,
          });
          if (lastClosed && lastClosed.close > 0) currentPrice = lastClosed.close;
        } catch {
          currentPrice = null;
        }
      }
      executionState = deriveExecutionState({
        planType: body.plan_type as PlanType,
        levels:
          body.entry != null &&
          body.stop_loss != null &&
          body.take_profit != null &&
          entryLow != null &&
          entryHigh != null
            ? {
                entryLow,
                entryHigh,
                preferredEntry: body.entry,
                stopLoss: body.stop_loss,
                targets: [body.take_profit],
              }
            : null,
        currentPrice,
      });

      // The Tradability Budget (docs/PLATFORM_AGENT_UPGRADE_PLAN.md Phase 1):
      // is this entry realistically reachable from the CURRENT price? ATR of
      // the plan's own timeframe comes from closed warehouse candles; when it
      // cannot be read the assessment fails safe to watch_only rather than
      // guessing. This is the check whose absence let "sell from a level
      // 5 ATR above the market" store as a normal conditional trade.
      let planAtr: number | null = null;
      try {
        const recent = await getCandles({
          symbol: normalizedSymbol,
          interval: storedTimeframe,
          limit: 30,
          order: "desc",
        });
        planAtr = computeAtr(recent.filter((c) => c.complete));
      } catch {
        planAtr = null;
      }
      tradability = assessTradability({
        direction: body.action,
        planType: body.plan_type,
        entry: body.entry,
        currentPrice,
        atr: planAtr,
        spread: null,
        validityCandles: body.validity_candles ?? null,
      });
      if (tradability.tradability === "rejected" && FEATURES.tradabilityGateV1()) {
        // The caller's to fix, in one retry: the verdict names the distance in
        // the market's own units so the model re-plans near price instead of
        // resubmitting the same far level.
        metrics.invalidLevelRecommendations.inc({ source: "mcp" });
        const distanceAtr =
          tradability.entryDistanceAtr != null
            ? `${tradability.entryDistanceAtr} ATR`
            : `${(((tradability.entryDistance ?? 0) / (currentPrice ?? 1)) * 100).toFixed(2)}%`;
        throw new ApiError(
          409,
          `Entry ${body.entry} is ${distanceAtr} away from the current price ${currentPrice} — too far to publish as a trade. ` +
            `Keep the direction and either re-plan with an entry the market can realistically reach inside validity_candles, ` +
            `or present this level as a market view to watch (not a recommendation).`,
        );
      }
    }

    const rec = await saveRecommendation(userId, {
      symbol: normalizedSymbol,
      action: body.action,
      plan_type: body.plan_type ?? null,
      execution_state: executionState,
      entry_low: entryLow,
      entry_high: entryHigh,
      activation_condition: body.activation_condition ?? null,
      // The one mechanical default: a rule that names no timeframe gets the
      // plan's own, so the STORED rule is always complete and gradable.
      activation_rule: body.activation_rule
        ? normalizeActivationRule(body.activation_rule, storedTimeframe)
        : null,
      invalidation_rule: body.invalidation_rule ?? null,
      alternative_scenario: body.alternative_scenario ?? null,
      validity_candles: body.validity_candles ?? null,
      // The real column, not just the context blob: rows must be queryable by
      // where their support came from (plan §6 A).
      evidence_source: deployment ? "strategy_supported" : "direct_analysis",
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
        // The reachability verdict rides the context blob (additive, no schema
        // change) so cards, the tracker, and the calibration job can read it.
        tradability: tradability ?? null,
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

    // Deferred #10: the MCP-hosted model writing its own plan IS a decision on
    // the MCP surface, and until now it recorded no parity observation at all —
    // the one producer that could genuinely diverge was invisible to the
    // comparison. Anchored to the same decision moment the platform uses
    // (symbol + interval + latest CLOSED warehouse candle), so the two become
    // comparable. Idempotent: the observation id derives from that moment and
    // the user, so a client retry updates one row instead of adding another.
    // Best-effort — parity is diagnostics and must never fail the create.
    if (body.action !== "wait") {
      try {
        const lastClosed = await getLatestClosedCandle({
          symbol: normalizedSymbol,
          interval: storedTimeframe,
        });
        if (lastClosed) {
          const parityKey = parityKeyFor({
            symbol: normalizedSymbol,
            interval: storedTimeframe,
            marketTimestamp: lastClosed.time,
          });
          await recordDecisionForParity({
            userId,
            evidenceHash: createHash("sha256")
              .update(`mcp-create:${userId}:${parityKey}`)
              .digest("hex"),
            parityKey,
            symbol: normalizedSymbol,
            interval: storedTimeframe,
            timeframeSet: [storedTimeframe],
            marketTimestamp: lastClosed.time,
            surface: "mcp",
            decision: {
              direction: body.action,
              planType: body.plan_type ?? null,
              entryLow,
              entryHigh,
              stopLoss: body.stop_loss ?? null,
              targets: body.take_profit != null ? [body.take_profit] : [],
              executionState,
              blocked: false,
              imagesFor: [],
              providers: ["mcp_create_recommendation"],
            },
          });
        }
      } catch (error) {
        log.warn("mcp create parity observation failed", {
          recommendationId: rec.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

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

    let enriched: Recommendation = {
      ...rec,
      memory_refs_json: similarLessons.length
        ? JSON.stringify(similarLessons.map((l) => l.id))
        : null,
    };
    const attached = await attachChartToRecommendation(userId, enriched, {
      notify: false,
      drawings,
    });
    enriched = attached.rec;
    const chartUrl = `/api/agent/chart/${enriched.id}`;

    return NextResponse.json({
      ok: true,
      recommendation: enriched,
      similar_lessons: similarLessons,
      ...agentChartUrls(chartUrl),
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
      // Reachability, stated in the market's own units. `watch_only` plans are
      // stored and tracked, but MUST be presented as a market view to monitor
      // — never as an actionable entry.
      tradability:
        tradability == null
          ? null
          : {
              verdict: tradability.tradability,
              entry_distance_atr: tradability.entryDistanceAtr,
              expected_bars_to_activation: tradability.expectedBarsToActivation,
              reasons: tradability.reasons,
              note:
                tradability.tradability === "watch_only"
                  ? "Present this as a market view to watch. Do not render it as a ready trade; an entry-approach alert will make it actionable if price comes near."
                  : null,
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
    // A contract violation is the CALLER's to fix, and it must read as such: a
    // short 400 naming the fields, never a 500 (and never the full zod dump,
    // whose flattened union paths present as contradictions). Full detail still
    // reaches the server log through the response being deterministic.
    if (e instanceof z.ZodError) {
      const issues = e.issues
        .slice(0, 6)
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
      return NextResponse.json(
        {
          error: issues.join("; "),
          hint: "Fix ONLY the fields above and call again. A conditional/anticipatory plan needs activation_condition + activation_rule + invalidation_rule + alternative_scenario + validity_candles; activation_rule.timeframe may be omitted (the plan's timeframe is used).",
        },
        { status: 400 },
      );
    }
    return handleError(e);
  }
}
