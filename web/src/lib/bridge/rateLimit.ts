import { BridgeErrorCode, bridgeError, type BridgeFailure } from "./errors";

interface WindowEntry {
  timestamps: number[];
}

const windows = new Map<string, WindowEntry>();

const WINDOW_MS = 60_000;

function writeLimitPerMinute(): number {
  const raw = Number(process.env.BRIDGE_RATE_LIMIT_WRITES);
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
}

export function rateLimitKey(userId: number, route: string): string {
  return `${userId}:${route}`;
}

export function checkWriteRateLimit(
  userId: number,
  route: string,
  now = Date.now(),
): { allowed: true } | { allowed: false; failure: BridgeFailure; retryAfterMs: number } {
  const limit = writeLimitPerMinute();
  const key = rateLimitKey(userId, route);
  const entry = windows.get(key) ?? { timestamps: [] };

  const cutoff = now - WINDOW_MS;
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= limit) {
    const oldest = entry.timestamps[0] ?? now;
    const retryAfterMs = Math.max(0, oldest + WINDOW_MS - now);
    windows.set(key, entry);
    return {
      allowed: false,
      retryAfterMs,
      failure: bridgeError(
        BridgeErrorCode.RATE_LIMITED,
        `Write rate limit exceeded (${limit}/min). Retry later.`,
        `تجاوزت حد الطلبات (${limit}/دقيقة). حاول لاحقاً.`,
        { limit, windowMs: WINDOW_MS, route },
        { retriable: true, retryAfterMs },
      ),
    };
  }

  entry.timestamps.push(now);
  windows.set(key, entry);
  return { allowed: true };
}

export function isWriteMethod(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

/** Test helper — clears sliding-window state. */
export function clearRateLimits(): void {
  windows.clear();
}
