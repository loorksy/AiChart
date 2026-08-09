import type {
  EntityId,
  IChartWidgetApi,
  StudyInputValue,
} from "@/vendor/tradingview/charting_library";
import {
  DEFAULT_OVERLAY,
  type ChartStudy,
  type ChartStudyName,
} from "@/lib/chart/studies";

/** Canonical study name → the TradingView Indicators-widget name. */
export const TV_STUDY_NAME: Record<ChartStudyName, string> = {
  RSI: "Relative Strength Index",
  EMA: "Moving Average Exponential",
  SMA: "Moving Average",
  MACD: "MACD",
  BB: "Bollinger Bands",
  ATR: "Average True Range",
  Stochastic: "Stochastic",
  VWAP: "VWAP",
};

export function tvStudyName(name: ChartStudyName): string {
  return TV_STUDY_NAME[name];
}

/** Whether the study renders on the price pane (honors an explicit `pane`). */
export function studyForceOverlay(study: ChartStudy): boolean {
  if (study.pane) return study.pane === "overlay";
  return DEFAULT_OVERLAY[study.name] ?? false;
}

/**
 * Identity of one desired study: id + name + inputs + pane. Two applies with
 * the same fingerprint must be a no-op — the layout poll re-delivers the same
 * payload every few seconds and re-creating indicators each tick would make
 * them flicker and lose the user's pane arrangement.
 */
export function studyFingerprint(study: ChartStudy): string {
  const inputs = study.inputs
    ? Object.keys(study.inputs)
        .sort()
        .map((k) => [k, study.inputs![k]])
    : [];
  return JSON.stringify([study.id, study.name, inputs, study.pane ?? ""]);
}

/** Pure diff: which applied fingerprints to remove, which studies to create. */
export function diffStudies(
  desired: ChartStudy[],
  appliedFingerprints: Iterable<string>,
): { toRemove: string[]; toCreate: ChartStudy[] } {
  const desiredByFp = new Map(desired.map((s) => [studyFingerprint(s), s]));
  const applied = new Set(appliedFingerprints);
  const toRemove = [...applied].filter((fp) => !desiredByFp.has(fp));
  const toCreate = [...desiredByFp.entries()]
    .filter(([fp]) => !applied.has(fp))
    .map(([, s]) => s);
  return { toRemove, toCreate };
}

/**
 * Manages agent-created TradingView studies (indicators) for one chart —
 * mirrors ChartStudy[] onto it, the way TvDrawingManager mirrors drawings.
 * Only entities this manager created are ever removed; indicators the user
 * added through the Indicators dialog are never touched.
 */
export class TvStudyManager {
  /** fingerprint → the (async) entity created for it. `createStudy` resolves
   *  later; storing the promise keeps an in-flight study counted as applied. */
  private applied = new Map<string, Promise<EntityId | null>>();

  constructor(private readonly chart: IChartWidgetApi) {}

  /** Fingerprints currently applied (settled or in flight). */
  appliedFingerprints(): string[] {
    return [...this.applied.keys()];
  }

  clear(): void {
    for (const fp of [...this.applied.keys()]) this.removeOne(fp);
  }

  private removeOne(fp: string): void {
    const pending = this.applied.get(fp);
    this.applied.delete(fp);
    void pending
      ?.then((id) => {
        if (id) this.chart.removeEntity(id);
      })
      .catch(() => {});
  }

  /** Mirror the desired studies onto the chart (idempotent by fingerprint). */
  apply(studies: ChartStudy[]): void {
    const { toRemove, toCreate } = diffStudies(studies, this.applied.keys());
    for (const fp of toRemove) this.removeOne(fp);
    for (const study of toCreate) {
      const fp = studyFingerprint(study);
      const inputs = study.inputs as Record<string, StudyInputValue> | undefined;
      const created = this.chart
        .createStudy(tvStudyName(study.name), studyForceOverlay(study), false, inputs)
        .catch(() => null);
      this.applied.set(fp, created);
      // A study TradingView refused (unknown inputs, pane limits) must not
      // stay "applied" forever — forget it so a later apply can retry.
      void created.then((id) => {
        if (id == null && this.applied.get(fp) === created) {
          this.applied.delete(fp);
        }
      });
    }
  }
}
