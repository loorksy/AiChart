import { getEaConnection, getEaSymbolSpec } from "./eaStore";
import type { EaBrokerPosition } from "./executionEnv";
import { listOpenTrades, recordTrade, updateTradeClosed } from "./store";

export interface EaPositionSyncResult {
  imported: number;
  closed: number;
}

/** Maps MT5 open tickets to AiChart trades and detects broker-side closes. */
export async function reconcileEaPositions(
  userId: number,
  positions: EaBrokerPosition[],
  previousPositions: EaBrokerPosition[] = [],
): Promise<EaPositionSyncResult> {
  const conn = await getEaConnection(userId);
  const env = conn?.account_trade_mode === "live" ? "live" : "demo";

  const openTrades = (await listOpenTrades(userId)).filter(
    (t) => t.broker === "mt_ea",
  );
  const ticketSet = new Set(positions.map((p) => String(p.ticket)));
  const prevProfit = new Map(
    previousPositions.map((p) => [String(p.ticket), p.profit]),
  );

  let imported = 0;
  let closed = 0;

  for (const pos of positions) {
    const ticketStr = String(pos.ticket);
    const existing = openTrades.find((t) => t.order_id === ticketStr);
    if (existing) continue;

    const spec = await getEaSymbolSpec(userId, pos.symbol);
    const contractSize = Number(spec?.contract_size) || 100_000;

    await recordTrade(userId, {
      intent_id: null,
      symbol: pos.symbol,
      side: pos.side,
      qty: pos.lots,
      quote_qty: pos.lots * pos.open_price * contractSize,
      avg_price: pos.open_price,
      order_id: ticketStr,
      env,
      market: "forex",
      broker: "mt_ea",
      status: "open",
    });
    imported++;
  }

  for (const trade of openTrades) {
    if (!trade.order_id) continue;
    if (ticketSet.has(trade.order_id)) continue;
    const pnl = prevProfit.get(trade.order_id) ?? 0;
    await updateTradeClosed(trade.id, pnl);
    closed++;
  }

  return { imported, closed };
}
