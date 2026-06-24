/**
 * Live grid-bot broker execution — routes opens/closes through Risk Guard +
 * the user's configured forex/crypto backend (MT5 bridge, EA, Binance).
 */
import { executeIntent } from "./execution";
import { getResolvedExecutionEnv } from "./executionEnv";
import { lotsToNotional } from "./brokers/lotSizing";
import { closeOpenTrade } from "./tradeClose";
import { deriveDynamicStops } from "./dynamicStops";
import {
  countOpenTrades,
  createIntent,
  getLimits,
  getMtAccountMeta,
  getSettings,
  isMasterKillOn,
  monthRealizedPnlPct,
  recordTrade,
  resolveBrokerForMarket,
  resolveForexBackendForUser,
  todayRealizedPnlPct,
  todayRealizedPnlUsd,
  updateIntentStatus,
} from "./store";
import { evaluateTrade } from "./riskGuard";
import { getEaSymbolSpec } from "./eaStore";
import { resolveMt5Symbol } from "./mt5SymbolMap";
import {
  isMt5LocalConfigured,
  mt5Close,
  mt5Order,
  mt5Price,
  mt5Spec,
} from "./mt5local/client";
import type { BotSession } from "./botStore";
import type { GridLevel, GridQuote, GridSide } from "./strategies/gridBot";
import { createLogger } from "./logger";

const log = createLogger("bot.exec");

export function botsLiveEnabled(): boolean {
  return process.env.BOTS_LIVE_ENABLED !== "0";
}

export function botComment(botId: number): string {
  return `AiChartBot#${botId}`;
}

async function forexQuote(userId: number, symbol: string): Promise<GridQuote | null> {
  const backend = await resolveForexBackendForUser(userId);
  if (backend === "mt5local") {
    const acct = await getMtAccountMeta(userId);
    if (!acct) return null;
    const resolved = (await resolveMt5Symbol(userId, symbol)) ?? symbol;
    const { bid, ask } = await mt5Price(resolved, {
      login: acct.login,
      server: acct.server,
    });
    if (bid > 0 && ask > 0) return { bid, ask };
    return null;
  }
  const spec = await getEaSymbolSpec(userId, symbol);
  if (!spec) return null;
  const bid = Number(spec.bid);
  const ask = Number(spec.ask);
  if (bid > 0 && ask > 0) return { bid, ask };
  return null;
}

async function contractSizeForForex(
  userId: number,
  symbol: string,
): Promise<number> {
  const backend = await resolveForexBackendForUser(userId);
  if (backend === "mt5local") {
    const acct = await getMtAccountMeta(userId);
    if (!acct) return 0;
    const resolved = (await resolveMt5Symbol(userId, symbol)) ?? symbol;
    const spec = await mt5Spec(resolved, { login: acct.login, server: acct.server });
    return Number(spec.contract_size) || 0;
  }
  const spec = await getEaSymbolSpec(userId, symbol);
  return Number(spec?.contract_size) || 0;
}

function fillPrice(side: GridSide, quote: GridQuote): number {
  return side === "sell" ? quote.bid : quote.ask;
}

function emergencyStopLoss(
  side: GridSide,
  entry: number,
  gridStep: number,
  maxLevels: number,
): number {
  const dist = gridStep * Math.max(maxLevels, 1) * 1.5;
  return side === "buy" ? entry - dist : entry + dist;
}

async function assertRisk(
  session: BotSession,
  lot: number,
  price: number,
): Promise<{ ok: true; notional: number } | { ok: false; reason: string }> {
  const settings = await getSettings(session.userId);
  const limits = await getLimits(session.userId);
  const envPreference =
    settings.execution_env_preference === "live" ? "live" : "demo";
  const resolvedEnv = await getResolvedExecutionEnv(
    session.userId,
    session.market as "crypto" | "forex",
  );
  const contractSize =
    session.market === "forex"
      ? await contractSizeForForex(session.userId, session.symbol)
      : 0;
  const notional =
    session.market === "forex"
      ? lotsToNotional(lot, price, contractSize)
      : lot * price;

  if (notional <= 0) {
    return { ok: false, reason: "تعذّر حساب قيمة الصفقة." };
  }

  const decision = evaluateTrade(
    settings,
    limits,
    {
      symbol: session.symbol,
      side: session.side,
      notional,
      market: session.market as "crypto" | "forex",
      confidence: 100,
    },
    {
      masterKill: await isMasterKillOn(),
      openTradesCount: await countOpenTrades(session.userId),
      todayRealizedPnlPct: await todayRealizedPnlPct(
        session.userId,
        settings.max_capital,
      ),
      todayRealizedPnlUsd: await todayRealizedPnlUsd(session.userId),
      monthRealizedPnlPct: await monthRealizedPnlPct(
        session.userId,
        settings.max_capital,
      ),
      explicitApproval: true,
      practiceMode: false,
      resolvedEnv,
      envPreference,
    },
  );

  if (!decision.ok) return { ok: false, reason: decision.reason };
  return { ok: true, notional };
}

export async function executeBotOpen(
  session: BotSession,
  lot: number,
  quote: GridQuote,
): Promise<
  | { ok: true; level: GridLevel }
  | { ok: false; reason: string; deny?: boolean }
