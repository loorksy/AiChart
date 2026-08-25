/**
 * Entry types and their FILL semantics.
 *
 * This module exists because of a real incident. A SELL plan was stored with a
 * fixed entry of 4348.27 and an activation rule of "wick pierces 4348.27, then
 * the M15 candle CLOSES BELOW it". The condition was satisfied, price then ran
 * all the way to both targets — and the recommendation still died as EXPIRED,
 * graded a miss.
 *
 * The cause was not a tracking bug. It was an incoherent plan that nothing
 * refused to store: the moment the confirming candle closes below 4348.27,
 * price is below 4348.27, and a sell fills on `candle.high >= entry`. Every
 * later candle is below the level, so the high never reaches it again. The
 * nominal entry became unreachable at the exact instant its own condition came
 * true. The words promised one thing and the stored numbers graded another.
 *
 * The fix is to make the fill rule part of the plan rather than an assumption:
 *
 *  - `market`             — filled at the creation quote.
 *  - `limit_touch`        — filled when price touches `entry`. May NOT be
 *                           combined with a close-based activation rule; that
 *                           combination is the incident.
 *  - `confirmation_close` — armed by a close/rejection rule and filled AT THE
 *                           CONFIRMING CANDLE'S CLOSE. The nominal level is
 *                           kept as `triggerLevel`; the price the plan is
 *                           actually graded on is the close, recorded as
 *                           `effectiveEntry`.
 *  - `retest_zone`        — armed by the rule, then filled on a touch anywhere
 *                           inside an explicit [zoneFrom, zoneTo] band.
 *
 * Everything downstream — R multiples, RR, the tracker's grading — must use
 * `effectiveEntry`, never the nominal level, or the same class of bug returns
 * wearing different numbers.
 */
import type { ActivationRule, LeafActivationRule } from "./activationRule";

export const ENTRY_TYPES = [
  "market",
  "limit_touch",
  "confirmation_close",
  "retest_zone",
] as const;

export type EntryType = (typeof ENTRY_TYPES)[number];

export function isEntryType(value: string): value is EntryType {
  return (ENTRY_TYPES as readonly string[]).includes(value);
}

export interface RetestZone {
  /** Band bounds in price units; order-insensitive, normalised on read. */
  from: number;
  to: number;
}

export interface EntryPlan {
  direction: "buy" | "sell";
  entryType: EntryType;
  /**
   * The plan's nominal price. For `confirmation_close` this is the TRIGGER
   * level, not the fill — the fill is the confirming candle's close.
   */
  entry: number;
  stopLoss: number;
  targets: number[];
  activationRule?: ActivationRule | null;
  retestZone?: RetestZone | null;
  /** Minimum reward:risk the plan must still clear once the fill is known. */
  minRr?: number;
}

/** Leaves of a rule, flattened — a composite is just its parts for this purpose. */
function leavesOf(rule: ActivationRule | null | undefined): LeafActivationRule[] {
  if (!rule) return [];
  return rule.kind === "composite" ? rule.rules : [rule];
}

/** Rules whose satisfaction is decided by a candle CLOSE rather than a touch. */
function closeBasedLeaves(rule: ActivationRule | null | undefined): LeafActivationRule[] {
  return leavesOf(rule).filter(
    (leaf) =>
      leaf.kind === "candle_close_above" ||
      leaf.kind === "candle_close_below" ||
      leaf.kind === "breakout_confirmed" ||
      leaf.kind === "rejection_confirmed",
  );
}

/** The price level a close-based leaf is measured against. */
function leafLevel(leaf: LeafActivationRule): number | null {
  return "level" in leaf && typeof leaf.level === "number" ? leaf.level : null;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? String(Number(n.toFixed(5))) : "—";
}

/**
 * The canonical entry type for a plan, derived from its STRUCTURE.
 *
 * Structure outranks declaration on purpose. The incident's plan declared a
 * pending limit entry while carrying a close-based activation rule; believing
 * the declaration is exactly how the contradiction got stored. So a close-based
 * rule decides the fill semantics no matter what the model called the entry,
 * and the declared type is consulted only where the structure says nothing.
 */
