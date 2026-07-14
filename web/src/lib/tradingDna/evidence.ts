import { query } from "@/lib/db";
import { listValidatedTradeLessons } from "@/lib/recommendations/canonical";
import type {
  BacktestEvidenceReference,
  EvidenceReferences,
  TradingDnaEvidenceBundle,
  TradingDnaLearningEvidence,
  TradingDnaOutcomeEvidence,
  TradingDnaRecommendationEvidence,
  TradingDnaTradeEvidence,
} from "./types";
import { emptyEvidence } from "./types";

const MAX_RECOMMENDATIONS = 2_000;
const MAX_OUTCOMES = 5_000;
const MAX_EVENTS = 5_000;
const MAX_TRADES = 2_000;
const MAX_REFERENCES_PER_KIND = 2_000;
const MAX_BACKTESTS = 20;

interface RecommendationRow {
  id: number;
  symbol: string;
  market: string | null;
  timeframe: string | null;
  strategy_id: string | null;
  direction: "buy" | "sell" | "wait" | null;
  action: "buy" | "sell" | "wait";
  confidence: number;
  status: string;
  created_at: unknown;
}

interface OutcomeRow {
  id: number;
  recommendation_id: number;
  outcome_type: string;
  r_multiple: number | null;
  pnl: number | null;
  holding_ms: number | null;
  mae: number | null;
  mfe: number | null;
  spread_cost: number | null;
  slippage: number | null;
  commission: number | null;
  risk_used: number | null;
  occurred_at: number;
}

interface LearningRow {
  event_id: string;
  recommendation_id: number;
  event_type: string;
  occurred_at: number;
}

interface TradeRow {
  trade_id: number;
  recommendation_id: number | null;
  symbol: string;
  status: string;
  pnl: number;
  created_at: unknown;
  closed_at: unknown | null;
}

export interface CollectTradingDnaEvidenceOptions {
  fromMs?: number;
  toMs?: number;
  backtests?: BacktestEvidenceReference[];
  now?: number;
}

function finite(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d{12,}$/.test(value)) return Number(value);
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function inWindow(value: number, fromMs?: number, toMs?: number): boolean {
  return (fromMs == null || value >= fromMs) && (toMs == null || value <= toMs);
}

function validateWindow(fromMs?: number, toMs?: number): void {
  if (fromMs != null && (!Number.isFinite(fromMs) || fromMs < 0)) {
    throw new Error("Trading DNA evidence start must be a positive timestamp");
  }
  if (toMs != null && (!Number.isFinite(toMs) || toMs < 0)) {
    throw new Error("Trading DNA evidence end must be a positive timestamp");
  }
  if (fromMs != null && toMs != null && fromMs > toMs) {
    throw new Error("Trading DNA evidence window is invalid");
  }
}

function normalizeBacktests(
  userId: number,
  backtests: BacktestEvidenceReference[] = [],
): BacktestEvidenceReference[] {
  const unique = new Map<string, BacktestEvidenceReference>();
  for (const item of backtests.slice(0, MAX_BACKTESTS)) {
    if (
      !/^rj_[A-Za-z0-9_-]+$/.test(item.jobId) ||
      item.userId !== userId ||
      !Number.isFinite(item.verifiedAt) ||
      item.verifiedAt <= 0 ||
      item.status !== "succeeded" ||
      !["run_forex_backtest", "run_backtest_validation"].includes(item.jobType)
    ) {
      throw new Error("Unverified Research Service backtest evidence");
    }
    unique.set(item.jobId, {
      ...item,
      artifactIds: [...new Set(item.artifactIds.filter((id) => /^ra_[A-Za-z0-9_-]+$/.test(id)))]
        .sort()
        .slice(0, 20),
      resultSummary: item.resultSummary?.slice(0, 500),
    });
  }
  return [...unique.values()].sort((a, b) => a.jobId.localeCompare(b.jobId));
}

export function normalizeEvidence(input: Partial<EvidenceReferences>): EvidenceReferences {
  const numbers = (values: number[] | undefined) =>
    [...new Set((values ?? []).filter((value) => Number.isInteger(value) && value > 0))]
      .sort((a, b) => a - b)
      .slice(0, MAX_REFERENCES_PER_KIND);
  const strings = (values: string[] | undefined) =>
    [...new Set((values ?? []).filter((value) => typeof value === "string" && value.length > 0))]
      .sort()
      .slice(0, MAX_REFERENCES_PER_KIND);
  return {
    recommendationIds: numbers(input.recommendationIds),
    tradeIds: numbers(input.tradeIds),
    learningEventIds: strings(input.learningEventIds),
    backtestIds: strings(input.backtestIds),
    artifactIds: strings(input.artifactIds),
  };
}

export function mergeEvidence(...items: EvidenceReferences[]): EvidenceReferences {
  const merged = emptyEvidence();
  for (const item of items) {
    merged.recommendationIds.push(...item.recommendationIds);
    merged.tradeIds.push(...item.tradeIds);
    merged.learningEventIds.push(...item.learningEventIds);
    merged.backtestIds.push(...item.backtestIds);
    merged.artifactIds.push(...item.artifactIds);
  }
  return normalizeEvidence(merged);
}

export function hasEvidence(evidence: EvidenceReferences): boolean {
  return (
    evidence.recommendationIds.length > 0 ||
    evidence.tradeIds.length > 0 ||
    evidence.learningEventIds.length > 0 ||
    evidence.backtestIds.length > 0
  );
}

export function requireEvidence(evidence: EvidenceReferences, label: string): void {
  if (!hasEvidence(evidence)) throw new Error(`${label} has no historical evidence`);
}

