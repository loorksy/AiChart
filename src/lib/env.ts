import crypto from "crypto";
import { getBootstrapFromCache } from "./db";

function readBootstrapKey(name: "ENCRYPTION_KEY" | "APP_SECRET", devFallback: string): string {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const fromCache = getBootstrapFromCache(name);
  if (fromCache) return fromCache;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `Missing required config ${name}. Set it in admin keys or .env.`,
    );
  }
  console.warn(`[env] ${name} is not set. Using an insecure development default.`);
  return devFallback;
}

/** 32-byte key (hex) used for AES-256-GCM encryption of stored secrets. */
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

export { ADMIN_EMAIL, ADMIN_PASSWORD } from "./constants";

export const DB_PATH: string = process.env.DB_PATH || "data/aichart.db";
