import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  rememberOptions,
  resolveOptionReply,
  normalizeNumber,
  clearOptions,
  DEFAULT_AGENT_OPTIONS,
} from "@/lib/agent/sessionOptions";

describe("sessionOptions", () => {
  it("resolves '1' to the first remembered option's prompt", () => {
    const sid = "s-1";
    rememberOptions(sid, DEFAULT_AGENT_OPTIONS);
    const prompt = resolveOptionReply(sid, "1");
    assert.equal(prompt, DEFAULT_AGENT_OPTIONS[0]!.prompt);
  });

  it("resolves Arabic-Indic '٢' to the second option", () => {
    const sid = "s-2";
    rememberOptions(sid, DEFAULT_AGENT_OPTIONS);
    assert.equal(resolveOptionReply(sid, "٢"), DEFAULT_AGENT_OPTIONS[1]!.prompt);
  });

  it("accepts a trailing dot/paren ('1.' / '2)')", () => {
    const sid = "s-3";
    rememberOptions(sid, DEFAULT_AGENT_OPTIONS);
    assert.equal(resolveOptionReply(sid, "1."), DEFAULT_AGENT_OPTIONS[0]!.prompt);
    assert.equal(resolveOptionReply(sid, "2)"), DEFAULT_AGENT_OPTIONS[1]!.prompt);
  });

  it("returns null for a non-index message (treated as a real question)", () => {
    const sid = "s-4";
    rememberOptions(sid, DEFAULT_AGENT_OPTIONS);
    assert.equal(resolveOptionReply(sid, "مرحبا"), null);
    assert.equal(resolveOptionReply(sid, "حلل الذهب"), null);
  });

  it("returns null when no options remembered or index out of range", () => {
    assert.equal(resolveOptionReply("s-none", "1"), null);
    const sid = "s-5";
    rememberOptions(sid, DEFAULT_AGENT_OPTIONS);
    assert.equal(resolveOptionReply(sid, "99"), null);
    assert.equal(resolveOptionReply(sid, "0"), null);
  });

  it("clearOptions drops the remembered set", () => {
    const sid = "s-6";
    rememberOptions(sid, DEFAULT_AGENT_OPTIONS);
    clearOptions(sid);
    assert.equal(resolveOptionReply(sid, "1"), null);
  });

  it("normalizeNumber only accepts pure integers", () => {
    assert.equal(normalizeNumber("12"), "12");
    assert.equal(normalizeNumber("١٢"), "12");
    assert.equal(normalizeNumber("1a"), null);
    assert.equal(normalizeNumber(""), null);
  });
});
