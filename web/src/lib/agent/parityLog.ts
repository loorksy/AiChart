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
  /**
   * The operator this decision belongs to. Parity is per-user: two different
   * operators deciding on the same candle is coincidence, not a pair. Optional
   * only for legacy callers; unscoped observations never pair.
   */
  userId?: number | null;
  evidenceHash: string;
  /**
   * What makes two surfaces comparable: the same instrument, timeframe and
   * closed candle. Derived, not hashed from the bundle — see parityKeyFor.
   */
  parityKey?: string;
  /** The interval the decision was made on; part of the parity key. */
  interval?: string;
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
 * The identity of a DECISION MOMENT, shared by every surface that looks at it.
 *
 * Symbol, interval and the closed candle the surface decided on — nothing that
 * varies per run. Two surfaces analysing the same instrument on the same closed
 * candle are exactly the pair parity exists to compare; anything finer (the
 * evidence hash) can never match, and anything coarser would compare decisions
 * made about different market states.
 */
/** Candle length in ms for the intervals the agent decides on. */
const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

/**
 * The decision moment, floored to its candle.
 *
 * Two surfaces are comparable when they decided on the same instrument,
 * timeframe and candle — but they arrive at "the candle" differently: the
 * platform takes the last bar of the series it fetched (often the forming one),
 * while a bridge caller reads the last CLOSED bar from the warehouse. Measured
 * in production, that made two decisions 40 seconds apart key to candles 15
 * minutes apart, so no pair could ever form and the comparison table stayed
 * empty. Flooring to the candle boundary makes both descriptions agree.
 */
export function parityKeyFor(input: {
  symbol: string;
  interval?: string;
  marketTimestamp: number;
}): string {
  const interval = (input.interval ?? "unspecified").toLowerCase();
  const span = INTERVAL_MS[interval];
  const raw = Math.trunc(input.marketTimestamp);
  const bucket = span && span > 0 ? Math.floor(raw / span) * span : raw;
  return [input.symbol.toUpperCase(), interval, bucket].join("|");
}

