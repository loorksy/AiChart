/**
 * Live progress in the Telegram status bubble — real work only.
 *
 * The engine narrates itself twice over: `emitStage` marks each task's
 * lifecycle (market data, structure, liquidity, news, decision…) and
 * `emitActivity` carries the specialist's own sentence at the moment its
 * work finished ("identified market structure: uptrend…"). This reporter renders
 * BOTH into the bubble: a ticking checklist of the actual tasks, with the
 * latest narration line under it.
 *
 * There is deliberately no pre-printed text anywhere in this file's output.
 * The bubble does not exist until the engine has said something — before
 * that, the native typing indicator carries the "working" signal — and its
 * every line is either a task the engine reported entering or a sentence a
 * specialist authored about work it actually did. A conversational run that
 * emits nothing never gets a bubble at all, which is exactly the right
 * theatre for it.
 *
 * ## Rate discipline
 *
 * Telegram tolerates roughly one edit per second per chat, and a run emits
 * events in bursts. Edits are throttled to one per EDIT_GAP_MS with a
 * TRAILING flush, so the last state always lands; `sendChatAction("typing")`
 * repeats (the native indicator expires after ~5s). Every send is
 * best-effort — progress must never fail an analysis — and `finish()` stops
 * the clocks before `finalize()` writes the answer, so a late edit can never
 * overwrite the result.
 */
import { KNOWN_STAGES } from "@/lib/agent/stageEvents";
import { t } from "@/lib/i18n";
import { TelegramLiveTurn } from "./liveReply";

export const EDIT_GAP_MS = 2_500;
export const TYPING_GAP_MS = 4_000;

export interface StageEventLike {
  stage: string;
  status: "running" | "done" | "failed" | "resumed";
  durationMs?: number;
}

interface StageRow {
  stage: string;
  status: "running" | "done" | "failed";
}

/** Injectable transport/clock seams so tests run without Telegram or timers. */
export interface ProgressTransport {
  show: (text: string) => Promise<void>;
  typing: () => Promise<void>;
}

export function stageLabelAr(stage: string): string {
  return KNOWN_STAGES.has(stage) ? t("ar", `agent.stage.${stage}`) : stage;
}

/**
 * The bubble body: the task checklist plus the engine's latest sentence.
 * Empty string when the engine has said nothing — the caller then shows no
 * bubble at all rather than inventing a line to fill one.
 */
export function renderProgressAr(
  rows: readonly StageRow[],
  narration?: string | null,
): string {
  const lines = rows.map((row) => {
    const mark = row.status === "done" ? "✓" : row.status === "failed" ? "✗" : "⏳";
    return `${mark} ${stageLabelAr(row.stage)}`;
  });
  const note = narration?.trim() ? `«${narration.trim()}»` : null;
  if (!lines.length && !note) return "";
  return [lines.join("\n"), note].filter(Boolean).join("\n");
}

export class TelegramProgressReporter {
  private rows: StageRow[] = [];
  private narration: string | null = null;
  private lastEditAt = 0;
  private pendingFlush: ReturnType<typeof setTimeout> | null = null;
  private typingTimer: ReturnType<typeof setInterval> | null = null;
  private finished = false;

  constructor(
    private readonly transport: ProgressTransport,
    private readonly now: () => number = Date.now,
  ) {}

  /** Wrap a live turn as the transport — the production wiring. */
  static forLiveTurn(live: TelegramLiveTurn, sendTyping: () => Promise<void>) {
    return new TelegramProgressReporter({
      show: (text) => live.show(text),
      typing: sendTyping,
    });
  }

  /**
   * Start the typing keep-alive. No bubble yet — the bubble is created by
   * the first real event, so a run that says nothing shows nothing.
   */
  async start(): Promise<void> {
    await this.transport.typing().catch(() => {});
    this.typingTimer = setInterval(() => {
      if (!this.finished) void this.transport.typing().catch(() => {});
    }, TYPING_GAP_MS);
    // A worker process must not be pinned open by a progress ticker.
    this.typingTimer.unref?.();
  }

  /** Feed one engine stage event; renders (throttled) as a side effect. */
  onStage(event: StageEventLike): void {
    if (this.finished || !event?.stage) return;
    const status =
      event.status === "failed" ? "failed" : event.status === "running" ? "running" : "done";
    const existing = this.rows.find((row) => row.stage === event.stage);
    if (existing) {
      // done/failed never regress to running: a resumed stage re-emits
      // "running" after its result already ticked, and un-ticking reads as
      // the agent going backwards.
      if (existing.status === "running" || status !== "running") existing.status = status;
    } else {
      this.rows.push({ stage: event.stage, status });
    }
    this.scheduleEdit();
  }

  /**
   * Feed one visible activity sentence — the specialist's own narration,
   * authored at the moment the work happened. The latest line shows under
   * the checklist; this is the "part of the agent's thinking" the operator
   * sees, and it is never a script.
   */
  onActivity(message: string): void {
    if (this.finished || !message?.trim()) return;
    this.narration = message.trim();
    this.scheduleEdit();
  }

  /** The stages seen, for the final answer's collapsed tools block. */
  snapshot(): readonly StageRow[] {
    return this.rows;
  }

  /**
   * Stop clocks and suppress any queued edit. Called BEFORE finalize so a
   * trailing progress edit cannot land after (and overwrite) the answer.
   */
  finish(): void {
    this.finished = true;
    if (this.pendingFlush) clearTimeout(this.pendingFlush);
    this.pendingFlush = null;
    if (this.typingTimer) clearInterval(this.typingTimer);
    this.typingTimer = null;
  }

  private scheduleEdit(): void {
    const since = this.now() - this.lastEditAt;
    if (since >= EDIT_GAP_MS) {
      this.flush();
      return;
    }
    if (this.pendingFlush) return; // one trailing edit carries the newest state
    this.pendingFlush = setTimeout(() => {
      this.pendingFlush = null;
      if (!this.finished) this.flush();
    }, EDIT_GAP_MS - since);
    this.pendingFlush.unref?.();
  }

  private flush(): void {
    const text = renderProgressAr(this.rows, this.narration);
    if (!text) return; // nothing real to say yet — no bubble
    this.lastEditAt = this.now();
    void this.transport.show(text).catch(() => {});
  }
}
