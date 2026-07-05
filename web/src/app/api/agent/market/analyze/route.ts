import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  getSettings,
  getLimits,
  getTodayUsage,
  incrementUsage,
  logAudit,
  isDailyQuotaEnforced,
  saveChartLayout,
  getChartLayoutById,
} from "@/lib/store";
import { isLLMConfigured } from "@/lib/llm";
import { runMarketAnalyze, MARKET_ANALYZE_COST } from "@/lib/marketAnalyze";
import { tradingStyleForInterval } from "@/lib/analysisProfile";
import { acquireAnalyzeSlot } from "@/lib/analyzeGuard";
import { INTERVAL_SET } from "@/lib/intervals";
import { resolveMt5Symbol } from "@/lib/mt5SymbolMap";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { isOandaDataOnly } from "@/lib/markets/forexDataSource";

export const maxDuration = 180;

const schema = z.object({
  symbol: z.string().min(3).max(20).optional(),
  interval: z
    .string()
    .min(2)
    .max(4)
    .optional()
    .refine((v) => v == null || INTERVAL_SET.has(v), "إطار زمني غير مدعوم"),
  market: z.enum(["crypto", "forex"]).optional(),
  data_source: z.enum(["oanda", "ea"]).optional(),
  /** Chart layout to persist the finished analysis into (renders live on the chart). */
  layout_id: z.string().regex(/^[A-Za-z0-9]{8,16}$/).optional(),
});

/**
 * Bridge: full AI market analysis for MCP agents (Claude/ChatGPT). Same
 * engine, quota and burst guards as the user-facing route; non-streaming
 * JSON. When layout_id is provided the result (drawings/recommendation) is
 * persisted into the chart layout so the open chart picks it up live.
 */
export async function POST(req: NextRequest) {
  let release: (() => void) | null = null;
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    if (!isLLMConfigured()) {
      return NextResponse.json(
        { error: "الذكاء الاصطناعي غير مُفعّل على الخادم." },
        { status: 503 },
      );
    }

    const limits = await getLimits(userId);
    const used = await getTodayUsage(userId);
    if (
      isDailyQuotaEnforced() &&
      limits.claude_quota > 0 &&
      used + MARKET_ANALYZE_COST > limits.claude_quota
    ) {
      return NextResponse.json(
        {
          error: "الرصيد غير كافٍ لتحليل جديد.",
          code: "credits_required",
          remaining: Math.max(0, limits.claude_quota - used),
        },
        { status: 429 },
      );
    }

    const slot = acquireAnalyzeSlot(userId);
    if (!slot.ok) {
      return NextResponse.json(
        {
          error:
            slot.reason === "in_flight"
              ? "لديك تحليل قيد التنفيذ بالفعل — انتظر اكتماله."
              : "المنصة تحت ضغط مرتفع حالياً — أعد المحاولة خلال ثوانٍ.",
          code: slot.reason,
        },
        { status: slot.reason === "in_flight" ? 429 : 503 },
      );
    }
    release = slot.release;

    const settings = await getSettings(userId);
    const layout = body.layout_id ? await getChartLayoutById(body.layout_id, userId) : null;
    let layoutState: { dataSource?: "oanda" | "ea" } | null = null;
    if (layout?.state_json) {
      try {
        const parsed = JSON.parse(layout.state_json) as { dataSource?: "oanda" | "ea" };
        layoutState = parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        layoutState = null;
      }
    }
    let symbol = (body.symbol ?? layout?.symbol ?? "").toUpperCase().trim();
    if (!symbol) {
      return NextResponse.json(
        { error: "symbol is required when layout_id is missing or invalid." },
        { status: 400 },
      );
    }
    const interval = body.interval ?? layout?.interval ?? "1h";
    const market = body.market ?? settings.active_market ?? "forex";
    const dataSource =
      market === "forex"
        ? isOandaDataOnly() || body.data_source === "oanda"
          ? "oanda"
          : (body.data_source ?? layoutState?.dataSource ?? "oanda")
        : undefined;
    if (market === "forex") {
      if (dataSource === "oanda") {
        symbol = forexCanonicalKey(symbol);
      } else {
        const resolved = await resolveMt5Symbol(userId, symbol);
        if (resolved) symbol = resolved;
      }
    }
    const tradingStyle = tradingStyleForInterval(interval);

    const result = await runMarketAnalyze(userId, settings, symbol, interval, {
      telegramSession: false,
      market,
      dataSource,
      tradingStyle,
    });

    await incrementUsage(userId, MARKET_ANALYZE_COST);
    await logAudit(
      userId,
      "market_analyze",
      `${symbol}@${interval} style=${tradingStyle} via=agent recs=${result.recommendation ? 1 : 0}`,
    );

    if (body.layout_id) {
      await saveChartLayout(body.layout_id, userId, {
        symbol,
        interval,
        state: {
          drawings: result.drawings,
          overlays: result.overlays,
          recommendation: result.recommendation,
          targets: result.targets,
          liveReasoningLog: result.liveReasoningLog,
          dataSource,
        },
      }).catch(() => {});
    }

    return NextResponse.json({
      reply: result.reply,
      recommendation: result.recommendation,
      targets: result.targets,
      drawings: result.drawings,
      overlays: result.overlays,
      liveReasoningLog: result.liveReasoningLog,
      profileLabel: result.profileLabel,
      analysisTier: result.analysisTier,
      contextSummary: result.contextSummary,
      data_source: dataSource,
      quota: {
        used: used + MARKET_ANALYZE_COST,
        limit: limits.claude_quota,
        remaining: Math.max(0, limits.claude_quota - used - MARKET_ANALYZE_COST),
      },
      ...(body.layout_id ? { layout_id: body.layout_id, applied_to_chart: true } : {}),
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: e.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(e);
  } finally {
    release?.();
  }
}
