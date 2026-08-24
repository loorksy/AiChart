/**
 * Chart images for the decision engine.
 *
 * The MCP agent has always looked at real charts while the platform's engine
 * read a JSON summary of the same market. Two ways of seeing produce two
 * answers, and the whole premise is one mind on both surfaces — so this fetches
 * the same multi-timeframe capture the MCP tool uses and hands it to the
 * decision call in the same interleaved form.
 *
 * Best-effort by contract. TradingView's client screenshot is the ONLY
 * accepted image source — the operator's own tab when one is polling, else
 * the platform's shared chart session (chart-host container), whose page
 * runs the same takeClientScreenshot. Unattended runs (Telegram, cron,
 * worker) therefore get REAL charts whenever the chart session is up; when
 * neither tab exists there is still NO image — no rendered substitute, no
 * stored snapshot — the frames are reported missing and the analysis
 * proceeds on numbers alone, publishing normally. A missing view degrades
 * the read rather than killing the analysis.
 *
 * The degradation is only honest if it is STATED. This module returns what was
 * requested alongside what arrived, so "I did not see the 4h" reaches the model
 * as a fact rather than as an absence it would have to infer — an inference it
 * cannot make, since nothing else tells it which frames were ever asked for.
 */
import { captureMultiTimeframeSnapshot } from "@/lib/chart/multiTimeframeCapture";
import { hasFreshPlatformTab } from "@/lib/chart/liveCapture";
import { bridgeUserSig } from "@/lib/agentAuth";
import { getPublicUser } from "@/lib/store";
import { createLogger } from "@/lib/logger";
import type { VisualSnapshot } from "./agents/finalDecisionSynthesizer";

const log = createLogger("visual-evidence");

type CaptureResult = Awaited<ReturnType<typeof captureMultiTimeframeSnapshot>>;

/**
 * Capture the frames in the process that can actually answer.
 *
 * The chart-host rendezvous is module state: `platformPending` (where a
 * capture request waits to be collected) and `platformTabAt` (what
 * `hasFreshPlatformTab` reads) both live in memory in `chart/liveCapture.ts`,
 * and only the HTTP route `/api/chart/host-capture` writes to them. That route
 * is served by the WEB process — but an analysis runs in the WORKER, reached
 * through the Redis turn queue. Two Node processes, two private copies of that
 * map and that timestamp.
 *
 * So a capture requested by an analysis was filed in the worker's map, the
 * container polled the web process whose map was empty, the request was never
 * collected, and the worker's tab timestamp was never touched — leaving
 * `hasFreshPlatformTab()` permanently false, `ensureChartHostTab` burning its
 * full 25s warmup, and every frame returning `capture_timeout`. Every
 * analysis said "لم تتوفر أي لقطة شارت" while the very same capture through
 * MCP — which reaches the app over the bridge, i.e. the web process — took
 * 6.2s and returned three real TradingView frames.
 *
 * The rule is therefore capability, not identity: if THIS process holds a
 * live tab, capture here. If it does not, hand the work to the process that
 * serves the app, which is where the tab is. No recursion is possible — the
 * route calls `captureMultiTimeframeSnapshot` directly, never this function.
 */
