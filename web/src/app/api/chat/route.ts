import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getSettings, getLimits, getTodayUsage, incrementUsage, logAudit, isDailyQuotaEnforced, listIntents } from "@/lib/store";
import { runCopilot } from "@/lib/copilot";
import { isLLMConfigured } from "@/lib/llm";
import { validateChatImage } from "@/lib/chatImage";
import { sanitizeUserInput } from "@/lib/security";
import { processRecommendations, type ProcessedIntent } from "@/lib/tradeFlow";
import type { Recommendation } from "@/lib/types";
import { sseEncode } from "@/lib/sse";
import { extractUISchema } from "@/lib/uiSchema";
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
import { enqueue } from "@/lib/queue";

export const maxDuration = 60;

/** Highest existing intent id for the user — marks the boundary of "this turn". */
async function latestIntentId(userId: number): Promise<number> {
  const [last] = await listIntents(userId, undefined, 1);
  return last?.id ?? 0;
}

/**
 * Intents to render as cards in the chat for this turn:
 * - intents derived from recommendations (record_recommendation), plus
 * - pending intents the agent created directly via open_trade / request_approval
 *   (these are NOT in `recommendations`, so without this they'd only reach
 *   Telegram and never show as a card in the web chat).
 */
async function intentsForTurn(
  userId: number,
  beforeMaxIntentId: number,
  recommendations: Recommendation[],
): Promise<ProcessedIntent[]> {
  const merged = await processRecommendations(userId, recommendations, {
    allowAdvisoryApproval: true,
  });
  const pending = await listIntents(userId, "pending", 20);
  for (const i of pending) {
    if (i.id <= beforeMaxIntentId) continue;
    if (merged.some((m) => m.id === i.id)) continue;
    merged.push({
      id: i.id,
      symbol: i.symbol,
      side: i.side,
      notional: i.notional,
      status: i.status,
      reason: i.reason ?? undefined,
    });
  }
  return merged;
}

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
  attachments: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        content: z.string(),
      })
    )
    .optional(),
  /** Selections from the chat start screen (applied on the first message). */
  start_context: z
    .object({
      trading_style: z.enum(["scalp", "day", "swing", "position"]).optional(),
      mode: z.enum(["auto", "approval", "direct"]).optional(),
      active_market: z.enum(["crypto", "forex"]).optional(),
      response_mode: z.enum(["fast", "expert", "vision"]).optional(),
      symbol: z.string().max(20).optional(),
    })
    .optional(),
});



