/**
 * The user-scoped accessor layer for Quant Agent bots.
 *
 * Unlike `analysisStore.ts` / `monitorStore.ts`, this store owns no table in
 * web's database. Bot definitions, runs, fills and the ledger live in
 * quant-agent's own SQLite. Live orders are placed on the web side via
 * `bots/liveExecution.ts` → createIntent → executeIntent.
 *
 * Every function takes `userId` first and threads it into the service call as
 * `owner_user_id`, which the service filters on in SQL. On the way back, each
 * decoded record is re-checked against the caller — belt and braces, because
 * an ownership check that exists only on the far side of a network hop is a
 * check you cannot see in the handler you are reviewing. Both layers must
 * agree or the row is treated as absent.
 *
 * A bot belonging to someone else reads as "not found", never "forbidden":
 * distinguishing the two tells an attacker which ids exist.
 */
import { randomUUID } from "node:crypto";
import {
  createQuantBot,
  deleteQuantBot,
  getQuantBot,
  listQuantBotRuns,
  listQuantBots,
  previewQuantBot,
  setQuantBotExecutionMode,
  simulateQuantBot,
} from "./client";
import type { QuantAgentCallerContext, QuantOhlcBar } from "./types";
import type {
  CreateQuantBotParams,
  QuantBot,
  QuantBotExecutionModeWire,
  QuantBotPreview,
  QuantBotRun,
  QuantBotSimulation,
  QuantBotType,
} from "./bots/types";

/** How many bots one account may keep. Bots are cheap; unbounded lists are not. */
export const QUANT_BOT_LIST_LIMIT = 50;
export const QUANT_BOT_RUN_LIST_LIMIT = 20;

function contextFor(userId: number): QuantAgentCallerContext {
  return { userId, requestId: randomUUID() };
}

/**
 * The second half of the ownership check.
 *
 * The service already filtered on `owner_user_id`; this asserts the answer it
 * gave actually belongs to the caller. Redundant by design — if the two ever
 * disagree, the safe reading is "no such bot".
 */
function ownedBy<T extends { ownerUserId: number }>(record: T | null, userId: number): T | null {
  if (!record) return null;
  return record.ownerUserId === userId ? record : null;
}

/** Preview a config. Carries no ownership because it stores nothing. */
export async function previewBotConfig(
  userId: number,
  botType: QuantBotType,
  config: Record<string, unknown>,
): Promise<QuantBotPreview> {
  return previewQuantBot(contextFor(userId), { botType, config });
}

export async function createBot(
  userId: number,
  params: CreateQuantBotParams,
): Promise<QuantBot> {
  const bot = await createQuantBot(contextFor(userId), params);
  const owned = ownedBy(bot, userId);
  if (!owned) {
    // The service echoed back a bot that is not the caller's. Nothing sane
    // produces this; surfacing it is better than handing it to the UI.
    throw new Error("Quant Agent Service returned a bot owned by another user.");
  }
  return owned;
}

export async function listBots(userId: number): Promise<QuantBot[]> {
  const bots = await listQuantBots(contextFor(userId), QUANT_BOT_LIST_LIMIT);
  return bots.filter((bot) => bot.ownerUserId === userId);
}

export async function getBot(userId: number, botId: string): Promise<QuantBot | null> {
  return ownedBy(await getQuantBot(contextFor(userId), botId), userId);
}

export async function deleteBot(userId: number, botId: string): Promise<boolean> {
  return deleteQuantBot(contextFor(userId), botId);
}

/** Owner-only arming switch. Does not place an order. */
export async function setBotExecutionMode(
  userId: number,
  botId: string,
  executionMode: QuantBotExecutionModeWire,
): Promise<QuantBot | null> {
  const existing = await getBot(userId, botId);
  if (!existing) return null;
  const bot = await setQuantBotExecutionMode(contextFor(userId), {
    botId: existing.id,
    executionMode,
  });
  return ownedBy(bot, userId);
}

/**
 * Replay a bot the caller owns over candles the caller supplies.
 *
 * The ownership read happens HERE, before the bars are sent, so a request for
 * someone else's bot never reaches the engine at all.
 */
export async function simulateBot(
  userId: number,
  botId: string,
  bars: QuantOhlcBar[],
): Promise<QuantBotSimulation | null> {
  const bot = await getBot(userId, botId);
  if (!bot) return null;
  return simulateQuantBot(contextFor(userId), { botId: bot.id, bars });
}

export async function listBotRuns(userId: number, botId: string): Promise<QuantBotRun[] | null> {
  const bot = await getBot(userId, botId);
  if (!bot) return null;
  const runs = await listQuantBotRuns(contextFor(userId), bot.id, QUANT_BOT_RUN_LIST_LIMIT);
  return runs.filter((run) => run.ownerUserId === userId);
}
