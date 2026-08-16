/**
 * Telegram as a first-class surface, not a notification pipe.
 *
 * The bot was outbound-only: the platform pushed cards to it and the setup
 * route deliberately DELETED the webhook. So an operator could receive a
 * recommendation on their phone and had nowhere to ask for one — and the link
 * flow was half-built in the same way, minting a `t.me/bot?start=CODE` deep
 * link that nothing listened for. `consumeLinkCode` had no caller.
 *
 * Parity means the same brain answers on both surfaces. A message here runs the
 * SAME `runUnifiedChartAgent` the chat stream runs, through the same gate chain,
 * and is labelled `surface: "platform"` because it IS the platform's brain —
 * the transport changed, the decision path did not.
 *
 * What Telegram does NOT get is a second set of capabilities. There are no
 * execution buttons, because there is nothing to execute; the card carries a
 * link back to the platform and nothing that acts.
 */
import { newId } from "@/lib/agent/activity";
import { runUnifiedChartAgent } from "@/lib/agent/orchestrator";
import { createLogger } from "@/lib/logger";
import { DATA_SYMBOL, DISPLAY_NAME_AR } from "@/lib/gold";
import { getPublicAppUrl } from "@/lib/appUrl";
import {
  consumeLinkCode,
  getUserByTelegramChatId,
  logAudit,
  setTelegramChatId,
} from "@/lib/store";
import { sendMessage, type InlineButton } from "@/lib/telegram";
import { deriveCards } from "@/lib/agent/cards/deriveCards";
import { renderCardsForTelegram } from "@/lib/agent/cards/telegramCards";

const log = createLogger("telegram.webhook");

/** The shape this surface reads; everything else in an update is ignored. */
export interface TelegramMessage {
  updateId: number;
  chatId: string;
  text: string;
  from?: { id: number; username?: string };
}

/** Extract the one message shape this surface handles, or null. */
export function parseTelegramUpdate(update: unknown): TelegramMessage | null {
  if (!update || typeof update !== "object") return null;
  const u = update as Record<string, unknown>;
  const updateId = Number(u.update_id);
  if (!Number.isFinite(updateId)) return null;
  const message = (u.message ?? u.edited_message) as Record<string, unknown> | undefined;
  if (!message || typeof message !== "object") return null;
  const chat = message.chat as { id?: unknown } | undefined;
  const chatId = chat?.id;
  const text = message.text;
  if (chatId == null || typeof text !== "string" || !text.trim()) return null;
  const from = message.from as { id?: unknown; username?: unknown } | undefined;
  return {
    updateId,
    chatId: String(chatId),
    text: text.trim(),
    from:
      from && typeof from.id === "number"
        ? {
            id: from.id,
            username: typeof from.username === "string" ? from.username : undefined,
          }
        : undefined,
  };
}

/**
 * Updates already handled, so a Telegram retry is a no-op.
 *
 * Telegram redelivers an update until it gets a 200, and it redelivers on ITS
 * schedule rather than ours — a 40-second analysis is long enough to be retried
 * mid-flight. Without this, one question would run the whole engine twice and
 * store two recommendations for one request.
 *
 * In-memory on purpose: the window that matters is minutes, a restart clears a
 * queue Telegram has also given up on, and a database round-trip per update
 * would buy durability nobody needs for a dedupe this short-lived.
 */
const seenUpdates = new Map<number, number>();
const DEDUPE_TTL_MS = 10 * 60_000;

export function alreadyHandled(updateId: number, now = Date.now()): boolean {
  for (const [id, at] of seenUpdates) {
    if (now - at > DEDUPE_TTL_MS) seenUpdates.delete(id);
  }
  if (seenUpdates.has(updateId)) return true;
  seenUpdates.set(updateId, now);
  return false;
}

/** Test seam: the dedupe window is process-global by design. */
export function resetTelegramDedupe(): void {
  seenUpdates.clear();
}

function platformButtons(): InlineButton[][] {
  const base = getPublicAppUrl();
  // A link, never an action. There is no order to place from a phone because
  // there is no order to place at all.
  return [[{ text: "افتح المنصة", url: `${base}/chat` }]];
}

