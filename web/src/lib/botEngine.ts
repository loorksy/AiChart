/**
 * Strategy bot runtime router — dispatches grid vs gold engines.
 */
import { acquireLock, releaseLock, startLeaseRenewal } from "./locks";
import {
  listActiveBotSessions,
  listActiveBotsForUser,
  type BotSession,
} from "./botStore";
import { runGridBotTick } from "./botEngines/gridBotEngine";
import { runGoldBotTick } from "./botEngines/goldAgentEngine";
import { enqueue } from "./queue";
import { botsLiveEnabled } from "./botExecution";
import type { GridQuote } from "./strategies/gridBot";

const BOT_TICK_LOCK_MS = 120_000;

export { botsLiveEnabled };

export interface BotTickEvent {
  botId: number;
  action: string;
  detail: string;
}

/** Run one tick — routes by strategy. */
export async function runBotTick(
  session: BotSession,
  quoteOverride?: GridQuote,
): Promise<BotTickEvent[]> {
  if (session.strategy === "gold") {
    return runGoldBotTick(session, quoteOverride);
  }
  return runGridBotTick(session, quoteOverride);
}

/** Process every active bot for a user, guarded by a per-user lock. */
export async function runBotTickForUser(
  userId: number,
): Promise<BotTickEvent[]> {
  const lock = await acquireLock(`bot:user:${userId}`, BOT_TICK_LOCK_MS);
  if (!lock) return [{ botId: 0, action: "skipped", detail: "locked" }];
  const renew = startLeaseRenewal(lock, BOT_TICK_LOCK_MS);
  const events: BotTickEvent[] = [];
  try {
    const bots = await listActiveBotsForUser(userId);
    for (const bot of bots) {
      try {
        events.push(...(await runBotTick(bot)));
      } catch (e) {
        events.push({
          botId: bot.id,
          action: "error",
          detail: e instanceof Error ? e.message : "error",
        });
      }
    }
  } finally {
    renew.stop();
    await releaseLock(lock);
  }
  return events;
}

/** Cron entry: dispatch one bot_tick job per user with active bots. */
export async function dispatchBotCycle(): Promise<{ dispatched: number }> {
  const bots = await listActiveBotSessions();
  const userIds = [...new Set(bots.map((b) => b.userId))];
  for (const userId of userIds) {
    await enqueue("bot_tick", { userId });
  }
  return { dispatched: userIds.length };
}

/** Inline cycle (no queue) — runs all users' bots in-process. */
export async function runBotCycle(): Promise<{
  users: number;
  events: BotTickEvent[];
}> {
  const bots = await listActiveBotSessions();
  const userIds = [...new Set(bots.map((b) => b.userId))];
  const events: BotTickEvent[] = [];
  for (const userId of userIds) {
    events.push(...(await runBotTickForUser(userId)));
  }
  return { users: userIds.length, events };
}
