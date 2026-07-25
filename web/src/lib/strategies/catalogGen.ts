/**
 * Generative strategy catalog — seven families × parameter grids ≈ 60 specs.
 *
 * Every entry is DECLARATIVE: the only strategy-specific artefact is the
 * entry-condition tree, built strictly from the condition leaves the research
 * service supports (ema_relation, sma_relation, rsi_threshold, atr_threshold,
 * range_breakout, market_session, time_window). Risk/exit/cost policy stays
 * shared in buildBacktestStrategySpec, and EVERY entry passes the identical
 * statistical gates (≥100 trades → MC/bootstrap/walk-forward validation →
 * readiness → shadow → live outcomes). The catalog proposes; the gates decide.
 *
 * Ids match ^[a-z0-9_]+_v\d+$ (the MCP shape contract). Never rename an id —
 * deployed evidence rows reference it; add a _v2 instead.
 */
import type { ResearchTimeframe } from "@/lib/research";
import { styleForTimeframe } from "./riskPolicy";

type ConditionLeaf = Record<string, unknown>;

export interface ConditionTreePair {
  long_entry_conditions: { all: ConditionLeaf[] };
  short_entry_conditions: { all: ConditionLeaf[] };
}

export interface CatalogEntry {
  id: string;
  family: string;
  label: string;
  buildConditions(timeframe: ResearchTimeframe): ConditionTreePair;
}

// --- Leaf builders -----------------------------------------------------------

function emaCross(
  timeframe: ResearchTimeframe,
  fast: number,
  slow: number,
  direction: "long" | "short",
): ConditionLeaf {
  return {
    type: "ema_relation",
    timeframe,
    fast_period: fast,
    slow_period: slow,
    operator: direction === "long" ? "crosses_above" : "crosses_below",
  };
}

function rsiThreshold(
  timeframe: ResearchTimeframe,
  period: number,
  operator: "above" | "below" | "crosses_above" | "crosses_below",
  value: number,
): ConditionLeaf {
  return { type: "rsi_threshold", timeframe, period, operator, value };
}

/** Price vs SMA(period): sma_relation with fast_period=1 IS the close price. */
function priceVsSma(
  timeframe: ResearchTimeframe,
  period: number,
  side: "above" | "below",
): ConditionLeaf {
  return {
    type: "sma_relation",
    timeframe,
    fast_period: 1,
    slow_period: period,
    operator: side,
  };
}

function marketSession(sessions: string[]): ConditionLeaf {
  return { type: "market_session", sessions };
}

function timeWindow(
  timezone: string,
  start: string,
  end: string,
): ConditionLeaf {
  return {
    type: "time_window",
    timezone,
    start_time: start,
    end_time: end,
    allow_overnight: false,
  };
}

function rangeBreakout(
  timeframe: ResearchTimeframe,
  lookback: number,
  direction: "long" | "short",
  confirmation: "close" | "high_low",
): ConditionLeaf {
  return {
    type: "range_breakout",
    timeframe,
    lookback_bars: lookback,
    direction: direction === "long" ? "above_high" : "below_low",
    confirmation,
    offset_pips: 0,
  };
}

function atrThreshold(
  timeframe: ResearchTimeframe,
  operator: "above" | "below",
  valuePct: number,
): ConditionLeaf {
  return {
    type: "atr_threshold",
    timeframe,
    period: 14,
    operator,
    value: valuePct,
    unit: "percentage",
  };
}

// --- Session filter variants --------------------------------------------------

interface SessionVariant {
  suffix: string;
  labelSuffix: string;
  leaves: ConditionLeaf[];
}

const NO_SESSION: SessionVariant = { suffix: "", labelSuffix: "", leaves: [] };
const SESSION_LONDON: SessionVariant = {
  suffix: "_lon",
  labelSuffix: " (London)",
  leaves: [marketSession(["london"])],
};
const SESSION_NEW_YORK: SessionVariant = {
  suffix: "_ny",
  labelSuffix: " (New York)",
  leaves: [marketSession(["new_york"])],
};
const SESSION_OVERLAP: SessionVariant = {
  suffix: "_ovl",
  labelSuffix: " (LDN/NY overlap)",
  leaves: [marketSession(["london_new_york_overlap"])],
};
const LONDON_OPEN_WINDOW: SessionVariant = {
  suffix: "_lo",
  labelSuffix: " (London open)",
  leaves: [timeWindow("Europe/London", "08:00", "11:00")],
};
const NEW_YORK_OPEN_WINDOW: SessionVariant = {
  suffix: "_no",
  labelSuffix: " (NY open)",
  leaves: [timeWindow("America/New_York", "09:30", "12:00")],
};

