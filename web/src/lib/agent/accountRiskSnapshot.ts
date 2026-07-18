/**
 * Account snapshot for post-decision execution checks only.
 * Never used to choose BUY / SELL / WAIT.
 */
export interface AccountRiskSnapshot {
  openTradesCount: number;
  openTradesOnSymbol: number;
  todayRealizedPnlPct: number;
  /** null when account data is unavailable — the agent must not execute then. */
  available: boolean;
}
