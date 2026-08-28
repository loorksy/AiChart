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
  PROFIT_CARD_BG,
  PROFIT_CARD_HEIGHT,
  PROFIT_CARD_LOGO_SRC,
  PROFIT_CARD_WIDTH,
  formatCardDate,
  formatCardPrice,
  formatSignedR,
  pnlAccentColor,
  pnlAccentGlow,
  type ProfitCardLabels,
  type ProfitCardModel,
} from "@/lib/recommendations/profitCard";

export const PROFIT_CARD_CAPTURE_BG = PROFIT_CARD_BG;
export const PROFIT_CARD_CAPTURE_WIDTH = PROFIT_CARD_WIDTH;
export const PROFIT_CARD_CAPTURE_MIN_HEIGHT = PROFIT_CARD_HEIGHT;
/** A 720×800 solid fill compresses to a few KB; a painted card does not. */
export const MIN_CAPTURE_BYTES = 2_000;
/** When we cannot sample pixels, demand a blob too large to be a blank fill. */
export const MIN_UNINSPECTED_CAPTURE_BYTES = 12_000;
export const MIN_PAINTED_PIXELS = 24;

const BG = { r: 14, g: 16, b: 19 };

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
 * Reject empty blobs and the solid `#0e1013` rectangle html-to-image emits
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

export type HtmlCaptureSize = {
  width: number;
  minHeight: number;
  backgroundColor?: string;
};

function captureOptions(node: HTMLElement, size?: HtmlCaptureSize) {
  const width = size?.width ?? PROFIT_CARD_CAPTURE_WIDTH;
  const minHeight = size?.minHeight ?? PROFIT_CARD_CAPTURE_MIN_HEIGHT;
  const backgroundColor = size?.backgroundColor ?? PROFIT_CARD_CAPTURE_BG;
  const height = Math.max(
    node.scrollHeight,
    node.offsetHeight,
    node.clientHeight,
    minHeight,
  );
  return {
    pixelRatio: 2,
    cacheBust: false,
    skipFonts: true,
    backgroundColor,
    width,
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

export async function captureHtmlToPngBlob(
  node: HTMLElement,
  size?: HtmlCaptureSize,
): Promise<Blob | null> {
  if (!nodeHasCaptureBox(node)) return null;
  const { toBlob, toPng } = await import("html-to-image");
  const opts = captureOptions(node, size);
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
 * Always LTR English — the share image does not follow app locale.
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

  const pad = 16;
  const startX = pad;
  const endX = W - pad;
  const pctColor = pnlAccentColor(model.isLoss);
  const body = "#f4f1ea";
  const muted = "#9a9386";
  const gold = "#e8c04a";
  const sans = "Inter, 'Segoe UI', sans-serif";
  const mono = "ui-monospace, 'JetBrains Mono', monospace";

  const bg = ctx.createLinearGradient(0, 0, W * 0.15, H);
  bg.addColorStop(0, "#16181c");
  bg.addColorStop(0.46, PROFIT_CARD_CAPTURE_BG);
  bg.addColorStop(1, "#0b0c0e");
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 26);
  ctx.fill();

  const wash = ctx.createRadialGradient(W * 0.88, 0, 8, W * 0.88, 0, W * 0.7);
  wash.addColorStop(0, "rgba(212, 175, 55, 0.18)");
  wash.addColorStop(0.5, "rgba(212, 175, 55, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(212, 175, 55, 0.28)";
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 26);
  ctx.stroke();

  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const logoSrc = (await loadProfitCardLogoDataUrl()) ?? PROFIT_CARD_LOGO_SRC;
  const logo = await loadHtmlImage(logoSrc);
  if (logo) {
    ctx.drawImage(logo, pad, 16, 28, 28);
  }

  ctx.fillStyle = "#f8f5ef";
  ctx.font = `600 17px ${sans}`;
  ctx.fillText(BRAND_NAME, startX + 36, 36);

  ctx.font = `700 10px ${sans}`;
  const badgeW = Math.min(130, ctx.measureText(labels.badge).width + 22);
  const badgeX = W - pad - badgeW;
  ctx.strokeStyle = "rgba(212, 175, 55, 0.45)";
  ctx.fillStyle = "rgba(212, 175, 55, 0.10)";
  roundRect(ctx, badgeX, 18, badgeW, 22, 11);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f0e2b0";
  ctx.textAlign = "center";
  ctx.fillText(labels.badge.toUpperCase(), badgeX + badgeW / 2, 33);
  ctx.textAlign = "left";

  ctx.fillStyle = muted;
  ctx.font = `600 11px ${sans}`;
  ctx.fillText(labels.pnlKind.toUpperCase(), startX, 68);

  ctx.fillStyle = body;
  ctx.font = `700 16px ${mono}`;
  ctx.fillText(model.symbol, startX, 90);
  const symbolW = ctx.measureText(model.symbol).width;

  ctx.font = `700 11px ${sans}`;
  const sideW = ctx.measureText(labels.side).width + 16;
  const sideX = startX + symbolW + 10;
  ctx.strokeStyle = "rgba(212, 175, 55, 0.4)";
  ctx.fillStyle = "rgba(212, 175, 55, 0.12)";
  roundRect(ctx, sideX, 76, sideW, 18, 9);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = gold;
  ctx.textAlign = "center";
  ctx.fillText(labels.side, sideX + sideW / 2, 89);
  ctx.textAlign = "left";

  ctx.fillStyle = pctColor;
  ctx.font = `800 42px ${mono}`;
  ctx.shadowColor = pnlAccentGlow(model.isLoss);
  ctx.shadowBlur = 16;
  ctx.fillText(formatSignedR(model.rMultiple) ?? "—", startX, 142);
  ctx.shadowBlur = 0;

  const rows: Array<[string, string]> = [
    [labels.mark, model.markPrice != null ? formatCardPrice(model.markPrice) : "—"],
    [labels.entry, formatCardPrice(model.entry)],
    [labels.date, formatCardDate(model.dateMs)],
  ];
  const boxY = 162;
  const boxH = 92;
  ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
  ctx.strokeStyle = "rgba(212, 175, 55, 0.14)";
  roundRect(ctx, pad, boxY, W - pad * 2, boxH, 14);
  ctx.fill();
  ctx.stroke();

  let y = boxY + 24;
  rows.forEach(([label, value], i) => {
    if (i > 0) {
      ctx.strokeStyle = "rgba(212, 175, 55, 0.10)";
      ctx.beginPath();
      ctx.moveTo(pad + 12, y - 14);
      ctx.lineTo(W - pad - 12, y - 14);
      ctx.stroke();
    }
    ctx.fillStyle = muted;
    ctx.font = `11px ${sans}`;
    ctx.textAlign = "left";
    ctx.fillText(label, startX + 12, y);
    ctx.fillStyle = body;
    ctx.font = `700 13px ${mono}`;
    ctx.textAlign = "right";
    ctx.fillText(value, endX - 12, y);
    y += 28;
  });
  ctx.textAlign = "left";

  let footY = displayName ? H - 70 : H - 54;
  if (displayName) {
    ctx.fillStyle = "#f0d078";
    ctx.font = `700 13px ${sans}`;
    ctx.fillText(displayName, startX, footY);
    footY += 16;
  }
  ctx.fillStyle = muted;
  ctx.font = `11px ${sans}`;
  ctx.fillText(labels.tagline, startX, footY);
  ctx.fillStyle = "#c9a227";
  ctx.font = `10px ${mono}`;
  ctx.fillText(BRAND_DOMAIN, startX, footY + 16);

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
