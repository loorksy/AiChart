/**
 * The bridge from a live analysis to the historical case memory.
 *
 * The decision path holds candles and a geometry snapshot; the memory speaks
 * fingerprints. This turns one into the other and asks the question, keeping the
 * orchestrator free of the memory's internals.
 *
 * Failure is silence, never an exception: the memory is one piece of evidence
 * among many, and a thin or missing index must degrade the read rather than stop
 * the analysis. That is the same rule the visual evidence follows.
 */
import { createLogger } from "@/lib/logger";
import type { GeometrySnapshot } from "@/lib/chart/geometry";
import { fingerprintAt, type FingerprintCandle } from "./caseFingerprint";
import { collectCaseEvidence, type HistoricalCaseEvidence } from "./caseQuery";

const log = createLogger("marketMemory:live");

/**
 * Describe the current moment and ask what followed moments like it.
 *
 * The fingerprint comes from the candles as they are — the same function the
 * indexer uses, so a live moment and a stored one are described by identical
 * code. If they ever diverge, the similarity numbers become meaningless, which
 * is why there is only one implementation of it.
 */
export async function collectCaseEvidenceFor(input: {
  symbol: string;
  interval: string;
  candles: readonly FingerprintCandle[];
  geometry?: GeometrySnapshot | null;
}): Promise<HistoricalCaseEvidence | null> {
  const fingerprint = fingerprintAt(input.candles);
  if (!fingerprint) return null;

  const patternName = input.geometry?.patterns?.[0]?.patternType ?? null;
  try {
    return await collectCaseEvidence({
      symbol: input.symbol,
      interval: input.interval,
      fingerprint,
      patternName,
    });
  } catch (err) {
    log.warn("case memory lookup failed", {
      symbol: input.symbol,
      interval: input.interval,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
