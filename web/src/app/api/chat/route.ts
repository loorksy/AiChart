import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import { getSettings, getLimits, getTodayUsage, incrementUsage, logAudit } from "@/lib/store";
import { runAgent } from "@/lib/agent";
import { isAnthropicConfigured } from "@/lib/anthropic";
import { validateChatImage } from "@/lib/chatImage";
import { sanitizeUserInput } from "@/lib/security";
import { processRecommendations } from "@/lib/tradeFlow";
import { sseEncode } from "@/lib/sse";
import {
  getConversation,
  createConversation,
  appendChatMessage,
  loadChatMessages,
  messagesToAgentHistory,
  autoTitleFromMessage,
  updateConversationTitle,
  getConversationSummary,
  countChatMessages,
} from "@/lib/conversations";

export const maxDuration = 60;

const imageSchema = z.object({
  media_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  data: z.string().min(1).max(7_000_000),
});

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40)
    .optional(),
  message: z.string().max(4000).optional(),
  image: imageSchema.optional(),
  conversationId: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
});



export async function POST(req: NextRequest) {

  try {

    const user = await requireUser();

    const body = schema.parse(await req.json());



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



    let conversationId = body.conversationId;

    let userText = body.message?.trim() ?? "";

    if (!userText && body.messages?.length) {
      const last = body.messages[body.messages.length - 1];
      if (last.role === "user") userText = last.content;
    }

    let chatImage: { media_type: "image/jpeg" | "image/png" | "image/webp"; data: string } | null =
      null;
    if (body.image) {
      const validated = validateChatImage(body.image.media_type, body.image.data);
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }
      chatImage = validated.image;
    }

    if (!userText && !chatImage) {
      return NextResponse.json({ error: "رسالة فارغة." }, { status: 400 });
    }



    if (conversationId) {

      const conv = getConversation(conversationId, user.id);

      if (!conv) {

        return NextResponse.json({ error: "المحادثة غير موجودة." }, { status: 404 });

      }

    } else {

      const conv = createConversation(user.id, autoTitleFromMessage(userText));

      conversationId = conv.id;

    }



    const sanitized = userText ? sanitizeUserInput(userText) : { text: "", flagged: false };

    if (sanitized.flagged) {
      logAudit(user.id, "injection_blocked", sanitized.reason);
      return NextResponse.json({ error: "تم رفض الرسالة لأسباب أمنية." }, { status: 400 });
    }

    const storedText =
      sanitized.text ||
      (chatImage ? "حلّل الشارت المرفق وأعطني توصية." : "");

    appendChatMessage(conversationId, "user", storedText, {
      ...(chatImage ? { image: chatImage } : {}),
    });

    const persisted = loadChatMessages(conversationId);
    const history = messagesToAgentHistory(persisted);



    const conversationSummary = getConversationSummary(conversationId);

    const stream = body.stream !== false;



    const runOpts = {

      conversationSummary,

      onActivity: undefined as ((a: import("@/lib/agentActivity").AgentActivity) => void) | undefined,

      onDelta: undefined as ((text: string) => void) | undefined,

    };



    if (stream) {

      const bodyStream = new ReadableStream({

        async start(controller) {

          const send = (event: string, data: unknown) => {

            controller.enqueue(sseEncode(event, data));

          };

          send("meta", { conversationId });

          try {

            runOpts.onActivity = (a) => send("activity", a);

            runOpts.onDelta = (text) => send("delta", { text });



            const result = await runAgent(

              { userId: user.id, settings },

              history,

              runOpts,

            );



            appendChatMessage(conversationId!, "assistant", result.reply, {

              recommendations: result.recommendations,

            });



            if (countChatMessages(conversationId!) <= 2) {

              updateConversationTitle(

                conversationId!,

                user.id,

                autoTitleFromMessage(storedText),

              );

            }



            incrementUsage(user.id, 1);

            logAudit(user.id, "chat_agent", `recs=${result.recommendations.length}`);

            const intents = await processRecommendations(

              user.id,

              result.recommendations,

            );

            send("done", {

              reply: result.reply,

              conversationId,

              recommendations: result.recommendations,

              intents,

              activities: result.activities,

              quota: { used: used + 1, limit: limits.claude_quota },

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

      history,

      { conversationSummary },

    );



    appendChatMessage(conversationId, "assistant", result.reply, {

      recommendations: result.recommendations,

    });



    incrementUsage(user.id, 1);

    logAudit(user.id, "chat_agent", `recs=${result.recommendations.length}`);

    const intents = await processRecommendations(user.id, result.recommendations);



    return NextResponse.json({

      reply: result.reply,

      conversationId,

      recommendations: result.recommendations,

      intents,

      activities: result.activities,

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


