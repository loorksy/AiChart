import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import {
  getSettings,
  getLimits,
  getTodayUsage,
  incrementUsage,
  logAudit,
  isDailyQuotaEnforced,
  saveChartLayout,
} from "@/lib/store";
import { isLLMConfigured } from "@/lib/llm";
import {
  runMarketAnalyze,
  MARKET_ANALYZE_COST,
} from "@/lib/marketAnalyze";
import {
  profileForTradingStyle,
  tradingStyleForInterval,
} from "@/lib/analysisProfile";
import { sseEncode } from "@/lib/sse";
import { INTERVAL_SET } from "@/lib/intervals";
import { validateChatImage } from "@/lib/chatImage";
import { resolveMt5Symbol } from "@/lib/mt5SymbolMap";
import { acquireAnalyzeSlot } from "@/lib/analyzeGuard";
import { TRADING_STYLES } from "@/lib/types";

export const maxDuration = 180;

const schema = z.object({
  symbol: z.string().min(3).max(20),
  interval: z
    .string()
    .min(2)
    .max(4)
    .default("1h")
    .refine((v) => INTERVAL_SET.has(v), "إطار زمني غير مدعوم"),
  market: z.string().optional(),
  data_source: z.enum(["oanda", "ea"]).optional(),
  stream: z.boolean().optional(),
  source: z.enum(["market", "smart_chart"]).optional(),
  trading_style: z.enum(TRADING_STYLES).optional(),
  image: z
    .object({
      media_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
      data: z.string().min(1),
    })
    .optional(),
  /** Chart layout to persist the finished analysis into (survives tab close). */
  layout_id: z.string().regex(/^[A-Za-z0-9]{8,16}$/).optional(),
});

