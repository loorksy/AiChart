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
  getSettings,
  getUserByTelegramChatId,
  logAudit,
  setTelegramChatId,
  updateSettings,
} from "@/lib/store";
import { resolveUserModelSelection, withRequestModel } from "@/lib/llm";
import { withUsageContext } from "@/lib/billing/usageMeter";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import {
  ANTHROPIC_MODEL_CHOICES,
  OPENAI_MODEL_CHOICES,
  PLATFORM_DEFAULT_MODEL_REF,
  shortModelLabel,
} from "@/lib/modelCatalog";
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
import { type AgentConversationContext } from "@/lib/agent/context";
import {
  bindChannel,
  buildSessionConversationContext,
  maybeSummarizeResidentSession,
} from "@/lib/resident/sessions";
import { appendMessage, ensureChat } from "@/lib/agent/chatHistory/chatStore";
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
function reportLinkButtons(recommendationId?: number | string | null): InlineButton[][] {
  const url = recommendationId
    ? `${getPublicAppUrl()}/recommendations/${recommendationId}`
    : `${getPublicAppUrl()}/chat`;
  return [[{ text: t("ar", "tg.open_report"), url }]];
}

/**
 * The Telegram surface's own model pick.
 *
 * Telegram is a separate agent surface: same brain, same tools, its own
 * model. The pick is stored per user (`telegram_model_ref`), independent of
 * the platform composer's `preferred_model_ref`, and applied at this
 * boundary with `withRequestModel` exactly like the web routes do.
 */
const MODEL_CALLBACK_PREFIX = "mdl:";

async function offeredTelegramModels(): Promise<{ ref: string; label: string }[]> {
  const [openaiKey, anthropicKey] = await Promise.all([
    getPlatformValueAsync("OPENAI_API_KEY"),
    getPlatformValueAsync("ANTHROPIC_API_KEY"),
  ]);
  const offered: { ref: string; label: string }[] = [];
  if (anthropicKey) {
    offered.push(
      ...ANTHROPIC_MODEL_CHOICES.map((m) => ({
        ref: `anthropic/${m.id}`,
        label: shortModelLabel(m.label),
      })),
    );
  }
  if (openaiKey) {
    offered.push(
      ...OPENAI_MODEL_CHOICES.map((m) => ({
        ref: `openai/${m.id}`,
        label: shortModelLabel(m.label),
      })),
    );
  }
  return offered;
}

async function sendModelMenu(
  userId: number,
  chatId: string,
  replyToMessageId?: number,
): Promise<void> {
  const [settings, offered] = await Promise.all([
    getSettings(userId),
    offeredTelegramModels(),
  ]);
  if (!offered.length) {
    await sendMessage(chatId, t("ar", "tg.model_none"), undefined, { replyToMessageId });
    return;
  }
  const current = settings.telegram_model_ref ?? PLATFORM_DEFAULT_MODEL_REF;
  const currentLabel =
    offered.find((m) => m.ref === current)?.label ??
    shortModelLabel(current.split("/").pop() ?? current);
  const rows: InlineButton[][] = offered.map((m) => [
    {
      text: `${m.ref === current ? "✅ " : ""}${m.label}`,
      callback_data: `${MODEL_CALLBACK_PREFIX}${m.ref}`,
    },
  ]);
  const text = [
    t("ar", "tg.model_menu_title"),
    t("ar", "tg.model_current", { name: currentLabel }),
  ].join("\n");
  await sendMessage(chatId, text, rows, { replyToMessageId });
}

