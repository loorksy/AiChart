import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id   TEXT PRIMARY KEY,
  client_json TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
  token_hash  TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  email       TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mcp_refresh_client
  ON mcp_oauth_refresh_tokens (client_id, revoked);
`;

let dbInstance: Database.Database | null = null;

export function resolveDbPath(rawPath: string, repoRoot?: string): string {
  if (path.isAbsolute(rawPath)) return rawPath;
  const base = repoRoot ?? path.resolve(process.cwd(), "..");
  return path.resolve(base, "web", rawPath);
}

export function getMcpDb(dbPath: string): Database.Database {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  dbInstance = new Database(dbPath);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.exec(SCHEMA);
  return dbInstance;
}

export function closeMcpDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