const LINK_PROMPT =
  "هذه المحادثة غير مرتبطة بحساب. افتح الإعدادات في منصة Lonora واضغط «ربط تليجرام» " +
  "لتحصل على رابط الربط، ثم عد إلى هنا.";

/**
 * `/start`, `/start@bot`, `/start CODE`, `/start@bot CODE`, or a bare
 * 12-char hex link code (what people paste when the deep link fails).
 */
export function parseTelegramStart(
  text: string,
): { code: string | null } | null {
  const start = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9]+))?$/.exec(text);
  if (start) return { code: start[1] ?? null };
  if (/^[A-Fa-f0-9]{12}$/.test(text)) return { code: text };
  return null;
}

/**
 * Handle one message.
 *
 * Returns a short outcome label for the caller's log. Never throws: an update
 * that fails must still be acknowledged, or Telegram retries it forever.
 */
export async function handleTelegramMessage(
  message: TelegramMessage,
): Promise<"linked" | "answered" | "unlinked" | "ignored" | "failed"> {
  try {
    // `/start CODE` — the deep link the platform mints. This is the caller
    // `consumeLinkCode` never had.
    const startMatch = parseTelegramStart(message.text);
    if (startMatch) {
      const code = startMatch.code;
      if (!code) {
        await sendMessage(message.chatId, LINK_PROMPT);
        return "unlinked";
      }
      const userId = await consumeLinkCode(code);
      if (userId == null) {
        await sendMessage(
          message.chatId,
          "رمز الربط غير صالح أو انتهت صلاحيته. أنشئ رمزاً جديداً من إعدادات المنصة.",
        );
        return "unlinked";
      }
      await setTelegramChatId(userId, message.chatId);
      await logAudit(userId, "telegram_linked", `chat=${message.chatId}`);
      await sendMessage(
        message.chatId,
        `تم الربط. اسألني عن ${DISPLAY_NAME_AR} وسأجيب بنفس التحليل الذي تراه في المنصة.`,
        platformButtons(),
      );
      return "linked";
    }

    const userId = await getUserByTelegramChatId(message.chatId);
    if (userId == null) {
      await sendMessage(message.chatId, LINK_PROMPT);
      return "unlinked";
    }

    // The analysis takes tens of seconds. Saying so beats a silence the
    // operator cannot tell apart from a bot that is down.
    await sendMessage(message.chatId, `أحلّل ${DISPLAY_NAME_AR} الآن…`).catch(() => {});

    const result = await runUnifiedChartAgent({
      surface: "platform",
      userMessage: message.text,
      chartContext: { symbol: DATA_SYMBOL, interval: "15m", dataSource: "oanda" },
      requestContext: { requestId: newId(), userId, emitActivity: () => {} },
      account: null,
      canExecute: false,
      locale: "ar",
    });

    // Parity, structurally. The bespoke `analysisCard` builder that used to
    // compose this message carried a side, three levels and three reasons —
    // and silently dropped the gate checklist, the invalidation level, what
    // invalidates the plan, the cost basis and the alternative scenario, all of
    // which the same run had already computed. Deriving the message from the
    // same cards the panel renders means the phone cannot fall behind: a card
    // type added without a Telegram rendering does not compile.
    //
    // A WAIT needs no special case any more. The decision card leads with the
    // refusal and the gate checklist names which gate refused, so a refusal is
    // never dressed in a plan card — there is no plan card to dress it in when
    // the levels are absent.
    const text = renderCardsForTelegram(deriveCards(result));

    await sendMessage(message.chatId, text, platformButtons());
    await logAudit(userId, "telegram_analysis", `decision=${result.decision}`);
    return "answered";
  } catch (error) {
    log.error("telegram.handle_failed", {
      chatId: message.chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    await sendMessage(
      message.chatId,
      "تعذّر إكمال التحليل الآن. حاول مرة أخرى بعد قليل.",
    ).catch(() => {});
    return "failed";
  }
}
