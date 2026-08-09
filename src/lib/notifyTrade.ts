import { buildAccountProfile } from "./accountProfile";
import { dispatchAlert } from "./alerts";
import type { ExecutionResult } from "./execution";
import { getSettings } from "./store";
import { buildChartImageUrl } from "./chartImage";
import { tradeResultCard } from "./telegramCards";
import { postTradeButtons } from "./telegramCommands";

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
      text: `⚠️ تعذّر تنفيذ ${symbol}: ${result.reason}`,
      symbol,
    });
    return;
  }

  const settings = await getSettings(userId);
  const profile = await buildAccountProfile(userId, symbol);
  const text = tradeResultCard({
    symbol: result.trade.symbol,
    side: result.trade.side,
    qty: result.trade.qty,
    avg_price: result.trade.avg_price,
    profile,
  });
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
    buttons: postTradeButtons(),
  });
}
