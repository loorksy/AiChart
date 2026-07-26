/**
 * The three-layer result contract (docs/UNIFIED_AGENT_PLAN.md §2).
 *
 * A result is three independent facts, and mixing them is what produced the old
 * "no opinion" answers:
 *   1. direction      — buy or sell, on every successful analysis;
 *   2. plan type      — immediate, anticipatory, or conditional;
 *   3. execution state — whether the plan can be acted on right now.
 *
 * Direction is mandatory. An entry at the current price is not: when price is a
 * poor entry, the direction survives and the plan says what would make it
 * executable. This module owns the vocabulary plus the two mechanical parts —
 * grounding every number in real evidence, and deriving the execution state.
 */
import type { TradeCandidate } from "./buildTradeCandidates";
import { levelOrderValid, roundToTick, type SymbolGeometryMeta } from "./scalpGeometry";

export type PlanType = "immediate" | "anticipatory" | "conditional";

export type ExecutionState =
  | "valid_now"
  | "awaiting_activation"
  | "expired"
  | "invalidated"
  | "blocked";

/** A real price level the model is allowed to build a plan from. */
export interface EvidenceLevel {
  price: number;
  /** Where it came from — shown to the model so it cites, never invents. */
  source: string;
}

export interface PlanLevels {
  entryLow: number;
  entryHigh: number;
  preferredEntry: number;
  stopLoss: number;
  targets: number[];
}

export type LevelSource = "candidate" | "evidence_levels";

export interface ResolvedPlanLevels {
  levels: PlanLevels | null;
  source: LevelSource | null;
  /** Populated when proposed numbers were refused — never silently corrected. */
  rejectionReason?: string;
}

/**
 * Collect every price the model may legitimately quote: candidate geometry,
 * structural levels, zone edges, and liquidity pools. Anything outside this set
 * is an invented number and is refused rather than repaired.
 */
export function buildEvidenceLevels(input: {
  candidates?: TradeCandidate[];
  majorLevels?: { support?: { price: number }[]; resistance?: { price: number }[] } | null;
  zones?: { type: string; low: number; high: number }[];
  liquidity?: {
    equalHighs?: { price: number }[];
    equalLows?: { price: number }[];
  } | null;
  geometryLevels?: number[];
  limit?: number;
}): EvidenceLevel[] {
  const out: EvidenceLevel[] = [];
  const push = (price: unknown, source: string) => {
    const value = Number(price);
    if (Number.isFinite(value) && value > 0) out.push({ price: value, source });
  };

  for (const candidate of input.candidates ?? []) {
    push(candidate.entry, `candidate:${candidate.id}:entry`);
    push(candidate.stop_loss, `candidate:${candidate.id}:stop`);
    candidate.targets.forEach((t, i) => push(t, `candidate:${candidate.id}:tp${i + 1}`));
    push(candidate.poi.low, `candidate:${candidate.id}:zone_low`);
    push(candidate.poi.high, `candidate:${candidate.id}:zone_high`);
  }
  for (const level of input.majorLevels?.support ?? []) push(level.price, "structure:support");
  for (const level of input.majorLevels?.resistance ?? []) {
    push(level.price, "structure:resistance");
  }
  for (const zone of input.zones ?? []) {
    push(zone.low, `zone:${zone.type}:low`);
    push(zone.high, `zone:${zone.type}:high`);
  }
  for (const pool of input.liquidity?.equalHighs ?? []) push(pool.price, "liquidity:equal_highs");
  for (const pool of input.liquidity?.equalLows ?? []) push(pool.price, "liquidity:equal_lows");
  for (const level of input.geometryLevels ?? []) push(level, "geometry:boundary");

  // Deduplicate by price, keeping the first (most specific) source.
  const seen = new Map<number, EvidenceLevel>();
  for (const level of out) {
    if (!seen.has(level.price)) seen.set(level.price, level);
  }
  return [...seen.values()]
    .sort((a, b) => a.price - b.price)
    .slice(0, input.limit ?? 60);
}

/** Does this price correspond to a real evidence level (within tolerance)? */
export function matchesEvidenceLevel(
  price: number,
  levels: EvidenceLevel[],
  tolerance: number,
): EvidenceLevel | null {
  let best: { level: EvidenceLevel; distance: number } | null = null;
  for (const level of levels) {
    const distance = Math.abs(level.price - price);
    if (distance <= tolerance && (best == null || distance < best.distance)) {
      best = { level, distance };
    }
  }
  return best?.level ?? null;
}

/**
 * How far a quoted price may sit from a real level and still count as that
 * level. Generous enough for tick rounding and zone interiors, tight enough
 * that a number pulled from nowhere cannot pass.
 */
export function levelTolerance(input: {
  atr?: number | null;
  currentPrice: number;
  meta?: SymbolGeometryMeta | null;
}): number {
  const atr = Number(input.atr);
  if (Number.isFinite(atr) && atr > 0) return atr * 0.35;
  return Math.abs(input.currentPrice) * 0.0015;
}

