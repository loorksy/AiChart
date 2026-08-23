"use client";

/**
 * Agent Artifact cards, on the platform.
 *
 * The panel used to hand-render each piece of a result in a chain of inline
 * conditionals: the evidence card if present, the stage list if present, the
 * reasons if present. Everything else the run produced — the gate checklist,
 * the invalidation level, what research contributed, whether the candle
 * coverage was even sufficient — was computed, carried out to the browser, and
 * never drawn.
 *
 * This renders the derived cards instead. Its one structural property: the
 * switch below is exhaustive over the closed `AgentCard` union and ends in
 * `assertNeverCard`, so a card type added to the contract without a renderer
 * here fails `tsc`. The Telegram renderer is built the same way. That is what
 * keeps the two surfaces from drifting — not a convention, a compile error.
 *
 * No card carries a control. The platform places no orders, so the only
 * interactive variant sends a chat message.
 */
import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Ban,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  Coins,
  Compass,
  Eye,
  FlaskConical,
  ListChecks,
  Newspaper,
  Route,
  Sparkles,
  Target,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { deriveCards } from "@/lib/agent/cards/deriveCards";
import {
  assertNeverCard,
  COLLAPSED_BY_DEFAULT,
  type AgentCard,
} from "@/lib/agent/cards/types";
import { GATE_LABELS_AR } from "@/lib/agent/gates/chain";
import { visualTransparencyLine } from "@/lib/recommendations/visualTransparency";
import type { AgentFinalResult } from "@/lib/agent/types";
import { AgentEvidenceCard, AgentFaultCard } from "../AgentEnvelopeStatus";
import { AgentThinkingTraceDone } from "../AgentThinkingTrace";

/** A card's frame. Uniform on purpose: the CONTENT should distinguish them. */
function Shell({
  icon,
  title,
  tone = "neutral",
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tone?: "neutral" | "warn" | "danger" | "good";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "border-border/60 bg-muted/25",
    good: "border-buy/35 bg-buy/[0.06]",
    warn: "border-warning/40 bg-warning/[0.07]",
    danger: "border-destructive/40 bg-destructive/[0.06]",
  } as const;
  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 text-[12px] ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 font-semibold">
        <span className="shrink-0" aria-hidden>
          {icon}
        </span>
        <span>{title}</span>
      </div>
      <div className="mt-1 text-muted-foreground">{children}</div>
    </div>
  );
}

