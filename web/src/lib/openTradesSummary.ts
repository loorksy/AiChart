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
    `البيئة · Env: <b>${executionEnvLabelAr(
      env.activeMarket === "forex" ? env.forex.resolved : env.crypto.resolved,
    )}</b>`,
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