function parityKeyOf(observation: ParityObservation): string {
  return observation.parityKey ?? parityKeyFor(observation);
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
  try {
    await execute(
      `INSERT INTO decision_parity
         (evidence_hash, symbol, timeframe_set, market_timestamp, surface,
          decision_json, created_at, parity_key, user_id)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT (evidence_hash, surface) DO UPDATE SET
         decision_json = excluded.decision_json,
         market_timestamp = excluded.market_timestamp,
         timeframe_set = excluded.timeframe_set,
         symbol = excluded.symbol,
         created_at = excluded.created_at,
         parity_key = excluded.parity_key,
         user_id = excluded.user_id`,
      [
        observation.evidenceHash,
        observation.symbol,
        JSON.stringify(observation.timeframeSet),
        observation.marketTimestamp,
        observation.surface,
        JSON.stringify(observation.decision),
        observation.createdAt ?? Date.now(),
        parityKeyOf(observation),
        observation.userId ?? null,
      ],
    );
    // The first observation remains unpaired. Whichever surface arrives second
    // atomically materializes the durable comparison used by diagnostics.
    await materializeParityComparison(parityKeyOf(observation), observation.userId ?? null);
  } catch (error: unknown) {
    log.warn("failed to record parity observation", {
      symbol: observation.symbol,
      surface: observation.surface,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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

  // Comparability is the PARITY KEY — same instrument, timeframe, candle —
  // which the caller already joined on. The evidence hashes are fingerprints
  // of each surface's own frozen bundle and are EXPECTED to differ (the
  // platform's embeds per-run chart images; the MCP plan has no bundle at
  // all). Short-circuiting on hash inequality classified every pair as
  // not-comparable, which made the whole comparison vacuous: zero rows could
  // ever say anything. A hash mismatch is context, never a blocker.

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
  const imageGap =
    platformImages.size !== mcpImages.size ||
    [...platformImages].some((timeframe) => !mcpImages.has(timeframe));
  if (imageGap) {
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

/**
 * Persist the comparison itself, not only its two inputs.
 *
 * The JSON columns named after decision fields intentionally contain
 * `{ platform, mcp }`: retaining both values makes an entry-zone or direction
 * divergence inspectable without reconstructing it from application logs.
 */
async function materializeParityComparison(
  parityKey: string,
  userId: number | null,
  updateMetrics = true,
): Promise<void> {
  // Unscoped observations never pair — cross-operator "parity" is coincidence.
  if (userId == null) return;
  // Joined on the PARITY KEY, not the evidence hash. The hash covers a snapshot
  // embedding live candles, the live spread and per-run chart images, so two
  // surfaces never shared one — every request bailed below and the comparisons
  // table stayed permanently empty while the dashboard reported "all zero".
  const rows = await query<ParityRow>(
    `SELECT evidence_hash, parity_key, symbol, timeframe_set, market_timestamp, surface,
            decision_json, created_at
       FROM decision_parity
      WHERE parity_key = ? AND user_id = ?
      ORDER BY created_at DESC`,
    [parityKey, userId],
  );
  const observations = rows.map(toObservation);
  const platform = observations.find((item) => item.surface === "platform");
  const mcp = observations.find((item) => item.surface === "mcp");
  if (!platform || !mcp) return;

  const comparison = compareDecisions({ platform, mcp });
  const paired = (platformValue: unknown, mcpValue: unknown) =>
    JSON.stringify({ platform: platformValue, mcp: mcpValue });
  const createdAt = Math.max(platform.createdAt ?? 0, mcp.createdAt ?? 0);

  await execute(
    `INSERT INTO decision_parity_comparisons
       (evidence_hash, symbol, timeframe_set, market_timestamp,
        platform_decision, mcp_decision, direction, plan_type, entry_zone,
        stop, targets, execution_state, difference_classification, explained,
        explanation, created_at, user_id, parity_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (user_id, parity_key) WHERE user_id IS NOT NULL AND parity_key IS NOT NULL DO UPDATE SET
       evidence_hash = excluded.evidence_hash,
       symbol = excluded.symbol,
       timeframe_set = excluded.timeframe_set,
       market_timestamp = excluded.market_timestamp,
       platform_decision = excluded.platform_decision,
       mcp_decision = excluded.mcp_decision,
       direction = excluded.direction,
       plan_type = excluded.plan_type,
       entry_zone = excluded.entry_zone,
       stop = excluded.stop,
       targets = excluded.targets,
       execution_state = excluded.execution_state,
       difference_classification = excluded.difference_classification,
       explained = excluded.explained,
       explanation = excluded.explanation,
       created_at = excluded.created_at`,
    [
      // The pair is identified by the parity key; this column keeps the
      // platform-side bundle hash as the audit pointer into the snapshot that
      // was compared.
      platform.evidenceHash,
      platform.symbol,
      JSON.stringify(platform.timeframeSet),
      Math.max(platform.marketTimestamp, mcp.marketTimestamp),
      JSON.stringify(platform.decision),
      JSON.stringify(mcp.decision),
      paired(platform.decision.direction, mcp.decision.direction),
      paired(platform.decision.planType, mcp.decision.planType),
      paired(
        { low: platform.decision.entryLow, high: platform.decision.entryHigh },
        { low: mcp.decision.entryLow, high: mcp.decision.entryHigh },
      ),
      paired(platform.decision.stopLoss, mcp.decision.stopLoss),
      paired(platform.decision.targets, mcp.decision.targets),
      paired(platform.decision.executionState, mcp.decision.executionState),
      comparison.classification,
      comparison.explained ? 1 : 0,
      comparison.explanation,
      createdAt,
      userId,
      parityKey,
    ],
  );
  if (updateMetrics) await refreshParityMetrics();
}

async function refreshParityMetrics(): Promise<void> {
  const rows = await query<{
    compared: number | string;
    differing: number | string;
    unexplained: number | string;
  }>(
    `SELECT COUNT(*) AS compared,
            SUM(CASE WHEN difference_classification IS NOT NULL THEN 1 ELSE 0 END)
              AS differing,
            SUM(CASE WHEN difference_classification = 'unexplained' THEN 1 ELSE 0 END)
              AS unexplained
       FROM decision_parity_comparisons`,
  ).catch(() => []);
  const row = rows[0];
  metrics.parityComparisons.set(Number(row?.compared ?? 0));
  metrics.parityDifferences?.set(Number(row?.differing ?? 0));
  metrics.parityUnexplained.set(Number(row?.unexplained ?? 0));
}

interface ParityRow {
  evidence_hash: string;
  parity_key: string | null;
  symbol: string;
  timeframe_set: string;
  market_timestamp: number | string;
  surface: string;
  decision_json: string;
  created_at: number | string;
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function toObservation(row: ParityRow): ParityObservation {
  return {
    evidenceHash: row.evidence_hash,
    parityKey: row.parity_key ?? undefined,
    symbol: row.symbol,
    timeframeSet: parseJson<string[]>(row.timeframe_set, []),
    marketTimestamp: Number(row.market_timestamp),
    surface: row.surface === "mcp" ? "mcp" : "platform",
    decision: parseJson<ParityDecision>(row.decision_json, {
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
  marketTimestamp: number;
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
 * Reads materialized comparisons. Only moments where BOTH surfaces recorded a
 * decision reach this table; a moment one surface never saw is counted as
 * unpaired rather than silently treated as agreement.
 */
export async function buildParityReport(limit = 200): Promise<ParityReport> {
  interface ComparisonRow {
    evidence_hash: string;
    symbol: string;
    timeframe_set: string;
    market_timestamp: number | string;
    platform_decision: string;
    mcp_decision: string;
    difference_classification: string | null;
    explained: number | string | boolean;
    explanation: string;
    created_at: number | string;
  }
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  // Additive schema upgrade: preserve comparable observations written before
  // the durable comparison table existed.
  const legacyPairs = await query<{ parity_key: string; user_id: number | null }>(
    `SELECT d.parity_key, d.user_id
       FROM decision_parity d
      WHERE d.parity_key IS NOT NULL
        AND d.user_id IS NOT NULL
        AND NOT EXISTS (
        SELECT 1 FROM decision_parity_comparisons c
         WHERE c.parity_key = d.parity_key AND c.user_id = d.user_id
      )
      GROUP BY d.parity_key, d.user_id
     HAVING COUNT(DISTINCT d.surface) = 2
      LIMIT ?`,
    [boundedLimit],
  ).catch(() => []);
  for (const pair of legacyPairs) {
    await materializeParityComparison(pair.parity_key, pair.user_id, false).catch(() => {});
  }
  if (legacyPairs.length) await refreshParityMetrics();

  const [rows, countRows, unpairedRows] = await Promise.all([
    query<ComparisonRow>(
      `SELECT evidence_hash, symbol, timeframe_set, market_timestamp,
              platform_decision, mcp_decision, difference_classification,
              explained, explanation, created_at
         FROM decision_parity_comparisons
        ORDER BY created_at DESC
        LIMIT ?`,
      [boundedLimit],
    ).catch(() => []),
    query<{ classification: string | null; count: number | string }>(
      `SELECT difference_classification AS classification, COUNT(*) AS count
         FROM decision_parity_comparisons
        GROUP BY difference_classification`,
    ).catch(() => []),
    query<{ count: number | string }>(
      `SELECT COUNT(*) AS count
         FROM (
           -- A moment is unpaired when only one surface decided on that candle.
           -- Grouping by evidence_hash counted every observation as unpaired
           -- forever, because hashes are per-surface fingerprints that never
           -- collide by construction.
           SELECT parity_key
             FROM decision_parity
            WHERE parity_key IS NOT NULL
            GROUP BY parity_key
           HAVING COUNT(DISTINCT surface) < 2
         ) AS unpaired_observations`,
    ).catch(() => []),
  ]);

  const emptyDecision: ParityDecision = {
    direction: null,
    planType: null,
    entryLow: null,
    entryHigh: null,
    stopLoss: null,
    targets: [],
    executionState: null,
  };
  const entries = rows.map<ParityReportEntry>((row) => {
    const platform = parseJson<ParityDecision>(row.platform_decision, emptyDecision);
    const mcp = parseJson<ParityDecision>(row.mcp_decision, emptyDecision);
    const differingFields = decisionDifferences(platform, mcp);
    const classification = (
      row.difference_classification || null
    ) as DifferenceClass | null;
    return {
      evidenceHash: row.evidence_hash,
      symbol: row.symbol,
      timeframeSet: parseJson<string[]>(row.timeframe_set, []),
      marketTimestamp: Number(row.market_timestamp),
      platform,
      mcp,
      comparison: {
        identical: classification == null && differingFields.length === 0,
        differingFields,
        classification,
        explained: Number(row.explained) === 1 || row.explained === true,
        explanation: row.explanation,
      },
      createdAt: Number(row.created_at),
    };
  });

  const byClassification: Record<string, number> = {};
  let compared = 0;
  let identical = 0;
  for (const row of countRows) {
    const count = Number(row.count);
    compared += count;
    if (row.classification == null) {
      identical += count;
    } else {
      byClassification[row.classification] = count;
    }
  }
  const unexplained = byClassification.unexplained ?? 0;
  const unpaired = Number(unpairedRows[0]?.count ?? 0);

  metrics.parityComparisons.set(compared);
  metrics.parityDifferences?.set(compared - identical);
  metrics.parityUnexplained.set(unexplained);

  return {
    entries,
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
