/**
 * Work B (design A2) — the web turn through the queue, SSE preserved:
 *
 *  - the per-turn stream carries the exact event/payload contract, control
 *    entries never leak, and the relay resumes from a cursor;
 *  - a redelivered (XAUTOCLAIM) turn whose stream already holds a terminal
 *    entry NEVER reruns — no duplicate answer, no duplicate charge;
 *  - the worker owns usage metering and the balance commit, and the debit
 *    stays idempotent by the LEDGER key `chat:<turnId>` — exactly one
 *    credit_entries row per turn;
 *  - cancel is the explicit flag only; a cancelled turn debits nothing;
 *  - transport pins: the route gates then publishes (queue) or runs inline
 *    (dev unchanged), and the client cancels/resumes by turn id + cursor.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { join } from "node:path";
import { before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-webqueue-"));
process.env.DB_PATH = join(dir, "webqueue.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "webqueue-test-secret";
process.env.BILLING_ENFORCED = "1";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

let db: typeof import("@/lib/db");
let credits: typeof import("@/lib/billing/credits");
let planConfig: typeof import("@/lib/billing/planConfig");
let events: typeof import("@/lib/resident/events");
let turnStream: typeof import("@/lib/resident/turnStream");
let consumer: typeof import("@/lib/resident/webTurnConsumer");
let agentTypes: typeof import("@/lib/agent/types");

function idNum(id: string): number {
  return Number(id.split("-")[1] ?? 0);
}

/** In-memory stand-in for the ioredis slice the turn stream uses. */
class FakeTurnRedis implements import("@/lib/resident/turnStream").TurnStreamClient {
  streams = new Map<string, Array<[string, string[]]>>();
  kv = new Map<string, string>();
  ttls = new Map<string, number>();
  private seq = 0;

  async xadd(key: string, ...args: Array<string | number>): Promise<string> {
    const fields = args.slice(1).map(String);
    const id = `0-${++this.seq}`;
    const arr = this.streams.get(key) ?? [];
    arr.push([id, fields]);
    this.streams.set(key, arr);
    return id;
  }
  async xrange(key: string): Promise<Array<[string, string[]]>> {
    return [...(this.streams.get(key) ?? [])];
  }
  async xread(
    ...args: Array<string | number>
  ): Promise<Array<[string, Array<[string, string[]]>]> | null> {
    const at = args.indexOf("STREAMS");
    const key = String(args[at + 1]);
    const cursor = String(args[at + 2]);
    const arr = this.streams.get(key) ?? [];
    const after =
      cursor === "0" ? arr : arr.filter(([id]) => idNum(id) > idNum(cursor));
    if (!after.length) {
      // The real client BLOCKs; the fake yields so a caller loop cannot spin.
      await new Promise((r) => setTimeout(r, 5));
      return null;
    }
    return [[key, after.map(([id, fields]) => [id, fields] as [string, string[]])]];
  }
  async expire(key: string, seconds: number): Promise<number> {
    this.ttls.set(key, seconds);
    return 1;
  }
  async set(key: string, value: string, _mode: "EX", _s: number): Promise<unknown> {
    this.kv.set(key, value);
    return "OK";
  }
  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }
  async exists(key: string): Promise<number> {
    return this.streams.has(key) || this.kv.has(key) ? 1 : 0;
  }
  async quit(): Promise<unknown> {
    return "OK";
  }
}

let seq = 0;
async function makeActiveUser(balance: number): Promise<number> {
  seq += 1;
  const userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [`webqueue-${seq}@example.com`, "x", "user", "active"],
  );
  await db.execute(
    `INSERT INTO user_entitlements (user_id, plan_status, trial_interactions_used, trial_in_flight, subscription_expires_at)
     VALUES (?, 'active', 0, 0, ?)`,
    [userId, new Date(Date.now() + 30 * 86_400_000).toISOString()],
  );
  if (balance) {
    await credits.grantCredits({ userId, amount: balance, kind: "admin_adjust", note: "seed" });
  }
  return userId;
}

function webEvent(userId: number, turnId: string): import("@/lib/resident/events").UserMessageEvent {
  return events.userMessageEventSchema.parse({
    kind: "user_message",
    userId,
    channel: { type: "web", id: `chat-${turnId}` },
    text: "analyze gold",
    web: { turnId, locale: "ar", trialMetered: false, modelRef: null },
    enqueuedAt: Date.now(),
  });
}

const stubResult = () =>
  ({
    decision: "informational",
    confidence: 0.5,
    summary: "stub answer",
  }) as unknown as import("@/lib/agent/types").AgentFinalResult;

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  credits = await import("@/lib/billing/credits");
  planConfig = await import("@/lib/billing/planConfig");
  events = await import("@/lib/resident/events");
  turnStream = await import("@/lib/resident/turnStream");
  consumer = await import("@/lib/resident/webTurnConsumer");
  agentTypes = await import("@/lib/agent/types");
  void agentTypes;
  await planConfig.setCreditPrice("chat_turn", 5, 1);
  planConfig.bustBillingConfigCache();
});

