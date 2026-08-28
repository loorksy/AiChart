/**
 * Capture pipeline for the profit-card PNG: live preview is never swapped,
 * blank/black html-to-image blobs are rejected, and download always has a
 * painted fallback.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_CAPTURE_BYTES,
  MIN_PAINTED_PIXELS,
  MIN_UNINSPECTED_CAPTURE_BYTES,
  blobPassesSizeGate,
  captureHtmlToPngBlob,
  countPaintedRgba,
  isUsablePngBlob,
  nodeHasCaptureBox,
} from "@/lib/recommendations/profitCardCapture";

function rgba(pixels: Array<[number, number, number, number?]>): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((pixel, i) => {
    data[i * 4] = pixel[0];
    data[i * 4 + 1] = pixel[1];
    data[i * 4 + 2] = pixel[2];
    data[i * 4 + 3] = pixel[3] ?? 255;
  });
  return data;
}

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

describe("countPaintedRgba", () => {
  it("treats the capture background fill as empty", () => {
    const data = rgba(Array.from({ length: 64 }, () => [12, 10, 7, 255]));
    assert.equal(countPaintedRgba(data), 0);
  });

  it("counts gold PnL pixels as painted", () => {
    const data = rgba([
      [12, 10, 7],
      [240, 208, 120],
      [243, 230, 196],
      [0, 0, 0, 0],
    ]);
    assert.equal(countPaintedRgba(data), 2);
  });
});

describe("isUsablePngBlob", () => {
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

  it("accepts a blob whose sampled pixels include gold/cream paint", async () => {
    const painted = new Blob([new Uint8Array(3_000)], { type: "image/png" });
    assert.equal(await isUsablePngBlob(painted, async () => 80), true);
  });
});

describe("nodeHasCaptureBox", () => {
  it("rejects a left:-9999 node with a zero client rect", () => {
    assert.equal(nodeHasCaptureBox(box()), false);
    assert.equal(nodeHasCaptureBox(box({ width: 0, height: 0, clientWidth: 0, clientHeight: 0 })), false);
  });

  it("accepts a 360×580 box even when translated off-screen", () => {
    assert.equal(
      nodeHasCaptureBox(
        box({
          clientWidth: 360,
          clientHeight: 580,
          offsetWidth: 360,
          offsetHeight: 580,
          scrollWidth: 360,
          scrollHeight: 580,
          width: 360,
          height: 580,
        }),
      ),
      true,
    );
  });
});

describe("captureHtmlToPngBlob", () => {
  it("does not call html-to-image when the node has no painted box", async () => {
    const blob = await captureHtmlToPngBlob(box());
    assert.equal(blob, null);
  });
});
