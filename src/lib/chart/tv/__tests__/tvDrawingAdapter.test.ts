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
 *    by the tool itself as a fixed INDEX span. No FUTURE time anchor (that
 *    is the thin expanding column / sliding left edge). The Close point is
 *    then `setPoints`'d to the latest in-history bar so live candles stay
 *    inside the R/R body until the plan is terminal — visual width only.
 *
 * The tests simulate the failing sequences: draw → several new bars pass →
 * redraw/force/reload paths run → the LEFT anchor must be byte-identical
 * while the RIGHT/width follows lastBar.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { TvDrawingManager } from "@/lib/chart/tv/tvDrawingAdapter";
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
    const { chart, multi, single, setPointsCalls } = fakeChart();
    new TvDrawingManager(chart).apply([], { recommendation: REC }, CTX);
    await flush();

    // This build clamps any time beyond the last bar to the MOVING last bar,
    // so a caller-supplied FUTURE right edge collapses onto the live candle
    // and can slide the LEFT with it. Without a lastBar already in history
    // we must not invent a Close time: the tool synthesizes its own INDEX
    // body from the one entry point (width then grows via setPoints later).
    assert.equal(positionCalls(single).length, 1, "single-point creation only");
    assert.equal(setPointsCalls.length, 0, "no Close write until lastBar is known");
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

  it("extends the profit zone to the FURTHEST target of a buy (max), not TP1", async () => {
    const { chart, single } = fakeChart();
    // Deliberately unsorted: the furthest target is picked by VALUE, side-aware.
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: REC, targets: [4660.02, 4680.1, 4670.46] },
      CTX,
    );
    await flush();

    const overrides = positionCalls(single)[0]!.options.overrides as Record<
      string,
      number
    >;
    assert.equal(
      overrides.profitLevel,
      Math.round((4680.1 - 4646.19) * 100),
      "the tool's profit edge must be the most distant TP, not the first",
    );
    assert.equal(overrides.stopLevel, Math.round((4646.19 - 4642.93) * 100));
  });

  it("extends the profit zone to the FURTHEST target of a sell (min)", async () => {
    const { chart, single } = fakeChart();
    const sell = {
      ...REC,
      action: "sell",
      entry: 4660,
      stop_loss: 4671,
    } as unknown as Recommendation;
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: sell, targets: [4640, 4622.5, 4635] },
      CTX,
    );
    await flush();

    const overrides = positionCalls(single)[0]!.options.overrides as Record<
      string,
      number
    >;
    assert.equal(
      overrides.profitLevel,
      Math.round((4660 - 4622.5) * 100),
      "for a sell the furthest target is the LOWEST price",
    );
  });

  it("keeps the intermediate targets as labeled lines inside the extended zone", async () => {
    const { chart, single } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: REC, targets: [4660.02, 4670.46, 4680.1] },
      CTX,
    );
    await flush();

    // TP3 is now the tool's profit edge, so TP1 and TP2 become the lines —
    // numbered by their original order in the plan.
    const hlines = single.filter((c) => c.shape === "horizontal_line");
    assert.deepEqual(
      hlines.map((c) => ({ price: c.point.price, text: c.options.text })),
      [
        { price: 4660.02, text: "هدف 1" },
        { price: 4670.46, text: "هدف 2" },
      ],
      "every target that is not the tool's edge stays visible as a numbered line",
    );
  });

  it("a single-target plan is unchanged: the tool spans entry → the only TP, no lines", async () => {
    const { chart, single } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: REC, targets: [4660.02] },
      CTX,
    );
    await flush();

    const overrides = positionCalls(single)[0]!.options.overrides as Record<
      string,
      number
    >;
    assert.equal(overrides.profitLevel, Math.round((4660.02 - 4646.19) * 100));
    assert.equal(
      single.filter((c) => c.shape === "horizontal_line").length,
      0,
      "no intermediate target lines for a one-target plan",
    );
  });

  it("re-applying the same payload is a no-op (poll no-flicker, no snap-back)", async () => {
    const { chart, single } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    const trade = { recommendation: REC, targets: [4660.02, 4670.46] };
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

  it("a multi-target ChartDrawing position follows the same furthest-target rule", async () => {
    const { chart, single } = fakeChart();
    const drawing: ChartDrawing = {
      type: "short_position",
      confidence: 80,
      points: [{ time: CREATED_AT_MS, price: 4660 }],
      meta: { stopLoss: 4671, targets: [4640, 4622.5] },
    };
    new TvDrawingManager(chart).apply([drawing], undefined, CTX);
    await flush();

    const overrides = positionCalls(single)[0]!.options.overrides as Record<
      string,
      number
    >;
    assert.equal(
      overrides.profitLevel,
      Math.round((4660 - 4622.5) * 100),
      "the tool's edge is the furthest (lowest) target of the short",
    );
    const hlines = single.filter((c) => c.shape === "horizontal_line");
    assert.deepEqual(
      hlines.map((c) => ({ price: c.point.price, text: c.options.text })),
      [{ price: 4640, text: "هدف 1" }],
      "the nearer target stays visible as a numbered line",
    );
  });

  it("immediate follow-through with anchor_time stays on the print bar after new candles", async () => {
    // The drawing-anchor bug: created_at is "now" at issue time, so the
    // native position tool sat on the latest bar even though the 4605.39
    // touch printed several bars earlier. `anchor_time` is the print bar;
    // advancing the clock 10 bars and redrawing must not move it.
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
    const ctx = { symbol: "XAUUSD", interval: "5m" };
    const realNow = Date.now;
    try {
      Date.now = () => ISSUE_MS;
      const first = fakeChart();
      const mgr = new TvDrawingManager(first.chart);
      mgr.apply([], { recommendation: rec }, ctx);
      await flush();
      const firstAnchor = positionCalls(first.single)[0]!.point;
      assert.equal(firstAnchor.time, Math.round(PRINT_MS / 1000));
      assert.notEqual(firstAnchor.time, Math.round(ISSUE_MS / 1000));

      Date.now = () => ISSUE_MS + 10 * 5 * 60_000;
      mgr.apply([], { recommendation: rec }, ctx, { force: true });
      await flush();
      const later = positionCalls(first.single)[1]!.point;
      assert.deepEqual(later, firstAnchor, "advancing 10 bars must not move the print-time anchor");
    } finally {
      Date.now = realNow;
    }
  });

  it("a 3-target sell on rec.targets (empty trade.targets) spans entry → TP3", async () => {
    // Production path: the chart payload used to send only take_profit = TP1
    // while the full ladder lived on rec.targets. The adapter must read it.
    const { chart, single } = fakeChart();
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
      { symbol: "XAUUSD", interval: "5m" },
    );
    await flush();

    const overrides = positionCalls(single)[0]!.options.overrides as Record<
      string,
      number
    >;
    assert.equal(
      overrides.profitLevel,
      Math.round(Math.abs(4616.66 - 4593.71) * 100),
      "profitLevel ticks must equal |entry − TP3|, not |entry − TP1|",
    );
    const hlines = single.filter((c) => c.shape === "horizontal_line");
    assert.ok(
      hlines.some((c) => c.point.price === 4603.33),
      "TP1 stays a labeled line inside the extended zone",
    );
  });
});

