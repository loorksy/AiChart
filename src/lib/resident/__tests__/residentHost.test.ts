import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-resident-"));
process.env.DB_PATH = join(dir, "resident.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "resident-test-secret";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

import type { MemoryBus } from "@/lib/resident/bus";
import type {
  AgentRunContext,
  AgentRunner,
  ResidentHost,
} from "@/lib/resident/host";
import type {
  MarketEvent,
  ScheduledTickEvent,
  UserMessageEvent,
} from "@/lib/resident/events";

let userId = 0;
let busMod: typeof import("@/lib/resident/bus");
let hostMod: typeof import("@/lib/resident/host");
let eventsMod: typeof import("@/lib/resident/events");
const newBus = (): MemoryBus => new busMod.MemoryBus();
const newHost = (opts: ConstructorParameters<typeof hostMod.ResidentHost>[0]): ResidentHost =>
  new hostMod.ResidentHost(opts);

/** A runner that answers from warm state — the Phase-1 acceptance behaviour. */
class WarmEchoRunner implements AgentRunner {
  ticks: ScheduledTickEvent[] = [];
  marketEvents: MarketEvent[] = [];
  async onUserMessage(event: UserMessageEvent, ctx: AgentRunContext): Promise<void> {
    const warm = ctx.warm.get();
    await ctx.sender(event.channel.type).sendText(
      event.channel,
      `${warm.symbol}: ${warm.openRecommendations.length} open plans (warm)`,
      { replyTo: event.messageRef },
    );
  }
  async onScheduledTick(event: ScheduledTickEvent): Promise<void> {
    this.ticks.push(event);
  }
  async onMarketEvent(event: MarketEvent): Promise<void> {
    this.marketEvents.push(event);
  }
}

before(async () => {
  busMod = await import("@/lib/resident/bus");
  hostMod = await import("@/lib/resident/host");
  eventsMod = await import("@/lib/resident/events");
  const db = await import("@/lib/db");
  await db.initDb();
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["resident@example.com", "x", "user", "active"],
  );
  await db.execute(
    `INSERT INTO user_entitlements (user_id, plan_status) VALUES (?, 'active')
     ON CONFLICT (user_id) DO UPDATE SET plan_status = 'active'`,
    [userId],
  );
  const { gatedCompletePlan } = await import(
    "@/lib/recommendations/__tests__/fixtures/completePlan"
  );
  const lifecycle = await import("@/lib/recommendations/canonical");
  await lifecycle.createCanonicalRecommendation({
    ...(await gatedCompletePlan(userId)),
    userId,
    symbol: "XAUUSD",
    market: "forex",
    timeframe: "15m",
    direction: "buy",
    entry: 4000,
    stopLoss: 3990,
    targets: [4010, 4020, 4030],
    risk: { source: "recorded" },
    confidence: 70,
    source: "resident-test",
  });
});

