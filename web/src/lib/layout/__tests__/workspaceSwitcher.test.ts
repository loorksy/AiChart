import assert from "node:assert/strict";
import test from "node:test";
import {
  SWITCHER_DRAG_THRESHOLD_PX,
  clampSwitcherPoint,
  clampSwitcherY,
  defaultSwitcherEdge,
  defaultSwitcherPosition,
  parseSwitcherPosition,
  resolveDockFromPoint,
  snapSwitcherEdge,
} from "@/lib/layout/workspaceSwitcher";

test("default edge is left for RTL and right for LTR", () => {
  assert.equal(defaultSwitcherEdge("rtl"), "left");
  assert.equal(defaultSwitcherEdge("ltr"), "right");
});

test("legacy edge payloads migrate to free XY", () => {
  const parsed = parseSwitcherPosition(
    JSON.stringify({ edge: "left", y: -999 }),
    "ltr",
    900,
    800,
  );
  assert.equal(parsed.dock, "free");
  assert.equal(parsed.collapsed, false);
  assert.ok(parsed.x >= 4);
  assert.ok(parsed.y >= 4);
  assert.equal(clampSwitcherY(9999, 800) <= 800 - 24, true);
});

test("free XY positions are clamped inside the viewport", () => {
  const point = clampSwitcherPoint(-40, 9999, 400, 700);
  assert.ok(point.x >= 4);
  assert.ok(point.y <= 700 - 4);
});

test("snap helper still reports nearest physical edge", () => {
  assert.equal(snapSwitcherEdge(10, 1000), "left");
  assert.equal(snapSwitcherEdge(900, 1000), "right");
});

test("default position stays inside viewport", () => {
  const pos = defaultSwitcherPosition("rtl", 390, 700);
  assert.equal(pos.dock, "free");
  assert.ok(pos.x >= 4);
  assert.ok(pos.y >= 4);
  assert.ok(pos.y + 140 <= 700);
});

test("bottom zone docks to composer; top zone docks to top", () => {
  assert.equal(resolveDockFromPoint(100, 740, 390, 800), "composer");
  assert.equal(resolveDockFromPoint(100, 10, 390, 800), "top");
  assert.equal(resolveDockFromPoint(100, 300, 390, 800), "free");
});

test("v2 payloads preserve dock and collapsed", () => {
  const parsed = parseSwitcherPosition(
    JSON.stringify({ x: 12, y: 40, dock: "top", collapsed: true }),
    "ltr",
    390,
    800,
  );
  assert.equal(parsed.dock, "top");
  assert.equal(parsed.collapsed, true);
});

test("drag threshold is positive so taps are not drags", () => {
  assert.ok(SWITCHER_DRAG_THRESHOLD_PX >= 6);
});
