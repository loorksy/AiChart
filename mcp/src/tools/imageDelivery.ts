/**
 * One delivery path for every captured chart image.
 *
 * Background — the bug this module exists to kill: the capture tools used to
 * base64 whatever bytes arrived and hand them straight to the host as an inline
 * MCP image block, reporting `ok:true` and an `image_bytes` derived from the
 * *pre-encode* capture size. Two independent failures hid behind that:
 *
 *  1. Payload size. A 152,247-byte PNG rendered; 158,286 and 158,385 did not.
 *     Base64 inflates by 4/3, so the boundary sits around 203–211 KB of wire
 *     payload — a host-side response cap, invisible from our end because the
 *     JSON-RPC call still "succeeds".
 *  2. Truncated buffers. A partially-written PNG still starts with the right
 *     eight signature bytes, so nothing downstream noticed; `image_bytes` was
 *     computed before encoding and stayed misleadingly plausible.
 *
 * The response was therefore indistinguishable from a good one, and the model
 * would happily narrate a chart the operator could not see — the exact
 * hallucination the rest of this file's guardrails try to prevent.
 *
 * The fix has three parts, in order of importance:
 *  - VALIDATE: a buffer that is not a complete PNG never ships as `ok:true`.
 *  - SHRINK: resize to 1200px and re-encode until the inline block is under a
 *    cap that sits well below the observed boundary.
 *  - PERSIST: the full-resolution PNG always gets a URL. The URL is the
 *    reliable path; the inline block is the convenience path.
 */

import { Buffer } from "node:buffer";
import { putImage, type StoredImage } from "./imageStore.js";

/**
 * Ceiling for the inline image block, in decoded bytes.
 *
 * 120 KB → ~160 KB of base64, roughly 60% of the smallest payload observed to
 * fail. The margin is deliberate: the real cap is host-defined and counts the
 * whole JSON-RPC envelope, not just our image.
 */
export const MAX_INLINE_IMAGE_BYTES = 120_000;

/** Long edge for the inline copy. The stored copy keeps full resolution. */
export const MAX_INLINE_IMAGE_WIDTH = 1200;

/**
 * Ceiling across *all* inline blocks in one response.
 *
 * Sized so the default four-frame multi-timeframe capture fits, because
 * measurement says the host caps per *block*, not per response: a single
 * ~211 KB base64 block failed while a two-block response totalling ~242 KB
 * base64 rendered both. So the per-image cap above is the load-bearing fix and
 * this budget is a backstop against a pathological response (six dense frames),
 * not the everyday constraint. Frames are attached in order until it is spent;
 * the remainder degrade to URL-only rather than being dropped.
 */
export const MAX_TOTAL_INLINE_IMAGE_BYTES = 480_000;

/**
 * Effective per-image cap. The real limit belongs to the host, not to us, so
 * `MCP_MAX_INLINE_IMAGE_BYTES` can retune it without a deploy if a client turns
 * out to be stricter than the boundary we measured.
 */
