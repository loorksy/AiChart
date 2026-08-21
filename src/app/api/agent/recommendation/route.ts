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
import { collectTakeProfits } from "@/lib/recommendations/collectTakeProfits";
import { agentChartUrls } from "@/lib/chartBridgeUrl";
import {
  searchSimilarLessons,
  formatLessonsForPrompt,
} from "@/lib/tradeMemory";
import {
  canonicalStrategySymbol,
  storageStrategyTimeframe,
} from "@/lib/strategies/matchingKeys";
import type { Recommendation } from "@/lib/types";
import { DEFAULT_MARKET } from "@/lib/marketPolicy";
import { FEATURES } from "@/lib/agent/featureFlags";
import { criticalAlert, metrics } from "@/lib/metrics";
import { validateCompletePlan } from "@/lib/recommendations/canonical/planContract";
import {
  activationRuleSchema,
  normalizeActivationRule,
} from "@/lib/recommendations/activationRule";
import { deriveExecutionState, type PlanType } from "@/lib/agent/trading/tradePlan";
import { getUnifiedPrice } from "@/lib/markets";
import { getForexLiveQuote } from "@/lib/markets/forexPrice";
import { resolveCostEvidence } from "@/lib/agent/marketContext/costEvidence";
import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { isCandleComplete } from "@/lib/ohlc/candleTime";
import { atr as computeAtr } from "@/lib/indicators";
import {
  assessTradability,
  type TradabilityAssessment,
} from "@/lib/recommendations/tradability";
import { parityKeyFor, recordDecisionForParity } from "@/lib/agent/parityLog";
import { createHash } from "node:crypto";
import { createLogger } from "@/lib/logger";
import { t } from "@/lib/i18n";
import {
  applyVisualConfidencePenalty,
  buildVisualConfirmationAudit,
  normalizeTimeframesReviewed,
  normalizeVisualConfirmation,
} from "@/lib/recommendations/visualConfirmation";
import { coerceVisualConfirmation } from "@/lib/chart/liveCapture";

const log = createLogger("api.agent.recommendation");

/** Latest CLOSED candle, fetched live off the user's linked account. */
async function getLastClosedCandleLive(
  userId: number,
  symbol: string,
  interval: string,
): Promise<{ time: number; close: number } | null> {
  const { candles } = await fetchOhlc({
    userId,
    symbol,
    interval,
    limit: 3,
    skipCache: true,
  });
  const closed = candles.filter((c) => isCandleComplete(c.time, interval));
  return closed.at(-1) ?? null;
}

