import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = join(__dirname, "..");

function read(name: string): string {
  return readFileSync(join(root, name), "utf8");
}

describe("metal chrome", () => {
  it("keeps liquid-metal and metal-fx wrappers free of raw hex", () => {
    for (const file of [
      "liquid-metal-button.tsx",
      "metal-fx.tsx",
      "metal-icon-button.tsx",
    ]) {
      const src = read(file);
      assert.doesNotMatch(
        src,
        /#[0-9a-fA-F]{3,8}\b/,
        `${file} must use design tokens, not raw hex`,
      );
    }
  });

  it("liquid metal button still exposes a real hit target", () => {
    const src = read("liquid-metal-button.tsx");
    assert.match(src, /liquidMetalFragmentShader/);
    assert.match(src, /ShaderMount/);
    assert.match(src, /type\?: "button" \| "submit"/);
    assert.match(src, /href\?:/);
    assert.match(src, /dispose/);
    assert.match(src, /export function LiquidMetalFrame/);
  });

  it("composer frame keeps liquid metal on the rim only", () => {
    const css = readFileSync(join(__dirname, "../../../app/globals.css"), "utf8");
    assert.match(css, /\.liquid-metal-frame-shader/);
    assert.match(css, /mask-composite:\s*exclude/);
    assert.match(css, /\.liquid-metal-frame-face/);
    assert.match(css, /background:\s*var\(--chat-input\)/);
    assert.doesNotMatch(
      css.slice(css.indexOf(".liquid-metal-frame-face"), css.indexOf(".liquid-metal-frame-face") + 220),
      /70%,\s*transparent/,
    );
  });

  it("MetalFx follows the app theme, not only the OS scheme", () => {
    const src = read("metal-fx.tsx");
    assert.match(src, /useTheme/);
    assert.match(src, /prefers-reduced-motion/);
  });
});
