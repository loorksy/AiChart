import crypto from "crypto";

function readSecret(name: string, devGenerator: () => string): string {
  const value = process.env[name];
  if (value && value.length > 0) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `Missing required environment variable ${name} in production. See .env.example.`,
    );
  }
  console.warn(
    `[env] ${name} is not set. Using an insecure development default. ` +
      `Set it in your .env file before deploying.`,
  );
  return devGenerator();
}

// Lazy getters: validation happens at request time (not at build/import time),
// so `next build` does not fail when secrets are injected only at runtime.

import { getDb } from "./db";

function readBootstrapKey(name: "ENCRYPTION_KEY" | "APP_SECRET", devFallback: string): string {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  try {
    const row = getDb()
      .prepare(
        "SELECT value FROM platform_config WHERE key = ? AND plain = 1",
      )
      .get(name) as { value: string } | undefined;
    if (row?.value) return row.value;
  } catch {
    /* DB may not exist yet during first boot */
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `Missing required config ${name}. Set it in admin keys or .env.`,
    );
  }
  console.warn(`[env] ${name} is not set. Using an insecure development default.`);
  return devFallback;
}

/** 32-byte key (hex) used for AES-256-GCM encryption of Binance credentials. */
export function getEncryptionKey(): string {
  return readBootstrapKey(
    "ENCRYPTION_KEY",
    crypto.createHash("sha256").update("aichart-dev-encryption-key").digest("hex"),
  );
}

/** Secret used to sign session JWTs. */
export function getAppSecret(): string {
  return readBootstrapKey("APP_SECRET", "aichart-dev-app-secret-change-me");
}

// Bootstrap admin account created on first run (no validation needed).
export const ADMIN_EMAIL: string =
  process.env.ADMIN_EMAIL || "admin@aichart.local";
export const ADMIN_PASSWORD: string = process.env.ADMIN_PASSWORD || "admin12345";

export const DB_PATH: string = process.env.DB_PATH || "data/aichart.db";
