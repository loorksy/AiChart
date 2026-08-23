/**
 * The Telegram channel adapter — grammY-backed, and deliberately thin.
 *
 * Inbound: one raw webhook update (grammY's `Update` shape) is normalized
 * and dispatched — channel mechanics (linking, /chart photo, /model menu,
 * option taps) are answered here in the web process, and everything meant
 * for the agent becomes a resident `user_message` event on the queue. The
 * agent's brain never runs in this file; there is no orchestrator, no gate,
 * no model call behind these imports' mechanics paths.
 *
 * Outbound: a `ChannelSender` built on the grammY transport in
 * `@/lib/telegram`, registered on the resident host so the agent can speak
 * (text and chart images) through this channel.
 *
 * A second channel (WhatsApp) is a sibling directory implementing the same
 * two halves — never a refactor of this one.
 */
import type { Update } from "grammy/types";
import { t } from "@/lib/i18n";
import { createLogger } from "@/lib/logger";
import { publishResidentEvent } from "@/lib/resident/dispatch";
import type { ChannelRef, UserMessageEvent } from "@/lib/resident/events";
import type { ChannelSender } from "@/lib/resident/host";
import { sendMessage, sendPhotoBuffer } from "@/lib/telegram";
import { escapeTelegramHtml } from "@/lib/telegram/html";
import {
  alreadyHandled,
  handleTelegramCallback,
  localeForChat,
  parseTelegramCallback,
  parseTelegramUpdate,
  prepareTelegramTurn,
  type TelegramHandleOutcome,
  type TelegramMessage,
} from "@/lib/telegram/webhookAgent";
import type { InboundDispatchOutcome } from "../types";

const log = createLogger("channels.telegram");

/** Build the resident event one linked Telegram message becomes. */
export function telegramUserMessageEvent(input: {
  userId: number;
  chatId: string;
  text: string;
  messageId?: number;
}): UserMessageEvent {
  return {
    kind: "user_message",
    userId: input.userId,
    channel: { type: "telegram", id: input.chatId },
    text: input.text,
    ...(input.messageId != null ? { messageRef: String(input.messageId) } : {}),
    enqueuedAt: Date.now(),
  };
}

async function dispatchMessage(
  message: TelegramMessage,
): Promise<InboundDispatchOutcome> {
  const prepared = await prepareTelegramTurn(message);
  if (prepared.kind === "handled") {
    return { kind: "handled", action: prepared.outcome };
  }
  const event = telegramUserMessageEvent({
    userId: prepared.userId,
    chatId: message.chatId,
    text: prepared.text,
    messageId: message.messageId,
  });
  await publishResidentEvent(event);
  return { kind: "agent", event };
}

/** The callback path's message hook: queue the resolved prompt, don't run it. */
async function queueResolvedPrompt(
  message: TelegramMessage,
): Promise<TelegramHandleOutcome> {
  const outcome = await dispatchMessage(message);
  return outcome.kind === "agent" ? "queued" : "answered";
}

/**
 * One raw Telegram update, end to end: parse (grammY's `Update` shape),
 * dedupe (Telegram redelivers until it gets a 200, on its own schedule),
 * then answer the mechanics here or hand the agent turn to the resident
 * queue. Never throws — the webhook must always be able to acknowledge.
 */
export async function dispatchTelegramUpdate(
  raw: Update | unknown,
): Promise<InboundDispatchOutcome> {
  const callback = parseTelegramCallback(raw);
  const message = callback ? null : parseTelegramUpdate(raw);
  if (!callback && !message) {
    return { kind: "ignored", reason: "unsupported_update" };
  }
  const updateId = (callback ?? message)!.updateId;
  if (alreadyHandled(updateId)) {
    return { kind: "ignored", reason: "duplicate" };
  }
  try {
    if (callback) {
      const outcome = await handleTelegramCallback(callback, queueResolvedPrompt);
      return { kind: "handled", action: `callback:${outcome}` };
    }
    return await dispatchMessage(message!);
  } catch (error) {
    log.error("telegram.dispatch_failed", {
      updateId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Even the apology belongs to the account: the chat's linked user decides
    // the language, and an unlinked chat gets the platform default.
    const chatId = (callback ?? message)!.chatId;
    await sendMessage(
      chatId,
      t(await localeForChat(chatId), "tg.analysis_failed"),
    ).catch(() => {});
    return { kind: "handled", action: "failed" };
  }
}

/**
 * The outbound half: how the resident agent speaks Telegram. Text is
 * escaped into the HTML parse mode the transport sends with; images ride
 * grammY's InputFile upload.
 */
export function telegramChannelSender(): ChannelSender {
  const replyTo = (opts?: { replyTo?: string }) => {
    const id = Number(opts?.replyTo);
    return Number.isFinite(id) ? { replyToMessageId: id } : {};
  };
  return {
    sendText: async (channel: ChannelRef, text: string, opts?: { replyTo?: string }) => {
      await sendMessage(channel.id, escapeTelegramHtml(text), undefined, replyTo(opts));
    },
    sendPhoto: async (
      channel: ChannelRef,
      image: Buffer,
      caption?: string,
      opts?: { replyTo?: string },
    ) => {
      await sendPhotoBuffer(
        channel.id,
        image,
        caption ? escapeTelegramHtml(caption) : undefined,
        undefined,
        replyTo(opts),
      );
    },
  };
}
