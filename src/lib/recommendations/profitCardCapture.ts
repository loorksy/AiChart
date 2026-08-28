/**
 * PNG capture for the Lonora profit card.
 *
 * html-to-image paints via SVG foreignObject. On Mobile Safari / Chrome that
 * often yields a solid-background blob (the card "flashes then goes black")
 * when the node has no box, the logo taints the canvas, or web-font embed
 * fails. The modal always shows the live React card; this module only builds
 * the file for download / Web Share, and never returns an empty or black PNG.
 */
import { BRAND_DOMAIN, BRAND_NAME } from "@/lib/brand";
import {
  PROFIT_CARD_LOGO_SRC,
  formatCardDate,
  formatCardPrice,
  formatPnlPercent,
  type ProfitCardLabels,
  type ProfitCardModel,
} from "@/lib/recommendations/profitCard";

export const PROFIT_CARD_CAPTURE_BG = "#0c0a07";
export const PROFIT_CARD_CAPTURE_WIDTH = 360;
export const PROFIT_CARD_CAPTURE_MIN_HEIGHT = 580;
/** A 720×1160 solid fill compresses to a few KB; a painted card does not. */
export const MIN_CAPTURE_BYTES = 2_000;
/** When we cannot sample pixels, demand a blob too large to be a blank fill. */
export const MIN_UNINSPECTED_CAPTURE_BYTES = 12_000;
export const MIN_PAINTED_PIXELS = 24;

const BG = { r: 12, g: 10, b: 7 };

export type CaptureInspect = (blob: Blob) => Promise<number | null>;

export function countPaintedRgba(
  data: ArrayLike<number>,
  bg: { r: number; g: number; b: number } = BG,
): number {
  let painted = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < 12) continue;
    const dr = data[i]! - bg.r;
    const dg = data[i + 1]! - bg.g;
    const db = data[i + 2]! - bg.b;
    if (dr * dr + dg * dg + db * db > 140) painted += 1;
  }
  return painted;
}

export function blobPassesSizeGate(blob: Blob | null | undefined): blob is Blob {
  if (!blob || blob.size < MIN_CAPTURE_BYTES) return false;
  if (blob.type && blob.type !== "image/png" && blob.type !== "application/octet-stream") {
    return false;
  }
  return true;
}

export async function inspectCapturePixels(blob: Blob): Promise<number | null> {
  if (typeof createImageBitmap !== "function") return null;
  if (typeof document === "undefined") return null;
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      if (bitmap.width < 32 || bitmap.height < 32) return 0;
      const w = Math.min(64, bitmap.width);
      const h = Math.min(64, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      return countPaintedRgba(ctx.getImageData(0, 0, w, h).data);
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

/**
 * Reject empty blobs and the solid `#0c0a07` rectangle html-to-image emits
 * when foreignObject rendering paints nothing.
 */
export async function isUsablePngBlob(
  blob: Blob | null | undefined,
  inspect: CaptureInspect = inspectCapturePixels,
): Promise<boolean> {
  if (!blobPassesSizeGate(blob)) return false;
  const painted = await inspect(blob);
  if (painted === null) return blob.size >= MIN_UNINSPECTED_CAPTURE_BYTES;
  return painted >= MIN_PAINTED_PIXELS;
}

export function nodeHasCaptureBox(node: HTMLElement, minW = 200, minH = 200): boolean {
  const w = Math.max(node.clientWidth, node.offsetWidth, node.scrollWidth);
  const h = Math.max(node.clientHeight, node.offsetHeight, node.scrollHeight);
  const rect = node.getBoundingClientRect();
  return (w >= minW && h >= minH) || (Math.abs(rect.width) >= minW && Math.abs(rect.height) >= minH);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrames(count: number): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(count);
  });
}

let logoDataUrlPromise: Promise<string | null> | null = null;

export function loadProfitCardLogoDataUrl(): Promise<string | null> {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = (async () => {
      try {
        const res = await fetch(PROFIT_CARD_LOGO_SRC, { cache: "force-cache" });
        if (!res.ok) return null;
        const blob = await res.blob();
        if (blob.size < 80) return null;
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    })();
  }
  return logoDataUrlPromise;
}

export async function embedLogoDataUrls(node: HTMLElement): Promise<void> {
  const dataUrl = await loadProfitCardLogoDataUrl();
  if (!dataUrl) return;
  for (const img of node.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? img.src;
    if (src.includes("aichart-mark") || src.endsWith(PROFIT_CARD_LOGO_SRC)) {
      img.setAttribute("src", dataUrl);
      img.src = dataUrl;
    }
  }
}

