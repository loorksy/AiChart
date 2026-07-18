/**
 * Post-decision technical validation. Never changes BUY/SELL/WAIT direction.
 */
import type { ModelTradePlan } from "./modelTradePlan";

export type ValidatedTradePlan = {
  decision: ModelTradePlan["decision"];
  activation: ModelTradePlan["activation"];
  executionReady: boolean;
  plan: ModelTradePlan;
  entry: number | null;
  stopLoss: number | null;
  targets: number[];
  technicalErrors: string[];
  directionPreserved: true;
};

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function validateTradePlanTechnically(input: {
  plan: ModelTradePlan;
  currentPrice: number | null;
  tickSize?: number | null;
  quoteAgeMs?: number | null;
  maxQuoteAgeMs?: number;
}): ValidatedTradePlan {
  const plan = input.plan;
  const errors: string[] = [];
  const decision = plan.decision;

  if (decision === "wait") {
    return {
      decision,
      activation: "none",
      executionReady: false,
      plan: { ...plan, activation: "none" },
      entry: null,
      stopLoss: null,
      targets: [],
      technicalErrors: [],
      directionPreserved: true,
    };
  }

  const preferred = plan.entryZone.preferred;
  const low = plan.entryZone.low;
  const high = plan.entryZone.high;
  const entry = finite(preferred)
    ? preferred
    : finite(low) && finite(high)
      ? (low + high) / 2
      : finite(low)
        ? low
        : finite(high)
          ? high
          : null;
  const stopLoss = finite(plan.stopLoss) ? plan.stopLoss : null;
  const targets = plan.targets.map((t) => t.price).filter(finite);

  if (entry == null) errors.push("entry_missing");
  if (stopLoss == null) errors.push("stop_missing");
  if (!targets.length) errors.push("targets_missing");

  if (entry != null && stopLoss != null) {
    if (decision === "buy" && !(stopLoss < entry)) {
      errors.push("buy_stop_must_be_below_entry");
    }
    if (decision === "sell" && !(stopLoss > entry)) {
      errors.push("sell_stop_must_be_above_entry");
    }
  }

  if (entry != null && targets.length) {
    if (decision === "buy" && targets.some((t) => t <= entry)) {
      errors.push("buy_targets_must_be_above_entry");
    }
    if (decision === "sell" && targets.some((t) => t >= entry)) {
      errors.push("sell_targets_must_be_below_entry");
    }
  }

  if (finite(low) && finite(high) && low > high) {
    errors.push("entry_zone_low_above_high");
  }

  const tick = input.tickSize;
  if (tick && tick > 0 && entry != null) {
    const align = (n: number) => Math.abs(n / tick - Math.round(n / tick)) > 1e-6;
    if (align(entry)) errors.push("entry_not_tick_aligned");
    if (stopLoss != null && align(stopLoss)) errors.push("stop_not_tick_aligned");
  }

  const maxAge = input.maxQuoteAgeMs ?? 120_000;
  if (input.quoteAgeMs != null && input.quoteAgeMs > maxAge) {
    errors.push("quote_stale");
  }

  if (
    input.currentPrice != null &&
    entry != null &&
    finite(low) &&
    finite(high) &&
    plan.activation === "immediate"
  ) {
    if (input.currentPrice < low || input.currentPrice > high) {
      // Informational for immediate — still allow conditional; mark not ready if far
      if (Math.abs(input.currentPrice - entry) / entry > 0.01) {
        errors.push("price_outside_entry_zone");
      }
    }
  }

  return {
    decision,
    activation: plan.activation === "none" ? "conditional" : plan.activation,
    executionReady: errors.length === 0,
    plan,
    entry,
    stopLoss,
    targets,
    technicalErrors: errors,
    directionPreserved: true,
  };
}
