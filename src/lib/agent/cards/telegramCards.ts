/**
 * The same cards, on a phone.
 *
 * Telegram parity has been a promise made in prose twice in this repo and kept
 * by neither: the bot was outbound-only until Phase 6, and the card pipeline
 * before it had a `telegram_fallback` field that nothing read. A promise that
 * only a reviewer can check is a promise that drifts.
 *
 * Here it is a compile error. `renderCardForTelegram` switches over the closed
 * `AgentCard` union and ends in `assertNeverCard`, so a card type added without
 * a phone rendering does not ship — `tsc` refuses it. The panel does the same.
 * Neither surface can quietly fall behind the other.
 *
 * ## What changes between surfaces, and what does not
 *
 * The DATA is identical — both renderers consume the same derived cards. What
 * differs is depth: the diagnostic cards (`COLLAPSED_BY_DEFAULT`) are dropped
 * here rather than collapsed, because a phone has no disclosure triangle and a
 * wall of stage timings buries the answer. The operator who wants them opens
 * the platform, which is a different surface, not a different answer.
 *
 * The card's LANGUAGE is the account's, not the surface's: both renderers
 * take the reader's locale and read the same keys out of the one dictionary,
 * so a phone and a panel cannot drift into two strings either.
 */
import { t, type AppLocale } from "@/lib/i18n";
import { visualTransparencyLine } from "@/lib/recommendations/visualTransparency";
import { escapeTelegramHtml as esc } from "@/lib/telegram/html";
import {
  assertNeverCard,
  COLLAPSED_BY_DEFAULT,
  type AgentCard,
} from "./types";

/** The three decision words, in the reader's language. */
function decisionLabel(decision: string, locale: AppLocale): string {
  const key =
    decision === "buy"
      ? "decision.buy"
      : decision === "sell"
        ? "decision.sell"
        : decision === "wait"
          ? "decision.wait"
          : null;
  return key ? t(locale, key) : decision;
}

/**
 * A gate's name in the reader's language. Falls back to the bare id rather
 * than to a dotted key: an unnamed gate must still be identifiable.
 */
function gateLabel(id: string, locale: AppLocale): string {
  const key = `gate.label.${id}`;
  const label = t(locale, key);
  return label === key ? id : label;
}

/** Values the model/envelope use internally — never show these on a phone. */
const INTERNAL_LABEL = /^(not_applicable|informational|action_required|descriptive_only|operational_blocker|execution_validated|[a-z_]+)$/;

