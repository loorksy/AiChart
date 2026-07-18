import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  logAudit,
  getSettings,
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
import { ModelTradePlanSchema } from "@/lib/agent/modelFirst/modelTradePlan";
import { validateModelTradePlan } from "@/lib/agent/modelFirst/validatedTradePlan";
import {
  buildModelPlanPersistence,
  serializeModelPlanPersistence,
} from "@/lib/agent/modelFirst/modelPlanPersistence";
import { getFreshAgentCandles } from "@/lib/agent/marketContext/getFreshAgentCandles";

const hostModelPlanSchema = ModelTradePlanSchema.partial({
  contextTimeframes: true,
  timeframeAnalysis: true,
  warnings: true,
  targets: true,
}).extend({
  decision: z.enum(["buy", "sell", "wait"]),
  activation: z.enum(["immediate", "conditional", "none"]),
  marketThesis: z.string().min(8),
  summary: z.string().min(10),
  keyReasons: z.array(z.string()).min(1).max(6),
  alternativeScenario: z.string().min(4),
  confidence: z.number().min(0).max(1),
  dataTimestamp: z.string().min(4),
  primaryTimeframe: z.string().min(1),
  marketRegime: z.enum(["trend", "range", "breakout", "reversal", "mixed"]),
});

const schema = z.object({
  symbol: z.string().min(1),
  action: z.enum(["buy", "sell", "wait"]).optional(),
  confidence: z.number().min(0).max(100).optional(),
  entry: z.number().nullish(),
  stop_loss: z.number().nullish(),
  take_profit: z.number().nullish(),
  targets: z.array(z.number()).max(3).optional(),
  timeframe: z.string().default("1h"),
  rationale: z.string().min(1).optional(),
  factors: z.array(z.string()).min(1).max(8).optional(),
  pattern_name: z.string().nullish(),
  chart_drawings: z.array(z.record(z.string(), z.unknown())).optional(),
  /** Host-model owned plan — validated before persistence. No Trade Candidate binding. */
  model_plan: hostModelPlanSchema.optional(),
  snapshot_id: z.string().optional(),
  current_price: z.number().optional(),
  quote_age_ms: z.number().optional(),
  tick_size: z.number().optional(),
  model_id: z.string().optional(),
  reasoning_effort: z.string().optional(),
  allow_repair: z.boolean().optional(),
});

