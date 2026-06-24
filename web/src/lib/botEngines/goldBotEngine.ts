/**
 * Gold bot tick engine — OHLC entry on first tick, equity protection, gold grid.
 */
import { createLogger } from "../logger";
import { fetchOhlc } from "../ohlc/fetchOhlc";
import { resolveGoldEntrySignal } from "../strategies/gold/candlePatterns";
import { evaluateGoldGrid } from "../strategies/gold/goldGridBot";
import { GOLD_SYMBOL } from "../strategies/gold/goldDefaults";
import type { GoldBotConfig, GoldBotState, GoldEntrySignal, GoldSide } from "../strategies/gold/goldTypes";
import type { GridQuote } from "../strategies/gridBot";
import {
  stopBotSession,
  updateBotState,
  type BotSession,
} from "../botStore";
import {
  botsLiveEnabled,
  executeBotCloseAll,
  executeBotOpen,
  resolveBotAccountEquity,
  resolveBotQuote,
} from "../botExecution";
import { isMasterKillOn, logAudit } from "../store";
import type { BotTickEvent } from "../botEngine";

const log = createLogger("bot.gold");

function isGoldSession(
  session: BotSession,
): session is BotSession & {
  strategy: "gold";
  config: GoldBotConfig;
  state: GoldBotState;
} {
  return session.strategy === "gold";
}

function goldState(session: BotSession): GoldBotState {
  return session.state as GoldBotState;
}

function goldConfig(session: BotSession): GoldBotConfig {
  return session.config as GoldBotConfig;
}

function effectiveSide(session: BotSession): GoldSide {
  const st = goldState(session);
  return st.entrySide ?? goldConfig(session).side ?? session.side;
}

function sessionWithSide(session: BotSession, side: GoldSide): BotSession {
  return { ...session, side };
}

function floatingLossUsd(
  side: GoldSide,
  levels: { price: number; lot: number }[],
  quote: GridQuote,
): number {
  if (levels.length === 0) return 0;
  const close = side === "sell" ? quote.ask : quote.bid;
  const unrealized = levels.reduce(
    (sum, l) =>
      sum + (side === "sell" ? l.price - close : close - l.price) * l.lot,
    0,
  );
  return unrealized < 0 ? -unrealized : 0;
}

