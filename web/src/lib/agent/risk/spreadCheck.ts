/** Spread quality checks used by validation + Execution Guard. */

export function isSpreadTooHigh(input: {
  spread: number;
  atr: number;
  stopDistance: number;
}): boolean {
  if (!(input.spread > 0)) return false;
  return (
    (input.atr > 0 && input.spread > input.atr * 0.15) ||
    (input.stopDistance > 0 && input.spread > input.stopDistance * 0.2)
  );
}

/** Conditions that make slippage likely enough to warn (or block) on execute. */
export function slippageRisk(input: {
  newsRisk: "low" | "medium" | "high" | "unknown";
  spreadTooHigh: boolean;
  marketJustOpened: boolean;
}): "none" | "warn" | "block" {
  if (input.newsRisk === "high" && input.spreadTooHigh) return "block";
  if (
    input.newsRisk === "high" ||
    input.newsRisk === "medium" ||
    input.spreadTooHigh ||
    input.marketJustOpened
  ) {
    return "warn";
  }
  return "none";
}
