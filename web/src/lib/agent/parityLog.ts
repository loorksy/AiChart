/**
 * Platform-vs-MCP decision parity (plan §16, completion criterion 2).
 *
 * The criterion is "the two surfaces use the same brain, and the count of
 * UNEXPLAINED differences is zero". Contract tests cannot establish that: they
 * prove the two surfaces accept the same shapes, not that they reach the same
 * conclusion on the same evidence. This records actual decisions and compares
 * them.
 *
 * The distinction that makes the log useful is EXPLAINED versus UNEXPLAINED. Two
 * surfaces will differ constantly for legitimate reasons — one read the market a
 * second later, one had a chart image the other could not capture, one had no
 * calendar provider configured. None of those is an architectural problem. What
 * matters is a difference with no such cause, because that means the surfaces are
 * not actually running the same decision path.
 *
 * The load-bearing rule: two decisions are only comparable when they were made on
 * the SAME evidence. Different evidence hash means different inputs, and calling
 * those "identical" or "divergent" is meaningless either way — so it is its own
 * classification and never counts as unexplained.
 */
import { execute, query } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { metrics } from "@/lib/metrics";

const log = createLogger("agent:parity");

export type DecisionSurface = "platform" | "mcp";

/** Why two decisions on one moment differ. */
export type DifferenceClass =
  /** Not the same inputs — not comparable, and not a problem. */
  | "different_evidence_hash"
  /** Same setup, read seconds apart. */
  | "different_market_timestamp"
  /** One surface saw a chart the other could not capture. */
  | "missing_image"
  /** A data provider was configured on one side only. */
  | "missing_provider"
  /** Same inputs, same contract — the model simply chose differently. */
  | "model_nondeterminism"
  /** One surface produced a shape the other cannot: a real defect. */
  | "contract_mismatch"
  /** Same evidence, same contract, no known cause. The number that must be zero. */
  | "unexplained";

/** A decision as recorded for comparison. Only the fields parity is about. */
export interface ParityDecision {
  direction: "buy" | "sell" | null;
  planType: string | null;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  targets: number[];
  executionState: string | null;
  /** True when the surface returned an operational blocker instead of a plan. */
  blocked?: boolean;
  /** Timeframes the surface actually had images for. */
  imagesFor?: string[];
  /** Evidence providers that answered on this surface. */
  providers?: string[];
}

export interface ParityObservation {
  evidenceHash: string;
  symbol: string;
  /** Timeframes in the bundle, so a partial capture is visible. */
  timeframeSet: string[];
  /** Latest candle time the surface decided on. */
  marketTimestamp: number;
  surface: DecisionSurface;
  decision: ParityDecision;
  createdAt?: number;
}

/**
 * Record one surface's decision.
 *
 * Best-effort: a parity write is diagnostics, and losing one must never affect
 * the decision the operator just received.
 */