function realizedOnClose(
  side: GoldSide,
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

async function resolveGoldQuote(
  session: BotSession,
  live: boolean,
  quoteOverride?: GridQuote,
): Promise<GridQuote | null> {
  if (quoteOverride) return quoteOverride;
  if (live) return resolveBotQuote(session);
  const { getForexLiveMid } = await import("../markets/forexPrice");
  const mid = await getForexLiveMid(session.userId, session.symbol);
  return mid > 0 ? { bid: mid, ask: mid } : null;
}

async function ensureEntrySide(
  session: BotSession,
): Promise<{ session: BotSession; events: BotTickEvent[] } | null> {
  const st = goldState(session);
  if (st.entrySide) {
    return { session, events: [] };
  }

  const cfg = goldConfig(session);
  let signal: GoldEntrySignal | null = cfg.side
    ? { side: cfg.side, pattern: "xander_body" }
    : null;

  if (!signal) {
    try {
      const ohlc = await fetchOhlc({
        userId: session.userId,
        symbol: GOLD_SYMBOL,
        market: "forex",
        interval: cfg.candleTimeframe,
        limit: 10,
      });
      signal = resolveGoldEntrySignal(ohlc.candles);
    } catch (e) {
      log.warn("gold OHLC fetch failed", {
        botId: session.id,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (!signal) {
    return null;
  }

  const nextState: GoldBotState = {
    ...st,
    entrySide: signal.side,
    detectedPattern: signal.pattern,
  };
  await updateBotState(session.id, nextState);
  const updated = sessionWithSide({ ...session, state: nextState }, signal.side);
  return {
    session: updated,
    events: [
      {
        botId: session.id,
        action: "entry_signal",
        detail: `${signal.pattern}:${signal.side}`,
      },
    ],
  };
}

async function checkEquityProtection(
  session: BotSession,
  quote: GridQuote,
  live: boolean,
): Promise<BotTickEvent[] | null> {
  const st = goldState(session);
  const cfg = goldConfig(session);
  const levels = st.levels;
  if (levels.length === 0) return null;

  let startEquity = st.startEquity;
  if (startEquity == null || startEquity <= 0) {
    const eq = await resolveBotAccountEquity(session);
    if (eq != null && eq > 0) {
      startEquity = eq;
      await updateBotState(session.id, { ...st, startEquity: eq });
    } else if (!live) {
      startEquity = 10_000;
      await updateBotState(session.id, { ...st, startEquity: 10_000 });
    }
  }
  if (!startEquity || startEquity <= 0) return null;

  const side = effectiveSide(session);
  const loss = floatingLossUsd(side, levels, quote);
  const pct = (loss / startEquity) * 100;
  if (pct < cfg.maxEquityDrawdownPct - EPS) return null;

  const liveExec = live && botsLiveEnabled();
  let realized = 0;
  if (liveExec) {
    const closed = await executeBotCloseAll(session);
    if (!closed.ok) {
      return [
        {
          botId: session.id,
          action: "error",
          detail: closed.reason ?? "equity_close_failed",
        },
      ];
    }
    realized = closed.realized;
  } else {
    realized = realizedOnClose(side, levels, quote);
  }

  await updateBotState(session.id, { ...st, levels: [] }, realized);
  await stopBotSession(session.id, "equity_protection");
  await logAudit(
    session.userId,
    "bot_gold_equity_stop",
    `bot#${session.id} equity protection dd=${pct.toFixed(1)}% pnl≈${realized.toFixed(2)}`,
  );
  return [
    {
      botId: session.id,
      action: "stopped",
      detail: `equity_protection dd=${pct.toFixed(1)}%`,
    },
  ];
}

const EPS = 1e-9;

export async function runGoldBotTick(
  session: BotSession,
  quoteOverride?: GridQuote,
): Promise<BotTickEvent[]> {
  if (!isGoldSession(session)) {
    return [{ botId: session.id, action: "error", detail: "not_gold_session" }];
  }

  if (await isMasterKillOn()) {
    await stopBotSession(session.id, "master_kill");
    return [{ botId: session.id, action: "stopped", detail: "master_kill" }];
  }

  const live = session.executionMode === "live" && botsLiveEnabled();
  const quote = await resolveGoldQuote(session, live, quoteOverride);
  if (!quote) {
    return [{ botId: session.id, action: "skipped", detail: "no_quote" }];
  }

  const entry = await ensureEntrySide(session);
  if (!entry) {
    return [{ botId: session.id, action: "skipped", detail: "no_entry_signal" }];
  }
  session = entry.session;
  const events: BotTickEvent[] = [...entry.events];

  const equityStop = await checkEquityProtection(session, quote, live);
  if (equityStop) return [...events, ...equityStop];

  const st = goldState(session);
  const cfg = goldConfig(session);
  const decision = evaluateGoldGrid(cfg, st.levels, quote, st.entrySide);

  if (decision.action === "hold") {
    return [...events, { botId: session.id, action: "hold", detail: decision.reason }];
  }

  const side = effectiveSide(session);
  const execSession = sessionWithSide(session, side);

  if (decision.action === "open" && decision.lot) {
    let nextState = st;
    if (st.startEquity == null) {
      const eq = await resolveBotAccountEquity(session);
      if (eq != null && eq > 0) {
        nextState = { ...st, startEquity: eq };
      } else if (!live) {
        nextState = { ...st, startEquity: 10_000 };
      }
    }

    if (live) {
      const exec = await executeBotOpen(execSession, decision.lot, quote);
      if (!exec.ok) {
        log.warn("gold live open failed", {
          botId: session.id,
          reason: exec.reason,
        });
        if (exec.deny) {
          await stopBotSession(session.id, `risk_deny: ${exec.reason}`);
          return [
            ...events,
            { botId: session.id, action: "stopped", detail: exec.reason },
          ];
        }
        return [
          ...events,
          { botId: session.id, action: "skipped", detail: exec.reason },
        ];
      }
      const levels = [...nextState.levels, exec.level];
      await updateBotState(session.id, { ...nextState, levels });
      await logAudit(
        session.userId,
        "bot_gold_open",
        `bot#${session.id} LIVE ${side} ${exec.level.lot}@${exec.level.price} (${decision.reason}) pattern=${st.detectedPattern ?? "?"}`,
      );
      return [
        ...events,
        {
          botId: session.id,
          action: "open",
          detail: `live ${decision.reason} lot=${exec.level.lot} @${exec.level.price}`,
        },
      ];
    }

    const fillPrice = side === "sell" ? quote.bid : quote.ask;
    const levels = [...nextState.levels, { price: fillPrice, lot: decision.lot }];
    await updateBotState(session.id, { ...nextState, levels });
    await logAudit(
      session.userId,
      "bot_gold_open",
      `bot#${session.id} paper ${side} ${decision.lot}@${fillPrice} (${decision.reason})`,
    );
    return [
      ...events,
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
      const closed = await executeBotCloseAll(execSession);
      if (!closed.ok) {
        return [
          ...events,
          {
            botId: session.id,
            action: "error",
            detail: closed.reason ?? "close_failed",
          },
        ];
      }
      realized = closed.realized;
    } else {
      realized = realizedOnClose(side, st.levels, quote);
    }
    const levelCount = st.levels.length;
    await updateBotState(session.id, { ...st, levels: [] }, realized);
    await logAudit(
      session.userId,
      "bot_gold_close",
      `bot#${session.id} closed ${levelCount} levels pnl≈${realized.toFixed(5)}${live ? " LIVE" : ""}`,
    );
    return [
      ...events,
      {
        botId: session.id,
        action: "close_all",
        detail: `take_profit pnl≈${realized.toFixed(5)}`,
      },
    ];
  }

  return [...events, { botId: session.id, action: "hold", detail: decision.reason }];
}
