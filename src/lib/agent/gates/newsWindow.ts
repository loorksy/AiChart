/**
 * G1 — the news blackout window.
 *
 * A high-impact USD/gold print moves the instrument faster than any structural
 * plan can survive, so the platform refuses to issue a recommendation inside a
 * window around one. The window is configuration, not a constant: defaults are
 * 30 minutes before and 15 after, admin-settable per the product spec.
 *
 * The asymmetry is intentional. Before the print, the hazard is a plan issued
 * into a known imminent repricing. After it, the hazard is the first minutes
 * of two-way spread and unstable structure — which resolve faster than the
 * anticipation does.
 */
import { getPlatformValue } from "@/lib/platformConfig";

export const DEFAULT_BLOCK_BEFORE_MIN = 30;
export const DEFAULT_BLOCK_AFTER_MIN = 15;

function configuredMinutes(key: string, fallback: number): number {
  const raw = Number(getPlatformValue(key) ?? process.env[key]);
  if (!Number.isFinite(raw) || raw < 0) return fallback;
  // A window longer than a session is a misconfiguration, not a policy.
  return Math.min(Math.floor(raw), 240);
}

export function newsBlockWindowMinutes(): { before: number; after: number } {
  return {
    before: configuredMinutes("NEWS_BLOCK_BEFORE_MIN", DEFAULT_BLOCK_BEFORE_MIN),
    after: configuredMinutes("NEWS_BLOCK_AFTER_MIN", DEFAULT_BLOCK_AFTER_MIN),
  };
}

export interface BlockingEvent {
  title: string;
  /** Epoch ms of the scheduled release. */
  time: number;
  impact: "high" | "medium" | "low";
  currency?: string;
}

export interface NewsWindowVerdict {
  blocked: boolean;
  /** The event responsible, when blocked. */
  event?: BlockingEvent;
  /** Minutes until the window opens again; negative/0 when not blocked. */
  minutesUntilClear: number;
}

/**
 * Is `now` inside the blackout window of any high-impact event?
 *
 * Only `high` impact blocks. Medium and low events are evidence the analysis
 * may weigh — blocking on them would make the platform silent most of the
 * week, which is its own kind of dishonesty.
 */
export function evaluateNewsWindow(input: {
  events: BlockingEvent[];
  now: number;
  window?: { before: number; after: number };
}): NewsWindowVerdict {
  const { before, after } = input.window ?? newsBlockWindowMinutes();
  const beforeMs = before * 60_000;
  const afterMs = after * 60_000;

  let worst: { event: BlockingEvent; clearAt: number } | null = null;
  for (const event of input.events) {
    if (event.impact !== "high") continue;
    const opens = event.time - beforeMs;
    const closes = event.time + afterMs;
    if (input.now >= opens && input.now <= closes) {
      // When several windows overlap, the operator waits for the last one.
      if (!worst || closes > worst.clearAt) worst = { event, clearAt: closes };
    }
  }

  if (!worst) return { blocked: false, minutesUntilClear: 0 };
  return {
    blocked: true,
    event: worst.event,
    minutesUntilClear: Math.max(1, Math.ceil((worst.clearAt - input.now) / 60_000)),
  };
}

/** The operator-facing reason, naming the event and when the block lifts. */
export function newsBlockReasonAr(verdict: NewsWindowVerdict): string | null {
  if (!verdict.blocked || !verdict.event) return null;
  const mins = verdict.minutesUntilClear;
  return `خبر عالي التأثير (${verdict.event.title}) — التوصيات محجوبة لمدة ${mins} دقيقة.`;
}
