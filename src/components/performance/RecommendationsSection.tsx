"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ListChecks, RefreshCw } from "lucide-react";
import { Button } from "@/components/squareui/button";
import { useLocale } from "@/hooks/useLocale";
import { TrackedPlanCard } from "@/components/recommendations/TrackedPlanCard";
import { EmptyState, SectionHeader, Surface } from "@/components/foundation";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { APP_WAKE_EVENT } from "@/lib/appWake";
import { getTradingSessionInfo } from "@/lib/agent/core/tradingSessions";
import {
  filterByPeriod,
  type StatsPeriod,
} from "@/lib/recommendations/recommendationStats";
import type { TrackedRecommendation } from "@/lib/recommendations/types";
import { cn } from "@/lib/utils";

/** Poll cadence for the live list — reads persisted state, never sweeps. */
const POLL_MS = 45_000;

type OutcomeFilter = "all" | "wins" | "losses" | "expired" | "other";
type SessionFilter = "all" | "sydney" | "tokyo" | "london" | "newyork" | "off_hours";

const OUTCOME_FILTERS: OutcomeFilter[] = ["all", "wins", "losses", "expired", "other"];
const PERIOD_FILTERS: { id: StatsPeriod; labelKey: string }[] = [
  { id: "today", labelKey: "stats.filter.today" },
  { id: "7d", labelKey: "stats.filter.7d" },
  { id: "30d", labelKey: "stats.filter.30d" },
  { id: "all", labelKey: "stats.filter.all" },
];
const SESSION_FILTERS: SessionFilter[] = [
  "all",
  "sydney",
  "tokyo",
  "london",
  "newyork",
  "off_hours",
];

function matchesOutcome(r: TrackedRecommendation, f: OutcomeFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "wins":
      return r.outcome.startsWith("win_");
    case "losses":
      return r.outcome === "loss";
    case "expired":
      return r.outcome === "expired";
    case "other":
      return r.outcome === "cancelled" || r.outcome === "invalidated";
  }
}

/** The session a record belongs to — the session of its FILL (or its issue). */
function sessionKeyOf(r: TrackedRecommendation): SessionFilter {
  return (getTradingSessionInfo(r.triggeredAt ?? r.createdAt).primary ??
    "off_hours") as SessionFilter;
}

function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  renderOption,
  testId,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  renderOption: (option: T) => string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      role="group"
      aria-label={label}
      className="inline-flex flex-wrap items-center gap-1 rounded-[var(--radius)] border border-border bg-card p-1"
    >
      <span className="px-1.5 text-[10px] text-muted-foreground">{label}</span>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={cn(
            "min-h-9 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-7",
            value === option
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {renderOption(option)}
        </button>
      ))}
    </div>
  );
}

/**
 * The /recommendations screen body: the live tracking record. Active plans
 * (pending entry + in trade, with live progress from the platform quote) above
 * the graded history, filterable by outcome, period and trading session.
 * Refreshes on its own cadence and on app wake; every read is persisted
 * state — the sweep runs server-side on its own schedule.
 */
