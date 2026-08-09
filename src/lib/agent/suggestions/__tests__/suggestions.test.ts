import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeAgentSuggestions } from "@/lib/agent/suggestions/sanitizeAgentSuggestions";
import {
  generateAgentSuggestions,
  parseAgentSuggestions,
} from "@/lib/agent/suggestions/generateAgentSuggestions";
import {
  rememberOptions,
  resolveOptionReply,
} from "@/lib/agent/sessionOptions";
import type { AgentFinalResult } from "@/lib/agent/types";

function result(over: Partial<AgentFinalResult> = {}): AgentFinalResult {
  return {
    decision: "buy",
    confidence: 0.7,
    summary: "buy setup",
    keyReasons: [],
    riskWarnings: [],
    activityEvents: [],
    ...over,
  };
}

describe("sanitizeAgentSuggestions", () => {
  it("caps the list at 4", () => {
    const raw = Array.from({ length: 8 }, (_, i) => ({
      label: `L${i}`,
      prompt: `P${i}`,
    }));
    assert.equal(sanitizeAgentSuggestions(raw).length, 4);
  });

  it("drops entries with an empty label or prompt", () => {
    const out = sanitizeAgentSuggestions([
      { label: "", prompt: "p" },
      { label: "l", prompt: "" },
      { label: "  ", prompt: "  " },
      { label: "ok", prompt: "go" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].label, "ok");
  });

  it("de-duplicates by label and assigns ids", () => {
    const out = sanitizeAgentSuggestions([
      { label: "same", prompt: "a" },
      { label: "same", prompt: "b" },
    ]);
    assert.equal(out.length, 1);
    assert.ok(out[0].id);
  });

  it("returns [] for non-array / garbage input", () => {
    assert.deepEqual(sanitizeAgentSuggestions(null), []);
    assert.deepEqual(sanitizeAgentSuggestions("nope" as unknown), []);
  });
});

describe("generateAgentSuggestions", () => {
  it("returns [] when the LLM is not configured (no static fallback)", async () => {
    const out = await generateAgentSuggestions(
      { locale: "ar", userMessage: "حلل", result: result() },
      { configured: false },
    );
    assert.deepEqual(out, []);
  });

  it("returns [] when generation fails (no static fallback)", async () => {
    const out = await generateAgentSuggestions(
      { locale: "ar", userMessage: "حلل", result: result() },
      { configured: true, callModel: async () => "not json at all" },
    );
    assert.deepEqual(out, []);
  });

  it("accepts Arabic suggestions", async () => {
    const out = await generateAgentSuggestions(
      { locale: "ar", userMessage: "أعطني توصية", result: result() },
      {
        configured: true,
        callModel: async () =>
          JSON.stringify({
            suggestions: [
              { label: "تابع حالة هذه التوصية", prompt: "شو وضع التوصية؟" },
              { label: "اشرح سبب التوصية", prompt: "بناءً على ماذا؟" },
            ],
          }),
      },
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].label, "تابع حالة هذه التوصية");
  });

  it("accepts English suggestions and caps to max", async () => {
    const out = await generateAgentSuggestions(
      { locale: "en", userMessage: "analyze", result: result({ decision: "informational" }), maxSuggestions: 4 },
      {
        configured: true,
        callModel: async () =>
          "```json\n" +
          JSON.stringify({
            suggestions: [
              { label: "Analyze the current chart", prompt: "Analyze the current chart." },
              { label: "Buy or sell opinion", prompt: "Give me your direction and a full plan." },
              { label: "Empty", prompt: "" },
            ],
          }) +
          "\n```",
      },
    );
    assert.equal(out.length, 2); // empty-prompt entry dropped
    assert.equal(out[0].label, "Analyze the current chart");
  });

  it("parses raw JSON via parseAgentSuggestions", () => {
    const out = parseAgentSuggestions(
      JSON.stringify({ suggestions: [{ label: "x", prompt: "y" }] }),
    );
    assert.equal(out.length, 1);
  });
});

describe("number replies resolve against the latest shown suggestions", () => {
  it("remembers dynamic suggestions and resolves '1' / '٢'", () => {
    const sid = "sug-session";
    const suggestions = [
      { id: "a", label: "تابع", prompt: "شو وضع التوصية؟" },
      { id: "b", label: "اشرح", prompt: "بناءً على ماذا؟" },
    ];
    rememberOptions(sid, suggestions);
    assert.equal(resolveOptionReply(sid, "1"), "شو وضع التوصية؟");
    assert.equal(resolveOptionReply(sid, "٢"), "بناءً على ماذا؟");
  });
});
