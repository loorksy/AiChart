/**
 * GeometrySnapshot → ChartDrawing[] and compact evidence summaries.
 *
 * The drawing side feeds the ONE render pipeline (processAgentDrawings → TV
 * adapter / PNG / MT5), so a detected triangle becomes a native editable TV
 * pattern, the same polyline on the PNG, and the same segments on MT5. The
 * summary side feeds the decision synthesizer and the MCP numeric context —
 * text, prices, and states, never pixels.
 */
import type { ChartDrawing } from "@/lib/chartDrawings";
import { PATTERN_TYPE_LABELS } from "@/lib/chart/chartTerminology";
import type {
  ChannelGeometry,
  GeometrySnapshot,
  PatternInstance,
  PatternStatus,
  TrendlineGeometry,
} from "./types";

const STATUS_LABEL_AR: Record<PatternStatus, string> = {
  forming: "(قيد التكوّن)",
  completed: "(مكتمل)",
  invalidated: "(مُبطل)",
};

const STATUS_LABEL_EN: Record<PatternStatus, string> = {
  forming: "forming",
  completed: "completed",
  invalidated: "invalidated",
};

function trendlineDrawing(line: TrendlineGeometry): ChartDrawing {
  return {
    type: "trend_line",
    confidence: line.confidence,
    label: line.side === "support" ? "خط اتجاه داعم" : "خط اتجاه مقاوم",
    semanticRole: "trendline",
    color: line.side === "support" ? "#22c55e" : "#ef4444",
    anchorMode: "time_price",
    points: line.anchors.map((anchor) => ({
      time: anchor.time,
      price: anchor.price,
    })),
    meta: {
      geometry: "trendline",
      side: line.side,
      touches: line.touches,
      slope: line.slope,
      priceAtLastBar: line.priceAtLastBar,
      evidence: line.evidence,
    },
  };
}

function channelDrawingOf(channel: ChannelGeometry): ChartDrawing {
  const [a, b] = channel.base.anchors;
  const [pa, pb] = channel.parallel;
  return {
    type: "parallel_channel",
    confidence: channel.confidence,
    label:
      channel.direction === "rising"
        ? "قناة صاعدة"
        : channel.direction === "falling"
          ? "قناة هابطة"
          : "قناة أفقية",
    semanticRole: "channel",
    patternType: "channel",
    anchorMode: "time_price",
    points: [
      { time: a.time, price: a.price },
      { time: b.time, price: b.price },
      { time: pa.time, price: pa.price },
      { time: pb.time, price: pb.price },
    ],
    meta: {
      geometry: "channel",
      direction: channel.direction,
      widthAtr: channel.widthAtr,
      oppositeTouches: channel.oppositeTouches,
    },
  };
}

/**
 * TradingView's head_and_shoulders tool wants 7 points (lead-in, LS, trough,
 * head, trough, RS, exit). The engine's 5 anchors gain synthetic lead-in and
 * exit points at the neckline so the native tool renders instead of the
 * generic polyline fallback.
 */
function patternPoints(pattern: PatternInstance): Array<{ time: number; price: number }> {
  const points = pattern.anchors.map((anchor) => ({
    time: anchor.time,
    price: anchor.price,
  }));
  const isHs =
    pattern.patternType === "head_and_shoulders" ||
    pattern.patternType === "inverse_head_and_shoulders";
  if (isHs && points.length === 5 && pattern.neckline) {
    const first = pattern.anchors[0]!;
    const last = pattern.anchors[pattern.anchors.length - 1]!;
    const span = Math.max(1, last.time - first.time);
    const lead = {
      time: first.time - Math.round(span * 0.08),
      price: pattern.neckline.from.price,
    };
    const exit = {
      time: last.time + Math.round(span * 0.08),
      price: pattern.neckline.to.price,
    };
    return [lead, ...points, exit];
  }
  return points;
}

function patternDrawings(pattern: PatternInstance): ChartDrawing[] {
  const label = `${PATTERN_TYPE_LABELS[pattern.patternType]} ${STATUS_LABEL_AR[pattern.status]}`;
  const out: ChartDrawing[] = [
    {
      type: "polyline_pattern",
      confidence: pattern.confidence,
      label,
      semanticRole: "pattern",
      patternType: pattern.patternType,
      anchorMode: "time_price",
      style: pattern.status === "forming" ? "dashed" : "solid",
      points: patternPoints(pattern),
      meta: {
        geometry: "pattern",
        patternStatus: pattern.status,
        breakDirection: pattern.breakDirection ?? null,
        projectedTarget: pattern.projectedTarget ?? null,
        evidence: pattern.evidence,
      },
    },
  ];
  if (pattern.neckline) {
    out.push({
      type: "neckline",
      confidence: pattern.confidence,
      label: "خط العنق",
      semanticRole: "neckline",
      anchorMode: "time_price",
      style: "dashed",
      points: [
        { time: pattern.neckline.from.time, price: pattern.neckline.from.price },
        { time: pattern.neckline.to.time, price: pattern.neckline.to.price },
      ],
      meta: { geometry: "neckline", patternType: pattern.patternType },
    });
  }
  return out;
}

