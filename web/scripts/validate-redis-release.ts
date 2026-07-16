import assert from "node:assert/strict";
import crypto from "node:crypto";
import IORedis from "ioredis";
import {
  bridgeRedisKey,
  getBridgeKvStore,
  resetBridgeKvStoreForTests,
} from "../src/lib/bridge/store";
import {
  clearEaLiveQuotesForTests,
  getEaLiveQuote,
  updateEaLiveQuotes,
} from "../src/lib/eaLiveState";

const configuredRedisUrl = process.env.REDIS_URL?.trim();
if (!configuredRedisUrl) {
  throw new Error("REDIS_URL is required");
}
const redisUrl: string = configuredRedisUrl;

const parsedUrl = new URL(redisUrl);
assert.equal(
  parsedUrl.port,
  "6380",
  "Refusing to run Redis release validation outside isolated port 6380",
);
assert.ok(parsedUrl.password, "The isolated Redis release test must require auth");

const phase = process.argv[2] ?? "roundtrip";
const namespace = `aichart-release-${crypto.randomUUID()}`;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await delay(100);
  }
  assert.ok(predicate(), `condition was not met within ${timeoutMs}ms`);
}

async function authenticatedClient(): Promise<IORedis> {
  const client = new IORedis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    retryStrategy: () => null,
  });
  await client.ping();
  return client;
}

async function proveAuthentication(): Promise<void> {
  const unauthenticated = new IORedis({
    host: parsedUrl.hostname,
    port: Number(parsedUrl.port),
    db: Number(parsedUrl.pathname.slice(1) || 0),
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    retryStrategy: () => null,
  });
  unauthenticated.on("error", () => {
    // The expected NOAUTH response is asserted below. Suppress ioredis' default
    // unhandled-error logging so release output contains only deliberate proof.
  });
  try {
    await assert.rejects(unauthenticated.ping(), /NOAUTH/);
  } finally {
    unauthenticated.disconnect();
  }
}

function configObject(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (key && value !== undefined) result[key] = value;
  }
  return result;
}

