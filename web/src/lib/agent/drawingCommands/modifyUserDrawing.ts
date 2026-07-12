/**
 * Build a structured, validated drawing mutation from a natural-language edit
 * command — NO LLM, NO trade analysis. Only user-owned drawings on the active
 * symbol can be mutated; prices must be finite, positive, and on a sane scale.
 * The client applies the returned command once (idempotent by mutationId).
 */
import { drawingPriceLevels } from "@/lib/chart/drawings/serializeUserDrawings";
import type {
  SerializedChartDrawing,
  UserDrawingMutation,
  UserDrawingMutationCommand,
} from "@/lib/chart/drawings/types";

export type MutationFailure =
  | "wrong_owner"
  | "wrong_symbol"
  | "invalid_price"
  | "unsupported"
  | "no_change";

export type BuildMutationResult =
  | { ok: true; command: UserDrawingMutationCommand }
  | { ok: false; reason: MutationFailure };

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};
function prices(text: string): number[] {
  const t = text.replace(/[٠-٩]/g, (d) => ARABIC_DIGITS[d] ?? d);
  return (t.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => Number.isFinite(n) && n >= 1);
}

function uuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? `mut-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

function normSymbol(s?: string): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isZone(d: SerializedChartDrawing): boolean {
  return /zone|rect|box|range/i.test(d.type) || drawingPriceLevels(d).length >= 2;
}

function representativeLevel(d: SerializedChartDrawing): number | null {
  const levels = drawingPriceLevels(d);
  if (!levels.length) return null;
  return levels.reduce((a, b) => a + b, 0) / levels.length;
}

/** Guard against typos / wrong-symbol prices: target must be near the drawing. */
function priceOnScale(target: number, reference: number | null): boolean {
  if (!Number.isFinite(target) || target <= 0) return false;
  if (reference == null || reference <= 0) return true;
  const ratio = target / reference;
  return ratio >= 0.5 && ratio <= 2;
}

export function buildUserDrawingMutation(input: {
  message: string;
  drawing: SerializedChartDrawing;
  contextSymbol?: string;
  mutationId?: string;
}): BuildMutationResult {
  const d = input.drawing;
  if (d.owner !== "user") return { ok: false, reason: "wrong_owner" };
  if (
    input.contextSymbol &&
    d.symbol &&
    normSymbol(d.symbol) !== normSymbol(input.contextSymbol)
  ) {
    return { ok: false, reason: "wrong_symbol" };
  }

  const text = input.message.toLowerCase();
  const nums = prices(input.message);
  const ref = representativeLevel(d);
  const mutationId = input.mutationId ?? uuid();
  const wrap = (mutation: UserDrawingMutation): BuildMutationResult => ({
    ok: true,
    command: { mutationId, mutation },
  });

  const wantsWider = /wider|widen|وسّع|وسع|أوسع|اوسع/.test(text);
  const wantsNarrower = /narrow|tighter|ضيّق|ضيق|أضيق|اضيق/.test(text);
  const wantsLower = /lower|down|below|أسفل|اسفل|تحت|انزل|نزّل/.test(text);
  const wantsHigher = /higher|up|above|أعلى|اعلى|فوق|ارفع|رفع/.test(text);
  const wantsLabel = /label|rename|name|سمّ|سم|اسم|عنوان/.test(text);

  // Resize a zone.
  if (isZone(d) && (wantsWider || wantsNarrower || nums.length >= 2)) {
    const levels = drawingPriceLevels(d);
    let upper = Math.max(...levels);
    let lower = Math.min(...levels);
    if (nums.length >= 2) {
      const sorted = [...nums].sort((a, b) => b - a);
      upper = sorted[0]!;
      lower = sorted[sorted.length - 1]!;
    } else {
      const span = Math.max(upper - lower, upper * 0.001);
      const delta = span * (wantsWider ? 0.25 : -0.25);
      upper += delta;
      lower -= delta;
    }
    if (!priceOnScale(upper, ref) || !priceOnScale(lower, ref) || upper <= lower) {
      return { ok: false, reason: "invalid_price" };
    }
    return wrap({ type: "resize_zone", drawingId: d.id, upperPrice: upper, lowerPrice: lower });
  }

  // Update label ("rename this line to X" / trailing quoted text).
  if (wantsLabel) {
    const quoted = input.message.match(/["'“”«»]([^"'“”«»]{1,120})["'“”«»]/);
    const label = quoted?.[1]?.trim();
    if (label) return wrap({ type: "update_label", drawingId: d.id, label });
    return { ok: false, reason: "unsupported" };
  }

  // Move a line to an explicit price.
  if (nums.length >= 1) {
    const target = nums[0]!;
    if (!priceOnScale(target, ref)) return { ok: false, reason: "invalid_price" };
    return wrap({ type: "move_level", drawingId: d.id, price: target });
  }

  // Nudge lower/higher "slightly" (no explicit price) — small deterministic step.
  if ((wantsLower || wantsHigher) && ref != null) {
    const step = ref * 0.001; // ~0.1%
    const target = wantsLower ? ref - step : ref + step;
    if (!priceOnScale(target, ref)) return { ok: false, reason: "invalid_price" };
    return wrap({ type: "move_level", drawingId: d.id, price: target });
  }

  return { ok: false, reason: "unsupported" };
}