export async function waitForCaptureReady(node: HTMLElement): Promise<void> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (fonts?.ready) {
    await Promise.race([fonts.ready.catch(() => undefined), sleep(1_500)]);
  }
  await Promise.all(
    [...node.querySelectorAll("img")].map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return Promise.race([
        img.decode().then(
          () => undefined,
          () => undefined,
        ),
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
        sleep(1_500),
      ]);
    }),
  );
  await nextFrames(2);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const head = comma >= 0 ? dataUrl.slice(0, comma) : "data:image/png;base64";
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/png";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function captureOptions(node: HTMLElement) {
  const height = Math.max(
    node.scrollHeight,
    node.offsetHeight,
    node.clientHeight,
    PROFIT_CARD_CAPTURE_MIN_HEIGHT,
  );
  return {
    pixelRatio: 2,
    cacheBust: false,
    skipFonts: true,
    backgroundColor: PROFIT_CARD_CAPTURE_BG,
    width: PROFIT_CARD_CAPTURE_WIDTH,
    height,
    style: {
      opacity: "1",
      transform: "none",
      filter: "none",
      position: "static",
      left: "0px",
      top: "0px",
    } as Partial<CSSStyleDeclaration>,
  };
}

export async function captureHtmlToPngBlob(node: HTMLElement): Promise<Blob | null> {
  if (!nodeHasCaptureBox(node)) return null;
  const { toBlob, toPng } = await import("html-to-image");
  const opts = captureOptions(node);
  try {
    const blob = await toBlob(node, opts);
    if (await isUsablePngBlob(blob)) return blob;
  } catch {
    /* Mobile Safari often throws or returns a blank foreignObject paint. */
  }
  try {
    const dataUrl = await toPng(node, opts);
    const blob = dataUrlToBlob(dataUrl);
    if (await isUsablePngBlob(blob)) return blob;
  } catch {
    return null;
  }
  return null;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      try {
        resolve(dataUrlToBlob(canvas.toDataURL("image/png")));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("fallback canvas empty"));
      }
    }, "image/png");
  });
}

