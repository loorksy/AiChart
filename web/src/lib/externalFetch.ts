/**
 * Hardened fetch wrappers for outbound third-party calls (LLM providers,
 * embeddings, broker HTTP). Without an explicit timeout, a hung upstream
 * connection blocks the request/worker indefinitely and exhausts the pool —
 * a real cloud-scale failure mode. Every external call must be bounded.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Total budget for a single non-streaming generation call. */
export function llmTotalTimeoutMs(): number {
  return envInt("LLM_TIMEOUT_MS", 120_000);
}

/** Idle budget for streaming: aborts only after this long with NO new bytes. */
export function llmIdleTimeoutMs(): number {
  return envInt("LLM_IDLE_TIMEOUT_MS", 60_000);
}

/** Default budget for short request/response HTTP (model listing, embeddings, broker). */
export function httpTimeoutMs(): number {
  return envInt("HTTP_TIMEOUT_MS", 30_000);
}

export class ExternalTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`انتهت مهلة الاتصال بـ ${label} بعد ${ms}ms — حاول مرة أخرى.`);
    this.name = "ExternalTimeoutError";
  }
}

/**
 * fetch() with a hard total timeout via AbortController. Resolves once the
 * response headers arrive; for streamed bodies use {@link IdleWatchdog}.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  opts: { timeoutMs?: number; label?: string } = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? httpTimeoutMs();
  const label = opts.label ?? "الخدمة الخارجية";
  const controller = new AbortController();
  const caller = init.signal;
  if (caller) {
    if (caller.aborted) controller.abort();
    else caller.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted && !(caller?.aborted)) {
      throw new ExternalTimeoutError(label, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Inactivity watchdog for streaming reads. Start it, pass `.signal` to fetch,
 * call `.kick()` after every successful chunk, and `.clear()` when finished.
 * Aborts the stream only after `idleMs` elapse with no progress, so healthy
 * long generations are never cut off while truly hung sockets are released.
 */
export class IdleWatchdog {
  readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private aborted = false;

  constructor(
    private readonly idleMs: number,
    private readonly label = "البث",
  ) {}

  /** Begin watching and return the signal to hand to fetch(). */
  start(): AbortSignal {
    this.kick();
    return this.controller.signal;
  }

  /** Reset the idle timer — call after each chunk of progress. */
  kick(): void {
    if (this.aborted) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.aborted = true;
      this.controller.abort();
    }, this.idleMs);
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** True when the abort was triggered by inactivity (not the caller). */
  get timedOut(): boolean {
    return this.aborted;
  }

  error(): ExternalTimeoutError {
    return new ExternalTimeoutError(this.label, this.idleMs);
  }
}
