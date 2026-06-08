import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import { getSettings, getLimits, getTodayUsage, incrementUsage, logAudit } from "@/lib/store";
import { runAgent } from "@/lib/agent";
import { isAnthropicConfigured, type Message } from "@/lib/anthropic";
import { sanitizeUserInput, wrapUserMessage } from "@/lib/security";
import { processRecommendations } from "@/lib/tradeFlow";

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
    const history: Message[] = messages.map((m, i) => {
      const isLastUser =
        m.role === "user" && i === messages.length - 1;
      if (!isLastUser) {
        return { role: m.role, content: m.content };
      }
      const sanitized = sanitizeUserInput(m.content);
      if (sanitized.flagged) {
        logAudit(user.id, "injection_blocked", sanitized.reason);
        throw new Error(
          "تم رفض الرسالة لأسباب أمنية. أعد صياغة سؤالك عن التداول فقط.",
        );
      }
      return { role: "user", content: wrapUserMessage(sanitized.text) };
    });

    const result = await runAgent({ userId: user.id, settings }, history);
    incrementUsage(user.id, 1);
    logAudit(user.id, "chat_agent", `recs=${result.recommendations.length}`);

    const intents = await processRecommendations(user.id, result.recommendations);

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
    if (err instanceof Error && err.message.includes("أمنية")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleError(err);
  }
}
