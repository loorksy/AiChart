import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(here, "..", "SmartChartAgentPanel.tsx"), "utf8");
const meta = readFileSync(join(here, "..", "MessageCopyMeta.tsx"), "utf8");
const sessions = readFileSync(
  join(here, "../../../hooks/useChatSessions.ts"),
  "utf8",
);
const input = readFileSync(join(here, "..", "AgentChatInput.tsx"), "utf8");

describe("chat message copy + time", () => {
  it("renders the copy/time meta on both user and assistant turns", () => {
    assert.match(panel, /MessageCopyMeta/);
    assert.match(panel, /messageCopyText\(m\)/);
    assert.match(panel, /align="end"/);
    assert.match(panel, /align="start"/);
    assert.match(meta, /type="button"/);
    assert.match(meta, /navigator\.clipboard/);
    assert.match(meta, /agent\.copy/);
  });

  it("hydrates createdAt from persisted history", () => {
    assert.match(sessions, /createdAt: rec\.createdAt/);
  });

  it("does not wire copy through the composer form submit path", () => {
    assert.doesNotMatch(input, /MessageCopyMeta/);
    assert.match(input, /onSubmit=\{/);
    assert.match(input, /type=\{running \? "button" : "submit"\}/);
  });
});