/** The collapsed frame for diagnostic depth — same set the phone drops. */
function Collapsible({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group mt-2 rounded-lg border border-border/40 bg-muted/10">
      <summary className="flex min-h-8 cursor-pointer select-none list-none items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
        <span className="shrink-0" aria-hidden>
          {icon}
        </span>
        {title}
      </summary>
      <div className="border-t border-border/30 px-2.5 py-2 text-[11px] text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-inside list-disc space-y-0.5 leading-relaxed">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

const ICON = "h-3.5 w-3.5";

function CardView({
  card,
  onOption,
  disabled,
}: {
  card: AgentCard;
  onOption?: (prompt: string) => void;
  disabled?: boolean;
}) {
  const { t, locale } = useLocale();

  switch (card.kind) {
    case "scenario_notice": {
      const opens = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
        timeZone: "Asia/Riyadh",
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      }).format(card.nextOpenAt);
      return (
        <Shell icon={<Clock className={ICON} />} title={t("agent.card.scenario")} tone="warn">
          <p className="leading-relaxed">
            {card.reasonAr} {t("agent.card.scenario_body")} {opens}
          </p>
        </Shell>
      );
    }

    case "decision":
      // Renders nothing HERE, on purpose, and this is the one case worth
      // spelling out: the panel already puts the decision and its confidence
      // in the message header, and the summary is the message body. A card
      // repeating either would read as two answers to one question.
      //
      // The card still exists, and still carries all three fields, because
      // Telegram has no chrome — there the cards ARE the message, and the
      // decision card is the first thing the operator reads. Same data, one
      // rendering each, neither surface duplicating its own frame.
      return null;

    case "plan_levels":
      return (
        <Shell icon={<Target className={ICON} />} title={t("agent.card.plan")} tone="good">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]" dir="ltr">
            <div className="flex justify-between gap-2">
              <dt>{t("agent.card.entry")}</dt>
              <dd className="font-mono text-foreground/80">
                {card.entry.toFixed(2)}
                {card.entryZone
                  ? ` (${card.entryZone.low.toFixed(2)}–${card.entryZone.high.toFixed(2)})`
                  : ""}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{t("agent.card.stop")}</dt>
              <dd className="font-mono text-foreground/80">{card.stopLoss.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{t("agent.card.targets")}</dt>
              <dd className="font-mono text-foreground/80">
                {card.targets.map((v) => v.toFixed(2)).join(" / ")}
              </dd>
            </div>
            {/* Net of costs or not at all — a gross RR is a price nobody gets. */}
            {card.netRr != null ? (
              <div className="flex justify-between gap-2">
                <dt>{t("agent.card.net_rr")}</dt>
                <dd className="font-mono text-foreground/80">{card.netRr.toFixed(2)}</dd>
              </div>
            ) : null}
          </dl>
        </Shell>
      );

    case "activation":
      return (
        <Shell icon={<Clock className={ICON} />} title={t("agent.card.activation")}>
          <p>{card.triggerCondition ?? t("agent.card.activation_immediate")}</p>
          {card.validityCandles ? (
            <p className="mt-0.5 text-[11px]">
              {t("agent.card.validity")}: {card.validityCandles}
            </p>
          ) : null}
        </Shell>
      );

    case "invalidation":
      return (
        <Shell icon={<Ban className={ICON} />} title={t("agent.card.invalidation")} tone="warn">
          {card.rule ? <p>{card.rule}</p> : null}
          {card.level != null ? (
            <p className="font-mono text-[11px] text-foreground/80" dir="ltr">
              {card.level.toFixed(2)}
            </p>
          ) : null}
        </Shell>
      );

    case "alternative_scenario":
      return (
        <Shell icon={<Compass className={ICON} />} title={t("agent.card.alternative")}>
          <p className="leading-relaxed">{card.scenario}</p>
        </Shell>
      );

    case "gate_checklist":
      return (
        <Shell
          icon={<ListChecks className={ICON} />}
          title={t("agent.card.gates")}
          tone={card.allowed ? "neutral" : "danger"}
        >
          <ul className="space-y-0.5">
            {card.verdicts.map((v) => (
              <li key={v.id} className="flex items-start gap-1.5">
                <span aria-hidden className="mt-[1px] shrink-0">
                  {v.status === "pass" ? (
                    <CheckCircle2 className="h-3 w-3 text-buy" />
                  ) : v.status === "veto" ? (
                    <Ban className="h-3 w-3 text-destructive" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 text-warning" />
                  )}
                </span>
                <span>
                  {GATE_LABELS_AR[v.id] ?? v.id}
                  {v.reasonAr ? ` — ${v.reasonAr}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Shell>
      );

    // The visual-basis line: rendered on every recommendation, both states.
    // "No chart was reviewed" is information the operator must see, so this
    // card never hides on absence of data.
    case "visual_review":
      return (
        <Shell
          icon={<Eye className={ICON} />}
          title={t("agent.card.visual_review")}
          tone={card.state === "contradicted" ? "danger" : "neutral"}
        >
          <p>
            {visualTransparencyLine(
              { state: card.state, timeframesReviewed: card.timeframes },
              locale,
            )}
          </p>
        </Shell>
      );

    case "key_reasons":
      return (
        <Shell icon={<Sparkles className={ICON} />} title={t("agent.card.reasons")}>
          <Bullets items={card.reasons} />
        </Shell>
      );

    case "public_reasoning":
      return (
        <Shell icon={<Route className={ICON} />} title={t("agent.card.reasoning")}>
          <Bullets items={card.points} />
        </Shell>
      );

    case "decision_trace":
      return (
        <Collapsible icon={<Route className="h-3 w-3" />} title={t("agent.card.trace")}>
          {card.trace.hypotheses.map((h, i) => (
            <div key={i} className="mb-1.5 last:mb-0">
              <p className="font-medium text-foreground/85">{h.scenario}</p>
              {h.supporting.length ? <Bullets items={h.supporting} /> : null}
              {h.opposing.length ? (
                <div className="text-warning">
                  <Bullets items={h.opposing} />
                </div>
              ) : null}
            </div>
          ))}
          <p className="mt-1 text-foreground/80">{card.trace.chosenBecause}</p>
          <p className="text-foreground/70">{card.trace.planTypeBecause}</p>
        </Collapsible>
      );

    case "evidence_strategy":
      // The one card that already had a component. Reused rather than
      // reimplemented: two renderings of one card is how they start disagreeing.
      return <AgentEvidenceCard card={card.card} />;

    case "evidence_dimensions":
      return (
        <Shell icon={<BarChart3 className={ICON} />} title={t("agent.card.dimensions")}>
          <ul className="space-y-0.5">
            {card.dimensions.map((d) => (
              <li key={d.key} className="flex items-start justify-between gap-2">
                <span>{d.detail}</span>
                {/* `unavailable` is a real grade and is shown as one — a blended
                    score would hide exactly the dimension that was missing. */}
                <span className="shrink-0 font-mono text-[10px] uppercase text-foreground/70">
                  {d.grade}
                </span>
              </li>
            ))}
          </ul>
        </Shell>
      );

    case "risk_warnings":
      return (
        <Shell
          icon={<AlertTriangle className={ICON} />}
          title={t("agent.card.risks")}
          tone="warn"
        >
          <Bullets items={card.warnings} />
        </Shell>
      );

    case "news_risk":
      return (
        <Shell
          icon={<Newspaper className={ICON} />}
          title={t("agent.card.news")}
          tone={card.risk.level === "high" ? "danger" : card.risk.level === "low" ? "neutral" : "warn"}
        >
          <p>{card.risk.reason}</p>
        </Shell>
      );

    case "cost_evidence":
      return (
        <Shell icon={<Coins className={ICON} />} title={t("agent.card.cost")}>
          <p dir="ltr" className="font-mono text-[11px] text-foreground/80">
            {card.spreadPips?.toFixed(1)} pips
            {card.session ? ` · ${card.session}` : ""}
          </p>
          {/* An estimate must never look like an observation. */}
          {card.fallbackUsed ? (
            <p className="mt-0.5 text-warning">
              {t("agent.card.cost_estimated")}
              {card.fallbackReason ? ` — ${card.fallbackReason}` : ""}
            </p>
          ) : null}
        </Shell>
      );

    case "research_evidence":
      return (
        <Collapsible icon={<FlaskConical className="h-3 w-3" />} title={t("agent.card.research")}>
          <p className="text-foreground/80">{card.summaryAr}</p>
          {card.skipped.length ? (
            <Bullets items={card.skipped.map((s) => `${s.system}: ${s.reason}`)} />
          ) : null}
        </Collapsible>
      );

    case "evidence_timeline":
      return (
        <Collapsible icon={<CalendarClock className="h-3 w-3" />} title={t("agent.card.timeline")}>
          <Bullets
            items={card.steps.map((s) =>
              // The reason is the point of the timeline: "skipped" alone says a
              // system did not run, not why it could not.
              s.reason ? `${s.step}: ${s.status} — ${s.reason}` : `${s.step}: ${s.status}`,
            )}
          />
        </Collapsible>
      );

    case "candle_coverage":
      return (
        <Collapsible icon={<Activity className="h-3 w-3" />} title={t("agent.card.coverage")}>
          <p>{card.report.summaryAr}</p>
        </Collapsible>
      );

    case "tracked_recommendation":
      return (
        <Shell icon={<Target className={ICON} />} title={t("agent.card.tracked")}>
          <p dir="ltr" className="font-mono text-[11px] text-foreground/80">
            {card.symbol} · {card.interval} · {card.direction} · {card.status}
          </p>
        </Shell>
      );

    case "envelope_status":
      // Reuses the fault card for a blocker; anything else is a quieter note.
      return card.envelope.outcome_class === "operational_blocker" ? (
        <AgentFaultCard envelope={card.envelope} />
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {/* Through the locale, not raw. This printed the enum member itself
              — an Arabic-speaking operator read the literal token
              "descriptive_only" on their screen. An internal name is not a
              sentence, and it is not in any language. */}
          {t(`outcome.${card.envelope.outcome_class}`)}
        </p>
      );

    case "skills_used":
      return (
        <Collapsible icon={<Sparkles className="h-3 w-3" />} title={t("agent.card.skills")}>
          {card.loaded.length ? (
            <Bullets items={card.loaded.map((s) => `${s.name} v${s.version}`)} />
          ) : null}
          {/* A skill that failed to load is reported, not swallowed: the answer
              was produced without guidance the operator believes it had. */}
          {card.failed.length ? (
            <div className="text-destructive">
              <Bullets items={card.failed.map((s) => `${s.name}: ${s.error}`)} />
            </div>
          ) : null}
        </Collapsible>
      );

    case "run_stages":
      // Claude-style settled trace: same collapsed-by-default header the live
      // run shows, fed by the SAME persisted stage data this card always had.
      return <AgentThinkingTraceDone stages={card.stages} />;

    case "follow_up_options":
      return (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onOption?.(o.prompt)}
              disabled={disabled}
              // min-h-11 on touch: these are the panel's only tap targets, and
              // they were 44px before the cards took them over. Shrinking them
              // would be a silent accessibility regression.
              className="min-h-11 rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-50 focus-ring sm:min-h-8"
            >
              {o.label}
            </button>
          ))}
        </div>
      );

    default:
      return assertNeverCard(card);
  }
}

/**
 * Every card this result supports, in reading order.
 *
 * `deriveCards` decides what exists; this decides only how it looks. Keeping
 * that split is what lets the phone render the same answer without a second
 * pass over the result.
 */
export function AgentCards({
  result,
  onOption,
  disabled,
}: {
  result: AgentFinalResult;
  onOption?: (prompt: string) => void;
  /** A run is in flight — the follow-up buttons must not queue a second one. */
  disabled?: boolean;
}) {
  const cards = useMemo(() => deriveCards(result), [result]);
  return (
    <div data-testid="agent-cards">
      {cards.map((card) => (
        <CardView key={card.kind} card={card} onOption={onOption} disabled={disabled} />
      ))}
    </div>
  );
}

export { COLLAPSED_BY_DEFAULT };