describe("the event contract carries web turns", () => {
  it("validates the web fields and refuses an oversized turn id", () => {
    const ok = events.userMessageEventSchema.safeParse({
      kind: "user_message",
      userId: 1,
      channel: { type: "web", id: "chat-1" },
      text: "hi",
      web: { turnId: "t1", locale: "en" },
      enqueuedAt: Date.now(),
    });
    assert.equal(ok.success, true);
    const bad = events.userMessageEventSchema.safeParse({
      kind: "user_message",
      userId: 1,
      channel: { type: "web", id: "chat-1" },
      text: "hi",
      web: { turnId: "x".repeat(65) },
      enqueuedAt: Date.now(),
    });
    assert.equal(bad.success, false);
  });
});

describe("the per-turn stream", () => {
  it("is terminal after a final event AND after a cancel end marker", async () => {
    const redis = new FakeTurnRedis();
    const writer = new turnStream.TurnStreamWriter(redis, "t-terminal");
    await writer.open(7);
    assert.equal(await turnStream.hasTurnTerminal(redis, "t-terminal"), false, "mid-run");
    await writer.append("activity", { message: "working" });
    assert.equal(await turnStream.hasTurnTerminal(redis, "t-terminal"), false);
    await writer.append("final", { summary: "done" });
    assert.equal(await turnStream.hasTurnTerminal(redis, "t-terminal"), true, "after final");

    const redis2 = new FakeTurnRedis();
    const writer2 = new turnStream.TurnStreamWriter(redis2, "t-cancelled");
    await writer2.open(7);
    await writer2.end("cancelled");
    assert.equal(
      await turnStream.hasTurnTerminal(redis2, "t-cancelled"),
      true,
      "a cancelled turn is terminal too — no rerun",
    );
  });

  it("cleans up: TTL at open, tightened at end", async () => {
    const redis = new FakeTurnRedis();
    const writer = new turnStream.TurnStreamWriter(redis, "t-ttl");
    await writer.open(7);
    assert.equal(
      redis.ttls.get(turnStream.turnStreamKey("t-ttl")),
      turnStream.TURN_STREAM_OPEN_TTL_S,
    );
    await writer.end("final");
    assert.equal(
      redis.ttls.get(turnStream.turnStreamKey("t-ttl")),
      turnStream.TURN_STREAM_DONE_TTL_S,
    );
  });

  it("relays SSE entries verbatim, skips control entries, resumes by cursor", async () => {
    const redis = new FakeTurnRedis();
    const writer = new turnStream.TurnStreamWriter(redis, "t-relay");
    await writer.open(7);
    await writer.append("stage", { stage: "market", status: "running" });
    await writer.append("answer_text", { text: "partial" });
    await writer.append("final", { summary: "done" });
    await writer.end("final");

    const frames: Array<{ id: string; event: string; data: string }> = [];
    const full = await turnStream.relayTurnStream({
      client: redis,
      turnId: "t-relay",
      onFrame: (f) => {
        frames.push(f);
      },
    });
    assert.equal(full.reason, "ended");
    assert.deepEqual(
      frames.map((f) => f.event),
      ["stage", "answer_text", "final"],
      "meta/end control entries never reach the SSE contract",
    );
    // Payload bytes identical to what the worker wrote.
    assert.equal(frames[1]!.data, JSON.stringify({ text: "partial" }));

    // Resume from the cursor of the first relayed frame: only later events.
    const resumed: string[] = [];
    const rest = await turnStream.relayTurnStream({
      client: redis,
      turnId: "t-relay",
      cursor: frames[0]!.id,
      onFrame: (f) => {
        resumed.push(f.event);
      },
    });
    assert.equal(rest.reason, "ended");
    assert.deepEqual(resumed, ["answer_text", "final"], "nothing replays twice");
  });
});

