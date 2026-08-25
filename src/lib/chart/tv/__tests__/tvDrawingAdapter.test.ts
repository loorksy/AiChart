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
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TvDrawingManager } from "@/lib/chart/tv/tvDrawingAdapter";
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
