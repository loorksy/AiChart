/**
 * Shared risk-limit resolution helpers.
 *
 * The admin caps in `admin_limits` are CEILINGS, not literal values. A cap of
 * 0 (or less) means UNLIMITED → the user's own setting governs. A positive cap
 * can only LOWER (never raise) the user's setting.
 *
 * This lives in one place to avoid the `Math.min(userValue, 0) === 0` trap:
 * when the admin "open trades" cap defaulted to unlimited (0), the naive
 * `Math.min(settings.max_open_trades, cap)` silently became 0 and blocked
 * EVERY trade for that user. Always resolve caps through these helpers.
 */

/**
 * Effective max concurrent open trades for a user.
 * @param userMaxOpenTrades the user's own `settings.max_open_trades`
 * @param adminCap the admin `limits.max_open_trades_cap` (0 / <0 = unlimited)
 */
export function resolveMaxOpenTrades(
  userMaxOpenTrades: number,
  adminCap: number,
): number {
  const user = Number.isFinite(userMaxOpenTrades)
    ? Math.max(0, Math.trunc(userMaxOpenTrades))
    : 0;
  if (!Number.isFinite(adminCap) || adminCap <= 0) return user;
  return Math.min(user, Math.trunc(adminCap));
}

/**
 * Effective capital ceiling — the lower of the user's cap and the admin's
 * ceiling, where an admin cap of 0 (or less) means UNLIMITED.
 */
export function resolveEffectiveCapital(
  userMaxCapital: number,
  adminCapitalCap: number,
): number {
  if (!Number.isFinite(adminCapitalCap) || adminCapitalCap <= 0) {
    return userMaxCapital;
  }
  return Math.min(userMaxCapital, adminCapitalCap);
}
