/**
 * Non-configurable product-level scalp geometry contract.
 * Not a user-facing risk policy: it only decides whether verified levels are
 * executable. Market direction remains the AI model's sole authority.
 */

export const SCALP_GEOMETRY = {
  /** Minimum net R for TP1 after spread/slippage costs. */
  minNetTp1R: 2.5,
  /** Preferred TP2 band when real structure supports it. */
  preferredTp2MinR: 4,
  preferredTp2MaxR: 5,
  /** Extra cost modelled as a fraction of the quoted spread. */
  slippageSpreadMult: 0.5,
  /** Activation distance (ATR multiples) treated as immediate. */
  immediateMaxAtr: 0.4,
  /** Beyond this ATR distance a pending setup is conditional. */
  conditionalMaxAtr: 4,
  /** Hard distance beyond which we do not attach executable levels. */
  rejectActivationAtr: 8,
} as const;

export type TradeSpanStyle = "scalp" | "intraday" | "swing";

/**
 * Per-style span & protection contract.
 *
 * Product rule (operator-set): a plan must span a REAL swing — on the order of
 * 30 candles of travel on the analyzed timeframe, not a handful of points —
 * and the stop never sits ON the structural level: it takes a strong
 * volatility buffer beyond it (e.g. structural 4393.52 → stop 4401.79 on
 * gold). Directional travel over ~30 bars runs well above per-bar ATR, so the
 * floors are expressed as ATR multiples of the analyzed timeframe.
 *
 * The nearest-structural-target-first selection defeated this on its own:
 * with a tight stop, 2.5R net on gold is a ~10-point scalp. The span floor
 * filters the structural pool BEFORE the nearest-first pick.
 */
export const TRADE_SPAN: Record<
  TradeSpanStyle,
  {
    /** TP1 must sit at least this many ATR from the entry. */
    minTp1Atr: number;
    /** TP2 must sit at least this many ATR from the entry. */
    minTp2Atr: number;
    /** Stop buffer BEYOND the structural level, in ATR. */
    stopBufferAtr: number;
    /**
     * Minimum distance between ENTRY and stop, in ATR. Structure + buffer
     * places the stop; this is the floor under the whole distance, so a thin
     * zone (entry at one edge, structure a point away) cannot produce a stop
     * one ordinary rejection candle wipes out.
     */
    minStopAtr: number;
  }
> = {
  scalp: { minTp1Atr: 3.5, minTp2Atr: 6, stopBufferAtr: 0.5, minStopAtr: 2 },
  intraday: { minTp1Atr: 4.5, minTp2Atr: 7.5, stopBufferAtr: 0.6, minStopAtr: 1.5 },
  swing: { minTp1Atr: 6, minTp2Atr: 10, stopBufferAtr: 0.75, minStopAtr: 1.2 },
};

/**
 * Interval → span style. Local rather than reusing riskPolicy's mapper: this
 * one accepts any raw interval string the pipeline carries ("15m", "1h", "D")
 * and must never throw on an unknown one.
 */
export function spanStyleForInterval(interval?: string | null): TradeSpanStyle {
  const raw = (interval ?? "").trim().toLowerCase();
  if (raw === "1m" || raw === "5m" || raw === "1" || raw === "5") return "scalp";
  if (
    raw === "15m" ||
    raw === "30m" ||
    raw === "15" ||
    raw === "30" ||
    raw === "45m" ||
    raw === "45"
  ) {
    return "intraday";
  }
  return raw ? "swing" : "intraday";
}

export function tradeSpanFor(interval?: string | null) {
  return TRADE_SPAN[spanStyleForInterval(interval)];
}

/**
 * The least distance a stop may sit from its entry on the analyzed timeframe:
 * the style's ATR floor, or a spread multiple when the ATR is unknown. The
 * structure decides WHERE the stop goes; this decides that it is not so close
 * that one rejection wick decides the trade.
 */
