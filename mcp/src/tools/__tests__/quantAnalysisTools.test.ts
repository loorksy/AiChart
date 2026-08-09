/**
 * The Quant Agent analysis surface, exercised through a REAL MCP client/server
 * pair — the same harness `createRecommendationTransport.test.ts` uses, for the
 * same reason: the guards being tested (idempotency, delete confirmation, the
 * async job contract) live in front of the bridge call, and a unit test on the
 * zod object alone would prove nothing about what a host actually gets back.
 *
 * The bridge's four verbs are replaced with recorders, so every assertion is
 * about what WOULD reach the web API, and no test ever needs a running web app.
 *
 * The idempotency assertions are the load-bearing ones. Two properties matter
 * and are tested separately:
 *   - a repeated key inside one session replays instead of writing twice, and
 *   - a repeated key across two SESSIONS does not replay, because the key is
 *     chosen by the caller and a shared cache would be one tenant reading
 *     another's write.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BridgeClient } from "../../bridge/client.js";
import { loadConfig } from "../../config.js";
import { createAiChartMcpServer } from "../../server/mcpServer.js";

process.env.MCP_AUTH_MODE = "none";

interface Recorded {
  verb: "get" | "post" | "patch" | "delete";
  path: string;
  body?: unknown;
  query?: unknown;
}

interface Harness {
  client: Client;
  calls: Recorded[];
  /** What the next bridge call returns; default is a bare ok. */
  reply: (fn: (call: Recorded) => unknown) => void;
  close: () => Promise<void>;
}

