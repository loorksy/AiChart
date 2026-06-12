import { getPrice } from "./binance";
import { getFuturesPositions, type FuturesPosition } from "./binanceFutures";
import { buildBinancePermissionReport } from "./binanceVerify";
import { getAccountSummary, getApiRestrictions } from "./binance";
import type { ExecutionEnvSnapshot } from "./executionEnv";
import { getExecutionEnvSnapshot } from "./executionEnv";
import { loadBrokerMt5Positions } from "./openTradesSummary";
import type { Trade } from "./types";
import {
  getBinanceAccountMeta,
  getBinanceCredentials,
  getIntent,
  listOpenTrades,
  listPendingEntryTrades,
} from "./store";

export interface ConsoleActiveTradeRow {
  id: string;
  symbol: string;
  platform: string;
  side: string;
  leverage: number | null;
  margin: number | null;
  unrealizedPnl: number | null;
  sl: number | null;
  tp: number | null;
  env: string;
  status: "open" | "pending_entry";
  qty?: number;
  avgPrice?: number;
}

function sideAr(side: string): string {
  return side === "buy" || side === "long" ? "شراء" : "بيع";
}

function spotUnrealizedPnl(trade: Trade, price: number): number {
  const marketValue = trade.qty * price;
  if (trade.side === "buy") return marketValue - trade.quote_qty;
  return trade.quote_qty - marketValue;
}

function platformLabel(trade: Trade): string {
  if (
    trade.broker === "mt_ea" ||
    trade.broker === "metaapi" ||
    trade.broker === "mt5_local"
  ) {
    return "MT5";
  }
  return (trade.market_type ?? "spot") === "futures" ? "Futures" : "Spot";
}

async function loadIntentSlTp(
  trades: Trade[],
): Promise<Map<number, { sl: number | null; tp: number | null }>> {
  const map = new Map<number, { sl: number | null; tp: number | null }>();
  const ids = [
    ...new Set(
      trades.map((t) => t.intent_id).filter((id): id is number => id != null),
    ),
  ];
  await Promise.all(
    ids.map(async (id) => {
      const intent = await getIntent(id);
      if (intent) {
        map.set(id, {
          sl: intent.stop_loss ?? null,
          tp: intent.take_profit ?? null,
        });
      }
    }),
  );
  return map;
}

function mapAichartBase(
  trade: Trade,
  slTp: { sl: number | null; tp: number | null } | undefined,
): ConsoleActiveTradeRow {
  const pending = trade.status === "pending_entry";
  return {
    id: `aichart-${trade.id}`,
    symbol: trade.symbol,
    platform: platformLabel(trade),
    side: pending
      ? `${sideAr(trade.side)} · limit`
      : sideAr(trade.side),
    leverage: trade.leverage ?? null,
    margin: trade.quote_qty ?? null,
    unrealizedPnl: null,
    sl: slTp?.sl ?? null,
    tp: slTp?.tp ?? null,
    env: trade.env,
    status: pending ? "pending_entry" : "open",
    qty: trade.qty,
    avgPrice: trade.limit_price ?? trade.avg_price,
  };
}

function mapMt5Row(p: {
  ticket: number;
  symbol: string;
  side: string;
  lots: number;
  profit: number;
  sl?: number | null;
  tp?: number | null;
}): ConsoleActiveTradeRow {
  return {
    id: `mt5-${p.ticket}`,
    symbol: p.symbol,
    platform: "MT5",
    side: sideAr(p.side),
    leverage: null,
    margin: null,
    unrealizedPnl: p.profit,
    sl: p.sl ?? null,
    tp: p.tp ?? null,
    env: "live",
    status: "open",
    qty: p.lots,
  };
}

function mapBinanceFuturesRow(
  p: FuturesPosition,
  env: string,
): ConsoleActiveTradeRow {
  const isLong = p.positionAmt > 0;
  return {
    id: `binance-futures-${p.symbol}`,
    symbol: p.symbol,
    platform: "Futures",
    side: sideAr(isLong ? "buy" : "sell"),
    leverage: p.leverage,
    margin: p.isolatedMargin,
    unrealizedPnl: p.unRealizedProfit,
    sl: null,
    tp: null,
    env,
    status: "open",
    qty: Math.abs(p.positionAmt),
    avgPrice: p.entryPrice,
  };
}