export function RecommendationsSection() {
  const { t } = useLocale();
  const [recs, setRecs] = useState<TrackedRecommendation[] | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  /** The wall clock of the last load — one clock for every card's durations. */
  const [now, setNow] = useState(0);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [period, setPeriod] = useState<StatsPeriod>("all");
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("all");

  const loadPrices = useCallback(async (list: TrackedRecommendation[]) => {
    // One batched quote call for the symbols that can move a card — never a
    // request per recommendation.
    const symbols = [
      ...new Set(
        list
          .filter((r) => r.outcome === "pending")
          .map((r) => r.symbol)
          .filter(Boolean),
      ),
    ];
    if (!symbols.length) {
      setPrices({});
      return;
    }
    try {
      const res = await fetch(
        `/api/market/forex-price?symbols=${encodeURIComponent(symbols.join(","))}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        quotes?: { symbol: string; price: number }[];
      };
      const next: Record<string, number> = {};
      for (const q of json.quotes ?? []) {
        if (Number.isFinite(q.price)) next[q.symbol] = q.price;
      }
      setPrices(next);
    } catch {
      /* a missing quote only hides the live bar — the record still renders */
    }
  }, []);

  const load = useCallback(async () => {
    // A failed request used to be written in as an empty list, so a server
    // error was indistinguishable from "you have no recommendations".
    try {
      const res = await fetch("/api/recommendations/tracked", { cache: "no-store" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const json = (await res.json()) as { recommendations?: TrackedRecommendation[] };
      const list = json.recommendations ?? [];
      setRecs(list);
      setNow(Date.now());
      setFailed(false);
      void loadPrices(list);
    } catch {
      setFailed(true);
    }
  }, [loadPrices]);

  useEffect(() => {
    void load();
    // Live updates: poll on a cadence and refresh when the tab wakes — the
    // sweep may have graded a plan while the phone slept.
    const timer = setInterval(() => void load(), POLL_MS);
    const onWake = () => void load();
    window.addEventListener(APP_WAKE_EVENT, onWake);
    return () => {
      clearInterval(timer);
      window.removeEventListener(APP_WAKE_EVENT, onWake);
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  const filtered = useMemo(() => {
    let list = recs ?? [];
    list = filterByPeriod(list, period);
    if (outcomeFilter !== "all") list = list.filter((r) => matchesOutcome(r, outcomeFilter));
    if (sessionFilter !== "all") list = list.filter((r) => sessionKeyOf(r) === sessionFilter);
    return list;
  }, [recs, period, outcomeFilter, sessionFilter]);

  const active = filtered.filter((r) => r.outcome === "pending");
  const history = filtered.filter((r) => r.outcome !== "pending");
  const filtersActive =
    outcomeFilter !== "all" || period !== "all" || sessionFilter !== "all";

  return (
    <section id="recommendations" className="scroll-mt-24 space-y-3">
      <SectionHeader
        title={t("rec.page.title")}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
            onClick={() => void refresh()}
            disabled={busy}
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-3.5 w-3.5 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
            />
            {t("rec.page.refresh")}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2" data-testid="recommendations-filters">
        <FilterGroup
          label={t("rec.filter.outcome")}
          options={OUTCOME_FILTERS}
          value={outcomeFilter}
          onChange={setOutcomeFilter}
          renderOption={(o) => t(`rec.filter.outcome.${o}`)}
          testId="rec-outcome-filters"
        />
        <FilterGroup
          label={t("rec.filter.period")}
          options={PERIOD_FILTERS.map((p) => p.id)}
          value={period}
          onChange={setPeriod}
          renderOption={(p) =>
            t(PERIOD_FILTERS.find((entry) => entry.id === p)?.labelKey ?? "stats.filter.all")
          }
          testId="rec-period-filters"
        />
        <FilterGroup
          label={t("rec.filter.session")}
          options={SESSION_FILTERS}
          value={sessionFilter}
          onChange={setSessionFilter}
          renderOption={(s) => (s === "all" ? t("rec.filter.session.all") : t(`session.${s}`))}
          testId="rec-session-filters"
        />
      </div>

      {failed ? (
        <Surface padding="none">
          <EmptyState
            announce
            tone="danger"
            size="sm"
            icon={<AlertTriangle aria-hidden="true" />}
            title={t("agent.error")}
            description={t("agent.fault.retryable")}
            action={
              <Button
                variant="outline"
                size="xl"
                onClick={() => void refresh()}
                disabled={busy}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
                />
                {t("rec.page.refresh")}
              </Button>
            }
          />
        </Surface>
      ) : !recs ? (
        <div className="grid gap-3 md:grid-cols-2" aria-busy="true">
          {Array.from({ length: 2 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-40" />
          ))}
        </div>
      ) : recs.length === 0 ? (
        <Surface padding="none">
          <EmptyState
            size="sm"
            icon={<ListChecks aria-hidden="true" />}
            title={t("rec.page.empty")}
          />
        </Surface>
      ) : filtered.length === 0 && filtersActive ? (
        <Surface padding="none">
          <EmptyState
            size="sm"
            icon={<ListChecks aria-hidden="true" />}
            title={t("rec.filter.no_match")}
            action={
              <Button
                variant="outline"
                size="xl"
                onClick={() => {
                  setOutcomeFilter("all");
                  setPeriod("all");
                  setSessionFilter("all");
                }}
              >
                {t("rec.filter.reset")}
              </Button>
            }
          />
        </Surface>
      ) : null}

      {active.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
            {t("rec.page.active")} ({active.length})
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {active.map((r) => (
              <TrackedPlanCard
                key={r.id}
                rec={r}
                livePrice={prices[r.symbol] ?? null}
                now={now}
              />
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
            {t("rec.page.history")} ({history.length})
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {history.map((r) => (
              <TrackedPlanCard key={r.id} rec={r} now={now} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
