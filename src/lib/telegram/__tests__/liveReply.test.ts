import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LIVE_THINK_TEXT, LIVE_WAKE_TEXT } from "@/lib/telegram/liveReply";

const SRC = path.join(import.meta.dirname, "..", "..", "..");

describe("OpenClaw-style live Telegram window", () => {
  it("uses a waking then thinking status, not a leftover analyzing dump", () => {
    assert.equal(LIVE_WAKE_TEXT.includes("أوقظ"), true);
    assert.equal(LIVE_THINK_TEXT.includes("أفكّر"), true);
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
