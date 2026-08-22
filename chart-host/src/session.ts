/**
 * The chart-host session lifecycle — the ONLY place in the whole product
 * where a browser-automation process exists, under a deliberately narrow
 * contract:
 *
 *   one Playwright-hosted Chromium, one page, one allowed URL — the
 *   platform's own /chart-host page — for one purpose: hosting the
 *   TradingView widget whose takeClientScreenshot produces chart snapshots.
 *
 * This module never captures anything itself. There is no page.screenshot,
 * no PDF, no CDP session, no navigation anywhere else — a pageUrl outside
 * the allowed prefix is refused BY NAME (host_navigation_refused), not
 * normalized. The page does its own work by polling the app like any tab.
 *
 * Lifecycle rules (all configurable, all enforced here):
 *  - opened on first ensure, kept warm while ensures keep arriving;
 *  - closed after `idleMs` without an ensure (default 5 minutes);
 *  - recycled when older than `maxAgeMs` — long-lived browser sessions leak;
 *  - closed with a NAMED error when container memory exceeds `maxMemoryBytes`;
 *  - concurrent ensures share ONE launch (single-flight), never two pages;
 *  - close is safe and idempotent, including after a crash mid-launch — no
 *    orphan browser survives an error path.
 */

export interface HostPage {
  goto(url: string): Promise<unknown>;
  close(): Promise<void>;
  isClosed(): boolean;
  url(): string;
}

export interface HostBrowser {
  newPage(): Promise<HostPage>;
  close(): Promise<void>;
  isConnected(): boolean;
}

export interface SessionEvent {
  type:
    | "launched"
    | "closed"
    | "recycled"
    | "refused_navigation"
    | "launch_failed"
    | "memory_exceeded";
  detail?: string;
}

export interface SessionDeps {
  launch: () => Promise<HostBrowser>;
  now?: () => number;
  /** Container-wide memory (cgroup) when available, else process rss. */
  memoryBytes?: () => number;
  onEvent?: (event: SessionEvent) => void;
}

export interface SessionConfig {
  /** The one allowed page: `${APP_URL}/chart-host`. Prefix-matched, origin included. */
  allowedPagePrefix: string;
  idleMs: number;
  maxAgeMs: number;
  maxMemoryBytes: number;
  ensureTimeoutMs: number;
}

export const DEFAULT_IDLE_MS = 5 * 60 * 1000;
export const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_MAX_MEMORY_BYTES = 1_500 * 1024 * 1024;
export const DEFAULT_ENSURE_TIMEOUT_MS = 30_000;

export type EnsureError =
  | "host_navigation_refused"
  | "host_launch_failed"
  | "host_memory_exceeded";

export interface SessionStatus {
  tabOpen: boolean;
  pageUrl: string | null;
  launchedAt: number | null;
  lastEnsureAt: number | null;
  ageMs: number | null;
  idleMs: number | null;
  memoryBytes: number | null;
  ensures: number;
  recycles: number;
  lastError: string | null;
}

interface OpenState {
  browser: HostBrowser;
  page: HostPage;
  pageUrl: string;
  launchedAt: number;
}

const TIMED_OUT = Symbol("ensure_timed_out");

export class ChartHostSession {
  private readonly deps: SessionDeps;
  private readonly config: SessionConfig;
  private open: OpenState | null = null;
  private launching: Promise<{ ok: true } | { ok: false; error: EnsureError }> | null = null;
  private lastEnsureAt: number | null = null;
  private ensures = 0;
  private recycles = 0;
  private lastError: string | null = null;

