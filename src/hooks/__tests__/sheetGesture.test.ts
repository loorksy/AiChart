import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SHEET_DISMISS_RATIO,
  SHEET_FLICK_VELOCITY,
  shouldDismissSheet,
} from "@/hooks/sheetGesture";

describe("shouldDismissSheet", () => {
  const height = 800;

  it("stays put when there is no downward travel", () => {
    assert.equal(shouldDismissSheet({ dy: 0, velocity: 0, height }), false);
    assert.equal(shouldDismissSheet({ dy: -40, velocity: 1, height }), false);
  });

  it("stays put when height is not a real sheet", () => {
    assert.equal(shouldDismissSheet({ dy: 400, velocity: 1, height: 0 }), false);
    assert.equal(shouldDismissSheet({ dy: 400, velocity: 1, height: -1 }), false);
  });

  it("dismisses once the drag passes ~35% of the sheet height", () => {
    const under = height * SHEET_DISMISS_RATIO - 1;
    const over = height * SHEET_DISMISS_RATIO + 1;
    assert.equal(shouldDismissSheet({ dy: under, velocity: 0, height }), false);
    assert.equal(shouldDismissSheet({ dy: over, velocity: 0, height }), true);
  });

  it("dismisses on a fast downward flick even with a short drag", () => {
    assert.equal(
      shouldDismissSheet({
        dy: 24,
        velocity: SHEET_FLICK_VELOCITY + 0.01,
        height,
      }),
      true,
    );
    assert.equal(
      shouldDismissSheet({
        dy: 24,
        velocity: SHEET_FLICK_VELOCITY,
        height,
      }),
      false,
    );
  });

  it("honours an explicit threshold in the 30–40% band", () => {
    assert.equal(
      shouldDismissSheet({ dy: 250, velocity: 0, height: 1000, dismissRatio: 0.3 }),
      false,
    );
    assert.equal(
      shouldDismissSheet({ dy: 301, velocity: 0, height: 1000, dismissRatio: 0.3 }),
      true,
    );
    assert.equal(
      shouldDismissSheet({ dy: 399, velocity: 0, height: 1000, dismissRatio: 0.4 }),
      false,
    );
  });
});