export function minStopDistance(input: {
  atr?: number | null;
  spread?: number | null;
  interval?: string | null;
  price: number;
  meta?: SymbolGeometryMeta | null;
}): number {
  const span = tradeSpanFor(input.interval);
  const atr = Number(input.atr);
  const spread = Number(input.spread ?? input.meta?.spread);
  const tick = inferTickSize(input.price, input.meta);
  return Math.max(
    Number.isFinite(atr) && atr > 0 ? atr * span.minStopAtr : 0,
    Number.isFinite(spread) && spread > 0 ? spread * 4 : 0,
    tick * 20,
  );
}

/**
 * Push a stop OUT to the minimum distance when structure put it too close to
 * the entry. Never pulls a stop in; never moves an entry. Returns the stop as
 * given when it already clears the floor or the geometry is unusable.
 */
export function applyStopDistanceFloor(input: {
  action: "buy" | "sell";
  entry: number;
  stop: number;
  atr?: number | null;
  spread?: number | null;
  interval?: string | null;
  meta?: SymbolGeometryMeta | null;
}): { stop: number; floor: number; widened: boolean } {
  const floor = minStopDistance({
    atr: input.atr,
    spread: input.spread,
    interval: input.interval,
    price: input.entry,
    meta: input.meta,
  });
  if (!(input.entry > 0) || !(input.stop > 0) || !(floor > 0)) {
    return { stop: input.stop, floor, widened: false };
  }
  const distance = Math.abs(input.entry - input.stop);
  if (distance + 1e-9 >= floor) return { stop: input.stop, floor, widened: false };
  const widened = roundToTick(
    input.action === "buy" ? input.entry - floor : input.entry + floor,
    input.meta,
  );
  return { stop: widened, floor, widened: true };
}

export type GeometryActivationClass =
  | "immediate"
  | "conditional"
  | "non_executable";

export interface SymbolGeometryMeta {
  tickSize?: number | null;
  digits?: number | null;
  spread?: number | null;
}

export function inferTickSize(
  price: number,
  meta?: SymbolGeometryMeta | null,
): number {
  const fromMeta = Number(meta?.tickSize);
  if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta;
  if (price > 100) return 0.01;
  if (price > 10) return 0.001;
  if (price > 2) return 0.0001;
  return 0.00001;
}

export function roundToTick(
  price: number,
  meta?: SymbolGeometryMeta | null,
): number {
  const tick = inferTickSize(price, meta);
  const digits =
    Number.isFinite(Number(meta?.digits)) && Number(meta?.digits) >= 0
      ? Number(meta?.digits)
      : Math.max(0, Math.round(-Math.log10(tick)));
  const stepped = Math.round(price / tick) * tick;
  const f = 10 ** digits;
  return Math.round(stepped * f) / f;
}

export function levelOrderValid(input: {
  action: "buy" | "sell";
  entry: number;
  stop: number;
  targets: number[];
}): boolean {
  const { action, entry, stop, targets } = input;
  if (!(entry > 0) || !(stop > 0) || !targets.length) return false;
  if (action === "buy") {
    if (!(stop < entry)) return false;
    return targets.every((t) => t > entry);
  }
  if (!(entry < stop)) return false;
  return targets.every((t) => t < entry);
}

/** One-way execution cost used when converting gross reward into net reward. */
export function expectedExecutionCost(input: {
  spread?: number | null;
  meta?: SymbolGeometryMeta | null;
}): number {
  const spread = Number(input.spread ?? input.meta?.spread);
  if (Number.isFinite(spread) && spread > 0) {
    return spread * (1 + SCALP_GEOMETRY.slippageSpreadMult);
  }
  return 0;
}

export function computeGrossR(input: {
  entry: number;
  stop: number;
  target: number;
}): number {
  const risk = Math.abs(input.entry - input.stop);
  if (!(risk > 0)) return 0;
  return Math.abs(input.target - input.entry) / risk;
}

/**
 * Effective (net) R after modelled spread + slippage. Costs reduce reward and
 * enlarge risk by half a cost unit on each side of the trade.
 */
export function computeNetR(input: {
  action: "buy" | "sell";
  entry: number;
  stop: number;
  target: number;
  spread?: number | null;
  meta?: SymbolGeometryMeta | null;
}): number {
  const cost = expectedExecutionCost(input);
  const risk = Math.abs(input.entry - input.stop) + cost;
  if (!(risk > 0)) return 0;
  const reward = Math.max(0, Math.abs(input.target - input.entry) - cost);
  return reward / risk;
}

