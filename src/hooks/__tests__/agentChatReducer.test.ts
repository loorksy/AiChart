import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendUserAndPending,
  applyFinal,
  applyLiveNote,
  dropPending,
} from "@/hooks/agentChatReducer";

// The live note is the ENGINE's own sentence, streamed at the moment the work
// happened — its predecessor was a pre-generated ticker script.
const note = "حدّدت بنية السوق: اتجاه صاعد فوق 4010";

describe("agentChatReducer (pending narration bubble)", () => {
  it("sending a message adds the user message and a pending assistant bubble", () => {
    const next = appendUserAndPending([], { id: "u1", content: "حلل" }, "p1");
    assert.equal(next.length, 2);
    assert.equal(next[0].role, "user");
    assert.equal(next[1].role, "assistant");
    assert.equal(next[1].pending, true);
    assert.equal(next[1].liveNote, null);
  });

  it("an activity narration line updates the pending assistant message", () => {
    const base = appendUserAndPending([], { id: "u1", content: "حلل" }, "p1");
    const next = applyLiveNote(base, "p1", note);
    assert.equal(next[1].liveNote, note);
    assert.equal(next[1].pending, true);
  });

  it("the final event replaces the pending message in place (no duplicate)", () => {
    const base = applyLiveNote(
      appendUserAndPending([], { id: "u1", content: "حلل" }, "p1"),
      "p1",
      note,
    );
    const next = applyFinal(base, "p1", { content: "التحليل جاهز.", options: [] });
    // Still exactly 2 messages — the pending bubble was replaced, not appended.
    assert.equal(next.length, 2);
    const assistants = next.filter((m) => m.role === "assistant");
    assert.equal(assistants.length, 1);
    assert.equal(assistants[0].id, "p1");
    assert.equal(assistants[0].pending, false);
    assert.equal(assistants[0].liveNote, null);
    assert.equal(assistants[0].content, "التحليل جاهز.");
  });

  it("cancel/error drops the pending bubble and leaves no stuck note", () => {
    const base = applyLiveNote(
      appendUserAndPending([], { id: "u1", content: "حلل" }, "p1"),
      "p1",
      note,
    );
    const next = dropPending(base, "p1");
    assert.equal(next.length, 1);
    assert.equal(next[0].role, "user");
    assert.equal(next.some((m) => m.pending), false);
  });

  it("dropPending never removes a finalized assistant message", () => {
    const base = applyFinal(
      appendUserAndPending([], { id: "u1", content: "حلل" }, "p1"),
      "p1",
      { content: "done" },
    );
    const next = dropPending(base, "p1");
    assert.equal(next.length, 2); // finalized message survives
  });
});