async function openHarness(email = "quant-probe@test.local"): Promise<Harness> {
  const cfg = loadConfig();
  cfg.authMode = "none";
  const bridge = BridgeClient.forUser(cfg, email);
  const calls: Recorded[] = [];
  let responder: (call: Recorded) => unknown = () => ({ ok: true });

  const record = (verb: Recorded["verb"]) => async (path: string, payload?: unknown) => {
    const call: Recorded =
      verb === "get"
        ? { verb, path, query: payload }
        : { verb, path, body: payload };
    calls.push(call);
    return responder(call);
  };
  const patched = bridge as unknown as Record<string, unknown>;
  patched.get = record("get");
  patched.post = record("post");
  patched.patch = record("patch");
  patched.delete = record("delete");

  const server = createAiChartMcpServer(bridge);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "quant-analysis-audit", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    calls,
    reply: (fn) => {
      responder = fn;
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function withHarness<T>(fn: (h: Harness) => Promise<T>): Promise<T> {
  const h = await openHarness();
  try {
    return await fn(h);
  } finally {
    await h.close();
  }
}

/**
 * `callTool`'s return type is a union that still carries the legacy
 * `{ toolResult }` shape, so it is narrowed here once rather than at every
 * call site.
 */
function structured(result: unknown): Record<string, unknown> {
  const r = result as { structuredContent?: unknown; content?: Array<{ text?: string }> };
  if (r.structuredContent) return r.structuredContent as Record<string, unknown>;
  return JSON.parse(r.content![0]!.text!) as Record<string, unknown>;
}

function textOf(result: unknown): string {
  return JSON.stringify((result as { content?: unknown }).content);
}

const QUANT_ANALYSIS_TOOLS = [
  "quant_agent_run_analysis",
  "quant_agent_get_analysis",
  "quant_agent_list_analyses",
  "quant_agent_analysis_accuracy",
  "quant_agent_list_monitors",
  "quant_agent_create_monitor",
  "quant_agent_update_monitor",
  "quant_agent_delete_monitor",
  "quant_agent_list_signals",
  "quant_agent_get_signal",
];

describe("the analysis surface is actually advertised", () => {
  it("lists all ten tools, each with a description and annotations", async () => {
    await withHarness(async ({ client }) => {
      const listed = new Map((await client.listTools()).tools.map((t) => [t.name, t]));
      for (const name of QUANT_ANALYSIS_TOOLS) {
        const tool = listed.get(name);
        assert.ok(tool, `${name} is not advertised`);
        assert.ok((tool.description ?? "").length > 80, `${name}: description too thin`);
        assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", name);
      }
    });
  });
});

describe("quant_agent_run_analysis", () => {
  it("returns a job id immediately and the FULL analysis through jobs_wait", async () => {
    await withHarness(async ({ client, calls, reply }) => {
      const analysis = {
        analysis: {
          id: "an_1",
          symbol: "XAUUSD",
          interval: "1h",
          status: "completed",
          decision: "SELL",
          confidence: 71,
          scores: { technical: -12, fundamental: null, sentiment: null, overall: -12 },
          consensus: { decision: "SELL", score: -8, agreement: 0.75, timeframeCount: 4 },
          dataQuality: { degraded: true, missing: ["news", "macro"] },
        },
      };
      reply(() => analysis);

      const started = Date.now();
      const queued = structured(
        await client.callTool({
          name: "quant_agent_run_analysis",
          arguments: { symbol: "XAUUSD", interval: "1h", idempotencyKey: "run-xau-1h-1" },
        }),
      );
      // Bucket-C contract: the queue call itself never waits on the run.
      assert.ok(Date.now() - started < 2000, "queueing must not block on the analysis");
      assert.match(String(queued.job_id), /^job_/);
      assert.equal((queued.next_step as { tool: string }).tool, "jobs_wait");

      const waited = structured(
        await client.callTool({
          name: "jobs_wait",
          arguments: { jobs: [queued.job_id] },
        }),
      );
      assert.equal(waited.all_terminal, true);
      const job = (waited.jobs as Array<Record<string, unknown>>)[0]!;
      assert.equal(job.status, "completed");
      // The complete structured result, not a summary of one.
      assert.deepEqual(job.result, analysis);

      const posted = calls.filter((c) => c.verb === "post");
      assert.equal(posted.length, 1);
      assert.equal(posted[0]!.path, "/api/quant-agent/analysis");
    });
  });

  it("sends only the fields the STRICT route accepts — never the idempotency key", async () => {
    await withHarness(async ({ client, calls }) => {
      await client.callTool({
        name: "quant_agent_run_analysis",
        arguments: {
          symbol: " xauusd ",
          interval: "4h",
          locale: "en",
          idempotencyKey: "run-xau-4h-1",
        },
      });
      // Give the queued job a tick to make its call.
      await new Promise((r) => setTimeout(r, 50));
      const body = calls.find((c) => c.verb === "post")!.body as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ["interval", "locale", "market", "symbol"]);
      assert.equal(body.symbol, "xauusd", "symbol is trimmed before the wire");
      assert.equal(body.market, "forex");
    });
  });

  it("refuses without an idempotency key and queues nothing", async () => {
    await withHarness(async ({ client, calls }) => {
      const result = await client.callTool({
        name: "quant_agent_run_analysis",
        arguments: { symbol: "XAUUSD" },
      });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /idempotencyKey/);
      assert.match(textOf(result), /QUANT_AGENT_IDEMPOTENCY_KEY_REQUIRED/);
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(calls.length, 0, "nothing reached the web API");
    });
  });

  it("a retry with the same key returns the SAME job, not a second run", async () => {
    await withHarness(async ({ client, calls }) => {
      const args = { symbol: "XAUUSD", interval: "1h", idempotencyKey: "same-key" };
      const first = structured(await client.callTool({ name: "quant_agent_run_analysis", arguments: args }));
      const second = structured(await client.callTool({ name: "quant_agent_run_analysis", arguments: args }));
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(second.job_id, first.job_id);
      assert.equal(second.idempotent_replay, true, "a replay says so");
      assert.notEqual(first.idempotent_replay, true, "the first call is not a replay");
      assert.equal(calls.filter((c) => c.verb === "post").length, 1, "exactly one run queued");
    });
  });

  it("a run that FAILED releases its key — the same key can genuinely re-run", async () => {
    await withHarness(async ({ client, calls, reply }) => {
      reply(() => {
        throw new Error("analysis backend down");
      });
      const args = { symbol: "XAUUSD", interval: "1h", idempotencyKey: "flaky" };
      const first = structured(await client.callTool({ name: "quant_agent_run_analysis", arguments: args }));
      const failed = structured(
        await client.callTool({ name: "jobs_wait", arguments: { jobs: [first.job_id] } }),
      );
      assert.equal((failed.jobs as Array<Record<string, unknown>>)[0]!.status, "failed");

      reply(() => ({ analysis: { id: "an_2" } }));
      const retry = structured(await client.callTool({ name: "quant_agent_run_analysis", arguments: args }));
      assert.notEqual(retry.job_id, first.job_id, "the failed job is not replayed forever");
      assert.notEqual(retry.idempotent_replay, true);
      const done = structured(
        await client.callTool({ name: "jobs_wait", arguments: { jobs: [retry.job_id] } }),
      );
      assert.deepEqual((done.jobs as Array<Record<string, unknown>>)[0]!.result, {
        analysis: { id: "an_2" },
      });
      assert.equal(calls.filter((c) => c.verb === "post").length, 2);
    });
  });
});