  constructor(deps: SessionDeps, config: Partial<SessionConfig> & { allowedPagePrefix: string }) {
    this.deps = deps;
    this.config = {
      allowedPagePrefix: config.allowedPagePrefix,
      idleMs: config.idleMs ?? DEFAULT_IDLE_MS,
      maxAgeMs: config.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
      maxMemoryBytes: config.maxMemoryBytes ?? DEFAULT_MAX_MEMORY_BYTES,
      ensureTimeoutMs: config.ensureTimeoutMs ?? DEFAULT_ENSURE_TIMEOUT_MS,
    };
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private memory(): number | null {
    try {
      return this.deps.memoryBytes ? this.deps.memoryBytes() : null;
    } catch {
      return null;
    }
  }

  private emit(event: SessionEvent): void {
    try {
      this.deps.onEvent?.(event);
    } catch {
      /* observers never break the session */
    }
  }

  /**
   * The single allowed navigation target. A refused URL is an ERROR, never a
   * silent rewrite — the container must be impossible to repurpose.
   */
  private navigationAllowed(pageUrl: string): boolean {
    let candidate: URL;
    let allowed: URL;
    try {
      candidate = new URL(pageUrl);
      allowed = new URL(this.config.allowedPagePrefix);
    } catch {
      return false;
    }
    return (
      candidate.origin === allowed.origin &&
      candidate.pathname === allowed.pathname
    );
  }

  /** Open (or keep) the one tab. Concurrent callers share one launch. */
  async ensure(pageUrl: string): Promise<{ ok: true } | { ok: false; error: EnsureError }> {
    this.ensures += 1;
    if (!this.navigationAllowed(pageUrl)) {
      this.lastError = "host_navigation_refused";
      this.emit({ type: "refused_navigation", detail: pageUrl });
      return { ok: false, error: "host_navigation_refused" };
    }

    // Memory over the cap is a NAMED refusal and a teardown, not a hang. The
    // next ensure starts a fresh browser.
    const memory = this.memory();
    if (memory != null && memory > this.config.maxMemoryBytes) {
      this.lastError = "host_memory_exceeded";
      this.emit({ type: "memory_exceeded", detail: String(memory) });
      await this.close("memory_exceeded");
      return { ok: false, error: "host_memory_exceeded" };
    }

    const now = this.now();
    this.lastEnsureAt = now;

    if (this.open) {
      const alive =
        this.open.browser.isConnected() && !this.open.page.isClosed();
      const aged = now - this.open.launchedAt > this.config.maxAgeMs;
      if (alive && !aged) {
        return { ok: true };
      }
      // Hung, crashed, or past its maximum age — recycle rather than trust it.
      this.recycles += 1;
      this.emit({ type: "recycled", detail: aged ? "max_age" : "dead_tab" });
      await this.close(aged ? "max_age" : "dead_tab");
    }

    if (this.launching) return this.launching;

    this.launching = this.launchOnce(pageUrl).finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  private async launchOnce(
    pageUrl: string,
  ): Promise<{ ok: true } | { ok: false; error: EnsureError }> {
    let browser: HostBrowser | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const work = (async () => {
        browser = await this.deps.launch();
        const page = await browser.newPage();
        await page.goto(pageUrl);
        return { browser: browser!, page };
      })();
      const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), this.config.ensureTimeoutMs);
      });
      const result = await Promise.race([work, deadline]);
      if (result === TIMED_OUT) {
        // The tab may still materialize later — kill it; a half-open browser
        // with no owner is exactly the orphan this class exists to prevent.
        work.then(({ browser: b }) => void b.close().catch(() => {})).catch(() => {});
        if (browser) await (browser as HostBrowser).close().catch(() => {});
        this.lastError = "host_launch_failed";
        this.emit({ type: "launch_failed", detail: "timeout" });
        return { ok: false, error: "host_launch_failed" };
      }
      this.open = {
        browser: result.browser,
        page: result.page,
        pageUrl,
        launchedAt: this.now(),
      };
      this.lastError = null;
      this.emit({ type: "launched" });
      return { ok: true };
    } catch (error) {
      if (browser) await (browser as HostBrowser).close().catch(() => {});
      this.lastError = "host_launch_failed";
      this.emit({
        type: "launch_failed",
        detail: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, error: "host_launch_failed" };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Idle/age/memory sweep — called on an interval by the server. Lazy checks
   * on ensure() alone would let an abandoned tab live forever.
   */
  async sweep(): Promise<void> {
    if (!this.open) return;
    const now = this.now();
    // `!= null`, not truthiness: an ensure at clock 0 (tests, frozen clocks)
    // must still start the idle window.
    if (this.lastEnsureAt != null && now - this.lastEnsureAt > this.config.idleMs) {
      this.emit({ type: "closed", detail: "idle" });
      await this.close("idle");
      return;
    }
    if (now - this.open.launchedAt > this.config.maxAgeMs) {
      this.recycles += 1;
      this.emit({ type: "recycled", detail: "max_age" });
      await this.close("max_age");
      return;
    }
    const memory = this.memory();
    if (memory != null && memory > this.config.maxMemoryBytes) {
      this.lastError = "host_memory_exceeded";
      this.emit({ type: "memory_exceeded", detail: String(memory) });
      await this.close("memory_exceeded");
      return;
    }
    if (!this.open.browser.isConnected() || this.open.page.isClosed()) {
      this.emit({ type: "closed", detail: "dead_tab" });
      await this.close("dead_tab");
    }
  }

  /** Safe, idempotent teardown — never throws, never leaves a live browser. */
  async close(reason = "requested"): Promise<void> {
    const open = this.open;
    this.open = null;
    if (!open) return;
    try {
      if (!open.page.isClosed()) await open.page.close();
    } catch {
      /* page already gone */
    }
    try {
      await open.browser.close();
    } catch {
      /* browser already gone */
    }
    this.emit({ type: "closed", detail: reason });
  }

  status(): SessionStatus {
    const now = this.now();
    return {
      tabOpen: Boolean(
        this.open && this.open.browser.isConnected() && !this.open.page.isClosed(),
      ),
      // Origin + path only. The full URL carries the page's capability token
      // in its query, and /healthz is unauthenticated — a status endpoint
      // must never hand out the credential that operates the tab.
      pageUrl: this.open ? redactPageUrl(this.open.pageUrl) : null,
      launchedAt: this.open?.launchedAt ?? null,
      ageMs: this.open ? now - this.open.launchedAt : null,
      lastEnsureAt: this.lastEnsureAt,
      idleMs: this.lastEnsureAt != null ? now - this.lastEnsureAt : null,
      memoryBytes: this.memory(),
      ensures: this.ensures,
      recycles: this.recycles,
      lastError: this.lastError,
    };
  }
}

/** The page URL with its query (the capability token) stripped. */
export function redactPageUrl(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[unparseable]";
  }
}
