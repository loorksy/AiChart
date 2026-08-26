import { afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Prompt-caching invariants — these are BILLING invariants, not features.
 *
 * The platform re-sends a large static system prompt, the frozen evidence
 * bundle, and base64 chart images on every synthesizer retry and browse
 * round. Provider prompt caches make those re-sends nearly free (Anthropic
 * reads ≈ 0.1× input price, OpenAI cached reads heavily discounted) — but
 * ONLY if the prefix stays byte-stable and the cache breakpoints sit at the
 * end of the stable content, never on a volatile tail. A regression here
 * throws no error and fails no request; it silently multiplies spend.
 */

// Set BEFORE importing modules that snapshot platform config from env.
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

/* eslint-disable @typescript-eslint/no-explicit-any */
let callAnthropic: any;
let withCacheBreakpoint: any;
let callOpenAICompat: any;
let supportsExplicitPromptCache: any;
let openaiPromptCacheKey: any;
let buildDecisionUserContent: any;
let cacheMultipliers: any;
let computeCosts: any;

before(async () => {
  ({ callAnthropic, withCacheBreakpoint } = await import("../anthropic"));
  ({ callOpenAICompat, supportsExplicitPromptCache } = await import("../openaiCompat"));
  ({ openaiPromptCacheKey } = await import("../llm"));
  ({ buildDecisionUserContent } = await import(
    "../agent/agents/finalDecisionSynthesizer"
  ));
  ({ cacheMultipliers, computeCosts } = await import("../billing/usageMeter"));
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Capture the JSON body the client actually sends to the provider. */
function interceptFetch(responseBody: unknown): { body: () => any } {
  let captured: any = null;
  globalThis.fetch = (async (_url: any, init?: any) => {
    captured = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { body: () => captured };
}

const ANTHROPIC_OK = {
  id: "msg_1",
  content: [{ type: "text", text: "ok" }],
  stop_reason: "end_turn",
  usage: {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 9000,
    cache_creation_input_tokens: 100,
  },
};

function countBreakpoints(body: any): number {
  let count = 0;
  for (const block of body.system ?? []) if (block.cache_control) count += 1;
  for (const tool of body.tools ?? []) if (tool.cache_control) count += 1;
  for (const msg of body.messages ?? []) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) if (block.cache_control) count += 1;
  }
  return count;
}

describe("Anthropic cache_control placement", () => {
  it("caches the static system prefix and leaves the dynamic tail uncached", async () => {
    const captured = interceptFetch(ANTHROPIC_OK);
    await callAnthropic({
      system: { static: "STATIC RULES", dynamic: "live lesson block" },
      messages: [{ role: "user", content: "hi" }],
    });
    const body = captured.body();
    assert.deepEqual(body.system[0].cache_control, { type: "ephemeral" });
    assert.equal(body.system[0].text, "STATIC RULES");
    assert.equal(body.system[1].cache_control, undefined);
    assert.equal(body.system[1].text, "live lesson block");
  });

  it("marks the last tool definition so the whole tool block is cacheable", async () => {
    const captured = interceptFetch(ANTHROPIC_OK);
    await callAnthropic({
      system: "S",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { name: "a", description: "", input_schema: {} },
        { name: "b", description: "", input_schema: {} },
      ],
    });
    const body = captured.body();
    assert.equal(body.tools[0].cache_control, undefined);
    assert.deepEqual(body.tools[1].cache_control, { type: "ephemeral" });
  });

  it("respects a caller-marked stable-prefix breakpoint AND adds the last-block one", async () => {
    const captured = interceptFetch(ANTHROPIC_OK);
    await callAnthropic({
      system: "S",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "big stable evidence" },
            withCacheBreakpoint({ type: "text", text: "last stable block" }),
            { type: "text", text: "volatile tail" },
          ],
        },
      ],
    });
    const blocks = captured.body().messages[0].content;
    assert.equal(blocks[0].cache_control, undefined);
    assert.deepEqual(blocks[1].cache_control, { type: "ephemeral" });
    // The automatic incremental-conversation breakpoint still lands on the
    // final block — an exact-repeat retry then reads the ENTIRE message.
    assert.deepEqual(blocks[2].cache_control, { type: "ephemeral" });
  });

  it("never exceeds 4 breakpoints total (tools + system + 2 message slots)", async () => {
    const captured = interceptFetch(ANTHROPIC_OK);
    await callAnthropic({
      system: { static: "S", dynamic: "d" },
      messages: [
        {
          role: "user",
          content: [
            withCacheBreakpoint({ type: "text", text: "one" }),
            withCacheBreakpoint({ type: "text", text: "two" }),
            withCacheBreakpoint({ type: "text", text: "three" }),
            { type: "text", text: "tail" },
          ],
        },
      ],
      tools: [{ name: "a", description: "", input_schema: {} }],
    });
    const body = captured.body();
    assert.ok(
      countBreakpoints(body) <= 4,
      `Anthropic allows at most 4 breakpoints, got ${countBreakpoints(body)}`,
    );
    // The LAST caller marks win — the earliest is the one dropped.
    const blocks = body.messages[0].content;
    assert.equal(blocks[0].cache_control, undefined);
    assert.deepEqual(blocks[1].cache_control, { type: "ephemeral" });
    assert.deepEqual(blocks[2].cache_control, { type: "ephemeral" });
  });

  it("surfaces cache read/write token counts on the unified usage shape", async () => {
    interceptFetch(ANTHROPIC_OK);
    const res = await callAnthropic({
      system: "S",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(res.usage.cache_read_input_tokens, 9000);
    assert.equal(res.usage.cache_creation_input_tokens, 100);
  });
});

