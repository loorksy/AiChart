/**
 * The share control is wired into every recommendation surface the trader
 * actually sees: the list card, the tracker card, the full report, and the
 * chat report modal. A missing import here is a missing icon in production.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = join(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("profit card share wiring", () => {
  it("puts the share button on the list card, tracker card, full report, and report modal", () => {
    const files = {
      list: read("components/recommendations/TrackedPlanCard.tsx"),
      tracker: read("components/recommendations/RecommendationTrackerCard.tsx"),
      full: read("components/recommendations/RecommendationFullReport.tsx"),
      modal: read("components/agent/cards/RecommendationReport.tsx"),
    };
    for (const [name, src] of Object.entries(files)) {
      assert.match(src, /ShareProfitButton/, `${name} is missing ShareProfitButton`);
    }
  });

  it("uses the real Lonora face-mark and never a fake 3-circle logo or invented referral", () => {
    const card = read("components/recommendations/ProfitCard.tsx");
    const model = read("lib/recommendations/profitCard.ts");
    assert.match(model, /\/brand\/aichart-mark-dark\.png/);
    assert.match(card, /PROFIT_CARD_LOGO_SRC/);
    assert.doesNotMatch(card, /LNR21GOLD|lonora\.com\/ref|100X|100×/);
    assert.doesNotMatch(model, /LNR21GOLD|lonora\.com\/ref/);
    assert.doesNotMatch(card, /t\(\s*"ar"/);
    assert.doesNotMatch(model, /t\(\s*"ar"/);
  });

  it("captures via html-to-image and offers download plus Web Share", () => {
    const modal = read("components/recommendations/ShareProfitCardModal.tsx");
    assert.match(modal, /html-to-image/);
    assert.match(modal, /toBlob/);
    assert.match(modal, /navigator\.share/);
    assert.match(modal, /download/);
    assert.match(modal, /useSheetGesture/);
  });
});
