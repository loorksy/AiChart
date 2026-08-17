import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMessageClock, messageCopyText } from "../messageCopy";

describe("message copy helpers", () => {
  it("copies finalized content and skips empty pending bubbles", () => {
    assert.equal(messageCopyText({ content: "  أهلاً  " }), "أهلاً");
    assert.equal(messageCopyText({ content: "hidden", pending: true }), "");
    assert.equal(
      messageCopyText({
        content: "",
        pending: true,
        streamText: "  جزء من الرد  ",
      }),
      "جزء من الرد",
    );
  });

  it("formats a 24-hour clock in both locales", () => {
    const ts = Date.parse("2026-08-17T14:32:00");
    const en = formatMessageClock(ts, "en");
    const ar = formatMessageClock(ts, "ar");
    assert.match(en, /\d{1,2}:\d{2}/);
    assert.match(ar, /[\d\u0660-\u0669]{1,2}:[\d\u0660-\u0669]{2}/);
    assert.equal(formatMessageClock(Number.NaN, "en"), "");
  });
});
