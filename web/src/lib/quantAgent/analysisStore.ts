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
 */
import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "@/lib/db";
import type {
  QuantAnalysisDecision,
  QuantAnalysisOutlookLeg,
  QuantAnalysisRecord,
} from "./types";

/** Same default and ceiling as upstream's `/history` route (default 10, capped 50). */
export const QUANT_ANALYSIS_LIST_DEFAULT_LIMIT = 20;
export const QUANT_ANALYSIS_LIST_MAX_LIMIT = 50;

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
        risks_json, data_quality_json, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
 * Upstream (`analysis_memory.get_similar_patterns`) ranks candidates by an
 * indicator-similarity score and keeps only rows whose outcome was already
 * validated. Neither is possible here: `quant_analyses` stores no indicator
 * snapshot to compare against and no validated outcome to filter on. So this
 * returns plain recency instead, and the prompt labels it as exactly that
 * rather than claiming a similarity it did not compute.
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
