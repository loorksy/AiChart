import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import {
  getSettings,
  getLimits,
  getTodayUsage,
  incrementUsage,
  logAudit,
  isDailyQuotaEnforced,
} from "@/lib/store";
import { isLLMConfigured } from "@/lib/llm";
import {
  runMarketAnalyze,
  MARKET_ANALYZE_COST,
} from "@/lib/marketAnalyze";
import { profileForInterval } from "@/lib/analysisProfile";
import { sseEncode } from "@/lib/sse";
import { INTERVAL_SET } from "@/lib/intervals";
import { validateChatImage } from "@/lib/chatImage";
import {
  appendChatMessage,
  getConversation,
} from "@/lib/conversations";

export const maxDuration = 60;

const schema = z.object({
  symbol: z.string().min(3).max(20),
  interval: z
    .string()
    .min(2)
    .max(4)
    .default("1h")
    .refine((v) => INTERVAL_SET.has(v), "إطار زمني غير مدعوم"),
  market: z.enum(["crypto", "forex"]).optional(),
  stream: z.boolean().optional(),
  conversationId: z.number().int().positive().optional(),
  persistToChat: z.boolean().optional(),
  source: z.enum(["market", "chat_chart"]).optional(),
  image: z
    .object({
      media_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
      data: z.string().min(1),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const body = schema.parse(await req.json());

    if (!isLLMConfigured()) {
      return NextResponse.json(
        { error: "وكيل Claude غير مُفعّل على الخادم." },
        { status: 503 },
      );
    }

    const limits = await getLimits(user.id);
    const used = await getTodayUsage(user.id);

    if (isDailyQuotaEnforced() && limits.claude_quota > 0 && used + MARKET_ANALYZE_COST > limits.claude_quota) {
      return NextResponse.json(
        {
          error: `رصيد غير كافٍ. تحتاج ${MARKET_ANALYZE_COST} رصيد، المتبقّي ${Math.max(0, limits.claude_quota - used)}.`,
        },
        { status: 429 },
      );
    }

    const settings = await getSettings(user.id);
    const symbol = body.symbol.toUpperCase().trim();
    const interval = body.interval;
    const market = body.market ?? settings.active_market ?? "crypto";
    const profile = profileForInterval(interval);
    const stream = body.stream !== false;
    const persistToChat =
      body.persistToChat !== false && body.conversationId != null;

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
      chartImage,
    };

    async function persistAnalysisResult(
      result: Awaited<ReturnType<typeof runMarketAnalyze>>,
    ) {
      if (!persistToChat || !body.conversationId) return;
      const conv = await getConversation(body.conversationId, user.id);
      if (!conv) return;

      const source = body.source ?? "market";
      // chat_chart: الواجهة أضافت رسالة المستخدم بالفعل — نخزّن ردّ المساعد فقط.
      if (source !== "chat_chart") {
        await appendChatMessage(
          conv.id,
          "user",
          `تحليل ${symbol} · ${interval}`,
          { analysis_source: source, symbol, interval, market, type: "chart_analyze" },
        );
      }
      await appendChatMessage(conv.id, "assistant", result.reply, {
        analysis_source: source,
        symbol,
        interval,
        market,
        drawings: result.drawings,
        recommendation_id: result.recommendation?.id ?? null,
        chart_vision: result.chartVisionSource,
      });
    }

    if (stream) {
      const bodyStream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            controller.enqueue(sseEncode(event, data));
          };

          send("meta", {
            symbol,
            interval,
            cost: MARKET_ANALYZE_COST,
            analysisTier: profile.tier,
            profileLabel: profile.labelAr,
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
              `${symbol}@${interval} recs=${result.recommendation ? 1 : 0}`,
            );

            await persistAnalysisResult(result);

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
          }

          controller.close();
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

    const result = await runMarketAnalyze(
      user.id,
      settings,
      symbol,
      interval,
      { telegramSession: false, market, chartImage },
    );

    await incrementUsage(user.id, MARKET_ANALYZE_COST);
    await logAudit(
      user.id,
      "market_analyze",
      `${symbol}@${interval} recs=${result.recommendation ? 1 : 0}`,
    );

    await persistAnalysisResult(result);

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
      quota: {
        used: used + MARKET_ANALYZE_COST,
        limit: limits.claude_quota,
        remaining: Math.max(0, limits.claude_quota - used - MARKET_ANALYZE_COST),
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}
