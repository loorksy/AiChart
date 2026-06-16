import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import {
  getSettings,
  getLimits,
  getTodayUsage,
  incrementUsage,
  isDailyQuotaEnforced,
} from "@/lib/store";
import { runAgent } from "@/lib/agent";
import { isLLMConfigured } from "@/lib/llm";
import { processRecommendations } from "@/lib/tradeFlow";

const SIGNAL_COST = 5;

const rawSchema = z.object({
  symbol: z.string().min(6).max(20),
  style: z.enum(["scalp", "swing", "scalping"]),
  riskPct: z.number().min(0.5).max(10).optional(),
  riskPercent: z.number().min(0.5).max(10).optional(),
  capital: z.number().min(100).max(1_000_000),
  stopLossStyle: z.enum(["tight", "balanced", "wide", "atr"]),
  notes: z.string().max(500).optional(),
});

const schema = rawSchema.transform((raw) => {
  const riskPct = raw.riskPct ?? raw.riskPercent;
  if (riskPct == null) {
    throw new z.ZodError([
      {
        code: "custom",
        message: "riskPct or riskPercent required",
        path: ["riskPct"],
      },
    ]);
  }
  const stopMap = { atr: "balanced" } as const;
  return {
    symbol: raw.symbol,
    style: raw.style === "scalping" ? ("scalp" as const) : raw.style,
    riskPct,
    capital: raw.capital,
    stopLossStyle:
      raw.stopLossStyle === "atr" ? ("balanced" as const) : raw.stopLossStyle,
    notes: raw.notes,
  };
});

const STYLE_LABEL = { scalp: "سكالب (15m)", swing: "سوينغ (4h)" } as const;
const SL_LABEL = {
  tight: "ضيّق",
  balanced: "متوازن",
  wide: "واسع",
} as const;

export async function POST(request: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    if (!isLLMConfigured()) {
      return NextResponse.json(
        { error: "وكيل Claude غير مُفعّل." },
        { status: 503 },
      );
    }

    const body = schema.parse(await request.json());
    const limits = await getLimits(user.id);
    const used = await getTodayUsage(user.id);

    if (isDailyQuotaEnforced() && limits.claude_quota > 0 && used + SIGNAL_COST > limits.claude_quota) {
      return NextResponse.json(
        {
          error: `رصيد غير كافٍ. تحتاج ${SIGNAL_COST} رصيد، المتبقّي ${Math.max(0, limits.claude_quota - used)}.`,
        },
        { status: 429 },
      );
    }

    const settings = await getSettings(user.id);
    const timeframe = body.style === "scalp" ? "15m" : "4h";

    const prompt = [
      "أنشئ خطة إشارة تداول مفصّلة للمستخدم بناءً على المعطيات التالية:",
      `- الرمز: ${body.symbol}`,
      `- الأسلوب: ${STYLE_LABEL[body.style]} (${timeframe})`,
      `- رأس المال: $${body.capital}`,
      `- نسبة المخاطرة: ${body.riskPct}%`,
      `- أسلوب وقف الخسارة: ${SL_LABEL[body.stopLossStyle]}`,
      body.notes ? `- ملاحظات المستخدم: ${body.notes}` : "",
      "",
      "المطلوب: تحليل فني كامل، نقطة دخول، وقف خسارة، أهداف ربح، ودرجة ثقة.",
      "استخدم get_market_snapshot ثم سجّل التوصية عبر record_recommendation.",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await runAgent(
      { userId: user.id, settings },
      [{ role: "user", content: prompt }],
    );

    await incrementUsage(user.id, SIGNAL_COST);

    const intents = await processRecommendations(
      user.id,
      result.recommendations ?? [],
      { market: "crypto" },
    );

    const rec = result.recommendations?.[0];
    const recommendation = {
      entry: rec?.entry ?? null,
      targets: rec?.take_profit != null ? [rec.take_profit] : [],
      stopLoss: rec?.stop_loss ?? null,
      tradePlan: result.reply,
      action: rec?.action ?? null,
      confidence: rec?.confidence ?? null,
    };

    return NextResponse.json({
      symbol: body.symbol,
      style: body.style,
      riskPercent: body.riskPct,
      capital: body.capital,
      stopLossStyle: body.stopLossStyle,
      recommendation,
      reply: result.reply,
      recommendations: result.recommendations,
      intents,
      quota: {
        used: used + SIGNAL_COST,
        limit: limits.claude_quota,
        remaining: Math.max(0, limits.claude_quota - used - SIGNAL_COST),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