describe("resident host", () => {
  it("answers a user_message event from warm state through the channel sender", async () => {
    const bus = newBus();
    const runner = new WarmEchoRunner();
    const host = newHost({ bus, runner, healthPort: null, maxUptimeMs: 0, sweepEveryMs: 0, candleSyncEveryMs: 0 });
    const sent: { channelId: string; text: string; replyTo?: string }[] = [];
    host.registerSender("test", {
      sendText: async (channel, text, opts) => {
        sent.push({ channelId: channel.id, text, replyTo: opts?.replyTo });
      },
    });
    await host.start();
    await bus.publish({
      kind: "user_message",
      userId,
      channel: { type: "test", id: "chat-9" },
      text: "كيف السوق؟",
      messageRef: "m1",
      enqueuedAt: Date.now(),
    });
    await bus.idle();
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.text, /XAUUSD: 1 open plans \(warm\)/);
    assert.equal(sent[0]!.replyTo, "m1");
    const health = await host.health();
    assert.equal(health.events.handled, 1);
    assert.equal(health.events.byKind.user_message, 1);
    await host.shutdown("test");
  });

  it("rebuilds warm state correctly across a restart", async () => {
    // First host: full boot.
    const host1 = newHost({
      bus: newBus(), runner: new WarmEchoRunner(),
      healthPort: null, maxUptimeMs: 0, sweepEveryMs: 0, candleSyncEveryMs: 0,
    });
    await host1.start();
    const before1 = host1.warm.get().openRecommendations.length;
    await host1.shutdown("restart-sim");

    // A second recommendation lands while "down".
    const { gatedCompletePlan } = await import(
      "@/lib/recommendations/__tests__/fixtures/completePlan"
    );
    const lifecycle = await import("@/lib/recommendations/canonical");
    await lifecycle.createCanonicalRecommendation({
      ...(await gatedCompletePlan(userId, {
        analysisId: "resident-restart-2",
        symbol: "XAUUSD",
      })),
      userId,
      symbol: "XAUUSD",
      market: "forex",
      timeframe: "1h",
      direction: "sell",
      entry: 4050,
      stopLoss: 4060,
      targets: [4040, 4030, 4020],
      risk: { source: "recorded" },
      confidence: 66,
      sessionId: "resident-restart-2",
      source: "resident-test",
    });

    // Fresh host (new process, in effect): warm state reflects the new truth.
    const host2 = newHost({
      bus: newBus(), runner: new WarmEchoRunner(),
      healthPort: null, maxUptimeMs: 0, sweepEveryMs: 0, candleSyncEveryMs: 0,
    });
    await host2.start();
    const after = host2.warm.get().openRecommendations.length;
    assert.equal(after, before1 + 1);
    assert.ok(host2.warm.ageMs()! >= 0);
    await host2.shutdown("test");
  });

  it("serves a truthful health endpoint over HTTP", async () => {
    const bus = newBus();
    const host = newHost({
      bus, runner: new WarmEchoRunner(),
      healthPort: 0, maxUptimeMs: 0, sweepEveryMs: 0, candleSyncEveryMs: 0,
    });
    host.registerSender("test", { sendText: async () => {} });
    await host.start();
    const port = host.boundHealthPort();
    assert.ok(port && port > 0);
    await bus.publish({
      kind: "user_message", userId,
      channel: { type: "test", id: "c" }, text: "hi", enqueuedAt: Date.now(),
    });
    await bus.idle();
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      warmState: { loaded: boolean; ageMs: number };
      queue: { backend: string; pending: number; inFlight: number };
      events: { handled: number };
    };
    assert.equal(body.ok, true);
    assert.equal(body.warmState.loaded, true);
    assert.ok(body.warmState.ageMs >= 0);
    assert.equal(body.queue.backend, "memory");
    assert.equal(body.queue.pending, 0);
    assert.equal(body.events.handled, 1);
    await host.shutdown("test");
  });

  it("routes scheduled ticks to the runner and market events likewise", async () => {
    const bus = newBus();
    const runner = new WarmEchoRunner();
    const host = newHost({ bus, runner, healthPort: null, maxUptimeMs: 0, sweepEveryMs: 0, candleSyncEveryMs: 0 });
    await host.start();
    await bus.publish({ kind: "scheduled_tick", tick: "recommendation_sweep", enqueuedAt: Date.now() });
    await bus.publish({
      kind: "market_event", event: "activation_triggered", symbol: "XAUUSD",
      userId, recommendationId: "1", enqueuedAt: Date.now(),
    });
    await bus.idle();
    assert.equal(runner.ticks.length, 1);
    assert.equal(runner.ticks[0]!.tick, "recommendation_sweep");
    assert.equal(runner.marketEvents.length, 1);
    assert.equal(runner.marketEvents[0]!.event, "activation_triggered");
    await host.shutdown("test");
  });

  it("drains in-flight events and runs persist hooks on shutdown", async () => {
    const bus = newBus();
    let release: (() => void) | null = null;
    let finished = false;
    const runner: AgentRunner = {
      onUserMessage: async () => {
        await new Promise<void>((r) => {
          release = r;
        });
        finished = true;
      },
      onScheduledTick: async () => {},
      onMarketEvent: async () => {},
    };
    const host = newHost({ bus, runner, healthPort: null, maxUptimeMs: 0, sweepEveryMs: 0, candleSyncEveryMs: 0 });
    let persisted = false;
    host.onShutdownPersist(async () => {
      persisted = true;
    });
    await host.start();
    await bus.publish({
      kind: "user_message", userId,
      channel: { type: "test", id: "c" }, text: "slow", enqueuedAt: Date.now(),
    });
    // Let the handler start, then shut down while it is in flight.
    await new Promise((r) => setTimeout(r, 25));
    const shutdownDone = host.shutdown("drain-test");
    await new Promise((r) => setTimeout(r, 25));
    release!();
    await shutdownDone;
    assert.equal(finished, true, "in-flight event finished before shutdown returned");
    assert.equal(persisted, true, "persist hook ran");
  });

  it("self-restarts cleanly once max uptime passes", async () => {
    let nowMs = 1_000_000;
    const exits: number[] = [];
    const bus = newBus();
    const host = newHost({
      bus, runner: new WarmEchoRunner(),
      healthPort: null, maxUptimeMs: 10_000, sweepEveryMs: 0, candleSyncEveryMs: 0,
      now: () => nowMs,
      exit: (code) => exits.push(code),
    });
    await host.start();
    nowMs += 20_000;
    await bus.publish({ kind: "scheduled_tick", tick: "restart_check", enqueuedAt: nowMs });
    await bus.idle();
    // shutdown → exit(0) is async off the tick; give it a beat.
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(exits, [0]);
    const health = await host.health();
    assert.equal(health.restart.restartDue, true);
  });

  it("rejects malformed events at the boundary with a named error", () => {
    assert.throws(
      () => eventsMod.parseResidentEvent({ kind: "user_message", text: "no user" }),
      (err: Error) => err instanceof eventsMod.InvalidResidentEventError,
    );
  });

  it("refuses to send through an unregistered channel", async () => {
    const bus = newBus();
    const failures: string[] = [];
    const runner: AgentRunner = {
      onUserMessage: async (event, ctx) => {
        try {
          ctx.sender(event.channel.type);
        } catch (err) {
          failures.push((err as Error).name);
          throw err;
        }
      },
      onScheduledTick: async () => {},
      onMarketEvent: async () => {},
    };
    const host = newHost({ bus, runner, healthPort: null, maxUptimeMs: 0, sweepEveryMs: 0, candleSyncEveryMs: 0 });
    await host.start();
    await bus.publish({
      kind: "user_message", userId,
      channel: { type: "whatsapp", id: "x" }, text: "hi", enqueuedAt: Date.now(),
    });
    await bus.idle();
    assert.ok(failures.length >= 1);
    assert.equal(failures[0], "UnknownChannelError");
    assert.ok(new hostMod.UnknownChannelError("whatsapp").message.includes("whatsapp"));
    await host.shutdown("test");
  });
});
