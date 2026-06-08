import { runAgent } from "./agent";
import { isAnthropicConfigured } from "./anthropic";
import type { ChatImagePayload } from "./chatImage";
import { sanitizeUserInput } from "./security";
import { processRecommendations } from "./tradeFlow";
import {
  getSettings,
  incrementUsage,
  wouldExceedQuota,
  logAudit,
} from "./store";
import {
  getOrCreateTelegramConversation,
  appendChatMessage,
  loadChatMessages,
  messagesToAgentHistory,
  getConversationSummary,
} from "./conversations";

export type TelegramAgentResult =
  | { ok: true; reply: string }
  | { ok: false; error: string };

/** Runs the expert agent for a Telegram free-text message (chat parity). */
export async function runTelegramAgentChat(
  userId: number,
  rawText: string,
  image?: ChatImagePayload | null,
): Promise<TelegramAgentResult> {
  if (!isAnthropicConfigured()) {
    return {
      ok: false,
      error: "الوكيل غير مُفعّل على الخادم بعد. · Agent not configured yet.",
    };
  }

  if (wouldExceedQuota(userId, 1)) {
    return {
      ok: false,
      error:
        "بلغت حصّتك اليومية من الوكيل. حاول غداً أو تواصل مع الإدارة.\n" +
        "Daily agent quota reached. Try again tomorrow or contact support.",
    };
  }

  const sanitized = rawText.trim()
    ? sanitizeUserInput(rawText)
    : { text: "", flagged: false };
  if (sanitized.flagged) {
    return {
      ok: false,
      error: "تم رفض الرسالة لأسباب أمنية. · Message blocked for security.",
    };
  }

  if (!sanitized.text && !image) {
    return {
      ok: false,
      error: "أرسل نصاً أو صورة شارت للتحليل. · Send text or a chart image.",
    };
  }

  const storedText =
    sanitized.text ||
    (image ? "حلّل الشارت المرفق وأعطني توصية." : "");

  const conv = getOrCreateTelegramConversation(userId);
  appendChatMessage(conv.id, "user", storedText, {
    ...(image ? { image } : {}),
  });

  const persisted = loadChatMessages(conv.id);
  const history = messagesToAgentHistory(persisted);

  const settings = getSettings(userId);
  const result = await runAgent(
    { userId, settings },
    history,
    { conversationSummary: getConversationSummary(conv.id) },
  );

  appendChatMessage(conv.id, "assistant", result.reply, {
    recommendations: result.recommendations,
  });

  incrementUsage(userId, 1);
  logAudit(userId, "telegram_agent", `recs=${result.recommendations.length}`);
  await processRecommendations(userId, result.recommendations);

  const reply = result.reply.trim();
  const text = reply.length > 4000 ? `${reply.slice(0, 3997)}…` : reply;
  return { ok: true, reply: text };
}