/**
 * Bridge: records a structured recommendation from the host model's own plan.
 * Validates via validateModelTradePlan; persists only technically accepted levels.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());
    const settings = await getSettings(userId);

    let action = body.action ?? body.model_plan?.decision ?? "wait";
    let confidence =
      body.confidence ??
      Math.round((body.model_plan?.confidence ?? 0) * 100);
    let entry = body.entry ?? null;
    let stopLoss = body.stop_loss ?? null;
    let takeProfit = body.take_profit ?? null;
    let targets = body.targets ?? (takeProfit != null ? [takeProfit] : []);
    let rationale = body.rationale ?? body.model_plan?.summary ?? "";
    let factors = body.factors ?? body.model_plan?.keyReasons ?? ["model"];
    let executionReady = action === "wait";
    let validationErrors: string[] = [];
    let contextJson: string | null = null;
    let risk: Record<string, unknown> = { poiScoreCompat: false };

    if (body.model_plan) {
      const plan = ModelTradePlanSchema.parse({
        ...body.model_plan,
        contextTimeframes: body.model_plan.contextTimeframes ?? [],
        timeframeAnalysis: body.model_plan.timeframeAnalysis ?? [],
        warnings: body.model_plan.warnings ?? [],
        targets: body.model_plan.targets ?? [],
        entryZone: body.model_plan.entryZone ?? {
          low: null,
          high: null,
          preferred: null,
        },
        invalidation: body.model_plan.invalidation ?? null,
        stopLoss: body.model_plan.stopLoss ?? null,
        requiredConfirmation: body.model_plan.requiredConfirmation ?? null,
        pathToEntry: body.model_plan.pathToEntry ?? null,
      });
      action = plan.decision;
      confidence = Math.round(plan.confidence * 100);
      rationale = plan.summary;
      factors = plan.keyReasons;

      let currentPrice = body.current_price ?? null;
      if (currentPrice == null && action !== "wait") {
        const fresh = await getFreshAgentCandles({
          userId,
          symbol: body.symbol,
          interval: body.timeframe,
          limit: 5,
        }).catch(() => null);
        currentPrice = fresh?.currentTfCandles.at(-1)?.close ?? null;
      }

      const validated = validateModelTradePlan({
        plan,
        currentPrice,
        tickSize: body.tick_size,
        quoteAgeMs: body.quote_age_ms,
      });

      executionReady = validated.executionReady || plan.decision === "wait";
      validationErrors = validated.technicalErrors;

      if (validated.executionReady) {
        entry = validated.entry;
        stopLoss = validated.stopLoss;
        targets = validated.targets;
        takeProfit = validated.targets[0] ?? null;
      } else if (plan.decision !== "wait") {
        // Preserve analytical direction; do not persist rejected geometry.
        entry = null;
        stopLoss = null;
        targets = [];
        takeProfit = null;
      }

      const persistence = buildModelPlanPersistence({
        plan,
        validated,
        modelId: body.model_id,
        reasoningEffort: body.reasoning_effort,
        snapshotId: body.snapshot_id,
        quoteAgeMs: body.quote_age_ms,
        quoteTimestamp: null,
        source: "mcp_host_model",
        executionReadiness:
          plan.decision === "wait"
            ? "none"
            : validated.executionReady
              ? "ready_for_approval"
              : "levels_require_refresh",
      });
      contextJson = serializeModelPlanPersistence(persistence);
      risk = {
        poiScoreCompat: false,
        validationState: persistence.validationState,
        executionReadiness: persistence.executionReadiness,
        validationErrors,
        requiresExplicitApproval: true,
      };
    } else if (action === "buy" || action === "sell") {
      // Flat host payload — synthesize a minimal plan and validate.
      const plan = ModelTradePlanSchema.parse({
        decision: action,
        activation: "immediate",
        marketRegime: "mixed",
        marketThesis: rationale || "Host model recommendation.",
        primaryTimeframe: body.timeframe,
        contextTimeframes: [],
        timeframeAnalysis: [],
        entryZone: {
          low: entry,
          high: entry,
          preferred: entry,
        },
        invalidation: stopLoss,
        stopLoss,
        targets: targets.map((price) => ({
          price,
          reason: "host target",
        })),
        requiredConfirmation: null,
        pathToEntry: null,
        alternativeScenario: "Host-provided levels.",
        confidence: confidence / 100,
        summary: rationale || "Host model recommendation.",
        keyReasons: factors,
        warnings: [],
        dataTimestamp: new Date().toISOString(),
      });
      let currentPrice = body.current_price ?? null;
      if (currentPrice == null) {
        const fresh = await getFreshAgentCandles({
          userId,
          symbol: body.symbol,
          interval: body.timeframe,
          limit: 5,
        }).catch(() => null);
        currentPrice = fresh?.currentTfCandles.at(-1)?.close ?? null;
      }
      const validated = validateModelTradePlan({
        plan,
        currentPrice,
        tickSize: body.tick_size,
        quoteAgeMs: body.quote_age_ms,
      });
      executionReady = validated.executionReady;
      validationErrors = validated.technicalErrors;
      if (validated.executionReady) {
        entry = validated.entry;
        stopLoss = validated.stopLoss;
        targets = validated.targets;
        takeProfit = validated.targets[0] ?? null;
      } else {
        entry = null;
        stopLoss = null;
        targets = [];
        takeProfit = null;
      }
      const persistence = buildModelPlanPersistence({
        plan,
        validated,
        modelId: body.model_id,
        source: "mcp_host_model",
      });
      contextJson = serializeModelPlanPersistence(persistence);
      risk = {
        poiScoreCompat: false,
        validationState: persistence.validationState,
        executionReadiness: persistence.executionReadiness,
        validationErrors,
        requiresExplicitApproval: true,
      };
    }

    if (!rationale) {
      return NextResponse.json(
        { error: "rationale or model_plan.summary is required" },
        { status: 400 },
      );
    }

    const profile = profileForInterval(body.timeframe);
    const drawings =
      executionReady || action === "wait"
        ? validateChartDrawings(
            (body.chart_drawings ?? []) as unknown as ChartDrawing[],
            action,
            confidence,
            profile,
          )
        : [];

    const similarLessons = await searchSimilarLessons(userId, {
      symbol: body.symbol,
      pattern: body.pattern_name ?? undefined,
      limit: 3,
    });
    const memoryBlock = formatLessonsForPrompt(similarLessons);
    const finalRationale =
      memoryBlock && !rationale.includes("دروس مشابهة")
        ? `${rationale}\n\n${memoryBlock}`
        : rationale;

    const rec = await saveRecommendation(userId, {
      symbol: normalizeIntentSymbol(body.symbol, DEFAULT_MARKET),
      action,
      confidence,
      entry,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      targets,
      timeframe: body.timeframe,
      rationale: finalRationale,
      factors,
      pattern_name: body.pattern_name ?? null,
      chart_drawings_json: drawings.length ? JSON.stringify(drawings) : null,
      analysis_tier: profile.tier,
      source: "agent",
      market: DEFAULT_MARKET,
      context_json: contextJson,
      risk,
      engine_version: "aichart-model-plan-v1",
    });

    await updateRecommendationIntelligence(rec.id, {
      memory_refs_json: similarLessons.length
        ? JSON.stringify(similarLessons.map((l) => l.id))
        : null,
    });

    await logAudit(
      userId,
      "agent_recommendation",
      `${rec.symbol} ${rec.action} ${rec.confidence}% (#${rec.id}) validated=${executionReady}`,
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

    if (mt5.ok && rec.action !== "wait" && executionReady) {
      await queueMt5ChartCapture(userId, {
        recommendationId: rec.id,
        symbol: body.symbol,
        interval: body.timeframe,
        drawings,
        entry,
        stop_loss: stopLoss,
        take_profit: takeProfit,
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

    void settings;

    return NextResponse.json({
      ok: true,
      recommendation: enriched,
      similar_lessons: similarLessons,
      ...agentChartUrls(chartUrl),
      mt5_pending: mt5Pending,
      mt5_symbol: mt5.mt5Symbol ?? null,
      mt5_unavailable_reason: mt5.ok ? null : mt5.reason ?? null,
      validation: {
        execution_ready: executionReady,
        errors: validationErrors,
        requires_explicit_approval: true,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
