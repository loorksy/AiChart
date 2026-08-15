/**
 * The agent's own hands on the chart.
 *
 * Before this, the brain saw whatever the pipeline decided to show it — three
 * chart images chosen by a fixed ladder — and could ask for exactly ONE extra
 * frame, once. That is a reasonable safety property and a poor way to read a
 * market: the question "what did price do when it came back to 4348?" has an
 * answer in the candles, and a model that cannot ask it has to guess or stay
 * vague.
 *
 * So the single extra-frame round becomes a bounded BROWSE loop. Each round the
 * brain may issue one request, receives the answer, and re-issues its full
 * decision. Three verbs, because they are the three questions a chart reader
 * actually asks:
 *
 *  - `view_timeframe` — show me that frame (image + its numbers).
 *  - `read_candles`   — give me the last N bars of a frame as numbers.
 *  - `read_zone`      — what did price DO at this band: touch it, close
 *                       through it, reject from it?
 *
 * Everything here is a bound. A loop that a model controls is a loop a model
 * can run forever, so: a call budget, a wall clock, a whitelist per verb, and
 * a repeat guard — asking the same question twice spends the budget without
 * learning anything, so it is refused rather than served.
 */
import { TIMEFRAMES } from "@/lib/gold";

/** Total browse calls one analysis may spend. */
export const MAX_BROWSE_CALLS = 12;

/** Wall clock for the whole browse phase, however many calls it took. */
export const BROWSE_DEADLINE_MS = 25_000;

/** Bars `read_candles` may ask for at once. */
export const MAX_CANDLES_PER_READ = 120;

/**
 * Frames the brain may browse.
 *
 * The analysis frames plus the daily above them: 1d is context a 4h plan
 * genuinely needs, while anything below 5m is noise this product does not
 * trade on.
 */
export const BROWSABLE_TIMEFRAMES: readonly string[] = [...TIMEFRAMES, "1d"];

export const BROWSE_VERBS = ["view_timeframe", "read_candles", "read_zone"] as const;
export type BrowseVerb = (typeof BROWSE_VERBS)[number];

export interface ViewTimeframeRequest {
  verb: "view_timeframe";
  timeframe: string;
}

export interface ReadCandlesRequest {
  verb: "read_candles";
  timeframe: string;
  count: number;
}

export interface ReadZoneRequest {
  verb: "read_zone";
  timeframe: string;
  low: number;
  high: number;
}

export type BrowseRequest =
  | ViewTimeframeRequest
  | ReadCandlesRequest
  | ReadZoneRequest;

export type BrowseRefusal =
  | "not_a_request"
  | "unknown_verb"
  | "unbrowsable_timeframe"
  | "already_attached"
  | "invalid_band"
  | "repeat_request"
  | "budget_exhausted";

export interface BrowseDecision {
  request: BrowseRequest | null;
  refusal: BrowseRefusal | null;
}

/** Stable identity of a request, so the same question is only asked once. */
export function browseRequestKey(request: BrowseRequest): string {
  switch (request.verb) {
    case "view_timeframe":
      return `view:${request.timeframe}`;
    case "read_candles":
      return `candles:${request.timeframe}:${request.count}`;
    case "read_zone":
      return `zone:${request.timeframe}:${request.low}:${request.high}`;
  }
}

function normalizeTimeframe(value: unknown): string | null {
  const frame = String(value ?? "").trim().toLowerCase();
  return BROWSABLE_TIMEFRAMES.includes(frame) ? frame : null;
}

/**
 * Validate one request from the model.
 *
 * Refusals are NAMED rather than silently coerced. A request for a frame that
 * does not exist is a different fact from a request the budget cannot afford,
 * and the caller reports each as itself — a browse loop that quietly rewrites
 * what was asked teaches the model nothing about its own limits.
 */
