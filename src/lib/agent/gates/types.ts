/**
 * The mandatory pre-recommendation gate chain.
 *
 * Before this existed, the specialists (news, liquidity, supply/demand,
 * structure, MTF, risk) were ADVISORY: the synthesizer received whatever they
 * produced and weighed it. That is the right shape for evidence — and the
 * wrong shape for the handful of conditions under which a recommendation must
 * not exist at all.
 *
 * A gate is not a stronger opinion. A gate is a question with a factual answer
 * that either permits the plan to be constructed or refuses it by name:
 *
 *   G1 NEWS        — is a high-impact event about to move gold?
 *   G2 LIQUIDITY   — where are the stop clusters and session pools?
 *   G3 SUPPLY      — which zones are fresh and which are already mitigated?
 *   G4 STRUCTURE   — what does HTF bias plus LTF structure actually say?
 *   G5 STRATEGY    — does a calibrated, adequately-sampled strategy match?
 *   G6 RISK        — does the geometry survive stops, costs and R math?
 *   G7 REVALIDATE  — is the plan still true against a quote fetched just now?
 *
 * Two rules make this worth the machinery:
 *
 *  1. **A recommendation is only constructed if every gate ran and none
 *     vetoed.** A gate that could not run is not a pass — it is an
 *     `unavailable` verdict, and the chain decides explicitly whether that is
 *     survivable, rather than a missing veto silently reading as consent.
 *  2. **WAIT is a first-class answer.** A vetoed chain does not degrade into a
 *     weaker recommendation; it produces no recommendation and says which gate
 *     refused and why.
 *
 * This does NOT reintroduce a committee over the analytical opinion. Gates
 * answer factual questions about tradability; direction and reasoning remain
 * the model's. A gate never flips a bias — it only decides whether a plan may
 * be issued at all.
 */

export const GATE_IDS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"] as const;
export type GateId = (typeof GATE_IDS)[number];

export const GATE_NAMES: Record<GateId, string> = {
  G1: "news_and_events",
  G2: "liquidity_map",
  G3: "supply_demand",
  G4: "structure_and_bias",
  G5: "strategy_and_backtest",
  G6: "risk_geometry",
  G7: "live_revalidation",
};

export type GateStatus =
  /** The gate ran and permits the plan. */
  | "pass"
  /** The gate ran and refuses the plan. No recommendation may be constructed. */
  | "veto"
  /**
   * The gate could not run (provider down, data absent). NOT a pass: the chain
   * applies `requiredForRecommendation` to decide whether this is survivable.
   */
  | "unavailable";

export interface GateVerdict {
  id: GateId;
  name: string;
  status: GateStatus;
  /** Operator-facing Arabic reason. Always present for veto and unavailable. */
  reasonAr?: string;
  /**
   * Machine-readable evidence this gate produced, persisted with the plan so a
   * post-mortem can reconstruct what was known at decision time.
   */
  evidence?: Record<string, unknown>;
  /** Confidence adjustment in percentage points; negative reduces. */
  confidenceDelta?: number;
  startedAt: number;
  finishedAt: number;
}

export interface GateChainResult {
  verdicts: GateVerdict[];
  /** True only when every gate ran and none vetoed. */
  allowed: boolean;
  /** The first gate that refused, if any — the reason a plan does not exist. */
  vetoedBy?: GateVerdict;
  /** Sum of every gate's confidenceDelta, applied to calibrated confidence. */
  confidenceDelta: number;
}

/**
 * Whether a gate's `unavailable` verdict blocks a recommendation.
 *
 * The distinction is about what absence MEANS. Not knowing whether a
 * high-impact event is minutes away is not the same as not having a liquidity
 * map: the first is a live hazard the plan would walk into blind, the second
 * costs the analysis some context. Absence is treated as a hazard only where
 * absence itself is dangerous.
 */
export const GATE_REQUIRED_TO_RUN: Record<GateId, boolean> = {
  // Not knowing whether gold is minutes from an NFP print is itself the risk.
  G1: true,
  G2: false,
  G3: false,
  // Without structure there is no plan to have — this is the analysis itself.
  G4: true,
  // An uncalibrated strategy must not be cited as calibrated; the plan waits.
  G5: true,
  // Geometry is arithmetic on data already in hand; it cannot be "unavailable"
  // for provider reasons, so if it is, something is genuinely wrong.
  G6: true,
  // The whole point of G7 is that the plan is checked against a fresh quote.
  // Skipping it would ship a plan validated only against stale prices.
  G7: true,
};