describe("analysis reads", () => {
  it("reads one analysis by id, url-encoded", async () => {
    await withHarness(async ({ client, calls }) => {
      await client.callTool({ name: "quant_agent_get_analysis", arguments: { id: "an/1 2" } });
      assert.equal(calls[0]!.verb, "get");
      assert.equal(calls[0]!.path, "/api/quant-agent/analysis/an%2F1%202");
    });
  });

  it("pages history with the route's own query parameters", async () => {
    await withHarness(async ({ client, calls }) => {
      await client.callTool({
        name: "quant_agent_list_analyses",
        arguments: { symbol: "XAUUSD", limit: 5, cursor: "c1" },
      });
      assert.equal(calls[0]!.path, "/api/quant-agent/analysis");
      assert.deepEqual(calls[0]!.query, { symbol: "XAUUSD", limit: 5, cursor: "c1" });
    });
  });

  it("reads calibration for the whole engine or one pair", async () => {
    await withHarness(async ({ client, calls }) => {
      await client.callTool({ name: "quant_agent_analysis_accuracy", arguments: {} });
      await client.callTool({
        name: "quant_agent_analysis_accuracy",
        arguments: { symbol: "XAUUSD" },
      });
      assert.equal(calls[0]!.path, "/api/quant-agent/analysis/accuracy");
      assert.deepEqual(calls[0]!.query, { symbol: undefined });
      assert.deepEqual(calls[1]!.query, { symbol: "XAUUSD" });
    });
  });
});

describe("monitor writes", () => {
  it("creates a monitor with the route's own field names", async () => {
    await withHarness(async ({ client, calls }) => {
      await client.callTool({
        name: "quant_agent_create_monitor",
        arguments: {
          symbol: "XAUUSD",
          interval: "4h",
          notifyTelegram: true,
          notifyWebhookUrl: "https://example.com/hook",
          idempotencyKey: "create-1",
        },
      });
      assert.equal(calls[0]!.verb, "post");
      assert.equal(calls[0]!.path, "/api/quant-agent/monitors");
      assert.deepEqual(calls[0]!.body, {
        symbol: "XAUUSD",
        market: "forex",
        interval: "4h",
        notifyTelegram: true,
        notifyWebhookUrl: "https://example.com/hook",
      });
    });
  });

  it("accepts the string booleans hosts actually send", async () => {
    await withHarness(async ({ client, calls }) => {
      const result = await client.callTool({
        name: "quant_agent_create_monitor",
        arguments: {
          symbol: "EURUSD",
          interval: "1h",
          notifyTelegram: "true",
          notifyPush: "false",
          idempotencyKey: "create-loose",
        },
      });
      assert.notEqual(result.isError, true, textOf(result));
      const body = calls[0]!.body as Record<string, unknown>;
      assert.equal(body.notifyTelegram, true);
      assert.equal(body.notifyPush, false);
    });
  });

  it("refuses to create without an idempotency key", async () => {
    await withHarness(async ({ client, calls }) => {
      const result = await client.callTool({
        name: "quant_agent_create_monitor",
        arguments: { symbol: "XAUUSD", interval: "4h" },
      });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /QUANT_AGENT_IDEMPOTENCY_KEY_REQUIRED/);
      assert.equal(calls.length, 0, "nothing reached the route");
    });
  });

  it("replays a repeated key instead of creating a second monitor", async () => {
    await withHarness(async ({ client, calls, reply }) => {
      reply(() => ({ monitor: { id: 7, symbol: "XAUUSD" } }));
      const args = { symbol: "XAUUSD", interval: "4h", idempotencyKey: "dupe" };
      const first = structured(await client.callTool({ name: "quant_agent_create_monitor", arguments: args }));
      const second = structured(await client.callTool({ name: "quant_agent_create_monitor", arguments: args }));
      assert.equal(calls.length, 1, "exactly one write");
      assert.deepEqual(first.monitor, { id: 7, symbol: "XAUUSD" });
      assert.deepEqual(second.monitor, { id: 7, symbol: "XAUUSD" });
      assert.equal(second.idempotent_replay, true);
    });
  });

  it("a FAILED write is never cached — the same key retries for real", async () => {
    await withHarness(async ({ client, calls, reply }) => {
      reply(() => {
        throw new Error("bridge exploded");
      });
      const args = { symbol: "XAUUSD", interval: "4h", idempotencyKey: "retry-me" };
      const failed = await client.callTool({ name: "quant_agent_create_monitor", arguments: args });
      assert.equal(failed.isError, true);
      reply(() => ({ monitor: { id: 9 } }));
      const retried = structured(await client.callTool({ name: "quant_agent_create_monitor", arguments: args }));
      assert.deepEqual(retried.monitor, { id: 9 });
      assert.notEqual(retried.idempotent_replay, true, "a real retry is not a replay");
      assert.equal(calls.length, 2, "the failure did not consume the key");
    });
  });

  it("the SAME key in a different session writes again — no cross-tenant replay", async () => {
    const a = await openHarness("tenant-a@test.local");
    const b = await openHarness("tenant-b@test.local");
    try {
      a.reply(() => ({ monitor: { id: 1, owner: "a" } }));
      b.reply(() => ({ monitor: { id: 2, owner: "b" } }));
      const args = { symbol: "XAUUSD", interval: "4h", idempotencyKey: "guessable-key" };
      const fromA = structured(await a.client.callTool({ name: "quant_agent_create_monitor", arguments: args }));
      const fromB = structured(await b.client.callTool({ name: "quant_agent_create_monitor", arguments: args }));
      assert.equal(a.calls.length, 1);
      assert.equal(b.calls.length, 1, "tenant B's write must not be swallowed by tenant A's key");
      assert.deepEqual(fromA.monitor, { id: 1, owner: "a" });
      assert.deepEqual(fromB.monitor, { id: 2, owner: "b" });
      assert.notEqual(fromB.idempotent_replay, true, "tenant B must never read tenant A's result");
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("updates a monitor by id, sending only the fields given", async () => {
    await withHarness(async ({ client, calls }) => {
      await client.callTool({
        name: "quant_agent_update_monitor",
        arguments: { id: 12, enabled: false, idempotencyKey: "pause-12" },
      });
      assert.equal(calls[0]!.verb, "patch");
      assert.equal(calls[0]!.path, "/api/quant-agent/monitors/12");
      assert.deepEqual(calls[0]!.body, { enabled: false });
    });
  });
});

describe("quant_agent_delete_monitor is refused without an explicit confirmation", () => {
  it("deletes nothing when confirmDelete is absent, and names the reversible alternative", async () => {
    await withHarness(async ({ client, calls }) => {
      const result = await client.callTool({
        name: "quant_agent_delete_monitor",
        arguments: { id: 12, idempotencyKey: "del-12" },
      });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /QUANT_AGENT_CONFIRM_REQUIRED/);
      assert.match(textOf(result), /confirmDelete=true/);
      assert.match(textOf(result), /quant_agent_update_monitor/);
      assert.equal(calls.length, 0, "nothing was deleted");
    });
  });

  it("deletes nothing when confirmDelete is false", async () => {
    await withHarness(async ({ client, calls }) => {
      const result = await client.callTool({
        name: "quant_agent_delete_monitor",
        arguments: { id: 12, confirmDelete: false, idempotencyKey: "del-12" },
      });
      assert.equal(result.isError, true);
      assert.equal(calls.length, 0);
    });
  });

  it("still requires the idempotency key once confirmed", async () => {
    await withHarness(async ({ client, calls }) => {
      const result = await client.callTool({
        name: "quant_agent_delete_monitor",
        arguments: { id: 12, confirmDelete: true },
      });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /QUANT_AGENT_IDEMPOTENCY_KEY_REQUIRED/);
      assert.equal(calls.length, 0);
    });
  });

  it("deletes when both guards are satisfied", async () => {
    await withHarness(async ({ client, calls, reply }) => {
      reply(() => ({ ok: true }));
      const result = await client.callTool({
        name: "quant_agent_delete_monitor",
        arguments: { id: 12, confirmDelete: true, idempotencyKey: "del-12" },
      });
      assert.notEqual(result.isError, true, textOf(result));
      assert.equal(calls[0]!.verb, "delete");
      assert.equal(calls[0]!.path, "/api/quant-agent/monitors/12");
    });
  });
});

