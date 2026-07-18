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
}): CandleEnvelope {
  const requested =
    input.requestedCount ??
    (input.role === "primary" ? DEFAULT_PRIMARY : DEFAULT_CONTEXT);
  const available = input.candles.length;
  const slice = input.candles.slice(-requested);
  const included = slice.length;
  return {
    timeframe: input.timeframe,
    role: input.role,
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
