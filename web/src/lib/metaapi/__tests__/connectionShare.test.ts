import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Two browser sessions of the same user must share one MetaApi connection.
 * The caches in client.ts are the choke point — this test locks the contract
 * in source so a future "helpful" clear on heartbeat cannot reintroduce the
 * second-tab disconnect.
 */
describe("MetaApi connection sharing (N1)", () => {
  const clientSrc = readFileSync(
    path.join(__dirname, "../client.ts"),
    "utf8",
  );

  it("keys rpc and account caches by userId", () => {
    assert.match(clientSrc, /rpcCache = new Map<number/);
    assert.match(clientSrc, /accountCache = new Map<number/);
  });

  it("reuses an in-flight connection for the same account id", () => {
    assert.match(clientSrc, /rpcAccountIds\.get\(userId\) === metaapiAccountId/);
    assert.match(clientSrc, /if \(cached && rpcAccountIds/);
  });

  it("does not clear the rpc cache from the presence heartbeat", () => {
    const heartbeat = readFileSync(
      path.join(__dirname, "../../../app/api/mt5/heartbeat/route.ts"),
      "utf8",
    );
    assert.equal(heartbeat.includes("clearRpcCache"), false);
  });
});
