/**
 * Sessions decoupled from channels.
 *
 * The core rule: channel !== session. A session belongs to a USER; a channel
 * is just a doorway into it. `channel_bindings` maps (channel_type,
 * channel_identifier) → user_id, and `resident_sessions` holds the one
 * per-user session record — the rolling cross-channel summary and its
 * cutoff. The turns themselves stay in `agent_chat_messages` (which carries
 * user_id), so "the session's history" is the user's turns across every
 * channel, read in time order.
 *
 * Context building: rolling summary first (as a protected summary message),
 * then the un-summarized cross-channel turns, then the current message —
 * compacted by the existing context builder. When un-summarized history
 * grows past a threshold, the older turns are FOLDED into the summary by an
 * LLM (quick tier) instead of being truncated blindly; on LLM failure the
 * fold is skipped and retried later, never blocking a reply.
 */
import { execute, queryOne } from "@/lib/db";
import {
  getRecentMessagesForUser,
} from "@/lib/agent/chatHistory/chatStore";
import { adaptOwnedSessionHistory } from "@/lib/agent/context/chatHistoryAdapter";
import {
  buildAgentConversationContext,
} from "@/lib/agent/context/buildAgentConversationContext";
import type {
  AgentConversationContext,
  ContextLocale,
  RawContextMessage,
  SafeMemoryContext,
  SafeTradeLessonContext,
  SafeRecommendationContext,
} from "@/lib/agent/context/types";
import type { AgentChartContext } from "@/lib/agent/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("resident.sessions");

/** Un-summarized turns beyond this trigger a fold. */
export const SUMMARIZE_AFTER_TURNS = 40;
/** The most recent turns never folded — they stay verbatim. */
export const KEEP_VERBATIM_TURNS = 16;

export interface ResidentSession {
  userId: number;
  summary: string | null;
  summaryThroughMs: number;
  summarizedTurns: number;
}

// ---------------------------------------------------------------------------
// Channel bindings
// ---------------------------------------------------------------------------

export async function bindChannel(
  channelType: string,
  channelId: string,
  userId: number,
): Promise<void> {
  await execute(
    `INSERT INTO channel_bindings (channel_type, channel_id, user_id, created_at)
     VALUES (?,?,?,?)
     ON CONFLICT (channel_type, channel_id) DO UPDATE SET user_id = excluded.user_id`,
    [channelType, channelId, userId, Date.now()],
  );
}

/**
 * Resolve a channel identity to the platform user. Two self-healing paths:
 * "web" identities ARE user ids (bound lazily), and unbound Telegram chats
 * fall back to the legacy trading_settings link and write the binding.
 */
export async function resolveChannel(
  channelType: string,
  channelId: string,
): Promise<number | null> {
  const row = await queryOne<{ user_id: number }>(
    `SELECT user_id FROM channel_bindings WHERE channel_type = ? AND channel_id = ?`,
    [channelType, channelId],
  );
  if (row) return Number(row.user_id);

  if (channelType === "web") {
    const userId = Number(channelId);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    const exists = await queryOne<{ id: number }>(`SELECT id FROM users WHERE id = ?`, [userId]);
    if (!exists) return null;
    await bindChannel("web", channelId, userId);
    return userId;
  }

  if (channelType === "telegram") {
    const legacy = await queryOne<{ user_id: number }>(
      `SELECT user_id FROM trading_settings WHERE telegram_chat_id = ?`,
      [channelId],
    );
    if (!legacy) return null;
    const userId = Number(legacy.user_id);
    await bindChannel("telegram", channelId, userId);
    return userId;
  }

  return null;
}

export async function listChannelBindings(
  userId: number,
): Promise<{ channelType: string; channelId: string }[]> {
  const { query } = await import("@/lib/db");
  const rows = await query<{ channel_type: string; channel_id: string }>(
    `SELECT channel_type, channel_id FROM channel_bindings WHERE user_id = ? ORDER BY channel_type`,
    [userId],
  );
  return rows.map((r) => ({ channelType: r.channel_type, channelId: r.channel_id }));
}

// ---------------------------------------------------------------------------
// The per-user session record
// ---------------------------------------------------------------------------

export async function getResidentSession(userId: number): Promise<ResidentSession> {
  const now = Date.now();
  await execute(
    `INSERT INTO resident_sessions (user_id, created_at, updated_at)
     VALUES (?,?,?) ON CONFLICT (user_id) DO NOTHING`,
    [userId, now, now],
  );
  const row = (await queryOne<{
    user_id: number;
    summary: string | null;
    summary_through_ms: number;
    summarized_turns: number;
  }>(`SELECT * FROM resident_sessions WHERE user_id = ?`, [userId]))!;
  return {
    userId: Number(row.user_id),
    summary: row.summary,
    summaryThroughMs: Number(row.summary_through_ms),
    summarizedTurns: Number(row.summarized_turns),
  };
}

