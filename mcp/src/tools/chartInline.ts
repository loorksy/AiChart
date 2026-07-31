import { Buffer } from "node:buffer";
import type { BridgeClient } from "../bridge/client.js";
import {
  brokenImageResult,
  imageDeliveryFields,
  maxTotalInlineImageBytes,
  prepareImage,
  type ImageDeliveryContext,
} from "./imageDelivery.js";

const DEFAULT_MAX_MS = 8000;
const DEFAULT_INTERVAL_MS = 500;
const DRAW_CAPTURE_MAX_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type ChartInlineResponse = {
  content: McpContentBlock[];
  isError?: boolean;
  [key: string]: unknown;
};

/** Extract capture id from chart URL (`/api/agent/chart/{id}/mt5`). */
export function mt5ChartPollId(
  chartUrl?: string,
  captureKey?: string,
  recommendationId?: number,
): string | null {
  if (captureKey) return captureKey;
  if (recommendationId != null && recommendationId > 0) {
    return String(recommendationId);
  }
  if (chartUrl) {
    const match = /\/chart\/([^/]+)\/mt5/.exec(chartUrl);
    if (match?.[1]) return match[1];
  }
  return null;
}

export async function pollBridgeMt5ChartPng(
  bridge: BridgeClient,
  chartId: string,
  options?: { maxMs?: number; intervalMs?: number },
): Promise<{ png: Buffer } | { timeout: true; retryAfterMs: number }> {
  const maxMs = options?.maxMs ?? DEFAULT_MAX_MS;
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + maxMs;

  while (Date.now() < deadline) {
    const res = await bridge.getRaw(`/api/agent/chart/${chartId}/mt5`);
    if (
      res.status === 200 &&
      res.contentType.includes("image/png") &&
      Buffer.isBuffer(res.body)
    ) {
      // Raw bytes, not base64: the delivery layer needs the buffer to check
      // that the PNG is complete before anything is encoded for the wire.
      return { png: res.body };
    }
    if (res.status === 202 || res.status === 200) {
      await sleep(intervalMs);
      continue;
    }
    if (res.status === 503) {
      return { timeout: true, retryAfterMs: 2000 };
    }
    await sleep(intervalMs);
  }

  return { timeout: true, retryAfterMs: 2000 };
}

/**
 * The single delivery path for a one-image capture.
 *
 * Accepts a Buffer (MT5 poll) or base64 (bridge JSON), validates it, persists
 * the full-resolution PNG for its URL, and attaches a downscaled inline block
 * only when that block is small enough to survive the host's payload cap.
 */
export async function chartInlineContent(
  meta: Record<string, unknown>,
  image: Buffer | string,
  ctx: ImageDeliveryContext = { tool: "capture_chart_snapshot" },
): Promise<ChartInlineResponse> {
  const buffer = Buffer.isBuffer(image)
    ? image
    : Buffer.from(String(image ?? ""), "base64");

  const prepared = await prepareImage(buffer, ctx);
  if (!prepared.ok) {
    return brokenImageResult(prepared.reason, meta, ctx);
  }

  const attached = !prepared.inline.overCap;
  const content: McpContentBlock[] = [
    {
      type: "text",
      text: JSON.stringify(
        {
          ...meta,
          chartUrl: meta.chartUrl ?? meta.chart_url,
          ...imageDeliveryFields(prepared, attached),
        },
        null,
        2,
      ),
    },
  ];

  if (attached) {
    content.push({
      type: "image",
      data: prepared.inline.buffer.toString("base64"),
      mimeType: prepared.inline.mimeType,
    });
  }

  return { content };
}

export function chartTimeoutContent(
  meta: Record<string, unknown>,
  retryAfterMs: number,
): ChartInlineResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            ok: false,
            status: "timeout",
            image_captured: false,
            retryAfterMs,
            ...meta,
            // Guardrail against hallucinated screenshots: the model must state
            // the failure, never narrate a chart it was not given.
            note:
              "NO image was captured. Do NOT describe or imply a chart image — tell the user the snapshot failed and offer to retry.",
            user_message:
              "تعذّر التقاط صورة الشارت الآن (انتهت مهلة الالتقاط). لم تُرفق أي صورة — أعد المحاولة بعد قليل.",
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}

