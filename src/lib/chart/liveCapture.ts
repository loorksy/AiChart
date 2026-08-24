/**
 * Live TradingView capture: the server asks an already-open chart tab to
 * call takeClientScreenshot() and upload the PNGs.
 *
 * Transport is the existing HTTP poll family (same as draw_on_chart), not a
 * new websocket/SSE stack. Pending requests live in-process; the browser
 * polls GET /api/chart/live-capture and POSTs the PNGs back.
 *
 * The ONLY image source here is TradingView's client-side snapshot API in a
 * live browser session — the operator's own tab, or the PLATFORM tab: the
 * /chart-host page hosted in the isolated chart-host container, which polls
 * and answers exactly like an operator tab (its machinery lives at the
 * bottom of this file). Playwright never captures anything — it only hosts
 * that one page; as an image source it stays rejected along with Puppeteer
 * and raw CDP. When NEITHER tab exists there is NO image — a named failure,
 * never a rendered substitute and never a stored/stale snapshot — and
 * callers proceed on numbers alone, saying so.
 *
 * Every capture is the two-shot pair (captureWindow.ts): a wide context
 * frame and a zoomed detail frame. The upload validator refuses a capture
 * that delivered only one.
 */

import { getChartLayoutById } from "@/lib/store";
import type { MarketType } from "@/lib/markets/types";
import { DEFAULT_MARKET } from "@/lib/marketPolicy";
import type { VisualConfirmation } from "@/lib/recommendations/visualConfirmation";
import {
  captureShots,
  LIVE_TAB_FRESH_MS,
  type CaptureShot,
} from "@/lib/chart/captureWindow";

/**
 * How many captures may be in flight app-side.
 *
 * This was 2 while a multi-timeframe request asks for 3 or 4 frames at once
 * (`captureMultiTimeframeSnapshot` fires them through `Promise.all`), so the
 * last frames of every batch sat waiting for a SLOT before they were even
 * offered to the tab — burning their ack budget in a queue rather than in a
 * render. The tab itself is the real limiter and it is strictly serial
 * (`ChartHostAgent` runs `for (…) await processOne(…)`), so an app-side cap
 * below the batch size adds waiting without removing any work. Sized above
 * the largest batch the visual stage asks for.
 */
export const LIVE_CAPTURE_CONCURRENCY = 4;
/**
 * How long a capture may go unacknowledged before it is declared dead.
 *
 * Background chart tabs are timer-throttled (~1s), so this covers several
 * polls. It is a per-capture floor, NOT a batch budget: one tab renders a
 * batch one frame at a time, so frame N is not even SEEN until the N-1 frames
 * ahead of it have rendered. A batch caller must therefore raise this in
 * proportion to the queue behind it (see `captureTimeframeImage`), or every
 * frame past the second dies waiting its turn while the tab is working
 * perfectly.
 */
export const LIVE_CAPTURE_ACK_MS = 8_000;
export const LIVE_CAPTURE_UPLOAD_MS = 12_000;
/** How long a successful live capture authorises visual_confirmation. */
export const LAST_CAPTURE_TTL_MS = 10 * 60 * 1000;

/**
 * "quickchart_fallback" survives in the union so LEGACY stored evidence
 * still types; the live path can only ever produce "tradingview_capture".
 */
export type ChartImageSource = "tradingview_capture" | "quickchart_fallback";
export type CaptureFallbackReason =
  | "no_live_session"
  | "capture_timeout"
  | "upload_failed"
  | "missing_shots"
  | "layout_not_found"
  // The platform chart session (chart-host container) — named, never silent.
  | "host_unreachable"
  | "host_not_ready";

export interface ChartCaptureMeta {
  image_source: ChartImageSource;
  drawings_included: boolean;
  studies_included: boolean;
  fallback_reason?: CaptureFallbackReason;
}

/** One delivered screenshot of the two-shot pair. */
export interface CaptureShotImage {
  label: CaptureShot["label"];
  image_base64: string;
}

