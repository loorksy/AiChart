/**
 * Live progress in the Telegram status bubble — real work only.
 *
 * The engine narrates itself twice over: `emitStage` marks each task's
 * lifecycle (market data, structure, liquidity, news, decision…) and
 * `emitThinking` / `emitActivity` carry a short sentence at the moment the
 * work finished ("read 240 candles…", "identified market structure: uptrend…").
 * This reporter renders BOTH into the bubble: an ordered checklist of the
 * actual tasks, each completed stage marked ✅, the current stage spinning,
 * and thinking lines nested under the stage they arrived with.
 *
 * There is deliberately no pre-printed text anywhere in this file's output.
 * The bubble does not exist until the engine has said something — before
 * that, the native typing indicator carries the "working" signal — and its
 * every line is either a task the engine reported entering or a sentence
 * composed from real evidence. A conversational run that emits nothing never
 * gets a bubble at all, which is exactly the right theatre for it.
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
import { sanitizeThinkingLine } from "@/lib/agent/thinkingNarration";
import { t, type AppLocale } from "@/lib/i18n";
import { escapeTelegramHtml } from "./html";
import { TelegramLiveTurn } from "./liveReply";

export const EDIT_GAP_MS = 2_500;
export const TYPING_GAP_MS = 4_000;
/** A stage keeps at most this many thinking notes — few and meaningful. */
export const MAX_NOTES_PER_STAGE = 2;
/** The collapsed final trace keeps at most this many notes across all stages. */
export const MAX_FINAL_TRACE_NOTES = 6;

export interface StageEventLike {
  stage: string;
  status: "running" | "done" | "failed" | "resumed";
  durationMs?: number;
}

export interface StageRow {
  stage: string;
  status: "running" | "done" | "failed";
  notes: string[];
}

/** Injectable transport/clock seams so tests run without Telegram or timers. */
export interface ProgressTransport {
  show: (text: string) => Promise<void>;
  typing: () => Promise<void>;
}

export function stageLabel(stage: string, locale: AppLocale): string {
  return KNOWN_STAGES.has(stage) ? t(locale, `agent.stage.${stage}`) : stage;
}

/**
 * The spinner frames the header (and the current stage) cycle through, one
 * step per edit.
 *
 * Telegram has no animation primitive a bot can use without premium custom
 * emoji, but a message EDITED forward through the clock faces reads as one —
 * the classic trick. The rotation only advances when a real event causes an
 * edit, so a stalled run honestly shows a stalled clock.
 */
export const SPINNER_FRAMES = [
  "🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛",
] as const;

function spinnerFrame(tick: number): string {
  return SPINNER_FRAMES[
    ((tick % SPINNER_FRAMES.length) + SPINNER_FRAMES.length) % SPINNER_FRAMES.length
  ]!;
}

function stageMark(
  status: StageRow["status"],
  spinner: string,
): string {
  if (status === "done") return "✅";
  if (status === "failed") return "❌";
  return spinner;
}

function renderNote(text: string): string {
  const clean = text.trim();
  return clean ? `<i>${escapeTelegramHtml(clean)}</i>` : "";
}

/**
 * Ordered checklist lines: `N. ✅ localized-name` plus any thinking notes
 * as indented muted italics under their stage.
 */
export function renderTraceSteps(
  rows: readonly StageRow[],
  locale: AppLocale,
  opts: { spinner?: string; includeRunning?: boolean; maxNotes?: number } = {},
): string {
  const includeRunning = opts.includeRunning !== false;
  const spinner = opts.spinner ?? SPINNER_FRAMES[0];
  let notesLeft = opts.maxNotes ?? Number.POSITIVE_INFINITY;
  const lines: string[] = [];
  let index = 0;
  for (const row of rows) {
    if (!includeRunning && row.status === "running") continue;
    index += 1;
    lines.push(
      `${index}. ${stageMark(row.status, spinner)} ${stageLabel(row.stage, locale)}`,
    );
    for (const note of row.notes) {
      if (notesLeft <= 0) break;
      const rendered = renderNote(note);
      if (!rendered) continue;
      lines.push(rendered);
      notesLeft -= 1;
    }
  }
  return lines.join("\n");
}

/**
 * The bubble body: a live header (spinner + how far along the checklist is),
 * the ordered task checklist, and thinking notes nested under their stage.
 * Empty string when the engine has said nothing — the caller then shows no
 * bubble at all rather than inventing a line to fill one.
 */
