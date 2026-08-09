import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ExternalTimeoutError,
  fetchWithTimeout,
  IdleWatchdog,
} from "../externalFetch";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test("fetchWithTimeout aborts a hung request and throws ExternalTimeoutError", async () => {
  const originalFetch = globalThis.fetch;
  // Simulate an upstream that never responds until aborted.
  globalThis.fetch = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    })) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        fetchWithTimeout("https://example.invalid", {}, { timeoutMs: 30, label: "test" }),
      (err: unknown) => err instanceof ExternalTimeoutError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithTimeout returns the response when it resolves in time", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("ok")) as typeof fetch;
  try {
    const res = await fetchWithTimeout("https://example.invalid", {}, { timeoutMs: 500 });
    assert.equal(await res.text(), "ok");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithTimeout propagates caller abort without masking as timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    })) as typeof fetch;
  const caller = new AbortController();
  setTimeout(() => caller.abort(), 20);
  try {
    await assert.rejects(
      () =>
        fetchWithTimeout(
          "https://example.invalid",
          { signal: caller.signal },
          { timeoutMs: 10_000, label: "test" },
        ),
      (err: unknown) => !(err instanceof ExternalTimeoutError),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("IdleWatchdog aborts only after inactivity, and kick() resets the timer", async () => {
  // Leave enough headroom for a busy parallel test runner: this test verifies
  // reset semantics, not the host scheduler's millisecond precision.
  const wd = new IdleWatchdog(500, "test");
  const signal = wd.start();
  assert.equal(signal.aborted, false);

  // Keep kicking before the idle window elapses → must stay alive.
  for (let i = 0; i < 4; i++) {
    await delay(50);
    wd.kick();
  }
  assert.equal(wd.timedOut, false, "should not time out while progressing");

  // Stop kicking → should abort after idle window.
  await delay(650);
  assert.equal(wd.timedOut, true, "should time out after inactivity");
  assert.equal(signal.aborted, true);
  wd.clear();
});
