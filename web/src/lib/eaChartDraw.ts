import fs from "fs";
import path from "path";
import type { ChartDrawing } from "./chartDrawings";
import { DB_PATH } from "./env";
import { queryOne } from "./db";
import {
  createEaCommand,
  getEaConnectionMeta,
  EA_COMMAND_TTL_MS,
} from "./eaStore";
import { resolveMt5Symbol } from "./mt5SymbolMap";
import type { EaCommand, EaDrawAndCapturePayload } from "./types";

const DRAW_CAPTURE_TTL_MS = 120_000;

function dataRoot(): string {
  const dir = path.dirname(DB_PATH);
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

/** Filesystem path for an EA-captured chart PNG. */
export function eaChartPngPath(userId: number, captureKey: string): string {
  return path.join(dataRoot(), "charts", "ea", String(userId), `${captureKey}.png`);
}

export function captureKeyForRecommendation(recId: number): string {
  return String(recId);
}

/** Agent poll URL for MT5-native chart screenshots. */
export function mt5ChartUrl(recId: number | string): string {
  return `/api/agent/chart/${recId}/mt5`;
}

export function isEaChartFileReady(userId: number, captureKey: string): boolean {
  try {
    return fs.existsSync(eaChartPngPath(userId, captureKey));
  } catch {
    return false;
  }
}

export async function readEaChartPng(
  userId: number,
  captureKey: string,
): Promise<Buffer | null> {
  const filePath = eaChartPngPath(userId, captureKey);
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

export async function writeEaChartPng(
  userId: number,
  captureKey: string,
  data: Buffer,
): Promise<string> {
  const filePath = eaChartPngPath(userId, captureKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
  return filePath;
}

export interface Mt5ChartCaptureInput {
  recommendationId?: number;
  captureKey?: string;
  symbol: string;
  interval: string;
  drawings: ChartDrawing[];
  entry?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
}

export interface Mt5ChartCaptureResult {
  queued: boolean;
  mt5Symbol?: string;
  chartUrl?: string;
  captureKey?: string;
  reason?: string;
}

/** True when the EA heartbeat is fresh enough to accept draw commands. */
export async function isEaOnline(userId: number): Promise<boolean> {
  const meta = await getEaConnectionMeta(userId);
  return meta?.online ?? false;
}

/** Whether MT5 native chart capture is available for this symbol. */
export async function canUseMt5ChartCapture(
  userId: number,
  symbol: string,
): Promise<{ ok: boolean; mt5Symbol?: string; reason?: string }> {
  if (!(await isEaOnline(userId))) {
    return { ok: false, reason: "ea_offline" };
  }
  const mt5Symbol = await resolveMt5Symbol(userId, symbol);
  if (!mt5Symbol) {
    return { ok: false, reason: "symbol_unavailable_on_mt5" };
  }
  return { ok: true, mt5Symbol };
}

/**
 * Semantic drawing types → MT5-native types AiChartBridge.mq5 already renders.
 *
 * The EA's ResolveDrawingType knows the legacy semantic set (price_line, zone,
 * channel, fib_retracement…) but prints "unsupported" and SKIPS the newer
 * semantic types (supply_zone, parallel_channel, neckline, polyline_pattern,
 * positions). Mapping server-side means richer MT5 captures with NO EA
 * recompile — the user would otherwise have to rebuild + reattach manually.
 */
const MT5_TYPE_MAP: Record<string, string> = {
  supply_zone: "rectangle",
  demand_zone: "rectangle",
  decision_zone: "rectangle",
  retest_zone: "rectangle",
  range_box: "rectangle",
  risk_reward_box: "rectangle",
  parallel_channel: "channel",
  regression_trend: "channel",
  neckline: "trendline",
  polyline_pattern: "trend_path",
  pattern_label: "text",
  labeled_arrow: "arrow",
  breakout_arrow: "arrow_up",
};

export function mapDrawingsForMt5(drawings: ChartDrawing[]): ChartDrawing[] {
  return drawings.flatMap((d) => {
    // Positions expand into their level lines (the EA has no position tool).
    if (d.type === "long_position" || d.type === "short_position") {
      const meta = (d.meta ?? {}) as Record<string, unknown>;
      const out: ChartDrawing[] = [];
      const push = (price: unknown, label: string, color: string) => {
        if (typeof price === "number" && Number.isFinite(price)) {
          out.push({
            type: "hline" as ChartDrawing["type"],
            confidence: d.confidence,
            label,
            color,
            points: [{ price }],
          });
        }
      };
      push(meta.entry ?? d.points[0]?.price, "دخول", "#3b82f6");
      push(meta.stopLoss ?? d.points[2]?.price, "SL", "#ef4444");
      push(meta.takeProfit ?? d.points[1]?.price, "TP", "#22c55e");
      return out;
    }
    const mapped = MT5_TYPE_MAP[d.type];
    return [mapped ? ({ ...d, type: mapped as ChartDrawing["type"] }) : d];
  });
}

/** Queue a draw_and_capture command for the connected EA. */
export async function queueMt5ChartCapture(
  userId: number,
  input: Mt5ChartCaptureInput,
): Promise<Mt5ChartCaptureResult> {
  const check = await canUseMt5ChartCapture(userId, input.symbol);
  if (!check.ok || !check.mt5Symbol) {
    return { queued: false, reason: check.reason };
  }

  const captureKey =
    input.captureKey ??
    (input.recommendationId != null
      ? captureKeyForRecommendation(input.recommendationId)
      : `snap_${Date.now()}`);

  const payload: EaDrawAndCapturePayload = {
    symbol: check.mt5Symbol,
    interval: input.interval,
    recommendation_id: input.recommendationId ?? 0,
    capture_key: captureKey,
    entry: input.entry ?? null,
    stop_loss: input.stop_loss ?? null,
    take_profit: input.take_profit ?? null,
    drawings: mapDrawingsForMt5(input.drawings),
  };

  await createEaCommand(userId, {
    command_type: "draw_and_capture",
    payload,
    ttlMs: DRAW_CAPTURE_TTL_MS,
  });

  const chartUrl = mt5ChartUrl(
    input.recommendationId ?? captureKey,
  );

  return {
    queued: true,
    mt5Symbol: check.mt5Symbol,
    chartUrl,
    captureKey,
  };
}

/** Latest in-flight draw_and_capture for a recommendation or capture key. */
export async function getPendingChartCapture(
  userId: number,
  captureKey: string,
): Promise<EaCommand | null> {
  const needle = captureKey;
  return queryOne<EaCommand>(
    `SELECT * FROM ea_commands
     WHERE user_id = ? AND command_type = 'draw_and_capture'
       AND status IN ('pending', 'sent')
       AND payload_json LIKE ?
     ORDER BY id DESC LIMIT 1`,
    [userId, `%${needle}%`],
  );
}

export { EA_COMMAND_TTL_MS, DRAW_CAPTURE_TTL_MS };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PollMt5ChartOptions {
  maxMs?: number;
  intervalMs?: number;
}

export interface PollMt5ChartResult {
  ok: boolean;
  buffer?: Buffer;
  status: "ready" | "timeout" | "offline";
  retryAfterMs?: number;
}

/** Poll local EA chart PNG until ready or timeout (web-side helper). */
export async function pollMt5ChartPng(
  userId: number,
  captureKey: string,
  options: PollMt5ChartOptions = {},
): Promise<PollMt5ChartResult> {
  const maxMs = options.maxMs ?? 8000;
  const intervalMs = options.intervalMs ?? 500;

  if (!(await isEaOnline(userId))) {
    return { ok: false, status: "offline" };
  }

  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (isEaChartFileReady(userId, captureKey)) {
      const buffer = await readEaChartPng(userId, captureKey);
      if (buffer) {
        return { ok: true, buffer, status: "ready" };
      }
    }
    await sleep(intervalMs);
  }

  return { ok: false, status: "timeout", retryAfterMs: 2000 };
}