export function maxInlineImageBytes(): number {
  const raw = Number(process.env.MCP_MAX_INLINE_IMAGE_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : MAX_INLINE_IMAGE_BYTES;
}

/** Effective response-wide budget; `MCP_MAX_TOTAL_INLINE_IMAGE_BYTES` overrides. */
export function maxTotalInlineImageBytes(): number {
  const raw = Number(process.env.MCP_MAX_TOTAL_INLINE_IMAGE_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : MAX_TOTAL_INLINE_IMAGE_BYTES;
}

const JPEG_QUALITY_LADDER = [85, 75, 65] as const;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** Length 0 + "IEND" + its (constant) CRC — the last 12 bytes of every PNG. */
const PNG_IEND = Buffer.from([
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
/** signature(8) + IHDR chunk(25) + IEND chunk(12) */
const PNG_MIN_BYTES = 45;

export interface PngInspection {
  valid: boolean;
  /** Machine-readable failure cause; absent when valid. */
  reason?: string;
  width?: number;
  height?: number;
}

/**
 * Structural check on a captured PNG: correct signature, an IHDR where the
 * spec requires it, and a terminating IEND chunk.
 *
 * The IEND check is the one that matters. A truncated write keeps a perfect
 * header — that is precisely why the old `bytes[0] !== 0x89` guard waved
 * through half-written files.
 */
export function inspectPng(buffer: unknown): PngInspection {
  if (!Buffer.isBuffer(buffer)) {
    return { valid: false, reason: "not_a_buffer" };
  }
  if (buffer.length === 0) {
    return { valid: false, reason: "empty_buffer" };
  }
  if (buffer.length < PNG_MIN_BYTES) {
    return { valid: false, reason: `too_small_${buffer.length}b` };
  }
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return {
      valid: false,
      reason: `bad_signature_${buffer.subarray(0, 8).toString("hex")}`,
    };
  }
  if (buffer.subarray(12, 16).toString("latin1") !== "IHDR") {
    return { valid: false, reason: "missing_ihdr" };
  }
  if (!buffer.subarray(buffer.length - 12).equals(PNG_IEND)) {
    return { valid: false, reason: "truncated_missing_iend" };
  }
  return {
    valid: true,
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export interface EncodedImage {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  encoding: "png" | "jpeg" | "original";
  /** True when even the most aggressive attempt stayed above the cap. */
  overCap: boolean;
}

type SharpModule = typeof import("sharp");

let sharpPromise: Promise<SharpModule | null> | null = null;

/**
 * sharp is a native module. Loading it dynamically keeps a broken or absent
 * binary from taking the whole MCP server down at import time — without it we
 * simply skip the resize and let the size check decide whether to inline.
 */
async function loadSharp(): Promise<SharpModule | null> {
  if (!sharpPromise) {
    sharpPromise = import("sharp")
      .then((m) => (m.default ?? m) as SharpModule)
      .catch((e) => {
        console.warn(
          `[mcp:image] sharp unavailable — inline images will not be downscaled: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        return null;
      });
  }
  return sharpPromise;
}

/**
 * Produce the copy that travels inline: at most `MAX_INLINE_IMAGE_WIDTH` wide,
 * PNG when that fits under the cap, otherwise JPEG stepping down the quality
 * ladder. Charts are flat-colour line art, so PNG usually wins outright; JPEG
 * is the escape hatch for dense candle fields.
 */
export async function encodeForInline(
  buffer: Buffer,
  opts: { maxBytes?: number; maxWidth?: number } = {},
): Promise<EncodedImage> {
  const maxBytes = opts.maxBytes ?? maxInlineImageBytes();
  const maxWidth = opts.maxWidth ?? MAX_INLINE_IMAGE_WIDTH;
  const original = inspectPng(buffer);

  const sharp = await loadSharp();
  if (!sharp) {
    return {
      buffer,
      mimeType: "image/png",
      width: original.width ?? 0,
      height: original.height ?? 0,
      encoding: "original",
      overCap: buffer.length > maxBytes,
    };
  }

  /**
   * The untouched capture, when it already fits.
   *
   * Resizing is not monotonic in bytes: interpolation blurs the hard edges of a
   * chart into intermediate colours, so a 1200px re-encode can compress *worse*
   * than the 2040px original (observed live: 95,604B in, 105,646B out). Where
   * that happens the original wins on both size and resolution.
   */
  const originalCandidate: EncodedImage | null =
    buffer.length <= maxBytes
      ? {
          buffer,
          mimeType: "image/png",
          width: original.width ?? 0,
          height: original.height ?? 0,
          encoding: "original",
          overCap: false,
        }
      : null;

  /** Whichever of the two is fewer bytes — both are lossless. */
  const preferSmaller = (candidate: EncodedImage): EncodedImage =>
    originalCandidate && originalCandidate.buffer.length < candidate.buffer.length
      ? originalCandidate
      : candidate;

  try {
    const resized = sharp(buffer).resize({
      width: maxWidth,
      withoutEnlargement: true,
      fit: "inside",
    });

    const png = await resized
      .clone()
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    if (png.data.length <= maxBytes) {
      return preferSmaller({
        buffer: png.data,
        mimeType: "image/png",
        width: png.info.width,
        height: png.info.height,
        encoding: "png",
        overCap: false,
      });
    }

    let smallest: EncodedImage = {
      buffer: png.data,
      mimeType: "image/png",
      width: png.info.width,
      height: png.info.height,
      encoding: "png",
      overCap: true,
    };

    for (const quality of JPEG_QUALITY_LADDER) {
      const jpeg = await resized
        .clone()
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      const candidate: EncodedImage = {
        buffer: jpeg.data,
        mimeType: "image/jpeg",
        width: jpeg.info.width,
        height: jpeg.info.height,
        encoding: "jpeg",
        overCap: jpeg.data.length > maxBytes,
      };
      if (!candidate.overCap) return preferSmaller(candidate);
      if (candidate.buffer.length < smallest.buffer.length) smallest = candidate;
    }

    return preferSmaller(smallest);
  } catch (e) {
    console.warn(
      `[mcp:image] re-encode failed, falling back to the original buffer: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return {
      buffer,
      mimeType: "image/png",
      width: original.width ?? 0,
      height: original.height ?? 0,
      encoding: "original",
      overCap: buffer.length > maxBytes,
    };
  }
}

export interface ImageDeliveryContext {
  /** Tool that produced the capture — the log's primary grouping key. */
  tool: string;
  symbol?: string;
  timeframe?: string;
}

export interface PreparedImage {
  ok: true;
  inline: EncodedImage;
  stored: StoredImage | null;
  sourceBytes: number;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface RejectedImage {
  ok: false;
  reason: string;
  sourceBytes: number;
}

/**
 * Validate → persist → downscale, with one log line per capture.
 *
 * Returns a rejection instead of throwing so callers can turn it into an MCP
 * error result carrying the reason; a broken buffer must never reach the host
 * dressed as a success.
 */
export async function prepareImage(
  buffer: Buffer,
  ctx: ImageDeliveryContext,
  opts: { maxBytes?: number } = {},
): Promise<PreparedImage | RejectedImage> {
  const sourceBytes = Buffer.isBuffer(buffer) ? buffer.length : 0;
  const check = inspectPng(buffer);

  if (!check.valid) {
    console.error(
      `[mcp:image] REJECTED tool=${ctx.tool} symbol=${ctx.symbol ?? "-"} ` +
        `timeframe=${ctx.timeframe ?? "-"} bytes=${sourceBytes} ` +
        `reason=${check.reason}`,
    );
    return { ok: false, reason: check.reason ?? "invalid_png", sourceBytes };
  }

  const stored = await putImage(buffer, { contentType: "image/png" });
  const inline = await encodeForInline(buffer, opts);

  // base64 length is the number that actually meets the host's payload cap;
  // logging it next to the arithmetic expectation makes a truncated or
  // double-encoded block obvious at a glance.
  const base64Length = inline.buffer.toString("base64").length;
  const base64Expected = Math.ceil(inline.buffer.length / 3) * 4;

  console.log(
    `[mcp:image] tool=${ctx.tool} symbol=${ctx.symbol ?? "-"} ` +
      `timeframe=${ctx.timeframe ?? "-"} png=valid ` +
      `source_bytes=${sourceBytes} source_dims=${check.width}x${check.height} ` +
      `inline_bytes=${inline.buffer.length} inline_dims=${inline.width}x${inline.height} ` +
      `inline_encoding=${inline.encoding} base64_len=${base64Length} ` +
      `base64_expected=${base64Expected} ` +
      `base64_matches=${base64Length === base64Expected} ` +
      `over_cap=${inline.overCap} stored=${stored ? stored.url : "none"}`,
  );

  return {
    ok: true,
    inline,
    stored,
    sourceBytes,
    sourceWidth: check.width,
    sourceHeight: check.height,
  };
}

/** Why an image did not travel inline — each cause needs different advice. */
export type InlineSkipReason =
  | "over_cap"
  | "budget_exhausted"
  | "inline_not_requested";

function skipExplanation(
  prepared: PreparedImage,
  reason: InlineSkipReason | undefined,
): string {
  if (!prepared.stored) {
    return "image could not be inlined and no storage URL is available";
  }
  if (reason === "inline_not_requested") {
    return "inline image skipped by request (inline_image=false). SHOW the chart to the operator by pasting display_markdown verbatim in your reply — the link expires in ~3 minutes.";
  }
  const bytes = prepared.inline.buffer.length;
  return reason === "budget_exhausted"
    ? `response image budget spent on earlier frames (this frame needed ${bytes}B) — open image_url to view it`
    : `image too large to inline (${bytes}B > ${maxInlineImageBytes()}B cap) — open image_url to view it`;
}

/** The `image_*` fields shared by every capture tool's text block. */
export function imageDeliveryFields(
  prepared: PreparedImage,
  attached: boolean,
  skipReason?: InlineSkipReason,
  markdownLabel = "chart",
): Record<string, unknown> {
  return {
    content_type: attached ? prepared.inline.mimeType : "image/png",
    // Bytes ACTUALLY sent inline. Zero when the image travelled by URL only —
    // the field that used to lie about a block that never rendered.
    image_bytes: attached ? prepared.inline.buffer.length : 0,
    image_attached: attached,
    full_image_bytes: prepared.sourceBytes,
    image_url: prepared.stored?.url ?? null,
    width: prepared.sourceWidth ?? null,
    height: prepared.sourceHeight ?? null,
    bytes: prepared.sourceBytes,
    expires_at: prepared.stored?.expiresAt ?? null,
    inline_width: attached ? prepared.inline.width : null,
    inline_height: attached ? prepared.inline.height : null,
    // The one field that makes the picture reach the OPERATOR on hosts that
    // render only the assistant's markdown (ChatGPT, the Claude consumer app):
    // the model pastes this line into its reply and the chart displays there.
    display_markdown: prepared.stored
      ? `![${markdownLabel}](${prepared.stored.url})`
      : null,
    image_delivery: attached
      ? "The chart is attached as the image block below. ALSO paste display_markdown verbatim in your reply so the operator sees the chart even on hosts that hide tool images. Link expires in ~3 minutes."
      : skipExplanation(prepared, skipReason),
    ...(attached
      ? {}
      : {
          // Anti-hallucination: with no inline block the model has seen NOTHING.
          note:
            "You did NOT receive this chart's pixels. Do not describe or imply what the chart looks like — paste display_markdown in your reply so the operator can see it.",
        }),
  };
}

/** Guardrail text for a capture that produced no usable image. */
export function brokenImageResult(
  reason: string,
  meta: Record<string, unknown>,
  ctx: ImageDeliveryContext,
): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            ...meta,
            ok: false,
            status: "invalid_image",
            image_captured: false,
            image_attached: false,
            image_bytes: 0,
            failure_reason: reason,
            tool: ctx.tool,
            symbol: ctx.symbol,
            note:
              "The capture returned bytes that are NOT a complete PNG, so no image was attached. Do NOT describe or imply a chart image — report the failure and offer to retry.",
            user_message:
              "وصلت لقطة الشارت تالفة أو ناقصة، ولم تُرفق أي صورة. أعد المحاولة من فضلك.",
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}
