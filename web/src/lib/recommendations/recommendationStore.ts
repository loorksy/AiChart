/**
 * Persistent, tenant-scoped store for tracked recommendations. Backend-agnostic
 * (`?` placeholders; adaptSql rewrites for Postgres). Reads/writes are scoped by
 * userId so one tenant can never touch another's records.
 */
import { execute, query, queryOne } from "@/lib/db";
import type {
  TrackedRecommendation,
  TrackedRecommendationOutcome,
  TrackedRecommendationStatus,
} from "./types";

interface Row {
  id: string;
  user_id: number;
  chat_id: string | null;
  analysis_id: string | null;
  symbol: string;
  interval: string;
  direction: string;
  entry_type: string;
  entry: number;
  stop_loss: number;
  targets: string;
  invalidation_level: number | null;
  status: string;
  outcome: string;
  setup_type: string | null;
  rr: number | null;
  created_at: number;
  created_candle_time: number;
  expires_at: number;
  triggered_at: number | null;
  tp1_hit_at: number | null;
  tp2_hit_at: number | null;
  tp3_hit_at: number | null;
  sl_hit_at: number | null;
  invalidated_at: number | null;
  cancelled_at: number | null;
  expired_at: number | null;
  price_at_creation: number | null;
  last_checked_at: number | null;
}

function num(v: number | null): number | undefined {
  return v == null ? undefined : Number(v);
}

