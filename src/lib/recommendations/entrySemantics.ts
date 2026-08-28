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

/**
 * How the STOP terminates a live plan.
 *
 *  - `touch` — any trade at the stop level ends the plan (a hard order at a
 *              broker would have filled). The pre-existing behaviour.
 *  - `close` — only a candle CLOSE beyond the stop ends it. A wick through the
 *              level with a close back inside is a rejection, not a stop-out.
 *
 * This exists because of a real transcript: a conditional XAUUSD sell promised
 * "a 15m candle CLOSE above 4667.29 kills the idea entirely", price wicked to
 * ~4670 intrabar — no close above — got rejected exactly as the plan predicted
 * and fell toward TP1, and the tracker graded the wick as a stop-out. The
 * plan's own words and the grader disagreed about what the stop MEANS, which
 * is the same class of contradiction the entry-type contract fixed for fills.
 */
export const INVALIDATION_MODES = ["close", "touch"] as const;

export type InvalidationMode = (typeof INVALIDATION_MODES)[number];

export function isInvalidationMode(value: unknown): value is InvalidationMode {
  return (
    typeof value === "string" &&
    (INVALIDATION_MODES as readonly string[]).includes(value)
  );
}

/**
 * The canonical invalidation mode for a plan, derived from its STRUCTURE —
 * mirroring `resolveEntryType`: a stated mode wins; otherwise the plan's own
 * shape decides.
 *
 * Default is CLOSE for every conditional/pending plan (an activation rule, a
 * non-market fill, or a conditional/anticipatory plan type), because that is
 * what the synthesizer's invalidation sentence has always promised — "a full
 * candle close beyond the level kills the scenario" — and grading a promise
 * written on the close against an intrabar wick is the contradiction this
 * mode exists to end.
 * Only a plain immediate market fill keeps touch semantics: a live position's
 * protective stop is an order, and orders fill on a touch.
 */