export function resolveEntryType(input: {
  /** Whatever the model called it — `market`, `buy_limit`, `sell_stop`, … */
  declared?: string | null;
  planType?: "immediate" | "anticipatory" | "conditional" | null;
  activationRule?: ActivationRule | null;
  retestZone?: RetestZone | null;
}): EntryType {
  if (closeBasedLeaves(input.activationRule).length > 0) {
    return input.retestZone ? "retest_zone" : "confirmation_close";
  }
  if (input.retestZone) return "retest_zone";

  const declared = (input.declared ?? "").toLowerCase();
  if (isEntryType(declared)) {
    // A "market" fill and a rule that must first come true are incompatible:
    // the plan waits, so it fills on a touch, not at the creation quote.
    return declared === "market" && input.activationRule ? "limit_touch" : declared;
  }
  // `buy_limit`, `sell_limit`, `buy_stop`, `sell_stop` — all touch-filled.
  if (declared.includes("limit") || declared.includes("stop")) return "limit_touch";
  if (declared === "market" || declared === "") {
    return input.activationRule || input.planType === "conditional" || input.planType === "anticipatory"
      ? "limit_touch"
      : "market";
  }
  return "limit_touch";
}

/**
 * Coerce a persisted entry-type string to canonical semantics.
 *
 * Rows written before this module existed carry `limit` / `pending`, both of
 * which meant "fills on a touch". They map to `limit_touch` rather than being
 * kept as separate spellings, so every reader downstream has one vocabulary.
 */
export function normalizeStoredEntryType(raw?: string | null): EntryType {
  const value = (raw ?? "").toLowerCase();
  if (isEntryType(value)) return value;
  if (value === "" ) return "market";
  if (
    value === "limit" ||
    value === "pending" ||
    value.includes("limit") ||
    value.includes("stop")
  ) {
    return "limit_touch";
  }
  return "market";
}

export interface CoherenceProblem {
  code:
    | "close_rule_with_touch_entry"
    | "stop_on_wrong_side"
    | "target_on_wrong_side"
    | "retest_zone_missing"
    | "retest_zone_on_wrong_side"
    | "rr_below_minimum";
  /** Operator-facing English detail; the caller localises if it surfaces one. */
  detail: string;
}

/**
 * The coherence validator.
 *
 * Runs at construction AND again at the final live-price revalidation, because
 * a plan that was coherent when written can stop being coherent once the fill
 * price is known. Returns every problem found rather than the first, so a
 * corrective retry can fix the plan in one pass instead of discovering the
 * next fault only after repairing this one.
 */
