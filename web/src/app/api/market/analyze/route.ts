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
import { runAgent } from "@/lib/agent";
import { isAnthropicConfigured } from "@/lib/anthropic";
import { buildSnapshot } from "@/lib/market";
import { overlaysFromAnalysis } from "@/lib/chartOverlays";
import { sseEncode } from "@/lib/sse";
export const maxDuration = 60;

const ANALYZE_COST = 3;

const schema = z.object({
  symbol: z.string().min(6).max(20),
  interval: z.string().min(2).max(4).default("1h"),
  stream: z.boolean().optional(),
});

function buildAnalyzePrompt(symbol: string, interval: string, snap: Awaited<ReturnType<typeof buildSnapshot>>) {
  return [
    `حلّل ${symbol} على إطار ${interval} تقنياً بالعربية.`,
    `البيانات الحالية: ${snap.summary}`,
    snap.rsi14 != null ? `RSI(14): ${snap.rsi14.toFixed(1)}` : "",
    snap.sma20 != null ? `SMA20: ${snap.sma20.toFixed(2)}` : "",
    snap.sma50 != null ? `SMA50: ${snap.sma50.toFixed(2)}` : "",
    `الاتجاه: ${snap.trend === "uptrend" ? "صاعد" : snap.trend === "downtrend" ? "هابط" : "عرضي"}`,
    "",
    "المطلوب: تحليل فني مفصّل مع مستويات دخول ووقف خسارة وجني أرباح ودعم ومقاومة.",
    "استخدم get_market_snapshot إن لزم ثم سجّل التوصية عبر record_recommendation مع entry و stop_loss و take_profit محددة.",
  ]
    .filter(Boolean)
    .join("\n");
}

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

    if (limits.claude_quota > 0 && used + ANALYZE_COST > limits.claude_quota) {
      return NextResponse.json(
        {
          error: `رصيد غير كافٍ. تحتاج ${ANALYZE_COST} رصيد، المتبقّي ${Math.max(0, limits.claude_quota - used)}.`,
        },
        { status: 429 },
      );
    }

    const settings = await getSettings(user.id);
    const symbol = body.symbol.toUpperCase().trim();
    const interval = body.interval;
    const snap = await buildSnapshot(symbol, interval);
    const prompt = buildAnalyzePrompt(symbol, interval, snap);
    const stream = body.stream !== false;

    const runOpts = {
      onActivity: undefined as
        | ((a: import("@/lib/agentActivity").AgentActivity) => void)
        | undefined,
      onDelta: undefined as ((text: string) => void) | undefined,
    };

    if (stream) {
      const bodyStream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            controller.enqueue(sseEncode(event, data));
          };

          send("meta", { symbol, interval, cost: ANALYZE_COST });

          try {
            runOpts.onActivity = (a) => send("activity", a);
            runOpts.onDelta = (text) => send("delta", { text });

            const result = await runAgent(
              { userId: user.id, settings },
              [{ role: "user", content: prompt }],
              runOpts,
            );

            await incrementUsage(user.id, ANALYZE_COST);
            await logAudit(
              user.id,
              "market_analyze",
              `${symbol}@${interval} recs=${result.recommendations.length}`,
            );

            const rec = result.recommendations.find(
              (r) => r.symbol === symbol,
            ) ?? result.recommendations[0];
            const overlays = overlaysFromAnalysis(rec, snap);

            send("done", {
              reply: result.reply,
              overlays,
              recommendation: rec ?? null,
              activities: result.activities,
              quota: {
                used: used + ANALYZE_COST,
                limit: limits.claude_quota,
                remaining: Math.max(0, limits.claude_quota - used - ANALYZE_COST),
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

    const result = await runAgent(
      { userId: user.id, settings },
      [{ role: "user", content: prompt }],
    );

    await incrementUsage(user.id, ANALYZE_COST);
    await logAudit(
      user.id,
      "market_analyze",
      `${symbol}@${interval} recs=${result.recommendations.length}`,
    );

    const rec = result.recommendations.find((r) => r.symbol === symbol) ??
      result.recommendations[0];
    const overlays = overlaysFromAnalysis(rec, snap);

    return NextResponse.json({
      reply: result.reply,
      overlays,
      recommendation: rec ?? null,
      activities: result.activities,
      quota: {
        used: used + ANALYZE_COST,
        limit: limits.claude_quota,
        remaining: Math.max(0, limits.claude_quota - used - ANALYZE_COST),
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
