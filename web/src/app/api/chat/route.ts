import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import {
  getSettings,
  getLimits,
  getTodayUsage,
  incrementUsage,
  createIntent,
} from "@/lib/store";
import { runAgent } from "@/lib/agent";
import { executeIntent } from "@/lib/execution";
import { isAnthropicConfigured, type Message } from "@/lib/anthropic";

export const maxDuration = 60;

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { messages } = schema.parse(await req.json());

    if (!isAnthropicConfigured()) {
      return NextResponse.json(
        {
          error:
            "وكيل Claude غير مُفعّل على الخادم بعد. يحتاج المالك إلى ضبط مفتاح ANTHROPIC_API_KEY.",
        },
        { status: 503 },
      );
    }

    const limits = getLimits(user.id);
    const used = getTodayUsage(user.id);
    if (limits.claude_quota > 0 && used >= limits.claude_quota) {
      return NextResponse.json(
        { error: "بلغت حصّتك اليومية من الوكيل. حاول غداً أو تواصل مع الإدارة." },
        { status: 429 },
      );
    }

    const settings = getSettings(user.id);
    const history: Message[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const result = await runAgent({ userId: user.id, settings }, history);
    incrementUsage(user.id, 1);

    // In auto mode, turn actionable recommendations into trade intents.
    // delegate → execute now (through Risk Guard); manual → await approval.
    const intents: {
      id: number;
      symbol: string;
      side: string;
      notional: number;
      status: string;
      reason?: string;
    }[] = [];

    if (settings.mode === "auto" && limits.can_execute === 1) {
      const effectiveCapital =
        limits.max_capital_cap > 0
          ? Math.min(settings.max_capital, limits.max_capital_cap)
          : settings.max_capital;
      const perTrade = (effectiveCapital * settings.per_trade_pct) / 100;

      for (const rec of result.recommendations) {
        if (rec.action !== "buy" && rec.action !== "sell") continue;
        const delegate = settings.approval === "delegate";
        const intent = createIntent(user.id, {
          recommendation_id: rec.id,
          symbol: rec.symbol,
          side: rec.action,
          notional: perTrade,
          entry: rec.entry,
          stop_loss: rec.stop_loss,
          take_profit: rec.take_profit,
          confidence: rec.confidence,
          rationale: rec.rationale,
          status: delegate ? "approved" : "pending",
        });
        if (delegate) {
          const exec = await executeIntent(user.id, intent.id);
          intents.push({
            id: intent.id,
            symbol: intent.symbol,
            side: intent.side,
            notional: intent.notional,
            status: exec.status,
            reason: exec.reason,
          });
        } else {
          intents.push({
            id: intent.id,
            symbol: intent.symbol,
            side: intent.side,
            notional: intent.notional,
            status: "pending",
          });
        }
      }
    }

    return NextResponse.json({
      reply: result.reply,
      recommendations: result.recommendations,
      intents,
      quota: { used: used + 1, limit: limits.claude_quota },
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
