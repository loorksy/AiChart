/**
 * Dual Vision sources for model-first analysis.
 * Neutral charts: QuickChart from snapshot candles — no recommendation overlays.
 * User-context: optional, labeled, only when drawings are required.
 */
import {
  buildChartSnapshotBufferForMarket,
  bufferToChatImage,
} from "@/lib/chartSnapshot";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { ChatImagePayload } from "@/lib/chatImage";
import type { MarketSnapshot } from "./marketSnapshot";
import { assertSnapshotImageFreshness } from "./marketSnapshot";
import type { ResponsesImageInput } from "./openaiResponses";

export type VisionImageMeta = {
  symbol: string;
  timeframe: string;
  role: "primary" | "context" | "user_context";
  captureTimestamp: number;
  candleCloseTimestamp: number | null;
  bid: number | null;
  ask: number | null;
  drawingsIncluded: boolean;
  recommendationOverlaysExcluded: boolean;
  label: string;
};

export type CapturedVisionImage = {
  meta: VisionImageMeta;
  image: ChatImagePayload;
  responsesInput: ResponsesImageInput;
};

const TEMP_CAPTURE_TTL_MS = 10 * 60 * 1000;
const tempCaptures = new Map<string, { at: number; bytes: number }>();

function rememberTempCapture(key: string, bytes: number) {
  tempCaptures.set(key, { at: Date.now(), bytes });
  for (const [k, v] of tempCaptures) {
    if (Date.now() - v.at > TEMP_CAPTURE_TTL_MS) tempCaptures.delete(k);
  }
}

export function getTempCaptureRetentionMs(): number {
  return TEMP_CAPTURE_TTL_MS;
}

/** Capture clean multi-TF charts. Never uses MT5. Never attaches recommendation overlays. */
export async function captureNeutralDecisionCharts(input: {
  userId: number;
  snapshot: MarketSnapshot;
  market?: "forex";
  maxImages?: number;
}): Promise<{
  images: CapturedVisionImage[];
  captureTimestamps: Record<string, number>;
  failures: string[];
}> {
  const maxImages = Math.min(input.maxImages ?? 4, 4);
  const timeframes = [
    input.snapshot.primaryTimeframe,
    ...input.snapshot.scope.contextTimeframes,
  ].slice(0, maxImages);

  const images: CapturedVisionImage[] = [];
  const captureTimestamps: Record<string, number> = {};
  const failures: string[] = [];

  const market = input.market ?? "forex";
  for (const tf of timeframes) {
    try {
      const buffer = await buildChartSnapshotBufferForMarket(
        input.userId,
        input.snapshot.symbol,
        tf,
        market,
        {
          // Explicitly omit overlays / drawings — neutral decision image.
          limit: 80,
          overlays: [],
          drawings: [],
        },
      );
      if (!buffer || buffer.length < 200) {
        failures.push(`blank_or_small_${tf}`);
        continue;
      }
      const chatImage = bufferToChatImage(buffer);
      if (!chatImage) {
        failures.push(`invalid_png_${tf}`);
        continue;
      }
      const captureTimestamp = Date.now();
      captureTimestamps[tf] = captureTimestamp;
      rememberTempCapture(`${input.snapshot.snapshotId}:${tf}`, buffer.length);
      const role = tf === input.snapshot.primaryTimeframe ? "primary" : "context";
      const meta: VisionImageMeta = {
        symbol: input.snapshot.symbol,
        timeframe: tf,
        role,
        captureTimestamp,
        candleCloseTimestamp: input.snapshot.candleCloseTimes[tf] ?? null,
        bid: input.snapshot.bid,
        ask: input.snapshot.ask,
        drawingsIncluded: false,
        recommendationOverlaysExcluded: true,
        label: `Neutral decision chart ${input.snapshot.symbol} ${tf}`,
      };
      images.push({
        meta,
        image: chatImage,
        responsesInput: {
          mediaType: chatImage.media_type as ResponsesImageInput["mediaType"],
          base64: chatImage.data,
          detail: role === "primary" ? "high" : "auto",
        },
      });
    } catch {
      failures.push(`capture_failed_${tf}`);
    }
  }

  const freshness = assertSnapshotImageFreshness(input.snapshot, captureTimestamps);
  if (!freshness.ok) {
    failures.push(freshness.reason);
  }

  return { images, captureTimestamps, failures };
}

/** Optional user-annotated chart — labeled as context, not market truth. */
export async function captureUserContextChart(input: {
  userId: number;
  snapshot: MarketSnapshot;
  market?: "forex";
  drawings: ChartDrawing[];
}): Promise<CapturedVisionImage | null> {
  if (!input.drawings.length) return null;
  const tf = input.snapshot.primaryTimeframe;
  const buffer = await buildChartSnapshotBufferForMarket(
    input.userId,
    input.snapshot.symbol,
    tf,
    input.market ?? "forex",
    {
      limit: 80,
      overlays: [],
      drawings: input.drawings,
    },
  );
  if (!buffer) return null;
  const chatImage = bufferToChatImage(buffer);
  if (!chatImage) return null;
  const captureTimestamp = Date.now();
  rememberTempCapture(`${input.snapshot.snapshotId}:user_context`, buffer.length);
  const meta: VisionImageMeta = {
    symbol: input.snapshot.symbol,
    timeframe: tf,
    role: "user_context",
    captureTimestamp,
    candleCloseTimestamp: input.snapshot.candleCloseTimes[tf] ?? null,
    bid: input.snapshot.bid,
    ask: input.snapshot.ask,
    drawingsIncluded: true,
    recommendationOverlaysExcluded: true,
    label: "User-annotated chart context (not verified market truth)",
  };
  return {
    meta,
    image: chatImage,
    responsesInput: {
      mediaType: chatImage.media_type as ResponsesImageInput["mediaType"],
      base64: chatImage.data,
      detail: "high",
    },
  };
}

export function needsUserContextVision(intent: string | undefined): boolean {
  if (!intent) return false;
  return (
    intent === "analyze_with_user_drawings" ||
    intent === "discuss_user_drawing" ||
    intent === "explain_chart_drawings" ||
    intent === "explain_active_recommendation" ||
    intent === "modify_active_recommendation"
  );
}
