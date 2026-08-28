/**
 * The share control is wired into every recommendation surface the trader
 * actually sees: the list card, the tracker card, the full report, and the
 * chat report modal. A missing import here is a missing icon in production.
 *
 * The modal must keep the live React card on screen. Swapping it for the
 * html-to-image PNG is what turned the Arabic share sheet into a black void.
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
    assert.match(files.tracker, /displayROf/);
    assert.doesNotMatch(files.tracker, /netRr \?\? rec\.rr/);
    assert.match(files.full, /RecommendationTrackerCard/);
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

  it("paints the share image in English LTR with green profit and red loss", () => {
    const card = read("components/recommendations/ProfitCard.tsx");
    const model = read("lib/recommendations/profitCard.ts");
    const modal = read("components/recommendations/ShareProfitCardModal.tsx");
    const capture = read("lib/recommendations/profitCardCapture.ts");
    assert.match(card, /dir=["']ltr["']/);
    assert.doesNotMatch(card, /[\u0600-\u06FF]/);
    assert.doesNotMatch(model, /[\u0600-\u06FF]/);
    assert.match(model, /Profit Card/);
    assert.match(model, /Unrealized PnL/);
    assert.match(model, /Realized PnL/);
    assert.match(model, /Your Edge, Our Intelligence\./);
    assert.match(modal, /profitCardLabels/);
    assert.doesNotMatch(modal, /badge:\s*t\(/);
    assert.doesNotMatch(modal, /profit_card\.badge/);
    assert.match(card, /formatSignedR/);
    assert.doesNotMatch(card, /formatPnlPercent/);
    assert.match(capture, /formatSignedR/);
    assert.doesNotMatch(capture, /formatPnlPercent/);
    assert.match(card, /pnlAccentColor/);
    assert.match(card, /data-pnl-tone/);
    assert.match(model, /#20d68a/);
    assert.match(model, /#f2555d/);
    assert.match(capture, /pnlAccentColor/);
    assert.doesNotMatch(capture, /pctColor = gain \? "#f0d078"/);
  });

  it("captures at the compact card size, not a 580px canvas", () => {
    const card = read("components/recommendations/ProfitCard.tsx");
    const model = read("lib/recommendations/profitCard.ts");
    const capture = read("lib/recommendations/profitCardCapture.ts");
    assert.match(model, /PROFIT_CARD_HEIGHT = 400/);
    assert.match(capture, /PROFIT_CARD_CAPTURE_MIN_HEIGHT = PROFIT_CARD_HEIGHT/);
    assert.doesNotMatch(card, /\b580\b/);
    assert.doesNotMatch(capture, /CAPTURE_MIN_HEIGHT = 580/);
    assert.doesNotMatch(model, /PROFIT_CARD_HEIGHT = 580/);
  });

  it("captures via html-to-image and offers download plus Web Share", () => {
    const modal = read("components/recommendations/ShareProfitCardModal.tsx");
    const capture = read("lib/recommendations/profitCardCapture.ts");
    assert.match(capture, /html-to-image/);
    assert.match(capture, /toBlob/);
    assert.match(capture, /toPng/);
    assert.match(capture, /pixelRatio:\s*2/);
    assert.match(capture, /skipFonts:\s*true/);
    assert.match(capture, /renderProfitCardFallbackPng/);
    assert.match(modal, /captureProfitCardPng/);
    assert.match(modal, /navigator\.share/);
    assert.match(modal, /download/);
    assert.match(modal, /useSheetGesture/);
  });

  it("always shows the live React card and never swaps it for a captured PNG", () => {
    const modal = read("components/recommendations/ShareProfitCardModal.tsx");
    assert.match(modal, /data-testid="profit-card-live-preview"/);
    assert.match(modal, /<ProfitCard/);
    assert.doesNotMatch(modal, /profit-card-preview-image/);
    assert.doesNotMatch(modal, /setPreviewUrl/);
    assert.doesNotMatch(modal, /previewUrl/);
    assert.doesNotMatch(modal, /profit-card-skeleton/);
    const live = modal.indexOf('data-testid="profit-card-live-preview"');
    const liveCard = modal.indexOf("<ProfitCard", live);
    const capture = modal.indexOf('data-testid="profit-card-capture"');
    assert.ok(live >= 0 && liveCard > live && liveCard < capture, "visible slot must render ProfitCard");
    const previewBranch = modal.slice(modal.indexOf("relative mx-auto"), capture);
    assert.doesNotMatch(previewBranch, /previewUrl \?/);
    assert.doesNotMatch(previewBranch, /<img\b/);
  });

  it("does not revoke object URLs while the modal is open", () => {
    const modal = read("components/recommendations/ShareProfitCardModal.tsx");
    assert.match(modal, /revokeObjectURL/);
    assert.doesNotMatch(modal, /setTimeout\(\s*\(?\s*\)\s*=>\s*URL\.revokeObjectURL/);
    assert.match(modal, /if \(!open\) \{[\s\S]*revokeObjectURL/);
    const downloadFn = modal.slice(
      modal.indexOf("function downloadBlob"),
      modal.indexOf("export function ShareProfitCardModal"),
    );
    assert.doesNotMatch(downloadFn, /revokeObjectURL/);
  });

  it("refuses an empty or black blob as the download and falls back to a painted card", () => {
    const modal = read("components/recommendations/ShareProfitCardModal.tsx");
    const capture = read("lib/recommendations/profitCardCapture.ts");
    assert.match(modal, /isUsablePngBlob/);
    assert.match(modal, /waitForBlob/);
    assert.match(capture, /isUsablePngBlob/);
    assert.match(capture, /countPaintedRgba/);
    assert.match(capture, /renderProfitCardFallbackPng/);
    assert.match(capture, /document\.fonts/);
    assert.match(capture, /embedLogoDataUrls/);
    assert.match(capture, /loadProfitCardLogoDataUrl/);
    assert.doesNotMatch(modal, /left:\s*-9999/);
    assert.doesNotMatch(modal, /opacity:\s*["']0["']/);
    assert.doesNotMatch(modal, /display:\s*["']none["']/);
    const captureAt = modal.indexOf('data-testid="profit-card-capture"');
    assert.ok(captureAt > 0);
    const captureStyle = modal.slice(captureAt, modal.indexOf("document.body", captureAt));
    assert.match(captureStyle, /width:\s*PROFIT_CARD_CAPTURE_WIDTH/);
    assert.match(captureStyle, /minHeight:\s*PROFIT_CARD_CAPTURE_MIN_HEIGHT/);
    assert.match(captureStyle, /opacity:\s*1/);
    assert.match(captureStyle, /transform:\s*"translateX\(-100vw\)"/);
  });
});