// --- Families ------------------------------------------------------------------

function buildEmaCrossFamily(): CatalogEntry[] {
  const pairs: Array<[number, number]> = [
    [9, 21],
    [20, 50],
    [50, 200],
  ];
  const sessions = [NO_SESSION, SESSION_LONDON, SESSION_NEW_YORK, SESSION_OVERLAP];
  const out: CatalogEntry[] = [];
  for (const [fast, slow] of pairs) {
    for (const session of sessions) {
      out.push({
        id: `ema_cross_${fast}_${slow}${session.suffix}_v1`,
        family: "ema_cross",
        label: `EMA ${fast}/${slow} cross${session.labelSuffix}`,
        buildConditions: (timeframe) => ({
          long_entry_conditions: {
            all: [emaCross(timeframe, fast, slow, "long"), ...session.leaves],
          },
          short_entry_conditions: {
            all: [emaCross(timeframe, fast, slow, "short"), ...session.leaves],
          },
        }),
      });
    }
  }
  return out;
}

function buildEmaCrossRsiFamily(): CatalogEntry[] {
  const pairs: Array<[number, number]> = [
    [9, 21],
    [20, 50],
    [50, 200],
  ];
  const sessions = [NO_SESSION, SESSION_OVERLAP];
  const out: CatalogEntry[] = [];
  for (const [fast, slow] of pairs) {
    for (const session of sessions) {
      out.push({
        id: `ema_cross_rsi_${fast}_${slow}${session.suffix}_v1`,
        family: "ema_cross_rsi",
        label: `EMA ${fast}/${slow} cross + RSI filter${session.labelSuffix}`,
        buildConditions: (timeframe) => ({
          long_entry_conditions: {
            all: [
              emaCross(timeframe, fast, slow, "long"),
              rsiThreshold(timeframe, 14, "above", 50),
              ...session.leaves,
            ],
          },
          short_entry_conditions: {
            all: [
              emaCross(timeframe, fast, slow, "short"),
              rsiThreshold(timeframe, 14, "below", 50),
              ...session.leaves,
            ],
          },
        }),
      });
    }
  }
  return out;
}

function buildRsiMeanReversionFamily(): CatalogEntry[] {
  const periods = [7, 14];
  const bands: Array<[number, number]> = [
    [30, 70],
    [20, 80],
  ];
  const sessions = [NO_SESSION, SESSION_LONDON, SESSION_NEW_YORK];
  const out: CatalogEntry[] = [];
  // 2 periods × 2 bands × 3 sessions = 12 variants exactly.
  for (const period of periods) {
    for (const [low, high] of bands) {
      for (const session of sessions) {
        out.push({
          id: `rsi_mr_${period}_${low}_${high}${session.suffix}_v1`,
          family: "rsi_mr",
          label: `RSI(${period}) mean reversion ${low}/${high}${session.labelSuffix}`,
          buildConditions: (timeframe) => ({
            long_entry_conditions: {
              all: [
                rsiThreshold(timeframe, period, "crosses_below", low),
                ...session.leaves,
              ],
            },
            short_entry_conditions: {
              all: [
                rsiThreshold(timeframe, period, "crosses_above", high),
                ...session.leaves,
              ],
            },
          }),
        });
      }
    }
  }
  return out;
}

function buildRsiMrTrendFamily(): CatalogEntry[] {
  const bands: Array<[number, number]> = [
    [30, 70],
    [20, 80],
  ];
  const sessions = [NO_SESSION, SESSION_OVERLAP];
  const out: CatalogEntry[] = [];
  for (const [low, high] of bands) {
    for (const session of sessions) {
      out.push({
        id: `rsi_mr_trend_${low}_${high}${session.suffix}_v1`,
        family: "rsi_mr_trend",
        label: `RSI dip-buy with SMA200 trend ${low}/${high}${session.labelSuffix}`,
        buildConditions: (timeframe) => ({
          // Buy the oversold dip ONLY above the long trend; mirror for shorts.
          long_entry_conditions: {
            all: [
              rsiThreshold(timeframe, 14, "crosses_below", low),
              priceVsSma(timeframe, 200, "above"),
              ...session.leaves,
            ],
          },
          short_entry_conditions: {
            all: [
              rsiThreshold(timeframe, 14, "crosses_above", high),
              priceVsSma(timeframe, 200, "below"),
              ...session.leaves,
            ],
          },
        }),
      });
    }
  }
  return out;
}

