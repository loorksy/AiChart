"use client";

/**
 * Client-side live-run registry (Phase 3 — "the stream survives navigation").
 *
 * The chat hook used to abort its fetch on unmount, so leaving /workspace
 * mid-analysis killed the run and threw away 30–60s of work. Now the RUN's
 * live state lives here, module-scoped and keyed by chat id:
 *
 * - The streaming loop (still owned by the hook instance that started it)
 *   mirrors every update into this store. React state setters on an unmounted
 *   component are no-ops, so the loop keeps running harmlessly after
 *   navigation — persistence and audit fire exactly as before.
 * - A REMOUNTING hook asks the store whether its chat has a live run, rebuilds
 *   the pending bubble from the snapshot, and subscribes for the rest of the
 *   run — including the final result, which the store retains until claimed.
 *
 * Deliberately NOT here: the message list (history owns it), anything
 * server-side, and multi-tab sync (module scope is per-tab by design).
 */
import type { AgentFinalResult, AgentOption } from "./types";
import type { AgentStageEvent } from "./stageEvents";
import type { AgentActivityEvent } from "./types";

export interface LiveRunFinal {
  result: AgentFinalResult;
  content: string;
  activityEvents: AgentActivityEvent[];
  options: AgentOption[];
}

export interface LiveRunSnapshot {
  chatId: string;
  pendingId: string;
  /** The user turn that started the run — replayed into a remounted chat. */
  userMessage: string;
  liveNote: string | null;
  streamText: string | null;
  stageEvents: AgentStageEvent[];
  running: boolean;
  /**
   * The final payload, retained until a subscriber claims it. Needed because
   * the instance that STARTED the run may be unmounted when the final lands —
   * its applyFinal is a no-op, and without this the answer would exist only
   * in persisted history after a reload.
   */
  final: LiveRunFinal | null;
  startedAt: number;
}

const runs = new Map<string, LiveRunSnapshot>();
const listeners = new Map<string, Set<() => void>>();

function notify(chatId: string): void {
  for (const listener of listeners.get(chatId) ?? []) {
    try {
      listener();
    } catch {
      /* a broken subscriber must not break the run */
    }
  }
}

export function beginLiveRun(input: {
  chatId: string;
  pendingId: string;
  userMessage: string;
}): void {
  runs.set(input.chatId, {
    ...input,
    liveNote: null,
    streamText: null,
    stageEvents: [],
    running: true,
    final: null,
    startedAt: Date.now(),
  });
  notify(input.chatId);
}

export function updateLiveRun(
  chatId: string,
  /** The run this update belongs to — a superseded run's late events are dropped. */
  pendingId: string,
  patch: Partial<
    Pick<LiveRunSnapshot, "liveNote" | "streamText" | "running" | "final">
  > & { addStageEvent?: AgentStageEvent },
): void {
  const run = runs.get(chatId);
  if (!run || run.pendingId !== pendingId) return;
  if (patch.addStageEvent) run.stageEvents = [...run.stageEvents, patch.addStageEvent];
  if ("liveNote" in patch) run.liveNote = patch.liveNote ?? null;
  if ("streamText" in patch) run.streamText = patch.streamText ?? null;
  if ("final" in patch) run.final = patch.final ?? null;
  if ("running" in patch) run.running = patch.running ?? false;
  notify(chatId);
}

/** The run ended and its final (if any) was claimed — forget it. */
export function endLiveRun(chatId: string, pendingId?: string): void {
  const run = runs.get(chatId);
  if (!run) return;
  if (pendingId && run.pendingId !== pendingId) return; // a newer run took over
  runs.delete(chatId);
  notify(chatId);
}

export function getLiveRun(chatId: string): LiveRunSnapshot | null {
  return runs.get(chatId) ?? null;
}

export function subscribeLiveRun(chatId: string, listener: () => void): () => void {
  let set = listeners.get(chatId);
  if (!set) {
    set = new Set();
    listeners.set(chatId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(chatId);
  };
}
