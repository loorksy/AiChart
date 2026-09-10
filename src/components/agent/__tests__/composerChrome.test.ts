import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const input = readFileSync(
  join(__dirname, "../AgentChatInput.tsx"),
  "utf8",
);
const popover = readFileSync(
  join(__dirname, "../ComposerPopover.tsx"),
  "utf8",
);
const css = readFileSync(
  join(__dirname, "../../../app/globals.css"),
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
    assert.match(input, /ComposerIntervalPicker/);
  });

  it("carries no risk-percentage chip — stops are placed by scenario, not by a percentage", () => {
    assert.doesNotMatch(input, /RiskPerTradeControl/);
    assert.doesNotMatch(input, /per_trade_pct/);
  });

  it("shows the model name without the company in the picker", () => {
    assert.match(picker, /shortModelLabel/);
  });

  it("uses one tucked sheet for model and timeframe", () => {
    assert.match(input, /composer-model-menu/);
    assert.match(input, /ComposerPopover/);
    assert.match(popover, /composer-sheet/);
    assert.match(popover, /TUCK/);
    assert.match(css, /\.composer-sheet/);
    assert.match(css, /--composer-sheet-tuck/);
    assert.match(css, /backdrop-filter:\s*blur\(72px\)/);
    assert.match(css, /saturate\(180%\)/);
    assert.match(css, /composer-menu-scroll/);
    assert.match(css, /\.composer-sheet-item/);
    assert.match(css, /\.composer-chip-row/);
    const interval = readFileSync(
      join(__dirname, "../ComposerMarketPickers.tsx"),
      "utf8",
    );
    assert.match(interval, /composer-interval-menu/);
    assert.match(interval, /composer-sheet-item/);
  });

  it("uses a chip-styled send control with a live ArrowUp glyph", () => {
    assert.match(input, /<ArrowUp\b/);
    assert.match(input, /metal-chip-icon/);
    assert.match(input, /composer-send-ready/);
    assert.match(input, /composer-send-launch/);
    assert.doesNotMatch(input, /<Send\b/);
    assert.doesNotMatch(input, /MetalFx/);
  });

  it("keeps composer chips chevron-free and spaced", () => {
    assert.match(input, /composer-chip-row/);
    assert.doesNotMatch(input, /ChevronDown/);
    const interval = readFileSync(
      join(__dirname, "../ComposerMarketPickers.tsx"),
      "utf8",
    );
    assert.doesNotMatch(interval, /ChevronDown/);
  });

  it("wraps the writing field in the same liquid-metal frame as suggestions", () => {
    assert.match(input, /LiquidMetalFrame/);
    assert.match(input, /chat-gpt-input/);
    assert.match(input, /metal-chip/);
  });
});