function buildBreakoutFamily(): CatalogEntry[] {
  const lookbacks = [12, 20, 48];
  const confirmations: Array<["cls" | "hl", "close" | "high_low"]> = [
    ["cls", "close"],
    ["hl", "high_low"],
  ];
  const sessions = [NO_SESSION, LONDON_OPEN_WINDOW, NEW_YORK_OPEN_WINDOW];
  const out: CatalogEntry[] = [];
  for (const lookback of lookbacks) {
    for (const [confSuffix, confirmation] of confirmations) {
      for (const session of sessions) {
        out.push({
          id: `brk_${lookback}_${confSuffix}${session.suffix}_v1`,
          family: "breakout",
          label: `Range breakout ${lookback} bars (${confirmation})${session.labelSuffix}`,
          buildConditions: (timeframe) => ({
            long_entry_conditions: {
              all: [
                rangeBreakout(timeframe, lookback, "long", confirmation),
                ...session.leaves,
              ],
            },
            short_entry_conditions: {
              all: [
                rangeBreakout(timeframe, lookback, "short", confirmation),
                ...session.leaves,
              ],
            },
          }),
        });
      }
    }
  }
  return out;
}

/** Asia-session bars per timeframe (~8h) for the session-range breakout. */
function asiaBars(timeframe: ResearchTimeframe, share: 1 | 0.5): number {
  const perHour: Record<ResearchTimeframe, number> = {
    "1m": 60,
    "5m": 12,
    "15m": 4,
    "30m": 2,
    "1h": 1,
    "4h": 0.25,
    "1d": 0.05,
  };
  return Math.max(2, Math.round(8 * perHour[timeframe] * share));
}

function buildSessionRangeFamily(): CatalogEntry[] {
  const lookbacks: Array<["full", 1] | ["half", 0.5]> = [
    ["full", 1],
    ["half", 0.5],
  ];
  const floors: Array<["", null] | ["_atr", number]> = [
    ["", null],
    ["_atr", 0.08],
  ];
  const out: CatalogEntry[] = [];
  for (const [lbSuffix, share] of lookbacks) {
    for (const [floorSuffix, floorPct] of floors) {
      out.push({
        id: `session_range_${lbSuffix}${floorSuffix}_v1`,
        family: "session_range",
        label: `Asian-range breakout at London open (${lbSuffix}${floorPct ? ", ATR floor" : ""})`,
        buildConditions: (timeframe) => ({
          long_entry_conditions: {
            all: [
              rangeBreakout(timeframe, asiaBars(timeframe, share), "long", "close"),
              timeWindow("Europe/London", "08:00", "11:00"),
              ...(floorPct ? [atrThreshold(timeframe, "above", floorPct)] : []),
            ],
          },
          short_entry_conditions: {
            all: [
              rangeBreakout(timeframe, asiaBars(timeframe, share), "short", "close"),
              timeWindow("Europe/London", "08:00", "11:00"),
              ...(floorPct ? [atrThreshold(timeframe, "above", floorPct)] : []),
            ],
          },
        }),
      });
    }
  }
  return out;
}

/** ATR% regime thresholds per timeframe (intraday vol scales with the frame). */
const ATR_REGIME_SPLIT: Record<ResearchTimeframe, number> = {
  "1m": 0.05,
  "5m": 0.08,
  "15m": 0.12,
  "30m": 0.18,
  "1h": 0.25,
  "4h": 0.5,
  "1d": 1.0,
};

function buildAtrRegimeFamily(): CatalogEntry[] {
  const pairs: Array<[number, number]> = [
    [9, 21],
    [20, 50],
  ];
  const regimes: Array<["lowvol", "below"] | ["highvol", "above"]> = [
    ["lowvol", "below"],
    ["highvol", "above"],
  ];
  const out: CatalogEntry[] = [];
  for (const [fast, slow] of pairs) {
    for (const [regimeSuffix, operator] of regimes) {
      out.push({
        id: `atr_regime_${fast}_${slow}_${regimeSuffix}_v1`,
        family: "atr_regime",
        label: `EMA ${fast}/${slow} cross in ${regimeSuffix === "lowvol" ? "low" : "high"}-vol regime`,
        buildConditions: (timeframe) => ({
          long_entry_conditions: {
            all: [
              emaCross(timeframe, fast, slow, "long"),
              atrThreshold(timeframe, operator, ATR_REGIME_SPLIT[timeframe]),
            ],
          },
          short_entry_conditions: {
            all: [
              emaCross(timeframe, fast, slow, "short"),
              atrThreshold(timeframe, operator, ATR_REGIME_SPLIT[timeframe]),
            ],
          },
        }),
      });
    }
  }
  return out;
}

