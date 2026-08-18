/**
 * Shape the synthesizer historically received for statistical backing.
 * Production always passes `level: "unavailable"` — the simulation apparatus
 * has been deleted. The type remains so the prompt can be told, honestly,
 * that the plan rests on direct analysis / model judgement.
 */
export type SupportLevel = "strong" | "moderate" | "weak" | "unavailable";

export interface StatisticalSupport {
  level: SupportLevel;
  detail: string;
  strategyId?: string;
  calibratedConfidence?: number;
  confidenceInterval?: [number, number];
  deploymentState?: string;
  liveSampleSize?: number;
  deployments?: Array<{
    strategyId: string;
    state: string;
    calibratedConfidence: number;
    confidenceInterval: [number, number];
    liveSampleSize: number;
    backtestTrades: number;
    backtestWinRate: number | null;
  }>;
}

export const UNAVAILABLE_STATISTICAL_SUPPORT: StatisticalSupport = {
  level: "unavailable",
  detail:
    "Statistical backtest claims have been removed. The plan rests on live analysis and the model's own judgement.",
};
