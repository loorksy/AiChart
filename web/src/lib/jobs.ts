/**
 * Job handler registrations. Imported (side-effecting) by the queue on first
 * use and by the worker process. Keep handlers thin: resolve inputs and call
 * the existing domain function so logic stays in one place.
 */
import { hasHandler, registerHandler } from "./queue";
import { runTradePostMortem } from "./tradePostMortem";

// Guarded so an explicitly pre-registered handler (e.g. in tests) is not
// clobbered when this side-effecting module is auto-imported.
if (!hasHandler("trade_post_mortem")) {
  registerHandler("trade_post_mortem", async ({ userId, tradeId, pnl }) => {
    await runTradePostMortem(userId, tradeId, pnl);
  });
}