/** Live active trades for the bridge console (AiChart + MT5 + Binance futures). */
export async function buildConsoleActiveTrades(userId: number): Promise<{
  rows: ConsoleActiveTradeRow[];
  executionEnv: ExecutionEnvSnapshot;
  aichartTrades: Trade[];
  brokerPositions: {
    mt5: Awaited<ReturnType<typeof loadBrokerMt5Positions>>;
    binance: FuturesPosition[];
  };
}> {
  const [executionEnv, openTrades, pendingTrades, brokerMt5] =
    await Promise.all([
      getExecutionEnvSnapshot(userId),
      listOpenTrades(userId, 30),
      listPendingEntryTrades(userId, 20),
      loadBrokerMt5Positions(userId),
    ]);

  const aichartTrades = [...pendingTrades, ...openTrades];
  const slTpMap = await loadIntentSlTp(aichartTrades);

  const creds = await getBinanceCredentials(userId);
  let futuresPositions: FuturesPosition[] = [];
  const priceCache = new Map<string, number>();

  if (creds) {
    try {
      futuresPositions = await getFuturesPositions(
        creds.apiKey,
        creds.apiSecret,
        creds.env,
      );
    } catch {
      futuresPositions = [];
    }
  }

  const futuresBySymbol = new Map(
    futuresPositions.map((p) => [p.symbol.toUpperCase(), p]),
  );
  const coveredFuturesSymbols = new Set<string>();

  const rows: ConsoleActiveTradeRow[] = [];

  for (const trade of aichartTrades) {
    const row = mapAichartBase(
      trade,
      trade.intent_id != null ? slTpMap.get(trade.intent_id) : undefined,
    );

    if (trade.status === "pending_entry") {
      rows.push(row);
      continue;
    }

    const mt = trade.market_type ?? "spot";
    if (mt === "futures" && creds) {
      const pos = futuresBySymbol.get(trade.symbol.toUpperCase());
      if (pos) {
        row.unrealizedPnl = pos.unRealizedProfit;
        row.margin = pos.isolatedMargin;
        row.leverage = pos.leverage;
        coveredFuturesSymbols.add(trade.symbol.toUpperCase());
      }
    } else if (mt === "spot" && creds && trade.broker === "binance") {
      try {
        let price = priceCache.get(trade.symbol);
        if (price == null) {
          price = await getPrice(trade.symbol, creds.env);
          priceCache.set(trade.symbol, price);
        }
        row.unrealizedPnl = spotUnrealizedPnl(trade, price);
      } catch {
        /* keep null */
      }
    }

    rows.push(row);
  }

  for (const pos of futuresPositions) {
    if (coveredFuturesSymbols.has(pos.symbol.toUpperCase())) continue;
    rows.push(
      mapBinanceFuturesRow(
        pos,
        creds?.env === "testnet" ? "demo" : "live",
      ),
    );
  }

  for (const p of brokerMt5) {
    rows.push(mapMt5Row(p));
  }

  return {
    rows,
    executionEnv,
    aichartTrades,
    brokerPositions: { mt5: brokerMt5, binance: futuresPositions },
  };
}

/** Whether Binance API key has futures permission when futures trading is enabled. */
export async function resolveBinanceFuturesOk(
  userId: number,
  futuresEnabled: boolean,
): Promise<boolean | null> {
  const meta = await getBinanceAccountMeta(userId);
  if (!meta) return null;
  if (!futuresEnabled) return true;

  const creds = await getBinanceCredentials(userId);
  if (!creds) return false;

  try {
    const [summary, restrictions] = await Promise.all([
      getAccountSummary(creds.apiKey, creds.apiSecret, creds.env),
      getApiRestrictions(creds.apiKey, creds.apiSecret, creds.env),
    ]);
    const report = buildBinancePermissionReport(
      summary,
      restrictions,
      creds.env,
      { futuresRequired: true },
    );
    return report.ok;
  } catch {
    return null;
  }
}
