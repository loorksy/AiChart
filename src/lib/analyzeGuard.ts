/**
 * Burst protection shared by every analysis entry point (user route + agent
 * route): analysis is the heaviest operation (LLM + vision). A flood of
 * simultaneous requests must degrade gracefully — never crash the process.
 * - One in-flight analysis per user (double-clicks / multi-tab / agent+UI).
 * - A global concurrency ceiling: beyond it, fast 503 with retry hint instead
 *   of piling up sockets/memory until the event loop starves.
 */
const inFlightUsers = new Set<number>();
let activeAnalyses = 0;
const MAX_CONCURRENT_ANALYSES = Math.max(
  4,
  Number(process.env.ANALYZE_MAX_CONCURRENT || 32),
);

export type AnalyzeSlot =
  | { ok: true; release: () => void }
  | { ok: false; reason: "in_flight" | "busy" };

export function acquireAnalyzeSlot(userId: number): AnalyzeSlot {
  if (inFlightUsers.has(userId)) return { ok: false, reason: "in_flight" };
  if (activeAnalyses >= MAX_CONCURRENT_ANALYSES) {
    return { ok: false, reason: "busy" };
  }
  inFlightUsers.add(userId);
  activeAnalyses++;
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      inFlightUsers.delete(userId);
      activeAnalyses = Math.max(0, activeAnalyses - 1);
    },
  };
}
