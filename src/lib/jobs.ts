/**
 * Job handler registrations. Imported (side-effecting) by the queue on first
 * use and by the worker process. Keep handlers thin: resolve inputs and call
 * the existing domain function so logic stays in one place.
 */
import { runMemoryLifecycle } from "./memoryLifecycle";
import { runOpportunityScanForUser } from "./opportunityScan";
import { hasHandler, registerHandler } from "./queue";
import { runTradePostMortem } from "./tradePostMortem";

// Guarded so an explicitly pre-registered handler (e.g. in tests) is not
// clobbered when this side-effecting module is auto-imported.
if (!hasHandler("trade_post_mortem")) {
  registerHandler("trade_post_mortem", async ({ userId, tradeId, pnl }) => {
    await runTradePostMortem(userId, tradeId, pnl);
  });
}

if (!hasHandler("opportunity_scan")) {
  registerHandler("opportunity_scan", async ({ userId }) => {
    await runOpportunityScanForUser(userId);
  });
}

if (!hasHandler("memory_lifecycle")) {
  registerHandler("memory_lifecycle", async ({ userId, conversationId }) => {
    await runMemoryLifecycle(userId, conversationId);
  });
}

if (!hasHandler("deep_analysis_poll")) {
  registerHandler("deep_analysis_poll", async (payload) => {
    const { pollDeepAnalysisOnce } = await import(
      "./agent/deepAnalysis/completion"
    );
    await pollDeepAnalysisOnce(payload);
  });
}

if (!hasHandler("candle_gap_repair")) {
  registerHandler("candle_gap_repair", async ({ symbol, interval }) => {
    const { repairRecentCandleGaps } = await import(
      "./candles/candleBackfillService"
    );
    await repairRecentCandleGaps({ symbol, interval });
  });
}

if (!hasHandler("strategy_backtest_submit")) {
  registerHandler(
    "strategy_backtest_submit",
    async ({ userId, strategyId, symbol, timeframe }) => {
      const { submitStrategyBacktest, pipelineDateRange, hasBacktestForTarget } =
        await import("./strategies/pipeline");
      const { canonicalStrategyTimeframe } = await import(
        "./strategies/matchingKeys"
      );
      const tf = canonicalStrategyTimeframe(timeframe);
      if (!tf) throw new Error(`unsupported pipeline timeframe: ${timeframe}`);
      // Idempotence across retries: a row for this revision means done.
      if (await hasBacktestForTarget(userId, { strategyId, symbol, timeframe: tf })) {
        return;
      }
      const { fromMs, toMs } = pipelineDateRange(tf);
      await submitStrategyBacktest({
        userId,
        strategyId,
        symbol,
        timeframe: tf,
        fromMs,
        toMs,
      });
    },
  );
}

if (!hasHandler("strategy_backtest_advance")) {
  registerHandler("strategy_backtest_advance", async ({ userId, backtestId }) => {
    const { refreshStrategyBacktest } = await import("./strategies/evidence");
    const { randomUUID } = await import("node:crypto");
    await refreshStrategyBacktest({ userId, requestId: randomUUID() }, backtestId);
  });
}
