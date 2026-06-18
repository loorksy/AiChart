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

/** @deprecated — was SQLite-based; now a no-op (PG pool created lazily). */
export function getMcpDb(_dbPath?: string): null {
  return null;
}

/** @deprecated — now uses DATABASE_URL directly. */
export function resolveDbPath(rawPath: string, _repoRoot?: string): string {
  return rawPath;
}