export interface MultiTimeframeBridgeSnapshot {
  timeframe: string;
  content_type?: string;
  image_base64?: string;
  captured_at?: string;
  image_source?: string;
  from_cache?: boolean;
  numeric_context?: Record<string, unknown> | null;
}

export interface MultiTimeframeBridgeResult {
  ok?: boolean;
  symbol?: string;
  market?: string;
  requested_timeframes?: string[];
  captured_timeframes?: string[];
  missing_timeframes?: Array<{ timeframe: string; reason: string }>;
  partial_success?: boolean;
  snapshots?: MultiTimeframeBridgeSnapshot[];
  elapsed_ms?: number;
  guardrails?: string[];
}

/**
 * Renders one image block per timeframe, each preceded by the numeric context
 * for that same timeframe.
 *
 * The interleaving is the point: a flat list of four PNGs gives the model no
 * reliable way to bind a chart to its timeframe, and binding is exactly what a
 * multi-timeframe read depends on.
 *
 * Every frame goes through the same validate/persist/downscale path as a single
 * capture, plus a response-wide byte budget — four individually-legal images
 * still overflow the host's payload cap, so frames are attached until the
 * budget runs out and the rest fall back to their URLs.
 *
 * `inlineBase64` additionally repeats the raw base64 inside the JSON summary.
 * It defaults off because four charts duplicated as text can approach a
 * megabyte of payload for no gain — the image blocks are what the model sees.
 */
export async function multiTimeframeContent(
  result: MultiTimeframeBridgeResult,
  options: { inlineBase64?: boolean } = {},
): Promise<ChartInlineResponse> {
  const candidates = (result.snapshots ?? []).filter(
    (snapshot) => typeof snapshot.image_base64 === "string" && snapshot.image_base64,
  );

  const symbol = result.symbol;
  const totalBudget = maxTotalInlineImageBytes();
  let remainingBudget = totalBudget;

  const frames = [];
  for (const snapshot of candidates) {
    const prepared = await prepareImage(
      Buffer.from(snapshot.image_base64!, "base64"),
      {
        tool: "capture_multi_timeframe_snapshot",
        symbol,
        timeframe: snapshot.timeframe,
      },
    );
    if (!prepared.ok) {
      frames.push({ snapshot, prepared: null, reason: prepared.reason });
      continue;
    }
    const attached =
      !prepared.inline.overCap && prepared.inline.buffer.length <= remainingBudget;
    if (attached) remainingBudget -= prepared.inline.buffer.length;
    frames.push({ snapshot, prepared, attached });
  }

  const usable = frames.filter((f) => f.prepared !== null);
  const broken = frames.filter((f) => f.prepared === null);
  const content: McpContentBlock[] = [];

  // Frames whose bytes failed validation are missing frames, not silent ones —
  // they join missing_timeframes so the model reports them instead of guessing.
  const missing = [
    ...(result.missing_timeframes ?? []),
    ...broken.map((f) => ({
      timeframe: f.snapshot.timeframe,
      reason: `invalid_image:${f.reason}`,
    })),
  ];

  let blockIndex = 0;
  const summary = {
    ok: result.ok !== false && usable.length > 0,
    symbol,
    market: result.market,
    requested_timeframes: result.requested_timeframes ?? [],
    captured_timeframes: usable.map((f) => f.snapshot.timeframe),
    missing_timeframes: missing,
    partial_success: result.partial_success === true || broken.length > 0,
    elapsed_ms: result.elapsed_ms,
    image_delivery:
      usable.length === 0
        ? "NO images captured — do not describe any chart image"
        : "full-resolution PNGs at each snapshot's image_url; frames that fit the payload budget are also attached as inline image blocks",
    inline_budget_bytes: totalBudget,
    ...(usable.length === 0
      ? {
          note:
            "NO snapshot was captured for any timeframe. Do NOT describe or imply chart images — report the failure and its reasons to the user.",
          user_message:
            "تعذّر التقاط صور الشارت لهذه الفريمات. لم تُرفق أي صورة — راجع الأسباب في missing_timeframes وأعد المحاولة.",
        }
      : {}),
    guardrails: result.guardrails ?? [],
    snapshots: usable.map((frame) => {
      const prepared = frame.prepared!;
      const attached = frame.attached === true;
      return {
        timeframe: frame.snapshot.timeframe,
        captured_at: frame.snapshot.captured_at,
        image_source: frame.snapshot.image_source,
        from_cache: frame.snapshot.from_cache === true,
        image_block_index: attached ? blockIndex++ : null,
        ...imageDeliveryFields(prepared, attached),
        ...(options.inlineBase64 && attached
          ? { imageBase64: prepared.inline.buffer.toString("base64") }
          : {}),
        numeric_context: frame.snapshot.numeric_context ?? null,
      };
    }),
  };

  content.push({ type: "text", text: JSON.stringify(summary, null, 2) });

  for (const frame of usable) {
    if (frame.attached !== true) continue;
    content.push({
      type: "text",
      text: JSON.stringify({
        timeframe: frame.snapshot.timeframe,
        captured_at: frame.snapshot.captured_at,
        numeric_context: frame.snapshot.numeric_context ?? null,
      }),
    });
    content.push({
      type: "image",
      data: frame.prepared!.inline.buffer.toString("base64"),
      mimeType: frame.prepared!.inline.mimeType,
    });
  }

  return { content, ...(usable.length === 0 ? { isError: true } : {}) };
}