// --- Scalp-native families ---------------------------------------------------------
//
// These are NOT the slower families re-run on faster candles. Scalping asks a
// different question — where is a small, immediate displacement that resolves
// within minutes — so the entry logic differs in kind:
//   micro_break     : very short lookback break, wick-confirmed for speed,
//                     restricted to the liquid sessions where it can follow through
//   quick_mr        : short-period RSI extreme reverting toward the 20-bar mean,
//                     the classic scalp fade, session-gated
//   momentum_burst  : fast EMA displacement CONFIRMED by an ATR expansion, i.e.
//                     only take the burst when volatility actually arrived
//   vwap_ish_revert : price stretched away from the intraday mean (SMA proxy)
//                     during the overlap, fading back
//
// The scalp risk geometry (tight stop, near first target, ≤12-bar hold) comes
// from riskPolicy.ts, keyed on the timeframe — the catalog stays purely about
// entry conditions.

const LIQUID_SESSIONS: ConditionLeaf[] = [
  marketSession(["london", "new_york", "london_new_york_overlap"]),
];

function buildMicroBreakFamily(): CatalogEntry[] {
  const lookbacks = [3, 5, 8];
  const confirmations: Array<["hl" | "cls", "high_low" | "close"]> = [
    ["hl", "high_low"],
    ["cls", "close"],
  ];
  const out: CatalogEntry[] = [];
  for (const lookback of lookbacks) {
    for (const [suffix, confirmation] of confirmations) {
      out.push({
        id: `scalp_micro_break_${lookback}_${suffix}_v1`,
        family: "scalp_micro_break",
        label: `Micro-breakout ${lookback} bars (${confirmation}, liquid sessions)`,
        buildConditions: (timeframe) => ({
          long_entry_conditions: {
            all: [
              rangeBreakout(timeframe, lookback, "long", confirmation),
              ...LIQUID_SESSIONS,
            ],
          },
          short_entry_conditions: {
            all: [
              rangeBreakout(timeframe, lookback, "short", confirmation),
              ...LIQUID_SESSIONS,
            ],
          },
        }),
      });
    }
  }
  return out;
}

function buildQuickMeanReversionFamily(): CatalogEntry[] {
  const grids: Array<[number, number, number]> = [
    // [rsi period, oversold, overbought] — short periods only; a 14-period RSI
    // barely reaches an extreme inside a scalp's horizon.
    [3, 15, 85],
    [3, 20, 80],
    [5, 20, 80],
    [5, 25, 75],
  ];
  const out: CatalogEntry[] = [];
  for (const [period, low, high] of grids) {
    out.push({
      id: `scalp_quick_mr_${period}_${low}_${high}_v1`,
      family: "scalp_quick_mr",
      label: `Quick RSI(${period}) fade ${low}/${high} (liquid sessions)`,
      buildConditions: (timeframe) => ({
        long_entry_conditions: {
          all: [
            rsiThreshold(timeframe, period, "crosses_below", low),
            ...LIQUID_SESSIONS,
          ],
        },
        short_entry_conditions: {
          all: [
            rsiThreshold(timeframe, period, "crosses_above", high),
            ...LIQUID_SESSIONS,
          ],
        },
      }),
    });
  }
  return out;
}

/** ATR% floor that marks "volatility actually arrived" on scalp frames. */
const BURST_ATR_FLOOR: Record<ResearchTimeframe, number> = {
  "1m": 0.02,
  "5m": 0.04,
  "15m": 0.07,
  "30m": 0.1,
  "1h": 0.15,
  "4h": 0.3,
  "1d": 0.6,
};

