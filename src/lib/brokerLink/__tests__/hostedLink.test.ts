import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "path";
import { describe, it } from "node:test";
import { DEFAULT_BROKER, BROKER_PLATFORM } from "@/lib/brokerLink/brokers";
import { isHostedConfigUrl } from "@/lib/brokerLink/hostedUrl";
import {
  createDraftAccount,
  createConfigurationLink,
  LONORA_MAGIC,
} from "@/lib/brokerLink/metaapiClient";

const SRC = path.join(import.meta.dirname, "..", "..", "..");

describe("silent default broker", () => {
  it("hardcodes MT5 server so Lonora never shows a broker form", () => {
    assert.equal(BROKER_PLATFORM, "mt5");
    assert.ok(DEFAULT_BROKER.server.trim().length > 0);
    assert.equal(DEFAULT_BROKER.id, "icmarkets-mt5");
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
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ id: "acct-1", state: "DRAFT" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const created = await createDraftAccount({
        token: "tok",
        userId: 7,
        broker: DEFAULT_BROKER,
        transactionId: "a".repeat(32),
      });
      assert.equal(created.id, "acct-1");
      assert.equal(created.state, "DRAFT");
      assert.equal(bodies.length, 1);
      const payload = JSON.parse(bodies[0]!) as Record<string, unknown>;
      assert.equal("login" in payload, false);
      assert.equal("password" in payload, false);
      assert.equal(payload.platform, "mt5");
      assert.equal(payload.server, DEFAULT_BROKER.server);
      assert.equal(payload.magic, LONORA_MAGIC);
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
      const created = await createDraftAccount({
        token: "tok",
        userId: 1,
        broker: DEFAULT_BROKER,
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

describe("hosted-link route is session-auth and never a Lonora form", () => {
  it("the API and card never collect broker, login, or password", () => {
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
    const brokers = readFileSync(
      path.join(SRC, "lib/brokerLink/brokers.ts"),
      "utf8",
    );
    assert.match(route, /requireUser/);
    assert.doesNotMatch(route, /resolveBridgeUserId/);
    assert.doesNotMatch(route, /password/);
    assert.doesNotMatch(route, /await req\.json/);
    assert.doesNotMatch(route, /export async function POST\(req/);
    assert.match(route, /DEFAULT_BROKER/);
    assert.doesNotMatch(card, /type=["']password["']/);
    assert.doesNotMatch(card, /<iframe/);
    assert.doesNotMatch(card, /<input/);
    assert.doesNotMatch(card, /<select/);
    assert.doesNotMatch(card, /brokers\.map/);
    assert.doesNotMatch(card, /brokerId/);
    assert.match(card, /window\.open/);
    assert.match(card, /method: "POST"/);
    assert.match(client, /No login\/password/);
    assert.doesNotMatch(client, /\/trade/);
    assert.match(route, /createDraftAccount/);
    assert.match(route, /getBrokerLink/);
    assert.doesNotMatch(brokers, /BROKER_CATALOG/);
    assert.doesNotMatch(brokers, /brokerById/);
  });

  it("reuses the stored account id instead of creating a second one", () => {
    const route = readFileSync(
      path.join(SRC, "app/api/integrations/broker/route.ts"),
      "utf8",
    );
    const post = route.slice(route.indexOf("export async function POST"));
    assert.match(post, /if \(!row\)/);
    assert.match(post, /createDraftAccount/);
    assert.match(post, /createConfigurationLink/);
    const createIdx = post.indexOf("createDraftAccount");
    const reuseIdx = post.indexOf("if (!row)");
    assert.ok(reuseIdx < createIdx, "create only after a missing row");
  });
});