describe("fired signals", () => {
  it("lists signals with every filter the route reads", async () => {
    await withHarness(async ({ client, calls }) => {
      await client.callTool({
        name: "quant_agent_list_signals",
        arguments: { symbol: "XAUUSD", monitorId: 3, decision: "SELL", limit: 10, cursor: "c9" },
      });
      assert.equal(calls[0]!.path, "/api/quant-agent/signals");
      assert.deepEqual(calls[0]!.query, {
        symbol: "XAUUSD",
        monitorId: 3,
        decision: "SELL",
        limit: 10,
        cursor: "c9",
      });
    });
  });

  it("reads one signal by id", async () => {
    await withHarness(async ({ client, calls }) => {
      await client.callTool({ name: "quant_agent_get_signal", arguments: { id: "sig_1" } });
      assert.equal(calls[0]!.path, "/api/quant-agent/signals/sig_1");
    });
  });

  it("offers no way to write or delete a signal", async () => {
    await withHarness(async ({ client }) => {
      const names = (await client.listTools()).tools.map((t) => t.name);
      for (const forbidden of [
        "quant_agent_create_signal",
        "quant_agent_delete_signal",
        "quant_agent_update_signal",
      ]) {
        assert.ok(!names.includes(forbidden), `${forbidden} must not exist — the log is append-only`);
      }
    });
  });
});
