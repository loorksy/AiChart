import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import {
  getSettings,
  getLimits,
  getTodayUsage,
  incrementUsage,
  logAudit,
} from "@/lib/store";
import { isAnthropicConfigured } from "@/lib/anthropic";
import {
  runMarketAnalyze,
  MARKET_ANALYZE_COST,
} from "@/lib/marketAnalyze";
import { profileForInterval } from "@/lib/analysisProfile";
import { sseEncode } from "@/lib/sse";
import { INTERVAL_SET } from "@/lib/intervals";

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
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = schema.parse(await req.json());

    if (!isAnthropicConfigured()) {
      return NextResponse.json(
        { error: "وكيل Claude غير مُفعّل على الخادم." },
        { status: 503 },
      );
    }

    const limits = await getLimits(user.id);
    const used = await getTodayUsage(user.id);

    if (limits.claude_quota > 0 && used + MARKET_ANALYZE_COST > limits.claude_quota) {
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

    const runOpts = {
      onActivity: undefined as
        | ((a: import("@/lib/agentActivity").AgentActivity) => void)
        | undefined,
      onDelta: undefined as ((text: string) => void) | undefined,
      telegramSession: true,
      market,
    };

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

            send("done", {
              reply: result.reply,
              overlays: result.overlays,
              drawings: result.drawings,
              recommendation: result.recommendation,
              activities: result.activities,
              intents: result.intents,
              telegramSent: result.telegramSent,
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
      { telegramSession: true, market },
    );

    await incrementUsage(user.id, MARKET_ANALYZE_COST);
    await logAudit(
      user.id,
      "market_analyze",
      `${symbol}@${interval} recs=${result.recommendation ? 1 : 0}`,
    );

    return NextResponse.json({
      reply: result.reply,
      overlays: result.overlays,
      drawings: result.drawings,
      recommendation: result.recommendation,
      activities: result.activities,
      intents: result.intents,
      telegramSent: result.telegramSent,
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
