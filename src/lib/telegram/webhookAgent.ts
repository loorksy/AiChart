/**
 * Telegram as a first-class surface, not a notification pipe.
 *
 * Parity means the same brain answers on both surfaces. A message here runs
 * `runUnifiedChartAgent` through the same gate chain, labelled
 * `surface: "platform"`.
 *
 * Conversation window matches OpenClaw Telegram: one live bubble that
 * edits forward (أوقظ → أفكّر → الجواب), leftover status is deleted, and
 * buttons appear only when the agent authored a question or a report link.
 * There is no persistent keyboard and no execution button.
 */
import { newId } from "@/lib/agent/activity";
import { runUnifiedChartAgent } from "@/lib/agent/orchestrator";
import { rememberOptions, resolveOptionReply } from "@/lib/agent/sessionOptions";
import { generateAgentSuggestions } from "@/lib/agent/suggestions/generateAgentSuggestions";
import type { AgentOption } from "@/lib/agent/types";
import { createLogger } from "@/lib/logger";
import { DATA_SYMBOL } from "@/lib/gold";
import { getPublicAppUrl } from "@/lib/appUrl";
import {
  consumeLinkCode,
  getUserByTelegramChatId,
  logAudit,
  setTelegramChatId,
} from "@/lib/store";
import {
  answerCallbackQuery,
  dismissPersistentKeyboardOnce,
  sendChatAction,
  editMessageCaption,
  editMessageReplyMarkup,
  editMessageText,
  sendMessage,
  sendPhotoBuffer,
  type InlineButton,
} from "@/lib/telegram";
import { TelegramLiveTurn } from "@/lib/telegram/liveReply";
import {
  stageLabelAr,
  TelegramProgressReporter,
} from "@/lib/telegram/liveProgress";
import { escapeTelegramHtml, TELEGRAM_TEXT_LIMIT } from "@/lib/telegram/html";
import { updateSessionFromMessage } from "@/lib/agent/sessionMemory";
import { recallAgentMemoryForContext } from "@/lib/agent/agentMemory";
import {
  adaptAuthorizedChatHistory,
  buildAgentConversationContext,
  type AgentConversationContext,
} from "@/lib/agent/context";
import { appendMessage, ensureChat, getMessages } from "@/lib/agent/chatHistory/chatStore";
import type { AgentFinalResult } from "@/lib/agent/types";
import { deriveCards } from "@/lib/agent/cards/deriveCards";
import { renderCardsForTelegram } from "@/lib/agent/cards/telegramCards";
import { buildChartSnapshotBufferForMarket } from "@/lib/chartSnapshot";
import { getSessionStatus } from "@/lib/markets/tradingCalendar";
import {
  classifyTelegramTurn,
  telegramChartCaption,
  telegramChartFailed,
  telegramGreeting,
  telegramLinkedWelcome,
  telegramMenu,
  telegramPreparingChart,
  telegramSessionStatus,
} from "@/lib/telegram/conversation";
import {
  markChosenReply,
  rememberInlineOptions,
  resolveInlineOption,
  telegramSessionId,
} from "@/lib/telegram/inlineOptions";

const log = createLogger("telegram.webhook");

/** The shape this surface reads; everything else in an update is ignored. */
export interface TelegramMessage {
  updateId: number;
  chatId: string;
  text: string;
  messageId?: number;
  from?: { id: number; username?: string };
}

export interface TelegramCallback {
  updateId: number;
  callbackId: string;
  chatId: string;
  messageId: number;
  data: string;
  from?: { id: number; username?: string };
  messageText?: string;
  caption?: string;
  hasPhoto: boolean;
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
  const messageId = Number(message.message_id);
  return {
    updateId,
    chatId: String(chatId),
    text: text.trim(),
    messageId: Number.isFinite(messageId) ? messageId : undefined,
    from:
      from && typeof from.id === "number"
        ? {
            id: from.id,
            username: typeof from.username === "string" ? from.username : undefined,
          }
        : undefined,
  };
}

