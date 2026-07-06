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
