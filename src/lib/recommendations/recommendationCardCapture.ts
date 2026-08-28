/**
 * PNG capture for the Lonora recommendation card.
 *
 * Same rules as the profit-card pipeline: the modal always shows the live
 * React card; this module only builds the file for download / Web Share, and
 * never returns an empty or black PNG.
 */
import { BRAND_NAME } from "@/lib/brand";
import {
  captureHtmlToPngBlob,
  embedLogoDataUrls,
  isUsablePngBlob,
  loadProfitCardLogoDataUrl,
  waitForCaptureReady,
} from "./profitCardCapture";
import {
  REC_CARD_BG,
  REC_CARD_GAIN_COLOR,
  REC_CARD_HEIGHT,
  REC_CARD_LOGO_SRC,
  REC_CARD_LOSS_COLOR,
  REC_CARD_WIDTH,
  formatCardPrice,
  formatRecCardDate,
  formatSignedR,
  recCardHeroFill,
  recCardSideColor,
  type RecommendationCardLabels,
  type RecommendationCardModel,
} from "./recommendationCard";

export const REC_CARD_CAPTURE_BG = REC_CARD_BG;
export const REC_CARD_CAPTURE_WIDTH = REC_CARD_WIDTH;
export const REC_CARD_CAPTURE_MIN_HEIGHT = REC_CARD_HEIGHT;

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
        reject(err instanceof Error ? err : new Error("rec-card fallback canvas empty"));
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

/**
 * Draw the rec card from the model when html-to-image yields a black/empty PNG.
 * Follows app locale (RTL Arabic or LTR English).
 */
