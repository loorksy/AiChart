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
  structuredContent?: Record<string, unknown>;
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
 * the full-resolution PNG for its short-lived URL, and attaches the downscaled
 * inline block by default so the host model *sees* the chart. The operator must
 * see it too, and consumer hosts differ in what they render — some show the
 * tool-result image, some (ChatGPT, the Claude consumer app) only render
 * markdown in the assistant's reply. So the response also carries
 * `display_markdown`, a ready `![…](url)` line the model is told to paste into
 * its answer verbatim. Belt and braces: whichever path the host supports, the
 * operator gets a picture, not a bare link.
 */
export async function chartInlineContent(
  meta: Record<string, unknown>,
  image: Buffer | string,
  ctx: ImageDeliveryContext = { tool: "capture_chart_snapshot" },
  opts: { inlineImage?: boolean } = {},
): Promise<ChartInlineResponse> {
  const buffer = Buffer.isBuffer(image)
    ? image
    : Buffer.from(String(image ?? ""), "base64");

  const prepared = await prepareImage(buffer, ctx);
  if (!prepared.ok) {
    return brokenImageResult(prepared.reason, meta, ctx);
  }

  const wantsInline = opts.inlineImage !== false;
  const attached = wantsInline && !prepared.inline.overCap;
  const skipReason = !wantsInline
    ? ("inline_not_requested" as const)
    : ("over_cap" as const);
  const label = [ctx.symbol, ctx.timeframe, "chart"].filter(Boolean).join(" ");
  const content: McpContentBlock[] = [
    {
      type: "text",
      text: JSON.stringify(
        {
          ...meta,
          chartUrl: meta.chartUrl ?? meta.chart_url,
          ...imageDeliveryFields(prepared, attached, skipReason, label),
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

  return { content, structuredContent: meta };
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
  drawings_included?: boolean;
  studies_included?: boolean;
  fallback_reason?: string;
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
  options: { inlineBase64?: boolean; inlineImage?: boolean } = {},
): Promise<ChartInlineResponse> {
  const candidates = (result.snapshots ?? []).filter(
    (snapshot) => typeof snapshot.image_base64 === "string" && snapshot.image_base64,
  );

  const symbol = result.symbol;
  const totalBudget = maxTotalInlineImageBytes();
  let remainingBudget = totalBudget;
  // Inline is the default — the analysis doctrine depends on the model seeing
  // the frames. inline_image=false opts out; inline_base64 keeps implying it.
  const wantsInline = options.inlineImage !== false || options.inlineBase64 === true;

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
    const fitsBudget = prepared.inline.buffer.length <= remainingBudget;
    const attached = wantsInline && !prepared.inline.overCap && fitsBudget;
    if (attached) remainingBudget -= prepared.inline.buffer.length;
    frames.push({
      snapshot,
      prepared,
      attached,
      // Distinguishing the causes is what tells the operator whether the frame
      // was never requested inline, inherently too big, or queued behind
      // earlier ones.
      skipReason: !wantsInline
        ? ("inline_not_requested" as const)
        : prepared.inline.overCap
          ? ("over_cap" as const)
          : ("budget_exhausted" as const),
    });
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
        : wantsInline
          ? "Frames that fit the payload budget are attached as inline image blocks. ALSO paste each snapshot's display_markdown in your reply so the operator sees the charts even on hosts that hide tool images. Links expire in ~3 minutes."
          : "Inline images skipped by request (inline_image=false). SHOW the operator the charts by pasting each snapshot's display_markdown in your reply — links expire in ~3 minutes.",
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
        drawings_included: frame.snapshot.drawings_included === true,
        studies_included: frame.snapshot.studies_included === true,
        fallback_reason: frame.snapshot.fallback_reason ?? null,
        from_cache: frame.snapshot.from_cache === true,
        image_block_index: attached ? blockIndex++ : null,
        ...imageDeliveryFields(
          prepared,
          attached,
          frame.skipReason,
          [symbol, frame.snapshot.timeframe, "chart"].filter(Boolean).join(" "),
        ),
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
  drawings_included?: boolean;
  studies_included?: boolean;
  fallback_reason?: string | null;
};

function snapshotHonestyMeta(res: ChartSnapshotBridgeResult): Record<string, unknown> {
  const drawingsIncluded = res.drawings_included === true;
  // The old image-source fallback check is gone: the live capture path never returns
  // fallback_reason (a 503 failure is caught before this function ever runs), so it was dead.
  return {
    drawings_included: drawingsIncluded,
    studies_included: res.studies_included === true,
    fallback_reason: res.fallback_reason ?? null,
    ...(!drawingsIncluded
      ? {
          note:
            "drawings_included is false — visual_confirmation must be not_checked. Do not report confirmed against this picture.",
        }
      : {}),
  };
}

/** Handles JSON from POST /api/agent/chart/snapshot (platform or MT5). */
export async function resolveChartSnapshotResponse(
  bridge: BridgeClient,
  res: ChartSnapshotBridgeResult,
  pollMaxMs = DEFAULT_MAX_MS,
  ctx: ImageDeliveryContext = { tool: "capture_chart_snapshot" },
  opts: { inlineImage?: boolean } = {},
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
        opts,
      );
    }
  }

  if (res.image_base64) {
    return chartInlineContent(
      {
        ok: true,
        status: "ready",
        image_source: res.image_source,
        ...snapshotHonestyMeta(res),
      },
      res.image_base64,
      context,
      opts,
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

/**
 * V2-A0: a recommendation is not "delivered" until the operator can SEE it.
 *
 * Wraps a successful create_recommendation bridge payload with an automatic
 * platform-chart capture (same source ladder as capture_chart_snapshot) plus a
 * compact recommendation_card, so one tool call yields the full deliverable:
 * JSON + card + image + display_markdown. A capture failure NEVER fails the
 * recommendation — it degrades to an explicit image_captured:false with the
 * anti-hallucination note, because the recommendation row already exists.
 */
function collectCardTargets(inner: Record<string, unknown>, extra?: unknown): number[] {
  const out: number[] = [];
  const push = (v: unknown): void => {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      if (!out.includes(v)) out.push(v);
      return;
    }
    if (typeof v === "string" && v.trim()) {
      try {
        push(JSON.parse(v));
      } catch {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
      }
      return;
    }
    if (Array.isArray(v)) v.forEach(push);
  };
  push(inner.targets);
  push(inner.take_profits);
  push(inner.takeProfits);
  push(inner.targets_json);
  push(extra);
  push(inner.take_profit);
  push(inner.tp1);
  push(inner.tp2);
  push(inner.tp3);
  return out.slice(0, 3);
}

export async function recommendationWithAutoChart(
  bridge: BridgeClient,
  recommendation: unknown,
  req: {
    symbol?: string;
    timeframe?: string;
    action?: string;
    take_profits?: unknown;
  },
): Promise<ChartInlineResponse> {
  const rec = (recommendation ?? {}) as Record<string, unknown>;
  const inner = (rec.recommendation ?? rec) as Record<string, unknown>;
  const symbol = String(inner.symbol ?? req.symbol ?? "").toUpperCase();
  const timeframe = String(inner.timeframe ?? req.timeframe ?? "1h");
  const action = String(
    inner.action ?? inner.side ?? inner.direction ?? req.action ?? "",
  ).toLowerCase();
  const takeProfits = collectCardTargets(inner, req.take_profits);
  if (action === "sell") takeProfits.sort((a, b) => b - a);
  else takeProfits.sort((a, b) => a - b);
  const rawConf = Number(inner.confidence);
  const confidence = Number.isFinite(rawConf)
    ? rawConf > 0 && rawConf <= 1
      ? Math.round(rawConf * 100)
      : rawConf
    : inner.confidence;
  const card = {
    id: inner.id ?? rec.id,
    symbol,
    action: action || undefined,
    side: action || inner.side,
    timeframe,
    entry: inner.entry ?? inner.entry_price,
    entry_low: inner.entry_low,
    entry_high: inner.entry_high,
    stop_loss: inner.stop_loss,
    take_profit: takeProfits[0] ?? inner.take_profit,
    take_profits: takeProfits,
    targets: takeProfits,
    confidence,
    plan_type: inner.plan_type,
    status: inner.status,
  };
  const meta: Record<string, unknown> = {
    ...(typeof recommendation === "object" && recommendation !== null
      ? (recommendation as Record<string, unknown>)
      : { result: recommendation }),
    recommendation_card: card,
    chart_auto_attached: true,
    presentation:
      "The host already shows recommendation-card. Do not wait to be asked. Paste display_markdown verbatim. Do not add lessons/jobs cards.",
  };

  if (symbol) {
    try {
      const snap = (await bridge.post(
        "/api/agent/chart/snapshot",
        { symbol, interval: timeframe, market: "forex", response_format: "json" },
        45_000,
      )) as ChartSnapshotBridgeResult;
      if (snap?.image_base64) {
        const delivered = await chartInlineContent(
          {
            ...meta,
            image_source: snap.image_source,
            ...snapshotHonestyMeta(snap),
          },
          snap.image_base64,
          {
            tool: "create_recommendation",
            symbol,
            timeframe,
          },
        );
        // A broken capture must not surface as a failed recommendation.
        if (!delivered.isError) return delivered;
      }
    } catch {
      /* fall through to the explicit no-image result */
    }
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            ...meta,
            chart_auto_attached: false,
            image_captured: false,
            note:
              "Recommendation CREATED successfully, but the automatic chart capture failed. Do NOT describe any chart image — present recommendation_card and offer capture_chart_snapshot as a retry.",
          },
          null,
          2,
        ),
      },
    ],
    structuredContent: {
      ...meta,
      chart_auto_attached: false,
      image_captured: false,
    },
  };
}

export { DRAW_CAPTURE_MAX_MS };
