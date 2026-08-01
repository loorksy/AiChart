import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const root = resolve(process.cwd(), "src");

describe("theme persistence architecture", () => {
  it("uses a single aichart-theme storage key", () => {
    const provider = readFileSync(resolve(root, "components/ThemeProvider.tsx"), "utf8");
    assert.match(provider, /aichart-theme/);
    assert.match(provider, /storageKey="aichart-theme"/);
    assert.match(provider, /next-themes/);
  });

  it("boots theme before paint from layout script", () => {
    const layout = readFileSync(resolve(root, "app/layout.tsx"), "utf8");
    assert.match(layout, /THEME_BOOT_SCRIPT/);
    assert.match(layout, /aichart-theme/);
    assert.match(layout, /dangerouslySetInnerHTML/);
  });

  it("exposes ThemeToggle with accessible label", () => {
    const toggle = readFileSync(resolve(root, "components/ThemeToggle.tsx"), "utf8");
    assert.match(toggle, /aria-label/);
    assert.match(toggle, /Sun|Moon/);
  });
});
