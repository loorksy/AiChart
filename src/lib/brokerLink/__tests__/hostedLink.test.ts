import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "path";
import { describe, it } from "node:test";
import {
  BROKER_CATALOG,
  BROKER_PLATFORM,
  brokerById,
  brokerFromServer,
} from "@/lib/brokerLink/brokers";
import { isHostedConfigUrl } from "@/lib/brokerLink/hostedUrl";
import {
  createDraftAccount,
  createConfigurationLink,
  LONORA_MAGIC,
} from "@/lib/brokerLink/metaapiClient";

const SRC = path.join(import.meta.dirname, "..", "..", "..");

describe("broker catalog", () => {
  it("is a tap-to-pick MT5 list with unique ids and no empty servers", () => {
    const ids = new Set<string>();
    for (const broker of BROKER_CATALOG) {
      assert.equal(brokerById(broker.id)?.server, broker.server);
      assert.ok(broker.server.trim().length > 0);
      assert.equal(ids.has(broker.id), false);
      ids.add(broker.id);
    }
    assert.equal(BROKER_PLATFORM, "mt5");
    assert.ok(BROKER_CATALOG.length >= 2);
    assert.equal(brokerFromServer("MyBroker-MT5")?.server, "MyBroker-MT5");
    assert.equal(brokerFromServer("bad server"), null);
  });
});

describe("hosted configuration URL allowlist", () => {
  it("accepts only MetaAPI credential pages", () => {
    assert.equal(
      isHostedConfigUrl(
        "https://app.metaapi.cloud/configure-trading-account-credentials/abc/token",
      ),
      true,
    );
    assert.equal(
      isHostedConfigUrl("https://evil.example/configure-trading-account-credentials/abc"),
      false,
    );
    assert.equal(isHostedConfigUrl("https://app.metaapi.cloud/elsewhere"), false);
    assert.equal(isHostedConfigUrl("http://app.metaapi.cloud/configure-trading-account-credentials/x"), false);
  });
});

describe("MetaAPI client never sends credentials", () => {
  it("createDraftAccount posts platform+server without login or password", async () => {
    const bodies: string[] = [];
    const restore = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ id: "acct-1", state: "DRAFT" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const broker = brokerById("exness-mt5");
      assert.ok(broker);
      const created = await createDraftAccount({
        token: "tok",
        userId: 7,
        broker,
        transactionId: "a".repeat(32),
      });
      assert.equal(created.id, "acct-1");
      assert.equal(created.state, "DRAFT");
      assert.equal(bodies.length, 1);
      const payload = JSON.parse(bodies[0]!) as Record<string, unknown>;
      assert.equal("login" in payload, false);
      assert.equal("password" in payload, false);
      assert.equal(payload.platform, "mt5");
      assert.equal(payload.server, broker.server);
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
      return new Response(JSON.stringify({ id: "acct-2", state: "DRAFT" }), {
        status: 201,
      });
    }) as typeof fetch;
    try {
      const broker = brokerById("icmarkets-mt5")!;
      const created = await createDraftAccount({
        token: "tok",
        userId: 1,
        broker,
        transactionId: "b".repeat(32),
      });
      assert.equal(created.id, "acct-2");
      assert.deepEqual(txIds, ["b".repeat(32), "b".repeat(32)]);
    } finally {
      globalThis.fetch = restore;
    }
  });

  it("rejects a configuration link that is not the hosted credentials page", async () => {
    const restore = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          configurationLink: "https://evil.example/phish",
        }),
        { status: 200 },
      )) as typeof fetch;
    try {
      await assert.rejects(
        () => createConfigurationLink({ token: "tok", accountId: "acct-1" }),
        /not hosted/,
      );
    } finally {
      globalThis.fetch = restore;
    }
  });
});

describe("hosted-link route is session-auth and never a password form", () => {
  it("the API and card never collect a password; broker is picked then MetaAPI is iframed", () => {
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
    assert.match(route, /requireUser/);
    assert.doesNotMatch(route, /resolveBridgeUserId/);
    assert.doesNotMatch(route, /password/);
    assert.match(route, /brokerId/);
    assert.match(route, /replaceBrokerLink/);
    assert.match(card, /<iframe/);
    assert.match(card, /BROKER_CATALOG/);
    assert.match(card, /Dialog\.Root/);
    assert.doesNotMatch(card, /type=["']password["']/);
    assert.doesNotMatch(card, /json\.error/);
    assert.match(card, /metaapi_balance/);
    assert.match(client, /No login\/password/);
    assert.doesNotMatch(client, /\/trade/);
    assert.match(client, /method: "DELETE"/);
  });

  it("creates a new draft when the chosen broker differs from the stored one", () => {
    const route = readFileSync(
      path.join(SRC, "app/api/integrations/broker/route.ts"),
      "utf8",
    );
    const post = route.slice(route.indexOf("export async function POST"));
    assert.match(post, /needsNew/);
    assert.match(post, /persistDraft/);
    assert.match(post, /createConfigurationLink/);
    assert.match(route, /deleteAccount/);
  });
});
