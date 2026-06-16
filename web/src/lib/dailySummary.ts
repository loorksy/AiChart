import { wakeAgentViaTelegram } from "./agentWake";
import { isAgentWakeEnabled } from "./agentWakeConfig";
import { listTrades } from "./store";
import { sendMessage } from "./telegram";

export async function buildDailySummary(
  userId: number,
  capital: number,
): Promise<{ text: string; pnl: number; closed: number; open: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const trades = await listTrades(userId, 200);
  const closedToday = trades.filter(
    (t) => t.status === "closed" && t.closed_at?.slice(0, 10) === today,
  );
  const open = trades.filter((t) => t.status === "open");
  const pnl = closedToday.reduce((a, t) => a + t.pnl, 0);
  const pnlPct = capital > 0 ? (pnl / capital) * 100 : 0;

  const text = [
    `<b>📊 ملخّص يومي · Daily summary</b>`,
    ``,
    `التاريخ · Date: ${today}`,
    `صفقات مغلقة · Closed: ${closedToday.length}`,
    `صفقات مفتوحة · Open: ${open.length}`,
    `الربح/الخسارة · PnL: ${pnl >= 0 ? "🟢 +" : "🔴 "}${pnl.toFixed(2)} USDT` +
      (capital > 0 ? ` (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)` : ""),
    ``,
    open.length
      ? `<b>مفتوحة · Open:</b>\n` +
        open
          .slice(0, 5)
          .map(
            (t) =>
              `• ${t.symbol} ${t.side === "buy" ? "🟢" : "🔴"} ${t.qty} @ ${t.avg_price}`,
          )
          .join("\n")
      : "لا صفقات مفتوحة. · No open positions.",
  ].join("\n");

  return { text, pnl, closed: closedToday.length, open: open.length };
}

export async function sendDailySummary(
  chatId: string,
  userId: number,
  capital: number,
): Promise<void> {
  const summary = await buildDailySummary(userId, capital);
  await sendMessage(chatId, summary.text);
  if (isAgentWakeEnabled()) {
    await wakeAgentViaTelegram(userId, {
      event: "daily_memory",
      detail: summary.text.replace(/<[^>]+>/g, ""),
      dedupeMinutes: 1200,
    });
  }
}
