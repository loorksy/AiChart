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
    case "decision": {
      const head = `<b>${DECISION_AR[card.decision] ?? card.decision}</b>`;
      // The bare percentage is deliberately absent: `confidenceSemantics`
      // exists because one number meant three different things depending on
      // which path produced it, and a phone is the worst place to guess which.
      const confidence = card.semantics?.displayValue
        ? ` · ${card.semantics.displayValue}`
        : "";
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
      return `<i>${card.envelope.outcome_class}</i>`;

    case "follow_up_options":
      // Numbered, because this surface answers a reply of "1" — the platform's
      // clickable options and Telegram's numeric replies are the same contract.
      return `<b>أسئلة متابعة</b>\n${card.options
        .map((o, i) => `${i + 1}. ${o.label}`)
        .join("\n")}`;

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
  return cards
    .map(renderCardForTelegram)
    .filter((block): block is string => block != null && block.trim().length > 0)
    .join("\n\n");
}
