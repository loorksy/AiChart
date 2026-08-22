/**
 * The executions ledger — every user-pressed order, from claim to outcome.
 *
 * Two structural rules live in the SQL itself:
 *  - the UNIQUE idempotency key makes a double-press a single row: the
 *    second INSERT conflicts and the caller is handed the first attempt;
 *  - state transitions only move forward (pending → sent → filled /
 *    rejected / failed / unconfirmed → …), so a late reconciliation can
 *    never un-fill an order.
 *
 * This table records; it never grades. Recommendation outcomes are measured
 * on the recommendation, and nothing here writes anywhere near them.
 */
import { execute, insertReturningId, query, queryOne } from "@/lib/db";

export type ExecutionState =
  | "pending"
  | "sent"
  | "filled"
  | "rejected"
  | "failed"
  | "unconfirmed";

export interface ExecutionRow {
  id: number;
  user_id: number;
  recommendation_id: number;
  idempotency_key: string;
  client_id: string;
  metaapi_account_id: string;
  symbol: string;
  direction: string;
  volume: number;
  stop_loss: number;
  take_profit: number | null;
  requested_price: number | null;
  executed_price: number | null;
  slippage: number | null;
  state: ExecutionState | string;
  broker_order_id: string | null;
  broker_position_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
  confirmed_at: number | null;
}

/** States that still hold (or may hold) a live claim on the broker. */
export const LIVE_EXECUTION_STATES = ["pending", "sent", "unconfirmed", "filled"] as const;

export interface ClaimExecutionInput {
  userId: number;
  recommendationId: number;
  idempotencyKey: string;
  clientId: string;
  metaapiAccountId: string;
  symbol: string;
  direction: "buy" | "sell";
  volume: number;
  stopLoss: number;
  takeProfit: number | null;
  requestedPrice: number | null;
  now?: number;
}

export interface ClaimResult {
  row: ExecutionRow;
  /** False when the key already existed — the press was a duplicate. */
  claimed: boolean;
}

/**
 * Claim the idempotency key atomically. INSERT-or-nothing, then read back:
 * whichever press lost the race receives the winner's row, so two clicks
 * are one order by construction.
 */
export async function claimExecution(input: ClaimExecutionInput): Promise<ClaimResult> {
  const now = input.now ?? Date.now();
  const existing = await getExecutionByKey(input.userId, input.idempotencyKey);
  if (existing) return { row: existing, claimed: false };
  try {
    await insertReturningId(
      `INSERT INTO executions
         (user_id, recommendation_id, idempotency_key, client_id,
          metaapi_account_id, symbol, direction, volume, stop_loss, take_profit,
          requested_price, state, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
      [
        input.userId,
        input.recommendationId,
        input.idempotencyKey,
        input.clientId,
        input.metaapiAccountId,
        input.symbol.toUpperCase(),
        input.direction,
        input.volume,
        input.stopLoss,
        input.takeProfit,
        input.requestedPrice,
        now,
        now,
      ],
    );
  } catch (error) {
    // A UNIQUE violation is the double-press arriving in the same millisecond
    // — the row exists; hand it back rather than surfacing an error.
    const row = await getExecutionByKey(input.userId, input.idempotencyKey);
    if (row) return { row, claimed: false };
    throw error;
  }
  const row = await getExecutionByKey(input.userId, input.idempotencyKey);
  if (!row) throw new Error("execution claim did not persist");
  return { row, claimed: true };
}

export async function getExecutionByKey(
  userId: number,
  idempotencyKey: string,
): Promise<ExecutionRow | null> {
  return queryOne<ExecutionRow>(
    `SELECT * FROM executions WHERE user_id = ? AND idempotency_key = ?`,
    [userId, idempotencyKey],
  );
}

export async function getExecutionById(
  userId: number,
  id: number,
): Promise<ExecutionRow | null> {
  return queryOne<ExecutionRow>(
    `SELECT * FROM executions WHERE user_id = ? AND id = ?`,
    [userId, id],
  );
}

/** The one-live-order rule's read: any still-claiming row for this plan. */
export async function findLiveExecution(
  userId: number,
  recommendationId: number,
): Promise<ExecutionRow | null> {
  return queryOne<ExecutionRow>(
    `SELECT * FROM executions
      WHERE user_id = ? AND recommendation_id = ?
        AND state IN ('pending','sent','unconfirmed','filled')
      ORDER BY id DESC`,
    [userId, recommendationId],
  );
}

export async function listExecutions(
  userId: number,
  limit = 50,
): Promise<ExecutionRow[]> {
  return query<ExecutionRow>(
    `SELECT * FROM executions WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    [userId, Math.max(1, Math.min(200, limit))],
  );
}

async function setState(
  id: number,
  state: ExecutionState,
  patch: Partial<{
    executedPrice: number | null;
    slippage: number | null;
    brokerOrderId: string | null;
    brokerPositionId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    confirmedAt: number | null;
  }> = {},
  now = Date.now(),
): Promise<void> {
  await execute(
    `UPDATE executions SET
       state = ?,
       executed_price = COALESCE(?, executed_price),
       slippage = COALESCE(?, slippage),
       broker_order_id = COALESCE(?, broker_order_id),
       broker_position_id = COALESCE(?, broker_position_id),
       error_code = ?,
       error_message = ?,
       confirmed_at = COALESCE(?, confirmed_at),
       updated_at = ?
     WHERE id = ?`,
    [
      state,
      patch.executedPrice ?? null,
      patch.slippage ?? null,
      patch.brokerOrderId ?? null,
      patch.brokerPositionId ?? null,
      patch.errorCode ?? null,
      patch.errorMessage ?? null,
      patch.confirmedAt ?? null,
      now,
      id,
    ],
  );
}

export const markSent = (id: number, now?: number) => setState(id, "sent", {}, now);

export const markFilled = (
  id: number,
  patch: {
    executedPrice?: number | null;
    slippage?: number | null;
    brokerOrderId?: string | null;
    brokerPositionId?: string | null;
  },
  now = Date.now(),
) => setState(id, "filled", { ...patch, confirmedAt: now }, now);

export const markRejected = (
  id: number,
  errorCode: string,
  errorMessage: string,
  now?: number,
) => setState(id, "rejected", { errorCode, errorMessage }, now);

export const markFailed = (
  id: number,
  errorCode: string,
  errorMessage: string,
  now?: number,
) => setState(id, "failed", { errorCode, errorMessage }, now);

/** The send left the process and no response came back — reconcile, never guess. */
export const markUnconfirmed = (id: number, now?: number) =>
  setState(id, "unconfirmed", { errorCode: "send_unconfirmed", errorMessage: null }, now);
