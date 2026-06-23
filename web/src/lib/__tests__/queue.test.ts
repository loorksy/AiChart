import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The queue must (1) run jobs inline when no broker is configured — preserving
 * the previous fire-and-forget behavior — and (2) round-trip through BullMQ +
 * a worker when REDIS_URL points at a reachable Redis. The BullMQ case is
 * skipped automatically when Redis is unavailable so the suite stays green.
 */

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test("inline fallback runs the handler when REDIS_URL is unset", async () => {
  delete process.env.REDIS_URL;
  const queue = await import("../queue");

  // Register the spy FIRST; the auto-imported real registry is guarded by
  // hasHandler() and will not overwrite it (so no real DB/LLM side effects).
  let got: { userId: number; tradeId: number; pnl: number } | null = null;
  queue.registerHandler("trade_post_mortem", async (p) => {
    got = p;
  });

  await queue.enqueue("trade_post_mortem", { userId: 7, tradeId: 42, pnl: 3.5 });
  await delay(20); // inline dispatch is void-async
  assert.deepEqual(got, { userId: 7, tradeId: 42, pnl: 3.5 });
});

test("BullMQ round-trip: enqueue → worker processes the job", async (t) => {
  const url = "redis://127.0.0.1:6379";
  // Skip unless a local Redis answers quickly.
  let reachable = false;
  try {
    const { default: IORedis } = await import("ioredis");
    const probe = new IORedis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 500,
      lazyConnect: true,
    });
    await probe.connect();
    await probe.ping();
    await probe.quit();
    reachable = true;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    t.skip("Redis not reachable on 127.0.0.1:6379");
    return;
  }

  process.env.REDIS_URL = url;
  const queue = await import("../queue");

  // Register the spy before starting so the guarded real registry won't replace
  // it; the worker reads the current handler at job time.
  let processed: { tradeId: number } | null = null;
  queue.registerHandler("trade_post_mortem", async (p) => {
    processed = { tradeId: p.tradeId };
  });
  await queue.startWorker();

  await queue.enqueue("trade_post_mortem", {
    userId: 1,
    tradeId: 12345,
    pnl: 9,
  });

  // Poll for the worker to pick it up.
  for (let i = 0; i < 50 && !processed; i++) await delay(100);
  await queue.shutdownQueue();

  assert.ok(processed, "worker should process the enqueued job");
  assert.equal(processed!.tradeId, 12345);
});
