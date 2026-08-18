import { execute, queryOne } from "@/lib/db";

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
): Promise<BrokerLinkRow | null> {
  return queryOne<BrokerLinkRow>(
    `SELECT user_id, metaapi_account_id, broker_id, server, platform, state,
            login, created_at, updated_at
       FROM broker_links WHERE user_id = ?`,
    [userId],
  );
}

export async function insertBrokerLink(row: {
  userId: number;
  metaapiAccountId: string;
  brokerId: string;
  server: string;
  state: string;
}): Promise<BrokerLinkRow> {
  await execute(
    `INSERT INTO broker_links (
       user_id, metaapi_account_id, broker_id, server, platform, state, updated_at
     ) VALUES (?, ?, ?, ?, 'mt5', ?, ${nowExpr()})`,
    [row.userId, row.metaapiAccountId, row.brokerId, row.server, row.state],
  );
  const saved = await getBrokerLink(row.userId);
  if (!saved) throw new Error("broker_links insert did not persist");
  return saved;
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
