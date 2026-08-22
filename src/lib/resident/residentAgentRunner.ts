/**
 * The resident AgentRunner: the agent loop wired into the host.
 *
 * user_message events run the Vercel-AI-SDK loop over the user's SESSION
 * context (Phase 2) with the resident tool set (exploration + specialists),
 * streaming the reply back through the channel sender. Scheduled ticks stay
 * the baseline's (sweep, candle sync). market_event handling arrives with
 * the notifier (Phase 6) and still refuses loudly here.
 *
 * Limit breaches surface to the user as honest, named failures — never a
 * silent half-answer.
 */
import { canonicalIdentityCore } from "@/lib/agent/canonicalIdentity";
import { appendMessage, ensureChat } from "@/lib/agent/chatHistory/chatStore";
import type { NormalizedContextMessage } from "@/lib/agent/context/types";
import { t } from "@/lib/i18n";
import { createLogger } from "@/lib/logger";
import type { ModelMessage } from "ai";
import { newId } from "@/lib/agent/activity";
import { DATA_SYMBOL } from "@/lib/gold";
import { BaselineRunner } from "./baselineRunner";
import type { AgentRunContext } from "./host";
import type { MarketEvent, UserMessageEvent } from "./events";
import {
  AgentDeadlineError,
  AgentIterationLimitError,
  AgentModelUnavailableError,
  runAgentLoop,
  type AgentLoopResult,
} from "./agentLoop";
import { buildResidentTools } from "./agentTools";
import {
  bindChannel,
  buildSessionConversationContext,
  maybeSummarizeResidentSession,
} from "./sessions";

const log = createLogger("resident.runner");

/** Per-channel thread id for history appends (context stays session-wide). */
export function channelThreadId(channel: { type: string; id: string }): string {
  return channel.type === "telegram" ? `tg:${channel.id}` : `${channel.type}:${channel.id}`;
}

/** Session context messages → model messages (tool pairs already repaired). */
export function contextToModelMessages(
  messages: NormalizedContextMessage[],
): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else {
      // Summaries, memories, and past assistant turns all read as assistant
      // context; tool internals are not replayed into a fresh loop.
      out.push({ role: "assistant", content: message.content });
    }
  }
  return out;
}

/** The Telegram presenter's full-parity turn (progress bubble, cards, photos). */
export type TelegramTurnRunner = (input: {
  userId: number;
  chatId: string;
  text: string;
  messageId?: number;
}) => Promise<"answered" | "failed">;

export interface ResidentAgentRunnerOptions {
  /** Injectable loop for tests. Defaults to the real AI-SDK loop. */
  loop?: typeof runAgentLoop;
  maxSteps?: number;
  deadlineMs?: number;
  /** Injectable Telegram turn for tests. Defaults to the real presenter. */
  telegramTurn?: TelegramTurnRunner;
}

export class ResidentAgentRunner extends BaselineRunner {
  private readonly loop: typeof runAgentLoop;
  private readonly maxSteps?: number;
  private readonly deadlineMs?: number;
  private readonly telegramTurn?: TelegramTurnRunner;

  constructor(options: ResidentAgentRunnerOptions = {}) {
    super();
    this.loop = options.loop ?? runAgentLoop;
    this.maxSteps = options.maxSteps;
    this.deadlineMs = options.deadlineMs;
    this.telegramTurn = options.telegramTurn;
  }

  override async onUserMessage(event: UserMessageEvent, ctx: AgentRunContext): Promise<void> {
    // Queued web turns (Work B): the full web pipeline runs HERE — usage
    // metering and the balance commit included — and every SSE event lands
    // in the per-turn stream the web route relays. The consumer reports
    // refusals into that stream itself and never throws for a run failure:
    // a bus retry would re-run a whole model turn, and crash redelivery is
    // XAUTOCLAIM's job with the stream's own terminal guard.
    if (event.channel.type === "web" && event.web) {
      const { runQueuedWebTurn } = await import("./webTurnConsumer");
      const outcome = await runQueuedWebTurn(event);
      log.info("web user_message answered", { turnId: event.web.turnId, outcome });
      return;
    }
    // Telegram gets the presenter's full-parity turn — the same live
    // progress bubble, derived cards, suggestion buttons, and chart photos
    // the direct webhook path produces — so riding the event queue never
    // degrades the answer. The presenter reports failures to the user
    // itself and returns a label instead of throwing; rethrowing here would
    // make the bus re-run a whole analysis whose apology was already sent.
    if (event.channel.type === "telegram") {
      const turn =
        this.telegramTurn ??
        (await import("@/lib/telegram/webhookAgent")).runTelegramAgentTurn;
      const messageId = Number(event.messageRef);
      const outcome = await turn({
        userId: event.userId,
        chatId: event.channel.id,
        text: event.text,
        messageId: Number.isFinite(messageId) ? messageId : undefined,
      });
      log.info("telegram user_message answered", { outcome });
      return;
    }
    const sender = ctx.sender(event.channel.type);
    const requestId = newId();
    const threadId = channelThreadId(event.channel);

    await bindChannel(event.channel.type, event.channel.id, event.userId);
    await ensureChat({ id: threadId, userId: event.userId, symbol: DATA_SYMBOL });
    await appendMessage(event.userId, threadId, { role: "user", content: event.text });

    const context = await buildSessionConversationContext({
      userId: event.userId,
      sessionId: threadId,
      userMessage: event.text,
      locale: "ar",
      chartContext: { symbol: DATA_SYMBOL, interval: "15m" },
    });

    try {
      const result: AgentLoopResult = await this.loop({
        system: canonicalIdentityCore(),
        messages: [
          ...contextToModelMessages(context.messages),
          { role: "user", content: event.text },
        ],
        tools: buildResidentTools({ userId: event.userId, requestId }),
        maxSteps: this.maxSteps,
        deadlineMs: this.deadlineMs,
      });

      const reply = result.text.trim() || t("ar", "resident.empty_reply");
      await sender.sendText(event.channel, reply, { replyTo: event.messageRef });
      await appendMessage(event.userId, threadId, { role: "assistant", content: reply });
      void maybeSummarizeResidentSession(event.userId).catch(() => {});
      log.info("user_message answered", {
        requestId,
        channel: event.channel.type,
        steps: result.steps,
        toolCalls: result.toolCalls.length,
      });
    } catch (err) {
      // Honest, named failure to the user — and rethrow so the host counts it.
      const key =
        err instanceof AgentIterationLimitError
          ? "resident.fault.iteration_limit"
          : err instanceof AgentDeadlineError
            ? "resident.fault.deadline"
            : err instanceof AgentModelUnavailableError
              ? "resident.fault.model_unavailable"
              : "resident.fault.generic";
      await sender
        .sendText(event.channel, t("ar", key), { replyTo: event.messageRef })
        .catch(() => {});
      throw err;
    }
  }

  override async onMarketEvent(event: MarketEvent, ctx: AgentRunContext): Promise<void> {
    // Proactive notifications (Phase 6): preference check, exactly-once
    // claim, then every bound channel. A malformed payload throws a named
    // MarketEventPayloadError — the host counts it, nothing is invented.
    const { deliverMarketEventNotification } = await import("./notifications");
    const result = await deliverMarketEventNotification(event, ctx);
    log.info("market_event handled", {
      event: event.event,
      userId: event.userId,
      outcome: result.outcome,
      delivered: result.delivered,
    });
  }
}
