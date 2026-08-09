/**
 * Persistence for the Quant Agent's LLM trading analyses (Wave 1). Own file
 * under `lib/quantAgent/` — NOT `lib/store.ts` (Lonora-scoped) — same
 * isolation principle as `monitorStore.ts` and `watchlistStore.ts`.
 *
 * This is the second engine's ONLY write target. It never touches
 * `recommendations`, `recommendation_revisions`, or any lifecycle table: an
 * analysis is a report a user asked for, not a plan the platform stands
 * behind, and conflating the two is exactly what the single-brain rule
 * forbids.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/services/analysis_memory.py` (`qd_analysis_memory`
 * store/list/delete). What changed: the async pending-task lifecycle
 * (`create_pending_task` → `finalize_pending_task` → the duplicate-row delete
 * in `fast_analysis_tasks.py:125-128`) is not ported — this store writes the
 * row exactly once, at the end of the run, so there is no double-write to
 * reconcile. The outcome-validation columns (`validated_at`, `was_correct`,
 * `actual_return_pct`) are also absent: nothing in Wave 1 revisits an analysis
 * to score it, and a column no writer fills is a promise the product does not
 * keep. Listing is keyset-paginated and strictly user-scoped, where upstream's
 * `/history` endpoint was not scoped by user at all.
 *
 * WAVE 2 added the half Wave 1 left out: `indicators_json` (the fingerprint the
 * similar-pattern scorer compares against) and the outcome columns
 * (`validated_at`, `was_correct`, `realised_price`, `realised_return_pct`)
 * written weeks later by `/api/cron/quant-analysis-validate`. Together they are
 * what turns this table from a log into a memory — an analysis is only worth
 * recalling once we know whether it was right, and only comparable once we know
 * what the chart looked like when it was written. Every Wave-1 row keeps NULLs
 * in all five: nothing back-fills an outcome that was never observed.
 */
import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "@/lib/db";
import type {
  QuantAnalysisDecision,
  QuantAnalysisMemoryCandidateWire,
  QuantAnalysisOutlookLeg,
  QuantAnalysisRecord,
} from "./types";

/** Same default and ceiling as upstream's `/history` route (default 10, capped 50). */
export const QUANT_ANALYSIS_LIST_DEFAULT_LIMIT = 20;
export const QUANT_ANALYSIS_LIST_MAX_LIMIT = 50;

/**
 * The indicator fingerprint persisted per analysis, stored in the EXACT wire
 * shape quant-agent's `/analysis/score` expects for a memory candidate. Keeping
 * one shape end to end means the recall path is a read and a pass-through, with
 * no rename step that could quietly map `ma_trend` onto the wrong field.
 */
export type QuantAnalysisFingerprint = QuantAnalysisMemoryCandidateWire["indicators"];

/**
 * Confidence buckets, mirroring `CONFIDENCE_BUCKETS` in
 * `quant-agent/app/engine/analysis/memory.py`. Duplicated across the language
 * boundary rather than fetched, because this powers a UI strip and a round trip
 * to the service for five integers would be absurd — but the bucket EDGES must
 * stay identical to the Python table, or the strip and the engine would be
 * describing different populations. The upper bound is exclusive; 100 belongs
 * to the top bucket.
 */
export const QUANT_ANALYSIS_CONFIDENCE_BUCKETS = [
  { key: "50_60", low: 50, high: 60 },
  { key: "60_70", low: 60, high: 70 },
  { key: "70_80", low: 70, high: 80 },
  { key: "80_90", low: 80, high: 90 },
  { key: "90_100", low: 90, high: 101 },
] as const;

/** Upstream's `if len(subset) < 5: continue` — below this a hit rate is noise. */
export const QUANT_ANALYSIS_MIN_BUCKET_SAMPLES = 5;