export async function POST(req: NextRequest) {

  try {

    const user = await requirePlatformAccess();

    const body = schema.parse(await req.json());



    if (!isLLMConfigured()) {

      return NextResponse.json(

        {

          error:

            "وكيل Claude غير مُفعّل على الخادم بعد. يحتاج المالك إلى ضبط مفتاح ANTHROPIC_API_KEY.",

        },

        { status: 503 },

      );

    }



    const limits = await getLimits(user.id);

    const used = await getTodayUsage(user.id);

    if (isDailyQuotaEnforced() && limits.claude_quota > 0 && used >= limits.claude_quota) {

      return NextResponse.json(

        { error: "بلغت حصّتك اليومية من الوكيل. حاول غداً أو تواصل مع الإدارة." },

        { status: 429 },

      );

    }



    // Apply chat start-screen selections (style/mode/market) in-process before
    // loading settings, so this turn already reflects them.
    const startCtx = body.start_context;
    if (startCtx) {
      const patch: Record<string, unknown> = {};
      if (startCtx.trading_style) patch.trading_style = startCtx.trading_style;
      if (startCtx.mode) patch.mode = startCtx.mode;
      if (startCtx.active_market) patch.active_market = startCtx.active_market;
      if (Object.keys(patch).length) {
        const { updateSettings } = await import("@/lib/store");
        await updateSettings(user.id, patch);
      }
    }
    const responseMode = startCtx?.response_mode;

    const settings = await getSettings(user.id);



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

    if (!userText && !chatImage && (!body.attachments || body.attachments.length === 0)) {
      return NextResponse.json({ error: "رسالة فارغة." }, { status: 400 });
    }



    const sanitized = userText ? sanitizeUserInput(userText) : { text: "", flagged: false };

    if (sanitized.flagged) {
      await logAudit(user.id, "injection_blocked", sanitized.reason);
      return NextResponse.json({ error: "تم رفض الرسالة لأسباب أمنية." }, { status: 400 });
    }

    let storedText =
      sanitized.text ||
      (chatImage ? "حلّل الشارت المرفق وأعطني توصية." : "");

    if (body.attachments && body.attachments.length > 0) {
      const attachmentsText = body.attachments
        .map((att) => `[Attachment: ${att.name} (${att.type})]\n${att.content}`)
        .join("\n\n");
      storedText = storedText ? `${storedText}\n\n${attachmentsText}` : attachmentsText;
    }

    if (conversationId) {
      const conv = await getConversation(conversationId, user.id);
      if (!conv) {
        return NextResponse.json({ error: "المحادثة غير موجودة." }, { status: 404 });
      }
    } else {
      const conv = await createConversation(user.id, autoTitleFromMessage(storedText));
      conversationId = conv.id;
    }

    await appendChatMessage(conversationId, "user", storedText, {
      ...(chatImage ? { image: chatImage } : {}),
    });

    const persisted = await loadChatMessages(conversationId);
    const history = messagesToAgentHistory(persisted);



    const conversationSummary = await getConversationSummary(conversationId);

    const stream = body.stream !== false;



    const runOpts = {
      conversationSummary,
      responseMode,
      hasImage: chatImage ? true : false,
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



            const beforeMaxIntentId = await latestIntentId(user.id);

            const result = await runCopilot(
              user.id,
              conversationId!,
              storedText,
              history,
              runOpts,
            );

            const extracted = extractUISchema(result.reply);
            const cleanText = extracted.cleanText;
            // Prefer the schema emitted via the reliable render_cards tool; fall
            // back to a fenced block in the reply text if present.
            const uiSchema = result.uiSchema ?? extracted.uiSchema;

            const intents = await intentsForTurn(
              user.id,
              beforeMaxIntentId,
              result.recommendations,
            );

            await appendChatMessage(
              conversationId!,
              "assistant",
              cleanText,
              {
                recommendations: result.recommendations,
                intents,
                question: result.question || null,
                ui_schema: uiSchema,
              },
              result.reasoningSummary,
              result.toolCallsJson,
            );

            void enqueue("memory_lifecycle", {
              userId: user.id,
              conversationId: conversationId!,
            });

            if ((await countChatMessages(conversationId!)) <= 2) {
              await updateConversationTitle(
                conversationId!,
                user.id,
                autoTitleFromMessage(storedText),
              );
            }

            await incrementUsage(user.id, 1);
            await logAudit(user.id, "chat_agent", `recs=${result.recommendations.length}`);

            send("done", {
              reply: cleanText,
              conversationId,
              recommendations: result.recommendations,
              intents,
              activities: result.activities,
              quota: { used: used + 1, limit: limits.claude_quota },
              question: result.question || null,
              ui_schema: uiSchema,
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



    const beforeMaxIntentId = await latestIntentId(user.id);

    const result = await runCopilot(
      user.id,
      conversationId,
      storedText,
      history,
      { conversationSummary, responseMode, hasImage: chatImage ? true : false },
    );

    const extracted = extractUISchema(result.reply);
    const cleanText = extracted.cleanText;
    // Prefer the schema emitted via the reliable render_cards tool; fall back to
    // a fenced block in the reply text if present.
    const uiSchema = result.uiSchema ?? extracted.uiSchema;

    const intents = await intentsForTurn(
      user.id,
      beforeMaxIntentId,
      result.recommendations,
    );

    await appendChatMessage(
      conversationId,
      "assistant",
      cleanText,
      {
        recommendations: result.recommendations,
        intents,
        question: result.question || null,
        ui_schema: uiSchema,
      },
      result.reasoningSummary,
      result.toolCallsJson,
    );

    void enqueue("memory_lifecycle", {
      userId: user.id,
      conversationId,
    });

    await incrementUsage(user.id, 1);
    await logAudit(user.id, "chat_agent", `recs=${result.recommendations.length}`);

    return NextResponse.json({
      reply: cleanText,
      conversationId,
      recommendations: result.recommendations,
      intents,
      activities: result.activities,
      quota: { used: used + 1, limit: limits.claude_quota },
      question: result.question || null,
      ui_schema: uiSchema,
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

// Memory lifecycle now runs as a background `memory_lifecycle` job (see
// lib/memoryLifecycle.ts), enqueued above instead of inline on the request.


