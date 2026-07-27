/**
 * The Complete Plan Contract — one rule set, every surface.
 *
 * A recommendation is a three-layer plan: the direction, how it is entered
 * (plan type), and whether it can be entered right now (execution state), with
 * the conditions that turn it on, kill it, and expire it. The Platform's model
 * schema enforced this; the MCP surface could not even express it, so an MCP
 * plan was stored with every layer-3 column NULL — auto-eligible on a bare
 * touch, never expiring by candle count, and diffing spuriously on its first
 * re-evaluation.
 *
 * The fix is not a second validator on the second surface — two validators
 * drift. It is this leaf module (no DB, no network), consumed identically by
 * the MCP-facing route, the canonical creator, and the tests, so Platform and
 * MCP cannot diverge again.
 *
 * Deliberately NOT enforced here:
 * - direction "wait" — refused elsewhere (hidden-WAIT guard), not a plan.
 * - anything about legacy rows: a row written before the contract existed is
 *   history. The creator exempts them explicitly via `legacyImport`.
 * - "activation must be absent for immediate" — the Platform legitimately
 *   attaches an entry-area condition to immediate plans; forbidding it would
 *   reject real plans to satisfy a symmetry nobody needs.
 */
import {
  activationRuleSchema,
  type ActivationRule,
} from "../activationRule";

export const PLAN_TYPES = ["immediate", "anticipatory", "conditional"] as const;
export type PlanContractPlanType = (typeof PLAN_TYPES)[number];

export const EXECUTION_STATES = [
  "valid_now",
  "awaiting_activation",
  "expired",
  "invalidated",
  "blocked",
] as const;

/** What the validator needs to see. A projection, not a storage shape. */
export interface PlanContractInput {
  direction: "buy" | "sell" | "wait";
  planType?: string | null;
  executionState?: string | null;
  entry?: number | null;
  entryLow?: number | null;
  entryHigh?: number | null;
  stopLoss?: number | null;
  targets?: readonly number[] | null;
  activationCondition?: string | null;
  activationRule?: ActivationRule | null;
  invalidationRule?: string | null;
  alternativeScenario?: string | null;
  validityCandles?: number | null;
}

export interface PlanContractIssue {
  path: string;
  message: string;
}

const TEXT_MIN = 8;
const TEXT_MAX = 400;

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * A required narrative field must carry an actual statement. Length is a crude
 * probe for filler, but a floor plus the same-string check below catches the
 * obvious ways a caller might stuff the contract to get past it.
 */
function meaningfulText(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= TEXT_MIN && trimmed.length <= TEXT_MAX;
}

/**
 * Validate a plan against the contract. Empty array = complete.
 *
 * Only buy/sell plans are graded: a WAIT is refused before it gets here, and
 * grading it would imply it could pass.
 */
export function validateCompletePlan(input: PlanContractInput): PlanContractIssue[] {
  if (input.direction !== "buy" && input.direction !== "sell") return [];

  const issues: PlanContractIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });

  // Layer 2 — how the plan is entered.
  const planType = input.planType ?? null;
  if (planType == null || !PLAN_TYPES.includes(planType as PlanContractPlanType)) {
    issue(
      "planType",
      `plan_type must be one of ${PLAN_TYPES.join("|")} — a direction with no plan type is an opinion, not a plan`,
    );
  }

  // Layer 3 — whether it can be entered right now. NULL is the finding.
  const executionState = input.executionState ?? null;
  if (
    executionState == null ||
    !EXECUTION_STATES.includes(executionState as (typeof EXECUTION_STATES)[number])
  ) {
    issue(
      "executionState",
      `execution_state must be one of ${EXECUTION_STATES.join("|")} and never NULL`,
    );
  }

  // Levels — a plan you cannot place is not a plan.
  if (!finitePositive(input.entry)) issue("entry", "a finite positive entry is required");
  if (!finitePositive(input.stopLoss)) {
    issue("stopLoss", "a finite positive stop loss is required");
  }
  const targets = (input.targets ?? []).filter((t) => finitePositive(t));
  if (targets.length === 0) {
    issue("targets", "at least one finite positive target is required");
  }
  if (
    finitePositive(input.entryLow) &&
    finitePositive(input.entryHigh) &&
    input.entryLow > input.entryHigh
  ) {
    issue("entryZone", "entry_low must not exceed entry_high");
  }

  // The conditions that govern the plan's life.
  if (!meaningfulText(input.invalidationRule)) {
    issue(
      "invalidationRule",
      `an invalidation rule of ${TEXT_MIN}..${TEXT_MAX} characters is required — every plan states what kills it`,
    );
  }
  if (!meaningfulText(input.alternativeScenario)) {
    issue(
      "alternativeScenario",
      `an alternative scenario of ${TEXT_MIN}..${TEXT_MAX} characters is required`,
    );
  }
  if (
    typeof input.invalidationRule === "string" &&
    typeof input.alternativeScenario === "string" &&
    input.invalidationRule.trim().length > 0 &&
    input.invalidationRule.trim() === input.alternativeScenario.trim()
  ) {
    issue(
      "alternativeScenario",
      "invalidation rule and alternative scenario are identical — distinct statements are required, not filler",
    );
  }
  const validity = input.validityCandles ?? null;
  if (validity == null || !Number.isInteger(validity) || validity < 1 || validity > 96) {
    issue("validityCandles", "validity_candles must be an integer between 1 and 96");
  }

  // Plans that wait for something must say what, in both forms: the sentence
  // for the operator, the rule for the machine that grades it.
  if (planType === "conditional" || planType === "anticipatory") {
    if (!meaningfulText(input.activationCondition)) {
      issue(
        "activationCondition",
        `a ${planType} plan requires an activation condition of ${TEXT_MIN}..${TEXT_MAX} characters`,
      );
    }
    const rule = input.activationRule ?? null;
    if (rule == null) {
      issue(
        "activationRule",
        `a ${planType} plan requires a structured activation rule — free text alone cannot be machine-checked, which is how plans filled on a bare touch`,
      );
    } else if (!activationRuleSchema.safeParse(rule).success) {
      issue("activationRule", "the structured activation rule does not match any known rule kind");
    }
  }

  // A conditional plan that claims it can be entered right now contradicts
  // itself; the state for "waiting on a stated trigger" is awaiting_activation.
  if (planType === "conditional" && executionState === "valid_now") {
    issue(
      "executionState",
      "a conditional plan cannot be valid_now — it waits for its stated trigger",
    );
  }

  return issues;
}

/** Throw-on-violation form for the canonical write path. */
export class PlanContractViolation extends Error {
  constructor(public readonly issues: PlanContractIssue[]) {
    super(
      `incomplete plan: ${issues.map((entry) => `${entry.path}: ${entry.message}`).join("; ")}`,
    );
    this.name = "PlanContractViolation";
  }
}

export function assertCompletePlan(input: PlanContractInput): void {
  const issues = validateCompletePlan(input);
  if (issues.length > 0) throw new PlanContractViolation(issues);
}
