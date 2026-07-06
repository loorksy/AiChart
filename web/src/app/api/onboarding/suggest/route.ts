import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import {
  getLimits,
  getTodayUsage,
  incrementUsage,
  wouldExceedQuota,
} from "@/lib/store";
import { callLLM, isLLMConfigured } from "@/lib/llm";

const SUGGEST_COST = 1;

const schema = z.object({
  maxCapital: z.number().min(10).max(1_000_000),
  dailyProfit: z.number().min(0).max(100),
  dailyLoss: z.number().min(1).max(50),
  tradingGoal: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    if (!isLLMConfigured()) {
      return NextResponse.json(
        { error: "الذكاء الاصطناعي غير مُفعّل — أضِف OPENAI_API_KEY." },
        { status: 503 },
      );
    }

    const body = schema.parse(await req.json());
    const limits = await getLimits(user.id);
    const used = await getTodayUsage(user.id);

    if (await wouldExceedQuota(user.id, SUGGEST_COST)) {
      return NextResponse.json(
        {
          error: `نفد رصيد Claude اليومي. المتبقّي ${Math.max(0, limits.claude_quota - used)}.`,
        },
        { status: 429 },
      );
    }

    const prompt = [
      "أنت مستشار تداول لمبتدئ عربي. اقترح إعدادات آمنة بناءً على:",
      `- رأس المال: ${body.maxCapital} USD`,
      `- هدف ربح يومي: ${body.dailyProfit}%`,
      `- أقصى خسارة يومية: ${body.dailyLoss}%`,
      body.tradingGoal ? `- الهدف من التداول: ${body.tradingGoal}` : "",
      "",
      "أعد JSON فقط (بدون markdown) بالحقول:",
      "mode (approval أو auto أو direct), style (conservative أو balanced أو aggressive),",
      "per_trade_pct (رقم), max_open_trades (عدد صحيح 1-5), summary_ar (فقرتان عربيتان).",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await callLLM({
      system: "أعد JSON صالحاً فقط. لا نص خارج JSON.",
      messages: [{ role: "user", content: prompt }],
      maxTokens: 450,
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");

    let parsed: Record<string, unknown>;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "تعذّر فهم اقتراح الوكيل. حاول مجدداً." },
        { status: 502 },
      );
    }

    await incrementUsage(user.id, SUGGEST_COST);

    const style = parsed.style;
    const suggestion = {
      mode:
        parsed.mode === "auto"
          ? ("auto" as const)
          : parsed.mode === "direct"
            ? ("direct" as const)
            : ("approval" as const),
      style:
        style === "balanced" || style === "aggressive"
          ? style
          : ("conservative" as const),
      per_trade_pct: Number(parsed.per_trade_pct) || 5,
      max_open_trades: Math.min(
        5,
        Math.max(1, Math.round(Number(parsed.max_open_trades) || 2)),
      ),
      summary_ar: String(
        parsed.summary_ar || "اقتراح محافظ مناسب للمبتدئين.",
      ),
    };

    return NextResponse.json({
      suggestion,
      quota: {
        used: used + SUGGEST_COST,
        limit: limits.claude_quota,
        remaining: Math.max(0, limits.claude_quota - used - SUGGEST_COST),
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
