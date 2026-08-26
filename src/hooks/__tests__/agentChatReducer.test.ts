import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendUserAndPending,
  applyFinal,
  applyLiveNote,
  applyThinking,
  dropPending,
  MAX_THINKING_LINES,
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
    assert.equal(typeof next[0].createdAt, "number");
    assert.equal(next[0].createdAt, next[1].createdAt);
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
    assert.equal(assistants[0].createdAt, base[1].createdAt);
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

  describe("applyThinking (live thinking trace)", () => {
    const base = () => appendUserAndPending([], { id: "u1", content: "حلل" }, "p1");

    it("appends the agent's thinking lines to the pending bubble in order", () => {
      let msgs = applyThinking(base(), "p1", "قرأت 240 شمعة على فريم 1h");
      msgs = applyThinking(msgs, "p1", "الاتجاه صاعد فوق 4620.50");
      assert.deepEqual(msgs[1].thinking, [
        "قرأت 240 شمعة على فريم 1h",
        "الاتجاه صاعد فوق 4620.50",
      ]);
      assert.equal(msgs[1].pending, true);
    });

    it("dedupes a replayed frame (same line twice in a row)", () => {
      let msgs = applyThinking(base(), "p1", "سطر واحد");
      msgs = applyThinking(msgs, "p1", "سطر واحد");
      assert.deepEqual(msgs[1].thinking, ["سطر واحد"]);
    });

    it("caps the trace so a pathological run cannot grow the DOM unbounded", () => {
      let msgs = base();
      for (let i = 0; i < MAX_THINKING_LINES + 10; i += 1) {
        msgs = applyThinking(msgs, "p1", `line ${i}`);
      }
      assert.equal(msgs[1].thinking!.length, MAX_THINKING_LINES);
      assert.equal(msgs[1].thinking![MAX_THINKING_LINES - 1], `line ${MAX_THINKING_LINES + 9}`);
    });

    it("ignores blank lines and never touches a finalized message", () => {
      const blank = applyThinking(base(), "p1", "   ");
      assert.equal(blank[1].thinking, undefined);
      const done = applyFinal(base(), "p1", { content: "done" });
      const after = applyThinking(done, "p1", "late line");
      assert.equal(after[1].thinking, undefined);
    });

    it("the final replacement discards the live thinking lines", () => {
      const withThinking = applyThinking(base(), "p1", "قرأت البيانات");
      const finalized = applyFinal(withThinking, "p1", { content: "الجواب" });
      assert.equal(finalized[1].thinking, undefined);
      assert.equal(finalized[1].content, "الجواب");
    });
  });
});
