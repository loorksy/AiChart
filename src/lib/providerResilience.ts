/**
 * Provider resilience (RELIABILITY_PLAN.md item 6): a bounded, per-provider
 * guard around every outbound market/LLM call. It never adds correctness risk
 * to a trade decision — it only decides *whether/when* an external call is
 * attempted and *how* a transient blip is retried:
 *
 * - Circuit breaker: after N consecutive failures a provider is "open" and
 *   calls fail fast (no hammering a dead upstream) until a cooldown lets one
 *   half-open probe through.
 * - Throttle: a minimum spacing between calls to one provider so a burst can't
 *   trip the upstream's own rate limiter.
 * - Backoff with jitter + Retry-After: retryable failures (429/5xx/network/
 *   timeout) wait an exponential, jittered delay, honoring a server Retry-After
 *   header, and never past the caller's deadline signal.
 *
 * Retries are OPT-IN (`maxRetries`, default 0) so a caller that already retries
 * (the final-decision synthesizer) keeps only the breaker + throttle and never
 * double-retries. The pure helpers are exported for direct unit testing.
 */
import { ExternalTimeoutError, fetchWithTimeout } from "./externalFetch";
import {
  recordCircuitState,
  recordProviderError,
  recordProviderRetry,
} from "./metrics";

export type BreakerState = "closed" | "open" | "half_open";

export interface BreakerConfig {
  /** Consecutive failures that trip the breaker open. */
  failureThreshold: number;
  /** How long the breaker stays open before a half-open probe (ms). */
  cooldownMs: number;
}

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownMs: 30_000 };

interface BreakerRuntime {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number;
  /** True while a half-open probe is in flight (only one allowed). */
  probing: boolean;
}

/** Exponential backoff with full jitter, clamped to [0, maxMs]. */
export function computeBackoffMs(
  attempt: number,
  opts: { baseMs: number; maxMs: number },
  rand: () => number = Math.random,
): number {
  const exp = Math.min(opts.maxMs, opts.baseMs * 2 ** Math.max(0, attempt));
  // Full jitter: uniform in [0, exp]. Avoids retry storms from synchronized
  // clients all backing off by the same amount.
  return Math.floor(rand() * exp);
}

/**
 * Parse a Retry-After header into a delay in ms (or null). Accepts either a
 * delta-seconds integer or an HTTP-date. `nowMs` is injectable for testing.
 */
export function parseRetryAfterMs(
  header: string | null | undefined,
  nowMs: number,
): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.max(0, Number(trimmed) * 1000);
  }
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) return Math.max(0, date - nowMs);
  return null;
}

// --- Circuit breaker registry -------------------------------------------------

const breakers = new Map<string, BreakerRuntime>();

function breakerFor(key: string): BreakerRuntime {
  let b = breakers.get(key);
  if (!b) {
    b = { state: "closed", consecutiveFailures: 0, openedAt: 0, probing: false };
    breakers.set(key, b);
  }
  return b;
}

/**
 * Whether a call to `key` may proceed right now. Transitions open → half_open
 * after the cooldown. `now` is injectable for testing.
 */
export function breakerAllows(
  key: string,
  now: number,
  config: BreakerConfig = DEFAULT_BREAKER,
): boolean {
  const b = breakerFor(key);
  if (b.state === "closed") return true;
  if (b.state === "open") {
    if (now - b.openedAt >= config.cooldownMs) {
      b.state = "half_open";
      b.probing = false;
    } else {
      return false;
    }
  }
  // half_open: allow exactly one probe at a time.
  if (b.probing) return false;
  b.probing = true;
  return true;
}

export function breakerOnSuccess(key: string): void {
  const b = breakerFor(key);
  b.consecutiveFailures = 0;
  b.state = "closed";
  b.probing = false;
  recordCircuitState(key, "closed");
}

export function breakerOnFailure(
  key: string,
  now: number,
  config: BreakerConfig = DEFAULT_BREAKER,
): void {
  const b = breakerFor(key);
  b.consecutiveFailures += 1;
  b.probing = false;
  if (b.state === "half_open" || b.consecutiveFailures >= config.failureThreshold) {
    b.state = "open";
    b.openedAt = now;
  }
  recordCircuitState(key, b.state);
}

/** Current breaker state (for observability / tests). */
export function breakerState(key: string): BreakerState {
  return breakerFor(key).state;
}

/** Reset all breaker + throttle state (tests). */
export function __resetResilience(): void {
  breakers.clear();
  lastCallAt.clear();
}

