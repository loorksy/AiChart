import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContextMessages } from "../normalizeMessages";
import { repairToolPairs } from "../repairToolPairs";

function normalize(messages: Parameters<typeof normalizeContextMessages>[0]) {
  return normalizeContextMessages(messages).messages;
}

test("preserves a complete pair and repairs result ordering", () => {
  const messages = normalize([
    { id: "r", role: "tool", kind: "tool_result", toolCallId: "c1", content: "ok" },
    { id: "c", role: "assistant", kind: "tool_call", toolCall: { id: "c1", name: "market" }, content: "" },
  ]);
  const result = repairToolPairs(messages, "en");
  assert.deepEqual(result.messages.map(({ id }) => id), ["c", "r"]);
});

test("removes orphan and duplicate results", () => {
  const messages = normalize([
    { id: "orphan", role: "tool", kind: "tool_result", toolCallId: "none", content: "x" },
    { id: "c", role: "assistant", kind: "tool_call", toolCall: { id: "c1", name: "x" } },
    { id: "r1", role: "tool", kind: "tool_result", toolCallId: "c1", content: "old" },
    { id: "r2", role: "tool", kind: "tool_result", toolCallId: "c1", content: "new" },
  ]);
  const result = repairToolPairs(messages, "en");
  assert.equal(result.messages.find(({ kind }) => kind === "tool_result")?.content, "new");
  assert.ok(result.removedMessageIds.includes("orphan"));
  assert.ok(result.removedMessageIds.includes("r1"));
});

test("inserts localized neutral placeholder for a retained call without result", () => {
  const messages = normalize([{ id: "c", role: "assistant", kind: "tool_call", toolCall: { id: "c1", name: "x" } }]);
  const result = repairToolPairs(messages, "ar");
  assert.equal(result.placeholderCount, 1);
  assert.match(result.messages[1]!.content, /سجل أداة مضغوط/);
  assert.equal(result.messages[1]!.toolCallId, "c1");
});

test("redacts secrets in tool results", () => {
  const messages = normalize([
    { id: "c", role: "assistant", kind: "tool_call", toolCall: { id: "c1", name: "x" } },
    { id: "r", role: "tool", kind: "tool_result", toolCallId: "c1", content: "Authorization: Bearer abcdefghijklmnop" },
  ]);
  const result = repairToolPairs(messages, "en");
  assert.doesNotMatch(result.messages[1]!.content, /abcdefghijklmnop/);
  assert.match(result.messages[1]!.content, /REDACTED/);
});

test("redacts secrets in tool-call arguments", () => {
  const messages = normalize([
    {
      id: "c", role: "assistant", kind: "tool_call",
      toolCall: { id: "c1", name: "x", arguments: "{\"authorization\":\"Bearer abcdefghijklmnop\"}" },
    },
    { id: "r", role: "tool", kind: "tool_result", toolCallId: "c1", content: "ok" },
  ]);
  const result = repairToolPairs(messages, "en");
  assert.doesNotMatch(result.messages[0]!.toolCall?.arguments ?? "", /abcdefghijklmnop/);
});
