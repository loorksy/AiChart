"use client";

/**
 * The recommendation report as a professional analytic document.
 *
 * The chat thread keeps a compact signal card and a "show report" control.
 * This is the document that control opens: no liquid-metal frame, no platinum
 * gradient, no full-colour gadget borders. One start-accent per section,
 * a 2×2 metric grid for the plan, checks as wrapping chips, and a layout that
 * is a bottom sheet on a phone and a centred two-column dialog from tablet up.
 */
import { useRef, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useSheetGesture } from "@/hooks/useSheetGesture";
import {
  Ban,
  CheckCircle2,
  Clock,
  Compass,
  FileText,
  ListChecks,
  Target,
  X,
  AlertTriangle,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import {
  invalidationDisplay,
  isPlaceholderGateLabel,
  visibleGateVerdicts,
} from "@/lib/agent/cards/reportPresentation";
import type {
  ActivationCard,
  AlternativeScenarioCard,
  GateChecklistCard,
  InvalidationCard,
  PlanLevelsCard,
} from "@/lib/agent/cards/types";
import type { GateVerdict } from "@/lib/agent/gates/types";

const ICON = "h-3.5 w-3.5";

type Accent = "neutral" | "good" | "warn" | "danger" | "quiet";

const START: Record<Accent, string> = {
  neutral: "border-s-border",
  good: "border-s-buy/55",
  warn: "border-s-warning/65",
  danger: "border-s-destructive/55",
  quiet: "border-s-border/50",
};

export function ReportSection({
  icon,
  title,
  accent = "neutral",
  testId,
  children,
}: {
  icon: ReactNode;
  title: string;
  accent?: Accent;
  testId?: string;
  children: ReactNode;
}) {
  const quiet = accent === "quiet";
  return (
    <section
      data-testid={testId}
      className={cn(
        "rounded-lg border-s-2 bg-muted/15 px-3 py-3 sm:px-4 sm:py-4",
        START[accent],
        quiet && "bg-muted/10",
      )}
    >
      <header
        className={cn(
          "mb-3 flex items-center gap-2 text-[12px] font-semibold tracking-wide",
          quiet ? "text-muted-foreground" : "text-foreground",
        )}
      >
        <span className="shrink-0" aria-hidden>
          {icon}
        </span>
        <h3 className="min-w-0 truncate">{title}</h3>
      </header>
      <div className={cn("text-[12.5px] leading-relaxed", quiet ? "text-muted-foreground" : "text-foreground/85")}>
        {children}
      </div>
    </section>
  );
}

export function PlanMetrics({ card }: { card: PlanLevelsCard }) {
  const { t } = useLocale();
  return (
    <ReportSection
      icon={<Target className={ICON} />}
      title={t("agent.card.plan")}
      accent="good"
      testId="recommendation-report-plan"
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Metric
          label={t("agent.card.entry")}
          value={card.entry.toFixed(2)}
          caption={
            card.entryZone
              ? `${card.entryZone.low.toFixed(2)}–${card.entryZone.high.toFixed(2)}`
              : undefined
          }
        />
        <Metric label={t("agent.card.stop")} value={card.stopLoss.toFixed(2)} />
        <Metric
          label={t("agent.card.targets")}
          value={card.targets.map((v) => v.toFixed(2)).join(" · ")}
        />
        {card.netRr != null ? (
          <Metric label={t("agent.card.net_rr")} value={card.netRr.toFixed(2)} />
        ) : (
          <div />
        )}
      </dl>
    </ReportSection>
  );
}

function Metric({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all font-mono text-[15px] font-semibold tabular-nums leading-snug text-foreground" dir="ltr">
        {value}
      </dd>
      {caption ? (
        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground" dir="ltr">
          {caption}
        </p>
      ) : null}
    </div>
  );
}

export function ActivationRow({ card }: { card: ActivationCard }) {
  const { t } = useLocale();
  const status = card.triggerCondition ?? t("agent.card.activation_immediate");
  return (
    <ReportSection
      icon={<Clock className={ICON} />}
      title={t("agent.card.activation")}
      accent="neutral"
      testId="recommendation-report-activation"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex max-w-full items-center rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium text-foreground">
          {status}
        </span>
        {card.validityCandles != null ? (
          <span className="text-[12px] text-muted-foreground">
            {t("agent.card.validity")}:{" "}
            <span className="font-mono font-semibold tabular-nums text-foreground">
              {card.validityCandles}
            </span>
          </span>
        ) : null}
      </div>
    </ReportSection>
  );
}

export function ChecksChips({ card }: { card: GateChecklistCard }) {
  const { t } = useLocale();
  const verdicts = visibleGateVerdicts(card.verdicts).filter((v) => {
    const key = `gate.label.${v.id}`;
    const label = t(key);
    if (label === key || isPlaceholderGateLabel(label)) return false;
    return true;
  });
  if (!verdicts.length) return null;

  return (
    <ReportSection
      icon={<ListChecks className={ICON} />}
      title={t("agent.card.gates")}
      accent={card.allowed ? "neutral" : "danger"}
      testId="recommendation-report-checks"
    >
      <ul className="flex flex-wrap gap-2">
        {verdicts.map((v) => (
          <GateChip key={v.id} verdict={v} label={t(`gate.label.${v.id}`)} />
        ))}
      </ul>
    </ReportSection>
  );
}

function GateChip({ verdict, label }: { verdict: GateVerdict; label: string }) {
  const tone =
    verdict.status === "pass"
      ? "border-border/50 bg-background text-foreground"
      : verdict.status === "veto"
        ? "border-destructive/30 bg-destructive/10 text-foreground"
        : "border-warning/30 bg-warning/10 text-foreground";
  return (
    <li
      title={verdict.reasonAr || undefined}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] leading-none",
        tone,
      )}
    >
      <span aria-hidden className="shrink-0">
        {verdict.status === "pass" ? (
          <CheckCircle2 className="h-3 w-3 text-buy" />
        ) : verdict.status === "veto" ? (
          <Ban className="h-3 w-3 text-destructive" />
        ) : (
          <AlertTriangle className="h-3 w-3 text-warning" />
        )}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </li>
  );
}

