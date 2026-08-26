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
 * ## The phone's own reading order: a lead card, then folded depth
 *
 * A recommendation used to arrive as one flat wall — plan, checks, ten
 * reasons, sixteen evidence lines, six warnings — unreadable on a phone and
 * unread because of it. The message is now a LEAD (decision, levels,
 * activation, invalidation: everything needed to act) followed by the long
 * sections folded into Telegram's `<blockquote expandable>` (Bot API 7.3+),
 * each collapsed to its own title line and opened by a tap. Same data, same
 * derivation — only the depth is one tap away instead of in the way.
 *
 * The card's LANGUAGE is the account's, not the surface's: both renderers
 * take the reader's locale and read the same keys out of the one dictionary,
 * so a phone and a panel cannot drift into two strings either.
 */
import { t, type AppLocale } from "@/lib/i18n";
import { visualTransparencyLine } from "@/lib/recommendations/visualTransparency";
import { escapeTelegramHtml } from "@/lib/telegram/html";
import { GATE_NAMES, type GateId } from "../gates/types";
import {
  assertNeverCard,
  COLLAPSED_BY_DEFAULT,
  type AgentCard,
  type CardKind,
} from "./types";

// ---------------------------------------------------------------------------
// Leak hygiene: what model-authored text may NOT carry onto a phone
// ---------------------------------------------------------------------------

