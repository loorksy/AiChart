import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Phase 8 removed the QuickChart image fallback from the platform's live
 * capture path entirely (src/lib/chart/liveCapture.ts,
 * src/lib/chart/multiTimeframeCapture.ts). A missing live browser tab now
 * produces an honest 503 failure (or, for multi-timeframe, an entry in
 * missing_timeframes) — never a substitute image. This guard makes sure that
 * fact stays true here: neither the tool-description source nor the bridge
 * response handler may reintroduce a "quickchart" concept, in prose or in
 * logic. If this test fails, one of those two files regressed.
 */
describe("mcp source stays free of quickchart", () => {
  const files = [
    join(process.cwd(), "src", "tools", "schemas", "coreSchemas.ts"),
    join(process.cwd(), "src", "tools", "chartInline.ts"),
  ];

  for (const path of files) {
    it(`${path} contains no "quickchart" (case-insensitive)`, () => {
      const text = readFileSync(path, "utf8");
      assert.doesNotMatch(text, /quickchart/i, `${path} still mentions quickchart`);
    });
  }
});