export function InvalidationBlock({ card }: { card: InvalidationCard }) {
  const { t } = useLocale();
  const { statement, price } = invalidationDisplay(card.rule, card.level);
  if (!statement && !price) return null;
  return (
    <ReportSection
      icon={<Ban className={ICON} />}
      title={t("agent.card.invalidation")}
      accent="warn"
      testId="recommendation-report-invalidation"
    >
      {statement ? <p className="leading-relaxed">{statement}</p> : null}
      {price ? (
        <p className="mt-2 font-mono text-[15px] font-semibold tabular-nums text-foreground" dir="ltr">
          {price}
        </p>
      ) : null}
    </ReportSection>
  );
}

export function AlternativeBlock({ card }: { card: AlternativeScenarioCard }) {
  const { t } = useLocale();
  return (
    <ReportSection
      icon={<Compass className={ICON} />}
      title={t("agent.card.alternative")}
      accent="quiet"
      testId="recommendation-report-alternative"
    >
      <p className="leading-relaxed">{card.scenario}</p>
    </ReportSection>
  );
}

/**
 * Modal chrome + responsive document body.
 *
 * Mobile: full-width bottom sheet, nearly the viewport. Dismiss by folding
 * the sheet down (handle + body) or tapping the dimmed overlay — no X.
 * Tablet (`md`): centred dialog, 2-column primary grid, discreet close X.
 * Desktop (`lg`): the same grid, wider.
 */
export function RecommendationReport({
  dir,
  title,
  closeLabel,
  plan,
  gates,
  activation,
  invalidation,
  alternative,
  extras,
  onClose,
}: {
  dir: string;
  title: string;
  closeLabel: string;
  plan?: PlanLevelsCard;
  gates?: GateChecklistCard;
  activation?: ActivationCard;
  invalidation?: InvalidationCard;
  alternative?: AlternativeScenarioCard;
  extras: ReactNode;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { handleProps, surfaceProps } = useSheetGesture({
    sheetRef,
    scrollRef,
    onDismiss: onClose,
    // Tailwind `md` — the centred dialog keeps an X; only the phone sheet folds.
    enabledQuery: "(max-width: 767px)",
  });

  return (
    <Dialog.Popup
      ref={sheetRef}
      dir={dir}
      data-testid="recommendation-report-modal"
      className={cn(
        "fixed z-[121] flex w-full flex-col overflow-hidden bg-background text-foreground shadow-2xl",
        "left-0 right-0 top-auto bottom-0 max-h-[92vh] rounded-t-2xl border-x border-t border-border",
        "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        "max-md:will-change-transform",
        "max-md:transition-transform max-md:duration-300 max-md:ease-[cubic-bezier(0.32,0.72,0,1)]",
        "max-md:data-starting-style:translate-y-full max-md:data-ending-style:translate-y-full",
        "md:left-1/2 md:right-auto md:bottom-auto md:top-[6vh] md:max-h-[88vh]",
        "md:w-[min(100%-2rem,42rem)] md:-translate-x-1/2 md:rounded-2xl md:border md:pb-0",
        "md:transition-opacity md:duration-250 md:data-ending-style:opacity-0 md:data-starting-style:opacity-0",
        "lg:top-[8vh] lg:w-[min(100%-2rem,56rem)]",
        "motion-reduce:transition-none",
      )}
    >
      <div
        {...handleProps}
        data-testid="recommendation-report-handle"
        className="flex cursor-grab justify-center pt-3 pb-2 md:hidden active:cursor-grabbing"
        aria-hidden
      >
        <span className="h-1.5 w-12 rounded-full bg-muted-foreground/50" />
      </div>
      <header
        onPointerDown={handleProps.onPointerDown}
        onPointerMove={handleProps.onPointerMove}
        onPointerUp={handleProps.onPointerUp}
        onPointerCancel={handleProps.onPointerCancel}
        className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-3 max-md:touch-none"
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <Dialog.Title className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
          {title}
        </Dialog.Title>
        <Dialog.Close
          className="sr-only md:hidden"
          aria-label={closeLabel}
        >
          {closeLabel}
        </Dialog.Close>
        <Dialog.Close
          className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring md:inline-flex"
          aria-label={closeLabel}
          data-testid="recommendation-report-close"
        >
          <X className="h-4 w-4" aria-hidden />
        </Dialog.Close>
      </header>
      <div
        ref={scrollRef}
        {...surfaceProps}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4"
      >
        <div className="flex flex-col gap-3 md:gap-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
            <div className="flex min-w-0 flex-col gap-3">
              {plan ? <PlanMetrics card={plan} /> : null}
              {activation ? <ActivationRow card={activation} /> : null}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              {invalidation ? <InvalidationBlock card={invalidation} /> : null}
              {alternative ? <AlternativeBlock card={alternative} /> : null}
            </div>
          </div>
          {gates ? <ChecksChips card={gates} /> : null}
          {extras}
        </div>
      </div>
    </Dialog.Popup>
  );
}
