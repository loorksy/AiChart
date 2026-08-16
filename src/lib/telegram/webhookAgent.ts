/**
 * Telegram as a first-class surface, not a notification pipe.
 *
 * Parity means the same brain answers on both surfaces. A message here runs
 * `runUnifiedChartAgent` through the same gate chain, labelled
 * `surface: "platform"`.
 *
 * Conversation window matches OpenClaw Telegram: one live bubble that
 * edits forward (progress checklist → the answer), leftover status is deleted, and
 * buttons appear only when the agent authored a question or a report link.
 * There is no persistent keyboard and no execution button.
 */
import { newId } from "@/lib/agent/activity";
import { t } from "@/lib/i18n";
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
  resolveTelegramCommand,
  telegramChartCaption,
  telegramChartFailed,
  telegramLinkedWelcome,
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
  return [[{ text: t("ar", "tg.open_report"), url: `${getPublicAppUrl()}/chat` }]];
}

/**
 * The "Called N tools" block from the owner's screenshots, Telegram-native.
 *
 * `<blockquote expandable>` collapses to its first line — "used N checks"
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
  return `<blockquote expandable>🛠 ${t("ar", "tg.tools_used", {
    count: String(finished.length),
  })}\n${lines.join("\n")}</blockquote>`;
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

const LINK_PROMPT = t("ar", "tg.link_prompt");

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
    await answerCallbackQuery(callback.callbackId, t("ar", "tg.option_expired")).catch(
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
          t("ar", "tg.link_code_invalid"),
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

    // Explicit commands are the ONE mechanical path: /chart produces a photo
    // (which the agent cannot send as prose); the other menu commands expand
    // to the Arabic prompt they stand for and ride to the agent like any
    // typed message. Everything else — greetings, identity questions — goes
    // to the agent UNCLASSIFIED: the orchestrator routes conversational vs
    // market itself and generates the reply live. The phrase lists and canned
    // paragraphs that used to answer here were a bot's reflexes, not an
    // agent's.
    const command = resolveTelegramCommand(incoming);
    if (command?.kind === "chart_photo") {
      await sendChatAction(message.chatId, "upload_photo").catch(() => {});
      const buffer = await buildChartSnapshotBufferForMarket(
        userId,
        DATA_SYMBOL,
        "15m",
        "forex",
      );
      if (!buffer) {
        await sendMessage(message.chatId, telegramChartFailed(), undefined, {
          replyToMessageId: message.messageId,
        }).catch(() => {});
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
      return "answered";
    }
    const turnMessage = command?.kind === "prompt" ? command.message : incoming;

    // ── Shared turn context: per-chat memory and session ─────────────────
    //
    // The bot was stateless between turns: no sessionId (the orchestrator
    // fell back to "default" while the option store keyed on tg:<chatId>),
    // and no conversationContext while the web chat builds one from 160
    // persisted messages. Same store, same builder, same token budget now —
    // one memory, two transports. A context failure never blocks the answer.
    const sessionId = telegramSessionId(message.chatId);
    const session = updateSessionFromMessage(sessionId, turnMessage);
    let conversationContext: AgentConversationContext | undefined;
    try {
      await ensureChat({
        id: sessionId,
        userId,
        symbol: DATA_SYMBOL,
        interval: "15m",
        title: t("ar", "tg.chat_title"),
      });
      const [persisted, recalled] = await Promise.all([
        getMessages(userId, sessionId, 160),
        recallAgentMemoryForContext({
          userId,
          query: turnMessage,
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
        userMessage: turnMessage,
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
          content: turnMessage,
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
    // ── One agent path, live narration, the right theatre by RESULT ──────
    //
    // No pre-classification: the orchestrator routes conversational vs market
    // itself. The bubble is LAZY — it does not exist until the engine's first
    // real event creates it, so a conversational run (which emits nothing by
    // design) never shows a bubble at all, and an analysis run shows a
    // checklist of the tasks actually underway with the specialist's latest
    // sentence beneath it. Nothing pre-printed ever renders: before the first
    // event, the native typing indicator is the only "working" signal.
    const live = new TelegramLiveTurn(message.chatId, message.messageId);
    const reporter = TelegramProgressReporter.forLiveTurn(live, () =>
      sendChatAction(message.chatId),
    );
    await reporter.start();

    const result = await runUnifiedChartAgent({
      surface: "platform",
      userMessage: turnMessage,
      chartContext: { symbol: DATA_SYMBOL, interval: "15m", dataSource: "oanda" },
      requestContext: {
        requestId: newId(),
        userId,
        // Both narration channels reach the bubble: stages tick the task
        // checklist; visible activity sentences — authored by the specialist
        // that just did the work — are the "thinking" the operator reads.
        emitActivity: (event) => {
          if (event.visible !== false && event.message?.trim()) {
            reporter.onActivity(event.message);
          }
        },
        emitStage: (event) => reporter.onStage(event),
        sessionId,
        session,
      },
      conversationContext,
      account: null,
      canExecute: false,
      locale: "ar",
    });
    // Stop the clocks BEFORE finalize: a trailing progress edit landing after
    // the answer would overwrite it.
    reporter.finish();

    // A conversational answer keeps a conversation's shape: the generated
    // reply alone — no cards, no suggestion chips, no report button, no tools
    // block. Everything else gets the full derived-cards answer. The split is
    // decided by what the run RETURNED, not by guessing the question's kind
    // up front.
    if (result.decision === "informational") {
      await deliverReply({
        chatId: message.chatId,
        text: escapeTelegramHtml(result.summary),
        live,
        replyToMessageId: message.messageId,
      });
      await persistTurns(result.summary, result);
      await logAudit(userId, "telegram_chat", "general");
      return "answered";
    }

    // Parity, structurally. The bespoke `analysisCard` builder that used to
    // compose this message carried a side, three levels and three reasons —
    // and silently dropped the gate checklist, the invalidation level, what
    // invalidates the plan, the cost basis and the alternative scenario, all of
    // which the same run had already computed. Deriving the message from the
    // same cards the panel renders means the phone cannot fall behind: a card
    // type added without a Telegram rendering does not compile.
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
      userMessage: turnMessage,
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
      t("ar", "tg.analysis_failed"),
    ).catch(() => {});
    return "failed";
  }
}