async function roundtrip(): Promise<void> {
  const client = await authenticatedClient();
  try {
    await proveAuthentication();
    const configValues = (await client.config(
        "GET",
        "appendonly",
        "appendfsync",
        "maxmemory-policy",
      )) as string[];
    const config = configObject(configValues);
    assert.equal(config.appendonly, "yes");
    assert.equal(config.appendfsync, "everysec");
    assert.equal(config["maxmemory-policy"], "noeviction");

    const basicKey = `${namespace}:basic`;
    await client.set(basicKey, "ok", "PX", 30_000);
    assert.equal(await client.get(basicKey), "ok");
    assert.equal(await client.del(basicKey), 1);
    assert.equal(await client.get(basicKey), null);

    const store = getBridgeKvStore();
    const tenantOneKey = bridgeRedisKey("cache", [
      namespace,
      "tenant",
      "101",
      "session-a",
    ]);
    const tenantTwoKey = bridgeRedisKey("cache", [
      namespace,
      "tenant",
      "202",
      "session-b",
    ]);
    await store.set(tenantOneKey, "tenant-one", 30_000);
    await store.set(tenantTwoKey, "tenant-two", 30_000);
    assert.equal(await store.get(tenantOneKey), "tenant-one");
    assert.equal(await store.get(tenantTwoKey), "tenant-two");
    assert.notEqual(await store.get(tenantOneKey), await store.get(tenantTwoKey));

    const rateKey = bridgeRedisKey("rl", [namespace, "tenant", "101"]);
    assert.equal((await store.checkSlidingWindow(rateKey, 10_000, 2)).allowed, true);
    assert.equal((await store.checkSlidingWindow(rateKey, 10_000, 2)).allowed, true);
    assert.equal((await store.checkSlidingWindow(rateKey, 10_000, 2)).allowed, false);

    await updateEaLiveQuotes(101, [
      { symbol: "EURUSD", bid: 1.08, ask: 1.0802 },
    ]);
    await updateEaLiveQuotes(202, [
      { symbol: "XAUUSD", bid: 2300, ask: 2300.2 },
    ]);
    clearEaLiveQuotesForTests();
    assert.equal((await getEaLiveQuote(101, "EURUSD"))?.bid, 1.08);
    assert.equal(await getEaLiveQuote(101, "XAUUSD"), null);
    assert.equal((await getEaLiveQuote(202, "XAUUSD"))?.ask, 2300.2);

    const queue = await import("../src/lib/queue");
    let postMortemCount = 0;
    let retryAttempts = 0;
    let retryPayload:
      | {
          userId: number;
          analysisId: string;
          sessionId: string;
          generation: number;
        }
      | undefined;

    queue.registerHandler("trade_post_mortem", async () => {
      postMortemCount += 1;
    });
    queue.registerHandler("deep_analysis_poll", async (payload) => {
      retryAttempts += 1;
      if (retryAttempts === 1) throw new Error("intentional retry proof");
      retryPayload = payload;
    });
    await queue.startWorker();

    const idempotencyKey = `${namespace}:post-mortem`;
    await queue.enqueue(
      "trade_post_mortem",
      { userId: 101, tradeId: 55, pnl: 2 },
      { idempotencyKey },
    );
    await queue.enqueue(
      "trade_post_mortem",
      { userId: 101, tradeId: 55, pnl: 2 },
      { idempotencyKey },
    );
    await queue.enqueue("deep_analysis_poll", {
      userId: 202,
      analysisId: `${namespace}:analysis`,
      researchJobId: `${namespace}:research`,
      sessionId: `${namespace}:session`,
      recommendationId: null,
      generation: 3,
    });

    await waitUntil(() => postMortemCount === 1, 10_000);
    await waitUntil(() => retryAttempts >= 2, 20_000);
    assert.equal(postMortemCount, 1);
    assert.equal(retryAttempts, 2);
    assert.equal(retryPayload?.userId, 202);
    assert.equal(retryPayload?.sessionId, `${namespace}:session`);
    assert.equal(retryPayload?.generation, 3);
    await queue.shutdownQueue();

    await store.del(tenantOneKey);
    await store.del(tenantTwoKey);
    await store.del(rateKey);

    console.log(
      JSON.stringify({
        phase,
        authentication: "ok",
        persistenceConfig: "ok",
        readWriteDelete: "ok",
        tenantSessionIsolation: "ok",
        rateLimitAtomicity: "ok",
        queueRoundtrip: "ok",
        deepAnalysisRetry: "ok",
        queueIdempotency: "ok",
      }),
    );
  } finally {
    resetBridgeKvStoreForTests();
    clearEaLiveQuotesForTests();
    client.disconnect();
  }
}

async function enqueuePersistenceProbe(): Promise<void> {
  const queue = await import("../src/lib/queue");
  queue.registerHandler("memory_lifecycle", async () => {});
  await queue.enqueue("memory_lifecycle", {
    userId: 303,
    conversationId: 404,
  });
  await queue.shutdownQueue();
  console.log(JSON.stringify({ phase, persistedJobEnqueued: "ok" }));
}

async function consumePersistenceProbe(): Promise<void> {
  const queue = await import("../src/lib/queue");
  let received = false;
  queue.registerHandler("memory_lifecycle", async (payload) => {
    assert.deepEqual(payload, { userId: 303, conversationId: 404 });
    received = true;
  });
  await queue.startWorker();
  await waitUntil(() => received, 10_000);
  await queue.shutdownQueue();
  console.log(JSON.stringify({ phase, persistedJobConsumed: "ok" }));
}

const runner =
  phase === "roundtrip"
    ? roundtrip
    : phase === "enqueue-persistence"
      ? enqueuePersistenceProbe
      : phase === "consume-persistence"
        ? consumePersistenceProbe
        : null;

assert.ok(runner, `unknown validation phase: ${phase}`);
runner()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
