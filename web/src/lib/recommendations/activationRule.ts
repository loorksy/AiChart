/**
 * Structured activation rules — what a conditional plan actually waits for.
 *
 * A plan used to store its trigger as free text ("إغلاق شمعة ساعة فوق 1.1020")
 * and then activate on `entryTouched`, a bare wick crossing the entry. The text
 * was never read by anything, so a plan demanding a close, a confirmed break, a
 * retest or a rejection filled on a touch that satisfied none of them.
 *
 * The rule is therefore stored as data and evaluated here. Three responsibilities
 * stay apart on purpose:
 *
 *   - the tracker collects candles and asks this module per candle;
 *   - this module decides ONLY whether the stated condition is now satisfied;
 *   - the lifecycle/brain owns the transition that follows.
 *
 * Everything here is pure: no DB, no network, no clock beyond what the caller
 * passes. That is what lets the same rule be graded identically by the tracker,
 * by a re-evaluation, and by a test.
 */
import { z } from "zod";

/**
 * Declared structurally rather than imported from the tracker, so this module
 * stays a leaf: the plan types import the rule, and the tracker imports both.
 * Identical in shape to `TrackerCandle`, and assignable from it.
 */
export interface ActivationCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

type TrackerCandle = ActivationCandle;

export const ACTIVATION_RULE_KINDS = [
  "price_touch",
  "candle_close_above",
  "candle_close_below",
  "breakout_confirmed",
  "retest_confirmed",
  "rejection_confirmed",
  "composite",
] as const;

export type ActivationRuleKind = (typeof ACTIVATION_RULE_KINDS)[number];

/** Which side of a level the plan needs price to end up on. */
export const ACTIVATION_DIRECTIONS = ["above", "below"] as const;
export type ActivationDirection = (typeof ACTIVATION_DIRECTIONS)[number];

const zLevel = z.number().finite().positive();
/** Absolute price units, never a percentage — the caller owns instrument scale. */
const zTolerance = z.number().finite().nonnegative().optional();
/**
 * OPTIONAL at the contract boundary, filled by `normalizeActivationRule` with
 * the plan's own timeframe before storage.
 *
 * Requiring it here was a producer trap, and a measured one: the platform's
 * decision model and MCP agents both emitted otherwise-perfect rules that
 * failed only on a missing `timeframe` — burning both synthesis attempts (the
 * operator saw "timeout") and spraying -32602 at MCP clients. A rule that
 * names no timeframe on a 15m plan means the 15m — that is a mechanical
 * default, not an inference from prose. A rule that MEANS another timeframe
 * must still say so.
 */
const zTimeframe = z
  .string()
  .trim()
  .min(1)
  .max(8)
  .optional()
  .describe(
    "The timeframe whose candles are graded, e.g. 15m, 1h. Omit to use the plan's own timeframe.",
  );
const zCloses = z
  .number()
  .int()
  .min(1)
  .max(10)
  .optional()
  .describe("How many consecutive qualifying closes are required. Default 1.");
const zExpiry = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("Epoch ms after which the condition can no longer be satisfied.");

const baseFields = {
  timeframe: zTimeframe,
  expiresAt: zExpiry,
};

/**
 * A retest needs somewhere to come back TO. Stored as an explicit band rather
 * than derived from a tolerance, because the zone a level is retested in is an
 * analytical judgement, not a rounding allowance.
 */
const zRetestZone = z
  .object({ low: zLevel, high: zLevel })
  .refine((zone) => zone.high >= zone.low, {
    message: "retestZone.high must be >= retestZone.low",
  });

const priceTouchSchema = z.object({
  kind: z.literal("price_touch"),
  level: zLevel,
  /**
   * Optional, with exact absent semantics: no direction means "the candle's
   * range contained the level" — a plain touch from either side, which is what
   * the sentence "لمس السعر 4000" says. Producers kept omitting it because the
   * question "touched from which side?" often has no analytical answer.
   */
  direction: z.enum(ACTIVATION_DIRECTIONS).optional(),
  tolerance: zTolerance,
  ...baseFields,
});

const candleCloseAboveSchema = z.object({
  kind: z.literal("candle_close_above"),
  level: zLevel,
  tolerance: zTolerance,
  closes: zCloses,
  ...baseFields,
});

const candleCloseBelowSchema = z.object({
  kind: z.literal("candle_close_below"),
  level: zLevel,
  tolerance: zTolerance,
  closes: zCloses,
  ...baseFields,
});