describe("tvDrawingAdapter — visual width follows lastBar, left print-anchor stays", () => {
  const PRINT_MS = Date.UTC(2026, 7, 27, 22, 30, 0);
  const LAST_BAR_MS = Date.UTC(2026, 7, 27, 23, 0, 0);
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
    const { chart, single, setPointsCalls } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    mgr.apply(
      [],
      { recommendation: SHORT },
      { ...SHORT_CTX, lastBarTime: LAST_BAR_MS },
    );
    await flush();

    const created = positionCalls(single)[0]!;
    assert.equal(created.point.time, Math.round(PRINT_MS / 1000));
    assert.equal(created.point.price, 4607.59);

    const firstStretch = positionSetPoints(setPointsCalls)[0]!;
    assert.equal(firstStretch.points[0]!.time, Math.round(PRINT_MS / 1000));
    assert.equal(firstStretch.points[0]!.price, 4607.59);
    assert.equal(firstStretch.points[1]!.time, Math.round(LAST_BAR_MS / 1000));
    assert.equal(firstStretch.points[1]!.price, 4607.59);

    const createsBefore = single.length;
    const stretchesBefore = setPointsCalls.length;
    mgr.syncRightEdge(LATER_BAR_MS);
    await flush();

    assert.equal(single.length, createsBefore, "advancing lastBar must not delete/recreate");
    assert.equal(setPointsCalls.length, stretchesBefore + 1, "width-only setPoints");
    const later = positionSetPoints(setPointsCalls).at(-1)!;
    assert.equal(later.points[0]!.time, Math.round(PRINT_MS / 1000), "left stays on the print candle");
    assert.equal(later.points[1]!.time, Math.round(LATER_BAR_MS / 1000), "right tracks lastBar");
  });

  it("same rec + same lastBar is a no-op (no recreate, no extra setPoints)", async () => {
    const { chart, single, setPointsCalls } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    const ctx = { ...SHORT_CTX, lastBarTime: LAST_BAR_MS };
    mgr.apply([], { recommendation: SHORT }, ctx);
    await flush();
    const creates = single.length;
    const stretches = setPointsCalls.length;

    mgr.apply([], { recommendation: SHORT }, ctx);
    mgr.syncRightEdge(LAST_BAR_MS);
    await flush();
    assert.equal(single.length, creates);
    assert.equal(setPointsCalls.length, stretches);
  });

  it("profitLevel still comes from the furthest TP; advancing bars does not change SL/TP prices", async () => {
    const { chart, single, setPointsCalls } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    const rec = {
      ...SHORT,
      take_profit: 4591.48,
      targets: [4591.48, 4580.1],
    } as unknown as Recommendation;
    mgr.apply(
      [],
      { recommendation: rec },
      { ...SHORT_CTX, lastBarTime: LAST_BAR_MS },
    );
    await flush();
    const first = positionCalls(single)[0]!;
    const overrides = first.options.overrides as Record<string, number>;
    assert.equal(
      overrides.profitLevel,
      Math.round((4607.59 - 4580.1) * 100),
      "profit edge is still the furthest (lowest) short target",
    );
    assert.equal(overrides.stopLevel, Math.round((4612.76 - 4607.59) * 100));

    mgr.syncRightEdge(LATER_BAR_MS);
    await flush();
    assert.equal(positionCalls(single).length, 1, "no recreate on width update");
    const laterOverrides = positionCalls(single)[0]!.options.overrides as Record<
      string,
      number
    >;
    assert.deepEqual(laterOverrides, overrides, "SL/TP tick levels are unchanged");
    const later = positionSetPoints(setPointsCalls).at(-1)!;
    assert.equal(later.points[0]!.price, 4607.59);
    assert.equal(later.points[1]!.price, 4607.59);
  });

  it("the Close time is lastBar already in history — never a future offset", async () => {
    const { chart, setPointsCalls } = fakeChart();
    new TvDrawingManager(chart).apply(
      [],
      { recommendation: SHORT },
      { ...SHORT_CTX, lastBarTime: LAST_BAR_MS },
    );
    await flush();
    const close = positionSetPoints(setPointsCalls)[0]!.points[1]!;
    assert.equal(close.time, Math.round(LAST_BAR_MS / 1000));
    assert.ok(
      close.time! <= Math.round(LAST_BAR_MS / 1000),
      "Close must not live in the future of lastBar",
    );
    const barSec = 5 * 60;
    assert.notEqual(
      close.time,
      Math.round(PRINT_MS / 1000) + 24 * barSec,
      "must not go back to created_at + N bars (the clamp-and-slide bug)",
    );
  });

  it("a terminal plan freezes the right edge — further lastBar advances are ignored", async () => {
    const { chart, single, setPointsCalls } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    mgr.apply(
      [],
      { recommendation: SHORT },
      { ...SHORT_CTX, lastBarTime: LAST_BAR_MS },
    );
    await flush();
    const frozenRight = positionSetPoints(setPointsCalls).at(-1)!.points[1]!.time;
    const creates = single.length;
    const stretches = setPointsCalls.length;

    const closed = { ...SHORT, status: "tp_hit" } as unknown as Recommendation;
    mgr.apply(
      [],
      { recommendation: closed },
      { ...SHORT_CTX, lastBarTime: LAST_BAR_MS },
    );
    await flush();
    mgr.syncRightEdge(LATER_BAR_MS);
    await flush();

    assert.equal(single.length, creates, "terminal + new bars must not recreate");
    assert.equal(setPointsCalls.length, stretches, "frozen Close must not grow");
    const last = positionSetPoints(setPointsCalls).at(-1)!;
    assert.equal(last.points[0]!.time, Math.round(PRINT_MS / 1000));
    assert.equal(last.points[1]!.time, frozenRight);
  });

  it("a forced redraw of a frozen plan restores the same left and frozen right", async () => {
    const { chart, single, setPointsCalls } = fakeChart();
    const mgr = new TvDrawingManager(chart);
    mgr.apply(
      [],
      { recommendation: SHORT },
      { ...SHORT_CTX, lastBarTime: LAST_BAR_MS },
    );
    await flush();
    const closed = { ...SHORT, status: "sl_hit" } as unknown as Recommendation;
    mgr.apply(
      [],
      { recommendation: closed },
      { ...SHORT_CTX, lastBarTime: LAST_BAR_MS },
    );
    await flush();
    const frozen = positionSetPoints(setPointsCalls).at(-1)!;

    mgr.apply(
      [],
      { recommendation: closed },
      { ...SHORT_CTX, lastBarTime: LATER_BAR_MS },
      { force: true },
    );
    await flush();

    const restored = positionSetPoints(setPointsCalls).at(-1)!;
    assert.equal(restored.points[0]!.time, frozen.points[0]!.time);
    assert.equal(restored.points[1]!.time, frozen.points[1]!.time);
    assert.notEqual(
      restored.points[1]!.time,
      Math.round(LATER_BAR_MS / 1000),
      "force-redraw after SL must not pick up bars printed after close",
    );
    const tools = positionCalls(single);
    assert.deepEqual(
      tools.at(-1)!.options.overrides,
      tools[0]!.options.overrides,
    );
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
