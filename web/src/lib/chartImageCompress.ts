import {
  imageDataUrl,
  type ChatImagePayload,
  MAX_IMAGE_BYTES,
} from "@/lib/chatImage";

const DEFAULT_MAX_WIDTH = 1280;
/** Stay under typical nginx 1m default + JSON overhead until server is patched. */
const DEFAULT_MAX_BYTES = 900 * 1024;

export interface CompressChartImageOptions {
  maxWidth?: number;
  maxBytes?: number;
  quality?: number;
}

/** Downscale and JPEG-compress a chart capture for /api/market/analyze. */
export async function compressChartImage(
  image: ChatImagePayload,
  opts: CompressChartImageOptions = {},
): Promise<ChatImagePayload> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return image;
  }

  const maxWidth = opts.maxWidth ?? DEFAULT_MAX_WIDTH;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  let quality = opts.quality ?? 0.82;

  const rawBytes = Math.ceil((image.data.length * 3) / 4);
  if (rawBytes <= maxBytes && image.media_type === "image/jpeg") {
    return image;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = img.width > maxWidth ? maxWidth / img.width : 1;
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(image);
        return;
      }
      ctx.fillStyle = "#151517";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      let data = "";
      for (let i = 0; i < 6; i++) {
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        data = dataUrl.split(",")[1] ?? "";
        const bytes = Math.ceil((data.length * 3) / 4);
        if (bytes <= maxBytes && bytes <= MAX_IMAGE_BYTES) break;
        quality = Math.max(0.45, quality - 0.08);
      }

      if (!data) {
        resolve(image);
        return;
      }
      resolve({ media_type: "image/jpeg", data });
    };
    img.onerror = () => resolve(image);
    img.src = imageDataUrl(image);
  });
}