async function captureWhereTheTabLives(
  userId: number,
  body: {
    symbol: string;
    timeframes: string[];
    maxImages: number;
    imageTimeoutMs: number;
    layoutId?: string;
    liveSession: boolean;
  },
): Promise<CaptureResult> {
  const local = () =>
    captureMultiTimeframeSnapshot(userId, {
      symbol: body.symbol,
      timeframes: body.timeframes,
      maxImages: body.maxImages,
      imageTimeoutMs: body.imageTimeoutMs,
      includeNumericContext: true,
      layoutId: body.layoutId,
      liveSession: body.liveSession,
    });

  // This process owns a polling tab — the fast path, unchanged.
  if (hasFreshPlatformTab()) return local();

  const baseUrl = process.env.AICHART_API_URL?.trim().replace(/\/$/, "");
  if (!baseUrl) return local();

  const user = await getPublicUser(userId).catch(() => null);
  const sig = user?.email ? bridgeUserSig(user.email) : null;
  const token = process.env.AICHART_SERVICE_TOKEN?.trim();
  if (!user?.email || !sig || !token) return local();

  try {
    const res = await fetch(`${baseUrl}/api/agent/chart/multi-snapshot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-token": token,
        "x-aichart-user-email": user.email,
        "x-aichart-user-sig": sig,
      },
      body: JSON.stringify({
        symbol: body.symbol,
        timeframes: body.timeframes,
        max_images: body.maxImages,
        image_timeout_ms: body.imageTimeoutMs,
        include_numeric_context: true,
        layout_id: body.layoutId,
        live_session: body.liveSession,
      }),
      signal: AbortSignal.timeout(body.imageTimeoutMs + 2_000),
    });
    if (!res.ok) {
      log.warn("visual.delegate.rejected", { status: res.status });
      return local();
    }
    const json = (await res.json()) as CaptureResult & { data?: CaptureResult };
    // Newer routes wrap payloads as {ok, data, meta}; older ones return bare.
    return json && typeof json === "object" && json.data ? json.data : json;
  } catch (error) {
    log.warn("visual.delegate.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return local();
  }
}

/**
 * Which timeframes to show, given the one being analysed.
 *
 * A scalp needs its own frame plus the two above it — enough to see where the
 * entry sits inside the structure that governs it, without spending the budget
 * on charts nobody will weigh.
 */
export function visualTimeframesFor(interval: string): string[] {
  const tf = (interval ?? "").toLowerCase().trim();
  switch (tf) {
    case "5m":
      return ["5m", "15m", "1h"];
    case "15m":
      return ["15m", "1h", "4h"];
    case "1h":
      return ["1h", "4h", "1d"];
    case "4h":
      return ["4h", "1d"];
    default:
      // The analysis frames are 5m/15m/1h/4h (lib/gold.ts). Anything else is a
      // caller mistake rather than a frame to invent a ladder for, so it gets
      // the default intraday context instead of a silently different one.
      return ["15m", "1h", "4h"];
  }
}

export interface VisualEvidenceResult {
  snapshots: VisualSnapshot[];
  /** Every frame this run asked for, in order — the denominator for coverage. */
  requested: string[];
  /** Views we asked for and did not get — reported, never implied away. */
  missing: { timeframe: string; reason: string }[];
  /**
   * True ONLY when at least one snapshot came from TradingView's client
   * capture WITH the drawings actually rendered — the sole basis on which
   * `visual_confirmation` may ever read `confirmed`. Everything else is
   * `not_checked`, including every browserless run.
   */
  visuallyVerified: boolean;
  elapsedMs: number;
}

/**
 * What the model is TOLD about its own eyes.
 *
 * Absence is not self-describing: a prompt carrying two images cannot tell the
 * model whether a third was never requested, or was requested and failed. The
 * difference matters to the read, so it is stated in words.
 */
export function visualCoverageNote(result: VisualEvidenceResult): string | null {
  if (result.requested.length === 0) return null;
  const captured = result.snapshots.map((snapshot) => snapshot.timeframe);
  if (result.missing.length === 0) {
    return `Charts reviewed: ${captured.join(", ")}. No requested view is missing.`;
  }
  const missing = result.missing
    .map((item) => `${item.timeframe} (${item.reason})`)
    .join(", ");
  return captured.length === 0
    ? `NO chart was available this run — every requested view failed: ${missing}. ` +
        `You are reading numbers alone; say so rather than describing candles you did not see.`
    : `Charts reviewed: ${captured.join(", ")}. NOT available: ${missing}. ` +
        `Do not describe price action on a view you were not shown.`;
}

/**
 * Capture the charts for one analysis.
 *
 * Never throws: an outright failure returns empty evidence and the decision
 * proceeds on numbers alone, exactly as it did before this existed.
 */
export async function collectVisualEvidence(input: {
  userId?: number;
  symbol: string;
  interval: string;
  maxImages?: number;
  timeoutMs?: number;
  /** Override the default timeframe set — used by the extra-frame round. */
  timeframes?: string[];
  layoutId?: string;
  /**
   * True only when a live chart tab may answer. Cron/Telegram/worker leave
   * this false so they never wait on a browser that is not there.
   */
  liveSession?: boolean;
}): Promise<VisualEvidenceResult> {
  const startedAt = Date.now();
  const requested = input.timeframes ?? visualTimeframesFor(input.interval);
  if (input.userId == null) {
    // An unscoped run has no layout to render, so it is not a capture failure —
    // nothing was ever requested, and reporting frames as "missing" would tell
    // the model its eyes failed when they were never opened.
    return { snapshots: [], requested: [], missing: [], visuallyVerified: false, elapsedMs: 0 };
  }

  try {
    const result = await captureWhereTheTabLives(input.userId, {
      symbol: input.symbol,
      timeframes: requested,
      maxImages: input.maxImages ?? 3,
      imageTimeoutMs: input.timeoutMs ?? 9_000,
      layoutId: input.layoutId,
      liveSession: input.liveSession === true,
    });

    const snapshots: VisualSnapshot[] = result.snapshots
      .filter((snapshot) => Boolean(snapshot.image_base64))
      .map((snapshot) => ({
        timeframe: snapshot.timeframe,
        imageBase64: snapshot.image_base64,
        zoomImageBase64: snapshot.images.find((image) => image.label === "zoom")
          ?.image_base64,
        numericContext: snapshot.numeric_context,
      }));
    // The only path to "confirmed": TradingView's own client capture with
    // the drawings actually in the frame. drawings_included is measured at
    // capture time, never assumed.
    const visuallyVerified = result.snapshots.some(
      (snapshot) =>
        snapshot.image_source === "tradingview_capture" &&
        snapshot.drawings_included === true,
    );

    log.debug("visual.captured", {
      symbol: input.symbol,
      captured: snapshots.length,
      missing: result.missing_timeframes.length,
      visuallyVerified,
      elapsedMs: result.elapsed_ms,
    });

    return {
      snapshots,
      requested,
      missing: result.missing_timeframes,
      visuallyVerified,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    log.warn("visual.capture.failed", {
      symbol: input.symbol,
      error: error instanceof Error ? error.name : "unknown",
    });
    // A thrown capture is a total blackout, and every requested frame is
    // genuinely missing. Returning an empty `missing` list here is what made a
    // blind run indistinguishable from a run that asked for nothing.
    return {
      snapshots: [],
      requested,
      missing: requested.map((timeframe) => ({
        timeframe,
        reason: "capture_failed",
      })),
      visuallyVerified: false,
      elapsedMs: Date.now() - startedAt,
    };
  }
}
