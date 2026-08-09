import assert from "node:assert/strict";
import { test } from "node:test";

process.env.MT5_BRIDGE_URL = "http://mt5.local";

import {
  mt5Close,
  mt5Order,
  mt5Status,
} from "../mt5local/client";

interface Captured {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

function mockFetch(): { calls: Captured[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify({ ok: true, closed: [], errors: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("mt5Order pins the request to the caller's account login + server", async () => {
  const { calls, restore } = mockFetch();
  try {
    await mt5Order(
      { login: "555", server: "Exness-Real7" },
      { symbol: "EURUSD", side: "buy", lots: 0.1 },
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/order$/);
    assert.equal(calls[0]!.method, "POST");
    assert.equal(calls[0]!.body?.login, "555");
    assert.equal(calls[0]!.body?.server, "Exness-Real7");
    assert.equal(calls[0]!.body?.symbol, "EURUSD");
  } finally {
    restore();
  }
});

test("mt5Close pins the close request to the account login", async () => {
  const { calls, restore } = mockFetch();
  try {
    await mt5Close({ login: 999 }, { ticket: 42 });
    assert.equal(calls[0]!.body?.login, "999");
    assert.equal(calls[0]!.body?.ticket, 42);
  } finally {
    restore();
  }
});

test("mt5Status carries the account login in the query string", async () => {
  const { calls, restore } = mockFetch();
  try {
    await mt5Status({ login: "777", server: "Exness-Real7" });
    assert.match(calls[0]!.url, /\/status\?/);
    assert.match(calls[0]!.url, /login=777/);
    assert.match(calls[0]!.url, /server=Exness-Real7/);
  } finally {
    restore();
  }
});