/** Bounded drawing set for the render pipeline (caller caps totals further). */
export function geometryToDrawings(snapshot: GeometrySnapshot): ChartDrawing[] {
  const out: ChartDrawing[] = [];
  for (const line of snapshot.trendlines) out.push(trendlineDrawing(line));
  for (const channel of snapshot.channels) out.push(channelDrawingOf(channel));
  for (const pattern of snapshot.patterns) out.push(...patternDrawings(pattern));
  return out;
}

export interface GeometryPatternSummary {
  pattern: string;
  pattern_ar: string;
  status: PatternStatus;
  break_direction: "up" | "down" | null;
  projected_target: number | null;
  confidence: number;
}

export interface GeometrySummary {
  trendlines: Array<{
    side: "support" | "resistance";
    price_at_last_bar: number;
    touches: number;
    slope_sign: "rising" | "falling" | "flat";
    confidence: number;
  }>;
  channel: {
    direction: "rising" | "falling" | "horizontal";
    width_atr: number;
    confidence: number;
  } | null;
  patterns: GeometryPatternSummary[];
}

/**
 * Numbers-and-states digest for the synthesizer and MCP numeric_context.
 * Every price here comes from the deterministic engine — the "images confirm
 * shape only" guardrail keeps holding because the numeric side is this.
 */
export function summarizeGeometry(snapshot: GeometrySnapshot): GeometrySummary {
  return {
    trendlines: snapshot.trendlines.map((line) => ({
      side: line.side,
      price_at_last_bar: Number(line.priceAtLastBar.toFixed(6)),
      touches: line.touches,
      slope_sign:
        Math.abs(line.slope) < snapshot.atr * 0.03
          ? "flat"
          : line.slope > 0
            ? "rising"
            : "falling",
      confidence: line.confidence,
    })),
    channel: snapshot.channels[0]
      ? {
          direction: snapshot.channels[0].direction,
          width_atr: Number(snapshot.channels[0].widthAtr.toFixed(2)),
          confidence: snapshot.channels[0].confidence,
        }
      : null,
    patterns: snapshot.patterns.map((pattern) => ({
      pattern: pattern.patternType,
      pattern_ar: PATTERN_TYPE_LABELS[pattern.patternType],
      status: pattern.status,
      break_direction: pattern.breakDirection ?? null,
      projected_target:
        pattern.projectedTarget != null
          ? Number(pattern.projectedTarget.toFixed(6))
          : null,
      confidence: pattern.confidence,
    })),
  };
}

/** English one-liners for model-facing evidence blocks. */
export function geometryEvidenceLines(snapshot: GeometrySnapshot): string[] {
  const lines: string[] = [];
  for (const line of snapshot.trendlines) {
    lines.push(
      `${line.side} trendline at ~${line.priceAtLastBar.toFixed(5)} (${line.touches} touches, conf ${line.confidence})`,
    );
  }
  const channel = snapshot.channels[0];
  if (channel) {
    lines.push(
      `${channel.direction} channel, width ${channel.widthAtr.toFixed(1)} ATR (conf ${channel.confidence})`,
    );
  }
  for (const pattern of snapshot.patterns) {
    const target =
      pattern.projectedTarget != null
        ? `, target ~${pattern.projectedTarget.toFixed(5)}`
        : "";
    // The stage and how far along the shape is travel with the pattern: a
    // structure pressing its boundary is a different opportunity from one that
    // has barely started, and both used to read as simply "forming".
    const stage =
      pattern.stage != null
        ? `, stage ${pattern.stage}${
            pattern.completionRatio != null
              ? ` (${Math.round(pattern.completionRatio * 100)}% formed)`
              : ""
          }`
        : "";
    lines.push(
      `${pattern.patternType} ${STATUS_LABEL_EN[pattern.status]}${pattern.breakDirection ? ` (${pattern.breakDirection} break)` : ""}${target}${stage} (conf ${pattern.confidence})`,
    );
  }
  for (const signal of snapshot.candlesticks ?? []) {
    lines.push(
      `candlestick ${signal.name} (${signal.bias}, strength ${signal.strength}, ${signal.bars} bar${signal.bars > 1 ? "s" : ""})`,
    );
  }
  return lines;
}
