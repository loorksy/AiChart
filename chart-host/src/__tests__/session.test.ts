/**
 * Lifecycle proofs for the chart-host session, on a FAKE browser — the real
 * Playwright launch is exercised only inside the container (deploy-side
 * verification); everything the class promises about lifecycle, locking,
 * cleanup, and named errors is provable right here.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ChartHostSession,
  type HostBrowser,
  type HostPage,
  type SessionEvent,
} from "../session";

const ALLOWED = "https://app.example.com/chart-host";

interface FakeWorld {
  launches: number;
  browsers: FakeBrowser[];
}

class FakePage implements HostPage {
  closed = false;
  currentUrl = "about:blank";
  constructor(private readonly onGoto?: (url: string) => Promise<void>) {}
  async goto(url: string): Promise<void> {
    if (this.onGoto) await this.onGoto(url);
    this.currentUrl = url;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  isClosed(): boolean {
    return this.closed;
  }
  url(): string {
    return this.currentUrl;
  }
}

class FakeBrowser implements HostBrowser {
  connected = true;
  pages: FakePage[] = [];
  constructor(private readonly onGoto?: (url: string) => Promise<void>) {}
  async newPage(): Promise<HostPage> {
    const page = new FakePage(this.onGoto);
    this.pages.push(page);
    return page;
  }
  async close(): Promise<void> {
    this.connected = false;
    for (const page of this.pages) page.closed = true;
  }
  isConnected(): boolean {
    return this.connected;
  }
}

function world(opts: { onGoto?: (url: string) => Promise<void> } = {}): {
  world: FakeWorld;
  launch: () => Promise<HostBrowser>;
} {
  const state: FakeWorld = { launches: 0, browsers: [] };
  return {
    world: state,
    launch: async () => {
      state.launches += 1;
      const browser = new FakeBrowser(opts.onGoto);
      state.browsers.push(browser);
      return browser;
    },
  };
}

describe("chart-host session lifecycle", () => {
  it("opens one tab on first ensure and reuses it while warm", async () => {
    const { world: w, launch } = world();
    let now = 1_000_000;
    const session = new ChartHostSession(
      { launch, now: () => now },
      { allowedPagePrefix: ALLOWED },
    );
    assert.deepEqual(await session.ensure(`${ALLOWED}?token=a`), { ok: true });
    now += 60_000;
    assert.deepEqual(await session.ensure(`${ALLOWED}?token=b`), { ok: true });
    assert.equal(w.launches, 1, "a warm tab is reused, never doubled");
    assert.equal(session.status().tabOpen, true);
  });

  it("concurrent ensures share ONE launch — never two tabs", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { world: w, launch } = world({ onGoto: () => gate });
    const session = new ChartHostSession({ launch }, { allowedPagePrefix: ALLOWED });
    const first = session.ensure(`${ALLOWED}?token=a`);
    const second = session.ensure(`${ALLOWED}?token=b`);
    release!();
    const [r1, r2] = await Promise.all([first, second]);
    assert.deepEqual(r1, { ok: true });
    assert.deepEqual(r2, { ok: true });
    assert.equal(w.launches, 1, "the second caller waited on the same launch");
    assert.equal(w.browsers[0]!.pages.length, 1);
  });

  it("refuses any page outside /chart-host by name", async () => {
    const { world: w, launch } = world();
    const events: SessionEvent[] = [];
    const session = new ChartHostSession(
      { launch, onEvent: (e) => events.push(e) },
      { allowedPagePrefix: ALLOWED },
    );
    for (const url of [
      "https://evil.example.com/chart-host",
      "https://app.example.com/admin",
      "https://app.example.com/chart-host/../admin",
      "not a url",
    ]) {
      const result = await session.ensure(url);
      assert.deepEqual(result, { ok: false, error: "host_navigation_refused" }, url);
    }
    assert.equal(w.launches, 0, "no browser ever launched for a refused URL");
    assert.equal(
      events.filter((e) => e.type === "refused_navigation").length,
      4,
    );
  });

  it("closes the tab after the idle window — and only then", async () => {
    const { world: w, launch } = world();
    let now = 0;
    const session = new ChartHostSession(
      { launch, now: () => now },
      { allowedPagePrefix: ALLOWED, idleMs: 300_000 },
    );
    await session.ensure(ALLOWED);
    now = 299_000;
    await session.sweep();
    assert.equal(session.status().tabOpen, true, "inside the idle window it stays");
    now = 301_000;
    await session.sweep();
    assert.equal(session.status().tabOpen, false, "past the idle window it closes");
    assert.equal(w.browsers[0]!.connected, false, "the browser is really gone");
  });

  it("recycles a tab past its maximum age instead of trusting it", async () => {
    const { world: w, launch } = world();
    let now = 0;
    const session = new ChartHostSession(
      { launch, now: () => now },
      { allowedPagePrefix: ALLOWED, maxAgeMs: 1_000_000, idleMs: 10_000_000 },
    );
    await session.ensure(ALLOWED);
    now = 1_000_001;
    assert.deepEqual(await session.ensure(ALLOWED), { ok: true });
    assert.equal(w.launches, 2, "past max age the browser is relaunched");
    assert.equal(w.browsers[0]!.connected, false, "the old one was closed, not orphaned");
    assert.equal(session.status().recycles, 1);
  });

  it("relaunches after a crashed tab rather than serving a dead one", async () => {
    const { world: w, launch } = world();
    const session = new ChartHostSession({ launch }, { allowedPagePrefix: ALLOWED });
    await session.ensure(ALLOWED);
    // Simulate a crash: the browser process dies out from under us.
    w.browsers[0]!.connected = false;
    assert.deepEqual(await session.ensure(ALLOWED), { ok: true });
    assert.equal(w.launches, 2);
  });

  it("a failed launch cleans up fully and reports host_launch_failed", async () => {
    let attempt = 0;
    const state: FakeBrowser[] = [];
    const session = new ChartHostSession(
      {
        launch: async () => {
          attempt += 1;
          if (attempt === 1) throw new Error("chromium exploded");
          const browser = new FakeBrowser();
          state.push(browser);
          return browser;
        },
      },
      { allowedPagePrefix: ALLOWED },
    );
    assert.deepEqual(await session.ensure(ALLOWED), {
      ok: false,
      error: "host_launch_failed",
    });
    assert.equal(session.status().tabOpen, false);
    assert.equal(session.status().lastError, "host_launch_failed");
    // The next ensure recovers with a fresh browser — no wedged state.
    assert.deepEqual(await session.ensure(ALLOWED), { ok: true });
  });

  it("a launch that exceeds the deadline is killed, never orphaned", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { world: w, launch } = world({ onGoto: () => gate });
    const session = new ChartHostSession(
      { launch },
      { allowedPagePrefix: ALLOWED, ensureTimeoutMs: 50 },
    );
    const result = await session.ensure(ALLOWED);
    assert.deepEqual(result, { ok: false, error: "host_launch_failed" });
    // Let the hung goto finally resolve — the late browser must be closed.
    release!();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(w.browsers[0]!.connected, false, "the late tab was closed, not orphaned");
    assert.equal(session.status().tabOpen, false);
  });

  it("memory over the cap is a named refusal AND a teardown", async () => {
    const { launch } = world();
    let memory = 100;
    const events: SessionEvent[] = [];
    const session = new ChartHostSession(
      { launch, memoryBytes: () => memory, onEvent: (e) => events.push(e) },
      { allowedPagePrefix: ALLOWED, maxMemoryBytes: 1_000 },
    );
    await session.ensure(ALLOWED);
    memory = 2_000;
    assert.deepEqual(await session.ensure(ALLOWED), {
      ok: false,
      error: "host_memory_exceeded",
    });
    assert.equal(session.status().tabOpen, false, "the leaking tab is gone");
    assert.ok(events.some((e) => e.type === "memory_exceeded"));
    // Recovery path: memory back under the cap → fresh tab.
    memory = 100;
    assert.deepEqual(await session.ensure(ALLOWED), { ok: true });
  });

  it("close is idempotent and safe mid-anything", async () => {
    const { world: w, launch } = world();
    const session = new ChartHostSession({ launch }, { allowedPagePrefix: ALLOWED });
    await session.close();
    await session.ensure(ALLOWED);
    await session.close();
    await session.close();
    assert.equal(session.status().tabOpen, false);
    assert.equal(w.browsers[0]!.connected, false);
  });
});