/** Trim a number for display without inventing precision it does not have. */
function price(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function bullets(lines: string[], mark = "•"): string {
  return lines.map((line) => `${mark} ${line}`).join("\n");
}

/**
 * One card as Telegram text, or null when this card has nothing to say here.
 *
 * Returning null is a real answer — the diagnostic cards deliberately produce
 * nothing on this surface — and is distinct from a missing case, which cannot
 * compile.
 */
export function renderCardForTelegram(
  card: AgentCard,
  locale: AppLocale,
): string | null {
  // Depth belongs on the platform. Dropping these keeps the phone message
  // about the decision instead of about the run that produced it.
  if (COLLAPSED_BY_DEFAULT.has(card.kind)) return null;

  switch (card.kind) {
    case "scenario_notice": {
      // Leads the message. The next-open time renders in Riyadh time — the
      // operator's clock — matching the deterministic summary notice.
      const opens = new Intl.DateTimeFormat(locale, {
        timeZone: "Asia/Riyadh",
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      }).format(card.nextOpenAt);
      return `🕒 <b>${t(locale, "tg.scenario.title")}</b>\n${t(locale, "tg.scenario.body", {
        reason: esc(card.reasonAr),
        opens,
      })}`;
    }

    case "decision": {
      // A greeting or a closed-market note is a sentence, not a trade badge.
      if (card.decision === "informational" || card.decision === "action_required") {
        return card.summary;
      }
      const head = `<b>${decisionLabel(card.decision, locale)}</b>`;
      // The bare percentage is deliberately absent: `confidenceSemantics`
      // exists because one number meant three different things depending on
      // which path produced it, and a phone is the worst place to guess which.
      const raw =
        typeof card.semantics?.displayValue === "string"
          ? card.semantics.displayValue.trim()
          : "";
      const confidence =
        raw && !INTERNAL_LABEL.test(raw) ? ` · ${raw}` : "";
      return `${head}${confidence}\n${esc(card.summary)}`;
    }

    case "plan_levels": {
      const lines = [
        `${t(locale, "agent.card.entry")}: ${price(card.entry)}${
          card.entryZone
            ? ` (${price(card.entryZone.low)}–${price(card.entryZone.high)})`
            : ""
        }`,
        `${t(locale, "agent.card.stop")}: ${price(card.stopLoss)}`,
        `${t(locale, "agent.card.targets")}: ${card.targets.map(price).join(" / ")}`,
      ];
      // Net of costs or not at all. A gross reward:risk is a number the
      // operator cannot actually obtain.
      if (card.netRr != null)
        lines.push(`${t(locale, "agent.card.net_rr")}: ${card.netRr.toFixed(2)}`);
      return `<b>${t(locale, "agent.card.plan")}</b>\n${bullets(lines)}`;
    }

    case "activation":
      return card.triggerCondition
        ? `<b>${t(locale, "agent.card.activation")}</b>\n${esc(card.triggerCondition)}${
            card.validityCandles
              ? `\n${t(locale, "tg.validity_candles", { count: String(card.validityCandles) })}`
              : ""
          }`
        : card.activationClass === "immediate"
          ? `<b>${t(locale, "agent.card.activation")}</b>\n${t(locale, "agent.card.activation_immediate")}`
          : null;

    case "invalidation": {
      const parts = [
        card.rule ? esc(card.rule) : card.rule,
        card.level != null
          ? `${t(locale, "agent.card.level")}: ${price(card.level)}`
          : null,
      ].filter(Boolean);
      return parts.length
        ? `<b>${t(locale, "agent.card.invalidation")}</b>\n${parts.join("\n")}`
        : null;
    }


    case "alternative_scenario":
      return `<b>${t(locale, "agent.card.alternative")}</b>\n${esc(card.scenario)}`;

    case "gate_checklist": {
      const lines = card.verdicts.map((v) => {
        const mark = v.status === "pass" ? "✅" : v.status === "veto" ? "⛔" : "⚠️";
        const label = gateLabel(v.id, locale);
        return v.reasonAr ? `${mark} ${label} — ${esc(v.reasonAr)}` : `${mark} ${label}`;
      });
      return `<b>${t(locale, "agent.card.gates")}</b>\n${lines.join("\n")}`;
    }

    case "key_reasons":
      return `<b>${t(locale, "agent.card.reasons")}</b>\n${bullets(card.reasons.map(esc))}`;

    case "public_reasoning":
      return bullets(card.points.map(esc));

    case "evidence_strategy": {
      const c = card.card;
      const wf =
        c.walkForward === "passed"
          ? t(locale, "tg.walkforward.passed")
          : c.walkForward === "failed"
            ? t(locale, "tg.walkforward.failed")
            : t(locale, "tg.walkforward.none");
      // The shortfall is part of the evidence, not a footnote: a card that
      // shows only the trade count reads as validated when it is not.
      const grade = c.meetsExecutionGates
        ? ""
        : `\n${t(locale, "tg.evidence.below_threshold")}`;
      return `<b>${t(locale, "agent.card.evidence_history")}</b>\n${t(locale, "tg.trades_count", {
        count: String(c.tradeCount),
      })} · ${wf}${
        c.liveSampleSize > 0
          ? ` · ${t(locale, "tg.live_results", { count: String(c.liveSampleSize) })}`
          : ""
      }${grade}`;
    }

    case "evidence_dimensions":
      return `<b>${t(locale, "tg.evidence")}</b>\n${bullets(
        card.dimensions.map((d) => `${esc(d.key)}: ${esc(d.detail)}`),
      )}`;

    case "risk_warnings":
      return `<b>${t(locale, "tg.warnings")}</b>\n${bullets(card.warnings.map(esc), "⚠️")}`;

    case "news_risk":
      return card.risk.level === "low"
        ? null
        : `<b>${t(locale, "agent.card.news")}: ${card.risk.level}</b>\n${esc(card.risk.reason)}`;

    case "cost_evidence":
      return t(locale, "tg.cost_line", {
        pips: String(card.spreadPips?.toFixed(1)),
        suffix: card.fallbackUsed ? ` (${t(locale, "tg.estimate")})` : "",
      });

    case "candle_coverage":
      // Reached only if this card leaves COLLAPSED_BY_DEFAULT; kept honest
      // rather than left to fall through to the never-guard.
      return card.report.sufficientForTrade ? null : esc(card.report.summaryAr);

    case "tracked_recommendation":
      return `<b>${t(locale, "agent.card.tracked")}</b>\n${card.symbol} ${card.interval} · ${decisionLabel(
        card.direction,
        locale,
      )} · ${card.status}`;

    case "envelope_status":
      return null;

    case "follow_up_options":
      // OpenClaw: follow-ups are inline buttons on the message when the agent
      // authored them — not a numbered dump on every reply.
      return null;

    // The diagnostic set returns above; these cases exist so the union stays
    // exhaustive if that policy ever changes.
    // The visual-basis line: always rendered, both states — the phone must
    // never show a plan without saying whether the agent's eyes were open.
    case "visual_review":
      return esc(
        visualTransparencyLine(
          {
            state: card.state,
            timeframesReviewed: card.timeframes,
          },
          locale,
        ),
      );

    case "decision_trace":
    case "evidence_timeline":
    case "research_evidence":
    case "skills_used":
    case "run_stages":
      return null;

    default:
      return assertNeverCard(card);
  }
}

/** The whole answer as one Telegram message body. */
export function renderCardsForTelegram(
  cards: AgentCard[],
  locale: AppLocale,
): string {
  const decision = cards.find((c) => c.kind === "decision");
  const talkOnly =
    decision?.kind === "decision" &&
    (decision.decision === "informational" ||
      decision.decision === "action_required");
  // A hello or a closed-market note is one paragraph. Repeating it as
  // "reasons" / "warnings" / a gate checklist is what made the phone feel
  // like a debug dump.
  const skip = talkOnly
    ? new Set([
        "key_reasons",
        "risk_warnings",
        "gate_checklist",
        "public_reasoning",
        "cost_evidence",
        "evidence_strategy",
        "evidence_dimensions",
        "news_risk",
      ])
    : new Set<string>();

  return cards
    .filter((card) => !skip.has(card.kind))
    .map((card) => renderCardForTelegram(card, locale))
    .filter((block): block is string => block != null && block.trim().length > 0)
    .join("\n\n");
}
