import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TV_STUDY_NAME,
  TvStudyManager,
  diffStudies,
  studyFingerprint,
  studyForceOverlay,
  tvStudyName,
} from "@/lib/chart/tv/tvStudyAdapter";
import { CHART_STUDY_NAMES, type ChartStudy } from "@/lib/chart/studies";
import type { EntityId, IChartWidgetApi } from "@/vendor/tradingview/charting_library";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function fakeChart() {
  let n = 0;
  const created: Array<{ name: string; forceOverlay?: boolean; inputs?: unknown }> = [];
  const removed: string[] = [];
  const chart = {
    createStudy: (name: string, forceOverlay?: boolean, _lock?: boolean, inputs?: unknown) => {
      created.push({ name, forceOverlay, inputs });
      n += 1;
      return Promise.resolve(`study-${n}` as EntityId);
    },
    removeEntity: (id: EntityId) => {
      removed.push(String(id));
    },
  } as unknown as IChartWidgetApi;
  return { chart, created, removed };
}

describe("tvStudyAdapter — name mapping", () => {
  it("maps every canonical study name to a TradingView indicator name", () => {
    for (const name of CHART_STUDY_NAMES) {
      assert.equal(typeof TV_STUDY_NAME[name], "string");
      assert.ok(TV_STUDY_NAME[name].length > 0);
    }
    assert.equal(tvStudyName("RSI"), "Relative Strength Index");
    assert.equal(tvStudyName("EMA"), "Moving Average Exponential");
    assert.equal(tvStudyName("SMA"), "Moving Average");
    assert.equal(tvStudyName("MACD"), "MACD");
    assert.equal(tvStudyName("BB"), "Bollinger Bands");
    assert.equal(tvStudyName("ATR"), "Average True Range");
    assert.equal(tvStudyName("Stochastic"), "Stochastic");
    assert.equal(tvStudyName("VWAP"), "VWAP");
  });

  it("overlays price-pane studies and separates oscillators by default", () => {
    assert.equal(studyForceOverlay({ id: "a", name: "EMA" }), true);
    assert.equal(studyForceOverlay({ id: "a", name: "RSI" }), false);
    // An explicit pane always wins over the default.
    assert.equal(studyForceOverlay({ id: "a", name: "RSI", pane: "overlay" }), true);
    assert.equal(studyForceOverlay({ id: "a", name: "EMA", pane: "separate" }), false);
  });
});

describe("tvStudyAdapter — fingerprint diff", () => {
  const rsi: ChartStudy = { id: "agent-rsi", name: "RSI", inputs: { length: 14 } };
  const ema: ChartStudy = { id: "agent-ema", name: "EMA", inputs: { length: 50 } };

  it("fingerprint is stable across input key order", () => {
    const a: ChartStudy = { id: "x", name: "MACD", inputs: { fast: 12, slow: 26 } };
    const b: ChartStudy = { id: "x", name: "MACD", inputs: { slow: 26, fast: 12 } };
    assert.equal(studyFingerprint(a), studyFingerprint(b));
  });

  it("fingerprint changes when id, inputs, or pane change", () => {
    const base = studyFingerprint(rsi);
    assert.notEqual(base, studyFingerprint({ ...rsi, id: "other" }));
    assert.notEqual(base, studyFingerprint({ ...rsi, inputs: { length: 21 } }));
    assert.notEqual(base, studyFingerprint({ ...rsi, pane: "overlay" }));
  });

  it("same desired set is a no-op; changes remove and create precisely", () => {
    const applied = [studyFingerprint(rsi), studyFingerprint(ema)];
    const same = diffStudies([rsi, ema], applied);
    assert.deepEqual(same.toRemove, []);
    assert.deepEqual(same.toCreate, []);

    const changed = diffStudies([rsi, { ...ema, inputs: { length: 200 } }], applied);
    assert.deepEqual(changed.toRemove, [studyFingerprint(ema)]);
    assert.equal(changed.toCreate.length, 1);
    assert.equal(changed.toCreate[0]!.name, "EMA");

    const cleared = diffStudies([], applied);
    assert.deepEqual(new Set(cleared.toRemove), new Set(applied));
    assert.deepEqual(cleared.toCreate, []);
  });
});

describe("TvStudyManager", () => {
  it("re-applying the same list never re-creates studies (poll no-flicker)", async () => {
    const { chart, created } = fakeChart();
    const mgr = new TvStudyManager(chart);
    const studies: ChartStudy[] = [
      { id: "agent-rsi", name: "RSI", inputs: { length: 14 } },
      { id: "agent-ema", name: "EMA" },
    ];
    mgr.apply(studies);
    await flush();
    assert.equal(created.length, 2);
    assert.deepEqual(created[0], {
      name: "Relative Strength Index",
      forceOverlay: false,
      inputs: { length: 14 },
    });
    assert.deepEqual(created[1], {
      name: "Moving Average Exponential",
      forceOverlay: true,
      inputs: undefined,
    });

    mgr.apply(studies);
    mgr.apply([...studies]);
    await flush();
    assert.equal(created.length, 2);
  });

  it("removes only the studies that left the desired set", async () => {
    const { chart, created, removed } = fakeChart();
    const mgr = new TvStudyManager(chart);
    const rsi: ChartStudy = { id: "agent-rsi", name: "RSI" };
    const macd: ChartStudy = { id: "agent-macd", name: "MACD" };
    mgr.apply([rsi, macd]);
    await flush();
    mgr.apply([rsi]);
    await flush();
    assert.equal(created.length, 2);
    assert.deepEqual(removed, ["study-2"]);
    assert.deepEqual(mgr.appliedFingerprints(), [studyFingerprint(rsi)]);
  });

  it("clear removes every tracked study and leaves nothing applied", async () => {
    const { chart, removed } = fakeChart();
    const mgr = new TvStudyManager(chart);
    mgr.apply([
      { id: "agent-rsi", name: "RSI" },
      { id: "agent-vwap", name: "VWAP" },
    ]);
    await flush();
    mgr.clear();
    await flush();
    assert.equal(removed.length, 2);
    assert.deepEqual(mgr.appliedFingerprints(), []);
  });

  it("a rejected createStudy is forgotten so a later apply can retry", async () => {
    let fail = true;
    const created: string[] = [];
    const chart = {
      createStudy: (name: string) => {
        if (fail) return Promise.reject(new Error("tv refused"));
        created.push(name);
        return Promise.resolve("study-ok" as EntityId);
      },
      removeEntity: () => {},
    } as unknown as IChartWidgetApi;
    const mgr = new TvStudyManager(chart);
    const rsi: ChartStudy = { id: "agent-rsi", name: "RSI" };
    mgr.apply([rsi]);
    await flush();
    assert.deepEqual(mgr.appliedFingerprints(), []);
    fail = false;
    mgr.apply([rsi]);
    await flush();
    assert.deepEqual(created, ["Relative Strength Index"]);
    assert.deepEqual(mgr.appliedFingerprints(), [studyFingerprint(rsi)]);
  });
});
