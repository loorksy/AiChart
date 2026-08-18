/**
 * Live TradingView capture: the server asks an already-open chart tab to
 * call takeClientScreenshot() and upload the PNG.
 *
 * Transport is the existing HTTP poll family (same as draw_on_chart), not a
 * new websocket/SSE stack. Pending requests live in-process; the browser
 * polls GET /api/chart/live-capture and POSTs the PNG back.
 *
 * Playwright / headless Chromium is not used here.
 */

import { getChartLayoutById } from "@/lib/store";
import { buildChartSnapshotBufferForMarket } from "@/lib/chartSnapshot";
import type { MarketType } from "@/lib/markets/types";
import { DEFAULT_MARKET } from "@/lib/marketPolicy";
import type { VisualConfirmation } from "@/lib/recommendations/visualConfirmation";
import {
  CHART_CAPTURE_CANDLES,
  LIVE_TAB_FRESH_MS,
} from "@/lib/chart/captureWindow";

export const LIVE_CAPTURE_CONCURRENCY = 2;
/** Background chart tabs are timer-throttled (~1s); 8s still gets several polls. */
export const LIVE_CAPTURE_ACK_MS = 8_000;
export const LIVE_CAPTURE_UPLOAD_MS = 12_000;
/** How long a successful live capture authorises visual_confirmation. */
export const LAST_CAPTURE_TTL_MS = 10 * 60 * 1000;

export type ChartImageSource = "tradingview_capture" | "quickchart_fallback";
export type CaptureFallbackReason =
  | "no_live_session"
  | "capture_timeout"
  | "upload_failed"
  | "layout_not_found";

export interface ChartCaptureMeta {
  image_source: ChartImageSource;
  drawings_included: boolean;
  studies_included: boolean;
  fallback_reason?: CaptureFallbackReason;
}

export interface ChartCaptureResult extends ChartCaptureMeta {
  ok: true;
  content_type: "image/png";
  image_base64: string;
}

export interface LiveCaptureRequest {
  id: string;
  layoutId: string;
  userId: number;
  symbol: string;
  interval: string;
  includeDrawings: boolean;
  includeStudies: boolean;
  createdAt: number;
  uploadTimeoutMs: number;
}

export interface LiveCaptureUpload {
  requestId: string;
  userId: number;
  layoutId: string;
  buffer: Buffer;
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
  if (!upload.buffer.length) {
    clearTimeout(p.ackTimer);
    if (p.uploadTimer) clearTimeout(p.uploadTimer);
    pending.delete(upload.requestId);
    p.reject(new Error("upload_failed"));
    return { ok: false, error: "upload_failed" };
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

async function quickchartFallback(
  userId: number,
  symbol: string,
  interval: string,
  market: MarketType,
  reason: CaptureFallbackReason,
): Promise<ChartCaptureResult | null> {
  const buffer = await buildChartSnapshotBufferForMarket(userId, symbol, interval, market, {
    limit: CHART_CAPTURE_CANDLES,
  });
  if (!buffer) return null;
  const meta: ChartCaptureMeta = {
    image_source: "quickchart_fallback",
    drawings_included: false,
    studies_included: false,
    fallback_reason: reason,
  };
  rememberCapture(userId, "", meta);
  return {
    ok: true,
    ...meta,
    content_type: "image/png",
    image_base64: buffer.toString("base64"),
  };
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

export async function captureChartImage(
  input: RequestLiveCaptureInput,
): Promise<ChartCaptureResult | null> {
  const includeDrawings = input.includeDrawings !== false;
  const includeStudies = input.includeStudies !== false;
  const market = input.market ?? DEFAULT_MARKET;
  const symbol = input.symbol.toUpperCase();
  const interval = input.interval;

  if (input.liveSession === false) {
    return quickchartFallback(input.userId, symbol, interval, market, "no_live_session");
  }

  const layoutId = input.layoutId;
  if (!layoutId || !/^[A-Za-z0-9]{8,16}$/.test(layoutId)) {
    return quickchartFallback(input.userId, symbol, interval, market, "layout_not_found");
  }
  const layout = await getChartLayoutById(layoutId, input.userId);
  if (!layout) {
    return quickchartFallback(input.userId, symbol, interval, market, "layout_not_found");
  }

  // No polling /chat tab: skip the 8s ACK wait. Same honest QuickChart
  // payload (no_live_session) without hanging the MCP tool.
  if (!hasFreshLiveTab(input.userId, layoutId)) {
    return quickchartFallback(input.userId, symbol, interval, market, "no_live_session");
  }

  const gotSlot = await acquireSlot(input.ackTimeoutMs ?? LIVE_CAPTURE_ACK_MS);
  if (!gotSlot) {
    return quickchartFallback(input.userId, symbol, interval, market, "capture_timeout");
  }

  const request: LiveCaptureRequest = {
    id: newId(),
    layoutId,
    userId: input.userId,
    symbol,
    interval,
    includeDrawings,
    includeStudies,
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
    return {
      ok: true,
      ...meta,
      content_type: "image/png",
      image_base64: upload.buffer.toString("base64"),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "capture_timeout";
    const reason: CaptureFallbackReason =
      msg === "no_live_session"
        ? "no_live_session"
        : msg === "upload_failed"
          ? "upload_failed"
          : "capture_timeout";
    return quickchartFallback(input.userId, symbol, interval, market, reason);
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

/** Test seam — clears in-process maps. */
export function resetLiveCaptureForTests(): void {
  for (const p of pending.values()) {
    clearTimeout(p.ackTimer);
    if (p.uploadTimer) clearTimeout(p.uploadTimer);
    p.reject(new Error("reset"));
  }
  pending.clear();
  lastCaptures.clear();
  liveTabs.clear();
  active = 0;
  waiters.length = 0;
}