const OPENAI_OK = {
  id: "chatcmpl-1",
  choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
  usage: {
    prompt_tokens: 1566,
    completion_tokens: 20,
    prompt_tokens_details: { cached_tokens: 1408, cache_write_tokens: 100 },
  },
};

const OPENAI_TARGET = (model: string) => ({
  baseUrl: "https://api.openai.com/v1",
  apiKey: "test-openai-key",
  model,
  resilienceKey: `test-${model}-${Math.random()}`,
});

describe("OpenAI prompt caching", () => {
  it("passes prompt_cache_key through the request body", async () => {
    const captured = interceptFetch(OPENAI_OK);
    await callOpenAICompat(OPENAI_TARGET("gpt-4.1"), {
      system: "S",
      messages: [{ role: "user", content: "hi" }],
      cacheKey: "lonora:v1:abc",
    });
    assert.equal(captured.body().prompt_cache_key, "lonora:v1:abc");
  });

  it("gpt-5.6+ gets an explicit breakpoint at the END of the static system prefix", async () => {
    const captured = interceptFetch(OPENAI_OK);
    await callOpenAICompat(OPENAI_TARGET("gpt-5.6-sol"), {
      system: { static: "STATIC RULES", dynamic: "volatile lesson" },
      messages: [{ role: "user", content: "hi" }],
    });
    const sys = captured.body().messages[0];
    assert.equal(sys.role, "system");
    assert.deepEqual(sys.content[0].prompt_cache_breakpoint, { mode: "explicit" });
    assert.equal(sys.content[0].text, "STATIC RULES");
    assert.equal(sys.content[1].prompt_cache_breakpoint, undefined);
  });

  it("translates caller stable-prefix marks into explicit breakpoints on gpt-5.6+", async () => {
    const captured = interceptFetch(OPENAI_OK);
    await callOpenAICompat(OPENAI_TARGET("gpt-5.6-sol"), {
      system: "S",
      messages: [
        {
          role: "user",
          content: [
            withCacheBreakpoint({ type: "text", text: "stable evidence" }),
            { type: "text", text: "volatile tail" },
          ],
        },
      ],
    });
    const parts = captured.body().messages[1].content;
    assert.deepEqual(parts[0].prompt_cache_breakpoint, { mode: "explicit" });
    assert.equal(parts[1].prompt_cache_breakpoint, undefined);
  });

  it("implicit-only models (gpt-4.1) never receive breakpoint fields", async () => {
    const captured = interceptFetch(OPENAI_OK);
    await callOpenAICompat(OPENAI_TARGET("gpt-4.1"), {
      system: { static: "S", dynamic: "d" },
      messages: [
        {
          role: "user",
          content: [withCacheBreakpoint({ type: "text", text: "stable" })],
        },
      ],
    });
    const raw = JSON.stringify(captured.body());
    assert.ok(!raw.includes("prompt_cache_breakpoint"));
    // Prefix ORDER is preserved for automatic caching: static before dynamic.
    assert.equal(captured.body().messages[0].content, "S\n\nd");
  });

  it("normalizes usage: input_tokens excludes cached and written tokens", async () => {
    interceptFetch(OPENAI_OK);
    const res = await callOpenAICompat(OPENAI_TARGET("gpt-4.1"), {
      system: "S",
      messages: [{ role: "user", content: "hi" }],
    });
    // 1566 total prompt = 1408 cached + 100 written + 58 uncached.
    assert.equal(res.usage.input_tokens, 58);
    assert.equal(res.usage.cache_read_input_tokens, 1408);
    assert.equal(res.usage.cache_creation_input_tokens, 100);
  });

  it("classifies the explicit-cache model families", () => {
    assert.equal(supportsExplicitPromptCache("gpt-5.6-sol"), true);
    assert.equal(supportsExplicitPromptCache("gpt-5.6-luna-pro"), true);
    assert.equal(supportsExplicitPromptCache("gpt-4.1"), false);
    assert.equal(supportsExplicitPromptCache("openai/gpt-5.6-terra"), true);
  });
});

