/**
 * Chart images for the decision engine (docs/UNIFIED_AGENT_PLAN.md §9).
 *
 * The MCP agent has always looked at real charts while the platform's engine
 * read a JSON summary of the same market. Two ways of seeing produce two
 * answers, and the plan's whole premise is one mind on both surfaces — so this
 * fetches the same multi-timeframe capture the MCP tool uses and hands it to
 * the decision call in the same interleaved form.
 *
 * Best-effort by contract. Capture depends on the operator's MT5 or a rendering
 * service, and neither is worth blocking a decision on: a missing view degrades
 * the read, and the model is told which view it did not get.
 */
import { captureMultiTimeframeSnapshot } from "@/lib/chart/multiTimeframeCapture";
import { createLogger } from "@/lib/logger";
import type { VisualSnapshot } from "./agents/finalDecisionSynthesizer";

const log = createLogger("visual-evidence");

/**
 * Which timeframes to show, given the one being analysed.
 *
 * A scalp needs its own frame plus the two above it — enough to see where the
 * entry sits inside the structure that governs it, without spending the budget
 * on charts nobody will weigh.
 */
export function visualTimeframesFor(interval: string): string[] {
  const tf = (interval ?? "").toLowerCase().trim();
  switch (tf) {
    case "1m":
      return ["1m", "5m", "15m"];
    case "5m":
      return ["5m", "15m", "1h"];
    case "15m":
      return ["15m", "1h", "4h"];
    case "30m":
    case "1h":
      return ["1h", "4h", "1d"];
    case "4h":
      return ["4h", "1d", "1w"];
    case "1d":
    case "d":
      // A daily analysis needs daily-and-above context, not intraday noise —
      // the old fallthrough handed it 15m/1h/4h frames.
      return ["1d", "1w", "4h"];
    case "1w":
    case "w":
      return ["1w", "1d"];
    default:
      return ["15m", "1h", "4h"];
  }
}

export interface VisualEvidenceResult {
  snapshots: VisualSnapshot[];
  /** Views we asked for and did not get — reported, never implied away. */
  missing: { timeframe: string; reason: string }[];
  elapsedMs: number;
}

/**
 * Capture the charts for one analysis.
 *
 * Never throws: an outright failure returns empty evidence and the decision
 * proceeds on numbers alone, exactly as it did before this existed.
 */
export async function collectVisualEvidence(input: {
  userId?: number;
  symbol: string;
  interval: string;
  maxImages?: number;
  timeoutMs?: number;
  /** Override the default timeframe set — used by the extra-frame round. */
  timeframes?: string[];
}): Promise<VisualEvidenceResult> {
  const startedAt = Date.now();
  if (input.userId == null) {
    return { snapshots: [], missing: [], elapsedMs: 0 };
  }

  try {
    const result = await captureMultiTimeframeSnapshot(input.userId, {
      symbol: input.symbol,
      timeframes: input.timeframes ?? visualTimeframesFor(input.interval),
      maxImages: input.maxImages ?? 3,
      imageTimeoutMs: input.timeoutMs,
      includeNumericContext: true,
    });

    const snapshots: VisualSnapshot[] = result.snapshots
      .filter((snapshot) => Boolean(snapshot.image_base64))
      .map((snapshot) => ({
        timeframe: snapshot.timeframe,
        imageBase64: snapshot.image_base64,
        numericContext: snapshot.numeric_context,
      }));

    log.debug("visual.captured", {
      symbol: input.symbol,
      captured: snapshots.length,
      missing: result.missing_timeframes.length,
      elapsedMs: result.elapsed_ms,
    });

    return {
      snapshots,
      missing: result.missing_timeframes,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    log.warn("visual.capture.failed", {
      symbol: input.symbol,
      error: error instanceof Error ? error.name : "unknown",
    });
    return { snapshots: [], missing: [], elapsedMs: Date.now() - startedAt };
  }
}
