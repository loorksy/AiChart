import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "node:test";

const root = resolve(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("AuthForm public chrome", () => {
  test("login and signup wrap AuthForm in PublicChrome", () => {
    const login = read("app/login/page.tsx");
    const signup = read("app/signup/page.tsx");
    assert.match(login, /PublicChrome/);
    assert.match(login, /<AuthForm/);
    assert.match(signup, /PublicChrome/);
    assert.match(signup, /<AuthForm/);
  });

  test("keeps language switcher and never mounts a theme toggle", () => {
    const auth = read("components/AuthForm.tsx");
    assert.match(auth, /LanguageSwitcher/);
    assert.match(auth, /auth-locale-toggle/);
    assert.doesNotMatch(auth, /ThemeToggle/);
    assert.doesNotMatch(auth, /landing-theme-toggle/);
  });

  test("sits on the shared glass card without its own page header", () => {
    const auth = read("components/AuthForm.tsx");
    assert.match(auth, /landing-composer-glass/);
    assert.match(auth, /max-w-\[100vw\]/);
    assert.match(auth, /overflow-x-hidden/);
    assert.match(auth, /min-w-0 max-w-full/);
    assert.doesNotMatch(auth, /LandingNav/);
    assert.doesNotMatch(auth, /ChartBackdrop/);
  });
});
