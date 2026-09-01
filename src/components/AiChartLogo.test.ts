import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "node:test";
import { BRAND_NAME, BRAND_WORDMARK } from "@/lib/brand";

const root = resolve(process.cwd(), "src");

describe("AiChartLogo wordmark", () => {
  test("renders LONORA in all caps, not mixed-case Lonora", () => {
    assert.equal(BRAND_WORDMARK, "LONORA");
    assert.notEqual(BRAND_WORDMARK, BRAND_NAME);
    assert.match(BRAND_WORDMARK, /^[A-Z]+$/);
    const logo = readFileSync(resolve(root, "components/AiChartLogo.tsx"), "utf8");
    assert.match(logo, /BRAND_WORDMARK/);
    assert.match(logo, /data-testid="aichart-wordmark"/);
    assert.match(logo, /uppercase/);
    assert.match(logo, /\{BRAND_WORDMARK\}/);
  });
});