export interface ChartCaptureResult extends ChartCaptureMeta {
  ok: true;
  content_type: "image/png";
  /** The context shot — the wide frame (kept as the primary for callers). */
  image_base64: string;
  /** Both shots of the pair, in request order (context, zoom). */
  images: CaptureShotImage[];
}

/** An honest non-capture: which named reason, and NO image of any kind. */
export interface CaptureFailure {
  ok: false;
  reason: CaptureFallbackReason;
}

export interface LiveCaptureRequest {
  id: string;
  layoutId: string;
  userId: number;
  symbol: string;
  interval: string;
  includeDrawings: boolean;
  includeStudies: boolean;
  /** The mandatory two-shot pair the tab must deliver. */
  shots: CaptureShot[];
  createdAt: number;
  uploadTimeoutMs: number;
}

export interface LiveCaptureUpload {
  requestId: string;
  userId: number;
  layoutId: string;
  /** One buffer per requested shot, labeled. */
  images: { label: string; buffer: Buffer }[];
  drawingsRendered: number;
  studiesRendered: number;
}

interface PendingCapture {
  request: LiveCaptureRequest;
  acked: boolean;
  resolve: (upload: LiveCaptureUpload) => void;
  reject: (err: Error) => void;
  ackTimer: ReturnType<typeof setTimeout>;
  uploadTimer?: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingCapture>();
const lastCaptures = new Map<
  number,
  { meta: ChartCaptureMeta; at: number; layoutId: string }
>();
/** Heartbeat from GET /api/chart/live-capture — which tab can screenshot. */
const liveTabs = new Map<string, { userId: number; layoutId: string; at: number }>();

function liveTabKey(userId: number, layoutId: string): string {
  return `${userId}:${layoutId}`;
}

export function noteLiveCapturePoll(userId: number, layoutId: string): void {
  liveTabs.set(liveTabKey(userId, layoutId), {
    userId,
    layoutId,
    at: Date.now(),
  });
}

/**
 * Prefer a layout whose tab has polled recently so MCP captures hit the
 * open TradingView widget instead of a stale/created layout that nobody
 * is watching (that path was QuickChart every time).
 */
export function pickLiveLayoutId(
  userId: number,
  preferred?: string | null,
): string | undefined {
  const now = Date.now();
  const pref =
    preferred && /^[A-Za-z0-9]{8,16}$/.test(preferred) ? preferred : undefined;
  if (pref) {
    const hit = liveTabs.get(liveTabKey(userId, pref));
    if (hit && now - hit.at <= LIVE_TAB_FRESH_MS) return pref;
  }
  let best: { layoutId: string; at: number } | null = null;
  for (const tab of liveTabs.values()) {
    if (tab.userId !== userId) continue;
    if (now - tab.at > LIVE_TAB_FRESH_MS) continue;
    if (!best || tab.at > best.at) best = { layoutId: tab.layoutId, at: tab.at };
  }
  return best?.layoutId;
}

/** True when this user has a /chat tab that polled within LIVE_TAB_FRESH_MS. */
export function hasFreshLiveTab(userId: number, layoutId?: string): boolean {
  const now = Date.now();
  if (layoutId && /^[A-Za-z0-9]{8,16}$/.test(layoutId)) {
    const hit = liveTabs.get(liveTabKey(userId, layoutId));
    return Boolean(hit && now - hit.at <= LIVE_TAB_FRESH_MS);
  }
  for (const tab of liveTabs.values()) {
    if (tab.userId !== userId) continue;
    if (now - tab.at <= LIVE_TAB_FRESH_MS) return true;
  }
  return false;
}

let active = 0;
const waiters: Array<() => void> = [];

function newId(): string {
  return `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function acquireSlot(timeoutMs: number): Promise<boolean> {
  if (active < LIVE_CAPTURE_CONCURRENCY) {
    active += 1;
    return true;
  }
  return await new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const i = waiters.indexOf(grant);
      if (i >= 0) waiters.splice(i, 1);
      resolve(false);
    }, timeoutMs);
    const grant = () => {
      if (settled) {
        // Timed out after the slot was transferred to us — pass it on.
        const next = waiters.shift();
        if (next) next();
        else active = Math.max(0, active - 1);
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(true);
    };
    waiters.push(grant);
  });
}

function releaseSlot(): void {
  const next = waiters.shift();
  if (next) next();
  else active = Math.max(0, active - 1);
}

export function liveCaptureActiveCount(): number {
  return active;
}

export function listPendingLiveCaptures(userId: number, layoutId: string): LiveCaptureRequest[] {
  const out: LiveCaptureRequest[] = [];
  for (const p of pending.values()) {
    if (p.request.userId === userId && p.request.layoutId === layoutId) {
      out.push(p.request);
    }
  }
  return out;
}

export function ackLiveCapture(userId: number, requestId: string): boolean {
  const p = pending.get(requestId);
  if (!p || p.request.userId !== userId) return false;
  if (p.acked) return true;
  p.acked = true;
  clearTimeout(p.ackTimer);
  p.uploadTimer = setTimeout(() => {
    p.reject(new Error("capture_timeout"));
    pending.delete(requestId);
  }, p.request.uploadTimeoutMs);
  return true;
}

export function completeLiveCapture(upload: LiveCaptureUpload): { ok: true } | { ok: false; error: string } {
  const p = pending.get(upload.requestId);
  if (!p) return { ok: false, error: "unknown_request" };
  if (p.request.userId !== upload.userId) return { ok: false, error: "layout_not_owned" };
  if (p.request.layoutId !== upload.layoutId) return { ok: false, error: "layout_not_owned" };
  const fail = (error: string) => {
    clearTimeout(p.ackTimer);
    if (p.uploadTimer) clearTimeout(p.uploadTimer);
    pending.delete(upload.requestId);
    p.reject(new Error(error));
    return { ok: false as const, error };
  };
  if (!upload.images.length || upload.images.some((image) => !image.buffer.length)) {
    return fail("upload_failed");
  }
  // The two-shot rule, enforced where the pixels arrive: every requested
  // shot must be present. A single wide frame is not a completed capture.
  const delivered = new Set(upload.images.map((image) => image.label));
  const missing = p.request.shots.filter((shot) => !delivered.has(shot.label));
  if (missing.length) {
    return fail("missing_shots");
  }
  clearTimeout(p.ackTimer);
  if (p.uploadTimer) clearTimeout(p.uploadTimer);
  pending.delete(upload.requestId);
  p.resolve(upload);
  return { ok: true };
}

function rememberCapture(userId: number, layoutId: string, meta: ChartCaptureMeta): void {
  lastCaptures.set(userId, { meta, at: Date.now(), layoutId });
}

export function lastLiveCaptureFor(userId: number): ChartCaptureMeta | null {
  const hit = lastCaptures.get(userId);
  if (!hit) return null;
  if (Date.now() - hit.at > LAST_CAPTURE_TTL_MS) {
    lastCaptures.delete(userId);
    return null;
  }
  return hit.meta;
}

/**
 * Structural rule: confirmed/contradicted is only allowed when a recent live
 * capture actually included drawings. Otherwise the field is not_checked.
 */
export function coerceVisualConfirmation(
  claimed: VisualConfirmation,
  userId: number,
): VisualConfirmation {
  if (claimed === "not_checked") return "not_checked";
  const last = lastLiveCaptureFor(userId);
  if (!last || last.image_source !== "tradingview_capture" || last.drawings_included !== true) {
    return "not_checked";
  }
  return claimed;
}

export function drawingsIncludedFromCapture(opts: {
  includeDrawings: boolean;
  drawingsRendered: number;
}): boolean {
  return opts.includeDrawings === true && opts.drawingsRendered > 0;
}

export function studiesIncludedFromCapture(opts: {
  includeStudies: boolean;
  studiesRendered: number;
}): boolean {
  return opts.includeStudies === true && opts.studiesRendered > 0;
}

export interface RequestLiveCaptureInput {
  userId: number;
  layoutId?: string;
  symbol: string;
  interval: string;
  includeDrawings?: boolean;
  includeStudies?: boolean;
  /** When false, never wait for a tab — unattended cron/Telegram/worker. */
  liveSession?: boolean;
  market?: MarketType;
  ackTimeoutMs?: number;
  uploadTimeoutMs?: number;
}

/**
 * TradingView client capture, or an honest named failure. Never renders a
 * substitute image and never serves a stored one: a caller that cannot
 * reach a live tab gets `{ ok: false, reason }` and proceeds without eyes.
 */
export async function captureChartImage(
  input: RequestLiveCaptureInput,
): Promise<ChartCaptureResult | CaptureFailure> {
  const includeDrawings = input.includeDrawings !== false;
  const includeStudies = input.includeStudies !== false;
  const symbol = input.symbol.toUpperCase();
  const interval = input.interval;
  void (input.market ?? DEFAULT_MARKET);

  if (input.liveSession === false) {
    return { ok: false, reason: "no_live_session" };
  }

  const layoutId = input.layoutId;
  if (!layoutId || !/^[A-Za-z0-9]{8,16}$/.test(layoutId)) {
    return { ok: false, reason: "layout_not_found" };
  }
  const layout = await getChartLayoutById(layoutId, input.userId);
  if (!layout) {
    return { ok: false, reason: "layout_not_found" };
  }

  // No polling /chat tab: skip the 8s ACK wait and answer honestly now.
  if (!hasFreshLiveTab(input.userId, layoutId)) {
    return { ok: false, reason: "no_live_session" };
  }

  const gotSlot = await acquireSlot(input.ackTimeoutMs ?? LIVE_CAPTURE_ACK_MS);
  if (!gotSlot) {
    return { ok: false, reason: "capture_timeout" };
  }

  const request: LiveCaptureRequest = {
    id: newId(),
    layoutId,
    userId: input.userId,
    symbol,
    interval,
    includeDrawings,
    includeStudies,
    shots: captureShots(),
    createdAt: Date.now(),
    uploadTimeoutMs: input.uploadTimeoutMs ?? LIVE_CAPTURE_UPLOAD_MS,
  };

  try {
    const upload = await new Promise<LiveCaptureUpload>((resolve, reject) => {
      const ackTimer = setTimeout(() => {
        pending.delete(request.id);
        reject(new Error("no_live_session"));
      }, input.ackTimeoutMs ?? LIVE_CAPTURE_ACK_MS);
      pending.set(request.id, { request, acked: false, resolve, reject, ackTimer });
    });

    const drawings_included = drawingsIncludedFromCapture({
      includeDrawings,
      drawingsRendered: upload.drawingsRendered,
    });
    const studies_included = studiesIncludedFromCapture({
      includeStudies,
      studiesRendered: upload.studiesRendered,
    });
    const meta: ChartCaptureMeta = {
      image_source: "tradingview_capture",
      drawings_included,
      studies_included,
    };
    rememberCapture(input.userId, layoutId, meta);
    const byLabel = new Map(
      upload.images.map((image) => [image.label, image.buffer]),
    );
    const images: CaptureShotImage[] = request.shots.map((shot) => ({
      label: shot.label,
      // completeLiveCapture validated presence; the map lookup cannot miss.
      image_base64: byLabel.get(shot.label)!.toString("base64"),
    }));
    return {
      ok: true,
      ...meta,
      content_type: "image/png",
      image_base64: images[0]!.image_base64,
      images,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "capture_timeout";
    const reason: CaptureFallbackReason =
      msg === "no_live_session"
        ? "no_live_session"
        : msg === "upload_failed"
          ? "upload_failed"
          : msg === "missing_shots"
            ? "missing_shots"
            : "capture_timeout";
    return { ok: false, reason };
  } finally {
    const leftover = pending.get(request.id);
    if (leftover) {
      clearTimeout(leftover.ackTimer);
      if (leftover.uploadTimer) clearTimeout(leftover.uploadTimer);
      pending.delete(request.id);
    }
    releaseSlot();
  }
}

// ---------------------------------------------------------------------------
// The PLATFORM tab — one shared headless chart session for the whole install.
//
// The chart-host container (see chart-host/) opens /chart-host in Playwright;
// that page mounts the same TradingView widget the operator sees and polls
// /api/chart/host-capture exactly like an operator tab polls live-capture.
// The image source is therefore STILL takeClientScreenshot inside a real
// TradingView session — Playwright only hosts the page and never screenshots.
//
// One tab serves every user: requests carry symbol/interval (and, when the
// caller's layout has them, the drawings to render), never a per-user widget.
// ---------------------------------------------------------------------------

/** A drawing shipped to the platform tab to render before the shots. */
export type PlatformCaptureDrawing = Record<string, unknown>;

export interface PlatformCaptureRequest {
  id: string;
  symbol: string;
  interval: string;
  includeDrawings: boolean;
  includeStudies: boolean;
  /** Validated drawings from the REQUESTING layout, rendered for this shot. */
  drawings: PlatformCaptureDrawing[];
  studies: PlatformCaptureDrawing[];
  shots: CaptureShot[];
  createdAt: number;
  uploadTimeoutMs: number;
}

export interface PlatformCaptureUpload {
  requestId: string;
  images: { label: string; buffer: Buffer }[];
  drawingsRendered: number;
  studiesRendered: number;
}

interface PendingPlatformCapture {
  request: PlatformCaptureRequest;
  acked: boolean;
  resolve: (upload: PlatformCaptureUpload) => void;
  reject: (err: Error) => void;
  ackTimer: ReturnType<typeof setTimeout>;
  uploadTimer?: ReturnType<typeof setTimeout>;
}

const platformPending = new Map<string, PendingPlatformCapture>();
let platformTabAt = 0;

/** Heartbeat from GET /api/chart/host-capture — the shared tab is alive. */
export function notePlatformTabPoll(): void {
  platformTabAt = Date.now();
}

export function hasFreshPlatformTab(now = Date.now()): boolean {
  return platformTabAt > 0 && now - platformTabAt <= LIVE_TAB_FRESH_MS;
}

export function listPendingPlatformCaptures(): PlatformCaptureRequest[] {
  return [...platformPending.values()].map((p) => p.request);
}

export function ackPlatformCapture(requestId: string): boolean {
  const p = platformPending.get(requestId);
  if (!p) return false;
  if (p.acked) return true;
  p.acked = true;
  clearTimeout(p.ackTimer);
  p.uploadTimer = setTimeout(() => {
    p.reject(new Error("capture_timeout"));
    platformPending.delete(requestId);
  }, p.request.uploadTimeoutMs);
  return true;
}

export function completePlatformCapture(
  upload: PlatformCaptureUpload,
): { ok: true } | { ok: false; error: string } {
  const p = platformPending.get(upload.requestId);
  if (!p) return { ok: false, error: "unknown_request" };
  const fail = (error: string) => {
    clearTimeout(p.ackTimer);
    if (p.uploadTimer) clearTimeout(p.uploadTimer);
    platformPending.delete(upload.requestId);
    p.reject(new Error(error));
    return { ok: false as const, error };
  };
  if (!upload.images.length || upload.images.some((image) => !image.buffer.length)) {
    return fail("upload_failed");
  }
  // The two-shot rule holds on the platform tab exactly as on an operator's.
  const delivered = new Set(upload.images.map((image) => image.label));
  const missing = p.request.shots.filter((shot) => !delivered.has(shot.label));
  if (missing.length) {
    return fail("missing_shots");
  }
  clearTimeout(p.ackTimer);
  if (p.uploadTimer) clearTimeout(p.uploadTimer);
  platformPending.delete(upload.requestId);
  p.resolve(upload);
  return { ok: true };
}

export interface RequestPlatformCaptureInput {
  /** Whose analysis this shot serves — the capture is remembered for them. */
  forUserId: number;
  symbol: string;
  interval: string;
  includeDrawings?: boolean;
  includeStudies?: boolean;
  drawings?: PlatformCaptureDrawing[];
  studies?: PlatformCaptureDrawing[];
  ackTimeoutMs?: number;
  uploadTimeoutMs?: number;
}

/**
 * One capture on the shared platform tab. The caller has already ensured the
 * tab exists (platformCapture.ts) — an unanswered request here still fails by
 * name, never hangs: the ack timer fires `host_not_ready`.
 */
export async function requestPlatformCapture(
  input: RequestPlatformCaptureInput,
): Promise<ChartCaptureResult | CaptureFailure> {
  const includeDrawings = input.includeDrawings !== false;
  const includeStudies = input.includeStudies !== false;
  const ackTimeoutMs = input.ackTimeoutMs ?? LIVE_CAPTURE_ACK_MS;

  const gotSlot = await acquireSlot(ackTimeoutMs);
  if (!gotSlot) {
    return { ok: false, reason: "capture_timeout" };
  }

  const request: PlatformCaptureRequest = {
    id: newId(),
    symbol: input.symbol.toUpperCase(),
    interval: input.interval,
    includeDrawings,
    includeStudies,
    drawings: includeDrawings ? (input.drawings ?? []) : [],
    studies: includeStudies ? (input.studies ?? []) : [],
    shots: captureShots(),
    createdAt: Date.now(),
    uploadTimeoutMs: input.uploadTimeoutMs ?? LIVE_CAPTURE_UPLOAD_MS,
  };

  try {
    const upload = await new Promise<PlatformCaptureUpload>((resolve, reject) => {
      const ackTimer = setTimeout(() => {
        platformPending.delete(request.id);
        reject(new Error("host_not_ready"));
      }, ackTimeoutMs);
      platformPending.set(request.id, {
        request,
        acked: false,
        resolve,
        reject,
        ackTimer,
      });
    });

    const drawings_included = drawingsIncludedFromCapture({
      includeDrawings,
      drawingsRendered: upload.drawingsRendered,
    });
    const studies_included = studiesIncludedFromCapture({
      includeStudies,
      studiesRendered: upload.studiesRendered,
    });
    const meta: ChartCaptureMeta = {
      image_source: "tradingview_capture",
      drawings_included,
      studies_included,
    };
    rememberCapture(input.forUserId, "platform", meta);
    const byLabel = new Map(upload.images.map((image) => [image.label, image.buffer]));
    const images: CaptureShotImage[] = request.shots.map((shot) => ({
      label: shot.label,
      image_base64: byLabel.get(shot.label)!.toString("base64"),
    }));
    return {
      ok: true,
      ...meta,
      content_type: "image/png",
      image_base64: images[0]!.image_base64,
      images,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "capture_timeout";
    const reason: CaptureFallbackReason =
      msg === "host_not_ready"
        ? "host_not_ready"
        : msg === "upload_failed"
          ? "upload_failed"
          : msg === "missing_shots"
            ? "missing_shots"
            : "capture_timeout";
    return { ok: false, reason };
  } finally {
    const leftover = platformPending.get(request.id);
    if (leftover) {
      clearTimeout(leftover.ackTimer);
      if (leftover.uploadTimer) clearTimeout(leftover.uploadTimer);
      platformPending.delete(request.id);
    }
    releaseSlot();
  }
}

/** Test seam — clears in-process maps. */
export function resetLiveCaptureForTests(): void {
  for (const p of pending.values()) {
    clearTimeout(p.ackTimer);
    if (p.uploadTimer) clearTimeout(p.uploadTimer);
    p.reject(new Error("reset"));
  }
  pending.clear();
  for (const p of platformPending.values()) {
    clearTimeout(p.ackTimer);
    if (p.uploadTimer) clearTimeout(p.uploadTimer);
    p.reject(new Error("reset"));
  }
  platformPending.clear();
  platformTabAt = 0;
  lastCaptures.clear();
  liveTabs.clear();
  active = 0;
  waiters.length = 0;
}