const breakoutSchema = z.object({
  kind: z.literal("breakout_confirmed"),
  level: zLevel,
  direction: z.enum(ACTIVATION_DIRECTIONS),
  tolerance: zTolerance,
  closes: zCloses,
  ...baseFields,
});

const retestSchema = z.object({
  kind: z.literal("retest_confirmed"),
  level: zLevel,
  direction: z.enum(ACTIVATION_DIRECTIONS),
  retestZone: zRetestZone,
  tolerance: zTolerance,
  closes: zCloses,
  ...baseFields,
});

const rejectionSchema = z.object({
  kind: z.literal("rejection_confirmed"),
  level: zLevel,
  direction: z.enum(ACTIVATION_DIRECTIONS),
  tolerance: zTolerance,
  ...baseFields,
});

const leafSchema = z.discriminatedUnion("kind", [
  priceTouchSchema,
  candleCloseAboveSchema,
  candleCloseBelowSchema,
  breakoutSchema,
  retestSchema,
  rejectionSchema,
]);

/**
 * Composite nests one level deep only. A rule an operator cannot restate in a
 * sentence is a rule nobody can audit, and arbitrary nesting buys expressiveness
 * nothing real has asked for.
 */
const compositeSchema = z.object({
  kind: z.literal("composite"),
  operator: z.enum(["all", "any"]),
  rules: z.array(leafSchema).min(2).max(4),
  expiresAt: zExpiry,
});

/**
 * ONE flat discriminated union over all seven kinds — composite included.
 *
 * The previous shape, `union([discriminatedUnion(leaves), composite])`,
 * advertised to MCP clients as `anyOf[oneOf[...], {...}]`: validators flattened
 * its error paths into a wall of contradicting messages ("level: expected
 * number, received undefined" beside "operator: expected all|any") that told a
 * producer nothing about which branch it was in. With a single discriminator,
 * both zod and JSON-Schema consumers key on `kind` first and report only the
 * chosen branch's real problem.
 */
export const activationRuleSchema = z.discriminatedUnion("kind", [
  priceTouchSchema,
  candleCloseAboveSchema,
  candleCloseBelowSchema,
  breakoutSchema,
  retestSchema,
  rejectionSchema,
  compositeSchema,
]);

export type ActivationRule = z.infer<typeof activationRuleSchema>;
export type LeafActivationRule = z.infer<typeof leafSchema>;

export interface ActivationEvidence {
  kind: ActivationRuleKind;
  /** The candle that satisfied the rule. */
  at: number;
  close: number;
  high: number;
  low: number;
  /** Human-readable proof, recorded on the transition for audit. */
  detail: string;
}

export interface ActivationObservation {
  activated: boolean;
  evidence?: ActivationEvidence;
}

/**
 * Parse a stored rule. Returns null rather than throwing: a malformed rule must
 * leave the plan un-activatable, never crash the sweep that reads it. A plan
 * whose rule cannot be read is a plan that never fires — which is the safe
 * direction, and is visible because the caller records the parse failure.
 */
