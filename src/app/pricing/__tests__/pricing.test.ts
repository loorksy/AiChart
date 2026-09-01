import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "node:test";

const root = resolve(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("public pricing chrome", () => {
  test("pricing uses PublicChrome + horizon, not the old compact LandingNav", () => {
    const page = read("app/pricing/page.tsx");
    assert.match(page, /PublicChrome/);
    assert.match(page, /PUBLIC_MAIN_PAD/);
    assert.match(page, /showFooter/);
    assert.doesNotMatch(page, /variant="compact"/);
    assert.doesNotMatch(page, /min-h-dvh bg-background/);
    assert.doesNotMatch(page, /LandingNav/);
  });

  test("unsigned checkout does not send visitors to closed signup", () => {
    const cards = read("components/billing/PricingCards.tsx");
    assert.match(cards, /\/login\?next=\/pricing/);
    assert.doesNotMatch(cards, /\/signup\?next=\/pricing/);
  });
});
