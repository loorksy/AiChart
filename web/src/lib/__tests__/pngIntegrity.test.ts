import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCompletePng } from "../pngIntegrity";

/** A real, complete 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("isCompletePng", () => {
  it("accepts a complete PNG", () => {
    assert.equal(isCompletePng(PNG), true);
  });

  it("rejects a PNG cut short of its IEND chunk", () => {
    // The failure mode this guard exists for: an EA capture read while the
    // upload handler was still writing. Header intact, image dead.
    const partial = PNG.subarray(0, PNG.length - 1);
    assert.equal(isCompletePng(partial), false);
    assert.equal(
      partial[0],
      0x89,
      "the signature survives truncation — which is why sniffing byte 0 failed",
    );
  });

  it("rejects a header-only fragment", () => {
    assert.equal(isCompletePng(PNG.subarray(0, 8)), false);
  });

  it("rejects empty and non-PNG buffers", () => {
    assert.equal(isCompletePng(Buffer.alloc(0)), false);
    assert.equal(isCompletePng(Buffer.alloc(200)), false);
    assert.equal(isCompletePng(null), false);
    assert.equal(isCompletePng(undefined), false);
  });

  it("rejects a JPEG masquerading via the upload form", () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(120),
      Buffer.from([0xff, 0xd9]),
    ]);
    assert.equal(isCompletePng(jpeg), false);
  });
});