export function classifyActivation(input: {
  entry: number;
  currentPrice: number;
  atr: number | null;
  entryType: "market" | "buy_limit" | "buy_stop" | "sell_limit" | "sell_stop";
}): GeometryActivationClass {
  if (input.entryType === "market") return "immediate";
  const atr = input.atr && input.atr > 0 ? input.atr : null;
  const distance = Math.abs(input.entry - input.currentPrice);
  if (atr == null) {
    return distance <= Math.abs(input.currentPrice) * 0.0005
      ? "immediate"
      : "conditional";
  }
  const atrMult = distance / atr;
  if (atrMult <= SCALP_GEOMETRY.immediateMaxAtr) return "immediate";
  // A candidate may legitimately wait for a pullback several ATR away — this
  // grades INTERNAL candidates only. What reaches the user as an actionable
  // trade is decided by the publish-side tradability budget
  // (lib/recommendations/tradability.ts), whose limits are far tighter.
  if (atrMult <= SCALP_GEOMETRY.rejectActivationAtr) return "conditional";
  return "non_executable";
}

/**
 * Is this level set executable, and is it worth taking at the current price?
 *
 * The two questions are answered separately on purpose. Invalid level ORDER is
 * a hard fault — those numbers cannot become an order. A weak net R is not: it
 * means the move does not pay for its own spread and slippage right now, which
 * is a fact the model must see and act on (better price, split entry, different
 * plan type) rather than a reason to delete the candidate before the model ever
 * sees it. Silently dropping these was how "the spread is wide today" turned
 * into "no opinion".
 */
export function meetsExecutableGeometry(input: {
  action: "buy" | "sell";
  entry: number;
  stop: number;
  targets: number[];
  spread?: number | null;
  meta?: SymbolGeometryMeta | null;
}): {
  ok: boolean;
  netTp1R: number;
  grossTp1R: number;
  reason?: string;
  /** Net TP1 R is below the preferred scalp minimum — a warning, not a reject. */
  belowPreferredNetR?: boolean;
} {
  if (
    !levelOrderValid({
      action: input.action,
      entry: input.entry,
      stop: input.stop,
      targets: input.targets,
    })
  ) {
    return {
      ok: false,
      netTp1R: 0,
      grossTp1R: 0,
      reason: "level_order_invalid",
    };
  }
  const tp1 = input.targets[0]!;
  const grossTp1R = computeGrossR({
    entry: input.entry,
    stop: input.stop,
    target: tp1,
  });
  const netTp1R = computeNetR({
    action: input.action,
    entry: input.entry,
    stop: input.stop,
    target: tp1,
    spread: input.spread,
    meta: input.meta,
  });
  if (netTp1R + 1e-9 < SCALP_GEOMETRY.minNetTp1R) {
    return {
      ok: true,
      netTp1R,
      grossTp1R,
      reason: "tp1_net_r_below_minimum",
      belowPreferredNetR: true,
    };
  }
  return { ok: true, netTp1R, grossTp1R };
}

/** Balanced quality score — POI alone cannot dominate weak geometry. */
export function scoreCandidateQuality(input: {
  poiScore: number;
  netTp1R: number;
  netTp2R: number | null;
  activationDistanceAtr: number;
  structuralTargetCount: number;
}): number {
  const poi = Math.max(0, Math.min(1, input.poiScore / 100));
  const tp1 = Math.max(
    0,
    Math.min(1, input.netTp1R / (SCALP_GEOMETRY.minNetTp1R * 1.6)),
  );
  const tp2 =
    input.netTp2R == null
      ? 0.35
      : Math.max(
          0,
          Math.min(1, input.netTp2R / SCALP_GEOMETRY.preferredTp2MaxR),
        );
  const proximity = Math.max(
    0,
    1 - Math.min(1, input.activationDistanceAtr / SCALP_GEOMETRY.conditionalMaxAtr),
  );
  const structure = Math.max(
    0,
    Math.min(1, input.structuralTargetCount / 3),
  );
  return (
    0.22 * poi +
    0.38 * tp1 +
    0.15 * tp2 +
    0.15 * proximity +
    0.1 * structure
  );
}