// --- Throttle -----------------------------------------------------------------

const lastCallAt = new Map<string, number>();

/**
 * Delay (ms) a call to `key` must wait to honor a minimum spacing, given the
 * last call time. Records `now` as the new last-call time. `now` injectable.
 */
export function throttleDelayMs(key: string, minIntervalMs: number, now: number): number {
  if (minIntervalMs <= 0) return 0;
  const last = lastCallAt.get(key);
  const earliest = last == null ? now : last + minIntervalMs;
  const scheduled = Math.max(now, earliest);
  lastCallAt.set(key, scheduled);
  return scheduled - now;
}

export class CircuitOpenError extends Error {
  constructor(public readonly providerKey: string) {
    super(`Provider "${providerKey}" circuit is open — failing fast.`);
    this.name = "CircuitOpenError";
  }
}

// --- Runtime glue -------------------------------------------------------------

const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);

/** A non-2xx status that reflects a transient provider condition (may retry). */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

/** A thrown fetch error that reflects a transient network/timeout condition. */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof ExternalTimeoutError) return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("socket hang up") ||
    msg.includes("network")
  );
}

function abortSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface ResilientFetchOptions {
  timeoutMs?: number;
  label?: string;
  /** Minimum spacing between calls to this provider (ms). */
  minIntervalMs?: number;
  /** Extra attempts on a retryable failure. Default 0 (breaker+throttle only). */
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  breaker?: BreakerConfig;
  /** Caller deadline/cancel — retries and throttle waits honor it. */
  signal?: AbortSignal;
}

/**
 * fetchWithTimeout wrapped in the circuit breaker + throttle + bounded backoff.
 * One resilientFetch call records at most one breaker success/failure (retries
 * inside a call do not each count), so the breaker tracks *provider* health,
 * not attempt count. A non-retryable non-2xx (e.g. 401/404) is returned to the
 * caller AND counted as a success for the breaker — the provider is reachable,
 * it is the request that is wrong.
 */
export async function resilientFetch(
  providerKey: string,
  url: string,
  init: RequestInit,
  opts: ResilientFetchOptions = {},
): Promise<Response> {
  if (!breakerAllows(providerKey, Date.now(), opts.breaker)) {
    throw new CircuitOpenError(providerKey);
  }
  const throttleWait = throttleDelayMs(providerKey, opts.minIntervalMs ?? 0, Date.now());
  if (throttleWait > 0) await abortSleep(throttleWait, opts.signal);

  const maxRetries = opts.maxRetries ?? 0;
  const backoff = { baseMs: opts.baseBackoffMs ?? 400, maxMs: opts.maxBackoffMs ?? 8_000 };
  let attempt = 0;
  // Tracks whether THIS call retried, so retry success rate counts calls that
  // actually needed a retry — not every healthy first-attempt request.
  let retried = false;
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const res = await fetchWithTimeout(
        url,
        { ...init, signal: opts.signal },
        { timeoutMs: opts.timeoutMs, label: opts.label },
      );
      if (res.ok || !isRetryableStatus(res.status)) {
        // Reachable provider (2xx, or a 4xx that is the caller's fault).
        if (retried) recordProviderRetry(providerKey, "succeeded");
        breakerOnSuccess(providerKey);
        return res;
      }
      // Retryable non-2xx (429/5xx).
      recordProviderError(providerKey, res.status === 429 ? "rate_limit" : "server_error");
      if (attempt < maxRetries && !opts.signal?.aborted) {
        const retryAfter = parseRetryAfterMs(res.headers.get("retry-after"), Date.now());
        const delay = retryAfter ?? computeBackoffMs(attempt, backoff);
        attempt += 1;
        retried = true;
        await abortSleep(delay, opts.signal);
        continue;
      }
      if (retried) recordProviderRetry(providerKey, "failed");
      breakerOnFailure(providerKey, Date.now(), opts.breaker);
      return res;
    } catch (err) {
      if (opts.signal?.aborted) throw err; // caller cancelled — not provider health
      recordProviderError(
        providerKey,
        err instanceof ExternalTimeoutError ? "timeout" : "network",
      );
      if (isRetryableError(err) && attempt < maxRetries) {
        attempt += 1;
        retried = true;
        await abortSleep(computeBackoffMs(attempt, backoff), opts.signal);
        continue;
      }
      if (retried) recordProviderRetry(providerKey, "failed");
      breakerOnFailure(providerKey, Date.now(), opts.breaker);
      throw err;
    }
  }
}
