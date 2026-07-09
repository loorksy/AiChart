/**
 * Drives the live ticker over SSE: emits each generated item in order with a
 * human-feeling ~1s cadence, stops immediately when the run completes or the
 * client aborts. When the plan is exhausted it simply stops — the frontend
 * keeps the LAST generated line visible; no hardcoded filler is ever cycled.
 */
import type { AgentTickerItem } from "./types";

export interface StreamTickerInput {
  items: AgentTickerItem[];
  sendTicker: (item: AgentTickerItem) => void;
  shouldStop: () => boolean;
  /** Injectable delay (tests). Defaults to ~900–1400ms. */
  delayMs?: () => number;
}

export async function streamTicker(input: StreamTickerInput): Promise<void> {
  if (!input.items.length) return;
  const delay = input.delayMs ?? (() => Math.round(900 + Math.random() * 500));

  for (let i = 0; i < input.items.length; i++) {
    if (input.shouldStop()) return;
    input.sendTicker(input.items[i]!);
    if (i === input.items.length - 1) return; // last item stays visible
    await sleep(delay());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
