import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { smartTipKey } from "@/lib/recommendations/smartTip";
import { ar } from "@/lib/i18n/ar";
import { en } from "@/lib/i18n/en";

describe("smartTipKey", () => {
  it("changes with status/outcome and always maps to a real key", () => {
    const cases: Array<[Parameters<typeof smartTipKey>[0], string]> = [
      [{ status: "pending_entry", outcome: "pending" }, "rec.tip.pending"],
      [{ status: "triggered", outcome: "pending" }, "rec.tip.triggered"],
      [{ status: "tp1_hit", outcome: "pending" }, "rec.tip.tp1"],
      [{ status: "tp2_hit", outcome: "pending" }, "rec.tip.tp2"],
      [{ status: "tp3_hit", outcome: "win_tp3" }, "rec.tip.tp3"],
      [{ status: "sl_hit", outcome: "loss" }, "rec.tip.sl"],
      [{ status: "expired", outcome: "expired" }, "rec.tip.expired"],
      [{ status: "cancelled", outcome: "cancelled" }, "rec.tip.cancelled"],
      [{ status: "invalidated", outcome: "invalidated" }, "rec.tip.invalidated"],
    ];
    for (const [input, key] of cases) {
      assert.equal(smartTipKey(input), key);
      // Key must exist in both dictionaries.
      assert.ok((en as Record<string, string>)[key], `en missing ${key}`);
      assert.ok((ar as Record<string, string>)[key], `ar missing ${key}`);
    }
  });
});