/** A full internal UUID; shortened to its first block (`#c438afb4` style). */
const UUID_RE =
  /(?:#\s*)?\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Trade-candidate ids (`tc-15`) — the synthesizer's internal vocabulary. */
const CANDIDATE_ID_RE = /\s*\(\s*tc-\d+\s*\)|\btc-\d+\b/gi;
/** A raw decision enum the model parroted from its own context. */
const DECISION_ENUM_RE =
  /\bDecision:\s*(?:informational|action_required|buy|sell|wait)\b[.\u060C,]?/gi;

/**
 * Scrub internal identifiers a model may echo into user-facing prose.
 *
 * Each pattern here is a real transcript, not a hypothesis: "Decision:
 * informational" (the context adapter's line, parroted), "(tc-15)" (a trade
 * candidate id in an alert), and a full recommendation UUID in a news
 * notice. Short ids stay — `#c438afb4` identifies without leaking.
 */
export function scrubTelegramInternals(value: string): string {
  return value
    .replace(DECISION_ENUM_RE, "")
    .replace(CANDIDATE_ID_RE, "")
    .replace(UUID_RE, "#$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,\u060C:\u061B)])/g, "$1")
    .trim();
}

/** Model-authored text on its way into HTML: scrub the internals, then escape. */
function esc(value: string): string {
  return escapeTelegramHtml(scrubTelegramInternals(value));
}

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

/**
 * Relic gates (G5's apparatus was deleted; the chain keeps the slot so the
 * ids stay stable). Their verdicts are placeholders — a check mark beside the
 * word "Removed" is a leak, not a check — so they simply do not render.
 * Derived from `GATE_NAMES`, the registry's own word for them, never a
 * hardcoded id list.
 */
const RELIC_GATE_IDS: ReadonlySet<string> = new Set(
  (Object.keys(GATE_NAMES) as GateId[]).filter(
    (id) => GATE_NAMES[id] === "removed",
  ),
);

/** A tracked status in the reader's language; underscores never render raw. */
function recStatusLabel(status: string, locale: AppLocale): string {
  const key = `rec.status.${status}`;
  const label = t(locale, key);
  return label === key ? status.replace(/_/g, " ") : label;
}

/** An evidence grade as a mark the eye reads faster than a word. */
function gradeMark(grade: "strong" | "moderate" | "weak" | "unavailable"): string {
  return grade === "strong"
    ? "🟢"
    : grade === "moderate"
      ? "🟡"
      : grade === "weak"
        ? "🔴"
        : "⚪";
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
        return esc(card.summary);
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
        `<b>${t(locale, "agent.card.entry")}:</b> ${price(card.entry)}${
          card.entryZone
            ? ` (${price(card.entryZone.low)}–${price(card.entryZone.high)})`
            : ""
        }`,
        `<b>${t(locale, "agent.card.stop")}:</b> ${price(card.stopLoss)}`,
        `<b>${t(locale, "agent.card.targets")}:</b> ${card.targets.map(price).join(" / ")}`,
      ];
      // Net of costs or not at all. A gross reward:risk is a number the
      // operator cannot actually obtain.
      if (card.netRr != null)
        lines.push(`<b>${t(locale, "agent.card.net_rr")}:</b> ${card.netRr.toFixed(2)}`);
      return `🎯 <b>${t(locale, "agent.card.plan")}</b>\n${bullets(lines)}`;
    }

    case "activation":
      return card.triggerCondition
        ? `⚡ <b>${t(locale, "agent.card.activation")}</b>\n${esc(card.triggerCondition)}${
            card.validityCandles
              ? `\n${t(locale, "tg.validity_candles", { count: String(card.validityCandles) })}`
              : ""
          }`
        : card.activationClass === "immediate"
          ? `⚡ <b>${t(locale, "agent.card.activation")}</b>\n${t(locale, "agent.card.activation_immediate")}`
          : null;

    case "invalidation": {
      const parts = [
        card.rule ? esc(card.rule) : card.rule,
        card.level != null
          ? `${t(locale, "agent.card.level")}: ${price(card.level)}`
          : null,
      ].filter(Boolean);
      return parts.length
        ? `🚫 <b>${t(locale, "agent.card.invalidation")}</b>\n${parts.join("\n")}`
        : null;
    }


    case "alternative_scenario":
      return `🔄 <b>${t(locale, "agent.card.alternative")}</b>\n${esc(card.scenario)}`;

    case "gate_checklist": {
      // Relic slots (the removed G5) hold a placeholder verdict so the chain's
      // ids stay stable; a placeholder is not a check and never renders.
      const verdicts = card.verdicts.filter((v) => !RELIC_GATE_IDS.has(v.id));
      if (!verdicts.length) return null;
      const lines = verdicts.map((v) => {
        const mark = v.status === "pass" ? "✅" : v.status === "veto" ? "⛔" : "⚠️";
        const label = gateLabel(v.id, locale);
        return v.reasonAr ? `${mark} ${label} — ${esc(v.reasonAr)}` : `${mark} ${label}`;
      });
      return `🛡 <b>${t(locale, "agent.card.gates")}</b>\n${lines.join("\n")}`;
    }

    case "key_reasons":
      return `📌 <b>${t(locale, "agent.card.reasons")}</b>\n${bullets(card.reasons.map(esc))}`;

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
      return `📊 <b>${t(locale, "agent.card.evidence_history")}</b>\n${t(locale, "tg.trades_count", {
        count: String(c.tradeCount),
      })} · ${wf}${
        c.liveSampleSize > 0
          ? ` · ${t(locale, "tg.live_results", { count: String(c.liveSampleSize) })}`
          : ""
      }${grade}`;
    }

    case "evidence_dimensions": {
      // Human sentences with a grade mark — never `machine_key: value` dumps.
      // The detail is already the operator-facing sentence; the raw key was
      // only ever the UI's lookup handle and reads as a leak on a phone.
      const lines = card.dimensions
        .filter((d) => d.detail?.trim())
        .map((d) => `${gradeMark(d.grade)} ${esc(d.detail)}`);
      return lines.length
        ? `🔎 <b>${t(locale, "tg.evidence")}</b>\n${lines.join("\n")}`
        : null;
    }

    case "risk_warnings":
      return `<b>${t(locale, "tg.warnings")}</b>\n${bullets(card.warnings.map(esc), "⚠️")}`;

    case "news_risk": {
      if (card.risk.level === "low") return null;
      // The level in the reader's language — "medium"/"high" are internal
      // vocabulary, not an answer.
      const levelKey = `news.level.${card.risk.level}`;
      const levelLabel = t(locale, levelKey);
      const level = levelLabel === levelKey ? "" : `: ${levelLabel}`;
      return `📰 <b>${t(locale, "agent.card.news")}${level}</b>\n${esc(card.risk.reason)}`;
    }

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
      return `👁 <b>${t(locale, "agent.card.tracked")}</b>\n${card.symbol} ${card.interval} · ${decisionLabel(
        card.direction,
        locale,
      )} · ${recStatusLabel(card.status, locale)}`;

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

