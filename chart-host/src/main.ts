/**
 * chart-host — the isolated container process that HOSTS the platform's one
 * chart tab.
 *
 * Scope, read literally: a Playwright-driven Chromium whose single page is
 * the app's own /chart-host route, existing only so chart snapshots can be
 * taken by that page's TradingView takeClientScreenshot. Nothing here
 * screenshots, crawls, fills forms, or touches any other URL — the session
 * layer refuses foreign navigation by name, and this process has no other
 * capability to widen.
 *
 * Control API (bearer-token, app-side only):
 *   POST /session/ensure {pageUrl}  → open/keep the tab (single-flight)
 *   POST /session/close             → tear the tab down now
 *   GET  /healthz                   → liveness + memory/lifecycle status
 *
 * Isolation is the point of the container: if the tab hangs or leaks it
 * dies here — recycled by max-age, killed by the memory cap, or the whole
 * container restarted by Docker — without ever touching the resident agent.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import {
  ChartHostSession,
  DEFAULT_ENSURE_TIMEOUT_MS,
  DEFAULT_IDLE_MS,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_MAX_MEMORY_BYTES,
  type HostBrowser,
  type HostPage,
} from "./session";

const PORT = envInt("CHART_HOST_PORT", 8787);
const APP_URL = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
const ALLOWED_PAGE = `${APP_URL}/chart-host`;

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function controlToken(): string | null {
  for (const name of ["CHART_HOST_CONTROL_TOKEN", "AICHART_SERVICE_TOKEN", "APP_SECRET"]) {
    const value = process.env[name]?.trim();
    if (value && value.length >= 16) return value;
  }
  return null;
}

function authorized(req: IncomingMessage): boolean {
  const token = controlToken();
  if (!token) return false;
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const presented = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/**
 * Container-wide memory: cgroup v2, then v1, then this process's rss. The
 * cgroup figure includes Chromium — which is what the cap is FOR.
 */
function memoryBytes(): number {
  for (const path of [
    "/sys/fs/cgroup/memory.current",
    "/sys/fs/cgroup/memory/memory.usage_in_bytes",
  ]) {
    try {
      const value = Number(readFileSync(path, "utf8").trim());
      if (Number.isFinite(value) && value > 0) return value;
    } catch {
      /* next source */
    }
  }
  return process.memoryUsage().rss;
}

/**
 * Playwright, loaded through a variable specifier on purpose: the repo's
 * main app and its typecheck NEVER resolve this module — playwright exists
 * only in this package's own node_modules inside the container image.
 */
async function launchBrowser(): Promise<HostBrowser> {
  const specifier = "playwright";
  const playwright = (await import(specifier)) as {
    chromium: {
      launch: (opts: Record<string, unknown>) => Promise<{
        newContext: (opts: Record<string, unknown>) => Promise<{
          newPage: () => Promise<HostPage>;
        }>;
        close: () => Promise<void>;
        isConnected: () => boolean;
      }>;
    };
  };
  const browser = await playwright.chromium.launch({
    headless: true,
    // dev-shm is tiny in default Docker; Chromium crashes without this.
    args: ["--disable-dev-shm-usage", "--no-first-run", "--mute-audio"],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  return {
    newPage: () => context.newPage(),
    close: () => browser.close(),
    isConnected: () => browser.isConnected(),
  };
}

const session = new ChartHostSession(
  {
    launch: launchBrowser,
    memoryBytes,
    onEvent: (event) => {
      console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
    },
  },
  {
    allowedPagePrefix: ALLOWED_PAGE,
    idleMs: envInt("CHART_HOST_IDLE_MS", DEFAULT_IDLE_MS),
    maxAgeMs: envInt("CHART_HOST_MAX_AGE_MS", DEFAULT_MAX_AGE_MS),
    maxMemoryBytes: envInt("CHART_HOST_MAX_MEMORY_BYTES", DEFAULT_MAX_MEMORY_BYTES),
    ensureTimeoutMs: envInt("CHART_HOST_ENSURE_TIMEOUT_MS", DEFAULT_ENSURE_TIMEOUT_MS),
  },
);

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new Error("body_too_large");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", "http://chart-host.local");
    if (req.method === "GET" && url.pathname === "/healthz") {
      // Liveness + the numbers the deploy checklist reads (memory with the
      // tab open vs after idle). No secrets here.
      json(res, 200, { ok: true, ...session.status() });
      return;
    }
    if (!authorized(req)) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/session/ensure") {
      let body: unknown;
      try {
        body = await readBody(req);
      } catch {
        json(res, 400, { error: "invalid_body" });
        return;
      }
      const pageUrl =
        body && typeof body === "object" && typeof (body as { pageUrl?: unknown }).pageUrl === "string"
          ? ((body as { pageUrl: string }).pageUrl)
          : null;
      if (!pageUrl) {
        json(res, 400, { error: "pageUrl required" });
        return;
      }
      const result = await session.ensure(pageUrl);
      if (!result.ok) {
        json(res, 503, { error: result.error, ...session.status() });
        return;
      }
      json(res, 200, { ok: true, ...session.status() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/session/close") {
      await session.close("requested");
      json(res, 200, { ok: true });
      return;
    }
    json(res, 404, { error: "not_found" });
  })().catch((error) => {
    json(res, 500, { error: error instanceof Error ? error.message : "internal" });
  });
});

const sweeper = setInterval(() => {
  void session.sweep();
}, 30_000);
sweeper.unref();

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ at: new Date().toISOString(), type: "shutdown", signal }));
  clearInterval(sweeper);
  await session.close("shutdown");
  server.close(() => process.exit(0));
  // A close that hangs must not keep the container alive past its grace period.
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

if (!APP_URL) {
  console.error("APP_URL is required (the origin that serves /chart-host).");
  process.exit(1);
}
if (!controlToken()) {
  console.error(
    "A control token is required: CHART_HOST_CONTROL_TOKEN, AICHART_SERVICE_TOKEN, or APP_SECRET (>=16 chars).",
  );
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(
    JSON.stringify({ at: new Date().toISOString(), type: "listening", port: PORT, page: ALLOWED_PAGE }),
  );
});
