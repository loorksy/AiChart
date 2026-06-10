import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { saveRecommendation } from "@/lib/store";
import { profileForInterval } from "@/lib/analysisProfile";
import { validateChartDrawings, type ChartDrawing } from "@/lib/chartDrawings";
import { attachChartToRecommendation } from "@/lib/recommendationChart";

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
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const body = schema.parse(await req.json());

    const profile = profileForInterval(body.timeframe);
    const drawings = validateChartDrawings(
      (body.chart_drawings ?? []) as unknown as ChartDrawing[],
      body.action,
      body.confidence,
      profile,
    );

    const rec = await saveRecommendation(userId, {
      symbol: body.symbol.toUpperCase(),
      action: body.action,
      confidence: body.confidence,
      entry: body.entry ?? null,
      stop_loss: body.stop_loss ?? null,
      take_profit: body.take_profit ?? null,
      timeframe: body.timeframe,
      rationale: body.rationale,
      factors: body.factors,
      pattern_name: body.pattern_name ?? null,
      chart_drawings_json: drawings.length ? JSON.stringify(drawings) : null,
      analysis_tier: profile.tier,
    });

    // The agent delivers messages itself (OpenClaw channel) — no web notify.
    const { rec: enriched } = await attachChartToRecommendation(userId, rec, {
      notify: false,
      drawings,
    });

    return NextResponse.json({
      ok: true,
      recommendation: enriched,
      chart_url: `/api/agent/chart/${enriched.id}`,
    });
  } catch (e) {
    return handleError(e);
  }
}