describe("openaiPromptCacheKey", () => {
  it("is stable for the same static prefix and ignores the volatile dynamic tail", () => {
    const a = openaiPromptCacheKey({ static: "RULES", dynamic: "turn 1 context" });
    const b = openaiPromptCacheKey({ static: "RULES", dynamic: "turn 2 context" });
    assert.equal(a, b);
    assert.match(a, /^lonora:v1:[0-9a-f]{16}$/);
  });

  it("differs between stage families (different static prompts)", () => {
    assert.notEqual(
      openaiPromptCacheKey("decision synthesizer rules"),
      openaiPromptCacheKey("general answer rules"),
    );
  });
});

describe("decision synthesizer prefix stability", () => {
  const evidence = JSON.stringify({ symbol: "XAUUSD", price: 4321 });
  const image = {
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/png" as const,
      data: "aGVsbG8=",
    },
  };

  it("same evidence + visuals produce byte-identical stable prefixes across calls", () => {
    const first = buildDecisionUserContent(evidence, [image], null);
    const retry = buildDecisionUserContent(evidence, [image], "[SCHEMA CORRECTION] fix x");
    const round = buildDecisionUserContent(evidence, [image], "## Chart reading …");
    // The stable prefix (evidence + charts) is identical in all three.
    assert.equal(
      JSON.stringify(first.slice(0, 2)),
      JSON.stringify(retry.slice(0, 2)),
    );
    assert.equal(
      JSON.stringify(first.slice(0, 2)),
      JSON.stringify(round.slice(0, 2)),
    );
  });

  it("puts the breakpoint on the LAST stable block, never the volatile tail", () => {
    const blocks = buildDecisionUserContent(evidence, [image], "volatile tail");
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].cache_control, undefined);
    assert.deepEqual(blocks[1].cache_control, { type: "ephemeral" });
    assert.equal(blocks[2].cache_control, undefined);
    assert.equal(blocks[2].text, "volatile tail");
  });

  it("marks the evidence block itself when no charts are attached", () => {
    const blocks = buildDecisionUserContent(evidence, [], "tail");
    assert.deepEqual(blocks[0].cache_control, { type: "ephemeral" });
  });

  it("appends no empty tail block", () => {
    assert.equal(buildDecisionUserContent(evidence, [image], null).length, 2);
    assert.equal(buildDecisionUserContent(evidence, [image], "  ").length, 2);
  });
});

describe("cache-aware cost accounting", () => {
  it("prices Anthropic reads at 0.1x and writes at 1.25x the input rate", () => {
    assert.deepEqual(cacheMultipliers("anthropic", "claude-sonnet-4-6"), {
      read: 0.1,
      write: 1.25,
    });
    const price = { input_usd_per_m: 3, output_usd_per_m: 15 };
    const costs = computeCosts(price, 1000, 0, 1, {
      readTokens: 1_000_000,
      writeTokens: 0,
      readMultiplier: 0.1,
      writeMultiplier: 1.25,
    });
    // 1K uncached @$3/M = $0.003 + 1M cached reads @$0.30/M = $0.30.
    assert.ok(Math.abs((costs.provider ?? 0) - 0.303) < 1e-9);
  });

  it("keeps the legacy 4-argument computeCosts contract intact", () => {
    const costs = computeCosts(
      { input_usd_per_m: 5, output_usd_per_m: 30 },
      20_000,
      3_000,
      1.5,
    );
    assert.ok(Math.abs((costs.provider ?? 0) - 0.19) < 1e-9);
  });
});