function buildMomentumBurstFamily(): CatalogEntry[] {
  const pairs: Array<[number, number]> = [
    [3, 8],
    [5, 13],
    [8, 21],
  ];
  const out: CatalogEntry[] = [];
  for (const [fast, slow] of pairs) {
    out.push({
      id: `scalp_burst_${fast}_${slow}_v1`,
      family: "scalp_burst",
      label: `Momentum burst EMA ${fast}/${slow} with volatility expansion`,
      buildConditions: (timeframe) => ({
        long_entry_conditions: {
          all: [
            emaCross(timeframe, fast, slow, "long"),
            // Only take the burst when volatility is actually present —
            // a cross in dead tape is pure cost on a scalp.
            atrThreshold(timeframe, "above", BURST_ATR_FLOOR[timeframe]),
            ...LIQUID_SESSIONS,
          ],
        },
        short_entry_conditions: {
          all: [
            emaCross(timeframe, fast, slow, "short"),
            atrThreshold(timeframe, "above", BURST_ATR_FLOOR[timeframe]),
            ...LIQUID_SESSIONS,
          ],
        },
      }),
    });
  }
  return out;
}

function buildStretchRevertFamily(): CatalogEntry[] {
  const periods = [20, 50];
  const out: CatalogEntry[] = [];
  for (const period of periods) {
    out.push({
      id: `scalp_stretch_revert_${period}_v1`,
      family: "scalp_stretch_revert",
      label: `Fade the stretch from SMA(${period}) (overlap)`,
      buildConditions: (timeframe) => ({
        // Price below the intraday mean AND momentum washed out → fade up.
        long_entry_conditions: {
          all: [
            priceVsSma(timeframe, period, "below"),
            rsiThreshold(timeframe, 5, "crosses_below", 25),
            marketSession(["london_new_york_overlap"]),
          ],
        },
        short_entry_conditions: {
          all: [
            priceVsSma(timeframe, period, "above"),
            rsiThreshold(timeframe, 5, "crosses_above", 75),
            marketSession(["london_new_york_overlap"]),
          ],
        },
      }),
    });
  }
  return out;
}

// --- Assembly --------------------------------------------------------------------

/** Scalp-native families — the product's priority set (1m/5m). */
export const SCALP_CATALOG: readonly CatalogEntry[] = [
  ...buildMicroBreakFamily(), // 6
  ...buildQuickMeanReversionFamily(), // 4
  ...buildMomentumBurstFamily(), // 3
  ...buildStretchRevertFamily(), // 2  → 15 scalp-native
];

export const GENERATED_CATALOG: readonly CatalogEntry[] = [
  ...SCALP_CATALOG, // 15
  ...buildEmaCrossFamily(), // 12
  ...buildEmaCrossRsiFamily(), // 6
  ...buildRsiMeanReversionFamily(), // 12
  ...buildRsiMrTrendFamily(), // 4
  ...buildBreakoutFamily(), // 18
  ...buildSessionRangeFamily(), // 4
  ...buildAtrRegimeFamily(), // 4  → 75 total (15 scalp-native + 60 general)
];

export const GENERATED_CATALOG_BY_ID: ReadonlyMap<string, CatalogEntry> = new Map(
  GENERATED_CATALOG.map((entry) => [entry.id, entry]),
);

const SCALP_FAMILIES = new Set(SCALP_CATALOG.map((entry) => entry.family));

/**
 * Families whose lookbacks are structurally too slow for scalp frames. On 1m a
 * 200-period EMA spans three hours and a 48-bar range spans forty minutes —
 * the signal cannot resolve inside a scalp's horizon, so running them there
 * only burns pipeline capacity.
 */
const SLOW_ONLY_FAMILIES = new Set(["rsi_mr_trend", "session_range"]);
const SLOW_ID_MARKERS = ["_50_200_", "brk_48_"];

/**
 * Which catalog entries are worth backtesting on this timeframe.
 *
 * Scalp frames (1m/5m) run the scalp-native families plus the general ones
 * whose parameters still resolve quickly; slower frames run everything EXCEPT
 * the scalp-native families, whose 3–8 bar lookbacks are noise at 1h+.
 */
export function catalogEntriesForTimeframe(
  timeframe: ResearchTimeframe,
): CatalogEntry[] {
  const style = styleForTimeframe(timeframe);
  if (style === "scalp") {
    return GENERATED_CATALOG.filter((entry) => {
      if (SCALP_FAMILIES.has(entry.family)) return true;
      if (SLOW_ONLY_FAMILIES.has(entry.family)) return false;
      return !SLOW_ID_MARKERS.some((marker) => entry.id.includes(marker));
    });
  }
  return GENERATED_CATALOG.filter((entry) => !SCALP_FAMILIES.has(entry.family));
}
