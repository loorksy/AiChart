import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

/**
 * Files sent inside a support conversation.
 *
 * Same doctrine as the ad images: the SERVER decides what is acceptable, from
 * the bytes themselves. The claimed filename, its extension and the
 * Content-Type are all ignored — a client-side filter is a convenience for the
 * person choosing a file, never the limit.
 *
 * A support attachment is normally a screenshot of something that went wrong,
 * so the accepted set is images plus PDF, and the cap is small enough that a
 * misdirected video is refused rather than stored.
 */
export const SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

export const SUPPORT_ATTACHMENT_ACCEPTED = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
] as const;

const MAGIC: Array<{ ext: string; test: (b: Buffer) => boolean }> = [
  {
    ext: "png",
    test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { ext: "jpg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", test: (b) => b.length > 6 && b.subarray(0, 4).toString("ascii") === "GIF8" },
  {
    ext: "webp",
    test: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
  { ext: "pdf", test: (b) => b.length > 4 && b.subarray(0, 4).toString("ascii") === "%PDF" },
];

export type SupportAttachmentVerdict =
  | { ok: true; ext: string; bytes: number }
  | { ok: false; reason: "too_large" | "unsupported_type" };

export function validateSupportAttachment(bytes: Buffer): SupportAttachmentVerdict {
  if (bytes.length === 0) return { ok: false, reason: "unsupported_type" };
  if (bytes.length > SUPPORT_ATTACHMENT_MAX_BYTES) return { ok: false, reason: "too_large" };
  for (const magic of MAGIC) {
    if (magic.test(bytes)) return { ok: true, ext: magic.ext, bytes: bytes.length };
  }
  return { ok: false, reason: "unsupported_type" };
}

export function supportUploadDir(): string {
  return path.join(process.cwd(), "data", "uploads", "support");
}

/**
 * Persist a validated attachment and return its serving id.
 *
 * The stored name is generated, never taken from the upload: a filename the
 * user controls is a path the user controls.
 */
export function storeSupportAttachment(bytes: Buffer, ext: string): string {
  const name = `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}.${ext}`;
  mkdirSync(supportUploadDir(), { recursive: true });
  writeFileSync(path.join(supportUploadDir(), name), bytes);
  return name;
}

/** Content types the serving route may answer with, keyed by stored extension. */
export const SUPPORT_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};
