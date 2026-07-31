import {
  getEaConnection,
  isHeartbeatFresh,
  parseEaSymbolSpecs,
} from "./eaStore";
import { parseEaPositions, type EaBrokerPosition } from "./executionEnv";
import { checkSlTpProximity } from "./monitor";
import { queryOne } from "./db";
import { listOpenTrades } from "./store";

const PROXIMITY_PCT = 1.5;

/**
 * One key per (position, which levels are near, at what prices). Bucketed by
 * level rather than distance so drifting around the same stop does not
 * re-announce on every cycle, while a genuinely moved level does.
 */
function proximityDedupeKey(
  source: string,
  positionId: string,
  hits: ReturnType<typeof checkSlTpProximity>,
): string {
  const parts = hits
    .map((hit) => `${hit.kind}@${hit.level}`)
    .sort()
    .join(",");
  return `tradewatch:${source}:${positionId}:${parts}`;
}

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
  /**
   * Stable identity of THIS proximity state, so the same warning is announced
   * once rather than every monitor cycle. The level is part of the key: a stop
   * moved to a new price is genuinely new information, while price hovering
   * either side of the same level is not.
   */
  dedupeKey: string;
}

export async function watchAichartOpenTrades(
  userId: number,
): Promise<TradeWatchAlert[]> {
  const alerts: TradeWatchAlert[] = [];
  const open = await listOpenTrades(userId, 20);

  for (const trade of open) {
    const price = await forexMidPrice(userId, trade.symbol);
    if (price == null) continue;
    const { sl, tp } = await intentStopsForTrade(trade.intent_id);
    const hits = checkSlTpProximity(price, sl, tp, PROXIMITY_PCT);
    if (hits.length) {
      alerts.push({
        symbol: trade.symbol,
        source: "aichart",
        hits,
        dedupeKey: proximityDedupeKey("aichart", String(trade.id), hits),
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
      dedupeKey: proximityDedupeKey("mt5", String(p.ticket), hits),
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

export async function watchFuturesLiquidationProximity(
  _userId: number,
): Promise<TradeWatchAlert[]> {
  return [];
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
