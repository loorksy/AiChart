import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickRecoveredAssistant } from "@/lib/agent/recoverPendingTurn";

describe("pickRecoveredAssistant", () => {
  it("returns the assistant that follows the matching user turn", () => {
    const found = pickRecoveredAssistant(
      [
        { role: "user", content: "حلل" },
        { role: "assistant", content: "قديم" },
        { role: "user", content: "أعطني توصية" },
        {
          role: "assistant",
          content: "شراء",
          result: { summary: "شراء" },
          createdAt: 9,
        },
      ],
      "أعطني توصية",
    );
    assert.ok(found);
    assert.equal(found.content, "شراء");
    assert.equal(found.createdAt, 9);
  });

  it("returns null when the user turn has no assistant yet", () => {
    const found = pickRecoveredAssistant(
      [{ role: "user", content: "حلل الذهب" }],
      "حلل الذهب",
    );
    assert.equal(found, null);
  });

  it("falls back to the latest assistant when the user line is missing", () => {
    const found = pickRecoveredAssistant(
      [{ role: "assistant", content: "تم" }],
      "حلل",
    );
    assert.ok(found);
    assert.equal(found.content, "تم");
  });
});
