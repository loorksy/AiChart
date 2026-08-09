import { execute, queryOne } from "@/lib/db";
import type { BridgeEnvelope } from "./errors";

const DEFAULT_TTL_HOURS = 24;

function ttlHours(): number {
  const raw = Number(process.env.IDEMPOTENCY_TTL_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_HOURS;
}

function expiresAtIso(from = Date.now()): string {
  return new Date(from + ttlHours() * 60 * 60 * 1000).toISOString();
}

export interface IdempotencyRecord {
  user_id: number;
  key: string;
  result_json: string;
  expires_at: string;
  created_at: string;
}

export async function getIdempotencyResult<T = unknown>(
  userId: number,
  key: string,
): Promise<BridgeEnvelope<T> | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;

  const row = await queryOne<IdempotencyRecord>(
    `SELECT result_json, expires_at FROM idempotency_keys
     WHERE user_id = ? AND key = ? LIMIT 1`,
    [userId, trimmed],
  );
  if (!row) return null;

  const expiresAt = new Date(row.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    await execute(
      "DELETE FROM idempotency_keys WHERE user_id = ? AND key = ?",
      [userId, trimmed],
    );
    return null;
  }

  try {
    return JSON.parse(row.result_json) as BridgeEnvelope<T>;
  } catch {
    return null;
  }
}

export async function storeIdempotencyResult(
  userId: number,
  key: string,
  result: BridgeEnvelope,
): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) return;

  const expires = expiresAtIso();
  await execute(
    `INSERT INTO idempotency_keys (user_id, key, result_json, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET
       result_json = excluded.result_json,
       expires_at = excluded.expires_at`,
    [userId, trimmed, JSON.stringify(result), expires],
  );
}

export function readIdempotencyKey(
  headerValue: string | null,
  bodyKey?: string | null,
): string | null {
  const fromHeader = headerValue?.trim();
  if (fromHeader) return fromHeader;
  const fromBody = bodyKey?.trim();
  return fromBody || null;
}
