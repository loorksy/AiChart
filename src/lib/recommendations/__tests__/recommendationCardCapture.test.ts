/**
 * Capture pipeline for the recommendation-card PNG: live preview is never
 * swapped, blank/black html-to-image blobs are rejected, and download always
 * has a painted fallback. Reuses the profit-card empty/black gates.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_CAPTURE_BYTES,
  MIN_PAINTED_PIXELS,
  MIN_UNINSPECTED_CAPTURE_BYTES,
  blobPassesSizeGate,
  captureHtmlToPngBlob,
  isUsablePngBlob,
} from "@/lib/recommendations/profitCardCapture";
import {
  REC_CARD_CAPTURE_BG,
  REC_CARD_CAPTURE_MIN_HEIGHT,
  REC_CARD_CAPTURE_WIDTH,
} from "@/lib/recommendations/recommendationCardCapture";

function box(
  over: Partial<{
    clientWidth: number;
    offsetWidth: number;
    scrollWidth: number;
    clientHeight: number;
    offsetHeight: number;
    scrollHeight: number;
    width: number;
    height: number;
  }> = {},
): HTMLElement {
  const width = over.width ?? 0;
  const height = over.height ?? 0;
  return {
    clientWidth: over.clientWidth ?? 0,
    offsetWidth: over.offsetWidth ?? 0,
    scrollWidth: over.scrollWidth ?? 0,
    clientHeight: over.clientHeight ?? 0,
    offsetHeight: over.offsetHeight ?? 0,
    scrollHeight: over.scrollHeight ?? 0,
    getBoundingClientRect: () => ({
      width,
      height,
      top: 0,
      left: over.width ? -400 : 0,
      bottom: height,
      right: width,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  } as HTMLElement;
}

describe("rec card capture size", () => {
  it("is pinned at 360×520, not the 360×400 profit canvas", () => {
    assert.equal(REC_CARD_CAPTURE_WIDTH, 360);
    assert.equal(REC_CARD_CAPTURE_MIN_HEIGHT, 520);
    assert.notEqual(REC_CARD_CAPTURE_MIN_HEIGHT, 400);
    assert.notEqual(REC_CARD_CAPTURE_MIN_HEIGHT, 580);
    assert.equal(REC_CARD_CAPTURE_BG, "#101114");
  });
});

describe("rec card empty/black still rejected", () => {
  it("rejects missing, empty, and undersized blobs", async () => {
    assert.equal(await isUsablePngBlob(null), false);
    assert.equal(await isUsablePngBlob(undefined), false);
    assert.equal(await isUsablePngBlob(new Blob([], { type: "image/png" })), false);
    assert.equal(
      await isUsablePngBlob(new Blob([new Uint8Array(400)], { type: "image/png" })),
      false,
    );
    assert.equal(blobPassesSizeGate(new Blob([new Uint8Array(MIN_CAPTURE_BYTES - 1)])), false);
  });

  it("rejects a black html-to-image rectangle even when it is a few KB", async () => {
    const black = new Blob([new Uint8Array(4_000)], { type: "image/png" });
    assert.equal(await isUsablePngBlob(black, async () => 0), false);
    assert.ok(0 < MIN_PAINTED_PIXELS);
  });

  it("does not offer an uninspected blob that is too small to be a painted card", async () => {
    const maybeBlank = new Blob([new Uint8Array(MIN_UNINSPECTED_CAPTURE_BYTES - 1)], {
      type: "image/png",
    });
    assert.equal(await isUsablePngBlob(maybeBlank, async () => null), false);
  });
});

describe("captureHtmlToPngBlob for rec card box", () => {
  it("does not call html-to-image when the node has no painted box", async () => {
    const blob = await captureHtmlToPngBlob(box(), {
      width: REC_CARD_CAPTURE_WIDTH,
      minHeight: REC_CARD_CAPTURE_MIN_HEIGHT,
      backgroundColor: REC_CARD_CAPTURE_BG,
    });
    assert.equal(blob, null);
  });
});