export function parseActivationRule(raw: unknown): ActivationRule | null {
  if (raw == null) return null;
  let candidate = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  const parsed = activationRuleSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function serializeActivationRule(rule: ActivationRule): string {
  return JSON.stringify(rule);
}

/**
 * Fill mechanical defaults so the STORED rule is always complete.
 *
 * Exactly one default exists: a leaf that names no timeframe gets the plan's
 * own. That is the boundary between ergonomics and inference — the plan's
 * timeframe is a fact the producer already stated elsewhere in the same
 * payload, not a guess about what its prose meant. Nothing else is defaulted:
 * no invented direction, no invented level, no rule synthesized from text.
 */
export function normalizeActivationRule(
  rule: ActivationRule,
  planTimeframe: string,
): ActivationRule {
  const tf = planTimeframe.trim();
  if (rule.kind === "composite") {
    return {
      ...rule,
      rules: rule.rules.map((leaf) =>
        leaf.timeframe ? leaf : { ...leaf, timeframe: tf },
      ),
    };
  }
  return rule.timeframe ? rule : { ...rule, timeframe: tf };
}

/** Did this candle close beyond `level` on the required side, past tolerance? */
function closedBeyond(
  candle: TrackerCandle,
  level: number,
  direction: ActivationDirection,
  tolerance: number,
): boolean {
  return direction === "above"
    ? candle.close > level + tolerance
    : candle.close < level - tolerance;
}

/** Did this candle merely REACH the level — wick included? */
function touched(
  candle: TrackerCandle,
  level: number,
  direction: ActivationDirection,
  tolerance: number,
): boolean {
  return direction === "above"
    ? candle.high >= level - tolerance
    : candle.low <= level + tolerance;
}

function inZone(price: number, zone: { low: number; high: number }): boolean {
  return price >= zone.low && price <= zone.high;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(5).replace(/0+$/, "");
}

interface LeafState {
  /** Consecutive qualifying closes seen so far. */
  streak: number;
  /** retest_confirmed only: the break has happened. */
  broke: boolean;
  /** retest_confirmed only: price has returned into the zone since the break. */
  returned: boolean;
  satisfied: boolean;
  evidence?: ActivationEvidence;
}

function newLeafState(): LeafState {
  return { streak: 0, broke: false, returned: false, satisfied: false };
}

function observeLeaf(
  rule: LeafActivationRule,
  state: LeafState,
  candle: TrackerCandle,
): void {
  if (state.satisfied) return;
  const tolerance = rule.tolerance ?? 0;
  const required = "closes" in rule ? (rule.closes ?? 1) : 1;

  const satisfy = (detail: string) => {
    state.satisfied = true;
    state.evidence = {
      kind: rule.kind,
      at: candle.time,
      close: candle.close,
      high: candle.high,
      low: candle.low,
      detail,
    };
  };

  switch (rule.kind) {
    case "price_touch": {
      // The only kind a wick may satisfy — and it says so in its name.
      // No direction = the candle's range contained the level: a plain touch
      // from either side, exactly what the sentence says when it names none.
      const hit = rule.direction
        ? touched(candle, rule.level, rule.direction, tolerance)
        : candle.low <= rule.level + tolerance && candle.high >= rule.level - tolerance;
      if (hit) {
        satisfy(
          rule.direction
            ? `لمس السعر ${fmt(rule.level)} (${rule.direction})`
            : `لمس السعر ${fmt(rule.level)}`,
        );
      }
      return;
    }

    case "candle_close_above":
    case "candle_close_below": {
      const direction: ActivationDirection =
        rule.kind === "candle_close_above" ? "above" : "below";
      if (closedBeyond(candle, rule.level, direction, tolerance)) {
        state.streak += 1;
        if (state.streak >= required) {
          satisfy(
            `${state.streak} إغلاق ${direction === "above" ? "فوق" : "تحت"} ${fmt(rule.level)} على ${rule.timeframe}`,
          );
        }
      } else {
        // Consecutive: a candle that fails breaks the run. A plan asking for two
        // closes above a level is not satisfied by two closes a week apart.
        state.streak = 0;
      }
      return;
    }

    case "breakout_confirmed": {
      if (closedBeyond(candle, rule.level, rule.direction, tolerance)) {
        state.streak += 1;
        if (state.streak >= required) {
          satisfy(
            `كسر مؤكد بإغلاق ${state.streak} شمعة ${rule.direction === "above" ? "فوق" : "تحت"} ${fmt(rule.level)} على ${rule.timeframe}`,
          );
        }
      } else {
        state.streak = 0;
      }
      return;
    }

    case "retest_confirmed": {
      // Strictly ordered: break, come back, then confirm. A breakout alone never
      // satisfies a retest, which is the whole point of asking for one.
      if (!state.broke) {
        if (closedBeyond(candle, rule.level, rule.direction, tolerance)) {
          state.broke = true;
        }
        return;
      }
      if (!state.returned) {
        if (inZone(candle.low, rule.retestZone) || inZone(candle.high, rule.retestZone)) {
          state.returned = true;
        }
        return;
      }
      if (closedBeyond(candle, rule.level, rule.direction, tolerance)) {
        state.streak += 1;
        if (state.streak >= required) {
          satisfy(
            `إعادة اختبار مؤكدة: كسر ${fmt(rule.level)} ثم عودة إلى النطاق ثم إغلاق ${rule.direction === "above" ? "فوق" : "تحت"} المستوى`,
          );
        }
      } else {
        state.streak = 0;
      }
      return;
    }

    case "rejection_confirmed": {
      // A rejection is a wick THROUGH the level with a close back on the origin
      // side. Both halves are required: piercing without closing back is a
      // break in progress, and closing back without piercing is just drift.
      const pierced =
        rule.direction === "above"
          ? candle.low <= rule.level + tolerance
          : candle.high >= rule.level - tolerance;
      const closedBack =
        rule.direction === "above"
          ? candle.close > rule.level + tolerance
          : candle.close < rule.level - tolerance;
      if (pierced && closedBack) {
        satisfy(
          `ارتداد مؤكد عن ${fmt(rule.level)}: اخترق الفتيل وأغلق ${rule.direction === "above" ? "فوقه" : "تحته"}`,
        );
      }
      return;
    }
  }
}

export interface ActivationEvaluator {
  /** Feed one completed candle. Returns whether the rule is now satisfied. */
  observe(candle: TrackerCandle): ActivationObservation;
  /** Satisfied at some point during this run. */
  readonly activated: boolean;
  readonly evidence?: ActivationEvidence;
}

/**
 * Build a stateful evaluator for one rule.
 *
 * Stateful because the interesting conditions are sequences: a retest is a break
 * THEN a return THEN a confirmation, and "two consecutive closes" is meaningless
 * to a function that only ever sees one candle. The tracker replays candles in
 * order, so the evaluator accumulates exactly as the market did.
 */
export function createActivationEvaluator(rule: ActivationRule): ActivationEvaluator {
  const leaves: LeafActivationRule[] =
    rule.kind === "composite" ? [...rule.rules] : [rule];
  const states = leaves.map(() => newLeafState());
  let activated = false;
  let evidence: ActivationEvidence | undefined;

  const expiresAt = rule.expiresAt;

  return {
    observe(candle: TrackerCandle): ActivationObservation {
      if (activated) return { activated: true, evidence };
      // An expired condition is not a condition. Checked before observing so a
      // late candle can never resurrect a plan whose window has closed.
      if (expiresAt != null && candle.time > expiresAt) {
        return { activated: false };
      }

      for (let index = 0; index < leaves.length; index += 1) {
        observeLeaf(leaves[index]!, states[index]!, candle);
      }

      const satisfiedCount = states.filter((state) => state.satisfied).length;
      const done =
        rule.kind === "composite"
          ? rule.operator === "all"
            ? satisfiedCount === leaves.length
            : satisfiedCount > 0
          : satisfiedCount === 1;

      if (!done) return { activated: false };

      activated = true;
      const source = states.find((state) => state.satisfied)?.evidence;
      evidence =
        rule.kind === "composite" && source
          ? {
              ...source,
              kind: "composite",
              detail: `شرط مركّب (${rule.operator}): ${states
                .filter((state) => state.evidence)
                .map((state) => state.evidence!.detail)
                .join(" + ")}`,
            }
          : source;
      return { activated: true, evidence };
    },
    get activated() {
      return activated;
    },
    get evidence() {
      return evidence;
    },
  };
}

/**
 * Replay a whole candle series against a rule. Convenience for callers that
 * already hold the series (the tracker, a re-evaluation, a test).
 */
export function evaluateActivationRule(
  rule: ActivationRule,
  candles: readonly TrackerCandle[],
): ActivationObservation {
  const evaluator = createActivationEvaluator(rule);
  for (const candle of candles) {
    const observation = evaluator.observe(candle);
    if (observation.activated) return observation;
  }
  return { activated: false };
}

/** The plain-language restatement stored alongside the rule and shown to the operator. */
export function describeActivationRule(rule: ActivationRule): string {
  if (rule.kind === "composite") {
    const joiner = rule.operator === "all" ? " و" : " أو";
    return rule.rules.map(describeActivationRule).join(joiner);
  }
  const level = fmt(rule.level);
  switch (rule.kind) {
    case "price_touch":
      return `لمس السعر ${level}`;
    case "candle_close_above":
      return `إغلاق ${rule.closes ?? 1} شمعة ${rule.timeframe ?? "الإطار المعتمد"} فوق ${level}`;
    case "candle_close_below":
      return `إغلاق ${rule.closes ?? 1} شمعة ${rule.timeframe ?? "الإطار المعتمد"} تحت ${level}`;
    case "breakout_confirmed":
      return `كسر مؤكد ${rule.direction === "above" ? "فوق" : "تحت"} ${level} بإغلاق ${rule.closes ?? 1} شمعة ${rule.timeframe ?? "الإطار المعتمد"}`;
    case "retest_confirmed":
      return `كسر ${level} ثم إعادة اختباره بين ${fmt(rule.retestZone.low)} و${fmt(rule.retestZone.high)} ثم تأكيد الإغلاق`;
    case "rejection_confirmed":
      return `ارتداد مؤكد عن ${level} على ${rule.timeframe}`;
  }
}
