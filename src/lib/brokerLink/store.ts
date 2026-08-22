import { execute, query as rootQuery, queryOne } from "@/lib/db";

/** Optional transaction executor — billing composes the link row and its
 *  one-time charge into ONE transaction (see the broker link flow). */
export interface StoreExecutor {
  query: <R>(sql: string, params?: unknown[]) => Promise<R[]>;
  execute: (sql: string, params?: unknown[]) => Promise<{ changes: number }>;
}

const rootDb: StoreExecutor = { query: rootQuery, execute };

export interface BrokerLinkRow {
  user_id: number;
  metaapi_account_id: string;
  broker_id: string;
  server: string;
  platform: string;
  state: string;
  login: string | null;
  created_at: string;
  updated_at: string;
}

function nowExpr(): string {
  return process.env.DATABASE_URL ? "NOW()" : "datetime('now')";
}

export async function getBrokerLink(
  userId: number,
  db?: StoreExecutor,
): Promise<BrokerLinkRow | null> {
  const rows = await (db ?? rootDb).query<BrokerLinkRow>(
    `SELECT user_id, metaapi_account_id, broker_id, server, platform, state,
            login, created_at, updated_at
       FROM broker_links WHERE user_id = ?`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function insertBrokerLink(row: {
  userId: number;
  metaapiAccountId: string;
  brokerId: string;
  server: string;
  state: string;
  login?: string | null;
}, db: StoreExecutor = rootDb): Promise<BrokerLinkRow> {
  await db.execute(
    `INSERT INTO broker_links (
       user_id, metaapi_account_id, broker_id, server, platform, state, login, updated_at
     ) VALUES (?, ?, ?, ?, 'mt5', ?, ?, ${nowExpr()})`,
    [
      row.userId,
      row.metaapiAccountId,
      row.brokerId,
      row.server,
      row.state,
      row.login ?? null,
    ],
  );
  const saved = await getBrokerLink(row.userId, db);
  if (!saved) throw new Error("broker_links insert did not persist");
  return saved;
}

export async function replaceBrokerLink(row: {
  userId: number;
  metaapiAccountId: string;
  brokerId: string;
  server: string;
  state: string;
  login?: string | null;
}, db: StoreExecutor = rootDb): Promise<BrokerLinkRow> {
  await db.execute(
    `UPDATE broker_links
        SET metaapi_account_id = ?, broker_id = ?, server = ?, platform = 'mt5',
            state = ?, login = ?, updated_at = ${nowExpr()}
      WHERE user_id = ?`,
    [
      row.metaapiAccountId,
      row.brokerId,
      row.server,
      row.state,
      row.login ?? null,
      row.userId,
    ],
  );
  const saved = await getBrokerLink(row.userId, db);
  if (!saved) throw new Error("broker_links replace did not persist");
  return saved;
}

export async function deleteBrokerLink(userId: number): Promise<boolean> {
  const result = await execute("DELETE FROM broker_links WHERE user_id = ?", [
    userId,
  ]);
  return result.changes > 0;
}

export async function updateBrokerLinkStatus(
  userId: number,
  patch: { state?: string; login?: string | null },
): Promise<void> {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.state != null) {
    fields.push("state = ?");
    params.push(patch.state);
  }
  if (patch.login !== undefined) {
    fields.push("login = ?");
    params.push(patch.login);
  }
  if (fields.length === 0) return;
  fields.push(`updated_at = ${nowExpr()}`);
  params.push(userId);
  await execute(
    `UPDATE broker_links SET ${fields.join(", ")} WHERE user_id = ?`,
    params,
  );
}
