/**
 * Bounded raw OHLCV envelopes for the model-first decision context.
 */
export type OhlcvBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type CandleEnvelope = {
  timeframe: string;
  role: "primary" | "context";
  source: string;
  capturedAt: number;
  freshnessAgeMs: number | null;
  fresh: boolean;
  requestedCount: number;
  availableCount: number;
  includedCount: number;
  firstCandleTime: number | null;
  lastCandleTime: number | null;
  truncated: boolean;
  candles: OhlcvBar[];
};

const DEFAULT_PRIMARY = 120;
const DEFAULT_CONTEXT = 80;

export function buildCandleEnvelope(input: {
  timeframe: string;
  role: "primary" | "context";
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }>;
  requestedCount?: number;
  source: string;
  capturedAt?: number;
}): CandleEnvelope {
  const requested =
    input.requestedCount ??
    (input.role === "primary" ? DEFAULT_PRIMARY : DEFAULT_CONTEXT);
  for (let index = 1; index < input.candles.length; index += 1) {
    if (input.candles[index]!.time <= input.candles[index - 1]!.time) {
      throw new Error(`candles_not_chronological_${input.timeframe}`);
    }
  }
  const available = input.candles.length;
  const slice = input.candles.slice(-requested);
  const included = slice.length;
  const capturedAt = input.capturedAt ?? Date.now();
  const lastTime = slice.at(-1)?.time ?? null;
  const lastTimeMs =
    lastTime == null ? null : lastTime < 1_000_000_000_000 ? lastTime * 1000 : lastTime;
  const freshnessAgeMs =
    lastTimeMs == null ? null : Math.max(0, capturedAt - lastTimeMs);
  return {
    timeframe: input.timeframe,
    role: input.role,
    source: input.source,
    capturedAt,
    freshnessAgeMs,
    fresh: freshnessAgeMs != null && freshnessAgeMs <= 24 * 60 * 60 * 1000,
    requestedCount: requested,
    availableCount: available,
    includedCount: included,
    firstCandleTime: slice[0]?.time ?? null,
    lastCandleTime: slice.at(-1)?.time ?? null,
    truncated: available > included,
    candles: slice.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      ...(typeof c.volume === "number" ? { volume: c.volume } : {}),
    })),
  };
}
