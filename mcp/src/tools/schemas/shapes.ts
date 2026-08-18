import { z } from "zod";

/** Shared Zod field shapes reused across tool catalogs. */
export const zSymbol = z.string();
export const zOptionalSymbol = z.string().optional();
export const zMarket = z.literal("forex").optional();
export const zInterval = z.string().optional();
export const zSide = z.enum(["buy", "sell"]);
export const zConfidence = z.number().min(0).max(100);
export const zOptionalConfidence = z.number().min(0).max(100).optional();
export const zTradeId = z.number().int().positive();
export const zChartDrawings = z.array(z.record(z.string(), z.unknown())).optional();

/**
 * Boolean that tolerates the string forms MCP hosts actually send.
 *
 * Observed live: a host serialized `inline_image: true` as the STRING "true",
 * and a strict z.boolean() rejected the whole call with -32602. Host JSON
 * encoders are outside our control; the schema must accept "true"/"false" (and
 * "1"/"0") rather than fail a working request over a quoting choice.
 */
export const zLooseBoolean = z.preprocess((value) => {
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true" || lower === "1") return true;
    if (lower === "false" || lower === "0" || lower === "") return false;
  }
  return value;
}, z.boolean());

/**
 * Preview mode for bucket-A (execution) tools: runs every check the real call
 * runs and returns the real consequence figures, but stops before the one
 * line that has a side effect — nothing is placed, closed, modified,
 * cancelled, or sent to Telegram. Each tool's description states exactly
 * which figures its preview can and cannot show.
 */
export const zDryRun = zLooseBoolean
  .optional()
  .describe(
    "Preview only: runs the real checks and returns the real consequence figures without committing anything. Use before the first live call on a symbol, or whenever the operator asks what would happen.",
  );
