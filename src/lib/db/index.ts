import { DB_PATH } from "../env";
import type { DbBackend, DbRow, ExecuteResult } from "./types";
import {
  initSqlite,
  sqliteExecute,
  sqliteLoadBootstrapKeys,
  sqliteLoadPlatformConfig,
  sqliteQuery,
  sqliteQueryOne,
  sqliteTransaction,
} from "./sqlite";
import {
  initPg,
  pgExecute,
  pgInsertReturningId,
  pgLoadBootstrapKeys,
  pgLoadPlatformConfig,
  pgQuery,
  pgQueryOne,
  pgTransaction,
} from "./pg";

export type { DbBackend, DbRow, ExecuteResult };

let _backend: DbBackend | null = null;
let _initPromise: Promise<void> | null = null;
let _initialized = false;

const bootstrapCache: {
  encryptionKey?: string;
  appSecret?: string;
} = {};

export function getDbBackend(): DbBackend {
  if (!_backend) {
    _backend = process.env.DATABASE_URL ? "postgres" : "sqlite";
  }
  return _backend;
}

export function getDbInfo(): {
  backend: DbBackend;
  path?: string;
  url?: string;
} {
  const backend = getDbBackend();
  if (backend === "postgres") {
    return { backend, url: process.env.DATABASE_URL };
  }
  return { backend, path: DB_PATH };
}

export function isPostgresReady(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function initDb(): Promise<void> {
  if (_initialized) return;
  if (!_initPromise) {
    _initPromise = (async () => {
      if (getDbBackend() === "postgres") {
        await initPg();
        const keys = await pgLoadBootstrapKeys();
        if (keys.encryptionKey) bootstrapCache.encryptionKey = keys.encryptionKey;
        if (keys.appSecret) bootstrapCache.appSecret = keys.appSecret;
        const { refreshPlatformConfigCacheInternal } = await import(
          "../platformConfig"
        );
        await refreshPlatformConfigCacheInternal(pgLoadPlatformConfig);
      } else {
        await initSqlite();
        const keys = await sqliteLoadBootstrapKeys();
        if (keys.encryptionKey) bootstrapCache.encryptionKey = keys.encryptionKey;
        if (keys.appSecret) bootstrapCache.appSecret = keys.appSecret;
        const { refreshPlatformConfigCacheInternal } = await import(
          "../platformConfig"
        );
        await refreshPlatformConfigCacheInternal(sqliteLoadPlatformConfig);
      }
      _initialized = true;
    })();
  }
  return _initPromise;
}

export function getBootstrapFromCache(
  name: "ENCRYPTION_KEY" | "APP_SECRET",
): string | undefined {
  if (name === "ENCRYPTION_KEY") return bootstrapCache.encryptionKey;
  return bootstrapCache.appSecret;
}

export function setBootstrapCache(keys: {
  encryptionKey?: string;
  appSecret?: string;
}): void {
  if (keys.encryptionKey !== undefined) {
    bootstrapCache.encryptionKey = keys.encryptionKey;
  }
  if (keys.appSecret !== undefined) {
    bootstrapCache.appSecret = keys.appSecret;
  }
}

async function ensureDb(): Promise<void> {
  if (_initialized) return;
  await initDb();
}

export async function query<T = DbRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ensureDb();
  if (getDbBackend() === "postgres") return pgQuery<T>(sql, params);
  return sqliteQuery<T>(sql, params);
}

export async function queryOne<T = DbRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  await ensureDb();
  if (getDbBackend() === "postgres") return pgQueryOne<T>(sql, params);
  return sqliteQueryOne<T>(sql, params);
}

export async function execute(
  sql: string,
  params: unknown[] = [],
): Promise<ExecuteResult> {
  await ensureDb();
  if (getDbBackend() === "postgres") return pgExecute(sql, params);
  return sqliteExecute(sql, params);
}

export async function insertReturningId(
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  await ensureDb();
  if (getDbBackend() === "postgres") return pgInsertReturningId(sql, params);
  const result = await sqliteExecute(sql, params);
  return result.lastInsertId;
}

export async function transaction<T>(
  fn: (helpers: {
    query: <R>(sql: string, params?: unknown[]) => Promise<R[]>;
    execute: (sql: string, params?: unknown[]) => Promise<ExecuteResult>;
    insertReturningId: (sql: string, params?: unknown[]) => Promise<number>;
  }) => Promise<T>,
): Promise<T> {
  await ensureDb();
  if (getDbBackend() === "postgres") {
    return pgTransaction(fn);
  }
  return sqliteTransaction(fn);
}

export async function loadPlatformConfigRows(): Promise<
  { key: string; value: string; plain: number }[]
> {
  await ensureDb();
  if (getDbBackend() === "postgres") return pgLoadPlatformConfig();
  return sqliteLoadPlatformConfig();
}
