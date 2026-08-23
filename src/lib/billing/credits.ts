import {
  execute as rootExecute,
  getDbBackend,
  insertReturningId as rootInsertReturningId,
  query as rootQuery,
  transaction,
} from "@/lib/db";

/**
 * Billing v3 — the CREDIT balance (integers, never dollars).
 *
 * The invariants live in the DATABASE, not in call sites:
 *
 *  - `credit_accounts.balance` carries CHECK (balance >= 0): no code path can
 *    take a balance below zero — the write itself fails.
 *  - Debits are a CONDITIONAL relative update (`SET balance = balance - :a
 *    WHERE balance >= :a`): two concurrent spends racing over a balance that
 *    covers one produce exactly one success. No read-then-write anywhere.
 *  - `uq_credit_entries_ref` (user_id, kind, ref) is the idempotency
 *    guarantee for grants AND debits: a replayed Stripe webhook or a
 *    redelivered queue turn hits the constraint, not the balance. It must
 *    never be replaced by a read-then-check in code.
 *
 * Every helper takes an optional executor so it composes into a caller's
 * `transaction()` — the recommendation debit rides the SAME transaction as
 * the recommendation insert; a failed insert rolls the debit back with it.
 * With no executor, the helper opens its own transaction.
 */

export interface DbExecutor {
  query: <R>(sql: string, params?: unknown[]) => Promise<R[]>;
  execute: (sql: string, params?: unknown[]) => Promise<{ changes: number }>;
  insertReturningId?: (sql: string, params?: unknown[]) => Promise<number>;
}

const rootDb: DbExecutor = {
  query: rootQuery,
  execute: rootExecute,
  insertReturningId: rootInsertReturningId,
};

/** Ledger vocabulary. Grants are positive, debits negative, one kind each. */
export type CreditEntryKind =
  /** The once-ever welcome balance a new account is handed. */
  | "signup_grant"
  | "cycle_grant"
  | "topup"
  | "admin_adjust"
  | "debit_recommendation"
  | "debit_chat"
  | "debit_mt5_link";

export interface CreditEntry {
  id: number;
  user_id: number;
  ts: number;
  kind: string;
  amount: number;
  balance_after: number;
  ref: string | null;
  note: string | null;
}

async function ensureAccountRow(db: DbExecutor, userId: number): Promise<void> {
  const now = Date.now();
  if (getDbBackend() === "postgres") {
    await db.execute(
      "INSERT INTO credit_accounts (user_id, balance, updated_at) VALUES (?, 0, ?) ON CONFLICT (user_id) DO NOTHING",
      [userId, now],
    );
  } else {
    await db.execute(
      "INSERT OR IGNORE INTO credit_accounts (user_id, balance, updated_at) VALUES (?, 0, ?)",
      [userId, now],
    );
  }
}

