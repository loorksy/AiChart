/**
 * Report share opens the recommendation card (the issued plan). PnL share
 * still opens ProfitCard. The rec modal always shows the live React card.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = join(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("recommendation card share wiring", () => {
  it("report / detail / tracker share the recommendation card, not ProfitCard as the primary", () => {
    const files = {
      tracker: read("components/recommendations/RecommendationTrackerCard.tsx"),
      full: read("components/recommendations/RecommendationFullReport.tsx"),
      modal: read("components/agent/cards/RecommendationReport.tsx"),
    };
    for (const [name, src] of Object.entries(files)) {
      assert.match(src, /ShareRecommendationButton/, `${name} is missing ShareRecommendationButton`);
    }
    const recModal = read("components/recommendations/ShareRecommendationCardModal.tsx");
    assert.match(recModal, /<RecommendationCard/);
    assert.doesNotMatch(recModal, /<ProfitCard/);
    assert.match(recModal, /data-testid="recommendation-card-live-preview"/);
    assert.doesNotMatch(recModal, /data-testid="profit-card"/);
  });

  it("the rec card paints entry, stop, and every TP", () => {
    const card = read("components/recommendations/RecommendationCard.tsx");
    assert.match(card, /data-testid="recommendation-card-share"/);
    assert.match(card, /testId="recommendation-card-entry"/);
    assert.match(card, /testId="recommendation-card-stop"/);
    assert.match(card, /recommendation-card-tp\$\{target\.index\}/);
    assert.match(card, /data-testid="recommendation-card-r"/);
    assert.match(card, /formatSignedR/);
    assert.match(card, /dir=\{model\.dir\}/);
    assert.match(card, /REC_CARD_LOGO_SRC/);
    assert.doesNotMatch(card, /LiquidMetal|metal-fx|platinum/i);
  });

  it("PnL share still renders ProfitCard with signed R", () => {
    const list = read("components/recommendations/TrackedPlanCard.tsx");
    const profit = read("components/recommendations/ProfitCard.tsx");
    const profitModal = read("components/recommendations/ShareProfitCardModal.tsx");
    assert.match(list, /ShareProfitButton/);
    assert.doesNotMatch(list, /ShareRecommendationButton/);
    assert.match(profit, /data-testid="profit-card"/);
    assert.match(profit, /formatSignedR/);
    assert.match(profit, /dir=["']ltr["']/);
    assert.match(profitModal, /<ProfitCard/);
    assert.doesNotMatch(profitModal, /<RecommendationCard/);
  });

  it("closed report surfaces keep a separate PnL result share", () => {
    const full = read("components/recommendations/RecommendationFullReport.tsx");
    const modal = read("components/agent/cards/RecommendationReport.tsx");
    const tracker = read("components/recommendations/RecommendationTrackerCard.tsx");
    for (const [name, src] of Object.entries({ full, modal, tracker })) {
      assert.match(src, /ShareProfitButton/, `${name} lost the PnL share`);
      assert.match(src, /variant=["']result["']/, `${name} is missing the result variant`);
      assert.match(src, /isRealizedOutcome/, `${name} should gate PnL share on a closed trade`);
    }
  });

  it("always shows the live React rec card and never swaps it for a captured PNG", () => {
    const modal = read("components/recommendations/ShareRecommendationCardModal.tsx");
    assert.match(modal, /data-testid="recommendation-card-live-preview"/);
    assert.match(modal, /<RecommendationCard/);
    assert.doesNotMatch(modal, /setPreviewUrl/);
    assert.doesNotMatch(modal, /previewUrl/);
    const live = modal.indexOf('data-testid="recommendation-card-live-preview"');
    const liveCard = modal.indexOf("<RecommendationCard", live);
    const capture = modal.indexOf('data-testid="recommendation-card-capture"');
    assert.ok(live >= 0 && liveCard > live && liveCard < capture, "visible slot must render RecommendationCard");
    const previewBranch = modal.slice(modal.indexOf("relative mx-auto"), capture);
    assert.doesNotMatch(previewBranch, /previewUrl \?/);
    assert.doesNotMatch(previewBranch, /<img\b/);
  });

  it("captures via html-to-image at the rec-card size and offers download plus Web Share", () => {
    const modal = read("components/recommendations/ShareRecommendationCardModal.tsx");
    const capture = read("lib/recommendations/recommendationCardCapture.ts");
    assert.match(capture, /captureHtmlToPngBlob/);
    assert.match(capture, /renderRecommendationCardFallbackPng/);
    assert.match(capture, /REC_CARD_CAPTURE_MIN_HEIGHT = REC_CARD_HEIGHT/);
    assert.match(modal, /captureRecommendationCardPng/);
    assert.match(modal, /navigator\.share/);
    assert.match(modal, /download/);
    assert.match(modal, /useSheetGesture/);
    assert.match(modal, /isUsablePngBlob/);
    const captureAt = modal.indexOf('data-testid="recommendation-card-capture"');
    assert.ok(captureAt > 0);
    const captureStyle = modal.slice(captureAt, modal.indexOf("document.body", captureAt));
    assert.match(captureStyle, /width:\s*REC_CARD_CAPTURE_WIDTH/);
    assert.match(captureStyle, /minHeight:\s*REC_CARD_CAPTURE_MIN_HEIGHT/);
    assert.match(captureStyle, /opacity:\s*1/);
    assert.match(captureStyle, /transform:\s*"translateX\(-100vw\)"/);
    assert.doesNotMatch(modal, /left:\s*-9999/);
    assert.doesNotMatch(modal, /opacity:\s*["']0["']/);
    assert.doesNotMatch(modal, /display:\s*["']none["']/);
  });

  it("does not revoke object URLs while the rec modal is open", () => {
    const modal = read("components/recommendations/ShareRecommendationCardModal.tsx");
    assert.match(modal, /revokeObjectURL/);
    assert.doesNotMatch(modal, /setTimeout\(\s*\(?\s*\)\s*=>\s*URL\.revokeObjectURL/);
    assert.match(modal, /if \(!open\) \{[\s\S]*revokeObjectURL/);
    const downloadFn = modal.slice(
      modal.indexOf("function downloadBlob"),
      modal.indexOf("export function ShareRecommendationCardModal"),
    );
    assert.doesNotMatch(downloadFn, /revokeObjectURL/);
  });
});