/**
 * The long sections, folded. Each inner array is ONE `<blockquote expandable>`
 * — collapsed by Telegram to its first line, which is the leading card's own
 * bold title. Order inside a section is the section's reading order, not
 * `CARD_ORDER` (the dimensions lead the evidence fold so the collapsed line
 * is the evidence heading, not the strategy card's subtitle).
 */
const EXPANDABLE_SECTIONS: readonly (readonly CardKind[])[] = [
  ["key_reasons", "public_reasoning"],
  ["evidence_dimensions", "evidence_strategy", "cost_evidence"],
  ["risk_warnings", "news_risk"],
  ["gate_checklist"],
  ["alternative_scenario"],
];

const SECTION_KINDS: ReadonlySet<CardKind> = new Set(EXPANDABLE_SECTIONS.flat());

/** The kinds every card message leads with — what the operator ACTS on. */
const LEAD_KINDS: readonly CardKind[] = [
  "scenario_notice",
  "decision",
  "plan_levels",
  "activation",
  "invalidation",
  "visual_review",
  "tracked_recommendation",
];

/**
 * The always-visible lead: decision, levels, activation, invalidation — the
 * compact card that answers "what do I do". Exported on its own because it is
 * also the chart photo's caption (Telegram caps captions at 1024 chars; the
 * folded depth rides in the follow-up message).
 */
export function renderTelegramLead(
  cards: AgentCard[],
  locale: AppLocale,
): string {
  const byKind = new Map(cards.map((card) => [card.kind, card] as const));
  return LEAD_KINDS
    .map((kind) => byKind.get(kind))
    .filter((card): card is AgentCard => card != null)
    .map((card) => renderCardForTelegram(card, locale))
    .filter((block): block is string => block != null && block.trim().length > 0)
    .join("\n\n");
}

/**
 * The folded depth alone — every expandable section, no lead. This is the
 * photo path's follow-up message: the lead rides as the photo's caption, and
 * the long sections arrive beneath it, each still one tap away.
 */
export function renderTelegramDetails(
  cards: AgentCard[],
  locale: AppLocale,
): string {
  const byKind = new Map(cards.map((card) => [card.kind, card] as const));
  const blocks: string[] = [];
  // One expandable fold per section, skipped when empty — an empty fold is a
  // heading with nothing under it.
  for (const section of EXPANDABLE_SECTIONS) {
    const parts = section
      .map((kind) => {
        const card = byKind.get(kind);
        if (!card) return null;
        const text = renderCardForTelegram(card, locale);
        return text != null && text.trim().length > 0 ? text : null;
      })
      .filter((block): block is string => block != null);
    if (parts.length) {
      blocks.push(`<blockquote expandable>${parts.join("\n\n")}</blockquote>`);
    }
  }
  return blocks.join("\n\n");
}

/** The whole answer as one Telegram message body: the lead, then the folds. */
export function renderCardsForTelegram(
  cards: AgentCard[],
  locale: AppLocale,
): string {
  const decision = cards.find((c) => c.kind === "decision");
  const talkOnly =
    decision?.kind === "decision" &&
    (decision.decision === "informational" ||
      decision.decision === "action_required");

  // The lead, in the cards' own arrival order (which is CARD_ORDER).
  const blocks = cards
    .filter((card) => !SECTION_KINDS.has(card.kind))
    .map((card) => renderCardForTelegram(card, locale))
    .filter((block): block is string => block != null && block.trim().length > 0);

  // A hello or a closed-market note is one paragraph. Appending its
  // "reasons" / "warnings" / gate checklist is what made the phone feel
  // like a debug dump — talk-only answers carry no folds at all.
  if (!talkOnly) {
    const details = renderTelegramDetails(cards, locale);
    if (details) blocks.push(details);
  }

  return blocks.join("\n\n");
}