export async function POST(req: NextRequest) {
  let release: (() => void) | null = null;
  try {
    const user = await requirePlatformAccess();
    const body = schema.parse(await req.json());

    if (!isLLMConfigured()) {
      return NextResponse.json(
        { error: "الذكاء الاصطناعي غير مُفعّل على الخادم — أضِف OPENAI_API_KEY." },
        { status: 503 },
      );
    }

    const limits = await getLimits(user.id);
    const used = await getTodayUsage(user.id);

    if (isDailyQuotaEnforced() && limits.claude_quota > 0 && used + MARKET_ANALYZE_COST > limits.claude_quota) {
      return NextResponse.json(
        {
          error:
            "انتهت محاولات التحليل المجانية. اشترِ رصيداً لمواصلة استخدام أدوات المنصة.",
          code: "credits_required",
          remaining: Math.max(0, limits.claude_quota - used),
        },
        { status: 429 },
      );
    }

    // Burst guards (lib/analyzeGuard): per-user single-flight + global cap.
    const slot = acquireAnalyzeSlot(user.id);
    if (!slot.ok) {
      if (slot.reason === "in_flight") {
        return NextResponse.json(
          { error: "لديك تحليل قيد التنفيذ بالفعل — انتظر اكتماله." },
          { status: 429 },
        );
      }
      return NextResponse.json(
        {
          error: "المنصة تحت ضغط مرتفع حالياً — أعد المحاولة خلال ثوانٍ.",
          code: "busy",
        },
        { status: 503, headers: { "Retry-After": "3" } },
      );
    }
    release = slot.release;

    const marketErr = rejectNonForexMarket(body.market);
    if (marketErr) {
      return NextResponse.json({ error: marketErr }, { status: 400 });
    }

    const settings = await getSettings(user.id);
    let symbol = body.symbol.toUpperCase().trim();
    const interval = body.interval;
    const market = resolveActiveMarket(body.market ?? settings.active_market ?? DEFAULT_MARKET);
    const dataSource = body.data_source ?? "oanda";
    if (market === "forex") {
      const resolved = await resolveMt5Symbol(user.id, symbol);
      if (resolved) symbol = resolved;
    }
    const tradingStyle = tradingStyleForInterval(interval);
    const profile = profileForTradingStyle(tradingStyle);
    const stream = body.stream !== false;

    let chartImage: { media_type: "image/jpeg" | "image/png" | "image/webp"; data: string } | null =
      null;
    if (body.image) {
      const validated = validateChatImage(body.image.media_type, body.image.data);
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }
      chartImage = validated.image;
    }

    const runOpts = {
      onActivity: undefined as
        | ((a: import("@/lib/agentActivity").AgentActivity) => void)
        | undefined,
      onDelta: undefined as ((text: string) => void) | undefined,
      telegramSession: false,
      market,
      dataSource,
      chartImage,
      tradingStyle,
    };

    if (stream) {
      const bodyStream = new ReadableStream({
        async start(controller) {
          // If the client closes the tab mid-analysis, enqueue throws — swallow
          // it so the analysis FINISHES server-side and gets persisted below.
          const send = (event: string, data: unknown) => {
            try {
              controller.enqueue(sseEncode(event, data));
            } catch {
              /* client gone — keep working */
            }
          };

          send("meta", {
            symbol,
            interval,
            cost: MARKET_ANALYZE_COST,
            analysisTier: profile.tier,
            profileLabel: profile.labelAr,
            trading_style: tradingStyle,
          });

          try {
            runOpts.onActivity = (a) => send("activity", a);
            runOpts.onDelta = (text) => send("delta", { text });

            const result = await runMarketAnalyze(
              user.id,
              settings,
              symbol,
              interval,
              runOpts,
            );

            await incrementUsage(user.id, MARKET_ANALYZE_COST);
            await logAudit(
              user.id,
              "market_analyze",
              `${symbol}@${interval} style=${tradingStyle} recs=${result.recommendation ? 1 : 0}`,
            );

            // Durable result: persist into the chart layout server-side so a
            // closed tab still finds the finished analysis on next open.
            if (body.layout_id) {
              await saveChartLayout(body.layout_id, user.id, {
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

            send("done", {
              reply: result.reply,
              overlays: result.overlays,
              drawings: result.drawings,
              recommendation: result.recommendation,
              activities: result.activities,
              intents: result.intents,
              telegramSent: result.telegramSent,
              telegramReasonAr: result.telegramReasonAr,
              chartVisionSource: result.chartVisionSource,
              contextSummary: result.contextSummary,
              profileLabel: result.profileLabel,
              analysisTier: result.analysisTier,
              liveReasoningLog: result.liveReasoningLog,
              targets: result.targets,
              quota: {
                used: used + MARKET_ANALYZE_COST,
                limit: limits.claude_quota,
                remaining: Math.max(
                  0,
                  limits.claude_quota - used - MARKET_ANALYZE_COST,
                ),
              },
            });
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "حدث خطأ غير متوقع.";
            send("error", { error: message });
          } finally {
            release?.();
          }

          try {
            controller.close();
          } catch {
            /* already closed by client disconnect */
          }
        },
      });

      return new Response(bodyStream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    let result: Awaited<ReturnType<typeof runMarketAnalyze>>;
    try {
      result = await runMarketAnalyze(
        user.id,
        settings,
        symbol,
        interval,
        { telegramSession: false, market, dataSource, chartImage, tradingStyle },
      );
    } finally {
      release?.();
    }

    await incrementUsage(user.id, MARKET_ANALYZE_COST);
    await logAudit(
      user.id,
      "market_analyze",
      `${symbol}@${interval} style=${tradingStyle} recs=${result.recommendation ? 1 : 0}`,
    );

    if (body.layout_id) {
      await saveChartLayout(body.layout_id, user.id, {
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
      overlays: result.overlays,
      drawings: result.drawings,
      recommendation: result.recommendation,
      activities: result.activities,
      intents: result.intents,
      telegramSent: result.telegramSent,
      telegramReasonAr: result.telegramReasonAr,
      chartVisionSource: result.chartVisionSource,
      contextSummary: result.contextSummary,
      profileLabel: result.profileLabel,
      analysisTier: result.analysisTier,
      liveReasoningLog: result.liveReasoningLog,
      targets: result.targets,
      quota: {
        used: used + MARKET_ANALYZE_COST,
        limit: limits.claude_quota,
        remaining: Math.max(0, limits.claude_quota - used - MARKET_ANALYZE_COST),
      },
    });
  } catch (err) {
    release?.();
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}
