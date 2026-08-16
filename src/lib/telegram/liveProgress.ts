/**
 * Live progress in the Telegram status bubble.
 *
 * `TelegramLiveTurn` gave the surface its bubble — sent immediately, replying
 * to the user's message, edited forward into the answer. What it never had
 * was anything to SAY between "أفكّر…" and the answer: `wake()` and `think()`
 * fired back-to-back and then the bubble sat frozen for the tens of seconds
 * the engine actually works. The engine has been narrating itself all along
 * (`ctx.emitStage` — market data, structure, liquidity, news, decision…);
 * Telegram passed a no-op and threw the narration away.
 *
 * This reporter is the missing wire. It listens to stage events and renders
 * the bubble as a short Arabic checklist that ticks forward while the agent
 * works — the experience the owner screenshotted from OpenClaw.
 *
 * ## Rate discipline
 *
 * Telegram tolerates roughly one edit per second per chat, and a run emits
 * stage transitions in bursts. Edits are throttled to one per EDIT_GAP_MS
 * with a TRAILING flush, so the last state always lands; a repeating
 * `sendChatAction("typing")` keeps the native indicator alive (it expires
 * after ~5s on its own). Every send is best-effort — progress must never
 * fail an analysis — and `finish()` stops the clocks before `finalize()`
 * writes the answer, so a late edit can never overwrite the result.
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

/** The bubble body: header + one line per stage seen so far. */
export function renderProgressAr(rows: readonly StageRow[]): string {
  if (!rows.length) return "⌛ أفكّر…";
  const lines = rows.map((row) => {
    const mark = row.status === "done" ? "✓" : row.status === "failed" ? "✗" : "⏳";
    return `${mark} ${stageLabelAr(row.stage)}`;
  });
  return `⌛ <b>أعمل على تحليلك…</b>\n${lines.join("\n")}`;
}

export class TelegramProgressReporter {
  private rows: StageRow[] = [];
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

  /** Start the typing keep-alive and show the initial bubble. */
  async start(): Promise<void> {
    await this.transport.show(renderProgressAr(this.rows)).catch(() => {});
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
    this.lastEditAt = this.now();
    void this.transport.show(renderProgressAr(this.rows)).catch(() => {});
  }
}