// ---------------------------------------------------------------------------
// Cross-channel context
// ---------------------------------------------------------------------------

export interface SessionContextInput {
  userId: number;
  /** Session id handed to the context builder (per-channel thread id is fine). */
  sessionId: string;
  userMessage: string;
  locale: ContextLocale;
  chartContext?: AgentChartContext;
  activeRecommendation?: SafeRecommendationContext | null;
  recalledMemories?: SafeMemoryContext[];
  tradeLessons?: SafeTradeLessonContext[];
  tokenBudget?: number;
  includeDiagnostics?: boolean;
}

/**
 * Build the model context from the USER's session: rolling summary +
 * un-summarized turns across every channel. This is what makes "continue on
 * another channel" seamless — both channels call this, so both see the same
 * conversation.
 */
export async function buildSessionConversationContext(
  input: SessionContextInput,
): Promise<AgentConversationContext> {
  const session = await getResidentSession(input.userId);
  const persisted = await getRecentMessagesForUser(input.userId, {
    sinceMs: session.summaryThroughMs,
    limit: 160,
  });
  const messages: RawContextMessage[] = adaptOwnedSessionHistory(persisted);
  if (session.summary?.trim()) {
    messages.unshift({
      id: `session-summary-${input.userId}`,
      role: "assistant",
      kind: "summary",
      content: session.summary,
      createdAt: session.summaryThroughMs || undefined,
      important: true,
      source: "summary",
    });
  }
  return buildAgentConversationContext({
    userId: input.userId,
    chatId: input.sessionId,
    sessionId: input.sessionId,
    userMessage: input.userMessage,
    locale: input.locale,
    chartContext: input.chartContext,
    activeRecommendation: input.activeRecommendation,
    persistedMessages: messages,
    recalledMemories: input.recalledMemories,
    tradeLessons: input.tradeLessons,
    tokenBudget: input.tokenBudget ?? 2_400,
    includeDiagnostics: input.includeDiagnostics,
  });
}

// ---------------------------------------------------------------------------
// Rolling summarization
// ---------------------------------------------------------------------------

export type SessionSummarizer = (input: {
  previousSummary: string | null;
  turns: { role: "user" | "assistant"; content: string; createdAt: number }[];
  locale: ContextLocale;
}) => Promise<string>;

/** Default: fold with the quick model tier. Injectable for tests/offline. */
const llmSummarizer: SessionSummarizer = async ({ previousSummary, turns, locale }) => {
  const { callLLM } = await import("@/lib/llm");
  const { t } = await import("@/lib/i18n");
  const transcript = turns
    .map((turn) => `${turn.role === "user" ? "USER" : "AGENT"}: ${turn.content.slice(0, 600)}`)
    .join("\n");
  const res = await callLLM(
    {
      system: t(locale, "session.summarizer.system"),
      messages: [
        {
          role: "user",
          content: previousSummary
            ? `Existing summary:\n${previousSummary}\n\nNew turns to fold in:\n${transcript}`
            : `Turns to summarize:\n${transcript}`,
        },
      ],
      maxTokens: 700,
    },
    { tier: "quick" },
  );
  const text = res.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("empty summary");
  return text;
};

/**
 * Fold older un-summarized turns into the rolling summary once they exceed
 * the threshold. Best-effort by contract: a summarization failure leaves the
 * session untouched (the turns are still there) and is retried next time.
 */
export async function maybeSummarizeResidentSession(
  userId: number,
  opts: { summarize?: SessionSummarizer; locale?: ContextLocale } = {},
): Promise<{ folded: number } | { folded: 0; reason: string }> {
  const session = await getResidentSession(userId);
  const pending = await getRecentMessagesForUser(userId, {
    sinceMs: session.summaryThroughMs,
    limit: 400,
  });
  if (pending.length <= SUMMARIZE_AFTER_TURNS) {
    return { folded: 0, reason: "below_threshold" };
  }
  const fold = pending.slice(0, pending.length - KEEP_VERBATIM_TURNS);
  if (!fold.length) return { folded: 0, reason: "nothing_to_fold" };
  const summarize = opts.summarize ?? llmSummarizer;
  try {
    const summary = await summarize({
      previousSummary: session.summary,
      turns: fold.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
      locale: opts.locale ?? "ar",
    });
    const throughMs = fold[fold.length - 1]!.createdAt;
    await execute(
      `UPDATE resident_sessions
          SET summary = ?, summary_through_ms = ?,
              summarized_turns = summarized_turns + ?, updated_at = ?
        WHERE user_id = ?`,
      [summary, throughMs, fold.length, Date.now(), userId],
    );
    return { folded: fold.length };
  } catch (err) {
    log.warn("session summarization failed — deferred", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { folded: 0, reason: "summarizer_failed" };
  }
}