/** A tap on a model button: validate against the curated catalog, store, confirm. */
async function handleModelCallback(
  callback: TelegramCallback,
): Promise<"answered" | "unlinked" | "ignored"> {
  const userId = await getUserByTelegramChatId(callback.chatId);
  if (userId == null) {
    await answerCallbackQuery(callback.callbackId, t("ar", "tg.link_prompt")).catch(() => {});
    return "unlinked";
  }
  const ref = callback.data.slice(MODEL_CALLBACK_PREFIX.length);
  const selection = await resolveUserModelSelection(ref).catch(() => null);
  if (!selection) {
    await answerCallbackQuery(callback.callbackId, t("ar", "tg.model_invalid")).catch(() => {});
    return "ignored";
  }
  await updateSettings(userId, { telegram_model_ref: ref });
  await logAudit(userId, "telegram_model", ref);
  const label = shortModelLabel(selection.model);
  await answerCallbackQuery(callback.callbackId, t("ar", "tg.model_changed", { name: label })).catch(
    () => {},
  );
  const confirmation = t("ar", "tg.model_changed", { name: label });
  try {
    await editMessageText(callback.chatId, callback.messageId, confirmation);
  } catch {
    await editMessageReplyMarkup(callback.chatId, callback.messageId).catch(() => {});
  }
  return "answered";
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

export type TelegramHandleOutcome =
  | "linked"
  | "answered"
  | "unlinked"
  | "ignored"
  | "failed"
  | "queued";

/** The mechanics half of a turn: either answered here, or ready for the agent. */
export type TelegramPreparedTurn =
  | { kind: "handled"; outcome: "linked" | "answered" | "unlinked" }
  | { kind: "agent"; userId: number; text: string };

/**
 * A tap on an agent-authored option. Answer the spinner first (Telegram
 * otherwise shows a hang), strip the buttons, then treat the stored prompt
 * as the next user turn. `onMessage` decides where that turn runs: the
 * default handles it in-process; the channel adapter passes a publisher
 * that enqueues it as a resident `user_message` event instead.
 */
export async function handleTelegramCallback(
  callback: TelegramCallback,
  onMessage: (message: TelegramMessage) => Promise<TelegramHandleOutcome> = handleTelegramMessage,
): Promise<TelegramHandleOutcome> {
  if (callback.data.startsWith(MODEL_CALLBACK_PREFIX)) {
    return handleModelCallback(callback);
  }
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

  return onMessage({
    updateId: callback.updateId,
    chatId: callback.chatId,
    text: resolved.prompt,
    messageId: callback.messageId,
    from: callback.from,
  });
}

/**
 * The channel-mechanics half of one message: linking, the chart photo, the
 * model menu — everything that is about the CHANNEL rather than the market.
 * Returns either the outcome it already delivered, or the agent turn it
 * prepared (resolved user + final prompt) for whoever runs it: in-process
 * (`handleTelegramMessage`) or through the resident event queue (the
 * channel adapter).
 */
export async function prepareTelegramTurn(
  message: TelegramMessage,
): Promise<TelegramPreparedTurn> {
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
      return { kind: "handled", outcome: "unlinked" };
    }
    const userId = await consumeLinkCode(code);
    if (userId == null) {
      await sendMessage(
        message.chatId,
        t("ar", "tg.link_code_invalid"),
      );
      return { kind: "handled", outcome: "unlinked" };
    }
    await setTelegramChatId(userId, message.chatId);
    await logAudit(userId, "telegram_linked", `chat=${message.chatId}`);
    await deliverReply({
      chatId: message.chatId,
      text: telegramLinkedWelcome(),
      replyToMessageId: message.messageId,
    });
    return { kind: "handled", outcome: "linked" };
  }

  const userId = await getUserByTelegramChatId(message.chatId);
  if (userId == null) {
    await sendMessage(message.chatId, LINK_PROMPT);
    return { kind: "handled", outcome: "unlinked" };
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
      return { kind: "handled", outcome: "answered" };
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
    return { kind: "handled", outcome: "answered" };
  }
  if (command?.kind === "model_menu") {
    await sendModelMenu(userId, message.chatId, message.messageId);
    return { kind: "handled", outcome: "answered" };
  }
  const turnMessage = command?.kind === "prompt" ? command.message : incoming;
  return { kind: "agent", userId, text: turnMessage };
}

/**
 * Handle one message in-process: channel mechanics, then the agent turn.
 *
 * Returns a short outcome label for the caller's log. Never throws: an update
 * that fails must still be acknowledged, or Telegram retries it forever.
 */
export async function handleTelegramMessage(
  message: TelegramMessage,
): Promise<TelegramHandleOutcome> {
  try {
    const prepared = await prepareTelegramTurn(message);
    if (prepared.kind === "handled") return prepared.outcome;
    return await runTelegramAgentTurn({
      userId: prepared.userId,
      chatId: message.chatId,
      text: prepared.text,
      messageId: message.messageId,
    });
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

/**
 * One full-parity agent turn on the Telegram channel, for a user already
 * resolved by the channel mechanics above. This is the function the resident
 * runner calls when a `user_message` event arrives from the Telegram
 * adapter — the same turn whether the update reached us through the webhook
 * directly or through the event queue.
 */
export async function runTelegramAgentTurn(input: {
  userId: number;
  chatId: string;
  text: string;
  messageId?: number;
}): Promise<"answered" | "failed"> {
  const { userId, chatId, text: turnMessage, messageId } = input;
  const message = { chatId, messageId };
  try {
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
      // channel !== session: this chat binds into the USER's one session, so
      // a conversation started on the web continues here with full context.
      await bindChannel("telegram", message.chatId, userId);
      await ensureChat({
        id: sessionId,
        userId,
        symbol: DATA_SYMBOL,
        interval: "15m",
        title: t("ar", "tg.chat_title"),
      });
      const recalled = await recallAgentMemoryForContext({
        userId,
        query: turnMessage,
        symbol: DATA_SYMBOL,
        timeframe: "15m",
        locale: "ar",
        memoryLimit: 5,
        lessonLimit: 3,
      });
      conversationContext = await buildSessionConversationContext({
        userId,
        sessionId,
        userMessage: turnMessage,
        locale: "ar",
        chartContext: { symbol: DATA_SYMBOL, interval: "15m" },
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
      // Rolling summarization keeps the cross-channel session bounded without
      // blind truncation. Best-effort: a failure defers to the next turn.
      void maybeSummarizeResidentSession(userId, { locale: "ar" }).catch(() => {});
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

    // Telegram is its own surface with its own per-user model pick — the
    // same brain and tools answer, selected through the same validation the
    // web composer uses. An unset/unavailable pick falls back to the
    // platform default inside the LLM layer.
    const modelSelection = await resolveUserModelSelection(
      (await getSettings(userId).catch(() => null))?.telegram_model_ref,
    ).catch(() => null);
    const requestId = newId();
    const result = await withUsageContext({ userId, kind: "analysis", requestId }, () =>
      withRequestModel(modelSelection, () => runUnifiedChartAgent({
      surface: "telegram",
      liveSession: false,
      userMessage: turnMessage,
      chartContext: { symbol: DATA_SYMBOL, interval: "15m", dataSource: "oanda" },
      requestContext: {
        requestId,
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
    })));
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
        ? reportLinkButtons(result.recommendationId)
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