export function validateEntryCoherence(plan: EntryPlan): CoherenceProblem[] {
  const problems: CoherenceProblem[] = [];
  const { direction, entryType, entry, stopLoss, targets } = plan;
  const closeLeaves = closeBasedLeaves(plan.activationRule);

  // THE INCIDENT. A close-based rule cannot arm a touch-filled entry sitting at
  // the rule's own level: satisfying the rule puts price on the far side of
  // that level, so the touch it waits for can never happen again.
  if (closeLeaves.length > 0 && (entryType === "limit_touch" || entryType === "market")) {
    const atLevel = closeLeaves.some((leaf) => {
      const level = leafLevel(leaf);
      if (level == null) return false;
      const tol = ("tolerance" in leaf ? leaf.tolerance : 0) ?? 0;
      return Math.abs(level - entry) <= tol;
    });
    if (atLevel || entryType === "limit_touch") {
      problems.push({
        code: "close_rule_with_touch_entry",
        detail:
          `entryType "${entryType}" fills on a touch of ${fmt(entry)}, but the activation rule is decided by a candle CLOSE ` +
          `at ${closeLeaves.map((l) => fmt(leafLevel(l) ?? NaN)).join(", ")}. Once that close happens price is on the far side of the level and the touch can never occur. ` +
          `Use entryType "confirmation_close" (fill at the confirming candle's close) or "retest_zone" (fill on a return into an explicit band).`,
      });
    }
  }

  // A retest fill needs the band it retests into.
  if (entryType === "retest_zone") {
    const zone = plan.retestZone;
    if (!zone || !Number.isFinite(zone.from) || !Number.isFinite(zone.to)) {
      problems.push({
        code: "retest_zone_missing",
        detail: `entryType "retest_zone" requires an explicit [from, to] band to fill inside.`,
      });
    } else {
      const low = Math.min(zone.from, zone.to);
      const high = Math.max(zone.from, zone.to);
      // The band must sit on the trade's side of the stop, or the plan is
      // stopped out the moment it fills.
      const zoneBeyondStop =
        direction === "buy" ? low <= stopLoss : high >= stopLoss;
      if (zoneBeyondStop) {
        problems.push({
          code: "retest_zone_on_wrong_side",
          detail: `retest band [${fmt(low)}, ${fmt(high)}] reaches past the stop ${fmt(stopLoss)} — a fill there is already a loss.`,
        });
      }
    }
  }

  // Geometry that holds regardless of entry type: the stop is behind the
  // entry and the targets are in front of it.
  // At construction the only price in hand is the nominal one; for
  // `confirmation_close` the true fill is not known until the confirming candle
  // closes, which is why revalidation re-runs this against `effectiveEntry`.
  const fill = entry;
  if (direction === "buy" ? stopLoss >= fill : stopLoss <= fill) {
    problems.push({
      code: "stop_on_wrong_side",
      detail: `stop ${fmt(stopLoss)} is on the wrong side of a ${direction} entry at ${fmt(fill)}.`,
    });
  }
  for (const tp of targets) {
    if (direction === "buy" ? tp <= fill : tp >= fill) {
      problems.push({
        code: "target_on_wrong_side",
        detail: `target ${fmt(tp)} is on the wrong side of a ${direction} entry at ${fmt(fill)}.`,
      });
      break;
    }
  }

  // Reward:risk, measured from the price the plan will actually be graded on.
  const minRr = plan.minRr;
  if (minRr != null && targets.length > 0) {
    const rr = rewardToRisk({ direction, entry: fill, stopLoss, target: targets[0]! });
    if (rr != null && rr < minRr) {
      problems.push({
        code: "rr_below_minimum",
        detail: `reward:risk from the effective entry ${fmt(fill)} is ${rr.toFixed(2)}, below the plan minimum ${minRr}.`,
      });
    }
  }

  return problems;
}

/** Reward:risk for one target, or null when risk is zero/undefined. */
export function rewardToRisk(input: {
  direction: "buy" | "sell";
  entry: number;
  stopLoss: number;
  target: number;
}): number | null {
  const risk = Math.abs(input.entry - input.stopLoss);
  if (!Number.isFinite(risk) || risk <= 0) return null;
  const reward =
    input.direction === "buy" ? input.target - input.entry : input.entry - input.target;
  if (!Number.isFinite(reward)) return null;
  return reward / risk;
}

export interface FillCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface FillResult {
  filled: boolean;
  /** The price the plan is graded on. Only meaningful when `filled`. */
  effectiveEntry?: number;
}

/**
 * How close price must come to a touch-filled entry for the touch to count.
 *
 * Exists because of a real complaint: a XAUUSD plan whose entry sat at
 * 4646.19 watched price turn 30 cents above it and run to every target — and
 * the record graded the plan as never filled. Requiring the exact cent is
 * grading a fill the market never owed us; a real limit order at that level
 * with normal spread WOULD have filled.
 *
 * The band is proportional to price so one rule serves every instrument:
 *  - floor  ~0.011% of price (≈ 0.50 USD on gold at 4600 — "5 points")
 *  - cap    ~0.033% of price (≈ 1.50 USD on gold at 4600 — "15 points")
 *  - inside the band, volatility decides: 15% of ATR, matching the tolerance
 *    the plan builder already applies to activation rules at creation.
 */
export function entryFillTolerance(input: {
  price: number;
  atr?: number | null;
}): number {
  const price = input.price;
  if (!Number.isFinite(price) || price <= 0) return 0;
  const floor = price * 1.1e-4;
  const cap = price * 3.3e-4;
  const fromAtr =
    input.atr != null && Number.isFinite(input.atr) && input.atr > 0
      ? input.atr * 0.15
      : 0;
  return Math.min(cap, Math.max(floor, fromAtr));
}

