/**
 * Unified trading-mode framework.
 *
 * One resolver turns the operator's selected cadence, the live chart
 * timeframe, explicit intent (e.g. a scalp request), and in-session
 * corrections into ONE structured mode profile. The profile is evidence
 * configuration — numbers, enums, and expectations — never prewritten answer
 * text: the model still composes its own language from it.
 *
 * The mode may tighten discipline (higher RR floor, stricter freshness,
 * session requirements) but can never loosen a safety control: Risk Guard,
 * Execution Guard, Market Sync Guard, and the Data Quality Policy run
 * unconditionally regardless of the resolved mode.
 */
import type { TradingStyle } from "@/lib/types";
import { tradingStyleForInterval } from "@/lib/analysisProfile";
import type { AgentSessionMemory } from "./types";
import type { UserTradingProfile } from "./risk/userTradingProfile";
import { effectiveMinRr } from "./risk/userTradingProfile";

export type ModeSource =
  | "explicit_intent" // the request itself demanded this cadence (e.g. scalp)
  | "session_correction" // the operator corrected the style inside the session
  | "chart_interval" // inferred from the timeframe under analysis
  | "user_settings" // the persisted trading_style choice
  | "default";

export interface TradingModeProfile {
  /** Canonical cadence — the one enum every consumer shares. */
  style: TradingStyle;
  /** Where the decision came from (highest-precedence signal that applied). */
  source: ModeSource;
  /** Expected holding horizon for a valid setup in this mode. */
  holdingHorizon: "minutes" | "hours" | "days" | "weeks";
  /** Minimum reward:risk the agent enforces for this request. */
  minRr: number;
  /** Scalp-class strictness: current-TF candles must be fresh. */
  requiresFreshCurrentTf: boolean;
  /** Scalp-class strictness: an active liquid session is required. */
  requiresLiveSession: boolean;
  /** How much confirmation evidence a setup needs before buy/sell. */
  confirmationStrictness: "standard" | "elevated" | "strict";
  /** Stop placement expectation (structural guidance, not text). */
  stopApproach: "tight_structure" | "structure" | "swing_structure" | "major_structure";
  /** Target expectation for the mode. */
  targetApproach: "quick_partial" | "structure" | "wide_structure";
  /** Whether higher-timeframe/news context carries extra weight. */
  contextEmphasis: "momentum" | "balanced" | "macro";
  /** The operator's persisted cadence (for reference, may differ from style). */
  userSelectedStyle?: TradingStyle;
}

const HOLDING: Record<TradingStyle, TradingModeProfile["holdingHorizon"]> = {
  scalp: "minutes",
  day: "hours",
  swing: "days",
  position: "weeks",
};

const STOPS: Record<TradingStyle, TradingModeProfile["stopApproach"]> = {
  scalp: "tight_structure",
  day: "structure",
  swing: "swing_structure",
  position: "major_structure",
};

const TARGETS: Record<TradingStyle, TradingModeProfile["targetApproach"]> = {
  scalp: "quick_partial",
  day: "structure",
  swing: "wide_structure",
  position: "wide_structure",
};

const CONTEXT: Record<TradingStyle, TradingModeProfile["contextEmphasis"]> = {
  scalp: "momentum",
  day: "momentum",
  swing: "balanced",
  position: "macro",
};

/** Map the in-session preference names onto the canonical cadence enum. */
function styleFromSessionPreference(
  preference: AgentSessionMemory["preferences"]["tradingStyle"],
): TradingStyle | null {
  switch (preference) {
    case "scalping":
      return "scalp";
    case "intraday":
      return "day";
    case "swing":
      return "swing";
    default:
      return null;
  }
}

export interface ResolveTradingModeInput {
  /** Chart interval under analysis (e.g. "15m"). */
  interval?: string;
  /** The request explicitly asked for a scalp. */
  scalpIntent?: boolean;
  /** In-session style correction (takes precedence over old settings). */
  session?: AgentSessionMemory | null;
  /** Persisted user profile (settings.trading_style + risk limits). */
  profile?: UserTradingProfile | null;
}

/**
 * Resolve the operating mode for one request. Precedence (most specific
 * signal wins): explicit scalp intent → in-session correction → chart
 * interval → persisted user selection → day-trading default.
 */
export function resolveTradingMode(input: ResolveTradingModeInput): TradingModeProfile {
  const sessionStyle = styleFromSessionPreference(
    input.session?.preferences.tradingStyle,
  );
  const intervalStyle = input.interval
    ? tradingStyleForInterval(input.interval)
    : null;
  const userStyle = input.profile?.tradingStyle ?? null;

  let style: TradingStyle;
  let source: ModeSource;
  if (input.scalpIntent) {
    style = "scalp";
    source = "explicit_intent";
  } else if (sessionStyle) {
    style = sessionStyle;
    source = "session_correction";
  } else if (intervalStyle) {
    style = intervalStyle;
    source = "chart_interval";
  } else if (userStyle) {
    style = userStyle;
    source = "user_settings";
  } else {
    style = "day";
    source = "default";
  }

  const scalpClass = style === "scalp";
  return {
    style,
    source,
    holdingHorizon: HOLDING[style],
    minRr: effectiveMinRr(input.profile ?? null, style),
    requiresFreshCurrentTf: scalpClass,
    requiresLiveSession: scalpClass,
    confirmationStrictness: scalpClass ? "strict" : style === "position" ? "elevated" : "standard",
    stopApproach: STOPS[style],
    targetApproach: TARGETS[style],
    contextEmphasis: CONTEXT[style],
    userSelectedStyle: userStyle ?? undefined,
  };
}

/**
 * Public, model-facing projection of the mode. Structured facts only — the
 * model decides how (and whether) to talk about them.
 */
export function tradingModeModelContext(mode: TradingModeProfile): Record<string, unknown> {
  return {
    style: mode.style,
    source: mode.source,
    holdingHorizon: mode.holdingHorizon,
    minRr: mode.minRr,
    confirmationStrictness: mode.confirmationStrictness,
    stopApproach: mode.stopApproach,
    targetApproach: mode.targetApproach,
    contextEmphasis: mode.contextEmphasis,
  };
}