/** Extract an option tap. Execution-shaped callbacks are ignored at resolve time. */
export function parseTelegramCallback(update: unknown): TelegramCallback | null {
  if (!update || typeof update !== "object") return null;
  const u = update as Record<string, unknown>;
  const updateId = Number(u.update_id);
  if (!Number.isFinite(updateId)) return null;
  const query = u.callback_query as Record<string, unknown> | undefined;
  if (!query || typeof query !== "object") return null;
  const data = query.data;
  if (typeof data !== "string" || !data.trim()) return null;
  const id = query.id;
  if (typeof id !== "string" || !id) return null;
  const message = query.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== "object") return null;
  const chat = message.chat as { id?: unknown } | undefined;
  const chatId = chat?.id;
  const messageId = Number(message.message_id);
  if (chatId == null || !Number.isFinite(messageId)) return null;
  const from = query.from as { id?: unknown; username?: unknown } | undefined;
  return {
    updateId,
    callbackId: id,
    chatId: String(chatId),
    messageId,
    data: data.trim(),
    messageText: typeof message.text === "string" ? message.text : undefined,
    caption: typeof message.caption === "string" ? message.caption : undefined,
    hasPhoto: Array.isArray(message.photo) && message.photo.length > 0,
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

/** Like OpenClaw's "Open Report" — a link on a recommendation, not a standing menu. */
function reportLinkButtons(): InlineButton[][] {
  return [[{ text: "📊 افتح التقرير", url: `${getPublicAppUrl()}/chat` }]];
}

/**
 * The "Called N tools" block from the owner's screenshots, Telegram-native.
 *
 * `<blockquote expandable>` collapses to its first line — "استخدمت N فحوصات"
 * — and expands on tap to the per-stage checklist with the same ✓/✗ marks
 * the live bubble showed. Rendered from the stages the reporter actually
 * observed, never from a list someone maintains by hand.
 */
export function renderToolsBlock(
  stages: readonly { stage: string; status: "running" | "done" | "failed" }[],
): string {
  const finished = stages.filter((row) => row.status !== "running");
  if (!finished.length) return "";
  const lines = finished.map(
    (row) => `${row.status === "failed" ? "✗" : "✓"} ${stageLabelAr(row.stage)}`,
  );
  return `<blockquote expandable>🛠 استخدمت ${finished.length} فحوصات وأدوات\n${lines.join("\n")}</blockquote>`;
}

async function deliverReply(input: {
  chatId: string;
  text: string;
  live?: TelegramLiveTurn;
  replyToMessageId?: number;
  options?: AgentOption[];
  extraButtons?: InlineButton[][];
}): Promise<void> {
  await dismissPersistentKeyboardOnce(input.chatId);
  const optionRows = input.options?.length
    ? rememberInlineOptions(input.chatId, input.options)
    : [];
  if (input.options?.length) {
    rememberOptions(telegramSessionId(input.chatId), input.options);
  }
  const buttons = [...optionRows, ...(input.extraButtons ?? [])];
  // A bubble is EDITED into the answer, and edits cannot split. When the
  // answer exceeds one message, drop the bubble and send chunks instead —
  // sendMessage owns the splitting and puts the buttons on the last chunk.
  if (input.live && input.text.length <= TELEGRAM_TEXT_LIMIT) {
    await input.live.finalize(input.text, buttons.length ? buttons : undefined);
    return;
  }
  if (input.live) await input.live.discard();
  await sendMessage(
    input.chatId,
    input.text,
    buttons.length ? buttons : undefined,
    { replyToMessageId: input.replyToMessageId },
  );
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
 * A tap on an agent-authored option. Answer the spinner first (Telegram
 * otherwise shows a hang), strip the buttons, then treat the stored prompt
 * as the next user turn.
 */
export async function handleTelegramCallback(
  callback: TelegramCallback,
): Promise<"linked" | "answered" | "unlinked" | "ignored" | "failed"> {
  const resolved = resolveInlineOption(callback.data, callback.chatId);
  if (!resolved) {
    await answerCallbackQuery(callback.callbackId, "انتهت صلاحية هذا الخيار").catch(
      () => {},
    );
    await editMessageReplyMarkup(callback.chatId, callback.messageId).catch(() => {});
    return "ignored";
  }

  await answerCallbackQuery(callback.callbackId).catch(() => {});
  const marked = markChosenReply(
    callback.hasPhoto ? callback.caption : callback.messageText,
    resolved.label,
  );
  try {
    if (callback.hasPhoto) {
      await editMessageCaption(callback.chatId, callback.messageId, marked);
    } else {
      await editMessageText(callback.chatId, callback.messageId, marked);
    }
  } catch {
    await editMessageReplyMarkup(callback.chatId, callback.messageId).catch(() => {});
  }

  return handleTelegramMessage({
    updateId: callback.updateId,
    chatId: callback.chatId,
    text: resolved.prompt,
    messageId: callback.messageId,
    from: callback.from,
  });
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
    const optionPrompt = resolveOptionReply(
      telegramSessionId(message.chatId),
      message.text,
    );
    const incoming = optionPrompt ?? message.text;

    // `/start CODE` — the deep link the platform mints. This is the caller
    // `consumeLinkCode` never had.
    const startMatch = parseTelegramStart(incoming);
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
      await deliverReply({
        chatId: message.chatId,
        text: telegramLinkedWelcome(),
        replyToMessageId: message.messageId,
      });
      return "linked";
    }

    const userId = await getUserByTelegramChatId(message.chatId);
    if (userId == null) {
      await sendMessage(message.chatId, LINK_PROMPT);
      return "unlinked";
    }

    const turn = classifyTelegramTurn(incoming);
    if (turn.kind === "greeting") {
      await deliverReply({
        chatId: message.chatId,
        text: telegramGreeting(),
        replyToMessageId: message.messageId,
      });
      return "answered";
    }
    if (turn.kind === "menu") {
      await deliverReply({
        chatId: message.chatId,
        text: telegramMenu(),
        replyToMessageId: message.messageId,
      });
      return "answered";
    }
    if (turn.kind === "session") {
      await deliverReply({
        chatId: message.chatId,
        text: telegramSessionStatus(),
        replyToMessageId: message.messageId,
      });
      return "answered";
    }
    if (turn.kind === "chart_photo") {
      const live = new TelegramLiveTurn(message.chatId, message.messageId);
      await live.show(telegramPreparingChart()).catch(() => {});
      const buffer = await buildChartSnapshotBufferForMarket(
        userId,
        DATA_SYMBOL,
        "15m",
        "forex",
      );
      if (!buffer) {
        await live.finalize(telegramChartFailed());
        return "answered";
      }
      const closed = !getSessionStatus(DATA_SYMBOL).isOpen;
      await dismissPersistentKeyboardOnce(message.chatId);
      await sendPhotoBuffer(
        message.chatId,
        buffer,
        telegramChartCaption(closed),
        undefined,
        { replyToMessageId: message.messageId },
      );
      await live.discard();
      return "answered";
    }

    // ── Shared turn context: per-chat memory and session ─────────────────
    //
    // The bot was stateless between turns: no sessionId (the orchestrator
    // fell back to "default" while the option store keyed on tg:<chatId>),
    // and no conversationContext while the web chat builds one from 160
    // persisted messages. Same store, same builder, same token budget now —
    // one memory, two transports. A context failure never blocks the answer.
    const sessionId = telegramSessionId(message.chatId);
    const session = updateSessionFromMessage(sessionId, turn.message);
    let conversationContext: AgentConversationContext | undefined;
    try {
      await ensureChat({
        id: sessionId,
        userId,
        symbol: DATA_SYMBOL,
        interval: "15m",
        title: "محادثة تليجرام",
      });
      const [persisted, recalled] = await Promise.all([
        getMessages(userId, sessionId, 160),
        recallAgentMemoryForContext({
          userId,
          query: turn.message,
          symbol: DATA_SYMBOL,
          timeframe: "15m",
          locale: "ar",
          memoryLimit: 5,
          lessonLimit: 3,
        }),
      ]);
      conversationContext = buildAgentConversationContext({
        userId,
        chatId: sessionId,
        sessionId,
        userMessage: turn.message,
        locale: "ar",
        chartContext: { symbol: DATA_SYMBOL, interval: "15m" },
        persistedMessages: adaptAuthorizedChatHistory({
          authenticatedUserId: userId,
          ownerUserId: userId,
          authorizedChatId: sessionId,
          messages: persisted,
        }),
        recalledMemories: recalled.memories,
        tradeLessons: recalled.tradeLessons,
        tokenBudget: 2_400,
      });
    } catch (error) {
      log.warn("telegram.context.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const persistTurns = async (answer: string, result?: AgentFinalResult) => {
      try {
        await appendMessage(userId, sessionId, {
          role: "user",
          content: turn.message,
          symbol: DATA_SYMBOL,
          interval: "15m",
        });
        await appendMessage(userId, sessionId, {
          role: "assistant",
          content: answer,
          result,
          recommendationId: result?.recommendationId,
          symbol: DATA_SYMBOL,
          interval: "15m",
        });
      } catch (error) {
        log.warn("telegram.persist.failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    // ── Conversational turns: the right theatre ──────────────────────────
    //
    // "من انت" used to get the full ceremony — the wake/think bubble, a gold
    // chartContext handed to the engine for chit-chat, an EXTRA suggestions
    // LLM round-trip, and four trading chips on an identity answer. Same
    // brain (the orchestrator short-circuits general questions itself), but
    // a conversation deserves a conversation's shape: one typing indicator,
    // the summary as the whole reply, no cards, no chips.
    if (turn.kind === "general") {
      await sendChatAction(message.chatId).catch(() => {});
      const result = await runUnifiedChartAgent({
        surface: "platform",
        userMessage: turn.message,
        requestContext: { requestId: newId(), userId, emitActivity: () => {}, sessionId, session },
        conversationContext,
        account: null,
        canExecute: false,
        locale: "ar",
      });
      const answer = escapeTelegramHtml(result.summary);
      await deliverReply({
        chatId: message.chatId,
        text: answer,
        replyToMessageId: message.messageId,
      });
      await persistTurns(result.summary, result);
      await logAudit(userId, "telegram_chat", "general");
      return "answered";
    }

    // ── Analysis turns: live progress, then the full answer ──────────────
    const live = new TelegramLiveTurn(message.chatId, message.messageId);
    const reporter = TelegramProgressReporter.forLiveTurn(live, () =>
      sendChatAction(message.chatId),
    );
    await reporter.start();

    const result = await runUnifiedChartAgent({
      surface: "platform",
      userMessage: turn.message,
      chartContext: { symbol: DATA_SYMBOL, interval: "15m", dataSource: "oanda" },
      requestContext: {
        requestId: newId(),
        userId,
        emitActivity: () => {},
        // The engine has been narrating itself all along; the bubble finally
        // listens. Stage events tick the checklist the operator watches.
        emitStage: (event) => reporter.onStage(event),
        sessionId,
      },
      conversationContext,
      account: null,
      canExecute: false,
      locale: "ar",
    });
    // Stop the clocks BEFORE finalize: a trailing progress edit landing after
    // the answer would overwrite it.
    reporter.finish();

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
    //
    // The collapsed tools block is Telegram-native (<blockquote expandable>):
    // the checks that produced the answer, one tap away, never a wall.
    const text = [
      renderCardsForTelegram(deriveCards(result)),
      renderToolsBlock(reporter.snapshot()),
    ]
      .filter(Boolean)
      .join("\n\n");
    const generated = await generateAgentSuggestions({
      locale: "ar",
      userMessage: turn.message,
      result,
      symbol: DATA_SYMBOL,
      interval: "15m",
      activeRecommendation: result.activeRecommendation,
      maxSuggestions: 4,
    }).catch(() => []);
    const extraButtons =
      result.decision === "buy" || result.decision === "sell"
        ? reportLinkButtons()
        : undefined;

    await deliverReply({
      chatId: message.chatId,
      text,
      live,
      // Carried for the long-answer path: when the bubble is discarded in
      // favour of split sends, the first chunk still quotes the question.
      replyToMessageId: message.messageId,
      options: generated.length ? generated : undefined,
      extraButtons,
    });
    await persistTurns(result.summary, result);
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
