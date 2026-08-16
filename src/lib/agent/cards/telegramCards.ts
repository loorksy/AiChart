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
 * Arabic only, deliberately: this is the operator's language throughout the
 * decision path, and a bilingual card would mean two strings drifting apart.
 */
import { GATE_LABELS_AR } from "../gates/chain";
import {
  assertNeverCard,
  COLLAPSED_BY_DEFAULT,
  type AgentCard,
} from "./types";

const DECISION_AR: Record<string, string> = {
  buy: "شراء",
  sell: "بيع",
  wait: "انتظار",
};

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
export function renderCardForTelegram(card: AgentCard): string | null {
  // Depth belongs on the platform. Dropping these keeps the phone message
  // about the decision instead of about the run that produced it.
  if (COLLAPSED_BY_DEFAULT.has(card.kind)) return null;

  switch (card.kind) {
    case "scenario_notice": {
      // Leads the message. The next-open time renders in Riyadh time — the
      // operator's clock — matching the deterministic summary notice.
      const opens = new Intl.DateTimeFormat("ar", {
        timeZone: "Asia/Riyadh",
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      }).format(card.nextOpenAt);
      return `🕒 <b>السوق مغلق — سيناريو للافتتاح القادم</b>\n${card.reasonAr} يفتح ${opens} بتوقيت الرياض، والتوصية أدناه شرطية تنتظر التفعيل.`;
    }

    case "decision": {
      // A greeting or a closed-market note is a sentence, not a trade badge.
      if (card.decision === "informational" || card.decision === "action_required") {
        return card.summary;
      }
      const head = `<b>${DECISION_AR[card.decision] ?? card.decision}</b>`;
      // The bare percentage is deliberately absent: `confidenceSemantics`
      // exists because one number meant three different things depending on
      // which path produced it, and a phone is the worst place to guess which.
      const raw =
        typeof card.semantics?.displayValue === "string"
          ? card.semantics.displayValue.trim()
          : "";
      const confidence =
        raw && !INTERNAL_LABEL.test(raw) ? ` · ${raw}` : "";
      return `${head}${confidence}\n${card.summary}`;
    }

    case "plan_levels": {
      const lines = [
        `الدخول: ${price(card.entry)}${
          card.entryZone
            ? ` (${price(card.entryZone.low)}–${price(card.entryZone.high)})`
            : ""
        }`,
        `الوقف: ${price(card.stopLoss)}`,
        `الأهداف: ${card.targets.map(price).join(" / ")}`,
      ];
      // Net of costs or not at all. A gross reward:risk is a number the
      // operator cannot actually obtain.
      if (card.netRr != null) lines.push(`العائد/المخاطرة (صافي): ${card.netRr.toFixed(2)}`);
      return `<b>الخطة</b>\n${bullets(lines)}`;
    }

    case "activation":
      return card.triggerCondition
        ? `<b>التفعيل</b>\n${card.triggerCondition}${
            card.validityCandles ? `\nصالحة ${card.validityCandles} شمعة` : ""
          }`
        : card.activationClass === "immediate"
          ? "<b>التفعيل</b>\nفوري"
          : null;

    case "invalidation": {
      const parts = [
        card.rule,
        card.level != null ? `المستوى: ${price(card.level)}` : null,
      ].filter(Boolean);
      return parts.length ? `<b>ما يُبطل الخطة</b>\n${parts.join("\n")}` : null;
    }


    case "alternative_scenario":
      return `<b>السيناريو البديل</b>\n${card.scenario}`;

    case "gate_checklist": {
      const lines = card.verdicts.map((v) => {
        const mark = v.status === "pass" ? "✅" : v.status === "veto" ? "⛔" : "⚠️";
        const label = GATE_LABELS_AR[v.id] ?? v.id;
        return v.reasonAr ? `${mark} ${label} — ${v.reasonAr}` : `${mark} ${label}`;
      });
      return `<b>الفحوصات</b>\n${lines.join("\n")}`;
    }

    case "key_reasons":
      return `<b>الأسباب</b>\n${bullets(card.reasons)}`;

    case "public_reasoning":
      return bullets(card.points);

    case "evidence_strategy": {
      const c = card.card;
      const wf =
        c.walkForward === "passed"
          ? "اجتاز الاختبار الأمامي"
          : c.walkForward === "failed"
            ? "لم يجتز الاختبار الأمامي"
            : "لم يُقيَّم أمامياً";
      // The shortfall is part of the evidence, not a footnote: a card that
      // shows only the trade count reads as validated when it is not.
      const grade = c.meetsExecutionGates ? "" : "\n(دون عتبة الأدلة الكاملة)";
      return `<b>الأدلة التاريخية</b>\n${c.tradeCount} صفقة · ${wf}${
        c.liveSampleSize > 0 ? ` · ${c.liveSampleSize} نتيجة حية` : ""
      }${grade}`;
    }

    case "evidence_dimensions":
      return `<b>الأدلة</b>\n${bullets(
        card.dimensions.map((d) => `${d.key}: ${d.detail}`),
      )}`;

    case "risk_warnings":
      return `<b>تنبيهات</b>\n${bullets(card.warnings, "⚠️")}`;

    case "news_risk":
      return card.risk.level === "low"
        ? null
        : `<b>مخاطر الأخبار: ${card.risk.level}</b>\n${card.risk.reason}`;

    case "cost_evidence":
      return `التكلفة المتوقعة: ${card.spreadPips?.toFixed(1)} نقطة${
        card.fallbackUsed ? " (تقدير)" : ""
      }`;

    case "candle_coverage":
      // Reached only if this card leaves COLLAPSED_BY_DEFAULT; kept honest
      // rather than left to fall through to the never-guard.
      return card.report.sufficientForTrade ? null : card.report.summaryAr;

    case "tracked_recommendation":
      return `<b>قيد المتابعة</b>\n${card.symbol} ${card.interval} · ${
        DECISION_AR[card.direction] ?? card.direction
      } · ${card.status}`;

    case "envelope_status":
      return null;

    case "follow_up_options":
      // OpenClaw: follow-ups are inline buttons on the message when the agent
      // authored them — not a numbered dump on every reply.
      return null;

    // The diagnostic set returns above; these cases exist so the union stays
    // exhaustive if that policy ever changes.
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
export function renderCardsForTelegram(cards: AgentCard[]): string {
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
    .map(renderCardForTelegram)
    .filter((block): block is string => block != null && block.trim().length > 0)
    .join("\n\n");
}
