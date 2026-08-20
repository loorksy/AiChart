/**
 * Warm state — what the resident host holds in memory between events.
 *
 * A cold pipeline re-reads everything per request; the resident agent loads
 * once at boot and serves from memory. Warm state is deliberately CHEAP
 * summaries and handles, not caches of analysis output: candle-store ranges
 * (is the warehouse alive, how fresh), the open recommendations the tracker
 * watches, and the instrument config. Anything heavier (levels, detectors)
 * is computed on demand by tools and may cache internally.
 *
 * The instrument comes from the gold config module — the single pinned
 * symbol — and is carried as a PARAMETER from here on, never re-hardcoded.
 */
import { DATA_SYMBOL } from "@/lib/gold";
import {
  goldCandleRange,
  STORED_TIMEFRAMES,
  type GoldCandleRange,
} from "@/lib/gold/candleStore";
import { listActiveTrackedRecommendations } from "@/lib/recommendations/recommendationStore";
import type { TrackedRecommendation } from "@/lib/recommendations/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("resident.warm");

export interface WarmState {
  /** The pinned instrument, sourced from config — passed on as a parameter. */
  symbol: string;
  loadedAt: number;
  /** Candle warehouse freshness per stored timeframe. */
  candleRanges: Record<string, GoldCandleRange>;
  /** Every user's active (open) recommendations, as the tracker sees them. */
  openRecommendations: TrackedRecommendation[];
}

export class WarmStateStore {
  private state: WarmState | null = null;

  /** Full load. Called once at boot and by explicit refreshes. */
  async load(): Promise<WarmState> {
    const started = Date.now();
    const candleRanges: Record<string, GoldCandleRange> = {};
    for (const timeframe of STORED_TIMEFRAMES) {
      candleRanges[timeframe] = await goldCandleRange(timeframe);
    }
    const openRecommendations = await listActiveTrackedRecommendations({ limit: 500 });
    this.state = {
      symbol: DATA_SYMBOL,
      loadedAt: Date.now(),
      candleRanges,
      openRecommendations,
    };
    log.info("warm state loaded", {
      durationMs: Date.now() - started,
      timeframes: Object.keys(candleRanges).length,
      openRecommendations: openRecommendations.length,
    });
    return this.state;
  }

  /** The held state. Throws if the host forgot to load — never silently cold. */
  get(): WarmState {
    if (!this.state) throw new WarmStateNotLoadedError();
    return this.state;
  }

  loaded(): boolean {
    return this.state !== null;
  }

  ageMs(now = Date.now()): number | null {
    return this.state ? now - this.state.loadedAt : null;
  }

  /**
   * Refresh only the open-recommendations slice — the piece events actually
   * change. Candle ranges refresh with candle-sync ticks via load().
   */
  async refreshRecommendations(): Promise<void> {
    if (!this.state) return;
    this.state.openRecommendations = await listActiveTrackedRecommendations({ limit: 500 });
    // Freshness is per-load; a partial refresh keeps loadedAt honest by NOT
    // touching it — the health endpoint reports the age of the full picture.
  }
}

export class WarmStateNotLoadedError extends Error {
  constructor() {
    super("Warm state accessed before load() — the host must load at boot.");
    this.name = "WarmStateNotLoadedError";
  }
}
