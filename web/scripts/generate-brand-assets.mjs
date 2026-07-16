/**
 * Rasterize transparent brand SVGs to PNG avatars.
 * Run: node scripts/generate-brand-assets.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const brandDir = join(__dirname, "..", "public", "brand");
mkdirSync(brandDir, { recursive: true });

const darkSvg = readFileSync(join(brandDir, "aichart-mark.svg"));
const lightSvg = readFileSync(join(brandDir, "aichart-mark-light.svg"));

async function writePng(svgBuffer, outName, size) {
  const out = join(brandDir, outName);
  const buf = await sharp(svgBuffer, { density: 300 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  writeFileSync(out, buf);
  // Verify at least some transparent pixels exist (alpha < 255).
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0;
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) transparent++;
    else if (data[i] === 255) opaque++;
  }
  if (transparent < 10) {
    throw new Error(`${outName}: expected transparent pixels, got ${transparent}`);
  }
  if (opaque < 10) {
    throw new Error(`${outName}: expected opaque mark pixels, got ${opaque}`);
  }
  console.log(`wrote ${outName} ${info.width}x${info.height} transparent=${transparent} opaque=${opaque}`);
}

await writePng(darkSvg, "aichart-mark-dark.png", 256);
await writePng(lightSvg, "aichart-mark-light.png", 256);
await writePng(darkSvg, "aichart-avatar-32.png", 32);
await writePng(darkSvg, "aichart-avatar-64.png", 64);
await writePng(lightSvg, "aichart-avatar-light-32.png", 32);
await writePng(lightSvg, "aichart-avatar-light-64.png", 64);
console.log("brand assets ok");
