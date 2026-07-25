import type { BridgeClient } from "../bridge/client.js";

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
): Promise<{ base64: string } | { timeout: true; retryAfterMs: number }> {
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
      return { base64: res.body.toString("base64") };
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

export function chartInlineContent(
  meta: Record<string, unknown>,
  base64: string,
): ChartInlineResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { ...meta, imageBase64: base64, chartUrl: meta.chartUrl ?? meta.chart_url },
          null,
          2,
        ),
      },
      { type: "image", data: base64, mimeType: "image/png" },
    ],
  };
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
            retryAfterMs,
            ...meta,
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
 * `inlineBase64` additionally repeats the raw base64 inside the JSON summary.
 * It defaults off because four charts duplicated as text can approach a
 * megabyte of payload for no gain — the image blocks are what the model sees.
 */
export function multiTimeframeContent(
  result: MultiTimeframeBridgeResult,
  options: { inlineBase64?: boolean } = {},
): ChartInlineResponse {
  const snapshots = (result.snapshots ?? []).filter(
    (snapshot) => typeof snapshot.image_base64 === "string" && snapshot.image_base64,
  );
  const content: McpContentBlock[] = [];

  const summary = {
    ok: result.ok !== false && snapshots.length > 0,
    symbol: result.symbol,
    market: result.market,
    requested_timeframes: result.requested_timeframes ?? [],
    captured_timeframes: result.captured_timeframes ?? snapshots.map((s) => s.timeframe),
    missing_timeframes: result.missing_timeframes ?? [],
    partial_success: result.partial_success === true,
    elapsed_ms: result.elapsed_ms,
    image_delivery: options.inlineBase64
      ? "imageBase64 in this JSON and as inline image blocks"
      : "inline image blocks below, one per timeframe (set inline_base64=true to also receive raw base64)",
    guardrails: result.guardrails ?? [],
    snapshots: snapshots.map((snapshot, index) => ({
      timeframe: snapshot.timeframe,
      content_type: snapshot.content_type ?? "image/png",
      captured_at: snapshot.captured_at,
      image_source: snapshot.image_source,
      from_cache: snapshot.from_cache === true,
      image_block_index: index,
      image_bytes: Math.floor(((snapshot.image_base64?.length ?? 0) * 3) / 4),
      ...(options.inlineBase64 ? { imageBase64: snapshot.image_base64 } : {}),
      numeric_context: snapshot.numeric_context ?? null,
    })),
  };

  content.push({ type: "text", text: JSON.stringify(summary, null, 2) });

  for (const snapshot of snapshots) {
    content.push({
      type: "text",
      text: JSON.stringify({
        timeframe: snapshot.timeframe,
        captured_at: snapshot.captured_at,
        numeric_context: snapshot.numeric_context ?? null,
      }),
    });
    content.push({
      type: "image",
      data: snapshot.image_base64!,
      mimeType: snapshot.content_type ?? "image/png",
    });
  }

  return { content, ...(snapshots.length === 0 ? { isError: true } : {}) };
}

export type ChartSnapshotBridgeResult = {
  ok?: boolean;
  status?: string;
  chart_url?: string;
  image_base64?: string;
  mt5_symbol?: string;
};

/** Handles JSON from POST /api/agent/chart/snapshot (QuickChart or MT5 poll). */
export async function resolveChartSnapshotResponse(
  bridge: BridgeClient,
  res: ChartSnapshotBridgeResult,
  pollMaxMs = DEFAULT_MAX_MS,
): Promise<ChartInlineResponse> {
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
        },
        polled.base64,
      );
    }
  }

  if (res.image_base64) {
    return chartInlineContent(
      {
        ok: true,
        status: "ready",
        content_type: "image/png",
      },
      res.image_base64,
    );
  }

  return {
    content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
  };
}

export { DRAW_CAPTURE_MAX_MS };