export function resolveInvalidationMode(input: {
  declared?: string | null;
  entryType?: string | null;
  planType?: "immediate" | "anticipatory" | "conditional" | null;
  activationRule?: ActivationRule | null;
}): InvalidationMode {
  const declared = (input.declared ?? "").toLowerCase();
  if (isInvalidationMode(declared)) return declared;
  if (input.activationRule) return "close";
  if (input.planType === "conditional" || input.planType === "anticipatory") {
    return "close";
  }
  const entryType = normalizeStoredEntryType(input.entryType ?? null);
  return entryType === "market" ? "touch" : "close";
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

/** True when the plan still needs a confirming close, not just a touch. */
export function activationRequiresClose(
  rule: ActivationRule | { kind: string; rules?: Array<{ kind: string }> } | null | undefined,
): boolean {
  return closeBasedLeaves(rule as ActivationRule | null | undefined).length > 0;
}

/** The level a close-based rule is waiting to print beyond, if any. */
export function closeTriggerLevel(
  rule: ActivationRule | { kind: string; rules?: Array<{ kind: string }> } | null | undefined,
): number | null {
  for (const leaf of closeBasedLeaves(rule as ActivationRule | null | undefined)) {
    if ("level" in leaf && typeof leaf.level === "number" && leaf.level > 0) {
      return leaf.level;
    }
  }
  return null;
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
  // A wait that has been withdrawn (planType immediate, no remaining trigger)
  // is a market fill — even if the candidate was authored as a limit/stop.
  // Leaving `sell_limit` on an immediate follow-through re-armed G7 as a
  // 4-ATR wait and shipped the 4616.66 / live-4606 card as conditional.
  if (input.planType === "immediate" && !input.activationRule) return "market";

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
 * Gold (XAUUSD) touch band, in price units. The operator was explicit: 10–15
 * points. A live 5m sell at 4610 with price 10 points above counts as filled;
 * 20 points above is still a wait. These are USD on gold, not 0.10 "pips".
 */
export const GOLD_FILL_TOLERANCE_FLOOR = 10;
export const GOLD_FILL_TOLERANCE_CAP = 15;

/**
 * How close price must come to a touch-filled entry — or to a take-profit —
 * for the touch to count. Same helper for both: a 10–15 point gold band
 * (floor 10, cap 15) is the operator-mandated "near enough".
 *
 * Exists because of a real complaint: a XAUUSD plan whose entry sat at
 * 4646.19 watched price turn 30 cents above it and run to every target — and
 * the record graded the plan as never filled. Requiring the exact cent is
 * grading a fill the market never owed us. The same honesty applies to
 * targets: a sell TP at 4591.48 with live 4596.15 (~4.7 points away) is
 * inside this band and must count as reached.
 *
 * On gold (price ≥ 100) the operator-mandated band is 10–15 points: floor 10,
 * cap 15, ATR-scaled inside. The previous ~0.5–1.5 USD / 0.5×ATR / 5-point
 * overshoot was too wide a *requirement* for converting leftover waits (a
 * 4605.39 sell with live 4601.89 — 3.5 points through — still shipped as
 * "wait") and too *narrow* a touch band for approach-from-the-waiting-side.
 * Smaller instruments keep a proportional spread-scale band.
 */
export function entryFillTolerance(input: {
  price: number;
  atr?: number | null;
}): number {
  const price = input.price;
  if (!Number.isFinite(price) || price <= 0) return 0;
  const fromAtr =
    input.atr != null && Number.isFinite(input.atr) && input.atr > 0
      ? input.atr * 0.15
      : 0;
  if (price >= 100) {
    return Math.min(
      GOLD_FILL_TOLERANCE_CAP,
      Math.max(GOLD_FILL_TOLERANCE_FLOOR, fromAtr),
    );
  }
  const floor = price * 1.1e-4;
  const cap = price * 3.3e-4;
  return Math.min(cap, Math.max(floor, fromAtr));
}

/**
 * How close price must come to a take-profit for the target to count as hit.
 *
 * This is `entryFillTolerance` under a second name: the operator mandated the
 * same 10–15 point gold band for every TP (buy or sell) that already grades a
 * touch-filled entry. A wrapper — not a second formula — so the two cannot
 * drift. The stop does NOT use this band; invalidation stays exact
 * (close | touch) on the stop itself.
 */
export function targetHitTolerance(input: {
  price: number;
  atr?: number | null;
}): number {
  return entryFillTolerance(input);
}

export interface TargetHitResult {
  reached: boolean;
  /**
   * Nearest price this candle actually traded to the target. Only set when
   * `reached`. Never a level the market did not print — same clamp as a
   * tolerance-band entry fill.
   */
  hitPrice?: number;
}

/**
 * Did this candle reach a take-profit, and at what honest price?
 *
 * Side-aware, unlike the two-sided entry band: a target only counts from the
 * waiting side (or already through). Omitted/zero tolerance is exact touch.
 *
 *  - Sell (target below): `low <= target + tolerance` — approached from above
 *    within the band, or already through. Does not require `low <= target`.
 *  - Buy (target above): `high >= target - tolerance` — approached from below
 *    within the band, or already through.
 *
 * Hit price is the labeled target clamped into the candle's [low, high]: the
 * nearest actually-traded print. A sell TP at 4591.48 whose low is 4596.15
 * records 4596.15, never 4591.48. A candle that traded through records the
 * labeled line (the market did print it). The stop does NOT use this.
 */
export function resolveTargetHit(input: {
  direction: "buy" | "sell";
  target: number;
  candle: { high: number; low: number };
  tolerance?: number;
}): TargetHitResult {
  const target = input.target;
  if (!Number.isFinite(target)) return { reached: false };
  const tol =
    input.tolerance != null && Number.isFinite(input.tolerance) && input.tolerance > 0
      ? input.tolerance
      : 0;
  const reached =
    input.direction === "buy"
      ? input.candle.high >= target - tol
      : input.candle.low <= target + tol;
  if (!reached) return { reached: false };
  const hitPrice = Math.min(input.candle.high, Math.max(input.candle.low, target));
  return { reached: true, hitPrice };
}

/** True when `resolveTargetHit` would count this candle as a hit. */
export function targetZoneReached(input: {
  direction: "buy" | "sell";
  candle: { high: number; low: number };
  target: number;
  tolerance?: number;
}): boolean {
  return resolveTargetHit(input).reached;
}

/**
 * Nearest actually-traded price to the labeled target, clamped into the
 * candle. Callers that already know the zone was reached use this; otherwise
 * prefer `resolveTargetHit` which refuses a price on a miss.
 */
export function honestTargetHitPrice(input: {
  direction: "buy" | "sell";
  candle: { high: number; low: number };
  target: number;
}): number {
  return Math.min(input.candle.high, Math.max(input.candle.low, input.target));
}

/**
 * The safety margin a STOP must sit beyond the structural level it protects.
 *
 * Same proportional family as `entryFillTolerance`, deliberately wider: the
 * entry band answers "how close counts as a touch" (spread-scale), while this
 * answers "how far can an ordinary rejection wick overshoot the obvious swing
 * before falling" — a stop placed exactly ON that swing is a stop-hunt
 * donation. From the transcript this exists for: stop at 4667.29 on the swing,
 * rejection wick to 4670 (≈3 points through), then the fall the plan
 * predicted. The band:
 *  - floor  ~0.022% of price (≈ 1.0 USD on gold at 4600)
 *  - cap    ~0.11%  of price (≈ 5.0 USD on gold at 4600)
 *  - inside the band, volatility decides: 40% of ATR — a rejection wick is a
 *    fraction of one candle's range, so the margin scales with that range.
 */
export function stopSafetyBuffer(input: {
  price: number;
  atr?: number | null;
}): number {
  const price = input.price;
  if (!Number.isFinite(price) || price <= 0) return 0;
  const floor = price * 2.2e-4;
  const cap = price * 1.1e-3;
  const fromAtr =
    input.atr != null && Number.isFinite(input.atr) && input.atr > 0
      ? input.atr * 0.4
      : 0;
  return Math.min(cap, Math.max(floor, fromAtr));
}

/**
 * Push a stop the safety margin beyond its structural level, in the direction
 * that protects the trade. Idempotent on already-buffered stops: the input
 * stop is treated as the structural invalidation only when it sits closer to
 * the entry than the buffered level — a stop the producer already placed
 * beyond the margin is kept as stated.
 */
export function applyStopSafetyBuffer(input: {
  direction: "buy" | "sell";
  stopLoss: number;
  /** The structural level the stop protects; defaults to the stop itself. */
  structuralLevel?: number | null;
  atr?: number | null;
  /** Instrument scale for the proportional floor/cap; defaults to the stop. */
  price?: number | null;
}): { stopLoss: number; buffer: number; buffered: boolean } {
  const structural =
    input.structuralLevel != null && Number.isFinite(input.structuralLevel)
      ? input.structuralLevel
      : input.stopLoss;
  if (!Number.isFinite(structural)) {
    return { stopLoss: input.stopLoss, buffer: 0, buffered: false };
  }
  const buffer = stopSafetyBuffer({
    price:
      input.price != null && Number.isFinite(input.price) && input.price > 0
        ? input.price
        : Math.abs(structural),
    atr: input.atr,
  });
  if (!(buffer > 0)) return { stopLoss: input.stopLoss, buffer: 0, buffered: false };
  const safe =
    input.direction === "sell" ? structural + buffer : structural - buffer;
  const alreadySafe =
    input.direction === "sell" ? input.stopLoss >= safe : input.stopLoss <= safe;
  if (alreadySafe) return { stopLoss: input.stopLoss, buffer, buffered: false };
  return { stopLoss: safe, buffer, buffered: true };
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
      // Range overlap with [entry − tol, entry + tol]: a touch from EITHER
      // side counts. The old one-sided test (sell: high ≥ entry − tol) treated
      // a candle sitting 20 points ABOVE a sell as a fill once tol grew to
      // 10–15, and missed a breakdown that had already gone through below.
      const bandLow = plan.entry - tol;
      const bandHigh = plan.entry + tol;
      const touched = candle.low <= bandHigh && candle.high >= bandLow;
      if (!touched) return { filled: false };
      // Grading honesty: when only the tolerance band was reached, the fill is
      // the nearest traded price (clamped into the candle's range), not the
      // level itself — that gap is the recorded slip.
      const effectiveEntry = Math.min(candle.high, Math.max(candle.low, plan.entry));
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

/**
 * Minimum distance between consecutive take-profits, so TP2/TP3 are distinct
 * levels rather than a 0.09-point duplicate of their neighbour.
 *
 * Independent of the 10–15 point gold FILL / TARGET-HIT band — that band is
 * touch activation and TP-zone grading (`entryFillTolerance` /
 * `targetHitTolerance`), not how far apart consecutive TPs must sit. Gold
 * keeps a several-point floor plus 0.15×ATR. The 2026-08 production card
 * printed TP2 4593.80 / TP3 4593.71 — visually and practically the same line.
 */
export function minConsecutiveTargetSpacing(input: {
  price: number;
  atr?: number | null;
}): number {
  const price = input.price;
  if (!Number.isFinite(price) || price <= 0) return 0;
  const atrFrac =
    input.atr != null && Number.isFinite(input.atr) && input.atr > 0
      ? input.atr * 0.15
      : 0;
  // Several points on XAUUSD (~4600); smaller instruments keep a spread-scale floor.
  const pointsFloor = price >= 100 ? 5 : price * 1.1e-4;
  return Math.max(pointsFloor, atrFrac);
}

/**
 * Drop a target that would collapse onto its neighbour. Order is nearest-first
 * in the trade direction: if TP2 sits inside the floor of TP1 it is omitted
 * (TP3 may then become TP2 if it clears the floor from TP1); if TP3 sits
 * inside the floor of TP2 it is omitted. Never invents a replacement level.
 */
export function filterDistinctTargets(input: {
  direction: "buy" | "sell";
  entry: number;
  targets: number[];
  atr?: number | null;
}): number[] {
  const spacing = minConsecutiveTargetSpacing({
    price: input.entry,
    atr: input.atr,
  });
  const side = input.direction === "buy" ? 1 : -1;
  const ordered = [...input.targets]
    .filter((t) => Number.isFinite(t) && t > 0)
    .filter((t) => (side > 0 ? t > input.entry : t < input.entry))
    .sort((a, b) => (side > 0 ? a - b : b - a));
  const out: number[] = [];
  for (const t of ordered) {
    const prev = out[out.length - 1];
    if (prev != null && Math.abs(t - prev) + 1e-9 < spacing) continue;
    out.push(t);
    if (out.length >= 3) break;
  }
  return out;
}
