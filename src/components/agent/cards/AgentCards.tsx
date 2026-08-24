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
import { useId, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
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
import { buildLadder } from "@/lib/agent/cards/ladder";
import {
  assertNeverCard,
  COLLAPSED_BY_DEFAULT,
  type AgentCard,
  type CardKind,
  type PlanLevelsCard,
} from "@/lib/agent/cards/types";
import { GATE_LABELS_AR } from "@/lib/agent/gates/chain";
import type { GateVerdict } from "@/lib/agent/gates/types";
import { visualTransparencyLine } from "@/lib/recommendations/visualTransparency";
import type { AgentDecision, AgentFinalResult } from "@/lib/agent/types";
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

/**
 * The plan as geometry, not as four numbers.
 *
 * A `dl` of entry/stop/targets hides the one property that decides whether a
 * plan is worth taking: how far the stop sits from the entry compared with how
 * far the targets do. That ratio IS the trade, and reading it off a list means
 * doing arithmetic the eye could have done for free.
 *
 * Plotted on a shared price axis it reads before it is calculated. The axis
 * needs no direction flag either — a sell's stop is simply its highest number
 * and its targets its lowest, so orientation falls out of the prices
 * themselves and there is no second code path to get wrong.
 */
function PriceLadder({
  direction,
  entry,
  stopLoss,
  targets,
  livePrice,
}: {
  direction: "buy" | "sell";
  entry: number;
  stopLoss: number;
  targets: number[];
  livePrice?: number;
}) {
  const { t } = useLocale();
  // The arithmetic lives in `ladder.ts` and is tested there: a stop drawn on
  // the profit side of the entry neither throws nor fails to compile, it just
  // draws a trade that isn't the trade.
  const geometry = buildLadder({ entry, stopLoss, targets, livePrice });

  let targetSeen = 0;
  const rungs = geometry.rungs.map((rung) => ({
    ...rung,
    label:
      rung.role === "stop"
        ? t("agent.card.stop")
        : rung.role === "entry"
          ? t("agent.card.entry")
          : rung.role === "live"
            ? t("agent.signal.live")
            : t("agent.signal.target_n", { n: String(++targetSeen) }),
  }));

  const band = (a: number, b: number) => ({
    bottom: `${Math.min(a, b) * 100}%`,
    height: `${Math.abs(a - b) * 100}%`,
  });

  return (
    <div className="relative mt-2 h-[172px]" dir="ltr">
      <div className="absolute inset-y-3 left-0 right-0">
        {/* The rail, then the two zones painted onto it: what the plan pays
            to be wrong, and what it stands to make. */}
        <div className="absolute bottom-0 top-0 w-[2px] rounded-full bg-border ltr:left-[86px] rtl:right-[86px]" />
        <div
          className="absolute w-[2px] rounded-full bg-sell ltr:left-[86px] rtl:right-[86px]"
          style={band(geometry.riskBand.from, geometry.riskBand.to)}
        />
        <div
          className="absolute w-[2px] rounded-full bg-buy ltr:left-[86px] rtl:right-[86px]"
          style={band(geometry.rewardBand.from, geometry.rewardBand.to)}
        />

        {rungs.map((rung) => {
          const isEntry = rung.role === "entry";
          const isLive = rung.role === "live";
          return (
            <div
              key={`${rung.role}-${rung.price}`}
              className="absolute left-0 right-0 flex -translate-y-1/2 items-center"
              style={{ top: `${(1 - rung.pos) * 100}%` }}
            >
              <span
                className={`w-[78px] shrink-0 text-right font-mono tabular-nums ${
                  isEntry
                    ? "text-[13px] font-bold text-foreground"
                    : rung.role === "stop"
                      ? "text-[12px] text-sell"
                      : rung.role === "target"
                        ? "text-[12px] text-buy"
                        : "text-[12px] text-muted-foreground"
                }`}
              >
                {rung.price.toFixed(2)}
              </span>
              <span
                aria-hidden
                className={`absolute rounded-full border-2 border-card ltr:left-[82px] rtl:right-[82px] ${
                  isEntry
                    ? `h-3.5 w-3.5 ${direction === "buy" ? "bg-buy" : "bg-sell"}`
                    : isLive
                      ? "h-2.5 w-2.5 border-muted-foreground bg-card"
                      : rung.role === "stop"
                        ? "h-2.5 w-2.5 bg-sell"
                        : "h-2.5 w-2.5 bg-buy"
                }`}
                style={isEntry ? { insetInlineStart: "80px" } : undefined}
              />
              <span
                className={`ms-6 flex items-baseline gap-1.5 text-[11.5px] ${
                  isEntry ? "font-semibold text-foreground" : "text-muted-foreground"
                }`}
              >
                {rung.label}
                {rung.rr != null ? (
                  <span className="rounded bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">
                    {rung.rr.toFixed(1)}R
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The answer, before any of the working.
 *
 * Everything this panel drew used to arrive as one flat stack of equal cards:
 * the plan sat between the gate list and the evidence dimensions, all open at
 * once, and finding "buy or sell, at what price" meant reading past six
 * headings that answer a different question. This is the one card that answers
 * it, and the button below it is where the working goes.
 */
function SignalHero({
  decision,
  confidence,
  plan,
  blocker,
  symbol,
  interval,
  open,
  onToggle,
  detailsId,
}: {
  decision: AgentDecision;
  confidence?: number;
  plan?: PlanLevelsCard;
  blocker?: GateVerdict;
  symbol?: string;
  interval?: string;
  open: boolean;
  onToggle: () => void;
  detailsId: string;
}) {
  const { t } = useLocale();
  const side = decision === "buy" ? "buy" : decision === "sell" ? "sell" : "none";

  const accent =
    side === "buy" ? "text-buy" : side === "sell" ? "text-sell" : "text-warning";
  const stripe =
    side === "buy" ? "bg-buy" : side === "sell" ? "bg-sell" : "bg-warning";
  const fill =
    side === "buy" ? "bg-buy" : side === "sell" ? "bg-sell" : "bg-warning";

  const livePrice =
    typeof blocker?.evidence?.currentPrice === "number"
      ? (blocker.evidence.currentPrice as number)
      : undefined;

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* The single loudest element on the card, and it is semantic: the
          direction, in the direction's own colour. */}
      <div className={`h-[3px] ${stripe}`} />

      <div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3">
        <span className={`inline-flex items-center gap-1.5 text-[16px] font-bold ${accent}`}>
          {side === "buy" ? (
            <ArrowUp className="h-4 w-4 shrink-0" strokeWidth={3} />
          ) : side === "sell" ? (
            <ArrowDown className="h-4 w-4 shrink-0" strokeWidth={3} />
          ) : (
            <Ban className="h-4 w-4 shrink-0" strokeWidth={2.5} />
          )}
          {t(`agent.signal.${side}`)}
        </span>
        {symbol ? (
          <span className="ms-auto text-end leading-tight">
            <span className="block font-mono text-[13px] font-bold tracking-wide">
              {symbol}
            </span>
            {interval ? (
              <span className="block text-[10.5px] text-muted-foreground">{interval}</span>
            ) : null}
          </span>
        ) : null}
      </div>

      {/* Confidence as a meter: 52% is a position on a range, not a word. */}
      {confidence != null ? (
        <div className="flex items-center gap-2.5 px-3.5 pb-3">
          <span className="whitespace-nowrap text-[10.5px] text-muted-foreground">
            {t("agent.signal.strength")}
          </span>
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className={`block h-full rounded-full ${fill}`}
              style={{ width: `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%` }}
            />
          </span>
          <span className="font-mono text-[11.5px] font-bold tabular-nums">
            {Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%
          </span>
        </div>
      ) : null}

      {/* The blocker states, once and loudly, why there is nothing to take.
          It used to be buried mid-way down a seven-item checklist. */}
      {blocker?.reasonAr ? (
        <div className="px-3.5 pb-3">
          <div className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning/[0.07] px-3 py-2.5 text-[12.5px] leading-relaxed">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>{blocker.reasonAr}</span>
          </div>
        </div>
      ) : null}

      {plan ? (
        <div className="border-t border-border/50 px-3.5 pb-3">
          <PriceLadder
            direction={plan.direction}
            entry={plan.entry}
            stopLoss={plan.stopLoss}
            targets={plan.targets}
            livePrice={livePrice}
          />
        </div>
      ) : null}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={detailsId}
        // min-h-11 for touch: this is the card's only control.
        className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-border/50 bg-muted/30 px-3.5 py-3 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring"
      >
        {open
          ? t("agent.signal.hide")
          : plan
            ? t("agent.signal.why")
            : t("agent.signal.what_plan")}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
    </div>
  );
}

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
          <ul className="space-y-1">
            {card.dimensions.map((d) => (
              <li key={d.key} className="flex items-start justify-between gap-2">
                <span>{d.detail}</span>
                {/* `unavailable` is a real grade and is shown as one — a blended
                    score would hide exactly the dimension that was missing.
                    Through the locale, never raw: this printed the enum member
                    itself, so an Arabic sentence ended in the English word
                    "moderate" with no separator before it. */}
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-border/70 px-2 py-px text-[10px] ${
                    d.grade === "strong" ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      d.grade === "strong"
                        ? "bg-buy"
                        : d.grade === "moderate"
                          ? "bg-warning"
                          : d.grade === "weak"
                            ? "bg-muted-foreground/50"
                            : "bg-border"
                    }`}
                  />
                  {t(`dimension.${d.grade}`)}
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
 * Where each card belongs, now that the answer and its working are separate.
 *
 * `Record<CardKind, Slot>` and not a lookup with a default: the exhaustive
 * switch above already fails `tsc` when a card type gains no renderer, and
 * this keeps the same promise about PLACEMENT. A new card type that nobody
 * assigns a slot to is a compile error, never a card that silently renders in
 * whichever group happened to be the fallback.
 */
type Slot = "lead" | "hero" | "details" | "trail";

const SLOT: Record<CardKind, Slot> = {
  // Frames everything below it, so it cannot sit behind a button.
  scenario_notice: "lead",

  // The answer itself — composed into one card, not three stacked ones.
  decision: "hero",
  plan_levels: "hero",
  gate_checklist: "hero",

  // The working.
  activation: "details",
  invalidation: "details",
  alternative_scenario: "details",
  visual_review: "details",
  key_reasons: "details",
  public_reasoning: "details",
  decision_trace: "details",
  evidence_strategy: "details",
  evidence_dimensions: "details",
  risk_warnings: "details",
  news_risk: "details",
  cost_evidence: "details",
  research_evidence: "details",
  evidence_timeline: "details",
  candle_coverage: "details",
  tracked_recommendation: "details",
  skills_used: "details",

  // Chrome and controls: outside the fold, never inside it.
  envelope_status: "trail",
  run_stages: "trail",
  follow_up_options: "trail",
};

/**
 * Every card this result supports — the answer first, the working behind it.
 *
 * `deriveCards` decides what exists; this decides only how it looks. Keeping
 * that split is what lets the phone render the same answer without a second
 * pass over the result.
 *
 * What changed: these cards used to render as one flat stack of equal frames,
 * every one of them open. Reading "buy or sell, at what price" meant scanning
 * past the gate checklist, the reasoning, the evidence dimensions and the risk
 * warnings — six headings that answer a different question — and on a phone
 * the plan itself was usually below the fold. Worse, the refusal that mattered
 * most ("the price has moved past the entry") arrived as item seven of a
 * checklist, in the same weight as the six that passed.
 *
 * So the answer is composed into ONE card — direction, instrument, confidence,
 * the price ladder, and the blocker when there is one — and everything else
 * moves behind that card's single button, into a section that opens in the
 * chat rather than over it.
 */
export function AgentCards({
  result,
  onOption,
  disabled,
  symbol,
  interval,
}: {
  result: AgentFinalResult;
  onOption?: (prompt: string) => void;
  /** A run is in flight — the follow-up buttons must not queue a second one. */
  disabled?: boolean;
  /** Shown on the head of the card; omitted rather than guessed. */
  symbol?: string;
  interval?: string;
}) {
  const cards = useMemo(() => deriveCards(result), [result]);
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  const lead = cards.filter((c) => SLOT[c.kind] === "lead");
  const details = cards.filter((c) => SLOT[c.kind] === "details");
  const trail = cards.filter((c) => SLOT[c.kind] === "trail");

  const decisionCard = cards.find((c) => c.kind === "decision");
  const planCard = cards.find((c): c is PlanLevelsCard => c.kind === "plan_levels");
  const gates = cards.find((c) => c.kind === "gate_checklist");

  // The gate that refused, resolved to the verdict itself so the hero can
  // print its reason and read the live price out of its evidence.
  const blocker: GateVerdict | undefined =
    gates && !gates.allowed
      ? (gates.verdicts.find((v) => v.id === gates.vetoedBy) ??
        gates.verdicts.find((v) => v.status === "veto"))
      : undefined;

  return (
    <div data-testid="agent-cards">
      {lead.map((card) => (
        <CardView key={card.kind} card={card} onOption={onOption} disabled={disabled} />
      ))}

      {decisionCard ? (
        <SignalHero
          decision={decisionCard.decision}
          confidence={decisionCard.confidence}
          plan={planCard}
          blocker={blocker}
          symbol={symbol}
          interval={interval}
          open={open}
          onToggle={() => setOpen((v) => !v)}
          detailsId={detailsId}
        />
      ) : null}

      {/* Kept mounted so the browser keeps the scroll position when it closes,
          and so a find-in-page still reaches the working. */}
      <div id={detailsId} hidden={!open} data-testid="agent-cards-details">
        {details.map((card) => (
          <CardView key={card.kind} card={card} onOption={onOption} disabled={disabled} />
        ))}
      </div>

      {trail.map((card) => (
        <CardView key={card.kind} card={card} onOption={onOption} disabled={disabled} />
      ))}
    </div>
  );
}

export { COLLAPSED_BY_DEFAULT };