interface QuantAnalysisDbRow {
  id: string;
  user_id: number;
  market: string;
  symbol: string;
  interval: string;
  status: string;
  decision: string | null;
  confidence: number | null;
  current_price: number | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  position_size_pct: number | null;
  horizon: string | null;
  summary: string | null;
  technical_score: number | null;
  fundamental_score: number | null;
  sentiment_score: number | null;
  overall_score: number | null;
  consensus_json: string | null;
  outlook_json: string | null;
  detail_json: string | null;
  reasons_json: string | null;
  risks_json: string | null;
  data_quality_json: string | null;
  error: string | null;
  created_at: number;
  // Wave 2. NULL on every row written before the validation cron existed.
  indicators_json: string | null;
  validated_at: number | null;
  was_correct: number | null;
  realised_price: number | null;
  realised_return_pct: number | null;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as T | null;
    return parsed ?? fallback;
  } catch {
    // A row written by an older shape is still worth showing — the caller
    // renders the scalar columns and simply gets an empty sub-object.
    return fallback;
  }
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRecord(row: QuantAnalysisDbRow): QuantAnalysisRecord {
  return {
    id: row.id,
    market: row.market,
    symbol: row.symbol,
    interval: row.interval,
    status: row.status === "failed" ? "failed" : "completed",
    decision: (row.decision as QuantAnalysisDecision | null) ?? null,
    confidence: numberOrNull(row.confidence),
    currentPrice: numberOrNull(row.current_price),
    entryPrice: numberOrNull(row.entry_price),
    stopLoss: numberOrNull(row.stop_loss),
    takeProfit: numberOrNull(row.take_profit),
    positionSizePct: numberOrNull(row.position_size_pct),
    horizon: (row.horizon as QuantAnalysisRecord["horizon"]) ?? null,
    summary: row.summary,
    scores: {
      technical: numberOrNull(row.technical_score),
      fundamental: numberOrNull(row.fundamental_score),
      sentiment: numberOrNull(row.sentiment_score),
      overall: numberOrNull(row.overall_score),
    },
    consensus: parseJson<QuantAnalysisRecord["consensus"]>(row.consensus_json, null),
    outlook: parseJson<QuantAnalysisRecord["outlook"]>(row.outlook_json, null),
    detail: parseJson<QuantAnalysisRecord["detail"]>(row.detail_json, null),
    reasons: parseJson<string[]>(row.reasons_json, []),
    risks: parseJson<string[]>(row.risks_json, []),
    dataQuality: parseJson<QuantAnalysisRecord["dataQuality"]>(row.data_quality_json, null),
    error: row.error,
    // Stored as epoch ms; the contract's record is an ISO-8601 string.
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

/**
 * Everything the orchestrator knows once a run has finished — success or
 * failure. `id` and `createdAt` are minted here, not passed in, so a caller
 * cannot accidentally write two rows under one identity.
 */
export interface CreateQuantAnalysisInput {
  market: string;
  symbol: string;
  interval: string;
  status: "completed" | "failed";
  decision?: QuantAnalysisDecision | null;
  confidence?: number | null;
  currentPrice?: number | null;
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  positionSizePct?: number | null;
  horizon?: "short" | "medium" | "long" | null;
  summary?: string | null;
  scores?: {
    technical: number | null;
    fundamental: number | null;
    sentiment: number | null;
    overall: number | null;
  } | null;
  consensus?: {
    decision: QuantAnalysisDecision;
    score: number;
    agreement: number;
    timeframeCount: number;
  } | null;
  outlook?: {
    h24: QuantAnalysisOutlookLeg;
    d3: QuantAnalysisOutlookLeg;
    w1: QuantAnalysisOutlookLeg;
    m1: QuantAnalysisOutlookLeg;
  } | null;
  detail?: { technical: string; fundamental: string; sentiment: string } | null;
  reasons?: string[];
  risks?: string[];
  dataQuality?: { degraded: boolean; missing: string[] } | null;
  error?: string | null;
  /**
   * The primary timeframe's indicator fingerprint. Optional so a `failed` row
   * — which never got far enough to compute one — is still writable, and
   * absent rather than zero-filled when collection produced nothing.
   */
  indicators?: QuantAnalysisFingerprint | null;
}

function encode(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

/** Writes one finished analysis and returns it in the shared record shape. */
export async function createQuantAnalysis(
  userId: number,
  input: CreateQuantAnalysisInput,
): Promise<QuantAnalysisRecord> {
  const id = randomUUID();
  const createdAt = Date.now();

  await execute(
    `INSERT INTO quant_analyses
       (id, user_id, market, symbol, interval, status, decision, confidence,
        current_price, entry_price, stop_loss, take_profit, position_size_pct,
        horizon, summary, technical_score, fundamental_score, sentiment_score,
        overall_score, consensus_json, outlook_json, detail_json, reasons_json,
        risks_json, data_quality_json, error, created_at, indicators_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.market,
      input.symbol,
      input.interval,
      input.status,
      input.decision ?? null,
      input.confidence ?? null,
      input.currentPrice ?? null,
      input.entryPrice ?? null,
      input.stopLoss ?? null,
      input.takeProfit ?? null,
      input.positionSizePct ?? null,
      input.horizon ?? null,
      input.summary ?? null,
      input.scores?.technical ?? null,
      input.scores?.fundamental ?? null,
      input.scores?.sentiment ?? null,
      input.scores?.overall ?? null,
      encode(input.consensus ?? null),
      encode(input.outlook ?? null),
      encode(input.detail ?? null),
      encode(input.reasons ?? []),
      encode(input.risks ?? []),
      encode(input.dataQuality ?? null),
      input.error ?? null,
      createdAt,
      encode(input.indicators ?? null),
    ],
  );

  const row = await queryOne<QuantAnalysisDbRow>(
    "SELECT * FROM quant_analyses WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  if (!row) throw new Error("تعذّر حفظ التحليل.");
  return toRecord(row);
}

export interface ListQuantAnalysesOptions {
  limit?: number;
  /** Opaque keyset cursor from a previous page — `"<createdAt>|<id>"`. */
  cursor?: string | null;
  symbol?: string | null;
}

export interface ListQuantAnalysesResult {
  items: QuantAnalysisRecord[];
  nextCursor: string | null;
}

function encodeCursor(row: QuantAnalysisDbRow): string {
  return `${Number(row.created_at)}|${row.id}`;
}

function decodeCursor(cursor: string): { createdAt: number; id: string } | null {
  const separator = cursor.indexOf("|");
  if (separator <= 0) return null;
  const createdAt = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (!Number.isFinite(createdAt) || !id) return null;
  return { createdAt, id };
}

/**
 * The user's own analyses, newest first, keyset-paginated.
 *
 * Keyset rather than OFFSET because the list is written to while it is being
 * read — a user runs an analysis, then pages back through history — and OFFSET
 * silently duplicates or skips a row every time a new one lands at the head.
 * The `(created_at, id)` tie-break makes the order total, so two analyses
 * created in the same millisecond still page correctly.
 */
export async function listQuantAnalyses(
  userId: number,
  options: ListQuantAnalysesOptions = {},
): Promise<ListQuantAnalysesResult> {
  const limit = Math.min(
    Math.max(1, Math.trunc(options.limit ?? QUANT_ANALYSIS_LIST_DEFAULT_LIMIT)),
    QUANT_ANALYSIS_LIST_MAX_LIMIT,
  );

  const where: string[] = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (options.symbol) {
    where.push("symbol = ?");
    params.push(options.symbol);
  }
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  if (cursor) {
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  // One extra row is fetched purely to learn whether another page exists,
  // then dropped — cheaper and more accurate than a second COUNT query.
  params.push(limit + 1);

  const rows = await query<QuantAnalysisDbRow>(
    `SELECT * FROM quant_analyses
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map(toRecord),
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]!) : null,
  };
}

/**
 * One analysis the user owns, or null.
 *
 * Ownership is enforced in the WHERE clause AND re-asserted on the returned
 * row. The redundancy is deliberate: we just closed an authz hole of exactly
 * this shape on the strategy-enable route, and a by-id read whose only
 * protection is a clause someone can later "simplify" out is the same bug
 * waiting to happen.
 */
export async function getQuantAnalysis(
  userId: number,
  id: string,
): Promise<QuantAnalysisRecord | null> {
  const row = await queryOne<QuantAnalysisDbRow>(
    "SELECT * FROM quant_analyses WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  if (!row) return null;
  if (Number(row.user_id) !== userId) return null;
  return toRecord(row);
}

/** Deletes an analysis the user owns. Returns false if it wasn't theirs. */
export async function deleteQuantAnalysis(userId: number, id: string): Promise<boolean> {
  const res = await execute("DELETE FROM quant_analyses WHERE id = ? AND user_id = ?", [
    id,
    userId,
  ]);
  return res.changes > 0;
}

/**
 * The most recent prior analyses for one (user, symbol) — the memory context
 * the analysis prompt renders back to the model.
 *
 * Wave 1's memory reader, kept but NO LONGER ON THE ANALYSIS PATH:
 * `defaultQuantAnalysisDeps.listRecentAnalyses` is
 * `listSimilarQuantAnalysesForSymbol` below, and nothing falls back to this.
 *
 * That is deliberate and it matches upstream, whose `get_similar_patterns`
 * query requires `validated_at IS NOT NULL AND was_correct IS NOT NULL`: an
 * analysis whose outcome nobody has observed is not evidence, and feeding the
 * model its own unscored guesses is how a model talks itself into a position.
 * So memory is SILENT for roughly the first week of a symbol's life on an
 * account, and the prompt says so.
 *
 * It survives as the read behind a plain "your recent analyses of this symbol"
 * surface, and is covered by `analysisStore.test.ts`. If it is ever wired into
 * the prompt as a fallback, `formatMemoryContext`'s `RECENCY_HEADER` branch is
 * the one that renders it.
 */
export async function listRecentQuantAnalysesForSymbol(
  userId: number,
  symbol: string,
  limit = 3,
): Promise<QuantAnalysisRecord[]> {
  const rows = await query<QuantAnalysisDbRow>(
    `SELECT * FROM quant_analyses
      WHERE user_id = ? AND symbol = ? AND status = 'completed'
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    [userId, symbol, Math.min(Math.max(1, Math.trunc(limit)), 10)],
  );
  return rows.map(toRecord);
}

/**
 * One past analysis of this symbol whose outcome is known — a candidate for
 * quant-agent's similar-pattern scorer, plus the two extra fields the prompt's
 * outcome clause needs.
 */
export interface QuantAnalysisMemoryRow {
  id: string;
  decision: QuantAnalysisDecision;
  wasCorrect: boolean;
  /** The price the analysis was run at (upstream's `price_at_analysis`). */
  priceAtAnalysis: number | null;
  realisedReturnPct: number | null;
  indicators: QuantAnalysisFingerprint;
}

/** Upstream pulls `limit * 5` rows and lets the scorer rank within them. */
export const QUANT_ANALYSIS_MEMORY_POOL_MULTIPLIER = 5;

const DEFAULT_FINGERPRINT: QuantAnalysisFingerprint = {
  rsi: null,
  macd_signal: "neutral",
  ma_trend: "sideways",
  volatility_level: "normal",
  price_position: null,
};

function toFingerprint(raw: string | null): QuantAnalysisFingerprint {
  const parsed = parseJson<Partial<QuantAnalysisFingerprint> | null>(raw, null);
  if (!parsed) return { ...DEFAULT_FINGERPRINT };
  // The three string axes are compared by exact match on the service side, so
  // a missing one falls back to upstream's own neutral default rather than to
  // an empty string that could never match anything.
  return {
    rsi: numberOrNull(parsed.rsi ?? null),
    macd_signal: parsed.macd_signal || DEFAULT_FINGERPRINT.macd_signal,
    ma_trend: parsed.ma_trend || DEFAULT_FINGERPRINT.ma_trend,
    volatility_level: parsed.volatility_level || DEFAULT_FINGERPRINT.volatility_level,
    price_position: numberOrNull(parsed.price_position ?? null),
  };
}

/**
 * The candidate pool for similar-pattern recall: this user's past analyses of
 * this symbol whose outcome has been validated, newest validation first.
 *
 * This is upstream's `get_similar_patterns` SELECT, verbatim in intent —
 * `validated_at IS NOT NULL AND was_correct IS NOT NULL`, `LIMIT limit * 5` —
 * with two changes. It is scoped to one user (upstream's memory is global,
 * which on a multi-tenant platform means recalling a stranger's chart reading
 * as if it were your own), and `indicators_json IS NOT NULL` is required
 * because a row with no fingerprint cannot be compared and would otherwise be
 * ranked purely on quant-agent's "missing → neutral default" fallbacks.
 *
 * Consequence, inherited deliberately: memory is SILENT for roughly the first
 * week of a symbol's life on an account, because nothing has aged into
 * validation yet. That silence is the honest state, not a bug to paper over.
 */
export async function listSimilarQuantAnalysesForSymbol(
  userId: number,
  symbol: string,
  limit = 3,
): Promise<QuantAnalysisMemoryRow[]> {
  const bounded = Math.min(Math.max(1, Math.trunc(limit)), 10);
  const rows = await query<QuantAnalysisDbRow>(
    `SELECT * FROM quant_analyses
      WHERE user_id = ?
        AND symbol = ?
        AND status = 'completed'
        AND decision IS NOT NULL
        AND indicators_json IS NOT NULL
        AND validated_at IS NOT NULL
        AND was_correct IS NOT NULL
      ORDER BY validated_at DESC, created_at DESC, id DESC
      LIMIT ?`,
    [userId, symbol, bounded * QUANT_ANALYSIS_MEMORY_POOL_MULTIPLIER],
  );
  return rows.map((row) => ({
    id: row.id,
    decision: (row.decision as QuantAnalysisDecision | null) ?? "HOLD",
    wasCorrect: Number(row.was_correct) === 1,
    priceAtAnalysis: numberOrNull(row.current_price),
    realisedReturnPct: numberOrNull(row.realised_return_pct),
    indicators: toFingerprint(row.indicators_json),
  }));
}

/** One aged analysis the validation cron is about to score. */
export interface QuantAnalysisAwaitingValidation {
  id: string;
  userId: number;
  market: string;
  symbol: string;
  interval: string;
  decision: QuantAnalysisDecision;
  /** The price the analysis was run at; the realised move is measured from it. */
  priceAtAnalysis: number;
  createdAt: number;
}

/**
 * Completed analyses older than `olderThanMs` whose outcome has never been
 * scored, oldest first — upstream's
 * `WHERE validated_at IS NULL AND created_at < NOW() - interval` claim query.
 *
 * DELIBERATELY CROSS-USER, unlike every other read in this file. This is a
 * scheduled sweep, not a request on anyone's behalf: it returns rows only to
 * the cron, which uses them to write an outcome back onto each row's own id
 * and never renders one to a reader. That is the opposite of upstream's
 * `get_all_history` hole, where a falsy `user_id` silently served one user
 * another's history through a public endpoint.
 *
 * `current_price > 0` is part of the claim rather than a later skip: an
 * analysis with no price it was run at has no move to measure, and re-reading
 * it every night forever would starve the batch.
 */
export async function listQuantAnalysesAwaitingValidation(options: {
  olderThanMs: number;
  limit: number;
}): Promise<QuantAnalysisAwaitingValidation[]> {
  const limit = Math.min(Math.max(1, Math.trunc(options.limit)), 500);
  const rows = await query<QuantAnalysisDbRow>(
    `SELECT * FROM quant_analyses
      WHERE validated_at IS NULL
        AND status = 'completed'
        AND decision IS NOT NULL
        AND current_price IS NOT NULL
        AND current_price > 0
        AND created_at < ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    [Math.trunc(options.olderThanMs), limit],
  );
  return rows.flatMap((row) => {
    const priceAtAnalysis = numberOrNull(row.current_price);
    if (priceAtAnalysis == null || priceAtAnalysis <= 0) return [];
    return [
      {
        id: row.id,
        userId: Number(row.user_id),
        market: row.market,
        symbol: row.symbol,
        interval: row.interval,
        decision: (row.decision as QuantAnalysisDecision | null) ?? "HOLD",
        priceAtAnalysis,
        createdAt: Number(row.created_at),
      },
    ];
  });
}

export interface RecordQuantAnalysisValidationInput {
  id: string;
  wasCorrect: boolean;
  realisedPrice: number;
  realisedReturnPct: number;
  validatedAt?: number;
}

/**
 * Writes one outcome back. Returns false when the row was already validated —
 * `validated_at IS NULL` in the WHERE makes the write idempotent, so two cron
 * ticks racing on the same batch cannot double-score a row or overwrite an
 * earlier verdict with a later, differently-priced one.
 */
export async function recordQuantAnalysisValidation(
  input: RecordQuantAnalysisValidationInput,
): Promise<boolean> {
  const res = await execute(
    `UPDATE quant_analyses
        SET validated_at = ?, was_correct = ?, realised_price = ?, realised_return_pct = ?
      WHERE id = ? AND validated_at IS NULL`,
    [
      input.validatedAt ?? Date.now(),
      input.wasCorrect ? 1 : 0,
      input.realisedPrice,
      input.realisedReturnPct,
      input.id,
    ],
  );
  return res.changes > 0;
}

/** One confidence bucket that cleared the sample floor. */
export interface QuantAnalysisAccuracyBucket {
  key: string;
  low: number;
  /** Exclusive. The top bucket's 101 is what makes a confidence of 100 count. */
  high: number;
  samples: number;
  /** 0..1. Only ever reported for a bucket at or above the sample floor. */
  hitRate: number;
}

export interface QuantAnalysisAccuracySummary {
  buckets: QuantAnalysisAccuracyBucket[];
  /** Every validated row, including ones in buckets too thin to report. */
  validatedCount: number;
  correctCount: number;
  /** Rows inside a REPORTED bucket — what the strip's percentages cover. */
  measuredCount: number;
}

/**
 * Hit rate per confidence bucket over this user's validated analyses —
 * upstream's `get_confidence_accuracy_by_bucket`, user-scoped.
 *
 * A bucket below `QUANT_ANALYSIS_MIN_BUCKET_SAMPLES` is OMITTED, never
 * reported as a 0% hit rate: four correct calls out of four is not "100%
 * accurate", and the UI has to be able to say "not enough history yet" instead
 * of showing a number that means nothing.
 */
export async function getQuantAnalysisAccuracy(
  userId: number,
  options: { symbol?: string | null; sinceMs?: number | null } = {},
): Promise<QuantAnalysisAccuracySummary> {
  const where = [
    "user_id = ?",
    "validated_at IS NOT NULL",
    "was_correct IS NOT NULL",
    "confidence IS NOT NULL",
  ];
  const params: unknown[] = [userId];
  if (options.symbol) {
    where.push("symbol = ?");
    params.push(options.symbol);
  }
  if (options.sinceMs != null) {
    where.push("created_at > ?");
    params.push(Math.trunc(options.sinceMs));
  }

  const rows = await query<{ confidence: number | null; was_correct: number | null }>(
    `SELECT confidence, was_correct FROM quant_analyses WHERE ${where.join(" AND ")}`,
    params,
  );

  const graded = rows.flatMap((row) => {
    const confidence = numberOrNull(row.confidence);
    if (confidence == null || row.was_correct == null) return [];
    return [{ confidence, correct: Number(row.was_correct) === 1 }];
  });

  const buckets: QuantAnalysisAccuracyBucket[] = [];
  let measuredCount = 0;
  for (const bucket of QUANT_ANALYSIS_CONFIDENCE_BUCKETS) {
    const subset = graded.filter(
      (row) => row.confidence >= bucket.low && row.confidence < bucket.high,
    );
    if (subset.length < QUANT_ANALYSIS_MIN_BUCKET_SAMPLES) continue;
    measuredCount += subset.length;
    buckets.push({
      key: bucket.key,
      low: bucket.low,
      high: bucket.high,
      samples: subset.length,
      hitRate: subset.filter((row) => row.correct).length / subset.length,
    });
  }

  return {
    buckets,
    validatedCount: graded.length,
    correctCount: graded.filter((row) => row.correct).length,
    measuredCount,
  };
}

/** One validated row as quant-agent's threshold search consumes it. */
export interface QuantAnalysisCalibrationSample {
  consensusScore: number;
  actualReturnPct: number;
  confidence: number | null;
  wasCorrect: boolean | null;
}

/**
 * Validated rows for the calibration report — upstream's `calibrate_market`
 * fetch, minus the market filter (this platform is forex-only).
 *
 * Cross-user like the claim query above and for the same reason: this measures
 * how the ENGINE's own consensus score maps onto realised moves. It reads no
 * user-identifying column, returns four numbers per row, and its only consumer
 * is a cron-authenticated operator report.
 */
export async function listQuantAnalysisCalibrationSamples(options: {
  sinceMs: number;
  limit: number;
}): Promise<QuantAnalysisCalibrationSample[]> {
  const limit = Math.min(Math.max(1, Math.trunc(options.limit)), 5000);
  const rows = await query<{
    confidence: number | null;
    was_correct: number | null;
    realised_return_pct: number | null;
    consensus_json: string | null;
  }>(
    `SELECT confidence, was_correct, realised_return_pct, consensus_json
       FROM quant_analyses
      WHERE validated_at IS NOT NULL
        AND realised_return_pct IS NOT NULL
        AND consensus_json IS NOT NULL
        AND created_at > ?
      ORDER BY created_at DESC
      LIMIT ?`,
    [Math.trunc(options.sinceMs), limit],
  );

  return rows.flatMap((row) => {
    const consensus = parseJson<{ score?: number } | null>(row.consensus_json, null);
    const consensusScore = numberOrNull(consensus?.score ?? null);
    const actualReturnPct = numberOrNull(row.realised_return_pct);
    // A row whose consensus was never recorded contributes nothing to a
    // threshold search over consensus scores. Dropping it is the only option
    // that does not put an invented 0 into the grid.
    if (consensusScore == null || actualReturnPct == null) return [];
    return [
      {
        consensusScore,
        actualReturnPct,
        confidence: numberOrNull(row.confidence),
        wasCorrect: row.was_correct == null ? null : Number(row.was_correct) === 1,
      },
    ];
  });
}
