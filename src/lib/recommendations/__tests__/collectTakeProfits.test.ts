import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectTakeProfits } from "@/lib/recommendations/collectTakeProfits";

describe("collectTakeProfits", () => {
  it("uniques, sorts nearest-first, and caps at 3", () => {
    assert.deepEqual(
      collectTakeProfits("buy", 4417.4, [4450, 4417.4, 4430.1, 4500]),
      [4417.4, 4430.1, 4450],
    );
    assert.deepEqual(
      collectTakeProfits("sell", 4380, [4360, 4380, 4340, 4300]),
      [4380, 4360, 4340],
    );
  });

  it("falls back to a single take_profit", () => {
    assert.deepEqual(collectTakeProfits("buy", 4417.4), [4417.4]);
    assert.deepEqual(collectTakeProfits("buy", null, []), []);
  });
});
