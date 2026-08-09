/**
 * Pure reward:risk helper — safe for client and server imports.
 */
export function computeRewardRisk(
  entry: number | null | undefined,
  stopLoss: number | null | undefined,
  takeProfit: number | null | undefined,
): number | null {
  if (entry == null || stopLoss == null || takeProfit == null) return null;
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  if (!(risk > 0) || !(reward >= 0)) return null;
  return reward / risk;
}
