/**
 * Database adapter — SQLite today, PostgreSQL for production scale.
 * Set DATABASE_URL to enable Postgres (future migration).
 */

import { DB_PATH } from "./env";

export type DbBackend = "sqlite" | "postgres";

export function getDbBackend(): DbBackend {
  return process.env.DATABASE_URL ? "postgres" : "sqlite";
}

export function getDbInfo(): { backend: DbBackend; path?: string; url?: string } {
  const backend = getDbBackend();
  if (backend === "postgres") {
    return { backend, url: process.env.DATABASE_URL };
  }
  return { backend, path: DB_PATH };
}

/** Placeholder for Phase 6 — swap getDb() implementation when migrating. */
export function isPostgresReady(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
