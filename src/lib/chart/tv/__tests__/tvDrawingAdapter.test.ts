/**
 * The drawn trade zones must be TradingView's NATIVE position tool, pinned
 * where the plan was issued.
 *
 * History of the complaint this file pins, in order:
 * 1. "الصندوق يتحرك حتى يلامس منطقة الدخول" — the zones slid because every
 *    redraw re-anchored them at wall-clock "now" (the live recommendation
 *    payload lost `created_at` behind an `as Recommendation` cast). Fixed by
 *    persisting `created_at` + a sticky per-trade fallback anchor.
 * 2. "المناطق تتمدد مع حركة الشموع" — the then hand-drawn rectangles placed
 *    their RIGHT anchor at created_at + 24 bars, a time in the FUTURE. This
 *    library build cannot resolve a future time to a stable bar: it clamps
 *    it to the MOVING last bar, so the pair degenerated into a thin column
 *    hugging the live candle that widened with every new bar.
 * 3. The user asked for the native tool: `long_position`/`short_position`
 *    (LineToolRiskRewardLong/Short) — SINGLE-point creation at the entry,
 *    profit/stop as TICK levels via overrides (the library special-cases
 *    exactly `profitLevel`/`stopLevel` for these tools), body synthesized
 *    by the tool itself as a fixed INDEX span. No anchor in the future, no
 *    text option (the library throws on it for position tools).
 *
 * The tests simulate the failing sequences: draw → several new bars pass →
 * redraw/force/reload paths run → the anchor must be byte-identical.
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
  options: Record<string, unknown>;
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
      single.push({
        point: point as SingleCall["point"],
        shape: options.shape,
        options: options as unknown as Record<string, unknown>,
      });
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

const CTX = { symbol: "XAUUSD", interval: "15m" };

function positionCalls(single: SingleCall[]): SingleCall[] {
  return single.filter(
    (c) => c.shape === "long_position" || c.shape === "short_position",
  );
}

describe("tvDrawingAdapter — the native position tool, pinned at the plan's creation", () => {
  it("draws ONE native long_position for a buy — never hand-drawn rectangles", async () => {
    const { chart, multi, single } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: REC, targets: [4660.02, 4670.46] },
      CTX,
    );
    await flush();

    const tools = positionCalls(single);
    assert.equal(tools.length, 1, "exactly one position tool");
    assert.equal(tools[0]!.shape, "long_position");
    assert.ok(
      !multi.some((c) => c.shape === "rectangle"),
      "the rectangle pair is the degenerate-column bug — the native tool replaces it",
    );
  });

  it("draws short_position for a sell", async () => {
    const { chart, single } = fakeChart();
    const sell = {
      ...REC,
      action: "sell",
      entry: 4660,
      stop_loss: 4671,
      take_profit: 4640,
    } as unknown as Recommendation;
    new TvDrawingManager(chart).apply([], { recommendation: sell }, CTX);
    await flush();
    assert.equal(positionCalls(single)[0]?.shape, "short_position");
  });

  it("anchors the single entry point at the recommendation's creation time and entry price", async () => {
    const { chart, single } = fakeChart();
    new TvDrawingManager(chart).apply([], { recommendation: REC }, CTX);
    await flush();

    const tool = positionCalls(single)[0]!;
    assert.equal(tool.point.time, Math.round(CREATED_AT_MS / 1000));
    assert.equal(tool.point.price, 4646.19);
  });

  it("supplies NO second time anchor — a future anchor is the thin-expanding-column bug", async () => {
    const { chart, multi, single } = fakeChart();
    new TvDrawingManager(chart).apply([], { recommendation: REC }, CTX);
    await flush();

    // This build clamps any time beyond the last bar to the MOVING last bar,
    // so a caller-supplied right edge collapses onto the live candle and
    // crawls right with every new bar. The tool must synthesize its own
    // fixed INDEX-based body from the one entry point.
    assert.equal(positionCalls(single).length, 1, "single-point creation only");
    assert.ok(
      !multi.some(
        (c) => c.shape === "long_position" || c.shape === "short_position",
      ),
      "the position tool must not be created through the multipoint API",
    );
  });

  it("converts profit/stop to TICKS from the datafeed's symbol info (XAUUSD: 2 decimals)", async () => {
    const { chart, single } = fakeChart();
    new TvDrawingManager(chart).apply([], { recommendation: REC }, CTX);
    await flush();

    const overrides = positionCalls(single)[0]!.options.overrides as Record<
      string,
      number
    >;
    // pricescale/minmov for XAU* is 100/1 → 1 tick = 0.01.
    assert.equal(overrides.profitLevel, Math.round((4660.02 - 4646.19) * 100));
    assert.equal(overrides.stopLevel, Math.round((4646.19 - 4642.93) * 100));
  });

  it("never sets `text` on the position tool — the library throws and the shape silently vanishes", async () => {
    const { chart, single } = fakeChart();
    new TvDrawingManager(chart).apply([], { recommendation: REC }, CTX);
    await flush();
    assert.ok(
      !("text" in positionCalls(single)[0]!.options),
      "position tools generate their own stats label; caller text throws 'Value is undefined'",
    );
  });

  it("keeps extra targets beyond TP1 as labeled lines — the tool shows one profit level", async () => {
    const { chart, single } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: REC, targets: [4660.02, 4670.46, 4680.1] },
      CTX,
    );
    await flush();
    const hlines = single.filter((c) => c.shape === "horizontal_line");
    assert.equal(hlines.length, 2, "TP2 and TP3 lines");
  });

  it("re-applying the same payload is a no-op (poll no-flicker, no snap-back)", async () => {
    const { chart, single } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    const trade = { recommendation: REC, targets: [4660.02] };
    mgr.apply([], trade, CTX);
    await flush();
    const after = single.length;

    mgr.apply([], trade, CTX);
    mgr.apply([], { ...trade }, CTX);
    await flush();
    assert.equal(single.length, after, "unchanged payload must not destroy/recreate shapes");
  });

  it("a forced redraw reproduces a byte-identical anchor and levels — the tool never migrates", async () => {
    const { chart, single } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    mgr.apply([], { recommendation: REC }, CTX);
    await flush();
    const first = positionCalls(single)[0]!;

    mgr.apply([], { recommendation: REC }, CTX, { force: true });
    await flush();
    const second = positionCalls(single)[1]!;
    assert.deepEqual(second.point, first.point, "same entry anchor");
    assert.deepEqual(
      second.options.overrides,
      first.options.overrides,
      "same tick levels",
    );
  });

  it("new bars never shift the tool — even for a legacy payload without created_at", async () => {
    // The live bug: producers delivered the recommendation WITHOUT created_at,
    // the anchor fell back to "now", and every redraw re-anchored the zones at
    // the latest candle. The fallback must resolve ONCE per trade and be
    // reused by every later redraw, no matter how far the clock advanced.
    const noCreatedAt = {
      action: "buy",
      entry: 4646.19,
      stop_loss: 4642.93,
      take_profit: 4660.02,
    } as unknown as Recommendation;
    const { chart, single } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    const realNow = Date.now;
    try {
      let clock = Date.UTC(2026, 7, 25, 12, 0, 0);
      Date.now = () => clock;

      mgr.apply([], { recommendation: noCreatedAt }, CTX);
      await flush();
      const firstAnchor = positionCalls(single)[0]!.point;

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
      mgr.apply(changedDrawings, { recommendation: noCreatedAt }, CTX);
      await flush();
      assert.deepEqual(
        positionCalls(single)[1]!.point,
        firstAnchor,
        "a redraw after new candles must reuse the FIRST anchor, not re-anchor at 'now'",
      );

      // More candles, then a forced re-apply (frame switch / data reload path).
      clock += BAR_SEC * 7 * 1000;
      mgr.apply(changedDrawings, { recommendation: noCreatedAt }, CTX, {
        force: true,
      });
      await flush();
      assert.deepEqual(
        positionCalls(single)[2]!.point,
        firstAnchor,
        "a forced redraw later in time must also land on the original anchor",
      );
    } finally {
      Date.now = realNow;
    }
  });

  it("a reload reproduces the anchor from the persisted created_at, not from 'now'", async () => {
    // Page reload = a brand-new manager with the clock far ahead. The tool
    // stays exactly where drawn because the anchor comes from the STORED
    // recommendation data (created_at), never from render time.
    const realNow = Date.now;
    try {
      Date.now = () => CREATED_AT_MS;
      const first = fakeChart();
      new TvDrawingManager(first.chart).apply([], { recommendation: REC }, CTX);
      await flush();
      const before = positionCalls(first.single)[0]!;

      // Hours later, a fresh widget + manager hydrate the same stored payload.
      Date.now = () => CREATED_AT_MS + 6 * 60 * 60 * 1000;
      const second = fakeChart();
      new TvDrawingManager(second.chart).apply([], { recommendation: REC }, CTX);
      await flush();
      const after = positionCalls(second.single)[0]!;
      assert.deepEqual(after.point, before.point, "reload must reuse the persisted anchor byte-for-byte");
      assert.deepEqual(after.options.overrides, before.options.overrides);
    } finally {
      Date.now = realNow;
    }
  });

  it("renders the AI-drawn long_position/short_position ChartDrawing through the same native tool", async () => {
    const { chart, single } = fakeChart();
    const drawing: ChartDrawing = {
      type: "short_position",
      confidence: 80,
      points: [{ time: CREATED_AT_MS, price: 4660 }],
      meta: { takeProfit: 4640, stopLoss: 4671 },
    };
    new TvDrawingManager(chart).apply([drawing], undefined, CTX);
    await flush();
    const tool = positionCalls(single)[0]!;
    assert.equal(tool.shape, "short_position");
    assert.equal(tool.point.time, Math.round(CREATED_AT_MS / 1000));
    const overrides = tool.options.overrides as Record<string, number>;
    assert.equal(overrides.profitLevel, Math.round((4660 - 4640) * 100));
    assert.equal(overrides.stopLevel, Math.round((4671 - 4660) * 100));
  });
});