export async function recordDecisionForParity(
  observation: ParityObservation,
): Promise<void> {
  await execute(
    `INSERT INTO decision_parity
       (evidence_hash, symbol, timeframe_set, market_timestamp, surface,
        decision_json, created_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (evidence_hash, surface) DO UPDATE SET
       decision_json = excluded.decision_json,
       market_timestamp = excluded.market_timestamp,
       timeframe_set = excluded.timeframe_set`,
    [
      observation.evidenceHash,
      observation.symbol,
      JSON.stringify(observation.timeframeSet),
      observation.marketTimestamp,
      observation.surface,
      JSON.stringify(observation.decision),
      observation.createdAt ?? Date.now(),
    ],
  ).catch((error: unknown) => {
    log.warn("failed to record parity observation", {
      symbol: observation.symbol,
      surface: observation.surface,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/** Price equality at instrument scale — a float artefact is not a divergence. */
function samePrice(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= scale * 1e-6;
}

/** Which plan fields the two surfaces disagree on. */
export function decisionDifferences(
  a: ParityDecision,
  b: ParityDecision,
): string[] {
  const fields: string[] = [];
  if (a.direction !== b.direction) fields.push("direction");
  if ((a.planType ?? null) !== (b.planType ?? null)) fields.push("plan_type");
  if (!samePrice(a.entryLow, b.entryLow)) fields.push("entry_low");
  if (!samePrice(a.entryHigh, b.entryHigh)) fields.push("entry_high");
  if (!samePrice(a.stopLoss, b.stopLoss)) fields.push("stop_loss");
  if (
    a.targets.length !== b.targets.length ||
    a.targets.some((value, index) => !samePrice(value, b.targets[index] ?? null))
  ) {
    fields.push("targets");
  }
  if ((a.executionState ?? null) !== (b.executionState ?? null)) {
    fields.push("execution_state");
  }
  return fields;
}

export interface ParityComparison {
  identical: boolean;
  differingFields: string[];
  classification: DifferenceClass | null;
  explanation: string;
  /** True when the difference has a known cause. Null classification → true. */
  explained: boolean;
}

/**
 * Milliseconds of read-time difference that explains a divergence by itself.
 *
 * A scalping decision on a 5m chart genuinely changes when the read is a minute
 * apart, so beyond this the timestamp is a sufficient explanation.
 */
const TIMESTAMP_TOLERANCE_MS = 60_000;

/**
 * Compare two surfaces' decisions on the same moment.
 *
 * Order of checks matters and is deliberate: comparability first, then the
 * legitimate environmental causes, then the two that are real findings.
 */
export function compareDecisions(input: {
  platform: ParityObservation;
  mcp: ParityObservation;
}): ParityComparison {
  const { platform, mcp } = input;

  // Comparability before comparison. Different evidence means different inputs,
  // and "identical" would be a coincidence while "divergent" would be a
  // misattribution — so this is neither, and never unexplained.
  if (platform.evidenceHash !== mcp.evidenceHash) {
    return {
      identical: false,
      differingFields: [],
      classification: "different_evidence_hash",
      explanation:
        "القراران بُنيا على حزمتَي أدلة مختلفتين — غير قابلين للمقارنة، وهذا ليس اختلافاً في القرار.",
      explained: true,
    };
  }

  const differingFields = decisionDifferences(platform.decision, mcp.decision);
  if (!differingFields.length) {
    return {
      identical: true,
      differingFields: [],
      classification: null,
      explanation: "القرارَان متطابقان على نفس الأدلة.",
      explained: true,
    };
  }

  // One side could not produce a plan at all. That is a shape difference, and a
  // real one: the surfaces should agree on whether a decision was possible.
  if (Boolean(platform.decision.blocked) !== Boolean(mcp.decision.blocked)) {
    return {
      identical: false,
      differingFields,
      classification: "contract_mismatch",
      explanation:
        "سطح واحد أصدر عائقاً تشغيلياً والآخر أصدر خطة على نفس الأدلة — فرق في العقد لا في الرأي.",
      explained: false,
    };
  }

  const timeGap = Math.abs(platform.marketTimestamp - mcp.marketTimestamp);
  if (timeGap > TIMESTAMP_TOLERANCE_MS) {
    return {
      identical: false,
      differingFields,
      classification: "different_market_timestamp",
      explanation: `القراءتان تفصلهما ${Math.round(timeGap / 1000)} ثانية — السوق تحرّك بينهما.`,
      explained: true,
    };
  }

  const platformImages = new Set(platform.decision.imagesFor ?? []);
  const mcpImages = new Set(mcp.decision.imagesFor ?? []);
  if (platformImages.size !== mcpImages.size) {
    return {
      identical: false,
      differingFields,
      classification: "missing_image",
      explanation:
        "أحد السطحين رأى لقطات شارت لم يرها الآخر — التقاط جزئي يفسّر الفرق.",
      explained: true,
    };
  }

  const platformProviders = new Set(platform.decision.providers ?? []);
  const mcpProviders = new Set(mcp.decision.providers ?? []);
  const providerGap = [...platformProviders].some((p) => !mcpProviders.has(p)) ||
    [...mcpProviders].some((p) => !platformProviders.has(p));
  if (providerGap) {
    return {
      identical: false,
      differingFields,
      classification: "missing_provider",
      explanation: "مزوّد أدلة كان متاحاً على سطح واحد فقط.",
      explained: true,
    };
  }

  // Same evidence, same shape, same providers, same moment. If only the numbers
  // moved slightly the model chose differently; if the DIRECTION differs, the two
  // surfaces are not running the same decision path and that is the finding this
  // whole log exists to surface.
  if (differingFields.length === 1 && differingFields[0] !== "direction") {
    return {
      identical: false,
      differingFields,
      classification: "model_nondeterminism",
      explanation: `نفس الأدلة ونفس العقد؛ اختلف ${differingFields[0]} فقط — تشتّت طبيعي في النموذج.`,
      explained: true,
    };
  }

  return {
    identical: false,
    differingFields,
    classification: "unexplained",
    explanation:
      "نفس الأدلة ونفس اللحظة ونفس المزوّدين، والقرار مختلف بلا سبب معروف — هذا ما يجب أن يكون صفراً.",
    explained: false,
  };
}

interface ParityRow {
  evidence_hash: string;
  symbol: string;
  timeframe_set: string;
  market_timestamp: number | string;
  surface: string;
  decision_json: string;
  created_at: number | string;
}

function toObservation(row: ParityRow): ParityObservation {
  const parse = <T>(text: string, fallback: T): T => {
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  };
  return {
    evidenceHash: row.evidence_hash,
    symbol: row.symbol,
    timeframeSet: parse<string[]>(row.timeframe_set, []),
    marketTimestamp: Number(row.market_timestamp),
    surface: row.surface === "mcp" ? "mcp" : "platform",
    decision: parse<ParityDecision>(row.decision_json, {
      direction: null,
      planType: null,
      entryLow: null,
      entryHigh: null,
      stopLoss: null,
      targets: [],
      executionState: null,
    }),
    createdAt: Number(row.created_at),
  };
}

export interface ParityReportEntry {
  evidenceHash: string;
  symbol: string;
  timeframeSet: string[];
  platform: ParityDecision;
  mcp: ParityDecision;
  comparison: ParityComparison;
  createdAt: number;
}

export interface ParityReport {
  /** Moments where both surfaces decided, newest first. */
  entries: ParityReportEntry[];
  totals: {
    compared: number;
    identical: number;
    differing: number;
    unexplained: number;
    byClassification: Record<string, number>;
  };
  /** Moments where only one surface decided — nothing to compare. */
  unpaired: number;
}

/**
 * Build the report.
 *
 * Only moments where BOTH surfaces recorded a decision are compared; a moment one
 * surface never saw is counted as unpaired rather than silently treated as
 * agreement.
 */
export async function buildParityReport(limit = 200): Promise<ParityReport> {
  const rows = await query<ParityRow>(
    `SELECT evidence_hash, symbol, timeframe_set, market_timestamp, surface,
            decision_json, created_at
       FROM decision_parity
      ORDER BY created_at DESC
      LIMIT ?`,
    [Math.max(2, Math.min(limit * 2, 2000))],
  ).catch(() => []);

  const bySurfacePair = new Map<string, { platform?: ParityObservation; mcp?: ParityObservation }>();
  for (const row of rows) {
    const observation = toObservation(row);
    const pair = bySurfacePair.get(observation.evidenceHash) ?? {};
    pair[observation.surface] = observation;
    bySurfacePair.set(observation.evidenceHash, pair);
  }

  const entries: ParityReportEntry[] = [];
  const byClassification: Record<string, number> = {};
  let identical = 0;
  let unexplained = 0;
  let unpaired = 0;

  for (const pair of bySurfacePair.values()) {
    if (!pair.platform || !pair.mcp) {
      unpaired += 1;
      continue;
    }
    const comparison = compareDecisions({ platform: pair.platform, mcp: pair.mcp });
    if (comparison.identical) identical += 1;
    if (comparison.classification) {
      byClassification[comparison.classification] =
        (byClassification[comparison.classification] ?? 0) + 1;
    }
    if (!comparison.explained) unexplained += 1;
    entries.push({
      evidenceHash: pair.platform.evidenceHash,
      symbol: pair.platform.symbol,
      timeframeSet: pair.platform.timeframeSet,
      platform: pair.platform.decision,
      mcp: pair.mcp.decision,
      comparison,
      createdAt: Math.max(pair.platform.createdAt ?? 0, pair.mcp.createdAt ?? 0),
    });
  }

  entries.sort((a, b) => b.createdAt - a.createdAt);
  const compared = entries.length;

  metrics.parityComparisons.set(compared);
  metrics.parityUnexplained.set(unexplained);

  return {
    entries: entries.slice(0, limit),
    totals: {
      compared,
      identical,
      differing: compared - identical,
      unexplained,
      byClassification,
    },
    unpaired,
  };
}