export function normalizeBrowseRequest(input: {
  raw: unknown;
  /** Frames already attached as images — asking again buys nothing. */
  attachedTimeframes: readonly string[];
  /** Keys of requests already served this run. */
  servedKeys: ReadonlySet<string>;
  /** Calls already spent. */
  spent: number;
  maxCalls?: number;
}): BrowseDecision {
  const max = input.maxCalls ?? MAX_BROWSE_CALLS;
  if (input.raw == null) return { request: null, refusal: null };
  if (typeof input.raw !== "object") {
    return { request: null, refusal: "not_a_request" };
  }
  if (input.spent >= max) {
    return { request: null, refusal: "budget_exhausted" };
  }

  const raw = input.raw as Record<string, unknown>;
  const verb = String(raw.verb ?? "").trim();
  if (!(BROWSE_VERBS as readonly string[]).includes(verb)) {
    return { request: null, refusal: "unknown_verb" };
  }

  const timeframe = normalizeTimeframe(raw.timeframe);
  if (!timeframe) return { request: null, refusal: "unbrowsable_timeframe" };

  let request: BrowseRequest;
  if (verb === "view_timeframe") {
    // An image the brain already has in front of it is not new information.
    if (
      input.attachedTimeframes.some(
        (frame) => frame.trim().toLowerCase() === timeframe,
      )
    ) {
      return { request: null, refusal: "already_attached" };
    }
    request = { verb, timeframe };
  } else if (verb === "read_candles") {
    const asked = Number(raw.count);
    const count = Number.isFinite(asked)
      ? Math.min(MAX_CANDLES_PER_READ, Math.max(1, Math.floor(asked)))
      : 60;
    request = { verb, timeframe, count };
  } else {
    const a = Number(raw.low);
    const b = Number(raw.high);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) {
      return { request: null, refusal: "invalid_band" };
    }
    request = {
      verb: "read_zone",
      timeframe,
      low: Math.min(a, b),
      high: Math.max(a, b),
    };
  }

  if (input.servedKeys.has(browseRequestKey(request))) {
    return { request: null, refusal: "repeat_request" };
  }
  return { request, refusal: null };
}

export interface BrowseCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ZoneReading {
  /** Bars whose range overlapped the band at all. */
  touches: number;
  /** Bars that CLOSED inside the band. */
  closesInside: number;
  /** Bars that pierced the band and closed back above it. */
  rejectionsUp: number;
  /** Bars that pierced the band and closed back below it. */
  rejectionsDown: number;
  /** Bars that closed clean through, above and below. */
  closedAbove: number;
  closedBelow: number;
  /** Epoch of the most recent touch, or null when price never came back. */
  lastTouchAt: number | null;
}

/**
 * What price actually DID at a band.
 *
 * A rejection is not "the wick entered": it is the wick entering AND the close
 * coming back out on the side price approached from. Counting the wick alone
 * would report a rejection for every bar that simply traded through, which is
 * the opposite reading.
 */
export function readZone(
  candles: readonly BrowseCandle[],
  low: number,
  high: number,
): ZoneReading {
  const reading: ZoneReading = {
    touches: 0,
    closesInside: 0,
    rejectionsUp: 0,
    rejectionsDown: 0,
    closedAbove: 0,
    closedBelow: 0,
    lastTouchAt: null,
  };
  for (const candle of candles) {
    const overlaps = candle.low <= high && candle.high >= low;
    if (!overlaps) continue;
    reading.touches += 1;
    reading.lastTouchAt = candle.time;

    if (candle.close >= low && candle.close <= high) {
      reading.closesInside += 1;
      continue;
    }
    if (candle.close > high) {
      reading.closedAbove += 1;
      // Pierced below the band and closed back above it: rejected upward.
      if (candle.low < low) reading.rejectionsUp += 1;
    } else {
      reading.closedBelow += 1;
      if (candle.high > high) reading.rejectionsDown += 1;
    }
  }
  return reading;
}

/** The browse answer as the model reads it — plain prose, no invented figures. */
export function describeZoneReading(
  request: ReadZoneRequest,
  reading: ZoneReading,
): string {
  if (reading.touches === 0) {
    return `Zone ${request.low}–${request.high} on ${request.timeframe}: price never traded into this band in the window read.`;
  }
  const parts = [
    `${reading.touches} bar(s) traded into it`,
    `${reading.closesInside} closed inside`,
    `${reading.closedAbove} closed above`,
    `${reading.closedBelow} closed below`,
    `${reading.rejectionsUp} rejection(s) upward`,
    `${reading.rejectionsDown} rejection(s) downward`,
  ];
  return `Zone ${request.low}–${request.high} on ${request.timeframe}: ${parts.join(", ")}.`;
}

/** Candles as a compact table the model can read without a parser. */
export function describeCandles(
  request: ReadCandlesRequest,
  candles: readonly BrowseCandle[],
): string {
  if (candles.length === 0) {
    return `No ${request.timeframe} candles were available.`;
  }
  const rows = candles
    .map((c) => `${c.time}|${c.open}|${c.high}|${c.low}|${c.close}`)
    .join("\n");
  return `Last ${candles.length} ${request.timeframe} candles (time|open|high|low|close):\n${rows}`;
}

/** The operator-facing line for one browse round. */
export function browseActivityAr(request: BrowseRequest): string {
  switch (request.verb) {
    case "view_timeframe":
      return `فتح الوكيل فريم ${request.timeframe} للاطلاع عليه.`;
    case "read_candles":
      return `قرأ الوكيل آخر ${request.count} شمعة على فريم ${request.timeframe}.`;
    case "read_zone":
      return `فحص الوكيل سلوك السعر عند المنطقة ${request.low}–${request.high} على ${request.timeframe}.`;
  }
}
