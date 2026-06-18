import { BridgeErrorCode, bridgeError, type BridgeFailure } from "./errors";
import { bridgeRedisKey, getBridgeKvStore } from "./store";

const WINDOW_MS = 60_000;

function writeLimitPerMinute(): number {
  const raw = Number(process.env.BRIDGE_RATE_LIMIT_WRITES);
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
}

export function rateLimitKey(userId: number, route: string): string {
  return `${userId}:${route}`;
}

export async function checkWriteRateLimitAsync(
  userId: number,
  route: string,
  now = Date.now(),
): Promise<
  | { allowed: true }
  | { allowed: false; failure: BridgeFailure; retryAfterMs: number }
> {
  const limit = writeLimitPerMinute();
  const key = bridgeRedisKey("rl", [String(userId), route]);
  const result = await getBridgeKvStore().checkSlidingWindow(
    key,
    WINDOW_MS,
    limit,
    now,
  );

  if (!result.allowed) {
    return {
      allowed: false,
      retryAfterMs: result.retryAfterMs,
      failure: bridgeError(
        BridgeErrorCode.RATE_LIMITED,
        "Write rate limit exceeded for this route.",
        "تجاوزت حد طلبات الكتابة — انتظر ثم أعد المحاولة.",
        { retryAfterMs: result.retryAfterMs, limit, windowMs: WINDOW_MS },
        { retryAfterMs: result.retryAfterMs },
      ),
    };
  }

  return { allowed: true };
}

export const checkWriteRateLimit = checkWriteRateLimitAsync;

export function isWriteMethod(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

/** @deprecated writes recorded atomically in checkWriteRateLimitAsync */
export function recordWriteRateLimit(_userId: number, _route: string): void {}

/** @deprecated no-op — rate state lives in BridgeKvStore */
export function clearRateLimits(): void {}
