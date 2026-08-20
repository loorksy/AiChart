import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-loop-"));
process.env.DB_PATH = join(dir, "loop.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "loop-test-secret";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart, LanguageModelV4Usage } from "@ai-sdk/provider";

let loopMod: typeof import("@/lib/resident/agentLoop");
let toolsMod: typeof import("@/lib/resident/agentTools");
let userId = 0;

const usage: LanguageModelV4Usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function streamOf(parts: LanguageModelV4StreamPart[]) {
  return {
    stream: new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

/** Scripted model: call 1 asks for a 4h candle read; call 2 concludes. */
function twoStepModel() {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "read_candles",
            input: JSON.stringify({ timeframe: "4h", count: 12 }),
          },
          { type: "finish", finishReason: { unified: "tool-calls" as const, raw: undefined }, usage },
        ]);
      }
      return streamOf([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "بعد مراجعة فريم 4 ساعات، " },
        { type: "text-delta", id: "t1", delta: "الاتجاه صاعد فوق 4000." },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop" as const, raw: undefined }, usage },
      ]);
    },
  });
}

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  loopMod = await import("@/lib/resident/agentLoop");
  toolsMod = await import("@/lib/resident/agentTools");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["loop@example.com", "x", "user", "active"],
  );
  // Seed 4h candles so the exploration tool reads real stored bars.
  const { storeGoldCandles } = await import("@/lib/gold/candleStore");
  const base = Date.UTC(2026, 0, 5);
  await storeGoldCandles(
    "4h",
    Array.from({ length: 30 }, (_, i) => ({
      time: base + i * 4 * 3_600_000,
      open: 4000 + i,
      high: 4005 + i,
      low: 3995 + i,
      close: 4002 + i,
      volume: 1000,
    })),
  );
});

describe("resident agent loop", () => {
  it("browses another timeframe via a tool on its own initiative and streams the conclusion", async () => {
    const deltas: string[] = [];
    const result = await loopMod.runAgentLoop({
      system: "test",
      messages: [{ role: "user", content: "كيف يبدو الذهب؟" }],
      tools: toolsMod.buildResidentTools({ userId, requestId: "req-1" }),
      model: twoStepModel(),
      onTextDelta: (d) => deltas.push(d),
    });
    assert.equal(result.finishReason, "stop");
    assert.equal(result.steps, 2);
    assert.deepEqual(
      result.toolCalls.map((c) => c.name),
      ["read_candles"],
    );
    assert.equal((result.toolCalls[0]!.input as { timeframe: string }).timeframe, "4h");
    assert.ok(deltas.length >= 2, "reply streamed in chunks");
    assert.match(result.text, /4 ساعات/);
    assert.match(result.text, /4000/);
  });

  it("raises AgentIterationLimitError when the step cap is hit mid-tooling", async () => {
    let call = 0;
    const looping = new MockLanguageModelV4({
      doStream: async () => {
        call += 1;
        return streamOf([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: `call-${call}`,
            toolName: "candle_ranges",
            input: "{}",
          },
          { type: "finish", finishReason: { unified: "tool-calls" as const, raw: undefined }, usage },
        ]);
      },
    });
    await assert.rejects(
      () =>
        loopMod.runAgentLoop({
          system: "test",
          messages: [{ role: "user", content: "حلّل" }],
          tools: toolsMod.buildResidentTools({ userId, requestId: "req-2" }),
          model: looping,
          maxSteps: 3,
        }),
      (err: Error) => err instanceof loopMod.AgentIterationLimitError,
    );
    assert.equal(call, 3, "the cap actually stopped the loop");
  });

  it("raises AgentDeadlineError when the wall-clock budget expires", async () => {
    const stalling = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            // Never finishes on its own — only the abort ends it.
            abortSignal?.addEventListener("abort", () => {
              try {
                controller.error(new Error("aborted"));
              } catch {
                /* already closed */
              }
            });
          },
        }),
      }),
    });
    await assert.rejects(
      () =>
        loopMod.runAgentLoop({
          system: "test",
          messages: [{ role: "user", content: "حلّل" }],
          tools: toolsMod.buildResidentTools({ userId, requestId: "req-3" }),
          model: stalling,
          deadlineMs: 200,
        }),
      (err: Error) => err instanceof loopMod.AgentDeadlineError,
    );
  });

  it("exposes raw candle exploration over the stored warehouse", async () => {
    const tools = toolsMod.buildResidentTools({ userId, requestId: "req-4" });
    const read = tools.read_candles!;
    const output = (await read.execute!(
      { timeframe: "4h", count: 10 },
      { toolCallId: "t", messages: [], context: undefined },
    )) as { count: number; candles: { close: number }[]; timeframe: string };
    assert.equal(output.timeframe, "4h");
    assert.equal(output.count, 10);
    assert.ok(output.candles.every((c) => typeof c.close === "number"));

    const ranges = (await tools.candle_ranges!.execute!(
      {},
      { toolCallId: "t2", messages: [], context: undefined },
    )) as { ranges: Record<string, { count: number }> };
    assert.equal(ranges.ranges["4h"]!.count, 30);
  });

  it("refuses to run without a configured provider key", async () => {
    await assert.rejects(
      () =>
        loopMod.runAgentLoop({
          system: "test",
          messages: [{ role: "user", content: "hi" }],
          tools: {},
        }),
      (err: Error) => err instanceof loopMod.AgentModelUnavailableError,
    );
  });
});
