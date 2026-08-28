/**
 * The drawn trade zones must be a TIME-BOUNDED box, pinned where the plan
 * was issued — not an infinite price band across the visible pane.
 *
 * History of the complaint this file pins, in order:
 * 1. "الصندوق يتحرك حتى يلامس منطقة الدخول" — the zones slid because every
 *    redraw re-anchored them at wall-clock "now". Fixed by persisting
 *    `created_at` + a sticky per-trade fallback anchor.
 * 2. "المناطق تتمدد مع حركة الشموع" — hand-drawn rectangles placed their
 *    RIGHT anchor at created_at + 24 bars, a time in the FUTURE. This
 *    library build clamps that to the MOVING last bar, so the pair
 *    degenerated into a thin column hugging the live candle.
 * 3. Native `long_position`/`short_position` (single-point create) filled
 *    the pane as a full-width horizontal band: a left time that failed to
 *    resolve (0 / epoch / before loaded history) clamped to the FIRST bar,
 *    and the Close grew to lastBar — so the fill covered all visible
 *    history. This widget version also ignores X on those tools.
 * 4. The box is now two rectangles whose LEFT is the print/anchor candle
 *    and whose RIGHT is lastBar already in history. No future Close. The
 *    native position tool is not used for the fill.
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
  isPlausibleUnixSec,
  MIN_PLAUSIBLE_UNIX_SEC,
} from "@/lib/chart/tv/tvDrawingAdapter";
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

function fakeChart() {
  let n = 0;
  const multi: MultiCall[] = [];
  const single: SingleCall[] = [];
  const removed: string[] = [];
  const setPointsCalls: SetPointsCall[] = [];
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
    }),
  } as unknown as IChartWidgetApi;
  return { chart, multi, single, removed, setPointsCalls, shapes };
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

function plRects(multi: MultiCall[]): MultiCall[] {
  return multi.filter((c) => c.shape === "rectangle");
}

function nativePositionCalls(single: SingleCall[], multi: MultiCall[]): number {
  return (
    single.filter((c) => c.shape === "long_position" || c.shape === "short_position")
      .length +
    multi.filter((c) => c.shape === "long_position" || c.shape === "short_position")
      .length
  );
}

function rectByPrice(rects: MultiCall[], price: number): MultiCall | undefined {
  return rects.find((c) => c.points.some((p) => p.price === price));
}

function assertFiniteBox(
  rect: MultiCall,
  leftSec: number,
  rightSec: number,
  label: string,
): void {
  assert.equal(rect.points.length, 2, `${label}: two time anchors`);
  const times = rect.points.map((p) => p.time);
  assert.equal(times[0], leftSec, `${label}: left is the print/anchor`);
  assert.equal(times[1], rightSec, `${label}: right is lastBar`);
  assert.ok(Number.isFinite(times[0]!), `${label}: left is finite`);
  assert.ok(Number.isFinite(times[1]!), `${label}: right is finite`);
  assert.ok(times[1]! > times[0]!, `${label}: width is finite (right > left)`);
  assert.ok(
    times[0]! >= MIN_PLAUSIBLE_UNIX_SEC,
    `${label}: left is not t=0 / epoch`,
  );
  assert.equal(rect.overrides?.extendLeft, false, `${label}: must not extend left`);
  assert.equal(rect.overrides?.extendRight, false, `${label}: must not extend right`);
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
});

describe("tvDrawingAdapter — time-bounded P/L rectangles, pinned at print time", () => {
  it("draws TWO rectangles for a buy — never native long_position/short_position", async () => {
    const { chart, multi, single } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: REC, targets: [4660.02, 4670.46] },
      CTX_LIVE,
    );
    await flush();

    const rects = plRects(multi);
    assert.equal(rects.length, 2, "profit + risk rectangles");
    assert.equal(
      nativePositionCalls(single, multi),
      0,
      "native position tools paint as infinite price bands on this widget",
    );
  });

  it("does not create the box until lastBar is known — no future Close guess", async () => {
    const { chart, multi, setPointsCalls } = fakeChart();
    new TvDrawingManager(chart).apply([], { recommendation: REC }, CTX);
    await flush();
    assert.equal(plRects(multi).length, 0, "no box without lastBar");
    assert.equal(setPointsCalls.length, 0);
  });

  it("syncRightEdge after apply without lastBar creates the finite box (first candle)", async () => {
    const { chart, multi } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    mgr.apply([], { recommendation: REC }, CTX);
    await flush();
    assert.equal(plRects(multi).length, 0);
    mgr.syncRightEdge(LAST_BAR_MS);
    await flush();
    const rects = plRects(multi);
    assert.equal(rects.length, 2);
    const left = Math.round(CREATED_AT_MS / 1000);
    const right = Math.round(LAST_BAR_MS / 1000);
    for (const r of rects) {
      assertFiniteBox(r, left, right, "late lastBar");
    }
  });

  it("anchors the LEFT of both rectangles at created_at, RIGHT at lastBar", async () => {
    const { chart, multi } = fakeChart();
    new TvDrawingManager(chart).apply([], { recommendation: REC }, CTX_LIVE);
    await flush();

    const left = Math.round(CREATED_AT_MS / 1000);
    const right = Math.round(LAST_BAR_MS / 1000);
    const rects = plRects(multi);
    assert.equal(rects.length, 2);
    for (const r of rects) {
      assertFiniteBox(r, left, right, "buy box");
      assert.equal(r.points[0]!.price, 4646.19);
    }
    assert.notEqual(left, right);
    assert.notEqual(left, Math.round(LAST_BAR_MS / 1000));
  });

  it("profit rectangle spans entry → furthest TP; risk spans entry → stop", async () => {
    const { chart, multi } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: REC, targets: [4660.02, 4680.1, 4670.46] },
      CTX_LIVE,
    );
    await flush();
    const rects = plRects(multi);
    const profit = rectByPrice(rects, 4680.1);
    const risk = rectByPrice(rects, 4642.93);
    assert.ok(profit, "profit edge is the most distant TP, not TP1");
    assert.ok(risk, "risk edge is the stop");
    assert.equal(profit!.overrides?.backgroundColor, "#22c55e");
    assert.equal(risk!.overrides?.backgroundColor, "#ef4444");
  });

  it("extends the profit zone to the FURTHEST target of a sell (min)", async () => {
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
    const profit = rectByPrice(plRects(multi), 4622.5);
    assert.ok(profit, "for a sell the furthest target is the LOWEST price");
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

  it("a single-target plan spans entry → the only TP", async () => {
    const { chart, multi } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: REC, targets: [4660.02] },
      CTX_LIVE,
    );
    await flush();
    const profit = rectByPrice(plRects(multi), 4660.02);
    assert.ok(profit);
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
    const first = plRects(multi).map((r) => r.points);

    mgr.apply([], { recommendation: REC }, CTX_LIVE, { force: true });
    await flush();
    const second = plRects(multi).slice(-2).map((r) => r.points);
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
      assert.equal(plRects(multi).length, 0);

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
      const rects = plRects(multi);
      assert.equal(rects.length, 2);
      const left = Math.round(firstLast / 1000);
      const right = Math.round(laterLast / 1000);
      for (const r of rects) {
        assertFiniteBox(r, left, right, "legacy fallback");
      }

      clock += BAR_SEC * 7 * 1000;
      const laterStill = laterLast + BAR_SEC * 7 * 1000;
      mgr.apply(changedDrawings, { recommendation: noCreatedAt }, {
        ...CTX,
        lastBarTime: laterStill,
      }, { force: true });
      await flush();
      const restored = plRects(multi).slice(-2);
      for (const r of restored) {
        assert.equal(r.points[0]!.time, left, "forced redraw keeps the first fallback left");
        assert.notEqual(r.points[0]!.time, 0);
      }
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
      const before = plRects(first.multi)[0]!.points;

      Date.now = () => CREATED_AT_MS + 6 * 60 * 60 * 1000;
      const second = fakeChart();
      new TvDrawingManager(second.chart).apply([], { recommendation: REC }, CTX_LIVE);
      await flush();
      const after = plRects(second.multi)[0]!.points;
      assert.deepEqual(after, before, "reload must reuse the persisted anchor byte-for-byte");
    } finally {
      Date.now = realNow;
    }
  });

  it("renders an AI-drawn ChartDrawing position through the same time-bounded rectangles", async () => {
    const { chart, multi, single } = fakeChart();
    const drawing: ChartDrawing = {
      type: "short_position",
      confidence: 80,
      points: [{ time: CREATED_AT_MS, price: 4660 }],
      meta: { takeProfit: 4640, stopLoss: 4671 },
    };
    new TvDrawingManager(chart).apply([drawing], undefined, CTX_LIVE);
    await flush();
    assert.equal(nativePositionCalls(single, multi), 0);
    const rects = plRects(multi);
    assert.equal(rects.length, 2);
    const left = Math.round(CREATED_AT_MS / 1000);
    const right = Math.round(LAST_BAR_MS / 1000);
    for (const r of rects) assertFiniteBox(r, left, right, "chart drawing");
    assert.ok(rectByPrice(rects, 4640));
    assert.ok(rectByPrice(rects, 4671));
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
    assert.ok(rectByPrice(plRects(multi), 4622.5));
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
      const firstLeft = plRects(first.multi)[0]!.points[0]!.time;
      assert.equal(firstLeft, Math.round(PRINT_MS / 1000));
      assert.notEqual(firstLeft, Math.round(ISSUE_MS / 1000));

      Date.now = () => ISSUE_MS + 10 * 5 * 60_000;
      mgr.apply([], { recommendation: rec }, ctx, { force: true });
      await flush();
      const later = plRects(first.multi).at(-1)!.points[0]!.time;
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
    assert.ok(
      rectByPrice(plRects(multi), 4593.71),
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
    const rects = plRects(multi);
    assert.equal(rects.length, 2);
    for (const r of rects) {
      assert.notEqual(r.points[0]!.time, 0);
      assert.ok(r.points[0]!.time! >= MIN_PLAUSIBLE_UNIX_SEC);
      assert.equal(r.points[0]!.time, Math.round(CREATED_AT_MS / 1000));
    }
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
    return calls.filter((c) => c.points.length >= 2);
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
    for (const r of plRects(multi)) {
      assertFiniteBox(r, left, firstRight, "initial short");
      assert.equal(r.points[0]!.price, 4607.59);
    }
    assert.equal(nativePositionCalls(single, multi), 0);

    const createsBefore = multi.length;
    const stretchesBefore = setPointsCalls.length;
    mgr.syncRightEdge(LATER_BAR_MS);
    await flush();

    assert.equal(multi.length, createsBefore, "advancing lastBar must not delete/recreate");
    assert.ok(setPointsCalls.length > stretchesBefore, "width-only setPoints");
    const later = positionSetPoints(setPointsCalls).at(-1)!;
    assert.equal(later.points[0]!.time, left, "left stays on the print candle");
    assert.equal(later.points[1]!.time, Math.round(LATER_BAR_MS / 1000), "right tracks lastBar");
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
    const first = plRects(multi);
    assert.ok(rectByPrice(first, 4580.1), "profit edge is still the furthest (lowest) short target");
    assert.ok(rectByPrice(first, 4612.76));

    mgr.syncRightEdge(LATER_BAR_MS);
    await flush();
    assert.equal(plRects(multi).length, 2, "no recreate on width update");
    const later = positionSetPoints(setPointsCalls).at(-1)!;
    assert.ok(
      later.points.some((p) => p.price === 4607.59) ||
        later.points.some((p) => p.price === 4580.1) ||
        later.points.some((p) => p.price === 4612.76),
    );
  });

  it("the Close time is lastBar already in history — never a future offset", async () => {
    const { chart, multi } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: SHORT },
      { ...SHORT_CTX, lastBarTime: LAST_BAR_MS_W },
    );
    await flush();
    const close = plRects(multi)[0]!.points[1]!;
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
    const frozenRight = plRects(multi)[0]!.points[1]!.time;
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
    const frozen = plRects(multi)[0]!;

    mgr.apply(
      [],
      { recommendation: closed },
      { ...SHORT_CTX, lastBarTime: LATER_BAR_MS },
      { force: true },
    );
    await flush();

    const restored = plRects(multi).slice(-2)[0]!;
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
