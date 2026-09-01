import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "node:test";

const root = resolve(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const PUBLIC_PAGES = [
  "app/pricing/page.tsx",
  "app/privacy/page.tsx",
  "app/login/page.tsx",
  "app/signup/page.tsx",
] as const;

describe("shared public chrome", () => {
  test("PublicChrome is the horizon + overlay shell", () => {
    const chrome = read("components/landing/PublicChrome.tsx");
    assert.match(chrome, /HorizonBackground/);
    assert.match(chrome, /LandingNav/);
    assert.match(chrome, /landing-viewport/);
    assert.match(chrome, /public-chrome/);
    assert.doesNotMatch(chrome, /ThemeToggle|LanguageSwitcher/);
  });

  test("every public marketing/auth page uses PublicChrome", () => {
    for (const file of PUBLIC_PAGES) {
      const src = read(file);
      assert.match(src, /PublicChrome/, file);
      assert.doesNotMatch(src, /variant="compact"/, file);
    }
    const landing = read("components/landing/LandingPage.tsx");
    assert.match(landing, /PublicChrome/);
  });

  test("privacy uses the same horizon chrome as pricing", () => {
    const privacy = read("app/privacy/page.tsx");
    assert.match(privacy, /PublicChrome/);
    assert.match(privacy, /PUBLIC_MAIN_PAD/);
    assert.match(privacy, /showFooter/);
    assert.doesNotMatch(privacy, /mx-auto max-w-3xl bg-background/);
  });
});
