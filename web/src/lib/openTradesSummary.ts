import type { Trade } from "./types";
import {
  executionEnvLabelAr,
  getExecutionEnvSnapshot,
  parseEaPositions,
  type EaBrokerPosition,
} from "./executionEnv";
import { getEaConnection } from "./eaStore";

export async function buildOpenTradesSummary(
  userId: number,
  aichartTrades: Trade[],
  brokerMt5?: EaBrokerPosition[],
): Promise<string> {
  const env = await getExecutionEnvSnapshot(userId);
  const lines: string[] = [
    `<b>📂 الصفقات المفتوحة</b>`,
    `البيئة · Env: <b>${executionEnvLabelAr(env.forex.resolved)}</b>`,
    ``,
  ];

  if (aichartTrades.length === 0 && (!brokerMt5 || brokerMt5.length === 0)) {
    lines.push("لا صفقات مفتوحة حالياً.");
    return lines.join("\n");
  }

  if (aichartTrades.length > 0) {
    lines.push(`<b>AiChart (${aichartTrades.length})</b>`);
    for (const t of aichartTrades) {
      lines.push(
        `• ${t.symbol} ${t.side === "buy" ? "شراء" : "بيع"} · ${t.qty} @ ${t.avg_price} · ${t.env}`,
      );
    }
    lines.push("");
  }

  if (brokerMt5 && brokerMt5.length > 0) {
    lines.push(`<b>MT5 مباشرة (${brokerMt5.length})</b>`);
    for (const p of brokerMt5) {
      lines.push(
        `• #${p.ticket} ${p.symbol} ${p.side} · ${p.lots} لوت · ربح ${p.profit.toFixed(2)}`,
      );
    }
  }

  if (env.mismatch && env.mismatchDetailAr) {
    lines.push("", `⚠️ ${env.mismatchDetailAr}`);
  }

  return lines.join("\n");
}

export async function loadBrokerMt5Positions(
  userId: number,
): Promise<EaBrokerPosition[]> {
  const conn = await getEaConnection(userId);
  return parseEaPositions(conn?.positions_json ?? null);
}

/**
 * Attach live EA position profit to open MT5 trades (order_id ↔ ticket).
 * DB rows persist pnl only on close; without this, open trades read as a fake
 * "0" everywhere the payload is displayed (cards, agent summaries).
 */
export function attachLiveEaPnl<T extends Trade>(
  trades: T[],
  positions: EaBrokerPosition[],
): T[] {
  if (!positions.length) return trades;
  const byTicket = new Map(positions.map((p) => [String(p.ticket), p]));
  return trades.map((t) => {
    if (t.status !== "open" || t.broker !== "mt_ea" || !t.order_id) return t;
    const pos = byTicket.get(String(t.order_id));
    return pos && Number.isFinite(pos.profit) ? { ...t, pnl: pos.profit } : t;
  });
}
