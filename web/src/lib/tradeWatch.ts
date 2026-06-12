import { getPrice } from "./binance";
import {
  getEaConnection,
  isHeartbeatFresh,
  parseEaSymbolSpecs,
} from "./eaStore";
import { parseEaPositions, type EaBrokerPosition } from "./executionEnv";
import { checkSlTpProximity } from "./monitor";
import { queryOne } from "./db";
import {
  getBinanceCredentials,
  getLimits,
  getSettings,
  listOpenTrades,
  todayRealizedPnlPct,
} from "./store";
import type { Trade, TradingSettings, AdminLimits } from "./types";

const PROXIMITY_PCT = 1.5;
const DAILY_LOSS_WARN_RATIO = 0.8;

async function intentStopsForTrade(
  intentId: number | null,
): Promise<{ sl: number | null; tp: number | null }> {
  if (!intentId) return { sl: null, tp: null };
  const row = await queryOne<{ stop_loss: number | null; take_profit: number | null }>(
    "SELECT stop_loss, take_profit FROM trade_intents WHERE id = ?",
    [intentId],
  );
  return { sl: row?.stop_loss ?? null, tp: row?.take_profit ?? null };
}

async function forexMidPrice(
  userId: number,
  symbol: string,
): Promise<number | null> {
  const conn = await getEaConnection(userId);
  if (!conn || !isHeartbeatFresh(conn.last_heartbeat_at)) return null;
  const spec = parseEaSymbolSpecs(conn.symbol_specs_json).find(
    (s) => s.symbol?.toUpperCase() === symbol.toUpperCase(),
  );
  if (!spec) return null;
  const bid = Number(spec.bid) || 0;
  const ask = Number(spec.ask) || 0;
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  return bid || ask || null;
}

export interface TradeWatchAlert {
  symbol: string;
  source: "aichart" | "mt5";
  hits: ReturnType<typeof checkSlTpProximity>;
  detail: string;
}

export async function watchAichartOpenTrades(
  userId: number,
): Promise<TradeWatchAlert[]> {
  const alerts: TradeWatchAlert[] = [];
  const creds = await getBinanceCredentials(userId);
  const open = await listOpenTrades(userId, 20);

  for (const trade of open) {
    let price: number | null = null;
    if (trade.market === "forex" || trade.broker === "mt5_local" || trade.broker === "mt_ea") {
      price = await forexMidPrice(userId, trade.symbol);
    } else {
      try {
        price = await getPrice(trade.symbol, creds?.env ?? "prod");
      } catch {
        continue;
      }
    }
    if (price == null) continue;
    const { sl, tp } = await intentStopsForTrade(trade.intent_id);
    const hits = checkSlTpProximity(price, sl, tp, PROXIMITY_PCT);
    if (!hits.length) continue;
    alerts.push({
      symbol: trade.symbol,
      source: "aichart",
      hits,
      detail:
        `صفقة AiChart #${trade.id} ${trade.symbol} ${trade.side} @ ${trade.avg_price} — ` +
        hits
          .map(
            (h) =>
              `${h.kind.toUpperCase()} ${h.level} (بعد ${h.distancePct.toFixed(2)}%)`,
          )
          .join(" · "),
    });
  }
  return alerts;
}

export async function watchMt5Positions(
  userId: number,
  positions?: EaBrokerPosition[],
): Promise<TradeWatchAlert[]> {
  const alerts: TradeWatchAlert[] = [];
  let list = positions;
  if (!list) {
    const conn = await getEaConnection(userId);
    list = parseEaPositions(conn?.positions_json ?? null);
  }

  for (const p of list) {
    const price = await forexMidPrice(userId, p.symbol);
    if (price == null) continue;
    const hits = checkSlTpProximity(price, p.sl, p.tp, PROXIMITY_PCT);
    if (!hits.length) continue;
    alerts.push({
      symbol: p.symbol,
      source: "mt5",
      hits,
      detail:
        `مركز MT5 #${p.ticket} ${p.symbol} ${p.side} — ` +
        hits
          .map(
            (h) =>
              `${h.kind.toUpperCase()} ${h.level} (بعد ${h.distancePct.toFixed(2)}%)`,
          )
          .join(" · "),
    });
  }
  return alerts;
}

export async function watchDailyLossProximity(
  userId: number,
  settings?: TradingSettings,
  limits?: AdminLimits,
): Promise<string | null> {
  const s = settings ?? (await getSettings(userId));
  const l = limits ?? (await getLimits(userId));
  const limitPct = s.daily_loss_limit_pct;
  if (limitPct <= 0) return null;

  const capital =
    l.max_capital_cap > 0
      ? Math.min(s.max_capital, l.max_capital_cap)
      : s.max_capital;
  if (capital <= 0) return null;

  const todayPct = await todayRealizedPnlPct(userId, capital);
  if (todayPct >= 0) return null;

  const usedRatio = Math.abs(todayPct) / limitPct;
  if (usedRatio < DAILY_LOSS_WARN_RATIO) return null;

  return (
    `خسارة اليوم ${todayPct.toFixed(2)}% من أصل حد −${limitPct}% ` +
    `(${(usedRatio * 100).toFixed(0)}% من الحد).`
  );
}

export async function collectTradeWatchAlerts(
  userId: number,
): Promise<TradeWatchAlert[]> {
  const [aichart, mt5] = await Promise.all([
    watchAichartOpenTrades(userId),
    watchMt5Positions(userId),
  ]);
  return [...aichart, ...mt5];
}
