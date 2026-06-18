import { Pool } from "pg";

let _pool: Pool | null = null;

export function getMcpPgPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for MCP OAuth store.");
  _pool = new Pool({ connectionString: url });
  return _pool;
}

export async function mcpPgQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getMcpPgPool().query(sql, params);
  return result.rows as T[];
}

export async function mcpPgQueryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await mcpPgQuery<T>(sql, params);
  return rows[0] ?? null;
}

export async function mcpPgExecute(
  sql: string,
  params: unknown[] = [],
): Promise<void> {
  await getMcpPgPool().query(sql, params);
}

export async function closeMcpDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Idempotent creation of the MCP OAuth tables. The web app also creates these
 * (web/src/lib/db/pg.ts), but the MCP owns its auth schema defensively so it
 * never depends on web's startup order. Safe to call on every boot.
 */
export async function ensureMcpAuthTables(): Promise<void> {
  await mcpPgExecute(`
    CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
      client_id   TEXT PRIMARY KEY,
      client_json TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await mcpPgExecute(`
    CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
      token_hash  TEXT PRIMARY KEY,
      client_id   TEXT NOT NULL,
      email       TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      revoked     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await mcpPgExecute(
    `CREATE INDEX IF NOT EXISTS idx_mcp_refresh_client
       ON mcp_oauth_refresh_tokens (client_id, revoked);`,
  );
}

/** @deprecated — was SQLite-based; now a no-op (PG pool created lazily). */
export function getMcpDb(_dbPath?: string): null {
  return null;
}

/** @deprecated — now uses DATABASE_URL directly. */
export function resolveDbPath(rawPath: string, _repoRoot?: string): string {
  return rawPath;
}