describe("the queued web turn consumer", () => {
  it("runs the turn, meters in the worker, and debits EXACTLY once by ledger key", async () => {
    const userId = await makeActiveUser(100);
    const redis = new FakeTurnRedis();
    let agentRuns = 0;
    const outcome = await consumer.runQueuedWebTurn(webEvent(userId, "t-run"), {
      client: redis,
      turnDeps: {
        runAgent: async () => {
          agentRuns += 1;
          return stubResult();
        },
        suggest: async () => [],
      },
    });
    assert.equal(outcome, "completed");
    assert.equal(agentRuns, 1);

    // The final event reached the stream (the relay's source of truth).
    const entries = await redis.xrange(turnStream.turnStreamKey("t-run"));
    const sse = entries
      .map(([, f]) => {
        const at = f.indexOf("sse");
        return at >= 0 ? f[at + 1] : null;
      })
      .filter(Boolean);
    assert.ok(sse.includes("final"), "the stream carries the final event");

    // The balance commit happened HERE (worker side), once, by the ledger
    // key — the UNIQUE (user_id, kind, ref) is the guarantee, not code.
    const rows = await db.query<{ amount: number }>(
      "SELECT amount FROM credit_entries WHERE user_id = ? AND ref = ?",
      [userId, "chat:t-run"],
    );
    assert.equal(rows.length, 1, "exactly one debit row for the turn");
    assert.equal(await credits.getCreditBalance(userId), 95, "100 - chat price 5");
  });

  it("a redelivered turn whose stream holds a final NEVER reruns (no second charge)", async () => {
    const userId = await makeActiveUser(50);
    const redis = new FakeTurnRedis();
    // Simulate the crash-after-final case XAUTOCLAIM redelivers.
    const writer = new turnStream.TurnStreamWriter(redis, "t-redeliver");
    await writer.open(userId);
    await writer.append("final", { summary: "already answered" });

    let agentRuns = 0;
    const outcome = await consumer.runQueuedWebTurn(webEvent(userId, "t-redeliver"), {
      client: redis,
      turnDeps: {
        runAgent: async () => {
          agentRuns += 1;
          return stubResult();
        },
        suggest: async () => [],
      },
    });
    assert.equal(outcome, "skipped_terminal");
    assert.equal(agentRuns, 0, "the agent must not run again");
    const rows = await db.query(
      "SELECT id FROM credit_entries WHERE user_id = ? AND ref = ?",
      [userId, "chat:t-redeliver"],
    );
    assert.equal(rows.length, 0, "no charge for the skipped rerun");
    assert.equal(await credits.getCreditBalance(userId), 50);
  });

  it("an explicit cancel aborts before the run: no agent call, no debit, terminal stream", async () => {
    const userId = await makeActiveUser(50);
    const redis = new FakeTurnRedis();
    await turnStream.requestTurnCancel(redis, "t-cancel");

    let agentRuns = 0;
    const outcome = await consumer.runQueuedWebTurn(webEvent(userId, "t-cancel"), {
      client: redis,
      turnDeps: {
        runAgent: async () => {
          agentRuns += 1;
          return stubResult();
        },
        suggest: async () => [],
      },
    });
    assert.equal(outcome, "cancelled");
    assert.equal(agentRuns, 0);
    assert.equal(await credits.getCreditBalance(userId), 50, "a cancelled turn costs nothing");
    assert.equal(
      await turnStream.hasTurnTerminal(redis, "t-cancel"),
      true,
      "the end marker makes the cancelled turn terminal",
    );
  });
});

describe("transport pins (structure follows the moved code)", () => {
  const SRC = path.join(process.cwd(), "src");
  const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

  it("the route gates, then publishes under the queue — and keeps the inline path for dev", () => {
    // Pin USAGE order, not import order: slice from the handler body.
    const route = read("app/api/agent/chat/stream/route.ts");
    const post = route.slice(route.indexOf("export async function POST"));
    assert.match(post, /turnQueueEnabled\(\)/);
    assert.ok(
      post.indexOf("resolveSpendGate") < post.indexOf("publishResidentEvent"),
      "billing gates precede the publish",
    );
    assert.ok(
      post.indexOf("publishResidentEvent") < post.indexOf("acquireAnalyzeSlot"),
      "the queue branch comes first; the slot guard belongs to the inline path",
    );
    assert.match(route, /X-Turn-Id/);
    assert.match(route, /export async function GET/, "the resume relay exists");
    assert.match(route, /turnOwner\(/, "resume and cancel verify ownership");
  });

  it("the consumer checks the terminal guard BEFORE opening a writer or running", () => {
    const src = read("lib/resident/webTurnConsumer.ts");
    const body = src.slice(src.indexOf("export async function runQueuedWebTurn"));
    assert.ok(body.indexOf("hasTurnTerminal") < body.indexOf("writer.open"));
    assert.ok(body.indexOf("hasTurnTerminal") < body.indexOf("runWebChatTurn"));
  });

  it("the runner routes web events to the consumer; telegram is untouched", () => {
    const src = read("lib/resident/residentAgentRunner.ts");
    assert.match(src, /channel\.type === "web" && event\.web/);
    assert.match(src, /runQueuedWebTurn/);
    assert.match(src, /channel\.type === "telegram"/);
  });

  it("the client cancels by explicit turn id and resumes by cursor — events untouched", () => {
    const hook = read("hooks/useSmartChartAgent.ts");
    assert.match(hook, /\/api\/agent\/chat\/stream\/cancel/);
    assert.match(hook, /x-turn-id/i);
    assert.match(hook, /cursor=\$\{encodeURIComponent\(resumeCursor\)\}/);
    // The SSE contract stays keyed on event:/data: lines only.
    assert.match(hook, /startsWith\("event:"\)/);
    assert.match(hook, /startsWith\("data:"\)/);
  });
});
