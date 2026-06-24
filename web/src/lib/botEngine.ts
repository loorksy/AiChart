/**
 * Strategy bot runtime — runs deterministic rule engines (grid/martingale) on
 * the worker tier, independent of the LLM agent. Each tick: resolve a quote,
 * ask the PURE engine for ONE decision, then apply it (paper: simulate fills;
 * live: route through Risk Guard + broker adapters).
 */
import { acquireLock, releaseLock, startLeaseRenewal } from "./locks";
import { createLogger } from "./logger";
import { getForexLiveMid } from "./markets/forexPrice";
import {
  evaluateGrid,
  type GridQuote,
  type GridSide,
} from "./strategies/gridBot";
import {
  listActiveBotSessions,
  listActiveBotsForUser,
  stopBotSession,
  updateBotState,
  type BotSession,
} from "./botStore";
import {
  botsLiveEnabled,
  executeBotCloseAll,
  executeBotOpen,
  resolveBotQuote,
} from "./botExecution";
import { enqueue } from "./queue";
import { isMasterKillOn, logAudit } from "./store";

const log = createLogger("bot");

const BOT_TICK_LOCK_MS = 120_000;

export { botsLiveEnabled };

export interface BotTickEvent {
  botId: number;
  action: string;
  detail: string;
}

/** Paper quote — mid for both sides. Live uses resolveBotQuote (bid/ask). */
async function resolveQuote(
  session: BotSession,
  live: boolean,
): Promise<GridQuote | null> {
  try {
    if (live) return resolveBotQuote(session);
    if (session.market === "forex") {
      const mid = await getForexLiveMid(session.userId, session.symbol);
      return mid > 0 ? { bid: mid, ask: mid } : null;
    }
    const { getKlines } = await import("./binance");
    const candles = await getKlines(session.symbol, "1m", 1, "prod");
    const close = candles.at(-1)?.close;
    return close && close > 0 ? { bid: close, ask: close } : null;
  } catch {
    return null;
  }
}

function realizedOnClose(
  side: GridSide,
  levels: { price: number; lot: number }[],
  quote: GridQuote,
): number {
  const close = side === "sell" ? quote.ask : quote.bid;
  return levels.reduce(
    (sum, l) =>
      sum + (side === "sell" ? l.price - close : close - l.price) * l.lot,
    0,
  );
}

/** Run one tick for a single bot session. Pure-engine driven; effects here. */
export async function runBotTick(
  session: BotSession,
  quoteOverride?: GridQuote,
): Promise<BotTickEvent[]> {
  if (await isMasterKillOn()) {
    await stopBotSession(session.id, "master_kill");
    return [{ botId: session.id, action: "stopped", detail: "master_kill" }];
  }

  const live = session.executionMode === "live" && botsLiveEnabled();
  const quote = quoteOverride ?? (await resolveQuote(session, live));
  if (!quote) {
    return [{ botId: session.id, action: "skipped", detail: "no_quote" }];
  }

  const decision = evaluateGrid(session.config, session.state.levels, quote);

  if (decision.action === "hold") {
    return [
      { botId: session.id, action: "hold", detail: decision.reason },
    ];
  }

  if (decision.action === "open" && decision.lot) {
    if (live) {
      const exec = await executeBotOpen(session, decision.lot, quote);
      if (!exec.ok) {
        log.warn("live bot open failed", {
          botId: session.id,
          reason: exec.reason,
        });
        if (exec.deny) {
          await stopBotSession(session.id, `risk_deny: ${exec.reason}`);
          return [
            {
              botId: session.id,
              action: "stopped",
              detail: exec.reason,
            },
          ];
        }
        return [
          { botId: session.id, action: "skipped", detail: exec.reason },
        ];
      }
      const levels = [...session.state.levels, exec.level];
      await updateBotState(session.id, { ...session.state, levels });
      await logAudit(
        session.userId,
        "bot_grid_open",
        `bot#${session.id} LIVE ${session.side} ${exec.level.lot}@${exec.level.price} (${decision.reason})`,
      );
      return [
        {
          botId: session.id,
          action: "open",
          detail: `live ${decision.reason} lot=${exec.level.lot} @${exec.level.price}`,
        },
      ];
    }

    const fillPrice = session.side === "sell" ? quote.bid : quote.ask;
    const levels = [...session.state.levels, { price: fillPrice, lot: decision.lot }];
    await updateBotState(session.id, { ...session.state, levels });
    await logAudit(
      session.userId,
      "bot_grid_open",
      `bot#${session.id} paper ${session.side} ${decision.lot}@${fillPrice} (${decision.reason})`,
    );
    return [
      {
        botId: session.id,
        action: "open",
        detail: `${decision.reason} lot=${decision.lot} @${fillPrice}`,
      },
    ];
  }

  if (decision.action === "close_all") {
    let realized: number;
    if (live) {
      const closed = await executeBotCloseAll(session);
      if (!closed.ok) {
        return [
          {
            botId: session.id,
            action: "error",
            detail: closed.reason ?? "close_failed",
          },
        ];
      }
      realized = closed.realized;
    } else {
      realized = realizedOnClose(session.side, session.state.levels, quote);
    }
    const levelCount = session.state.levels.length;
    await updateBotState(session.id, { ...session.state, levels: [] }, realized);
    await logAudit(
      session.userId,
      "bot_grid_close",
      `bot#${session.id} closed ${levelCount} levels pnl≈${realized.toFixed(5)}${live ? " LIVE" : ""}`,
    );
    return [
      {
        botId: session.id,
        action: "close_all",
        detail: `take_profit pnl≈${realized.toFixed(5)}`,
      },
    ];
  }

  return [{ botId: session.id, action: "hold", detail: decision.reason }];
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
export async function runBotCycle(): Promise<{ users: number; events: BotTickEvent[] }> {
  const bots = await listActiveBotSessions();
  const userIds = [...new Set(bots.map((b) => b.userId))];
  const events: BotTickEvent[] = [];
  for (const userId of userIds) {
    events.push(...(await runBotTickForUser(userId)));
  }
  return { users: userIds.length, events };
}