export type ChartSnapshotBridgeResult = {
  ok?: boolean;
  status?: string;
  chart_url?: string;
  image_base64?: string;
  mt5_symbol?: string;
  symbol?: string;
  interval?: string;
  image_source?: string;
};

/** Handles JSON from POST /api/agent/chart/snapshot (platform, MT5, or QuickChart). */
export async function resolveChartSnapshotResponse(
  bridge: BridgeClient,
  res: ChartSnapshotBridgeResult,
  pollMaxMs = DEFAULT_MAX_MS,
  ctx: ImageDeliveryContext = { tool: "capture_chart_snapshot" },
): Promise<ChartInlineResponse> {
  const context: ImageDeliveryContext = {
    ...ctx,
    symbol: ctx.symbol ?? res.symbol ?? res.mt5_symbol,
    timeframe: ctx.timeframe ?? res.interval,
  };

  if (res.status === "pending" && res.chart_url) {
    const chartId = mt5ChartPollId(res.chart_url);
    if (chartId) {
      const polled = await pollBridgeMt5ChartPng(bridge, chartId, {
        maxMs: pollMaxMs,
      });
      if ("timeout" in polled) {
        return chartTimeoutContent(
          { chartUrl: res.chart_url, mt5Symbol: res.mt5_symbol },
          polled.retryAfterMs,
        );
      }
      return chartInlineContent(
        {
          ok: true,
          status: "ready",
          chartUrl: res.chart_url,
          mt5Symbol: res.mt5_symbol,
          image_source: "mt5",
        },
        polled.png,
        context,
      );
    }
  }

  if (res.image_base64) {
    return chartInlineContent(
      {
        ok: true,
        status: "ready",
        image_source: res.image_source,
      },
      res.image_base64,
      context,
    );
  }

  // No image and no pending capture — say so explicitly. A bare echo of the
  // bridge payload reads like success and invites the model to invent a chart.
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            ...res,
            ok: false,
            status: res.status ?? "no_image",
            image_captured: false,
            note:
              "NO image was captured. Do NOT describe or imply a chart image — tell the user the snapshot is unavailable.",
            user_message:
              "تعذّر توليد صورة الشارت من أي مصدر متاح. لم تُرفق أي صورة.",
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}

export { DRAW_CAPTURE_MAX_MS };
