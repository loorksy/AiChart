import type { Trade } from "./types";
import { executionEnvLabelAr, getExecutionEnvSnapshot } from "./executionEnv";

export async function buildOpenTradesSummary(
  userId: number,
  aichartTrades: Trade[],
): Promise<string> {
  const env = await getExecutionEnvSnapshot(userId);
  const lines: string[] = [
    `<b>📂 الصفقات المفتوحة</b>`,
    `البيئة · Env: <b>${executionEnvLabelAr(env.forex.resolved)}</b>`,
    ``,
  ];

  if (aichartTrades.length === 0) {
    lines.push("لا صفقات مفتوحة حالياً.");
    return lines.join("\n");
  }

  lines.push(`<b>Lonora (${aichartTrades.length})</b>`);
  for (const t of aichartTrades) {
    lines.push(
      `• ${t.symbol} ${t.side === "buy" ? "شراء" : "بيع"} · ${t.qty} @ ${t.avg_price} · ${t.env}`,
    );
  }

  return lines.join("\n");
}
