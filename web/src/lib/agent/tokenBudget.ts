/**
 * Token-budget helpers. Never send thousands of raw candles to the LLM — send
 * summaries + the most recent slice only. Structured context, not raw history.
 */
export function trimCandlesForPrompt<T>(candles: T[], max = 120): T[] {
  return candles.slice(-max);
}

/** Compact one-line summary of a candle array for the prompt. */
export function summarizeCandles(
  candles: Array<{ close: number; high: number; low: number }>,
): string {
  if (!candles.length) return "لا شموع";
  const closes = candles.map((c) => c.close);
  const high = Math.max(...candles.map((c) => c.high));
  const low = Math.min(...candles.map((c) => c.low));
  const first = closes[0]!;
  const last = closes.at(-1)!;
  const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
  return `${candles.length} شمعة · الإغلاق ${last} · أعلى ${high} · أدنى ${low} · تغيّر ${changePct.toFixed(2)}%`;
}
