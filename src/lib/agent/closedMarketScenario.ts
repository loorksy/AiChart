/**
 * Closed-market scenario mode — the decision that replaced a refusal.
 *
 * For as long as this platform has existed, a weekend request for a
 * recommendation was answered with an apology: `market_closed`, "come back
 * when the session opens". The Telegram greeting meanwhile PROMISED the
 * opposite — "the recommendation awaits the open" — a product promise with no
 * code path behind it. This module is that code path.
 *
 * The doctrine does not change: the model may not wait, the gates may refuse.
 * What changes is what a closed market MEANS. It is not an operational
 * blocker — nothing is broken, the tape is simply paused at Friday's close,
 * which is real, complete data. So the run proceeds on that data and the
 * plan it produces is FORCED conditional: it awaits activation, its clocks
 * are anchored at the next open (recommendationClockAnchor), and the answer
 * says plainly that this is a scenario for the open.
 *
 * Everything here is pure and clock-injectable. The previous behavior was
 * pinned by a test that regexed the orchestrator's source for the guard
 * strings; these functions exist so the exemptions are CALLS a test can
 * make, not strings it greps for.
 */
import { t } from "@/lib/i18n";
import { getSessionStatus, nextMarketOpenAt } from "@/lib/markets/tradingCalendar";
import type { ActivationRule } from "@/lib/recommendations/activationRule";

export interface ClosedMarketScenario {
  /** Epoch ms of the next session open — every weekend clock anchors here. */
  nextOpenAt: number;
  /** The calendar's own Arabic reason (Saturday / Friday close / Sunday…). */
  reasonAr: string;
}

/**
 * Should this run enter scenario mode?
 *
 * Null means "run normally" — either the market is open or this run is one
 * of the three standing exemptions, unchanged from the refusal they were
 * written for:
 *  - a re-evaluation revisits an EXISTING plan against the latest data there
 *    is, weekends included; it never needed the guard;
 *  - a replay run has its own clock;
 *  - educational-only sessions produce no recommendation either way.
 */
export function resolveClosedMarketScenario(input: {
  symbol: string | undefined;
  wantMarket: boolean;
  educationalOnly: boolean;
  timeBasis?: string;
  purpose?: string;
  nowMs: number;
}): ClosedMarketScenario | null {
  if (!input.wantMarket || !input.symbol) return null;
  if (input.educationalOnly) return null;
  if ((input.timeBasis ?? "live") !== "live") return null;
  if (input.purpose === "reevaluation") return null;

  const session = getSessionStatus(input.symbol, new Date(input.nowMs));
  if (session.isOpen) return null;

  return {
    nextOpenAt: nextMarketOpenAt(input.symbol, input.nowMs),
    reasonAr: session.reason,
  };
}

/**
 * Shift every expiry an activation rule carries forward by `deltaMs`.
 *
 * The model writes leaf deadlines relative to ITS now — a Saturday now. A
 * trigger that "expires in 6 hours" would be dead ~40 hours before Monday's
 * first candle could possibly satisfy it, so the plan would sit
 * awaiting_activation forever and then expire unmet. Composite rules carry
 * an expiry on the composite AND on each leaf; both shift.
 */
export function shiftActivationRuleExpiries(
  rule: ActivationRule,
  deltaMs: number,
): ActivationRule {
  if (deltaMs <= 0) return rule;
  const shift = (at: number | undefined | null): number | undefined =>
    at == null ? undefined : at + deltaMs;
  if (rule.kind === "composite") {
    return {
      ...rule,
      expiresAt: shift(rule.expiresAt),
      rules: rule.rules.map((leaf) => ({ ...leaf, expiresAt: shift(leaf.expiresAt) })),
    };
  }
  return { ...rule, expiresAt: shift(rule.expiresAt) };
}

/** Riyadh-time formatter: the operator's clock, not the server's. */
const nextOpenFormatter = new Intl.DateTimeFormat("ar", {
  timeZone: "Asia/Riyadh",
  weekday: "long",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * The deterministic Arabic notice prepended to a scenario answer.
 *
 * Deterministic on purpose: the synthesizer is also TOLD it is writing a
 * scenario, but prose from a prompt is a hope, and the operator must hear
 * "the market is closed" from code that cannot forget to say it.
 */
export function scenarioNoticeAr(scenario: ClosedMarketScenario): string {
  return t("ar", "scenario.notice", {
    reason: scenario.reasonAr.replace(/\.$/, ""),
    opens: nextOpenFormatter.format(scenario.nextOpenAt),
  });
}

/**
 * The synthesizer's scenario preamble — the prompt half of the guarantee.
 * The deterministic half (forced conditional plan, anchored clocks, the
 * notice above) never depends on the model honoring this.
 */
export function scenarioPromptBlock(scenario: ClosedMarketScenario): string {
  return t("ar", "scenario.prompt_block", { reason: scenario.reasonAr });
}
