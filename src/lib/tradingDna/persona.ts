import { mergeEvidence, normalizeEvidence, requireEvidence } from "./evidence";
import type {
  TradingDnaMetric,
  TradingDnaSnapshot,
  TradingPersonaName,
  TradingPersonaVersion,
} from "./types";

const MIN_PERSONA_SAMPLE = 5;

function metric(snapshot: TradingDnaSnapshot, key: TradingDnaMetric["key"]): TradingDnaMetric | undefined {
  return snapshot.metrics.find((item) => item.key === key && item.status === "supported");
}

function object(metricValue: TradingDnaMetric | undefined): Record<string, unknown> {
  return metricValue?.value && typeof metricValue.value === "object" && !Array.isArray(metricValue.value)
    ? metricValue.value
    : {};
}

function leading(metricValue: TradingDnaMetric | undefined): { key: string; share: number } | undefined {
  if (!metricValue || !Array.isArray(metricValue.value)) return undefined;
  const first = metricValue.value[0];
  if (!first || typeof first.key !== "string" || typeof first.share !== "number") return undefined;
  return { key: first.key, share: first.share };
}

function classify(input: {
  holdingHours?: number;
  timeframe?: { key: string; share: number };
  strategy?: { key: string; share: number };
}): { persona: TradingPersonaName; rationale: string; dominance: number } {
  const strategy = input.strategy;
  if (strategy && strategy.share >= 0.6) {
    if (/(mean|reversion|range)/i.test(strategy.key)) {
      return { persona: "mean_reversion", rationale: `Dominant evidenced strategy is ${strategy.key}.`, dominance: strategy.share };
    }
    if (/(trend|breakout|momentum)/i.test(strategy.key)) {
      return { persona: "trend", rationale: `Dominant evidenced strategy is ${strategy.key}.`, dominance: strategy.share };
    }
  }
  const hours = input.holdingHours;
  const timeframe = input.timeframe;
  if (hours != null && hours <= 4 && timeframe && /^(1m|5m|15m)$/.test(timeframe.key)) {
    return { persona: "scalper", rationale: `Recorded holding time and dominant ${timeframe.key} timeframe match short-duration behaviour.`, dominance: timeframe.share };
  }
  if (hours != null && hours <= 24) {
    return { persona: "intraday", rationale: "Recorded average holding time is within one day.", dominance: timeframe?.share ?? 0.5 };
  }
  if (hours != null && hours > 24) {
    return { persona: "swing", rationale: "Recorded average holding time exceeds one day.", dominance: timeframe?.share ?? 0.5 };
  }
  if (strategy && timeframe && strategy.share < 0.6 && timeframe.share < 0.6) {
    return { persona: "hybrid", rationale: "No single evidenced strategy or timeframe exceeds the dominance gate.", dominance: Math.max(strategy.share, timeframe.share) };
  }
  return { persona: "unclassified", rationale: "The evidence does not satisfy a supported persona rule.", dominance: 0 };
}

export function deriveTradingPersona(
  snapshot: TradingDnaSnapshot,
  input: { personaId: string; version: number; createdAt?: number },
): TradingPersonaVersion {
  const holding = metric(snapshot, "average_holding_time");
  const timeframe = metric(snapshot, "preferred_timeframes");
  const strategy = metric(snapshot, "preferred_strategies");
  const evidence = mergeEvidence(
    holding?.evidence ?? normalizeEvidence({}),
    timeframe?.evidence ?? normalizeEvidence({}),
    strategy?.evidence ?? normalizeEvidence({}),
  );
  const sampleSize = Math.max(holding?.sampleSize ?? 0, timeframe?.sampleSize ?? 0, strategy?.sampleSize ?? 0);
  const holdingAverage = object(holding).average;
  const classification = sampleSize >= MIN_PERSONA_SAMPLE
    ? classify({
        holdingHours: typeof holdingAverage === "number" ? holdingAverage / 3_600_000 : undefined,
        timeframe: leading(timeframe),
        strategy: leading(strategy),
      })
    : { persona: "unclassified" as const, rationale: `Fewer than ${MIN_PERSONA_SAMPLE} supported observations.`, dominance: 0 };
  if (classification.persona !== "unclassified") requireEvidence(evidence, "Trading persona");
  return {
    personaId: input.personaId,
    userId: snapshot.userId,
    version: input.version,
    snapshotId: snapshot.snapshotId,
    persona: classification.persona,
    confidence:
      classification.persona === "unclassified"
        ? 0
        : Math.round(
            Math.min(1, classification.dominance * Math.max(holding?.confidence ?? 0, timeframe?.confidence ?? 0, strategy?.confidence ?? 0)) * 10_000,
          ) / 10_000,
    sampleSize,
    rationale: classification.rationale,
    evidence,
    createdAt: input.createdAt ?? Date.now(),
  };
}
