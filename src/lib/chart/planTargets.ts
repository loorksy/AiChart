/**
 * Assemble the TP ladder a chart payload actually carries.
 *
 * Production used to send only `take_profit` (= TP1) to the native position
 * tool, so the green profit zone stopped at the first target while TP2/TP3
 * sat as labeled lines beyond it. Prefer the full `targets` array whenever
 * it is present.
 */
export function planTargetList(input: {
  targets?: readonly unknown[] | null;
  takeProfit?: number | null;
  targetsJson?: string | null;
}): number[] {
  const fromArray = (input.targets ?? []).filter(
    (x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0,
  );
  if (fromArray.length > 0) return fromArray;
  if (typeof input.targetsJson === "string" && input.targetsJson.trim()) {
    try {
      const parsed = JSON.parse(input.targetsJson) as unknown;
      if (Array.isArray(parsed)) {
        const nums = parsed.filter(
          (x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0,
        );
        if (nums.length > 0) return nums;
      }
    } catch {
      /* ignore malformed json */
    }
  }
  const tp = input.takeProfit;
  return typeof tp === "number" && Number.isFinite(tp) && tp > 0 ? [tp] : [];
}
