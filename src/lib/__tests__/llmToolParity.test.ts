import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toOATools, fromOAChoice, openAICompatTokenLimitField } from "@/lib/openaiCompat";
import type { ToolDef } from "@/lib/anthropic";

/**
 * Proves the card-rendering tool (render_cards) and any tool flow through the
 * provider-agnostic conversion used for openai/google/openrouter — so cards work
 * with ANY model from ANY provider, not just one.
 */
const RENDER_CARDS: ToolDef = {
  name: "render_cards",
  description: "show interactive cards",
  input_schema: {
    type: "object",
    properties: { layout: { type: "array", items: { type: "object" } } },
    required: ["layout"],
  },
};

describe("LLM tool parity — provider-agnostic card tool", () => {
  it("toOATools converts a tool to the OpenAI function shape", () => {
    const out = toOATools([RENDER_CARDS])!;
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "function");
    assert.equal(out[0].function.name, "render_cards");
    assert.equal(out[0].function.description, "show interactive cards");
    // input_schema is passed through verbatim as JSON-Schema `parameters`.
    assert.deepEqual(out[0].function.parameters, RENDER_CARDS.input_schema);
  });

  it("toOATools returns undefined for no tools", () => {
    assert.equal(toOATools(undefined), undefined);
    assert.equal(toOATools([]), undefined);
  });

  it("fromOAChoice normalizes a render_cards tool_call into a unified tool_use", () => {
    const layout = [{ id: "a1", component: "analysis", props: { symbol: "EURUSD" } }];
    const res = fromOAChoice({
      message: {
        content: "إليك التحليل",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "render_cards", arguments: JSON.stringify({ layout }) } },
        ],
      },
      finish_reason: "tool_calls",
    });
    assert.equal(res.stop_reason, "tool_use");
    const toolUse = res.content.find((b: any) => b.type === "tool_use") as any;
    assert.ok(toolUse, "expected a tool_use block");
    assert.equal(toolUse.name, "render_cards");
    assert.equal(toolUse.id, "call_1");
    assert.deepEqual(toolUse.input.layout, layout);
    // assistant text is preserved alongside the tool call
    assert.ok(res.content.some((b: any) => b.type === "text"));
  });

  it("fromOAChoice tolerates malformed tool arguments (no throw)", () => {
    const res = fromOAChoice({
      message: { tool_calls: [{ id: "c", type: "function", function: { name: "render_cards", arguments: "{not json" } }] },
      finish_reason: "tool_calls",
    });
    const toolUse = res.content.find((b: any) => b.type === "tool_use") as any;
    assert.deepEqual(toolUse.input, {});
  });
});

describe("openAICompatTokenLimitField", () => {
  it("uses max_completion_tokens for gpt-4.1 and o-series", () => {
    assert.equal(openAICompatTokenLimitField("gpt-4.1"), "max_completion_tokens");
    assert.equal(openAICompatTokenLimitField("openai/gpt-4.1"), "max_completion_tokens");
    assert.equal(openAICompatTokenLimitField("o3-mini"), "max_completion_tokens");
    assert.equal(openAICompatTokenLimitField("gpt-5"), "max_completion_tokens");
  });

  it("keeps max_tokens for gpt-4o and OpenRouter-style ids", () => {
    assert.equal(openAICompatTokenLimitField("gpt-4o"), "max_tokens");
    assert.equal(openAICompatTokenLimitField("anthropic/claude-3.5-sonnet"), "max_tokens");
    // Anything unrecognised falls through to max_tokens, which is why the
    // dedicated `gemini-` branch could go with the rest of the integration.
    assert.equal(openAICompatTokenLimitField("some-other-model"), "max_tokens");
  });
});
