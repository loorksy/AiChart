/**
 * The drawn trade plan must be ONE native Long/Short Position (risk-reward)
 * tool, time-bounded from the print/anchor candle to lastBar — not an
 * infinite price band, and not two independent rectangles/polylines.
 *
 * History of the complaint this file pins, in order:
 * 1. "الصندوق يتحرك حتى يلامس منطقة الدخول" — the zones slid because every
 *    redraw re-anchored them at wall-clock "now". Fixed by persisting
 *    `created_at` + a sticky per-trade fallback anchor.
 * 2. "المناطق تتمدد مع حركة الشموع" — hand-drawn rectangles placed their
 *    RIGHT anchor at created_at + 24 bars, a time in the FUTURE. This
 *    library build clamps that to the MOVING last bar, so the pair
 *    degenerated into a thin column hugging the live candle.
 * 3. Native `long_position`/`short_position` with a SINGLE point
 *    (`createShape`) filled the pane as a full-width horizontal band: Close
 *    was synthesized from visible width, and a left time that failed to
 *    resolve (0 / epoch / before loaded history) clamped to the FIRST bar.
 * 4. Two-point `rectangle` still painted a full-width band on this widget
 *    (mobile createShape drops times / equal times / extend flags leak).
 * 5. Two closed 5-vertex `polyline`s (`8b6705e1`) still looked infinite:
 *    polyline has no extendLeft/Right, create can drop vertex times, and
 *    two independent fills are not the RR tool. The user asked for the
 *    SAME drawing that defines profit and loss.
 *
 * Current: one `long_position` / `short_position` created with TWO points
 * (Entry + Close, both at entry price, unix seconds, right > left, never a
 * future Close), then `setPoints` + `stopLevel` / `profitLevel` (furthest
 * TP) / `extendLeft: false` / `extendRight: false` after create so time
 * actually sticks. Pin even if lastBar did not move during the promise.
 *
 * The tests simulate the failing sequences: draw → several new bars pass →
 * redraw/force/reload paths run → the LEFT anchor must be byte-identical
 * while the RIGHT/width follows lastBar.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  TvDrawingManager,
  positionBoxEdges,
  positionToolPoints,
  isPlausibleUnixSec,
  MIN_PLAUSIBLE_UNIX_SEC,
} from "@/lib/chart/tv/tvDrawingAdapter";
import { priceDistanceTicks } from "@/lib/chart/tv/tvSymbolTicks";
import { planTargetList } from "@/lib/chart/planTargets";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { Recommendation } from "@/lib/types";
import type {
  EntityId,
  IChartWidgetApi,
  ShapePoint,
} from "@/vendor/tradingview/charting_library";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

interface MultiCall {
  points: Array<{ time: number; price: number }>;
  shape: string;
  text?: string;
  overrides?: Record<string, unknown>;
}
interface SingleCall {
  point: { time?: number; price?: number };
  shape: string;
  options: Record<string, unknown>;
}
interface SetPointsCall {
  id: string;
  points: Array<{ time?: number; price?: number }>;
}
interface SetPropsCall {
  id: string;
  props: Record<string, unknown>;
}

function fakeChart() {
  let n = 0;
  const multi: MultiCall[] = [];
  const single: SingleCall[] = [];
  const removed: string[] = [];
  const setPointsCalls: SetPointsCall[] = [];
  const setPropsCalls: SetPropsCall[] = [];
  const shapes = new Map<string, Array<{ time?: number; price?: number }>>();
  const chart = {
    createMultipointShape: (
      points: ShapePoint[],
      options: { shape: string; text?: string; overrides?: Record<string, unknown> },
    ) => {
      multi.push({
        points: points.map((p) => ({
          time: (p as { time: number }).time,
          price: (p as { price: number }).price,
        })),
        shape: options.shape,
        text: options.text,
        overrides: options.overrides,
      });
      n += 1;
      const id = `shape-${n}` as EntityId;
      shapes.set(String(id), points.map((p) => ({
        time: (p as { time?: number }).time,
        price: (p as { price?: number }).price,
      })));
      return Promise.resolve(id);
    },
    createShape: (point: ShapePoint, options: { shape: string }) => {
      single.push({
        point: point as SingleCall["point"],
        shape: options.shape,
        options: options as unknown as Record<string, unknown>,
      });
      n += 1;
      const id = `shape-${n}` as EntityId;
      shapes.set(String(id), [
        {
          time: (point as { time?: number }).time,
          price: (point as { price?: number }).price,
        },
      ]);
      return Promise.resolve(id);
    },
    removeEntity: (id: EntityId) => {
      removed.push(String(id));
      shapes.delete(String(id));
    },
    getShapeById: (id: EntityId) => ({
      getPoints: () => [...(shapes.get(String(id)) ?? [])],
      setPoints: (points: ShapePoint[]) => {
        const mapped = points.map((p) => ({
          time: (p as { time?: number }).time,
          price: (p as { price?: number }).price,
        }));
        setPointsCalls.push({ id: String(id), points: mapped });
        shapes.set(String(id), mapped);
      },
      setProperties: (props: Record<string, unknown>) => {
        setPropsCalls.push({ id: String(id), props });
      },
    }),
  } as unknown as IChartWidgetApi;
  return { chart, multi, single, removed, setPointsCalls, setPropsCalls, shapes };
}

const CREATED_AT_MS = Date.UTC(2026, 7, 24, 18, 0, 0);
const LAST_BAR_MS = Date.UTC(2026, 7, 24, 19, 0, 0);
const BAR_SEC = 15 * 60; // 15m interval

const REC = {
  action: "buy",
  entry: 4646.19,
  stop_loss: 4642.93,
  take_profit: 4660.02,
  created_at: CREATED_AT_MS,
} as unknown as Recommendation;

const CTX = { symbol: "XAUUSD", interval: "15m" };
const CTX_LIVE = { ...CTX, lastBarTime: LAST_BAR_MS };

function rrTools(multi: MultiCall[]): MultiCall[] {
  return multi.filter((c) => c.shape === "long_position" || c.shape === "short_position");
}

function nativePositionCreates(single: SingleCall[], multi: MultiCall[]): number {
  return (
    single.filter((c) => c.shape === "long_position" || c.shape === "short_position")
      .length +
    multi.filter((c) => c.shape === "long_position" || c.shape === "short_position")
      .length
  );
}

function assertFinitePosition(
  box: MultiCall,
  leftSec: number,
  rightSec: number,
  entry: number,
  label: string,
): void {
  assert.ok(
    box.shape === "long_position" || box.shape === "short_position",
    `${label}: native Long/Short Position, not rectangle/polyline`,
  );
  assert.equal(box.points.length, 2, `${label}: Entry + Close (two points, not one)`);
  assert.equal(box.points[0]!.time, leftSec, `${label}: left is the print/anchor`);
  assert.equal(box.points[1]!.time, rightSec, `${label}: right is lastBar`);
  assert.equal(box.points[0]!.price, entry, `${label}: Entry at entry price`);
  assert.equal(box.points[1]!.price, entry, `${label}: Close at entry price`);
  for (const p of box.points) {
    assert.ok(Number.isFinite(p.time!), `${label}: time is finite`);
    assert.ok(p.time! >= MIN_PLAUSIBLE_UNIX_SEC, `${label}: not t=0 / epoch / bar-index`);
    assert.ok(p.time! < 1e12, `${label}: unix seconds, not milliseconds`);
  }
  assert.ok(rightSec > leftSec, `${label}: width is finite (right > left)`);
  assert.notEqual(leftSec, 0, `${label}: left is not 0`);
  assert.equal(box.overrides?.extendLeft, false, `${label}: must not extend left`);
  assert.equal(box.overrides?.extendRight, false, `${label}: must not extend right`);
  assert.equal(typeof box.overrides?.stopLevel, "number", `${label}: stopLevel on the same shape`);
  assert.equal(typeof box.overrides?.profitLevel, "number", `${label}: profitLevel on the same shape`);
  assert.ok((box.overrides?.stopLevel as number) > 0, `${label}: stopLevel > 0`);
  assert.ok((box.overrides?.profitLevel as number) > 0, `${label}: profitLevel > 0`);
}

describe("positionBoxEdges — finite unix-second box, never a full-width band", () => {
  const now = Math.round(CREATED_AT_MS / 1000);
  const left = now;
  const last = now + 3600;

  it("left is the print/anchor, right is lastBar, width is finite", () => {
    const edges = positionBoxEdges({ leftSec: left, lastBarSec: last, nowSec: now });
    assert.deepEqual(edges, { left, right: last });
    assert.ok(edges!.right > edges!.left);
    assert.ok(Number.isFinite(edges!.left) && Number.isFinite(edges!.right));
  });

  it("left is NOT lastBar and NOT created_at wall-clock when a print time is given", () => {
    const print = left;
    const createdLater = left + 600;
    const edges = positionBoxEdges({
      leftSec: print,
      lastBarSec: last,
      nowSec: createdLater,
    });
    assert.equal(edges!.left, print);
    assert.notEqual(edges!.left, last);
    assert.notEqual(edges!.left, createdLater);
  });

  it("does not invent a future Close (lastBar + N bars / created_at + 24)", () => {
    const edges = positionBoxEdges({ leftSec: left, lastBarSec: last, nowSec: now });
    assert.equal(edges!.right, last);
    assert.notEqual(edges!.right, left + 24 * BAR_SEC);
    assert.ok(edges!.right <= last);
  });

  it("missing/zero/epoch left does not produce a box from t=0", () => {
    for (const bad of [null, undefined, 0, 100, 1_000_000]) {
      const edges = positionBoxEdges({
        leftSec: bad,
        lastBarSec: last,
        nowSec: now,
      });
      // Implausible left falls back to lastBar, which has zero width → null.
      // That is "no box", which is NOT a full-width band from unix 0.
      assert.equal(edges, null, `left=${String(bad)} must not become t=0`);
    }
  });

  it("missing lastBar refuses to draw (no future / no pane-width guess)", () => {
    assert.equal(
      positionBoxEdges({ leftSec: left, lastBarSec: null, nowSec: now }),
      null,
    );
  });

  it("left still in the future of lastBar waits — does not clamp left down", () => {
    assert.equal(
      positionBoxEdges({ leftSec: last + 60, lastBarSec: last, nowSec: now }),
      null,
    );
  });

  it("rejects bar-index and epoch as plausible unix seconds", () => {
    assert.equal(isPlausibleUnixSec(0, now), false);
    assert.equal(isPlausibleUnixSec(100, now), false);
    assert.equal(isPlausibleUnixSec(MIN_PLAUSIBLE_UNIX_SEC - 1, now), false);
    assert.equal(isPlausibleUnixSec(left, now), true);
  });

  it("positionToolPoints is Entry + Close at the entry price, unix seconds", () => {
    const pts = positionToolPoints(left, last, 4646.19);
    assert.equal(pts.length, 2);
    assert.deepEqual(pts[0], { time: left, price: 4646.19 });
    assert.deepEqual(pts[1], { time: last, price: 4646.19 });
    for (const v of pts) {
      assert.ok(v.time >= MIN_PLAUSIBLE_UNIX_SEC);
      assert.ok(v.time < 1e12, "seconds, not milliseconds");
    }
    assert.ok(last > left);
  });

  it("priceDistanceTicks matches XAUUSD 2-decimal tick math", () => {
    assert.equal(priceDistanceTicks("XAUUSD", 4646.19, 4642.93), 326);
    assert.equal(priceDistanceTicks("XAUUSD", 4646.19, 4680.1), 3391);
  });
});

describe("tvDrawingAdapter — one native RR tool, pinned at print time", () => {
  it("draws ONE long_position for a buy — never two rectangles/polylines, never single-point createShape", async () => {
    const { chart, multi, single } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: REC, targets: [4660.02, 4670.46] },
      CTX_LIVE,
    );
    await flush();

    const boxes = rrTools(multi);
    assert.equal(boxes.length, 1, "one Long Position tool, not two separate boxes");
    assert.equal(
      multi.filter((c) => c.shape === "rectangle").length,
      0,
      "2-point rectangle still paints a full-width band on this widget",
    );
    assert.equal(
      multi.filter((c) => c.shape === "polyline").length,
      0,
      "two polylines still looked infinite and were two separate fills",
    );
    assert.equal(
      single.filter((c) => c.shape === "long_position" || c.shape === "short_position")
        .length,
      0,
      "single-point createShape synthesizes Close from pane width",
    );
    assert.equal(nativePositionCreates(single, multi), 1);
    assertFinitePosition(
      boxes[0]!,
      Math.round(CREATED_AT_MS / 1000),
      Math.round(LAST_BAR_MS / 1000),
      4646.19,
      "buy RR tool",
    );
    assert.equal(boxes[0]!.shape, "long_position");
  });

  it("setPoints after create re-pins both unix-second corners even if lastBar did not move", async () => {
    const { chart, setPointsCalls, setPropsCalls } = fakeChart();
    new TvDrawingManager(chart).apply([], { recommendation: REC }, CTX_LIVE);
    await flush();
    const pins = setPointsCalls.filter((c) => c.points.length === 2);
    assert.ok(pins.length >= 1, "must be setPoints-pinned after create (create drops times)");
    const left = Math.round(CREATED_AT_MS / 1000);
    const right = Math.round(LAST_BAR_MS / 1000);
    for (const pin of pins) {
      assert.equal(pin.points[0]!.time, left, "left wall is the rec candle");
      assert.equal(pin.points[1]!.time, right, "right wall is lastBar");
      assert.equal(pin.points[0]!.price, 4646.19);
      assert.equal(pin.points[1]!.price, 4646.19);
      assert.ok(
        pin.points.every(
          (p) => p.time != null && p.time >= MIN_PLAUSIBLE_UNIX_SEC && p.time < 1e12,
        ),
        "every corner is unix seconds, not 0 / epoch / ms",
      );
      assert.ok(right > left);
    }
    const props = setPropsCalls.at(-1);
    assert.ok(props, "setProperties after create");
    assert.equal(props!.props.extendLeft, false);
    assert.equal(props!.props.extendRight, false);
    assert.equal(typeof props!.props.stopLevel, "number");
    assert.equal(typeof props!.props.profitLevel, "number");
  });

  it("does not create the box until lastBar is known — no future Close guess", async () => {
    const { chart, multi, setPointsCalls } = fakeChart();
    new TvDrawingManager(chart).apply([], { recommendation: REC }, CTX);
    await flush();
    assert.equal(rrTools(multi).length, 0, "no box without lastBar");
    assert.equal(setPointsCalls.length, 0);
  });

  it("syncRightEdge after apply without lastBar creates the finite box (first candle)", async () => {
    const { chart, multi } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    mgr.apply([], { recommendation: REC }, CTX);
    await flush();
    assert.equal(rrTools(multi).length, 0);
    mgr.syncRightEdge(LAST_BAR_MS);
    await flush();
    const boxes = rrTools(multi);
    assert.equal(boxes.length, 1);
    assertFinitePosition(
      boxes[0]!,
      Math.round(CREATED_AT_MS / 1000),
      Math.round(LAST_BAR_MS / 1000),
      4646.19,
      "late lastBar",
    );
  });

  it("anchors LEFT at created_at and RIGHT at lastBar on the one tool", async () => {
    const { chart, multi } = fakeChart();
    new TvDrawingManager(chart).apply([], { recommendation: REC }, CTX_LIVE);
    await flush();

    const left = Math.round(CREATED_AT_MS / 1000);
    const right = Math.round(LAST_BAR_MS / 1000);
    const boxes = rrTools(multi);
    assert.equal(boxes.length, 1);
    assertFinitePosition(boxes[0]!, left, right, 4646.19, "buy box");
    assert.notEqual(left, right);
  });

  it("profitLevel is furthest TP ticks and stopLevel is stop ticks on the same shape", async () => {
    const { chart, multi } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: REC, targets: [4660.02, 4680.1, 4670.46] },
      CTX_LIVE,
    );
    await flush();
    const box = rrTools(multi)[0]!;
    assert.equal(box.shape, "long_position");
    assert.equal(
      box.overrides?.profitLevel,
      priceDistanceTicks("XAUUSD", 4646.19, 4680.1),
      "profit edge is the most distant TP, not TP1",
    );
    assert.equal(
      box.overrides?.stopLevel,
      priceDistanceTicks("XAUUSD", 4646.19, 4642.93),
      "risk edge is the stop",
    );
  });

  it("extends profitLevel to the FURTHEST target of a sell (min)", async () => {
    const { chart, multi } = fakeChart();
    const sell = {
      ...REC,
      action: "sell",
      entry: 4660,
      stop_loss: 4671,
    } as unknown as Recommendation;
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: sell, targets: [4640, 4622.5, 4635] },
      CTX_LIVE,
    );
    await flush();
    const box = rrTools(multi)[0]!;
    assert.equal(box.shape, "short_position");
    assert.equal(
      box.overrides?.profitLevel,
      priceDistanceTicks("XAUUSD", 4660, 4622.5),
      "for a sell the furthest target is the LOWEST price",
    );
  });

  it("keeps every target as a labeled line, plus entry and stop", async () => {
    const { chart, single } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: REC, targets: [4660.02, 4670.46, 4680.1] },
      CTX_LIVE,
    );
    await flush();

    const hlines = single.filter((c) => c.shape === "horizontal_line");
    const texts = hlines.map((c) => ({ price: c.point.price, text: c.options.text }));
    assert.ok(texts.some((t) => t.price === 4646.19 && t.text === "دخول"));
    assert.ok(texts.some((t) => t.price === 4642.93 && t.text === "وقف خسارة"));
    assert.ok(texts.some((t) => t.price === 4660.02 && t.text === "هدف 1"));
    assert.ok(texts.some((t) => t.price === 4670.46 && t.text === "هدف 2"));
    assert.ok(texts.some((t) => t.price === 4680.1 && t.text === "هدف 3"));
  });

  it("a single-target plan sets profitLevel from the only TP", async () => {
    const { chart, multi } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: REC, targets: [4660.02] },
      CTX_LIVE,
    );
    await flush();
    const box = rrTools(multi)[0]!;
    assert.equal(box.overrides?.profitLevel, priceDistanceTicks("XAUUSD", 4646.19, 4660.02));
  });

  it("re-applying the same payload is a no-op (poll no-flicker, no snap-back)", async () => {
    const { chart, multi, single } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    const trade = { recommendation: REC, targets: [4660.02, 4670.46] };
    mgr.apply([], trade, CTX_LIVE);
    await flush();
    const afterMulti = multi.length;
    const afterSingle = single.length;

    mgr.apply([], trade, CTX_LIVE);
    mgr.apply([], { ...trade }, CTX_LIVE);
    await flush();
    assert.equal(multi.length, afterMulti);
    assert.equal(single.length, afterSingle);
  });

  it("a forced redraw reproduces a byte-identical left and levels", async () => {
    const { chart, multi } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    mgr.apply([], { recommendation: REC }, CTX_LIVE);
    await flush();
    const first = rrTools(multi).map((r) => r.points);

    mgr.apply([], { recommendation: REC }, CTX_LIVE, { force: true });
    await flush();
    const second = rrTools(multi).slice(-1).map((r) => r.points);
    assert.deepEqual(second, first, "same entry/stop/tp anchors");
  });

  it("new bars never shift the LEFT — even for a legacy payload without created_at", async () => {
    const noCreatedAt = {
      action: "buy",
      entry: 4646.19,
      stop_loss: 4642.93,
      take_profit: 4660.02,
    } as unknown as Recommendation;
    const { chart, multi } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    const realNow = Date.now;
    try {
      let clock = Date.UTC(2026, 7, 25, 12, 0, 0);
      Date.now = () => clock;
      const firstLast = clock;
      const laterLast = clock + BAR_SEC * 5 * 1000;

      mgr.apply(
        [],
        { recommendation: noCreatedAt },
        { ...CTX, lastBarTime: firstLast },
      );
      await flush();
      // First apply: fallback left = lastBar → zero width → no box yet.
      assert.equal(rrTools(multi).length, 0);

      clock += BAR_SEC * 5 * 1000;
      const changedDrawings: ChartDrawing[] = [
        {
          type: "price_line",
          confidence: 80,
          label: "دعم",
          points: [{ price: 4630, time: clock }],
        },
      ];
      mgr.apply(changedDrawings, { recommendation: noCreatedAt }, {
        ...CTX,
        lastBarTime: laterLast,
      });
      await flush();
      const boxes = rrTools(multi);
      assert.equal(boxes.length, 1);
      const left = Math.round(firstLast / 1000);
      const right = Math.round(laterLast / 1000);
      assertFinitePosition(boxes[0]!, left, right, 4646.19, "legacy fallback");

      clock += BAR_SEC * 7 * 1000;
      const laterStill = laterLast + BAR_SEC * 7 * 1000;
      mgr.apply(changedDrawings, { recommendation: noCreatedAt }, {
        ...CTX,
        lastBarTime: laterStill,
      }, { force: true });
      await flush();
      const restored = rrTools(multi).at(-1)!;
      assert.equal(restored.points[0]!.time, left, "forced redraw keeps the first fallback left");
      assert.notEqual(restored.points[0]!.time, 0);
    } finally {
      Date.now = realNow;
    }
  });

  it("a reload reproduces the anchor from the persisted created_at, not from 'now'", async () => {
    const realNow = Date.now;
    try {
      Date.now = () => CREATED_AT_MS;
      const first = fakeChart();
      new TvDrawingManager(first.chart).apply([], { recommendation: REC }, CTX_LIVE);
      await flush();
      const before = rrTools(first.multi)[0]!.points;

      Date.now = () => CREATED_AT_MS + 6 * 60 * 60 * 1000;
      const second = fakeChart();
      new TvDrawingManager(second.chart).apply([], { recommendation: REC }, CTX_LIVE);
      await flush();
      const after = rrTools(second.multi)[0]!.points;
      assert.deepEqual(after, before, "reload must reuse the persisted anchor byte-for-byte");
    } finally {
      Date.now = realNow;
    }
  });

  it("renders an AI-drawn ChartDrawing position as the same native RR tool", async () => {
    const { chart, multi, single } = fakeChart();
    const drawing: ChartDrawing = {
      type: "short_position",
      confidence: 80,
      points: [{ time: CREATED_AT_MS, price: 4660 }],
      meta: { takeProfit: 4640, stopLoss: 4671 },
    };
    new TvDrawingManager(chart).apply([drawing], undefined, CTX_LIVE);
    await flush();
    assert.equal(nativePositionCreates(single, multi), 1);
    const boxes = rrTools(multi);
    assert.equal(boxes.length, 1);
    assert.equal(boxes[0]!.shape, "short_position");
    const left = Math.round(CREATED_AT_MS / 1000);
    const right = Math.round(LAST_BAR_MS / 1000);
    assertFinitePosition(boxes[0]!, left, right, 4660, "chart drawing");
    assert.equal(boxes[0]!.overrides?.profitLevel, priceDistanceTicks("XAUUSD", 4660, 4640));
    assert.equal(boxes[0]!.overrides?.stopLevel, priceDistanceTicks("XAUUSD", 4660, 4671));
  });

  it("a multi-target ChartDrawing position follows the same furthest-target rule", async () => {
    const { chart, multi, single } = fakeChart();
    const drawing: ChartDrawing = {
      type: "short_position",
      confidence: 80,
      points: [{ time: CREATED_AT_MS, price: 4660 }],
      meta: { stopLoss: 4671, targets: [4640, 4622.5] },
    };
    new TvDrawingManager(chart).apply([drawing], undefined, CTX_LIVE);
    await flush();
    assert.equal(
      rrTools(multi)[0]!.overrides?.profitLevel,
      priceDistanceTicks("XAUUSD", 4660, 4622.5),
    );
    const hlines = single.filter((c) => c.shape === "horizontal_line");
    assert.ok(hlines.some((c) => c.point.price === 4640 && c.options.text === "هدف 1"));
  });

  it("immediate follow-through with anchor_time stays on the print bar after new candles", async () => {
    const PRINT_MS = Date.UTC(2026, 7, 27, 17, 25, 0);
    const ISSUE_MS = PRINT_MS + 10 * 5 * 60_000;
    const rec = {
      action: "sell",
      entry: 4605.39,
      stop_loss: 4606.86,
      take_profit: 4596.89,
      targets: [4596.89, 4591.06],
      created_at: ISSUE_MS,
      anchor_time: PRINT_MS,
    } as unknown as Recommendation;
    const ctx = { symbol: "XAUUSD", interval: "5m", lastBarTime: ISSUE_MS };
    const realNow = Date.now;
    try {
      Date.now = () => ISSUE_MS;
      const first = fakeChart();
      const mgr = new TvDrawingManager(first.chart);
      mgr.apply([], { recommendation: rec }, ctx);
      await flush();
      const firstLeft = rrTools(first.multi)[0]!.points[0]!.time;
      assert.equal(firstLeft, Math.round(PRINT_MS / 1000));
      assert.notEqual(firstLeft, Math.round(ISSUE_MS / 1000));

      Date.now = () => ISSUE_MS + 10 * 5 * 60_000;
      mgr.apply([], { recommendation: rec }, ctx, { force: true });
      await flush();
      const later = rrTools(first.multi).at(-1)!.points[0]!.time;
      assert.equal(later, firstLeft, "advancing 10 bars must not move the print-time anchor");
    } finally {
      Date.now = realNow;
    }
  });

  it("a 3-target sell on rec.targets (empty trade.targets) spans entry → TP3", async () => {
    const { chart, multi, single } = fakeChart();
    const sell = {
      action: "sell",
      entry: 4616.66,
      stop_loss: 4618.88,
      take_profit: 4603.33,
      targets: [4603.33, 4593.8, 4593.71],
      created_at: CREATED_AT_MS,
    } as unknown as Recommendation;
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: sell, targets: [] },
      { symbol: "XAUUSD", interval: "5m", lastBarTime: LAST_BAR_MS },
    );
    await flush();
    assert.equal(
      rrTools(multi)[0]!.overrides?.profitLevel,
      priceDistanceTicks("XAUUSD", 4616.66, 4593.71),
      "profit edge must be TP3, not TP1",
    );
    const hlines = single.filter((c) => c.shape === "horizontal_line");
    assert.ok(
      hlines.some((c) => c.point.price === 4603.33),
      "TP1 stays a labeled line inside the extended zone",
    );
  });

  it("a zero/epoch anchor_time does not paint from t=0", async () => {
    const { chart, multi } = fakeChart();
    const rec = {
      ...REC,
      anchor_time: 0,
      created_at: CREATED_AT_MS,
    } as unknown as Recommendation;
    new TvDrawingManager(chart).apply([], { recommendation: rec }, CTX_LIVE);
    await flush();
    const boxes = rrTools(multi);
    assert.equal(boxes.length, 1);
    assert.notEqual(boxes[0]!.points[0]!.time, 0);
    assert.ok(boxes[0]!.points[0]!.time! >= MIN_PLAUSIBLE_UNIX_SEC);
    assert.equal(boxes[0]!.points[0]!.time, Math.round(CREATED_AT_MS / 1000));
  });
});

describe("tvDrawingAdapter — visual width follows lastBar, left print-anchor stays", () => {
  const PRINT_MS = Date.UTC(2026, 7, 27, 22, 30, 0);
  const LAST_BAR_MS_W = Date.UTC(2026, 7, 27, 23, 0, 0);
  const LATER_BAR_MS = Date.UTC(2026, 7, 27, 23, 45, 0);
  const SHORT = {
    action: "sell",
    entry: 4607.59,
    stop_loss: 4612.76,
    take_profit: 4591.48,
    targets: [4591.48],
    created_at: PRINT_MS,
    anchor_time: PRINT_MS,
  } as unknown as Recommendation;
  const SHORT_CTX = { symbol: "XAUUSD", interval: "5m" as const };

  function positionSetPoints(calls: SetPointsCall[]): SetPointsCall[] {
    return calls.filter((c) => c.points.length === 2);
  }

  it("left time is unchanged when lastBar advances; right follows lastBar", async () => {
    const { chart, multi, single, setPointsCalls } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    mgr.apply(
      [],
      { recommendation: SHORT },
      { ...SHORT_CTX, lastBarTime: LAST_BAR_MS_W },
    );
    await flush();

    const left = Math.round(PRINT_MS / 1000);
    const firstRight = Math.round(LAST_BAR_MS_W / 1000);
    const boxes = rrTools(multi);
    assert.equal(boxes.length, 1);
    assertFinitePosition(boxes[0]!, left, firstRight, 4607.59, "initial short");
    assert.equal(boxes[0]!.shape, "short_position");
    assert.equal(nativePositionCreates(single, multi), 1);
    assert.equal(
      single.filter((c) => c.shape === "long_position" || c.shape === "short_position")
        .length,
      0,
    );

    const createsBefore = multi.length;
    const stretchesBefore = setPointsCalls.length;
    mgr.syncRightEdge(LATER_BAR_MS);
    await flush();

    assert.equal(multi.length, createsBefore, "advancing lastBar must not delete/recreate");
    assert.ok(setPointsCalls.length > stretchesBefore, "width-only setPoints");
    const later = positionSetPoints(setPointsCalls).at(-1)!;
    assert.equal(later.points[0]!.time, left, "left stays on the print candle");
    assert.equal(later.points[1]!.time, Math.round(LATER_BAR_MS / 1000), "right tracks lastBar");
    assert.equal(later.points[0]!.price, 4607.59);
    assert.equal(later.points[1]!.price, 4607.59);
  });

  it("same rec + same lastBar is a no-op (no recreate, no extra setPoints)", async () => {
    const { chart, multi, setPointsCalls } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    const ctx = { ...SHORT_CTX, lastBarTime: LAST_BAR_MS_W };
    mgr.apply([], { recommendation: SHORT }, ctx);
    await flush();
    const creates = multi.length;
    const stretches = setPointsCalls.length;

    mgr.apply([], { recommendation: SHORT }, ctx);
    mgr.syncRightEdge(LAST_BAR_MS_W);
    await flush();
    assert.equal(multi.length, creates);
    assert.equal(setPointsCalls.length, stretches);
  });

  it("profit edge still comes from the furthest TP; advancing bars does not change SL/TP prices", async () => {
    const { chart, multi, setPointsCalls } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    const rec = {
      ...SHORT,
      take_profit: 4591.48,
      targets: [4591.48, 4580.1],
    } as unknown as Recommendation;
    mgr.apply(
      [],
      { recommendation: rec },
      { ...SHORT_CTX, lastBarTime: LAST_BAR_MS_W },
    );
    await flush();
    const first = rrTools(multi);
    assert.equal(first.length, 1);
    assert.equal(
      first[0]!.overrides?.profitLevel,
      priceDistanceTicks("XAUUSD", 4607.59, 4580.1),
      "profit edge is still the furthest (lowest) short target",
    );
    assert.equal(
      first[0]!.overrides?.stopLevel,
      priceDistanceTicks("XAUUSD", 4607.59, 4612.76),
    );

    mgr.syncRightEdge(LATER_BAR_MS);
    await flush();
    assert.equal(rrTools(multi).length, 1, "no recreate on width update");
    const later = positionSetPoints(setPointsCalls).at(-1)!;
    assert.ok(later.points.every((p) => p.price === 4607.59));
  });

  it("the Close time is lastBar already in history — never a future offset", async () => {
    const { chart, multi } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: SHORT },
      { ...SHORT_CTX, lastBarTime: LAST_BAR_MS_W },
    );
    await flush();
    const close = rrTools(multi)[0]!.points[1]!;
    assert.equal(close.time, Math.round(LAST_BAR_MS_W / 1000));
    const barSec = 5 * 60;
    assert.notEqual(
      close.time,
      Math.round(PRINT_MS / 1000) + 24 * barSec,
      "must not go back to created_at + N bars (the clamp-and-slide bug)",
    );
  });

  it("a terminal plan freezes the right edge — further lastBar advances are ignored", async () => {
    const { chart, multi, setPointsCalls } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    mgr.apply(
      [],
      { recommendation: SHORT },
      { ...SHORT_CTX, lastBarTime: LAST_BAR_MS_W },
    );
    await flush();
    const frozenRight = rrTools(multi)[0]!.points[1]!.time;
    const creates = multi.length;
    const stretches = setPointsCalls.length;

    const closed = { ...SHORT, status: "tp_hit" } as unknown as Recommendation;
    mgr.apply(
      [],
      { recommendation: closed },
      { ...SHORT_CTX, lastBarTime: LAST_BAR_MS_W },
    );
    await flush();
    mgr.syncRightEdge(LATER_BAR_MS);
    await flush();

    assert.equal(multi.length, creates, "terminal + new bars must not recreate");
    assert.equal(setPointsCalls.length, stretches, "frozen Close must not grow");
    const last = positionSetPoints(setPointsCalls).at(-1);
    if (last) {
      assert.equal(last.points[0]!.time, Math.round(PRINT_MS / 1000));
      assert.equal(last.points[1]!.time, frozenRight);
    }
  });

  it("a forced redraw of a frozen plan restores the same left and frozen right", async () => {
    const { chart, multi, setPointsCalls } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    mgr.apply(
      [],
      { recommendation: SHORT },
      { ...SHORT_CTX, lastBarTime: LAST_BAR_MS_W },
    );
    await flush();
    const closed = { ...SHORT, status: "sl_hit" } as unknown as Recommendation;
    mgr.apply(
      [],
      { recommendation: closed },
      { ...SHORT_CTX, lastBarTime: LAST_BAR_MS_W },
    );
    await flush();
    const frozen = rrTools(multi)[0]!;

    mgr.apply(
      [],
      { recommendation: closed },
      { ...SHORT_CTX, lastBarTime: LATER_BAR_MS },
      { force: true },
    );
    await flush();

    const restored = rrTools(multi).at(-1)!;
    assert.equal(restored.points[0]!.time, frozen.points[0]!.time);
    assert.equal(restored.points[1]!.time, frozen.points[1]!.time);
    assert.notEqual(
      restored.points[1]!.time,
      Math.round(LATER_BAR_MS / 1000),
      "force-redraw after SL must not pick up bars printed after close",
    );
    void setPointsCalls;
  });
});

describe("tracking ignores drawing width — evaluateRecommendation / tracker never read it", () => {
  it("evaluateRecommendation and the tracker do not import or mention position width", () => {
    const files = [
      "recommendationStatus.ts",
      "recommendationTracker.ts",
    ];
    const recDir = join(import.meta.dirname, "../../../recommendations");
    for (const name of files) {
      const src = readFileSync(join(recDir, name), "utf8");
      assert.doesNotMatch(
        src,
        /TvDrawingManager|tvDrawingAdapter|syncRightEdge|lastRightSec|positionFrozen|extendBars/,
        `${name} must not read the drawing's visual width`,
      );
      assert.doesNotMatch(
        src,
        /long_position|short_position|profitLevel/,
        `${name} grades OHLC, not the R/R box span`,
      );
    }
    const followup = readFileSync(
      join(import.meta.dirname, "../../../agent/recommendation/evaluateRecommendationStatus.ts"),
      "utf8",
    );
    assert.doesNotMatch(
      followup,
      /TvDrawingManager|tvDrawingAdapter|syncRightEdge|lastRightSec|extendBars/,
    );
  });
});

describe("planTargetList — the producer ladder the adapter consumes", () => {
  it("prefers the full targets array over take_profit = TP1", () => {
    assert.deepEqual(
      planTargetList({
        targets: [4603.33, 4593.8, 4593.71],
        takeProfit: 4603.33,
      }),
      [4603.33, 4593.8, 4593.71],
    );
  });

  it("falls back to take_profit only when no ladder is present", () => {
    assert.deepEqual(planTargetList({ takeProfit: 4603.33 }), [4603.33]);
    assert.deepEqual(planTargetList({ targets: [], takeProfit: 4603.33 }), [4603.33]);
  });

  it("parses targets_json when the array field is empty", () => {
    assert.deepEqual(
      planTargetList({
        targetsJson: "[4603.33,4593.8,4593.71]",
        takeProfit: 4603.33,
      }),
      [4603.33, 4593.8, 4593.71],
    );
  });
});

describe("paintTradeOverlay — clear-drawings must not leave the P/L box", () => {
  it("skips the native position tool when paintTradeOverlay is false", async () => {
    const { chart, multi, single } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: REC, targets: [4660.02] },
      CTX_LIVE,
      { paintTradeOverlay: false },
    );
    await flush();
    assert.equal(rrTools(multi).length, 0, "cleared live chart must not paint the P/L box");
    assert.equal(nativePositionCreates(single, multi), 0);
    assert.equal(single.length, 0, "no fallback entry/stop/TP horizontals either");
  });

  it("toggling paintTradeOverlay off removes an already-drawn box", async () => {
    const { chart, multi, removed } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    mgr.apply([], { recommendation: REC, targets: [4660.02] }, CTX_LIVE);
    await flush();
    assert.equal(rrTools(multi).length, 1);
    mgr.apply([], { recommendation: REC, targets: [4660.02] }, CTX_LIVE, {
      paintTradeOverlay: false,
    });
    await flush();
    assert.ok(removed.length > 0, "must destroy the existing position tool");
    assert.equal(
      rrTools(multi).length,
      1,
      "no second create after suppress — only the original apply drew one",
    );
  });

  it("default apply still paints the box so the report/detail chart is unchanged", async () => {
    const { chart, multi } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: REC, targets: [4660.02] },
      CTX_LIVE,
    );
    await flush();
    assert.equal(rrTools(multi).length, 1);
  });
});
