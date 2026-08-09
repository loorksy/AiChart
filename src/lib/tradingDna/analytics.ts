import { getPersonaForSnapshot, listTradingDnaSnapshots } from "./repository";
import type { TradingDnaMetric, TradingDnaSnapshot } from "./types";

function metric(snapshot: TradingDnaSnapshot, key: TradingDnaMetric["key"]): TradingDnaMetric | undefined {
  return snapshot.metrics.find((item) => item.key === key && item.status === "supported");
}

function record(metricValue: TradingDnaMetric | undefined): Record<string, unknown> {
  return metricValue?.value && typeof metricValue.value === "object" && !Array.isArray(metricValue.value)
    ? metricValue.value
    : {};
}

function top(metricValue: TradingDnaMetric | undefined): string | undefined {
  if (!metricValue || !Array.isArray(metricValue.value)) return undefined;
  return typeof metricValue.value[0]?.key === "string" ? metricValue.value[0].key : undefined;
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function computeTradingDnaAnalytics(userId: number) {
  const snapshots = await listTradingDnaSnapshots(userId, 500);
  const points = await Promise.all(
    snapshots.map(async (snapshot) => {
      const persona = await getPersonaForSnapshot(userId, snapshot.snapshotId);
      return {
        snapshotId: snapshot.snapshotId,
        version: snapshot.version,
        generatedAt: snapshot.generatedAt,
        month: new Date(snapshot.generatedAt).toISOString().slice(0, 7),
        averageR: numeric(record(metric(snapshot, "average_r")).average),
        winRate: numeric(record(metric(snapshot, "win_loss_behavior")).winRate),
        confidenceError: numeric(record(metric(snapshot, "confidence_calibration")).meanAbsoluteError),
        maximumDrawdown: numeric(record(metric(snapshot, "drawdown_recovery")).maximumDrawdown),
        averageRisk: numeric(record(metric(snapshot, "risk_tolerance")).average),
        symbol: top(metric(snapshot, "preferred_symbols")),
        timeframe: top(metric(snapshot, "preferred_timeframes")),
        strategy: top(metric(snapshot, "preferred_strategies")),
        persona: persona?.persona,
        personaConfidence: persona?.confidence,
      };
    }),
  );
  return {
    behaviourOverTime: points.map((point) => ({ generatedAt: point.generatedAt, averageR: point.averageR, winRate: point.winRate })),
    strategyEvolution: points.map((point) => ({ generatedAt: point.generatedAt, strategy: point.strategy, persona: point.persona })),
    confidenceEvolution: points.map((point) => ({ generatedAt: point.generatedAt, calibrationError: point.confidenceError, personaConfidence: point.personaConfidence })),
    drawdownEvolution: points.map((point) => ({ generatedAt: point.generatedAt, maximumDrawdown: point.maximumDrawdown })),
    riskEvolution: points.map((point) => ({ generatedAt: point.generatedAt, averageRisk: point.averageRisk })),
    symbolEvolution: points.map((point) => ({ generatedAt: point.generatedAt, symbol: point.symbol })),
    timeframeEvolution: points.map((point) => ({ generatedAt: point.generatedAt, timeframe: point.timeframe })),
    monthlyEvolution: points.map((point) => ({ month: point.month, snapshotVersion: point.version, averageR: point.averageR, winRate: point.winRate })),
  };
}
