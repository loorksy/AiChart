import { getSettings } from "./store";
import { buildChartImageUrl } from "./chartImage";
import { notifyUser, notifyUserPhoto, executedCard } from "./telegram";
import type { ExecutionResult } from "./execution";

/** Notifies the user on Telegram after a trade execution attempt. */
export async function notifyTradeResult(
  userId: number,
  result: ExecutionResult,
  symbol: string,
  timeframe = "1h",
): Promise<void> {
  if (!result.ok || !result.trade) {
    await notifyUser(
      userId,
      `⚠️ تعذّر تنفيذ ${symbol} · Not executed: ${result.reason}`,
    );
    return;
  }

  const settings = getSettings(userId);
  const text = executedCard(result.trade);
  if (settings.send_screenshot === 1) {
    const chartUrl = await buildChartImageUrl(symbol, timeframe);
    if (chartUrl) {
      await notifyUserPhoto(userId, chartUrl, text);
      return;
    }
  }
  await notifyUser(userId, text);
}
