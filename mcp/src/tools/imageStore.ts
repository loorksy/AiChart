/**
 * Durable home for captured chart PNGs, served over HTTP.
 *
 * Why this exists: the inline MCP image block is a convenience that a host may
 * silently drop when the response payload gets large. A URL always works, so
 * every capture is written here at full resolution regardless of whether the
 * inline copy made the size cut.
 *
 * Backing store is the local disk rather than S3/R2 because the MCP process
 * already has a public origin (`MCP_PUBLIC_URL`) and nginx forwards the whole
 * `/mcp*` prefix to it — no new infrastructure, no credentials to rotate. Point
 * `MCP_IMAGE_PUBLIC_BASE` at a CDN or bucket later and only this file changes.
 *
 * Access model: the URL *is* the capability. Ids are 128 bits of randomness and
 * entries expire, which is the standard trade for an image a third-party MCP
 * host has to fetch without carrying the operator's OAuth token. Chart PNGs
 * carry no account identity — symbol, candles, and the levels the operator just
 * asked about.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface StoredImage {
  id: string;
  url: string;
  bytes: number;
  /** ISO-8601 instant after which the URL 404s. */
  expiresAt: string;
}

/**
 * Short by design: the operator asked for capture links that live ~3 minutes
 * and then disappear on their own. The link is a view of "the chart right
 * now" — an hour-old chart link would be misleading, not convenient.
 */
const DEFAULT_TTL_MS = 3 * 60 * 1000;
const MIN_SWEEP_INTERVAL_MS = 30_000;
const SWEEP_TIMER_MS = 30_000;
/** Ids are hex so the route can reject anything else before touching the disk. */
const ID_PATTERN = /^[0-9a-f]{32}$/;
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

let lastSweep = 0;

export function imageStoreDir(): string {
  return path.resolve(
    process.env.MCP_IMAGE_STORE_DIR?.trim() || "data/chart-images",
  );
}

export function imageStoreTtlMs(): number {
  const raw = Number(process.env.MCP_IMAGE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS;
}

/**
 * Public base for stored images. Derived from the MCP origin so a deployment
 * that already proxies `/mcp` needs no extra nginx rule: `^~ /mcp` is a prefix
 * match, so `/mcp-images/...` is forwarded by the same block.
 */
export function imagePublicBase(): string {
  const explicit = process.env.MCP_IMAGE_PUBLIC_BASE?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const raw = process.env.MCP_PUBLIC_URL ?? "http://127.0.0.1:8787/mcp";
  try {
    return `${new URL(raw).origin}/mcp-images`;
  } catch {
    return "http://127.0.0.1:8787/mcp-images";
  }
}

/** Delete expired files. Cheap enough to run opportunistically on write. */
function sweep(now: number): void {
  if (now - lastSweep < MIN_SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  sweepNow(now);
}

function sweepNow(now: number): void {
  const dir = imageStoreDir();
  const ttl = imageStoreTtlMs();
  try {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      try {
        if (now - fs.statSync(file).mtimeMs > ttl) fs.unlinkSync(file);
      } catch {
        /* raced with another sweep — fine */
      }
    }
  } catch {
    /* directory not created yet */
  }
}

/**
 * Guaranteed deletion, not just guaranteed 404.
 *
 * The on-read and on-write sweeps make an expired link *behave* deleted, but a
 * quiet server would keep the bytes on disk indefinitely. The timer makes
 * "deleted after 3 minutes" literally true, within one sweep interval.
 */
export function startImageStoreSweeper(): NodeJS.Timeout {
  const timer = setInterval(() => sweepNow(Date.now()), SWEEP_TIMER_MS);
  timer.unref();
  return timer;
}

/**
 * Persist an image and return its public URL.
 *
 * Returns null instead of throwing: losing the URL degrades the response, it
 * does not invalidate a capture that otherwise succeeded.
 */
export async function putImage(
  buffer: Buffer,
  opts: { contentType?: string; ttlMs?: number } = {},
): Promise<StoredImage | null> {
  const contentType = opts.contentType ?? "image/png";
  const ext = EXTENSIONS[contentType] ?? "png";
  const id = randomBytes(16).toString("hex");
  const dir = imageStoreDir();
  const now = Date.now();

  try {
    fs.mkdirSync(dir, { recursive: true });
    // Same atomic write the EA capture path needs: a reader must never observe
    // a half-written file through a bare existsSync.
    const target = path.join(dir, `${id}.${ext}`);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, target);
    sweep(now);
    return {
      id,
      url: `${imagePublicBase()}/${id}.${ext}`,
      bytes: buffer.length,
      expiresAt: new Date(now + (opts.ttlMs ?? imageStoreTtlMs())).toISOString(),
    };
  } catch (e) {
    console.warn(
      `[mcp:image] could not persist capture: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return null;
  }
}

export interface LoadedImage {
  buffer: Buffer;
  contentType: string;
  maxAgeSeconds: number;
}

/** Read a stored image by `<id>.<ext>` filename, or null if unknown/expired. */
export function getImage(fileName: string): LoadedImage | null {
  const match = /^([0-9a-f]{32})\.(png|jpg)$/.exec(String(fileName ?? ""));
  if (!match || !ID_PATTERN.test(match[1])) return null;

  const file = path.join(imageStoreDir(), `${match[1]}.${match[2]}`);
  try {
    const stat = fs.statSync(file);
    const ttl = imageStoreTtlMs();
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > ttl) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* already gone */
      }
      return null;
    }
    return {
      buffer: fs.readFileSync(file),
      contentType: match[2] === "jpg" ? "image/jpeg" : "image/png",
      maxAgeSeconds: Math.max(0, Math.floor((ttl - ageMs) / 1000)),
    };
  } catch {
    return null;
  }
}
