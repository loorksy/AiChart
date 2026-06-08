import type { ContentBlock } from "./anthropic";
import { wrapUserMessage } from "./security";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ChatImageMediaType = (typeof ALLOWED_IMAGE_TYPES)[number];

export interface ChatImagePayload {
  media_type: ChatImageMediaType;
  data: string;
}

export function isAllowedImageType(type: string): type is ChatImageMediaType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

export function validateChatImage(
  mediaType: string,
  base64Data: string,
): { ok: true; image: ChatImagePayload } | { ok: false; error: string } {
  if (!isAllowedImageType(mediaType)) {
    return {
      ok: false,
      error: "نوع الصورة غير مدعوم. استخدم JPEG أو PNG أو WebP.",
    };
  }

  const data = base64Data.replace(/\s/g, "");
  if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) {
    return { ok: false, error: "بيانات الصورة غير صالحة." };
  }

  const bytes = Math.ceil((data.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `حجم الصورة يتجاوز ${MAX_IMAGE_BYTES / (1024 * 1024)} ميجابايت.`,
    };
  }

  return { ok: true, image: { media_type: mediaType, data } };
}

export function imageDataUrl(image: ChatImagePayload): string {
  return `data:${image.media_type};base64,${image.data}`;
}

export function parseImageFromMetadata(
  metadataJson: string | null | undefined,
): ChatImagePayload | null {
  if (!metadataJson) return null;
  try {
    const meta = JSON.parse(metadataJson) as { image?: ChatImagePayload };
    if (
      meta.image?.data &&
      meta.image.media_type &&
      isAllowedImageType(meta.image.media_type)
    ) {
      return meta.image;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Builds Anthropic user content with optional chart screenshot. */
export function buildUserMessageContent(
  text: string,
  image?: ChatImagePayload | null,
  wrap = true,
): string | ContentBlock[] {
  const trimmed = text.trim();
  const prompt =
    trimmed ||
    (image
      ? "حلّل الشارت المرفق: حدّد الاتجاه، مستويات الدعم/المقاومة، وأعطِ توصية واضحة."
      : "");

  const wrapped = wrap ? wrapUserMessage(prompt) : prompt;

  if (!image) return wrapped;

  const blocks: ContentBlock[] = [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: image.media_type,
        data: image.data,
      },
    },
    { type: "text", text: wrapped },
  ];
  return blocks;
}

/** Reads a browser File into a validated ChatImagePayload. */
export async function fileToChatImage(
  file: File,
): Promise<{ ok: true; image: ChatImagePayload } | { ok: false; error: string }> {
  if (!isAllowedImageType(file.type)) {
    return {
      ok: false,
      error: "نوع الصورة غير مدعوم. استخدم JPEG أو PNG أو WebP.",
    };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `حجم الصورة يتجاوز ${MAX_IMAGE_BYTES / (1024 * 1024)} ميجابايت.`,
    };
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const data = btoa(binary);
  return validateChatImage(file.type, data);
}
