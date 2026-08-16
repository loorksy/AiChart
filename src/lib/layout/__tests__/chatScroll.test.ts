import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  CHAT_STICK_THRESHOLD_PX,
  isPinnedToBottom,
  nextChatPinState,
  scrollChatToBottom,
} from "@/lib/layout/chatScroll";

describe("chat stick-to-bottom", () => {
  it("treats the last threshold pixels as still following", () => {
    const tall = { scrollHeight: 2000, scrollTop: 1904, clientHeight: 80 };
    assert.equal(isPinnedToBottom(tall), true);
    assert.equal(isPinnedToBottom({ ...tall, scrollTop: 1800 }), false);
    assert.ok(CHAT_STICK_THRESHOLD_PX > 0);
  });

  it("a send re-pins even when the operator was reading history", () => {
    assert.equal(nextChatPinState({ sent: true, atBottom: false }), true);
    assert.equal(nextChatPinState({ sent: false, atBottom: false }), false);
    assert.equal(nextChatPinState({ sent: false, atBottom: true }), true);
  });

  it("jumps the scroller to the latest turn", () => {
    const el = { scrollTop: 10, scrollHeight: 800 };
    scrollChatToBottom(el);
    assert.equal(el.scrollTop, 800);
  });

  it("the live thread pins on send and follows the growing reply", () => {
    const panel = readFileSync(
      resolve(process.cwd(), "src/components/agent/SmartChartAgentPanel.tsx"),
      "utf8",
    );
    const hook = readFileSync(
      resolve(process.cwd(), "src/hooks/useChatStickToBottom.ts"),
      "utf8",
    );
    assert.match(panel, /useChatStickToBottom/);
    assert.match(panel, /sendAndFollow/);
    assert.match(panel, /data-testid="chat-scroll-region"/);
    assert.match(hook, /scrollChatToBottom/);
    assert.match(hook, /ResizeObserver/);
    assert.match(hook, /pinnedRef/);
  });
});
