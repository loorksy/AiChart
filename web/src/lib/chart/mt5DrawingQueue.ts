import { createEaCommand } from "@/lib/eaStore";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { mapChartDrawingsToMt5Objects } from "@/lib/chart/mt5DrawingMapper";
import type { EaCommand, EaDrawingCommandPayload } from "@/lib/types";

const DRAWING_TTL_MS = 120_000;

export async function queueApplyChartDrawingsToMt5(
  userId: number,
  input: {
    symbol: string;
    timeframe: string;
    drawings: ChartDrawing[];
    replaceExisting?: boolean;
  },
): Promise<{ queued: boolean; command?: EaCommand; count: number; reason?: string }> {
  const drawings = mapChartDrawingsToMt5Objects(input.drawings, {
    symbol: input.symbol,
    timeframe: input.timeframe,
  });
  if (!drawings.length) {
    return { queued: false, count: 0, reason: "no_supported_drawings" };
  }

  const payload: EaDrawingCommandPayload & { replace_existing?: boolean } = {
    symbol: input.symbol,
    timeframe: input.timeframe,
    drawings,
    replace_existing: input.replaceExisting ?? false,
  };

  const command = await createEaCommand(userId, {
    command_type: "apply_trade_plan_drawings",
    payload,
    ttlMs: DRAWING_TTL_MS,
  });

  return { queued: true, command, count: drawings.length };
}

export async function queueClearAiChartDrawingsFromMt5(
  userId: number,
  input: { symbol: string; timeframe?: string | null },
): Promise<EaCommand> {
  return createEaCommand(userId, {
    command_type: "clear_aichart_drawings",
    payload: {
      symbol: input.symbol,
      timeframe: input.timeframe ?? null,
      source: "aichart",
    },
    ttlMs: DRAWING_TTL_MS,
  });
}