export function renderProgress(
  rows: readonly StageRow[],
  locale: AppLocale,
  tick = 0,
  orphanNotes: readonly string[] = [],
): string {
  const spinner = spinnerFrame(tick);
  const steps = renderTraceSteps(rows, locale, { spinner, includeRunning: true });
  const orphans = orphanNotes
    .map(renderNote)
    .filter(Boolean)
    .join("\n");
  if (!steps && !orphans) return "";
  const done = rows.filter((row) => row.status !== "running").length;
  const header = `${spinner} <b>${t(locale, "tg.progress_header")}…</b>${
    rows.length ? ` (${done}/${rows.length})` : ""
  }`;
  return [header, steps, orphans].filter(Boolean).join("\n");
}

/**
 * The collapsed "Called N tools" block for the final answer.
 *
 * `<blockquote expandable>` collapses to its first line — the localized
 * "N tools were run" title — and expands on tap to the ordered ✅ checklist
 * with the key thinking notes interleaved. Rendered from the stages the
 * reporter actually observed, never from a list someone maintains by hand.
 */
export function renderToolsTrace(
  stages: readonly Pick<StageRow, "stage" | "status" | "notes">[],
  locale: AppLocale,
): string {
  const finished = stages
    .filter((row) => row.status !== "running")
    .map((row) => ({
      stage: row.stage,
      status: row.status,
      notes: row.notes ?? [],
    }));
  if (!finished.length) return "";
  const steps = renderTraceSteps(finished, locale, {
    includeRunning: false,
    maxNotes: MAX_FINAL_TRACE_NOTES,
  });
  return `<blockquote expandable>🛠 ${t(locale, "tg.tools_used", {
    count: String(finished.length),
  })}\n${steps}</blockquote>`;
}

export class TelegramProgressReporter {
  private rows: StageRow[] = [];
  /** Thinking that arrived before any stage — flushed onto the first row. */
  private pendingNotes: string[] = [];
  /** Advances once per rendered edit — what turns the header clock. */
  private tick = 0;
  private lastEditAt = 0;
  private pendingFlush: ReturnType<typeof setTimeout> | null = null;
  private typingTimer: ReturnType<typeof setInterval> | null = null;
  private finished = false;

  constructor(
    private readonly transport: ProgressTransport,
    private readonly locale: AppLocale,
    private readonly now: () => number = Date.now,
  ) {}

  /** Wrap a live turn as the transport — the production wiring. */
  static forLiveTurn(
    live: TelegramLiveTurn,
    sendTyping: () => Promise<void>,
    locale: AppLocale,
  ) {
    return new TelegramProgressReporter(
      {
        show: (text) => live.show(text),
        typing: sendTyping,
      },
      locale,
    );
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
      const row: StageRow = { stage: event.stage, status, notes: [] };
      if (this.pendingNotes.length) {
        row.notes.push(...this.pendingNotes.splice(0, MAX_NOTES_PER_STAGE));
        this.pendingNotes = [];
      }
      this.rows.push(row);
    }
    this.scheduleEdit();
  }

  /**
   * Feed one visible activity sentence — the specialist's own narration,
   * authored at the moment the work happened. Nested under the stage it
   * arrived with, same as a thinking line.
   */
  onActivity(message: string): void {
    this.attachNote(message);
  }

  /**
   * Feed one thinking line. The caller should already have run it through
   * `sanitizeThinkingLine`; this path scrubs again so a missed wire cannot
   * leak internals onto the phone.
   */
  onThinking(text: string): void {
    this.attachNote(text);
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

  private attachNote(raw: string): void {
    if (this.finished || !raw?.trim()) return;
    const clean = sanitizeThinkingLine(raw);
    if (!clean) return;
    const target =
      [...this.rows].reverse().find((row) => row.status !== "running") ??
      this.rows.find((row) => row.status === "running") ??
      this.rows[this.rows.length - 1];
    if (!target) {
      if (this.pendingNotes.length >= MAX_NOTES_PER_STAGE) return;
      if (!this.pendingNotes.includes(clean)) this.pendingNotes.push(clean);
      this.scheduleEdit();
      return;
    }
    if (target.notes.includes(clean)) return;
    if (target.notes.length >= MAX_NOTES_PER_STAGE) return;
    target.notes.push(clean);
    this.scheduleEdit();
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
    const text = renderProgress(this.rows, this.locale, this.tick, this.pendingNotes);
    if (!text) return; // nothing real to say yet — no bubble
    this.tick += 1;
    this.lastEditAt = this.now();
    void this.transport.show(text).catch(() => {});
  }
}
