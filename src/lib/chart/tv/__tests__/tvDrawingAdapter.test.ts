/**
 * The drawn trade box must stay where it was drawn.
 *
 * Pinned from the real complaint: the profit/stop boxes drifted rightward
 * until they touched the live price ("الصندوق يتحرك حتى يلامس منطقة الدخول").
 * The cause was TradingView's single-point position tool: its second anchor
 * is completed by the library — at "now" — so every redraw stretched the box
 * to the current bar. The fix draws the risk and reward zones as explicit
 * two-anchor rectangles whose left edge is the recommendation's CREATION time
 * and whose right edge is a fixed bar span. These tests fail on the
 * single-point form and pass on the pinned rectangles.
 *
 * Second round of the same complaint ("مناطق الربح والخسارة ما زالت تتحرك مع
 * الشمعة"): the rectangles were correct, but the LIVE recommendation payload
 * reached the adapter WITHOUT `created_at` (three producers built it via an
 * `as Recommendation` cast that omitted the field), so the anchor fell back
 * to wall-clock "now" — recomputed on EVERY redraw. Any payload change (poll
 * hydration, MCP re-draw, forced re-apply, reload) rebuilt the zones hugging
 * the latest candle. The tests below simulate exactly that failing sequence:
 * draw → several new bars pass → redraw paths run → the anchors must be
 * byte-identical.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TvDrawingManager } from "@/lib/chart/tv/tvDrawingAdapter";
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
}
interface SingleCall {
  point: { time?: number; price?: number };
  shape: string;
}

function fakeChart() {
  let n = 0;
  const multi: MultiCall[] = [];
  const single: SingleCall[] = [];
  const removed: string[] = [];
  const chart = {
    createMultipointShape: (
      points: ShapePoint[],
      options: { shape: string; text?: string },
    ) => {
      multi.push({
        points: points.map((p) => ({
          time: (p as { time: number }).time,
          price: (p as { price: number }).price,
        })),
        shape: options.shape,
        text: options.text,
      });
      n += 1;
      return Promise.resolve(`shape-${n}` as EntityId);
    },
    createShape: (point: ShapePoint, options: { shape: string }) => {
      single.push({ point: point as SingleCall["point"], shape: options.shape });
      n += 1;
      return Promise.resolve(`shape-${n}` as EntityId);
    },
    removeEntity: (id: EntityId) => {
      removed.push(String(id));
    },
  } as unknown as IChartWidgetApi;
  return { chart, multi, single, removed };
}

const CREATED_AT_MS = Date.UTC(2026, 7, 24, 18, 0, 0);
const BAR_SEC = 15 * 60; // 15m interval

const REC = {
  action: "buy",
  entry: 4646.19,
  stop_loss: 4642.93,
  take_profit: 4660.02,
  created_at: CREATED_AT_MS,
} as unknown as Recommendation;

function positionRects(multi: MultiCall[]): MultiCall[] {
  return multi.filter((c) => c.shape === "rectangle");
}

describe("tvDrawingAdapter — the trade box is pinned at both ends", () => {
  it("draws the profit and loss zones as two-anchor rectangles, never a single-point position tool", async () => {
    const { chart, multi, single } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    mgr.apply([], { recommendation: REC, targets: [4660.02, 4670.46] }, { interval: "15m" });
    await flush();

    const rects = positionRects(multi);
    assert.equal(rects.length, 2, "one reward box + one risk box");
    for (const rect of rects) {
      assert.equal(rect.points.length, 2, "both anchors are supplied by us");
    }
    // The single-point API is the drift bug: TradingView completes the second
    // anchor at "now" and stretches it as price advances.
    assert.ok(
      !single.some((c) => c.shape === "long_position" || c.shape === "short_position"),
      "the single-point position tool must not be used",
    );
  });

  it("anchors the left edge at the recommendation's creation time and the right edge a fixed span later", async () => {
    const { chart, multi } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    mgr.apply([], { recommendation: REC }, { interval: "15m" });
    await flush();

    const expectedLeft = Math.round(CREATED_AT_MS / 1000);
    for (const rect of positionRects(multi)) {
      const [a, b] = rect.points;
      assert.equal(a!.time, expectedLeft, "left edge = creation time, not wall-clock now");
      assert.equal(
        b!.time - a!.time,
        BAR_SEC * 24,
        "right edge is a FIXED bar span — extending to 'now' is the reported drift",
      );
    }
  });

  it("re-applying the same payload is a no-op (poll no-flicker, no snap-back)", async () => {
    const { chart, multi } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    const trade = { recommendation: REC, targets: [4660.02] };
    mgr.apply([], trade, { interval: "15m" });
    await flush();
    const after = multi.length;

    mgr.apply([], trade, { interval: "15m" });
    mgr.apply([], { ...trade }, { interval: "15m" });
    await flush();
    assert.equal(multi.length, after, "unchanged payload must not destroy/recreate shapes");
  });

  it("a forced redraw reproduces byte-identical anchors — the box never migrates", async () => {
    const { chart, multi } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    mgr.apply([], { recommendation: REC }, { interval: "15m" });
    await flush();
    const firstAnchors = positionRects(multi).map((c) => c.points);

    mgr.apply([], { recommendation: REC }, { interval: "15m" }, { force: true });
    await flush();
    const rects = positionRects(multi);
    const secondAnchors = rects.slice(firstAnchors.length).map((c) => c.points);
    assert.deepEqual(
      secondAnchors,
      firstAnchors,
      "a redraw later in time must land on the exact same anchors",
    );
  });

  it("new bars never shift the zones — even for a legacy payload without created_at", async () => {
    // The live bug: producers delivered the recommendation WITHOUT created_at,
    // the anchor fell back to "now", and every redraw re-anchored the boxes at
    // the latest candle. The fallback must now resolve ONCE per trade and be
    // reused by every later redraw, no matter how far the clock advanced.
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

      mgr.apply([], { recommendation: noCreatedAt }, { interval: "15m" });
      await flush();
      const firstAnchors = positionRects(multi).map((c) => c.points);
      assert.equal(firstAnchors.length, 2, "both zones drawn");

      // Several new 15m candles form, then a payload change (poll hydration /
      // MCP re-draw) forces a full clear+recreate of every shape.
      clock += BAR_SEC * 5 * 1000;
      const changedDrawings: ChartDrawing[] = [
        {
          type: "price_line",
          confidence: 80,
          label: "دعم",
          points: [{ price: 4630, time: clock }],
        },
      ];
      mgr.apply(
        changedDrawings,
        { recommendation: noCreatedAt },
        { interval: "15m" },
      );
      await flush();
      let rects = positionRects(multi);
      assert.deepEqual(
        rects.slice(firstAnchors.length).map((c) => c.points),
        firstAnchors,
        "a redraw after new candles must reuse the FIRST anchor, not re-anchor at 'now'",
      );

      // More candles, then a forced re-apply (frame switch / data reload path).
      clock += BAR_SEC * 7 * 1000;
      mgr.apply(
        changedDrawings,
        { recommendation: noCreatedAt },
        { interval: "15m" },
        { force: true },
      );
      await flush();
      rects = positionRects(multi);
      assert.deepEqual(
        rects.slice(rects.length - 2).map((c) => c.points),
        firstAnchors,
        "a forced redraw later in time must also land on the original anchors",
      );
    } finally {
      Date.now = realNow;
    }
  });

  it("a reload reproduces the anchors from the persisted created_at, not from 'now'", async () => {
    // Page reload = a brand-new manager with the clock far ahead. The zones
    // stay exactly where drawn because the anchor comes from the STORED
    // recommendation data (created_at), never from render time.
    const realNow = Date.now;
    try {
      Date.now = () => CREATED_AT_MS;
      const first = fakeChart();
      new TvDrawingManager(first.chart).apply(
        [],
        { recommendation: REC },
        { interval: "15m" },
      );
      await flush();
      const before = positionRects(first.multi).map((c) => c.points);

      // Hours later, a fresh widget + manager hydrate the same stored payload.
      Date.now = () => CREATED_AT_MS + 6 * 60 * 60 * 1000;
      const second = fakeChart();
      new TvDrawingManager(second.chart).apply(
        [],
        { recommendation: REC },
        { interval: "15m" },
      );
      await flush();
      const after = positionRects(second.multi).map((c) => c.points);
      assert.deepEqual(after, before, "reload must reuse the persisted anchor byte-for-byte");
    } finally {
      Date.now = realNow;
    }
  });

  it("covers the price extents: reward from entry to TP, risk from entry to SL", async () => {
    const { chart, multi } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    mgr.apply([], { recommendation: REC }, { interval: "15m" });
    await flush();

    const rects = positionRects(multi);
    const prices = rects.map((r) => r.points.map((p) => p.price).sort((x, y) => x - y));
    assert.deepEqual(
      prices.find((p) => p[1] === 4660.02),
      [4646.19, 4660.02],
      "reward box spans entry → TP1",
    );
    assert.deepEqual(
      prices.find((p) => p[0] === 4642.93),
      [4642.93, 4646.19],
      "risk box spans SL → entry",
    );
  });
});
