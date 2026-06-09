import { getSettings } from "./store";
import { buildChartImageUrl } from "./chartImage";
import { executedCard } from "./telegram";
import { dispatchAlert } from "./alerts";
import type { ExecutionResult } from "./execution";

/** Notifies the user on Telegram after a trade execution attempt. */
export async function notifyTradeResult(
  userId: number,
  result: ExecutionResult,
  symbol: string,
  timeframe = "1h",
  chartUrl?: string | null,
): Promise<void> {
  if (!result.ok || !result.trade) {
    await dispatchAlert(userId, {
      type: "trade_failed",
      title: `تعذّر تنفيذ ${symbol}`,
      text: `⚠️ تعذّر تنفيذ ${symbol} · Not executed: ${result.reason}`,
      symbol,
    });
    return;
  }

  const settings = await getSettings(userId);
  const text = executedCard(result.trade);
  let photoUrl: string | null = null;
  if (settings.send_screenshot === 1) {
    photoUrl = chartUrl ?? (await buildChartImageUrl(symbol, timeframe));
  }
  await dispatchAlert(userId, {
    type: "trade_executed",
    title: `تم تنفيذ صفقة ${symbol}`,
    text,
    symbol,
    photoUrl,
  });
}
