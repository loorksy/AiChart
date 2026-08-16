import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const brand = resolve(process.cwd(), "public", "brand");

function pngHasAlphaChunk(buf: Buffer): boolean {
  // PNG signature + IHDR; look for tRNS or color type 6 (RGBA) in IHDR byte 25.
  if (buf.length < 33) return false;
  if (buf.toString("ascii", 1, 4) !== "PNG") return false;
  const colorType = buf[25];
  if (colorType === 4 || colorType === 6) return true;
  return buf.includes(Buffer.from("tRNS"));
}

describe("brand face-mark assets", () => {
  const required = [
    "aichart-mark.svg",
    "aichart-mark-light.svg",
    "aichart-mark-dark.png",
    "aichart-mark-light.png",
    "aichart-avatar-32.png",
    "aichart-avatar-64.png",
    "aichart-avatar-light-32.png",
    "aichart-avatar-light-64.png",
    "lonora-logo-loop.json",
    "InterDisplay-SemiBold.ttf",
    "Inter-OFL.txt",
      ];

  it("ships all production brand files", () => {
    for (const name of required) {
      const p = resolve(brand, name);
      assert.ok(existsSync(p), `missing ${name}`);
      assert.ok(statSync(p).size > 100, `${name} too small`);
    }
  });

  it("PNG marks include alpha (not opaque black/white squares)", () => {
    for (const name of [
      "aichart-mark-dark.png",
      "aichart-mark-light.png",
      "aichart-avatar-64.png",
      "aichart-avatar-light-64.png",
    ]) {
      const buf = readFileSync(resolve(brand, name));
      assert.ok(pngHasAlphaChunk(buf), `${name} must have alpha`);
    }
  });

  it("SVG marks use approved Desktop face-mark colors", () => {
    const dark = readFileSync(resolve(brand, "aichart-mark.svg"), "utf8");
    const light = readFileSync(resolve(brand, "aichart-mark-light.svg"), "utf8");
    assert.match(dark, /fill="#FFFFFF"/i);
    assert.match(light, /fill="#(?:0A0A0A|000000)"/i);
  });

  it("ships a seamless looping Lonora Lottie sting", () => {
    const raw = readFileSync(resolve(brand, "lonora-logo-loop.json"), "utf8");
    const lottie = JSON.parse(raw) as {
      ip: number;
      op: number;
      fr: number;
      nm: string;
      w: number;
      h: number;
      layers: Array<{
        ty?: number;
        nm: string;
        ks: { o: { k: Array<{ t: number; s: number[] }> | number } };
      }>;
    };
    assert.equal(lottie.ip, 0);
    assert.equal(lottie.op, 240);
    assert.equal(lottie.fr, 30);
    assert.equal(lottie.w, 1080);
    assert.equal(lottie.h, 1080);
    assert.match(lottie.nm, /Lonora/i);
    assert.ok(lottie.layers.length >= 3);
    assert.ok(lottie.layers.every((layer) => layer.ty !== 5));
    for (const layer of lottie.layers) {
      const opacity = layer.ks.o;
      if (typeof opacity.k === "number") continue;
      const first = opacity.k[0];
      const last = opacity.k[opacity.k.length - 1];
      assert.deepEqual(first.s, last.s, `${layer.nm} loop seam`);
      assert.equal(first.t, 0);
      assert.equal(last.t, lottie.op);
    }
  });
});
