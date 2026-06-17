import type { BridgeClient } from "../bridge/client.js";

const DEFAULT_MAX_MS = 8000;
const DEFAULT_INTERVAL_MS = 500;

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