export async function renderRecommendationCardFallbackPng(
  model: RecommendationCardModel,
  labels: RecommendationCardLabels,
): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error("rec-card fallback needs a document");
  }
  const W = REC_CARD_CAPTURE_WIDTH;
  const H = REC_CARD_CAPTURE_MIN_HEIGHT;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("rec-card fallback has no canvas");
  ctx.scale(scale, scale);

  const rtl = model.dir === "rtl";
  const pad = 14;
  const start = rtl ? W - pad : pad;
  const end = rtl ? pad : W - pad;
  const toward = rtl ? -1 : 1;
  const alignStart = rtl ? "right" : "left";
  const sideColor = recCardSideColor(model.direction);
  const heroFill = recCardHeroFill(model.direction);
  const body = "#f4f1ea";
  const muted = "#9aa0a8";
  const sans = "Inter, 'Segoe UI', 'Noto Naskh Arabic', sans-serif";
  const mono = "ui-monospace, 'JetBrains Mono', monospace";

  ctx.fillStyle = REC_CARD_CAPTURE_BG;
  roundRect(ctx, 0, 0, W, H, 22);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 22);
  ctx.stroke();

  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = alignStart;

  const logoSrc = (await loadProfitCardLogoDataUrl()) ?? REC_CARD_LOGO_SRC;
  const logo = await loadHtmlImage(logoSrc);
  const logoX = rtl ? W - pad - 24 : pad;
  if (logo) ctx.drawImage(logo, logoX, 12, 24, 24);

  ctx.fillStyle = body;
  ctx.font = `600 14px ${sans}`;
  ctx.fillText(BRAND_NAME, start + toward * 30, 29);

  ctx.font = `700 10px ${sans}`;
  const badgeW = Math.min(120, ctx.measureText(labels.badge).width + 16);
  const badgeX = rtl ? pad : W - pad - badgeW;
  ctx.fillStyle = "rgba(32, 214, 138, 0.12)";
  ctx.strokeStyle = "rgba(32, 214, 138, 0.35)";
  roundRect(ctx, badgeX, 14, badgeW, 20, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = REC_CARD_GAIN_COLOR;
  ctx.textAlign = "center";
  ctx.fillText(labels.badge, badgeX + badgeW / 2, 28);
  ctx.textAlign = alignStart;

  const heroY = 44;
  const heroH = 92;
  ctx.fillStyle = heroFill;
  roundRect(ctx, pad, heroY, W - pad * 2, heroH, 14);
  ctx.fill();

  ctx.font = `600 10px ${sans}`;
  let badgeXCursor = start;
  const badgeY = heroY + 10;
  const addBadge = (text: string) => {
    if (!text) return;
    ctx.font = `600 10px ${sans}`;
    const w = ctx.measureText(text).width + 12;
    const x = rtl ? badgeXCursor - w : badgeXCursor;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    roundRect(ctx, x, badgeY, w, 16, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.textAlign = "center";
    ctx.fillText(text, x + w / 2, badgeY + 12);
    ctx.textAlign = alignStart;
    badgeXCursor += toward * (w + 6);
  };
  addBadge(labels.setup);
  if (model.interval) addBadge(model.interval);
  addBadge(labels.planType);

  ctx.fillStyle = sideColor;
  ctx.font = `700 11px ${sans}`;
  ctx.fillText(labels.signal, start, heroY + 44);

  ctx.fillStyle = body;
  ctx.font = `800 22px ${mono}`;
  ctx.textAlign = alignStart;
  ctx.direction = "ltr";
  ctx.fillText(model.symbol, start, heroY + 72);
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = alignStart;

  if (labels.goalStatus) {
    ctx.font = `700 10px ${sans}`;
    const gw = ctx.measureText(labels.goalStatus).width + 16;
    const gx = rtl ? pad + 8 : W - pad - 8 - gw;
    ctx.fillStyle = "rgba(32, 214, 138, 0.16)";
    roundRect(ctx, gx, heroY + 52, gw, 18, 9);
    ctx.fill();
    ctx.fillStyle = REC_CARD_GAIN_COLOR;
    ctx.textAlign = "center";
    ctx.fillText(labels.goalStatus, gx + gw / 2, heroY + 65);
    ctx.textAlign = alignStart;
  }

  const priceY = heroY + heroH + 28;
  ctx.fillStyle = muted;
  ctx.font = `600 10px ${sans}`;
  ctx.fillText(labels.currentPrice, start, priceY);
  ctx.fillStyle = body;
  ctx.font = `800 22px ${mono}`;
  ctx.direction = "ltr";
  ctx.fillText(
    model.markPrice != null ? formatCardPrice(model.markPrice) : "—",
    start,
    priceY + 24,
  );
  ctx.direction = rtl ? "rtl" : "ltr";

  const cells: Array<{ label: string; value: string; color: string; hit: boolean; test?: string }> = [
    { label: labels.entry, value: formatCardPrice(model.entry), color: body, hit: false },
    {
      label: labels.stop,
      value: formatCardPrice(model.stopLoss),
      color: REC_CARD_LOSS_COLOR,
      hit: model.stopHit,
    },
  ];
  const targetLabels = [labels.target1, labels.target2, labels.target3];
  for (const target of model.targets) {
    cells.push({
      label: targetLabels[target.index - 1] ?? "",
      value: formatCardPrice(target.price),
      color: REC_CARD_GAIN_COLOR,
      hit: target.hit,
    });
  }

  const gridY = priceY + 38;
  const colW = (W - pad * 2 - 10) / 2;
  const rowH = 52;
  cells.forEach((cell, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const visualCol = rtl ? 1 - col : col;
    const x = pad + visualCol * (colW + 10);
    const y = gridY + row * rowH;
    ctx.fillStyle = muted;
    ctx.font = `600 10px ${sans}`;
    ctx.textAlign = alignStart;
    ctx.fillText(cell.label, rtl ? x + colW - 2 : x + 2, y);
    ctx.fillStyle = cell.color;
    ctx.font = `700 15px ${mono}`;
    ctx.direction = "ltr";
    ctx.textAlign = alignStart;
    ctx.fillText(cell.value, rtl ? x + colW - 2 : x + 2, y + 18);
    ctx.direction = rtl ? "rtl" : "ltr";
    if (cell.hit) {
      ctx.font = `700 9px ${sans}`;
      ctx.fillStyle = REC_CARD_GAIN_COLOR;
      ctx.fillText(labels.reached, rtl ? x + colW - 2 : x + 2, y + 34);
    }
  });

  const rows = Math.ceil(cells.length / 2);
  const resultY = gridY + rows * rowH + 8;
  ctx.fillStyle = muted;
  ctx.font = `11px ${sans}`;
  ctx.textAlign = alignStart;
  ctx.fillText(labels.footer, start, resultY);
  const closed = formatRecCardDate(model.dateMs, model.locale);
  if (closed) {
    ctx.font = `10px ${mono}`;
    ctx.fillText(closed, start, resultY + 16);
  }
  ctx.fillStyle = model.isLoss ? REC_CARD_LOSS_COLOR : REC_CARD_GAIN_COLOR;
  ctx.font = `800 22px ${mono}`;
  ctx.direction = "ltr";
  ctx.textAlign = rtl ? "left" : "right";
  ctx.fillText(formatSignedR(model.rMultiple) ?? "—", end, resultY + 8);
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = alignStart;

  ctx.fillStyle = muted;
  ctx.font = `11px ${sans}`;
  const tipY = resultY + 36;
  ctx.fillText(labels.tip, start, tipY);

  const metaY = tipY + 22;
  if (model.entryZone) {
    ctx.fillStyle = muted;
    ctx.font = `10px ${sans}`;
    ctx.fillText(labels.entryZone, start, metaY);
    ctx.fillStyle = body;
    ctx.font = `700 11px ${mono}`;
    ctx.direction = "ltr";
    ctx.fillText(
      `${formatCardPrice(model.entryZone.low)} – ${formatCardPrice(model.entryZone.high)}`,
      start,
      metaY + 16,
    );
    ctx.direction = rtl ? "rtl" : "ltr";
  }
  if (labels.validity) {
    ctx.fillStyle = muted;
    ctx.font = `10px ${sans}`;
    ctx.fillText(labels.validity, start, metaY + 32);
  }

  ctx.fillStyle = "#8a9098";
  ctx.font = `10px ${mono}`;
  ctx.direction = "ltr";
  ctx.textAlign = alignStart;
  ctx.fillText(labels.domain, start, H - 16);

  const blob = await canvasToPngBlob(canvas);
  if (!(await isUsablePngBlob(blob))) {
    throw new Error("rec-card fallback produced an empty PNG");
  }
  return blob;
}

export async function captureRecommendationCardPng(input: {
  offscreen: HTMLElement | null;
  visible: HTMLElement | null;
  model: RecommendationCardModel;
  labels: RecommendationCardLabels;
}): Promise<Blob> {
  const size = {
    width: REC_CARD_CAPTURE_WIDTH,
    minHeight: REC_CARD_CAPTURE_MIN_HEIGHT,
    backgroundColor: REC_CARD_CAPTURE_BG,
  };
  const tryNode = async (node: HTMLElement | null): Promise<Blob | null> => {
    if (!node) return null;
    await embedLogoDataUrls(node);
    await waitForCaptureReady(node);
    return captureHtmlToPngBlob(node, size);
  };
  const fromOffscreen = await tryNode(input.offscreen);
  if (fromOffscreen) return fromOffscreen;
  const fromVisible = await tryNode(input.visible);
  if (fromVisible) return fromVisible;
  return renderRecommendationCardFallbackPng(input.model, input.labels);
}
