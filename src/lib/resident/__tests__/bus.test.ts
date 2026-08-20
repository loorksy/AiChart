import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryBus, RedisStreamBus } from "@/lib/resident/bus";
import type { ResidentEvent } from "@/lib/resident/events";

function tick(): ResidentEvent {
  return { kind: "scheduled_tick", tick: "recommendation_sweep", enqueuedAt: Date.now() };
}

test("memory bus delivers with bounded concurrency", async () => {
  const bus = new MemoryBus();
  let active = 0;
  let peak = 0;
  let handled = 0;
  await bus.start(
    async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      handled += 1;
    },
    { concurrency: 2 },
  );
  for (let i = 0; i < 6; i++) await bus.publish(tick());
  await bus.idle();
  assert.equal(handled, 6);
  assert.ok(peak <= 2, `peak concurrency ${peak} exceeded 2`);
  assert.ok(peak >= 2, "events did not actually overlap");
  await bus.stop();
});

test("memory bus retries a failed event exactly once", async () => {
  const bus = new MemoryBus();
  let attempts = 0;
  await bus.start(
    async () => {
      attempts += 1;
      throw new Error("boom");
    },
    { concurrency: 1 },
  );
  await bus.publish(tick());
  await bus.idle();
  assert.equal(attempts, 2);
});

test("memory bus validates events at publish", async () => {
  const bus = new MemoryBus();
  await assert.rejects(
    () => bus.publish({ kind: "nope" } as unknown as ResidentEvent),
    (err: Error) => err.name === "InvalidResidentEventError",
  );
});

test("redis streams round-trip: publish → consume → ack (skipped without Redis)", async (t) => {
  const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  let reachable = false;
  try {
    const { default: IORedis } = await import("ioredis");
    const probe = new IORedis(url, { maxRetriesPerRequest: 1, lazyConnect: true, connectTimeout: 500 });
    try {
      await probe.connect();
      await probe.ping();
      reachable = true;
    } finally {
      probe.disconnect();
    }
  } catch {
    reachable = false;
  }
  if (!reachable) {
    t.skip("no reachable Redis");
    return;
  }

  const stream = `lonora:test:${Date.now()}`;
  const bus = new RedisStreamBus({ url, stream, group: "test-group", consumer: "t1" });
  const got: ResidentEvent[] = [];
  await bus.start(
    async ({ event }) => {
      got.push(event);
    },
    { concurrency: 2 },
  );
  await bus.publish(tick());
  const started = Date.now();
  while (got.length < 1 && Date.now() - started < 5_000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(got.length, 1);
  assert.equal(got[0]!.kind, "scheduled_tick");
  const depth = await bus.depth();
  assert.equal(depth.pending, 0);
  await bus.stop();
});
