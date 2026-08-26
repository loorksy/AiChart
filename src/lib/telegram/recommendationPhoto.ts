/**
 * The recommendation's chart, photographed with its own drawings.
 *
 * The platform draws every recommendation on the chart — entry line, stop
 * zone, profit zone, targets — while the same recommendation used to reach a
 * phone as text plus "no chart snapshot was captured". Same brain, one
 * surface with eyes and one without. This module closes that gap: after a
 * Telegram turn stores a plan, the plan's OWN drawings (the ones the web
 * chart renders, produced by the same drawing pipeline) ship to the shared
 * chart session and come back as a real TradingView capture.
 *
 * Two contracts carried over verbatim from the capture architecture:
 *
 *  1. **The pixels come from TradingView's client screenshot, or nowhere.**
 *     The operator's live tab first, else the chart-host container's hosted
 *     page — never a server-side redraw, never a stored substitute (a
 *     drawings-bearing request bypasses the moment-cache by design).
 *
 *  2. **Capability, not identity, picks the process** (the multi-snapshot
 *     delegation's rule): the chart-host rendezvous lives in the WEB
 *     process's memory, so a worker that holds no polling tab hands the
 *     request to the process that serves the app — through the same bridge
 *     route the MCP surface uses — instead of filing a capture request in a
 *     map the container will never read.
 *
 * Best-effort by contract: every failure is a named reason, the caller sends
 * the text answer regardless, and the whole attempt is bounded by the same
 * budget arithmetic (`captureBudgets`) every other capture obeys. A photo
 * must never block a recommendation.
 */
import { withTimeout } from "@/lib/agent/timeout";
import { bridgeUserSig } from "@/lib/agentAuth";
import { hasFreshPlatformTab } from "@/lib/chart/liveCapture";
import { captureBudgets } from "@/lib/chart/multiTimeframeCapture";
import { captureChartWithPlatformFallback } from "@/lib/chart/platformCapture";
import { createLogger } from "@/lib/logger";
import { getPublicUser } from "@/lib/store";

const log = createLogger("telegram.recPhoto");

/** Per-render budget for the one drawn frame. */
const PHOTO_RENDER_MS = 15_000;
/**
 * Hard ceiling on the whole attempt (delegation hop, a cold chart-host tab's
 * warmup, the render). Past it the recommendation ships as text — the answer
 * is already computed and must not wait on a photograph of itself.
 */
export const PHOTO_TOTAL_BUDGET_MS = 30_000;

export type RecommendationPhoto =
  | { ok: true; image: Buffer; zoom: Buffer | null }
  | { ok: false; reason: string };

/** Injectable seams so tests run without a bot, a browser, or a container. */
export interface RecommendationPhotoDeps {
  hasLocalTab?: typeof hasFreshPlatformTab;
  captureLocally?: typeof captureChartWithPlatformFallback;
  fetchImpl?: typeof fetch;
  lookupUser?: typeof getPublicUser;
}

export interface RecommendationPhotoInput {
  userId: number;
  symbol: string;
  interval: string;
  /** The recommendation's own drawings — the ones the web chart renders. */
  drawings: Record<string, unknown>[];
}

function toPhoto(captured: {
  image_base64: string;
  images: { label: string; image_base64: string }[];
}): RecommendationPhoto {
  const zoom = captured.images.find((shot) => shot.label === "zoom");
  return {
    ok: true,
    image: Buffer.from(captured.image_base64, "base64"),
    zoom: zoom ? Buffer.from(zoom.image_base64, "base64") : null,
  };
}

/**
 * Hand the capture to the web process — the one the chart-host tab polls —
 * through the same authenticated bridge route the MCP snapshot uses, with the
 * recommendation's drawings riding in the body. Returns null when the
 * delegation is not wired (no bridge URL/token, no resolvable user): that is
 * a topology fact, not a capture failure, and the local path still gets its
 * chance (in a single-process deployment the local path IS the web process).
 */