function parseTargets(raw: string): number[] {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

function toRecord(row: Row): TrackedRecommendation {
  return {
    id: row.id,
    userId: Number(row.user_id),
    chatId: row.chat_id ?? undefined,
    analysisId: row.analysis_id ?? undefined,
    symbol: row.symbol,
    interval: row.interval,
    direction: row.direction === "sell" ? "sell" : "buy",
    entryType:
      row.entry_type === "limit" ? "limit" : row.entry_type === "pending" ? "pending" : "market",
    entry: Number(row.entry),
    stopLoss: Number(row.stop_loss),
    targets: parseTargets(row.targets),
    invalidationLevel: num(row.invalidation_level),
    status: row.status as TrackedRecommendationStatus,
    outcome: (row.outcome || "pending") as TrackedRecommendationOutcome,
    setupType: row.setup_type ?? undefined,
    rr: num(row.rr),
    createdAt: Number(row.created_at),
    createdCandleTime: Number(row.created_candle_time),
    expiresAt: Number(row.expires_at),
    triggeredAt: num(row.triggered_at),
    tp1HitAt: num(row.tp1_hit_at),
    tp2HitAt: num(row.tp2_hit_at),
    tp3HitAt: num(row.tp3_hit_at),
    slHitAt: num(row.sl_hit_at),
    invalidatedAt: num(row.invalidated_at),
    cancelledAt: num(row.cancelled_at),
    expiredAt: num(row.expired_at),
    priceAtCreation: num(row.price_at_creation),
    lastCheckedAt: num(row.last_checked_at),
  };
}

export type CreateTrackedRecommendationInput = Omit<
  TrackedRecommendation,
  | "triggeredAt"
  | "tp1HitAt"
  | "tp2HitAt"
  | "tp3HitAt"
  | "slHitAt"
  | "invalidatedAt"
  | "cancelledAt"
  | "expiredAt"
  | "lastCheckedAt"
> &
  Partial<Pick<TrackedRecommendation, "triggeredAt">>;

export async function createTrackedRecommendation(
  input: CreateTrackedRecommendationInput,
): Promise<TrackedRecommendation> {
  await execute(
    `INSERT INTO tracked_recommendations
       (id, user_id, chat_id, analysis_id, symbol, interval, direction, entry_type,
        entry, stop_loss, targets, invalidation_level, status, outcome, setup_type, rr,
        created_at, created_candle_time, expires_at, triggered_at, price_at_creation, last_checked_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.id,
      input.userId,
      input.chatId ?? null,
      input.analysisId ?? null,
      input.symbol,
      input.interval,
      input.direction,
      input.entryType,
      input.entry,
      input.stopLoss,
      JSON.stringify(input.targets ?? []),
      input.invalidationLevel ?? null,
      input.status,
      input.outcome ?? "pending",
      input.setupType ?? null,
      input.rr ?? null,
      input.createdAt,
      input.createdCandleTime,
      input.expiresAt,
      input.triggeredAt ?? null,
      input.priceAtCreation ?? null,
      input.createdAt,
    ],
  );
  const stored = await getTrackedRecommendationById(input.id);
  return stored ?? { ...input, outcome: input.outcome ?? "pending" };
}

async function getTrackedRecommendationById(
  id: string,
): Promise<TrackedRecommendation | null> {
  const row = await queryOne<Row>(
    "SELECT * FROM tracked_recommendations WHERE id = ?",
    [id],
  );
  return row ? toRecord(row) : null;
}

export async function getTrackedRecommendation(
  userId: number,
  id: string,
): Promise<TrackedRecommendation | null> {
  const row = await queryOne<Row>(
    "SELECT * FROM tracked_recommendations WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  return row ? toRecord(row) : null;
}

export async function listTrackedRecommendations(
  userId: number,
  opts: { limit?: number } = {},
): Promise<TrackedRecommendation[]> {
  const rows = await query<Row>(
    `SELECT * FROM tracked_recommendations
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
    [userId, Math.max(1, Math.min(opts.limit ?? 500, 2000))],
  );
  return rows.map(toRecord);
}

/** Non-terminal records (outcome = 'pending') to sweep. Optionally per-user. */
export async function listActiveTrackedRecommendations(opts: {
  userId?: number;
  limit?: number;
} = {}): Promise<TrackedRecommendation[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 5000));
  if (opts.userId != null) {
    const rows = await query<Row>(
      `SELECT * FROM tracked_recommendations
        WHERE outcome = 'pending' AND user_id = ?
        ORDER BY created_at DESC LIMIT ?`,
      [opts.userId, limit],
    );
    return rows.map(toRecord);
  }
  const rows = await query<Row>(
    `SELECT * FROM tracked_recommendations
      WHERE outcome = 'pending'
      ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(toRecord);
}

export interface TrackedStatusPatch {
  status: TrackedRecommendationStatus;
  outcome: TrackedRecommendationOutcome;
  triggeredAt?: number;
  tp1HitAt?: number;
  tp2HitAt?: number;
  tp3HitAt?: number;
  slHitAt?: number;
  invalidatedAt?: number;
  cancelledAt?: number;
  expiredAt?: number;
  lastCheckedAt?: number;
}

export async function updateTrackedRecommendation(
  userId: number,
  id: string,
  patch: TrackedStatusPatch,
): Promise<TrackedRecommendation | null> {
  const existing = await getTrackedRecommendation(userId, id);
  if (!existing) return null;
  await execute(
    `UPDATE tracked_recommendations SET
       status = ?, outcome = ?,
       triggered_at = ?, tp1_hit_at = ?, tp2_hit_at = ?, tp3_hit_at = ?,
       sl_hit_at = ?, invalidated_at = ?, cancelled_at = ?, expired_at = ?,
       last_checked_at = ?
     WHERE id = ? AND user_id = ?`,
    [
      patch.status,
      patch.outcome,
      patch.triggeredAt ?? existing.triggeredAt ?? null,
      patch.tp1HitAt ?? existing.tp1HitAt ?? null,
      patch.tp2HitAt ?? existing.tp2HitAt ?? null,
      patch.tp3HitAt ?? existing.tp3HitAt ?? null,
      patch.slHitAt ?? existing.slHitAt ?? null,
      patch.invalidatedAt ?? existing.invalidatedAt ?? null,
      patch.cancelledAt ?? existing.cancelledAt ?? null,
      patch.expiredAt ?? existing.expiredAt ?? null,
      patch.lastCheckedAt ?? Date.now(),
      id,
      userId,
    ],
  );
  return getTrackedRecommendation(userId, id);
}

export async function cancelTrackedRecommendation(
  userId: number,
  id: string,
): Promise<TrackedRecommendation | null> {
  const existing = await getTrackedRecommendation(userId, id);
  if (!existing) return null;
  if (existing.outcome !== "pending") return existing; // terminal stays terminal
  return updateTrackedRecommendation(userId, id, {
    status: "cancelled",
    outcome: "cancelled",
    cancelledAt: Date.now(),
  });
}
