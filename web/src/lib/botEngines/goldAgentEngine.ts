/**
 * Gold Agent X Ultimate — tick engine.
 */
import { createLogger } from "../logger";
import { GOLD_SYMBOL } from "../strategies/gold/goldDefaults";
import {
  isLegacyGoldConfig,
  migrateGoldConfig,
  parseGoldAgentState,
  type GoldAgentXConfig,
  type GoldAgentXState,
  type GoldSide,
} from "../strategies/gold/goldTypes";
import { runAgentXCycle } from "../strategies/gold/agentX/cycle";
import { evaluateExit } from "../strategies/gold/agentX/exitEngine";
import { recordExecutionQuality } from "../strategies/gold/agentX/executionQuality";
import { learnFromTrade } from "../strategies/gold/agentX/learning";
import { emptyMemory } from "../strategies/gold/agentX/memory";
import { updatePerformance } from "../strategies/gold/agentX/performanceEngine";
import { updateSetupLibrary, type StoredSetup } from "../strategies/gold/agentX/setupLibrary";
import type { TradeJournalEntry } from "../strategies/gold/agentX/types";
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

const log = createLogger("bot.gold.agentx");

function sessionWithSide(session: BotSession, side: GoldSide): BotSession {
  return { ...session, side };
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

function unrealizedLossPct(
  state: GoldAgentXState,
  quote: GridQuote,
): number {
  const pos = state.levels[0];
  if (!pos || !state.startEquity || state.startEquity <= 0) return 0;
  const side = state.entrySide ?? "buy";
  const close = side === "sell" ? quote.ask : quote.bid;
  const pnl =
    side === "sell"
      ? (pos.price - close) * pos.lot
      : (close - pos.price) * pos.lot;
  return pnl < 0 ? (-pnl / state.startEquity) * 100 : 0;
}

export async function runGoldBotTick(
  session: BotSession,
  quoteOverride?: GridQuote,
): Promise<BotTickEvent[]> {
  if (session.strategy !== "gold") {
    return [{ botId: session.id, action: "error", detail: "not_gold_session" }];
  }

  const rawConfig = session.config as unknown as Record<string, unknown>;
  if (isLegacyGoldConfig(rawConfig)) {
    await stopBotSession(session.id, "legacy_grid_config");
    return [
      {
        botId: session.id,
        action: "stopped",
        detail: "legacy_config — أنشئ Gold Agent X جديد",
      },
    ];
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

  let config = migrateGoldConfig(rawConfig);
  let state = parseGoldAgentState(session.state as unknown as Record<string, unknown>);

  if (state.startEquity == null || state.startEquity <= 0) {
    const eq = await resolveBotAccountEquity(session);
    if (eq != null && eq > 0) state = { ...state, startEquity: eq };
    else if (!live) state = { ...state, startEquity: 10_000 };
  }

  const ddPct = unrealizedLossPct(state, quote);
  if (ddPct >= config.maxEquityDrawdownPct && state.levels.length > 0) {
    return closeAll(session, state, quote, live, [], "equity_protection");
  }

  const prevMid =
    state.levels[0]?.price ??
    (quote.bid + quote.ask) / 2;

  const setupLibrary: StoredSetup[] = [];
  const cycle = await runAgentXCycle({
    userId: session.userId,
    botId: session.id,
    config,
    state,
    quote,
    prevMid,
    setupLibrary,
  });

  state = cycle.state;
  const { decision } = cycle;
  const events: BotTickEvent[] = [];

  const hasPosition = state.levels.length > 0;
  const pos = state.levels[0];
  const posSide = state.entrySide ?? "buy";

  if (hasPosition && pos) {
    const exitEval = evaluateExit({
      ctx: cycle.ctx,
      regime: cycle.regime,
      position: { ...pos, stopLoss: undefined },
      side: posSide,
      barsHeld: state.positionBarsHeld ?? 0,
    });

    if (exitEval.action === "close" && decision.action === "HOLD") {
      return closeAll(session, state, quote, live, events, exitEval.reason);
    }
    if (exitEval.action === "partial_close") {
      return closeAll(session, state, quote, live, events, exitEval.reason, true);
    }
    if (exitEval.action === "reverse") {
      await closeAll(session, state, quote, live, events, exitEval.reason);
      if (exitEval.reverseSide) {
        session = sessionWithSide(session, exitEval.reverseSide);
      }
    }

    state.positionBarsHeld = (state.positionBarsHeld ?? 0) + 1;
    await updateBotState(session.id, state);
    return [
      ...events,
      {
        botId: session.id,
        action: "hold",
        detail: decision.reason ?? cycle.state.lastCycleSummary ?? "monitor",
      },
    ];
  }

  if (decision.blocked || decision.action === "HOLD") {
    await updateBotState(session.id, state);
    return [
      ...events,
      {
        botId: session.id,
        action: "hold",
        detail: decision.reason ?? decision.blockReason ?? "hold",
      },
    ];
  }

  if (
    (decision.action === "BUY" || decision.action === "SELL") &&
    decision.side
  ) {
    const side = decision.side;
    const lot = cycle.lot;
    const execSession = sessionWithSide(session, side);

    if (live) {
      const exec = await executeBotOpen(execSession, lot, quote);
      if (!exec.ok) {
        log.warn("agentx open failed", { botId: session.id, reason: exec.reason });
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

      const expected = side === "buy" ? quote.ask : quote.bid;
      const scores = recordExecutionQuality(
        state.executionQualityScores ?? [],
        expected,
        exec.level.price,
        Math.abs(exec.level.price - expected) * 10,
      );

      state = {
        ...state,
        levels: [exec.level],
        entrySide: side,
        executionQualityScores: scores,
        positionBarsHeld: 0,
        detectedPattern: "agentx",
      };

      await updateBotState(session.id, state);
      await logAudit(
        session.userId,
        "bot_gold_agentx_open",
        `bot#${session.id} LIVE ${side} ${lot} conf=${decision.confidence}`,
      );
      return [
        ...events,
        {
          botId: session.id,
          action: "open",
          detail: `${cycle.regime.dominant} conf=${decision.confidence} q=${decision.tradeQuality}`,
        },
      ];
    }

    const fillPrice = side === "sell" ? quote.bid : quote.ask;
    state = {
      ...state,
      levels: [{ price: fillPrice, lot }],
      entrySide: side,
      positionBarsHeld: 0,
      detectedPattern: "agentx",
    };
    await updateBotState(session.id, state);
    return [
      ...events,
      {
        botId: session.id,
        action: "open",
        detail: `paper conf=${decision.confidence}`,
      },
    ];
  }

  if (decision.action === "CLOSE" || decision.action === "REVERSE") {
    return closeAll(
      session,
      state,
      quote,
      live,
      events,
      decision.reason ?? "close",
    );
  }

  await updateBotState(session.id, state);
  return [
    ...events,
    { botId: session.id, action: "hold", detail: decision.reason ?? "hold" },
  ];
}

async function closeAll(
  session: BotSession,
  state: GoldAgentXState,
  quote: GridQuote,
  live: boolean,
  events: BotTickEvent[],
  reason: string,
  partial = false,
): Promise<BotTickEvent[]> {
  const pos = state.levels[0];
  if (!pos) {
    await updateBotState(session.id, state);
    return events;
  }

  const side = state.entrySide ?? "buy";
  const execSession = sessionWithSide(session, side);
  const exitPrice = side === "buy" ? quote.bid : quote.ask;
  let realized =
    side === "buy"
      ? (exitPrice - pos.price) * pos.lot * 100
      : (pos.price - exitPrice) * pos.lot * 100;

  if (live) {
    const closed = await executeBotCloseAll(execSession);
    if (!closed.ok) {
      return [
        ...events,
        { botId: session.id, action: "error", detail: closed.reason ?? "close_failed" },
      ];
    }
    realized = closed.realized;
  }

  if (partial) {
    state.levels = [{ ...pos, lot: pos.lot / 2 }];
    await updateBotState(session.id, state, realized / 2);
    return [
      ...events,
      { botId: session.id, action: "partial_close", detail: reason },
    ];
  }

  const memory = emptyMemory();
  const weights = state.adaptiveWeights ?? {};
  const journalEntry: TradeJournalEntry = {
    botId: session.id,
    userId: session.userId,
    side,
    entryPrice: pos.price,
    exitPrice,
    lot: pos.lot,
    pnl: realized,
    regime: state.regime ?? "RANGE",
    session: "LONDON",
    confidence: state.confidence ?? 0,
    tradeQuality: state.tradeQuality ?? 0,
    tradeScore: state.tradeScore ?? 0,
    dangerLevel: state.dangerLevel ?? "NORMAL",
    advisorVotes: state.advisorVotes ?? [],
    weights,
    exitReason: reason,
    durationMs: (state.positionBarsHeld ?? 0) * 60_000,
    fingerprint: state.setupMatch ?? "",
  };

  const learned = learnFromTrade(weights, memory, journalEntry);
  state.adaptiveWeights = learned.weights;
  state.performance = updatePerformance(
    state.performance ?? { winRate: 0, profitFactor: 0, expectancy: 0, totalTrades: 0, wins: 0, losses: 0, avgWin: 0, avgLoss: 0 },
    journalEntry,
  );
  state.consecutiveLosses =
    realized < 0 ? (state.consecutiveLosses ?? 0) + 1 : 0;
  state.consecutiveWins = realized > 0 ? (state.consecutiveWins ?? 0) + 1 : 0;
  state.closedTradeCount = (state.closedTradeCount ?? 0) + 1;
  state.tradesSinceOptimizer = (state.tradesSinceOptimizer ?? 0) + 1;
  state.levels = [];
  state.entrySide = undefined;
  state.positionBarsHeld = 0;

  await updateBotState(session.id, state, realized);

  if (reason.includes("equity_protection")) {
    await stopBotSession(session.id, "equity_protection");
    return [
      ...events,
      { botId: session.id, action: "stopped", detail: reason },
    ];
  }

  await logAudit(
    session.userId,
    "bot_gold_agentx_close",
    `bot#${session.id} pnl≈${realized.toFixed(2)} ${reason}`,
  );

  return [
    ...events,
    {
      botId: session.id,
      action: "close_all",
      detail: `${reason} pnl≈${realized.toFixed(2)}`,
    },
  ];
}
