/**
 * Sync AiChart brand assets from operator Desktop logo folder and regenerate
 * favicons/PWA icons. Source default: C:\Users\ALALMIA\Desktop\logo
 *
 * Run: node scripts/sync-brand-from-desktop.mjs
 * Env: AICHART_LOGO_DIR overrides the Desktop logo folder path.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, "..");
const brandDir = join(webRoot, "public", "brand");
const publicDir = join(webRoot, "public");
const appDir = join(webRoot, "src", "app");

const DEFAULT_LOGO_DIR = "C:\\Users\\ALALMIA\\Desktop\\logo";
const logoDir = resolve(process.env.AICHART_LOGO_DIR || DEFAULT_LOGO_DIR);

/** Tight crop around the face mark in Desktop exports (3000×3000 canvas). */
const MARK_VIEWBOX = 'viewBox="0 350 3000 2250"';

function pickDesktopSvgs(dir) {
  if (!existsSync(dir)) {
    throw new Error(`Logo folder not found: ${dir}`);
  }
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".svg"));
  if (files.length < 2) {
    throw new Error(`Expected at least 2 SVG files in ${dir}, found ${files.length}`);
  }
  let whiteSrc = null;
  let blackSrc = null;
  for (const name of files) {
    const text = readFileSync(join(dir, name), "utf8");
    if (text.includes('fill="#ffffff"') || text.includes("fill='#ffffff'")) {
      whiteSrc = join(dir, name);
    } else if (text.includes('fill="#000000"') || text.includes("fill='#000000'")) {
      blackSrc = join(dir, name);
    }
  }
  if (!whiteSrc || !blackSrc) {
    throw new Error(`Could not detect white/black SVG pair in ${dir}`);
  }
  return { whiteSrc, blackSrc };
}

function normalizeSvg(srcPath, outPath, fillHint) {
  let svg = readFileSync(srcPath, "utf8");
  svg = svg.replace(/viewBox="[^"]+"/, MARK_VIEWBOX);
  if (!svg.includes(MARK_VIEWBOX.slice(0, 8))) {
    svg = svg.replace(/<svg([^>]*)>/, `<svg$1 ${MARK_VIEWBOX}>`);
  }
  writeFileSync(outPath, svg, "utf8");
  console.log(`wrote ${outPath.replace(webRoot + "\\", "").replace(webRoot + "/", "")} (${fillHint})`);
}

async function transparentPng(svgBuffer, size) {
  return sharp(svgBuffer, { density: 72, limitInputPixels: false })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function iconOnBg(svgBuffer, size, bg) {
  const markSize = Math.round(size * 0.72);
  const mark = await sharp(svgBuffer, { density: 72, limitInputPixels: false })
    .resize(markSize, markSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: bg },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toBuffer();
}

async function writeIcon(svgBuffer, outPath, size, bg) {
  const buf = await iconOnBg(svgBuffer, size, bg);
  writeFileSync(outPath, buf);
  console.log(`wrote ${outPath.replace(webRoot + "\\", "").replace(webRoot + "/", "")} (${size}px)`);
}

async function writeTransparent(svgBuffer, outPath, size) {
  const buf = await transparentPng(svgBuffer, size);
  writeFileSync(outPath, buf);
  console.log(`wrote ${outPath.replace(webRoot + "\\", "").replace(webRoot + "/", "")} (${size}px transparent)`);
}

mkdirSync(brandDir, { recursive: true });

const { whiteSrc, blackSrc } = pickDesktopSvgs(logoDir);
console.log(`source white: ${whiteSrc}`);
console.log(`source black: ${blackSrc}`);

const darkMarkPath = join(brandDir, "aichart-mark.svg");
const lightMarkPath = join(brandDir, "aichart-mark-light.svg");
normalizeSvg(whiteSrc, darkMarkPath, "white on dark UI");
normalizeSvg(blackSrc, lightMarkPath, "dark on light UI");

const darkSvg = readFileSync(darkMarkPath);
const lightSvg = readFileSync(lightMarkPath);

await writeTransparent(darkSvg, join(brandDir, "aichart-mark-dark.png"), 256);
await writeTransparent(lightSvg, join(brandDir, "aichart-mark-light.png"), 256);
await writeTransparent(darkSvg, join(brandDir, "aichart-avatar-32.png"), 32);
await writeTransparent(darkSvg, join(brandDir, "aichart-avatar-64.png"), 64);
await writeTransparent(lightSvg, join(brandDir, "aichart-avatar-light-32.png"), 32);
await writeTransparent(lightSvg, join(brandDir, "aichart-avatar-light-64.png"), 64);

const faviconBg = { r: 10, g: 10, b: 10, alpha: 1 };
const iconTargets = [
  [join(publicDir, "favicon-16x16.png"), 16],
  [join(publicDir, "favicon-32x32.png"), 32],
  [join(publicDir, "favicon-48x48.png"), 48],
  [join(publicDir, "apple-touch-icon.png"), 180],
  [join(publicDir, "icon-192.png"), 192],
  [join(publicDir, "icon-512.png"), 512],
  [join(appDir, "icon.png"), 32],
  [join(appDir, "apple-icon.png"), 180],
];

for (const [out, size] of iconTargets) {
  await writeIcon(darkSvg, out, size, faviconBg);
}

const fav32 = await iconOnBg(darkSvg, 32, faviconBg);
writeFileSync(join(publicDir, "favicon.ico"), fav32);
writeFileSync(join(appDir, "favicon.ico"), fav32);
console.log("wrote favicon.ico (32px PNG-in-ICO)");

console.log("brand sync ok from", logoDir);
