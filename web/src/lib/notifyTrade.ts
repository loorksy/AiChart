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
  chartUrl?: string | null,
): Promise<void> {
  if (!result.ok || !result.trade) {
    await notifyUser(
      userId,
      `⚠️ تعذّر تنفيذ ${symbol} · Not executed: ${result.reason}`,
    );
    return;
  }

  const settings = await getSettings(userId);
  const text = executedCard(result.trade);
  if (settings.send_screenshot === 1) {
    const image =
      chartUrl ?? (await buildChartImageUrl(symbol, timeframe));
    if (image) {
      await notifyUserPhoto(userId, image, text);
      return;
    }
  }
  await notifyUser(userId, text);
}
