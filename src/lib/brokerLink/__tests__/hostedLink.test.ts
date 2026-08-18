import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "path";
import { describe, it } from "node:test";
import {
  BROKER_PLATFORM,
  brokerIdForServer,
  normalizeLogin,
  normalizeServer,
} from "@/lib/brokerLink/brokers";
import {
  createTradingAccount,
  LONORA_MAGIC,
} from "@/lib/brokerLink/metaapiClient";

const SRC = path.join(import.meta.dirname, "..", "..", "..");

describe("typed MT5 server", () => {
  it("accepts a typed broker server name", () => {
    assert.equal(BROKER_PLATFORM, "mt5");
    assert.equal(normalizeServer("ICMarketsSC-MT5"), "ICMarketsSC-MT5");
    assert.equal(normalizeServer("MyBroker-MT5"), "MyBroker-MT5");
    assert.equal(normalizeServer("XMGlobal-MT5 2"), "XMGlobal-MT5 2");
    assert.equal(normalizeServer("bad@server"), null);
    assert.equal(normalizeServer(""), null);
    assert.equal(normalizeLogin("50194988"), "50194988");
    assert.equal(normalizeLogin("bad login!"), null);
    assert.equal(brokerIdForServer("Exness-MT5Real"), "server:exness-mt5real");
  });
});

describe("MetaAPI client forwards credentials once and never trades", () => {
  it("createTradingAccount posts server+login+password without storing extras", async () => {
    const bodies: string[] = [];
    const restore = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ id: "acct-1", state: "DEPLOYED" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const created = await createTradingAccount({
        token: "tok",
        userId: 7,
        server: "ICMarketsSC-MT5",
        login: "50194988",
        password: "secret-pass",
        transactionId: "a".repeat(32),
      });
      assert.equal(created.id, "acct-1");
      assert.equal(created.state, "DEPLOYED");
      assert.equal(bodies.length, 1);
      const payload = JSON.parse(bodies[0]!) as Record<string, unknown>;
      assert.equal(payload.login, "50194988");
      assert.equal(payload.password, "secret-pass");
      assert.equal(payload.platform, "mt5");
      assert.equal(payload.server, "ICMarketsSC-MT5");
      assert.equal(payload.magic, LONORA_MAGIC);
      assert.equal(payload.type, "cloud-g1");
      assert.equal(payload.reliability, "regular");
    } finally {
      globalThis.fetch = restore;
    }
  });

  it("retries a 202 with the same transaction id", async () => {
    const txIds: string[] = [];
    let n = 0;
    const restore = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      txIds.push(headers.get("transaction-id") ?? "");
      n += 1;
      if (n === 1) {
        return new Response(JSON.stringify({ message: "retry" }), {
          status: 202,
          headers: { "retry-after": "0" },
        });
      }
      return new Response(JSON.stringify({ id: "acct-2", state: "DEPLOYED" }), {
        status: 201,
      });
    }) as typeof fetch;
    try {
      const created = await createTradingAccount({
        token: "tok",
        userId: 1,
        server: "Exness-MT5Real",
        login: "1",
        password: "x",
        transactionId: "b".repeat(32),
      });
      assert.equal(created.id, "acct-2");
      assert.deepEqual(txIds, ["b".repeat(32), "b".repeat(32)]);
    } finally {
      globalThis.fetch = restore;
    }
  });
});

describe("in-app MetaTrader form never stores the password", () => {
  it("forwards password to MetaAPI only and never writes it to broker_links", () => {
    const route = readFileSync(
      path.join(SRC, "app/api/integrations/broker/route.ts"),
      "utf8",
    );
    const card = readFileSync(
      path.join(SRC, "components/settings/BrokerLinkCard.tsx"),
      "utf8",
    );
    const client = readFileSync(
      path.join(SRC, "lib/brokerLink/metaapiClient.ts"),
      "utf8",
    );
    const store = readFileSync(
      path.join(SRC, "lib/brokerLink/store.ts"),
      "utf8",
    );
    const sqlite = readFileSync(path.join(SRC, "lib/db/sqlite.ts"), "utf8");
    const brokers = readFileSync(
      path.join(SRC, "lib/brokerLink/brokers.ts"),
      "utf8",
    );
    assert.equal(
      existsSync(path.join(SRC, "lib/brokerLink/hostedUrl.ts")),
      false,
    );
    assert.doesNotMatch(brokers, /BROKER_CATALOG/);
    assert.match(route, /requireUser/);
    assert.doesNotMatch(route, /resolveBridgeUserId/);
    assert.match(route, /password: z\.string/);
    assert.match(route, /createTradingAccount/);
    assert.doesNotMatch(route, /insertBrokerLink\([\s\S]*password/);
    assert.doesNotMatch(route, /configurationLink/);
    assert.doesNotMatch(card, /<iframe/);
    assert.doesNotMatch(card, /BROKER_CATALOG/);
    assert.doesNotMatch(card, /Dialog\.Root/);
    assert.match(card, /type=\{showPassword \? "text" : "password"\}/);
    assert.match(card, /connect\.broker\.server/);
    assert.match(card, /MetaTraderMark/);
    assert.doesNotMatch(card, /connect\.broker\.draft/);
    assert.match(card, /items-center/);
    assert.match(card, /border-border bg-background/);
    assert.match(
      readFileSync(
        path.join(SRC, "components/settings/MetaTraderMark.tsx"),
        "utf8",
      ),
      /\/brand\/metatrader-5\.svg/,
    );
    assert.match(
      readFileSync(
        path.join(SRC, "components/settings/MetaTraderMark.tsx"),
        "utf8",
      ),
      /h-8 w-auto/,
    );
    assert.match(card, /dir=\{dir\}/);
    assert.match(card, /lang=\{locale\}/);
    assert.doesNotMatch(card, /dir="ltr"/);
    assert.equal(
      existsSync(path.join(SRC, "..", "public/brand/metatrader-5.svg")),
      true,
    );
    assert.doesNotMatch(store, /password/);
    assert.doesNotMatch(sqlite, /password_enc/);
    assert.match(sqlite, /CREATE TABLE IF NOT EXISTS broker_links/);
    assert.doesNotMatch(client, /\/trade/);
    assert.match(client, /password: input\.password/);
  });
});