> {
  const price = fillPrice(session.side, quote);
  const risk = await assertRisk(session, lot, price);
  if (!risk.ok) {
    return { ok: false, reason: risk.reason, deny: true };
  }

  if (session.market === "forex") {
    const backend = await resolveForexBackendForUser(session.userId);
    if (backend === "mt5local") {
      const meta = await getMtAccountMeta(session.userId);
      if (!meta?.online || !isMt5LocalConfigured()) {
        return { ok: false, reason: "MT5 غير متصل — اربط حسابك من الإعدادات." };
      }
      const account = { login: meta.login, server: meta.server };
      const resolved = (await resolveMt5Symbol(session.userId, session.symbol)) ?? session.symbol;
      const spec = await mt5Spec(resolved, account);
      const result = await mt5Order(account, {
        symbol: resolved,
        side: session.side,
        lots: lot,
        comment: botComment(session.id),
      });
      if (!result.ok) {
        return { ok: false, reason: result.reason ?? "رفض MT5 الأمر." };
      }
      const fill = result.price || price;
      const trade = await recordTrade(session.userId, {
        intent_id: null,
        symbol: session.symbol,
        side: session.side,
        qty: result.lots ?? lot,
        quote_qty: (result.lots ?? lot) * fill * (Number(spec.contract_size) || 0),
        avg_price: fill,
        order_id: result.ticket != null ? String(result.ticket) : null,
        env: "mt5",
        market: "forex",
        broker: "mt5_local",
        status: "open",
      });
      return {
        ok: true,
        level: {
          price: fill,
          lot: result.lots ?? lot,
          ticket: result.ticket,
          tradeId: trade.id,
        },
      };
    }

    const sl =
      deriveDynamicStops({
        entry: price,
        side: session.side,
        style: (await getSettings(session.userId)).style,
        confidence: 80,
        atr: session.config.gridStep,
      })?.stopLoss ??
      emergencyStopLoss(
        session.side,
        price,
        session.config.gridStep,
        session.config.maxLevels,
      );

    const intent = await createIntent(session.userId, {
      symbol: session.symbol,
      side: session.side,
      notional: risk.notional,
      market: "forex",
      broker: await resolveBrokerForMarket(session.userId, "forex"),
      entry: price,
      stop_loss: sl,
      take_profit: null,
      confidence: 100,
      rationale: `بوت شبكة #${session.id} · ${botComment(session.id)}`,
      status: "approved",
      practice: false,
    });

    const exec = await executeIntent(session.userId, intent.id, {
      explicitApproval: true,
      practiceMode: false,
    });
    if (!exec.ok) {
      await updateIntentStatus(intent.id, "failed", exec.reason);
      return { ok: false, reason: exec.reason, deny: Boolean(exec.denyCode) };
    }

    return {
      ok: true,
      level: {
        price: exec.trade?.avg_price ?? price,
        lot: exec.trade?.qty ?? lot,
        tradeId: exec.tradeId,
      },
    };
  }

  const intent = await createIntent(session.userId, {
    symbol: session.symbol,
    side: session.side,
    notional: risk.notional,
    market: "crypto",
    entry: price,
    stop_loss: null,
    take_profit: null,
    confidence: 100,
    rationale: `بوت شبكة #${session.id}`,
    status: "approved",
    practice: false,
  });
  const exec = await executeIntent(session.userId, intent.id, {
    explicitApproval: true,
    practiceMode: false,
  });
  if (!exec.ok) {
    return { ok: false, reason: exec.reason, deny: Boolean(exec.denyCode) };
  }
  return {
    ok: true,
    level: {
      price: exec.trade?.avg_price ?? price,
      lot: exec.trade?.qty ?? lot,
      tradeId: exec.tradeId,
    },
  };
}

export async function executeBotCloseAll(
  session: BotSession,
): Promise<{ ok: boolean; realized: number; reason?: string }> {
  let realized = 0;
  const levels = session.state.levels;

  if (levels.length === 0) {
    return { ok: true, realized: 0 };
  }

  const backend =
    session.market === "forex"
      ? await resolveForexBackendForUser(session.userId)
      : null;

  if (backend === "mt5local") {
    const meta = await getMtAccountMeta(session.userId);
    if (!meta?.online) {
      return { ok: false, realized: 0, reason: "MT5 غير متصل." };
    }
    const account = { login: meta.login, server: meta.server };
    for (const lv of levels) {
      if (lv.ticket) {
        const res = await mt5Close(account, { ticket: lv.ticket });
        if (res.ok) {
          realized += res.closed.reduce((s, c) => s + c.profit, 0);
        }
      } else if (lv.tradeId) {
        const res = await closeOpenTrade(session.userId, lv.tradeId);
        if (res.ok) realized += res.pnl;
      }
    }
    return { ok: true, realized };
  }

  for (const lv of levels) {
    if (lv.tradeId) {
      const res = await closeOpenTrade(session.userId, lv.tradeId);
      if (res.ok) realized += res.pnl;
      else {
        log.warn("bot close failed", {
          botId: session.id,
          tradeId: lv.tradeId,
          reason: res.reason,
        });
      }
    }
  }

  return { ok: true, realized };
}

export async function resolveBotQuote(session: BotSession): Promise<GridQuote | null> {
  if (session.market === "forex") {
    return forexQuote(session.userId, session.symbol);
  }
  const { getKlines } = await import("./binance");
  const candles = await getKlines(session.symbol, "1m", 1, "prod");
  const close = candles.at(-1)?.close;
  return close && close > 0 ? { bid: close, ask: close } : null;
}
