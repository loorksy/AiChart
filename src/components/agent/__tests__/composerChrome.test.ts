import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const input = readFileSync(
  join(__dirname, "../AgentChatInput.tsx"),
  "utf8",
);
const picker = readFileSync(
  join(__dirname, "../AgentModelPicker.tsx"),
  "utf8",
);

describe("composer chrome", () => {
  it("does not render a plus menu beside the send button", () => {
    assert.doesNotMatch(input, /ComposerMoreMenu/);
    assert.doesNotMatch(input, /composer-more/);
    assert.match(input, /ComposerModelChip/);
    assert.match(input, /RiskPerTradeControl/);
    assert.match(input, /ComposerIntervalPicker/);
  });

  it("shows the model name without the company in the picker", () => {
    assert.match(picker, /shortModelLabel/);
  });
});
