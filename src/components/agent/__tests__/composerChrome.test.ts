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

  it("clips the model menu scrollbar inside the rounded panel", () => {
    assert.match(input, /composer-model-menu/);
    assert.match(input, /overflow-hidden rounded-2xl/);
    assert.match(input, /composer-menu-scroll/);
    assert.doesNotMatch(
      input,
      /overflow-y-auto rounded-2xl/,
      "scrollbar must not live on the rounded shell",
    );
  });

  it("uses a chip-styled send control with a live ArrowUp glyph", () => {
    assert.match(input, /<ArrowUp\b/);
    assert.match(input, /metal-chip-icon/);
    assert.match(input, /composer-send-ready/);
    assert.match(input, /composer-send-launch/);
    assert.doesNotMatch(input, /<Send\b/);
    assert.doesNotMatch(input, /MetalFx/);
  });

  it("wraps the writing field in the same liquid-metal frame as suggestions", () => {
    assert.match(input, /LiquidMetalFrame/);
    assert.match(input, /chat-gpt-input/);
    assert.match(input, /metal-chip/);
  });
});