/**
 * Does this candle fill the entry, and at what price?
 *
 * `conditionMet` is the activation rule's verdict for THIS candle — the caller
 * owns rule evaluation; this function owns only what a fill means once the
 * rule has spoken.
 */
export function resolveFill(input: {
  plan: Pick<EntryPlan, "direction" | "entryType" | "entry" | "retestZone">;
  candle: FillCandle;
  /** True when the activation rule is satisfied as of this candle. */
  conditionMet: boolean;
  /** True when the rule became satisfied on an EARLIER candle. */
  armedBefore: boolean;
  /**
   * Price-unit band for touch fills: a candle that comes within this margin of
   * a `limit_touch` entry counts as filled, AT THE NEAREST PRICE ACTUALLY
   * TRADED — never at the nominal level the market did not reach. Omitted or
   * zero preserves the exact-touch behaviour.
   */
  tolerance?: number;
}): FillResult {
  const { plan, candle, conditionMet, armedBefore } = input;
  if (!conditionMet && !armedBefore) return { filled: false };

  switch (plan.entryType) {
    case "market":
      return { filled: true, effectiveEntry: plan.entry };

    case "confirmation_close":
      // The confirming candle IS the fill. Waiting for a touch of the nominal
      // level after this close is the incident this module exists to prevent.
      if (armedBefore) return { filled: false };
      return { filled: true, effectiveEntry: candle.close };

    case "retest_zone": {
      const zone = plan.retestZone;
      if (!zone) return { filled: false };
      const low = Math.min(zone.from, zone.to);
      const high = Math.max(zone.from, zone.to);
      // A touch anywhere inside the band fills, at the band edge price first
      // reached — never at a better price than the market actually offered.
      const touches = candle.low <= high && candle.high >= low;
      if (!touches) return { filled: false };
      const edge = plan.direction === "buy" ? high : low;
      return { filled: true, effectiveEntry: edge };
    }

    case "limit_touch":
    default: {
      const tol =
        input.tolerance != null && Number.isFinite(input.tolerance) && input.tolerance > 0
          ? input.tolerance
          : 0;
      const touched =
        plan.direction === "buy"
          ? candle.low <= plan.entry + tol
          : candle.high >= plan.entry - tol;
      if (!touched) return { filled: false };
      // Grading honesty: when only the tolerance band was reached, the fill is
      // the nearest traded price (the candle's extreme), not the level itself.
      const effectiveEntry =
        plan.direction === "buy"
          ? Math.max(plan.entry, candle.low)
          : Math.min(plan.entry, candle.high);
      return { filled: true, effectiveEntry };
    }
  }
}

/**
 * The Arabic condition sentence, GENERATED from the structured plan.
 *
 * Prose is derived from the rule and entry type, never written independently
 * of them — the incident's report promised "the entry is 4348.27" while the
 * stored semantics graded something else, and prose that can drift from
 * structure will always eventually drift.
 */
export function describeEntry(plan: Pick<EntryPlan, "direction" | "entryType" | "entry" | "retestZone">): string {
  const side = plan.direction === "buy" ? "شراء" : "بيع";
  switch (plan.entryType) {
    case "market":
      return `${side} فوري عند السعر الحالي (${fmt(plan.entry)}).`;
    case "confirmation_close":
      return `${side} مشروط: التفعيل عند إغلاق الشمعة بعد تحقق الشرط عند ${fmt(plan.entry)} — الدخول الفعلي هو سعر إغلاق شمعة التأكيد، وليس ${fmt(plan.entry)} نفسه.`;
    case "retest_zone": {
      const z = plan.retestZone;
      if (!z) return `${side} مشروط: العودة إلى منطقة إعادة الاختبار.`;
      const low = Math.min(z.from, z.to);
      const high = Math.max(z.from, z.to);
      return `${side} مشروط: بعد تحقق الشرط، الدخول عند عودة السعر إلى المنطقة ${fmt(low)}–${fmt(high)}.`;
    }
    case "limit_touch":
    default:
      return `${side} معلّق: الدخول عند لمس السعر ${fmt(plan.entry)}.`;
  }
}