function loadHtmlImage(src: string): Promise<HTMLImageElement | null> {
  if (typeof Image === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Draw the card from the model when html-to-image yields a black/empty PNG.
 * Uses the live document's fonts, so it does not depend on SVG foreignObject.
 */
export async function renderProfitCardFallbackPng(
  model: ProfitCardModel,
  labels: ProfitCardLabels,
  displayName?: string | null,
): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error("profit-card fallback needs a document");
  }
  const W = PROFIT_CARD_CAPTURE_WIDTH;
  const H = PROFIT_CARD_CAPTURE_MIN_HEIGHT;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("profit-card fallback has no canvas");
  ctx.scale(scale, scale);

  const rtl = model.dir === "rtl";
  const pad = 22;
  const startX = rtl ? W - pad : pad;
  const endX = rtl ? pad : W - pad;
  const gain = !model.isLoss;
  const pctColor = gain ? "#f0d078" : "#f07167";
  const body = "#f3e6c4";
  const muted = "#b5a178";
  const gold = "#e8c04a";

  const bg = ctx.createLinearGradient(0, 0, W * 0.2, H);
  bg.addColorStop(0, "#14100b");
  bg.addColorStop(0.48, PROFIT_CARD_CAPTURE_BG);
  bg.addColorStop(1, "#120e09");
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 28);
  ctx.fill();

  const wash = ctx.createRadialGradient(W * 0.8, 0, 8, W * 0.8, 0, W);
  wash.addColorStop(0, "rgba(212, 175, 55, 0.22)");
  wash.addColorStop(0.55, "rgba(212, 175, 55, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(212, 175, 55, 0.28)";
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 28);
  ctx.stroke();

  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = rtl ? "right" : "left";
  ctx.textBaseline = "alphabetic";

  const logoSrc = (await loadProfitCardLogoDataUrl()) ?? PROFIT_CARD_LOGO_SRC;
  const logo = await loadHtmlImage(logoSrc);
  if (logo) {
    const lx = rtl ? W - pad - 36 : pad;
    ctx.drawImage(logo, lx, 22, 36, 36);
  }

  ctx.fillStyle = "#f8e7a8";
  ctx.font = '600 20px Fraunces, Georgia, serif';
  const nameX = rtl ? startX - 46 : startX + 46;
  ctx.fillText(BRAND_NAME, nameX, 46);

  ctx.font = "700 11px Cairo, 'Segoe UI', sans-serif";
  const badgeW = Math.min(140, ctx.measureText(labels.badge).width + 20);
  const badgeX = rtl ? pad : W - pad - badgeW;
  ctx.strokeStyle = "rgba(212, 175, 55, 0.45)";
  ctx.fillStyle = "rgba(212, 175, 55, 0.12)";
  roundRect(ctx, badgeX, 26, badgeW, 24, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = gold;
  ctx.textAlign = "center";
  ctx.fillText(labels.badge, badgeX + badgeW / 2, 42);
  ctx.textAlign = rtl ? "right" : "left";

  ctx.fillStyle = muted;
  ctx.font = "600 13px Cairo, 'Segoe UI', sans-serif";
  ctx.fillText(labels.pnlKind, startX, 96);

  ctx.fillStyle = body;
  ctx.font = "700 18px ui-monospace, 'JetBrains Mono', monospace";
  ctx.direction = "ltr";
  ctx.textAlign = rtl ? "right" : "left";
  ctx.fillText(model.symbol, startX, 124);
  const symbolW = ctx.measureText(model.symbol).width;
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.fillStyle = gain ? gold : "#f07167";
  ctx.font = "700 14px Cairo, 'Segoe UI', sans-serif";
  const sideX = rtl ? startX - symbolW - 10 : startX + symbolW + 10;
  ctx.fillText(labels.side, sideX, 124);

  ctx.fillStyle = pctColor;
  ctx.font = "800 52px ui-monospace, 'JetBrains Mono', monospace";
  ctx.direction = "ltr";
  ctx.shadowColor = gain ? "rgba(240, 208, 120, 0.45)" : "rgba(240, 113, 103, 0.4)";
  ctx.shadowBlur = 18;
  ctx.fillText(formatPnlPercent(model.pnlPct), startX, 196);
  ctx.shadowBlur = 0;

  const rows: Array<[string, string]> = [
    [labels.mark, model.markPrice != null ? formatCardPrice(model.markPrice) : "—"],
    [labels.entry, formatCardPrice(model.entry)],
    [labels.date, formatCardDate(model.dateMs)],
  ];
  ctx.strokeStyle = "rgba(212, 175, 55, 0.22)";
  ctx.beginPath();
  ctx.moveTo(pad, 236);
  ctx.lineTo(W - pad, 236);
  ctx.stroke();
  let y = 262;
  for (const [label, value] of rows) {
    ctx.fillStyle = muted;
    ctx.font = "12px Cairo, 'Segoe UI', sans-serif";
    ctx.direction = rtl ? "rtl" : "ltr";
    ctx.textAlign = rtl ? "right" : "left";
    ctx.fillText(label, startX, y);
    ctx.fillStyle = body;
    ctx.font = "700 14px ui-monospace, 'JetBrains Mono', monospace";
    ctx.direction = "ltr";
    ctx.textAlign = rtl ? "left" : "right";
    ctx.fillText(value, endX, y);
    y += 28;
  }
  ctx.strokeStyle = "rgba(212, 175, 55, 0.22)";
  ctx.beginPath();
  ctx.moveTo(pad, y - 10);
  ctx.lineTo(W - pad, y - 10);
  ctx.stroke();

  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = rtl ? "right" : "left";
  let footY = H - 72;
  if (displayName) {
    ctx.fillStyle = "#f8e7a8";
    ctx.font = "700 14px Cairo, 'Segoe UI', sans-serif";
    ctx.fillText(displayName, startX, footY);
    footY += 20;
  }
  ctx.fillStyle = muted;
  ctx.font = "12px Cairo, 'Segoe UI', sans-serif";
  ctx.fillText(labels.tagline, startX, footY);
  ctx.fillStyle = "#c9a227";
  ctx.font = "11px ui-monospace, 'JetBrains Mono', monospace";
  ctx.direction = "ltr";
  ctx.fillText(BRAND_DOMAIN, startX, footY + 18);

  const blob = await canvasToPngBlob(canvas);
  if (!(await isUsablePngBlob(blob))) {
    throw new Error("profit-card fallback produced an empty PNG");
  }
  return blob;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x + w, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export async function captureProfitCardPng(input: {
  offscreen: HTMLElement | null;
  visible: HTMLElement | null;
  model: ProfitCardModel;
  labels: ProfitCardLabels;
  displayName?: string | null;
}): Promise<Blob> {
  const tryNode = async (node: HTMLElement | null): Promise<Blob | null> => {
    if (!node) return null;
    await embedLogoDataUrls(node);
    await waitForCaptureReady(node);
    return captureHtmlToPngBlob(node);
  };
  const fromOffscreen = await tryNode(input.offscreen);
  if (fromOffscreen) return fromOffscreen;
  const fromVisible = await tryNode(input.visible);
  if (fromVisible) return fromVisible;
  return renderProfitCardFallbackPng(input.model, input.labels, input.displayName);
}
