/**
 * Grid bot tick engine — unchanged logic moved from botEngine.ts.
 */
import { createLogger } from "../logger";
import { getForexLiveMid } from "../markets/forexPrice";
import {
  evaluateGrid,
  type GridConfig,
  type GridLevel,
  type GridQuote,
  type GridSide,
} from "../strategies/gridBot";
import {
  stopBotSession,
  updateBotState,
  type BotSession,
} from "../botStore";
import {
  botsLiveEnabled,
  executeBotCloseAll,
  executeBotOpen,
  resolveBotQuote,
} from "../botExecution";
import { isMasterKillOn, logAudit } from "../store";
import type { BotTickEvent } from "../botEngine";

const log = createLogger("bot.grid");

function isGridSession(session: BotSession): boolean {
  return session.strategy !== "gold";
}

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
    const { getKlines } = await import("../binance");
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

export async function runGridBotTick(
  session: BotSession,
  quoteOverride?: GridQuote,
): Promise<BotTickEvent[]> {
  if (!isGridSession(session)) {
    return [{ botId: session.id, action: "error", detail: "not_grid_session" }];
  }

  if (await isMasterKillOn()) {
    await stopBotSession(session.id, "master_kill");
    return [{ botId: session.id, action: "stopped", detail: "master_kill" }];
  }

  const live = session.executionMode === "live" && botsLiveEnabled();
  const quote = quoteOverride ?? (await resolveQuote(session, live));
  if (!quote) {
    return [{ botId: session.id, action: "skipped", detail: "no_quote" }];
  }

  const config = session.config as GridConfig;
  const levels = session.state.levels as GridLevel[];
  const decision = evaluateGrid(config, levels, quote);

  if (decision.action === "hold") {
    return [{ botId: session.id, action: "hold", detail: decision.reason }];
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
            { botId: session.id, action: "stopped", detail: exec.reason },
          ];
        }
        return [
          { botId: session.id, action: "skipped", detail: exec.reason },
        ];
      }
      const newLevels = [...levels, exec.level];
      await updateBotState(session.id, { ...session.state, levels: newLevels });
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
    const newLevels = [...levels, { price: fillPrice, lot: decision.lot }];
    await updateBotState(session.id, { ...session.state, levels: newLevels });
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
      realized = realizedOnClose(session.side, levels, quote);
    }
    const levelCount = levels.length;
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
