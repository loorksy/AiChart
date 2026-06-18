#!/usr/bin/env node
/**
 * One-time migration: copy MCP OAuth rows from the legacy SQLite file into
 * Postgres, so existing Claude connectors keep working after the MCP auth
 * store moves from SQLite to Postgres (DATABASE_URL).
 *
 * Idempotent — safe to re-run. Run from a directory that has both
 * `better-sqlite3` and `pg` installed (e.g. /opt/aichart/web).
 *
 *   DATABASE_URL=postgres://... \
 *   SQLITE_PATH=/opt/aichart/web/data/aichart.db \
 *   node /opt/aichart/infra/migrate-mcp-auth-sqlite-to-pg.mjs
 */
import Database from "better-sqlite3";
import pg from "pg";

const sqlitePath =
  process.env.SQLITE_PATH ||
  process.env.DB_PATH ||
  "/opt/aichart/web/data/aichart.db";
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

function readSqlite() {
  let db;
  try {
    db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.error(`Cannot open SQLite at ${sqlitePath}: ${e.message}`);
    return { clients: [], tokens: [] };
  }
  const safe = (sql) => {
    try {
      return db.prepare(sql).all();
    } catch {
      return [];
    }
  };
  const clients = safe("SELECT client_id, client_json, created_at FROM mcp_oauth_clients");
  const tokens = safe(
    "SELECT token_hash, client_id, email, scopes_json, expires_at, revoked, created_at FROM mcp_oauth_refresh_tokens",
  );
  db.close();
  return { clients, tokens };
}

async function main() {
  const { clients, tokens } = readSqlite();
  console.log(`SQLite: ${clients.length} clients, ${tokens.length} refresh tokens.`);

  const pool = new pg.Pool({ connectionString: databaseUrl });
  let clientsInserted = 0;
  let tokensInserted = 0;
  try {
    // Ensure tables exist (mirror of ensureMcpAuthTables / web schema).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
        client_id   TEXT PRIMARY KEY,
        client_json TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
        token_hash  TEXT PRIMARY KEY,
        client_id   TEXT NOT NULL,
        email       TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        expires_at  TIMESTAMPTZ NOT NULL,
        revoked     BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );`);

    for (const c of clients) {
      const res = await pool.query(
        `INSERT INTO mcp_oauth_clients (client_id, client_json)
         VALUES ($1, $2)
         ON CONFLICT (client_id) DO NOTHING`,
        [c.client_id, c.client_json],
      );
      clientsInserted += res.rowCount;
    }
    for (const t of tokens) {
      const res = await pool.query(
        `INSERT INTO mcp_oauth_refresh_tokens
           (token_hash, client_id, email, scopes_json, expires_at, revoked)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (token_hash) DO NOTHING`,
        [
          t.token_hash,
          t.client_id,
          t.email,
          t.scopes_json,
          t.expires_at,
          Number(t.revoked) === 1,
        ],
      );
      tokensInserted += res.rowCount;
    }
  } finally {
    await pool.end();
  }

  console.log(
    `Postgres: inserted ${clientsInserted} new clients, ${tokensInserted} new refresh tokens (existing rows skipped).`,
  );
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
