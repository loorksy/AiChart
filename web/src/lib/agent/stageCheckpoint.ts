/**
 * Per-stage checkpoint for the direct analysis run (RELIABILITY_PLAN.md item 2,
 * inspired by TradingAgents): when the final decision fails, the completed
 * evidence stages should not have to be re-earned — a retry resumes from the
 * last good state and pays only for the decision call again.
 *
 * SAFETY: reuse is gated on an EXACT market-snapshot hash match. The fleet
 * specialists are pure functions of the candle window, so an identical snapshot
 * provably yields identical results — a checkpoint hit can never inject stale
 * market structure into a fresh decision. If a single candle moved, the hash
 * changes and the fleet re-runs. Only a COMPLETE, non-degraded fleet is stored,
 * so a failure is never cached as if it were an answer.
 */
import type { StructureResult } from "./agents/structureAgent";
import type { LiquidityResult } from "./agents/liquidityAgent";
import type { SupplyDemandResult } from "./agents/supplyDemandAgent";
import type { MultiTimeframeResult } from "./agents/multiTimeframeAgent";
import type { NewsMacroResult } from "./agents/newsMacroAgent";

export interface CheckpointStages {
  structure: StructureResult;
  liquidity: LiquidityResult;
  supplyDemand: SupplyDemandResult;
  mtf: MultiTimeframeResult;
  /** News is optional evidence: a null here means "ran, nothing usable". */
  news: NewsMacroResult | null;
}

interface CheckpointEntry {
  snapshotHash: string;
  stages: CheckpointStages;
  savedAt: number;
}

/** How long a checkpoint may be resumed. Short: a retry, not a cache. */
export const CHECKPOINT_TTL_MS = 120_000;

/** Hard cap so a busy multi-user instance cannot grow this without bound. */
const MAX_ENTRIES = 200;

const store = new Map<string, CheckpointEntry>();

export function stageCheckpointKey(input: {
  userId?: number;
  symbol: string;
  interval: string;
}): string {
  return `${input.userId ?? 0}:${input.symbol}:${input.interval}`;
}

/**
 * Resume the fleet for an identical market snapshot. Returns null on any of:
 * no entry, a different snapshot (market moved), or an expired entry.
 */
export function loadStageCheckpoint(
  key: string,
  snapshotHash: string,
  now: number = Date.now(),
): CheckpointStages | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.snapshotHash !== snapshotHash) return null;
  if (now - entry.savedAt > CHECKPOINT_TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry.stages;
}

/** Store a COMPLETE fleet result. Callers must not save a degraded fleet. */
export function saveStageCheckpoint(
  key: string,
  snapshotHash: string,
  stages: CheckpointStages,
  now: number = Date.now(),
): void {
  if (store.size >= MAX_ENTRIES && !store.has(key)) {
    // Evict the oldest entry — checkpoints are disposable by construction.
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of store) {
      if (v.savedAt < oldestAt) {
        oldestAt = v.savedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) store.delete(oldestKey);
  }
  store.set(key, { snapshotHash, stages, savedAt: now });
}

/** Drop a checkpoint (tests, or after a run that invalidated its evidence). */
export function clearStageCheckpoint(key?: string): void {
  if (key) store.delete(key);
  else store.clear();
}

/** Entry count — observability/tests only. */
export function stageCheckpointSize(): number {
  return store.size;
}