/**
 * Bind a plan to real numbers.
 *
 * A selected candidate wins — its geometry is already validated end to end.
 * Otherwise the model may compose levels from the evidence menu, and every one
 * of them is checked: unmatched or badly ordered levels are dropped whole (the
 * direction and the narrative survive), never patched into something the model
 * did not say.
 */
export function resolvePlanLevels(input: {
  direction: "buy" | "sell";
  selectedCandidate: TradeCandidate | null;
  proposed?: Partial<PlanLevels> | null;
  evidenceLevels: EvidenceLevel[];
  tolerance: number;
  meta?: SymbolGeometryMeta | null;
}): ResolvedPlanLevels {
  if (input.selectedCandidate) {
    const c = input.selectedCandidate;
    return {
      levels: {
        entryLow: Math.min(c.poi.low, c.entry),
        entryHigh: Math.max(c.poi.high, c.entry),
        preferredEntry: c.entry,
        stopLoss: c.stop_loss,
        targets: c.targets,
      },
      source: "candidate",
    };
  }

  const proposed = input.proposed;
  if (!proposed) return { levels: null, source: null };

  const preferredEntry = Number(proposed.preferredEntry);
  const stopLoss = Number(proposed.stopLoss);
  const targets = (proposed.targets ?? [])
    .map((t) => Number(t))
    .filter((t) => Number.isFinite(t) && t > 0);
  if (!Number.isFinite(preferredEntry) || !Number.isFinite(stopLoss) || !targets.length) {
    return {
      levels: null,
      source: null,
      rejectionReason: "proposed_levels_incomplete",
    };
  }

  const entryLow = Number.isFinite(Number(proposed.entryLow))
    ? Number(proposed.entryLow)
    : preferredEntry;
  const entryHigh = Number.isFinite(Number(proposed.entryHigh))
    ? Number(proposed.entryHigh)
    : preferredEntry;

  const mustMatch = [preferredEntry, stopLoss, ...targets, entryLow, entryHigh];
  for (const price of mustMatch) {
    if (!matchesEvidenceLevel(price, input.evidenceLevels, input.tolerance)) {
      return {
        levels: null,
        source: null,
        rejectionReason: "proposed_level_not_grounded_in_evidence",
      };
    }
  }

  if (
    !levelOrderValid({
      action: input.direction,
      entry: preferredEntry,
      stop: stopLoss,
      targets,
    })
  ) {
    return {
      levels: null,
      source: null,
      rejectionReason: "proposed_level_order_invalid",
    };
  }

  const round = (price: number) => roundToTick(price, input.meta);
  return {
    levels: {
      entryLow: round(Math.min(entryLow, entryHigh)),
      entryHigh: round(Math.max(entryLow, entryHigh)),
      preferredEntry: round(preferredEntry),
      stopLoss: round(stopLoss),
      targets: targets.map(round),
    },
    source: "evidence_levels",
  };
}

/**
 * Derive the execution state at creation time.
 *
 * Only "is this actionable right now" is decided here; expiry and invalidation
 * belong to the lifecycle tracker, which watches the market after the fact.
 */
export function deriveExecutionState(input: {
  planType: PlanType;
  levels: PlanLevels | null;
  currentPrice: number | null;
  /** A named operational fault — the only non-analytical outcome. */
  blocked?: boolean;
}): ExecutionState {
  if (input.blocked) return "blocked";
  if (!input.levels) return "awaiting_activation";
  if (input.planType === "conditional") return "awaiting_activation";
  const price = Number(input.currentPrice);
  if (!Number.isFinite(price)) return "awaiting_activation";
  const inZone =
    price >= Math.min(input.levels.entryLow, input.levels.entryHigh) &&
    price <= Math.max(input.levels.entryLow, input.levels.entryHigh);
  if (input.planType === "immediate") return inZone ? "valid_now" : "awaiting_activation";
  // Anticipatory: acting early inside the zone is the point of the plan.
  return inZone ? "valid_now" : "awaiting_activation";
}

/** Candle duration for a canonical interval, used to bound plan validity. */
export function intervalMs(interval: string): number {
  const match = /^(\d+)\s*([mhdw])$/i.exec(interval.trim());
  if (!match) return 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const unitMs =
    unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : unit === "d" ? 86_400_000 : 604_800_000;
  return value * unitMs;
}

/**
 * Validity expressed the way the agent reasons about it — in candles — bounded
 * by the server's maximum so a model typo cannot pin a plan open for days.
 */
export function resolveValidity(input: {
  validityCandles: number;
  interval: string;
  maxExpiresAt: number;
  now: number;
}): { expiresAt: number; maxCandles: number } {
  const candles = Math.max(1, Math.min(Math.round(input.validityCandles), 96));
  const requested = input.now + candles * intervalMs(input.interval);
  return {
    expiresAt: Math.min(requested, input.maxExpiresAt),
    maxCandles: candles,
  };
}