export function evidenceFromBundle(bundle: TradingDnaEvidenceBundle): EvidenceReferences {
  return normalizeEvidence({
    recommendationIds: bundle.recommendations.map((item) => item.recommendationId),
    tradeIds: bundle.trades.map((item) => item.tradeId),
    learningEventIds: bundle.learningEvents.map((item) => item.eventId),
    backtestIds: bundle.backtests.map((item) => item.jobId),
    artifactIds: bundle.backtests.flatMap((item) => item.artifactIds),
  });
}

export async function collectTradingDnaEvidence(
  userId: number,
  options: CollectTradingDnaEvidenceOptions = {},
): Promise<TradingDnaEvidenceBundle> {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("Invalid Trading DNA tenant");
  validateWindow(options.fromMs, options.toMs);
  const [recommendationRows, outcomeRows, learningRows, tradeRows, lessons] = await Promise.all([
    query<RecommendationRow>(
      `SELECT id, symbol, COALESCE(market, 'forex') AS market, timeframe,
              strategy_id, direction, action, confidence, status, created_at
         FROM recommendations WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
      [userId, MAX_RECOMMENDATIONS],
    ),
    query<OutcomeRow>(
      `SELECT id, recommendation_id, outcome_type, r_multiple, pnl, holding_ms,
              mae, mfe, spread_cost, slippage, commission, risk_used, occurred_at
         FROM recommendation_outcomes WHERE user_id = ?
        ORDER BY occurred_at DESC, id DESC LIMIT ?`,
      [userId, MAX_OUTCOMES],
    ),
    query<LearningRow>(
      `SELECT event_id, recommendation_id, event_type, occurred_at
         FROM recommendation_learning_events WHERE user_id = ?
        ORDER BY occurred_at DESC, event_id DESC LIMIT ?`,
      [userId, MAX_EVENTS],
    ),
    query<TradeRow>(
      `SELECT t.id AS trade_id, i.recommendation_id, t.symbol, t.status, t.pnl,
              t.created_at, t.closed_at
         FROM trades t
         LEFT JOIN trade_intents i ON i.id = t.intent_id AND i.user_id = t.user_id
        WHERE t.user_id = ? ORDER BY t.id DESC LIMIT ?`,
      [userId, MAX_TRADES],
    ),
    listValidatedTradeLessons(userId, { limit: 100 }),
  ]);

  const recommendations: TradingDnaRecommendationEvidence[] = recommendationRows
    .map((row) => ({
      recommendationId: Number(row.id),
      symbol: row.symbol,
      market: row.market ?? "forex",
      timeframe: row.timeframe ?? "unknown",
      strategyId: row.strategy_id ?? "unspecified",
      direction: row.direction ?? row.action,
      confidence: Number(row.confidence),
      status: row.status,
      createdAt: timestamp(row.created_at),
    }))
    .filter((row) => inWindow(row.createdAt, options.fromMs, options.toMs))
    .sort((a, b) => a.createdAt - b.createdAt || a.recommendationId - b.recommendationId);
  const recommendationIds = new Set(recommendations.map((item) => item.recommendationId));

  const outcomes: TradingDnaOutcomeEvidence[] = outcomeRows
    .map((row) => ({
      outcomeId: Number(row.id),
      recommendationId: Number(row.recommendation_id),
      type: row.outcome_type,
      rMultiple: finite(row.r_multiple),
      pnl: finite(row.pnl),
      holdingMs: finite(row.holding_ms),
      mae: finite(row.mae),
      mfe: finite(row.mfe),
      spreadCost: finite(row.spread_cost),
      slippage: finite(row.slippage),
      commission: finite(row.commission),
      riskUsed: finite(row.risk_used),
      occurredAt: Number(row.occurred_at),
    }))
    .filter(
      (row) =>
        recommendationIds.has(row.recommendationId) &&
        inWindow(row.occurredAt, options.fromMs, options.toMs),
    )
    .sort((a, b) => a.occurredAt - b.occurredAt || a.outcomeId - b.outcomeId);

  const learningEvents: TradingDnaLearningEvidence[] = learningRows
    .map((row) => ({
      eventId: row.event_id,
      recommendationId: Number(row.recommendation_id),
      eventType: row.event_type,
      occurredAt: Number(row.occurred_at),
    }))
    .filter(
      (row) =>
        recommendationIds.has(row.recommendationId) &&
        inWindow(row.occurredAt, options.fromMs, options.toMs),
    )
    .sort((a, b) => a.occurredAt - b.occurredAt || a.eventId.localeCompare(b.eventId));

  const trades: TradingDnaTradeEvidence[] = tradeRows
    .map((row) => ({
      tradeId: Number(row.trade_id),
      recommendationId: row.recommendation_id == null ? undefined : Number(row.recommendation_id),
      symbol: row.symbol,
      status: row.status,
      pnl: Number(row.pnl),
      createdAt: timestamp(row.created_at),
      closedAt: row.closed_at == null ? undefined : timestamp(row.closed_at),
    }))
    .filter((row) => inWindow(row.createdAt, options.fromMs, options.toMs))
    .sort((a, b) => a.createdAt - b.createdAt || a.tradeId - b.tradeId);

  return {
    userId,
    collectedAt: options.now ?? Date.now(),
    recommendations,
    outcomes,
    learningEvents,
    trades,
    lessons: lessons.map((lesson) => ({
      lessonId: lesson.id,
      recommendationId: lesson.recommendationId,
      fingerprint: lesson.fingerprint,
      strategyId: lesson.strategyId,
      market: lesson.market,
      confidence: lesson.confidence,
      sampleSize: lesson.sampleSize,
      evidenceEventIds: lesson.evidenceEventIds,
    })),
    backtests: normalizeBacktests(userId, options.backtests),
  };
}