async function delegateToWebProcess(
  input: RecommendationPhotoInput,
  budget: { timeoutMs: number },
  deps: RecommendationPhotoDeps,
): Promise<RecommendationPhoto | null> {
  const baseUrl = process.env.AICHART_API_URL?.trim().replace(/\/$/, "");
  const token = process.env.AICHART_SERVICE_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  const user = await (deps.lookupUser ?? getPublicUser)(input.userId).catch(() => null);
  const sig = user?.email ? bridgeUserSig(user.email) : null;
  if (!user?.email || !sig) return null;

  try {
    const res = await (deps.fetchImpl ?? fetch)(`${baseUrl}/api/agent/chart/snapshot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-token": token,
        "x-aichart-user-email": user.email,
        "x-aichart-user-sig": sig,
      },
      body: JSON.stringify({
        symbol: input.symbol,
        interval: input.interval,
        response_format: "json",
        live_session: false,
        include_drawings: true,
        drawings: input.drawings,
      }),
      signal: AbortSignal.timeout(budget.timeoutMs + 5_000),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; image_base64?: string; images?: { label: string; image_base64: string }[]; reason?: string }
      | null;
    if (res.ok && json?.ok && json.image_base64) {
      return toPhoto({ image_base64: json.image_base64, images: json.images ?? [] });
    }
    // The route answered with a NAMED failure: that is the capture's real
    // outcome, not a wiring fault — repeating it locally would spend the
    // budget twice to reach the same empty result.
    if (json?.reason) return { ok: false, reason: json.reason };
    log.warn("photo.delegate.rejected", { status: res.status });
    return { ok: false, reason: `delegate_http_${res.status}` };
  } catch (error) {
    log.warn("photo.delegate.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null; // dead socket / refused route — the local path may survive it
  }
}

/**
 * One drawn chart for one recommendation, or a named refusal. Never throws,
 * never exceeds `PHOTO_TOTAL_BUDGET_MS`, never returns an image from any
 * source other than a real TradingView client capture.
 */
export async function captureRecommendationPhoto(
  input: RecommendationPhotoInput,
  deps: RecommendationPhotoDeps = {},
): Promise<RecommendationPhoto> {
  if (!input.drawings.length) return { ok: false, reason: "no_drawings" };
  const budget = captureBudgets(PHOTO_RENDER_MS, 1);

  const attempt = async (): Promise<RecommendationPhoto> => {
    // Capability rule: a process without a polling tab delegates to the one
    // that has it; a process WITH one captures here, drawings and all.
    if (!(deps.hasLocalTab ?? hasFreshPlatformTab)()) {
      const delegated = await delegateToWebProcess(input, budget, deps);
      if (delegated) return delegated;
    }
    const captured = await (deps.captureLocally ?? captureChartWithPlatformFallback)({
      userId: input.userId,
      symbol: input.symbol,
      interval: input.interval,
      market: "forex",
      liveSession: false,
      includeDrawings: true,
      platformDrawings: input.drawings,
      ackTimeoutMs: budget.ackTimeoutMs,
      uploadTimeoutMs: budget.timeoutMs,
    });
    return captured.ok ? toPhoto(captured) : { ok: false, reason: captured.reason };
  };

  // The attempt is made unrejectable BEFORE the race: withTimeout leaves the
  // losing promise running, and a late rejection from an orphaned capture
  // would otherwise surface as an unhandled rejection long after the answer.
  const safeAttempt = attempt().catch((error): RecommendationPhoto => {
    log.warn("photo.capture.threw", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "capture_failed" };
  });
  const result = await withTimeout<RecommendationPhoto>(
    safeAttempt,
    PHOTO_TOTAL_BUDGET_MS,
    { ok: false, reason: "photo_budget_exhausted" },
  );
  if (!result.ok) {
    log.warn("photo.capture.failed", { reason: result.reason, symbol: input.symbol });
  }
  return result;
}
