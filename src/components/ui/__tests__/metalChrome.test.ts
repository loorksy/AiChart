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
    assert.match(src, /export const LiquidMetalFrame/);
    assert.match(src, /APP_WAKE_EVENT/);
    assert.match(src, /webglcontextlost/);
  });

  it("composer frame fills with metal so the inset face reveals all four sides", () => {
    const src = read("liquid-metal-button.tsx");
    assert.match(src, /u_fit:\s*ShaderFitOptions\.cover/);
    assert.match(src, /FRAME_UNIFORMS/);
    assert.match(src, /mountLiquidMetal\(host,\s*FRAME_UNIFORMS\)/);
    const css = readFileSync(join(__dirname, "../../../app/globals.css"), "utf8");
    assert.match(css, /\.liquid-metal-frame-face/);
    assert.match(css, /background:\s*var\(--chat-input\)/);
    assert.match(css, /mask-composite:\s*exclude/);
    assert.match(css, /\.liquid-metal-frame-shader/);
  });

  it("MetalFx follows the app theme, not only the OS scheme", () => {
    const src = read("metal-fx.tsx");
    assert.match(src, /useTheme/);
    assert.match(src, /prefers-reduced-motion/);
  });
});
