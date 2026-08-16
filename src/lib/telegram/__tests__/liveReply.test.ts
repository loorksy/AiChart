import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = path.join(import.meta.dirname, "..", "..", "..");

describe("OpenClaw-style live Telegram window", () => {
  it("carries no pre-printed status text — the engine writes every line", () => {
    // "أوقظ الوكيل…" and "أفكّر…" were fixed strings shown to every user on
    // every run. The bubble is now created lazily by the first REAL engine
    // event (liveProgress.ts), so this module owns no status prose at all.
    const live = readFileSync(path.join(SRC, "lib", "telegram", "liveReply.ts"), "utf8");
    assert.doesNotMatch(live, /LIVE_WAKE_TEXT|LIVE_THINK_TEXT/);
    assert.doesNotMatch(live, /أوقظ|أفكّر/);
  });

  it("edits the same bubble forward and deletes it when a photo replaces it", () => {
    const live = readFileSync(path.join(SRC, "lib", "telegram", "liveReply.ts"), "utf8");
    assert.match(live, /editMessageText/);
    assert.match(live, /deleteMessage/);
    assert.match(live, /sendChatAction/);
    assert.match(live, /finalize/);
    assert.match(live, /discard/);
  });

  it("threads the window to the user's message", () => {
    const live = readFileSync(path.join(SRC, "lib", "telegram", "liveReply.ts"), "utf8");
    assert.match(live, /replyToMessageId/);
    const agent = readFileSync(path.join(SRC, "lib", "telegram", "webhookAgent.ts"), "utf8");
    assert.match(agent, /live.discard/);
    assert.match(agent, /reportLinkButtons/);
  });
});