/** Idempotent ledger insert: returns false when (user, kind, ref) already exists. */
async function insertEntry(
  db: DbExecutor,
  row: {
    userId: number;
    kind: CreditEntryKind;
    amount: number;
    balanceAfter: number;
    ref: string | null;
    note: string | null;
  },
): Promise<boolean> {
  const sql =
    getDbBackend() === "postgres"
      ? `INSERT INTO credit_entries (user_id, ts, kind, amount, balance_after, ref, note)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
      : `INSERT OR IGNORE INTO credit_entries (user_id, ts, kind, amount, balance_after, ref, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`;
  const res = await db.execute(sql, [
    row.userId,
    Date.now(),
    row.kind,
    row.amount,
    row.balanceAfter,
    row.ref,
    row.note,
  ]);
  return res.changes > 0;
}

async function readBalance(db: DbExecutor, userId: number): Promise<number> {
  const row = await db
    .query<{ balance: number }>(
      "SELECT balance FROM credit_accounts WHERE user_id = ?",
      [userId],
    )
    .then((rows) => rows[0]);
  return Number(row?.balance ?? 0);
}

export async function getCreditBalance(userId: number): Promise<number> {
  return readBalance(rootDb, userId);
}

export interface GrantResult {
  /** False when this exact (kind, ref) was already applied — replay skipped. */
  applied: boolean;
  balance: number;
}

/**
 * Add credits. With a `ref`, the grant is idempotent: replaying it returns
 * applied:false and moves nothing. The balance update is relative and the
 * duplicate branch undoes it inside the same transaction, so a replay is
 * invisible arithmetic, never a rollback of the caller's work.
 */
export async function grantCredits(
  input: {
    userId: number;
    amount: number;
    kind: Extract<
      CreditEntryKind,
      "signup_grant" | "cycle_grant" | "topup" | "admin_adjust"
    >;
    ref?: string | null;
    note?: string | null;
  },
  db?: DbExecutor,
): Promise<GrantResult> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("grant amount must be a positive integer");
  }
  const run = async (tx: DbExecutor): Promise<GrantResult> => {
    await ensureAccountRow(tx, input.userId);
    await tx.execute(
      "UPDATE credit_accounts SET balance = balance + ?, updated_at = ? WHERE user_id = ?",
      [input.amount, Date.now(), input.userId],
    );
    const after = await readBalance(tx, input.userId);
    const inserted = await insertEntry(tx, {
      userId: input.userId,
      kind: input.kind,
      amount: input.amount,
      balanceAfter: after,
      ref: input.ref ?? null,
      note: input.note ?? null,
    });
    if (!inserted) {
      // Replay of an already-applied grant: exact relative undo, same tx.
      await tx.execute(
        "UPDATE credit_accounts SET balance = balance - ?, updated_at = ? WHERE user_id = ?",
        [input.amount, Date.now(), input.userId],
      );
      return { applied: false, balance: after - input.amount };
    }
    return { applied: true, balance: after };
  };
  return db ? run(db) : transaction(run);
}

export type DebitResult =
  | { ok: true; balance: number; alreadyApplied: boolean }
  | { ok: false; code: "insufficient_credits"; balance: number };

/**
 * Spend credits — the atomic conditional debit. Refuses BEFORE anything
 * happens when the balance does not cover the cost; a duplicate `ref`
 * (redelivered work) reports ok with alreadyApplied:true and moves nothing.
 */
export async function debitCredits(
  input: {
    userId: number;
    amount: number;
    kind: Extract<
      CreditEntryKind,
      "debit_recommendation" | "debit_chat" | "debit_mt5_link" | "admin_adjust"
    >;
    ref: string;
    note?: string | null;
  },
  db?: DbExecutor,
): Promise<DebitResult> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("debit amount must be a positive integer");
  }
  const run = async (tx: DbExecutor): Promise<DebitResult> => {
    await ensureAccountRow(tx, input.userId);
    const updated = await tx.execute(
      "UPDATE credit_accounts SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?",
      [input.amount, Date.now(), input.userId, input.amount],
    );
    if (updated.changes === 0) {
      return {
        ok: false,
        code: "insufficient_credits",
        balance: await readBalance(tx, input.userId),
      };
    }
    const after = await readBalance(tx, input.userId);
    const inserted = await insertEntry(tx, {
      userId: input.userId,
      kind: input.kind,
      amount: -input.amount,
      balanceAfter: after,
      ref: input.ref,
      note: input.note ?? null,
    });
    if (!inserted) {
      // This exact operation already debited once — undo the second take.
      await tx.execute(
        "UPDATE credit_accounts SET balance = balance + ?, updated_at = ? WHERE user_id = ?",
        [input.amount, Date.now(), input.userId],
      );
      return { ok: true, balance: after + input.amount, alreadyApplied: true };
    }
    return { ok: true, balance: after, alreadyApplied: false };
  };
  return db ? run(db) : transaction(run);
}

/** The user's movement history, newest first — the ledger page reads this. */
export async function listCreditEntries(
  userId: number,
  limit = 100,
): Promise<CreditEntry[]> {
  return rootQuery<CreditEntry>(
    `SELECT id, user_id, ts, kind, amount, balance_after, ref, note
       FROM credit_entries WHERE user_id = ?
      ORDER BY ts DESC, id DESC LIMIT ?`,
    [userId, Math.max(1, Math.min(500, limit))],
  );
}
