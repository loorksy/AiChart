import assert from "node:assert/strict";
import test from "node:test";
import {
  SWITCHER_DRAG_THRESHOLD_PX,
  clampSwitcherY,
  defaultSwitcherEdge,
  defaultSwitcherPosition,
  parseSwitcherPosition,
  snapSwitcherEdge,
} from "@/lib/layout/workspaceSwitcher";

test("default edge is left for RTL and right for LTR", () => {
  assert.equal(defaultSwitcherEdge("rtl"), "left");
  assert.equal(defaultSwitcherEdge("ltr"), "right");
});

test("invalid saved positions are clamped", () => {
  const parsed = parseSwitcherPosition(
    JSON.stringify({ edge: "left", y: -999 }),
    "ltr",
    900,
  );
  assert.equal(parsed.edge, "left");
  assert.ok(parsed.y >= 56);
  assert.equal(clampSwitcherY(9999, 800) <= 800 - 24, true);
});

test("snap chooses nearest physical edge", () => {
  assert.equal(snapSwitcherEdge(10, 1000), "left");
  assert.equal(snapSwitcherEdge(900, 1000), "right");
});

test("default position stays inside viewport", () => {
  const pos = defaultSwitcherPosition("rtl", 700);
  assert.equal(pos.edge, "left");
  assert.ok(pos.y >= 56);
  assert.ok(pos.y + 96 <= 700);
});

test("drag threshold is positive so taps are not drags", () => {
  assert.ok(SWITCHER_DRAG_THRESHOLD_PX >= 6);
});
