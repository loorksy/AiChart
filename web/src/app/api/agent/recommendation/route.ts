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

const schema = z.object({
  symbol: z.string().min(1),
  action: z.enum(["buy", "sell", "wait"]),
  confidence: z.number().min(0).max(100),
  entry: z.number().nullish(),
  stop_loss: z.number().nullish(),
  take_profit: z.number().nullish(),
  timeframe: z.string().default("1h"),
  rationale: z.string().min(1),
  factors: z.array(z.string()).min(1).max(8),
  pattern_name: z.string().nullish(),
  chart_drawings: z.array(z.record(z.string(), z.unknown())).optional(),
});

/**
 * Bridge: records a structured recommendation and renders its annotated
 * chart. Returns the chart URL the agent can download and send to Telegram.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());
    const settings = await getSettings(userId);

    const profile = profileForInterval(body.timeframe);
    const drawings = validateChartDrawings(
      (body.chart_drawings ?? []) as unknown as ChartDrawing[],
      body.action,
      body.confidence,
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
      symbol: normalizeIntentSymbol(body.symbol, DEFAULT_MARKET),
      action: body.action,
      confidence: body.confidence,
      entry: body.entry ?? null,
      stop_loss: body.stop_loss ?? null,
      take_profit: body.take_profit ?? null,
      timeframe: body.timeframe,
      rationale,
      factors: body.factors,
      pattern_name: body.pattern_name ?? null,
      chart_drawings_json: drawings.length ? JSON.stringify(drawings) : null,
      analysis_tier: profile.tier,
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
      `${rec.symbol} ${rec.action} ${rec.confidence}% (#${rec.id})`,
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
    });
  } catch (e) {
    return handleError(e);
  }
}
