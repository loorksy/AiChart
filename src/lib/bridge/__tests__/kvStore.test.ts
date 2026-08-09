import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCachedAsync,
  setCachedAsync,
} from "@/lib/bridge/cache";
import {
  checkWriteRateLimitAsync,
} from "@/lib/bridge/rateLimit";
import { resetBridgeKvStoreForTests } from "@/lib/bridge/store";

describe("BridgeKvStore (memory)", () => {
  it("caches and retrieves values", async () => {
    resetBridgeKvStoreForTests();
    delete process.env.REDIS_URL;

    await setCachedAsync(1, "ohlc:EURUSD:1h", { ok: true }, 5000);
    const hit = await getCachedAsync<{ ok: boolean }>(1, "ohlc:EURUSD:1h");
    assert.equal(hit.fromCache, true);
    if (hit.fromCache) assert.equal(hit.value.ok, true);
  });

  it("enforces write rate limit", async () => {
    resetBridgeKvStoreForTests();
    delete process.env.REDIS_URL;
    process.env.BRIDGE_RATE_LIMIT_WRITES = "2";

    const route = "/api/agent/trade/open";
    assert.equal((await checkWriteRateLimitAsync(9, route)).allowed, true);
    assert.equal((await checkWriteRateLimitAsync(9, route)).allowed, true);
    const denied = await checkWriteRateLimitAsync(9, route);
    assert.equal(denied.allowed, false);
    if (!denied.allowed) {
      assert.ok(denied.retryAfterMs >= 0);
    }

    delete process.env.BRIDGE_RATE_LIMIT_WRITES;
  });
});