const schema = z
  .object({
    symbol: z.string().min(1),
    action: z.enum(["buy", "sell", "wait"]),
    /**
     * The analysis this plan came from (returned by the analyze endpoint).
     * The write boundary checks the RECORDED gate chain under this id — a
     * buy/sell create without a fresh, complete, non-vetoed record is
     * refused in code, so publishing without analyzing first cannot work.
     */
    analysis_id: z.string().min(4).max(64).optional(),
    /**
     * How the plan is entered — the contract's second layer. Optional in the
     * SCHEMA so a legacy client is not broken at parse time, then required for a
     * new buy/sell below: a direction with no plan type does not say whether to
     * act now or wait for a condition.
     */
    plan_type: z.enum(["immediate", "anticipatory", "conditional"]).optional(),
    // BUY/SELL confidence is the model's own judgement — never a
    // statistically calibrated figure.
    confidence: z.number().min(0).max(100).optional(),
    market_regime: z.string().min(3).max(64).nullish(),
    entry: z.number().positive().nullish(),
    stop_loss: z.number().positive().nullish(),
    take_profit: z.number().positive().nullish(),
    take_profits: z.array(z.number().positive()).max(3).optional(),
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
    const takeProfits = collectTakeProfits(body.action, body.take_profit, body.take_profits);
    if (body.entry == null) {
      ctx.addIssue({
        code: "custom",
        path: ["entry"],
        message: "entry is required for BUY/SELL recommendations",
      });
    }
    if (body.stop_loss == null) {
      ctx.addIssue({
        code: "custom",
        path: ["stop_loss"],
        message: "stop_loss is required for BUY/SELL recommendations",
      });
    }
    if (takeProfits.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["take_profit"],
        message: "take_profit (or take_profits) is required for BUY/SELL recommendations",
      });
    }
    if (body.entry != null && body.stop_loss != null && takeProfits.length > 0) {
      const tp0 = takeProfits[0]!;
      const valid =
        body.action === "buy"
          ? body.stop_loss < body.entry && takeProfits.every((tp) => tp > body.entry!)
          : tp0 < body.entry &&
            body.entry < body.stop_loss &&
            takeProfits.every((tp) => tp < body.entry!);
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
      targets: collectTakeProfits(body.action, body.take_profit, body.take_profits),
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
    const takeProfits = collectTakeProfits(body.action, body.take_profit, body.take_profits);
    const takeProfit = takeProfits[0] ?? body.take_profit ?? null;
    // Matching keys are CANONICAL (XAUUSD, 1h) so deployment lookups, decay
    // tracking, and execution eligibility all join. Broker-suffixed raw
    // symbols stay in body.symbol for the MT5 capture path below.
    const normalizedSymbol = canonicalStrategySymbol(body.symbol);
    const storedTimeframe = storageStrategyTimeframe(body.timeframe);

    const modelJudgementConfidence = Math.max(0, Math.min(100, body.confidence ?? 0));

    // Visual review can only lower the DISPLAYED model-judgement confidence
    // when the chart contradicts the numbers. It never invents statistical
    // support. confirmed/contradicted is structurally refused unless a recent
    // live TradingView capture actually included drawings.
    const visualConfirmation = coerceVisualConfirmation(
      normalizeVisualConfirmation(body.visual_confirmation),
      userId,
    );
    const timeframesReviewed = normalizeTimeframesReviewed(body.timeframes_reviewed);
    const visualAdjustment = applyVisualConfidencePenalty(
      modelJudgementConfidence,
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
          const lastClosed = await getLastClosedCandleLive(
            userId,
            normalizedSymbol,
            storedTimeframe,
          );
          if (lastClosed && lastClosed.close > 0) currentPrice = lastClosed.close;
        } catch {
          currentPrice = null;
        }
      }
      executionState = deriveExecutionState({
        planType: body.plan_type as PlanType,
        levels:
          takeProfit != null &&
          body.stop_loss != null &&
          entryLow != null &&
          entryHigh != null
            ? {
                entryLow,
                entryHigh,
                preferredEntry: body.entry ?? entryLow,
                stopLoss: body.stop_loss,
                targets: takeProfits,
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
        const recent = await fetchOhlc({
          userId,
          symbol: normalizedSymbol,
          interval: storedTimeframe,
          limit: 30,
          skipCache: true,
        });
        planAtr = computeAtr(
          recent.candles.filter((c) => isCandleComplete(c.time, storedTimeframe)),
        );
      } catch {
        planAtr = null;
      }
      // The run's cost evidence: a live bid/ask from the operator's own broker
      // feed when it answers inside the bound, otherwise the ladder's lower
      // rungs (measured profile → static model). assessTradability expects
      // PRICE units — spreadPrice, never the pips figure — for its
      // within-spread-noise check. Best-effort: an unreachable feed grades the
      // plan without a spread, exactly as before.
      let costSpreadPrice: number | null = null;
      try {
        const quote = await getForexLiveQuote(userId, normalizedSymbol, {
          timeoutMs: 1_800,
        });
        const cost = await resolveCostEvidence({
          userId,
          symbol: normalizedSymbol,
          referencePrice: currentPrice,
          observedOverride: quote,
        });
        costSpreadPrice = cost.spreadPrice;
      } catch {
        costSpreadPrice = null;
      }
      tradability = assessTradability({
        direction: body.action,
        planType: body.plan_type,
        entry: body.entry,
        currentPrice,
        atr: planAtr,
        spread: costSpreadPrice,
        validityCandles: body.validity_candles ?? null,
      });
      // Verdict distribution at publish (plan §2.4) — the KPI that shows the
      // far-entry problem shrinking is this counter's shape over time.
      metrics.tradabilityVerdicts.inc({ verdict: tradability.tradability });
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
      analysis_id: body.analysis_id ?? null,
      // The route's own measurements as the sourced evidence card: the write
      // refuses factors with no measurable basis.
      evidence: {
        // The machine-readable visual basis (Phase 8): the same coerced state
        // the audit records, kept where the report view reads evidence — so
        // the transparency line shows the truth for MCP-created plans too.
        visualReview: {
          visual_confirmation: visualConfirmation,
          timeframes_reviewed: timeframesReviewed,
        },
        evidenceDimensions: [
          {
            key: "signal_strength",
            grade:
              displayedConfidence >= 70
                ? "strong"
                : displayedConfidence >= 45
                  ? "moderate"
                  : "weak",
            detail: t("ar", "mcp.evidence.confidence", {
              value: String(displayedConfidence),
            }),
            value: displayedConfidence,
          },
          ...(tradability
            ? [
                {
                  key: "entry_reachability",
                  grade:
                    tradability.tradability === "now"
                      ? ("strong" as const)
                      : tradability.tradability === "soon"
                        ? ("moderate" as const)
                        : ("weak" as const),
                  detail: t("ar", "mcp.evidence.tradability", {
                    value: String(
                      tradability.entryDistanceAtr ?? tradability.entryDistance ?? 0,
                    ),
                  }),
                  value: tradability.entryDistanceAtr ?? undefined,
                },
              ]
            : []),
          {
            key: "visual_confirmation",
            grade:
              visualConfirmation === "confirmed"
                ? ("strong" as const)
                : ("unavailable" as const),
            detail: t("ar", "mcp.evidence.visual", {
              value: String(timeframesReviewed?.length ?? 0),
            }),
            value: timeframesReviewed?.length ?? 0,
          },
        ],
      },
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
      evidence_source: "direct_analysis",
      confidence: displayedConfidence,
      entry: body.entry ?? null,
      stop_loss: body.stop_loss ?? null,
      take_profit: takeProfit,
      targets: takeProfits,
      timeframe: storedTimeframe,
      rationale,
      factors: body.factors,
      pattern_name: body.pattern_name ?? null,
      chart_drawings_json: drawings.length ? JSON.stringify(drawings) : null,
      analysis_tier: profile.tier,
      context_json: JSON.stringify({
        evidence_source:
          body.action === "wait" ? "wait_decision" : "direct_analysis",
        confidence_kind: "model_judgement",
        market_regime: body.market_regime ?? null,
        tradability: tradability ?? null,
        ...buildVisualConfirmationAudit(
          visualConfirmation,
          timeframesReviewed,
          visualAdjustment,
        ),
      }),
      market_regime: body.market_regime ?? null,
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
        const lastClosed = await getLastClosedCandleLive(
          userId,
          normalizedSymbol,
          storedTimeframe,
        );
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
              targets: takeProfits,
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
      `${rec.symbol} ${rec.action} ${rec.confidence}% model_judgement visual=${visualConfirmation}${visualAdjustment.applied ? `(-${visualAdjustment.penaltyPct}% from ${visualAdjustment.baseConfidence})` : ""} tf_reviewed=${timeframesReviewed.join("/") || "none"} (#${rec.id})`,
    );

    let enriched: Recommendation = {
      ...rec,
      memory_refs_json: similarLessons.length
        ? JSON.stringify(similarLessons.map((l) => l.id))
        : null,
    };
    const attached = await attachChartToRecommendation(userId, enriched, {
      drawings,
    });
    enriched = attached.rec;
    const chartUrl = `/api/agent/chart/${enriched.id}`;

    return NextResponse.json({
      ok: true,
      recommendation: {
        ...enriched,
        take_profit: takeProfit,
        take_profits: takeProfits,
        targets: takeProfits,
      },
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
          "Audit only. drawings_included=false forces visual_confirmation=not_checked. Confidence is the model's own judgement — not statistical support.",
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
      confidence: {
        kind: "model_judgement",
        value: displayedConfidence,
        note: "This is the model's own judgement. It is not a statistically calibrated figure and must not be presented as backtest support.",
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
