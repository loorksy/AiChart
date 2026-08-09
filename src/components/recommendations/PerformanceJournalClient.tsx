"use client";

/**
 * Performance Journal page (Group 9) over GET /api/recommendations/journal.
 *
 * Shows the followed / ignored / auto / manual comparison, adherence rates,
 * entry deviation, SL match, early exits, delayed entries, per-session
 * performance, R multiples, and the server's personal observations.
 *
 * One hard display rule, applied everywhere: a percentage computed over a tiny
 * sample NEVER appears without its small-sample warning. Descriptive only —
 * nothing here gates a recommendation.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, BookOpen, RefreshCw, TriangleAlert } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { EmptyState, PageHeader, Surface } from "@/components/foundation";
import { Button } from "@/components/squareui/button";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { JournalSummary } from "@/lib/recommendations/performanceJournal";
import type { JournalEntryView } from "@/app/api/recommendations/journal/route";

/** Below this, a rate is shown only alongside the small-sample warning. */
const SMALL_SAMPLE = 10;

type SessionKey = "asia" | "london" | "newyork";

/** UTC session bucket — mirrors the journal lib's pure sessionOf. */
function sessionOf(timestamp: number): SessionKey {
  const hour = new Date(timestamp).getUTCHours();
  if (hour >= 7 && hour < 12) return "london";
  if (hour >= 12 && hour < 21) return "newyork";
  return "asia";
}

function isWin(outcome: string): boolean {
  return outcome.startsWith("win_");
}

function isResolved(outcome: string): boolean {
  return outcome !== "pending";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function SmallSampleWarning({ n }: { n: number }) {
  const { t } = useLocale();
  return (
    <p className="mt-1 flex items-start gap-1 text-[11px] text-warning">
      <TriangleAlert className="mt-px h-3 w-3 shrink-0" aria-hidden />
      {t("journal.small_sample", { n: String(n) })}
    </p>
  );
}

/**
 * A rate that refuses to mislead: no data → "not enough data"; a small sample
 * → the number WITH its warning; otherwise the number alone.
 */
function Rate({ wins, count }: { wins: number; count: number }) {
  const { t } = useLocale();
  if (count === 0) {
    return <p className="text-xs text-muted-foreground">{t("journal.no_data")}</p>;
  }
  return (
    <>
      <p className="text-lg font-bold text-foreground">{pct(wins / count)}</p>
      <p className="text-[11px] text-muted-foreground">
        {t("journal.wins_of", { wins: String(wins), count: String(count) })}
      </p>
      {count < SMALL_SAMPLE ? <SmallSampleWarning n={count} /> : null}
    </>
  );
}

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Surface padding="sm">
      <p className="text-[11px] font-medium text-muted-foreground">{title}</p>
      <div className="mt-1">{children}</div>
    </Surface>
  );
}

export function PerformanceJournalClient() {
  const { t, dir } = useLocale();
  const [data, setData] = useState<{
    summary: JournalSummary;
    entries: JournalEntryView[];
  } | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /**
   * The list runs to fifty rows across every symbol and every outcome. Narrowing
   * it is how you answer the questions the page exists for — "how did I do on
   * gold", "show me only the losses" — so the controls live above the table
   * rather than leaving you to scan it.
   */
  const [symbolFilter, setSymbolFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "wins" | "losses">("all");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/recommendations/journal", { cache: "no-store" });
        if (!res.ok) throw new Error("load failed");
        const json = (await res.json()) as {
          summary?: JournalSummary;
          entries?: JournalEntryView[];
        };
        if (!alive) return;
        // A 200 with no summary used to leave the page blank forever, because
        // neither the data nor the error branch was taken.
        if (json.summary) {
          setData({ summary: json.summary, entries: json.entries ?? [] });
        } else {
          setError(true);
        }
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  if (error) {
    return (
      <div dir={dir} className="mx-auto w-full max-w-6xl">
        <Surface padding="none">
          <EmptyState
            announce
            tone="danger"
            icon={<AlertTriangle aria-hidden="true" />}
            title={t("journal.error")}
            description={t("agent.fault.retryable")}
            action={
              <Button
                variant="outline"
                size="xl"
                onClick={() => {
                  setError(false);
                  setReloadKey((k) => k + 1);
                }}
              >
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                {t("rec.page.refresh")}
              </Button>
            }
          />
        </Surface>
      </div>
    );
  }

  // Returning null here rendered a blank page for the whole fetch.
  if (!data) {
    return (
      <div dir={dir} className="mx-auto w-full max-w-6xl space-y-3" aria-busy="true">
        <span className="sr-only">{t("journal.title")}</span>
        <SkeletonBlock className="h-24" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-24" />
          ))}
        </div>
        <SkeletonBlock className="h-64" />
      </div>
    );
  }

  const { summary, entries } = data;
  const resolved = entries.filter((e) => isResolved(e.outcome));
  const followed = resolved.filter((e) => e.followState !== "ignored");
  const empty = resolved.length === 0;

  // Entry deviation: mean absolute distance from the plan price, as a percent.
  const deviations = followed
    .map((e) => e.entryDeviation)
    .filter((v): v is number => v != null);
  const avgDeviation = deviations.length
    ? deviations.reduce((sum, v) => sum + Math.abs(v), 0) / deviations.length
    : null;
  const stopSample = followed.filter((e) => e.stopMatchedPlan != null).length;

  // Counts are canonical — the server summary already applied the threshold.
  const earlyExits = summary.earlyExitCount;
  const delayedEntries = summary.delayedEntryCount;

  const rValues = entries
    .map((e) => e.rMultiple)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const avgR = rValues.length ? rValues.reduce((s, v) => s + v, 0) / rValues.length : null;

  const sessions: SessionKey[] = ["asia", "london", "newyork"];
  const bySession = sessions.map((session) => {
    const list = resolved.filter((e) => sessionOf(e.createdAt) === session);
    return {
      session,
      count: list.length,
      wins: list.filter((e) => isWin(e.outcome)).length,
    };
  });

  const symbols = Array.from(new Set(entries.map((e) => e.symbol))).sort();
  const visibleEntries = entries.filter((e) => {
    if (symbolFilter !== "all" && e.symbol !== symbolFilter) return false;
    if (outcomeFilter === "wins") return isWin(e.outcome);
    if (outcomeFilter === "losses") return e.outcome === "loss";
    return true;
  });

  const selectClass =
    "min-h-11 rounded-lg border border-border bg-background px-2 text-[12px] text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9";

  const outcomeLabel = (outcome: string): string => {
    switch (outcome) {
      case "win_tp1":
        return t("rec.status.tp1_hit");
      case "win_tp2":
        return t("rec.status.tp2_hit");
      case "win_tp3":
        return t("rec.status.tp3_hit");
      case "loss":
        return t("rec.status.sl_hit");
      case "expired":
        return t("rec.status.expired");
      case "cancelled":
        return t("rec.status.cancelled");
      case "invalidated":
        return t("rec.status.invalidated");
      default:
        return t("rec.status.pending_entry");
    }
  };

  return (
    <div dir={dir} className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader
        title={t("journal.title")}
        description={t("journal.subtitle")}
        icon={<BookOpen aria-hidden="true" />}
      />

      {empty ? (
        <Surface padding="none">
          <EmptyState
            icon={<BookOpen aria-hidden="true" />}
            title={t("journal.empty")}
          />
        </Surface>
      ) : (
        <>
          {/* Followed / ignored / auto / manual breakdown. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile title={t("journal.followed")}>
              <Rate wins={summary.followed.wins} count={summary.followed.count} />
            </Tile>
            <Tile title={t("journal.ignored")}>
              <Rate wins={summary.ignored.wins} count={summary.ignored.count} />
            </Tile>
            <Tile title={t("journal.auto")}>
              <Rate wins={summary.auto.wins} count={summary.auto.count} />
            </Tile>
            <Tile title={t("journal.manual")}>
              <Rate wins={summary.manual.wins} count={summary.manual.count} />
            </Tile>
          </div>

          {/* Adherence and behaviour. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile title={t("journal.adherence.entry")}>
              {summary.entryAdherence == null ? (
                <p className="text-xs text-muted-foreground">{t("journal.no_data")}</p>
              ) : (
                <>
                  <p className="text-lg font-bold text-foreground">
                    {pct(summary.entryAdherence)}
                  </p>
                  {avgDeviation != null ? (
                    <p className="text-[11px] text-muted-foreground">
                      {t("journal.entry.deviation")}:{" "}
                      <span dir="ltr">±{(avgDeviation * 100).toFixed(3)}%</span>
                    </p>
                  ) : null}
                  {deviations.length < SMALL_SAMPLE ? (
                    <SmallSampleWarning n={deviations.length} />
                  ) : null}
                </>
              )}
            </Tile>
            <Tile title={t("journal.adherence.stop")}>
              {summary.stopAdherence == null ? (
                <p className="text-xs text-muted-foreground">{t("journal.no_data")}</p>
              ) : (
                <>
                  <p className="text-lg font-bold text-foreground">
                    {pct(summary.stopAdherence)}
                  </p>
                  {stopSample < SMALL_SAMPLE ? <SmallSampleWarning n={stopSample} /> : null}
                </>
              )}
            </Tile>
            <Tile title={t("journal.early_exits")}>
              <p className="text-lg font-bold text-foreground">{earlyExits}</p>
            </Tile>
            <Tile title={t("journal.delayed_entries")}>
              <p className="text-lg font-bold text-foreground">{delayedEntries}</p>
            </Tile>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {/* Per-session performance. */}
            <Surface padding="sm">
              <p className="text-[12px] font-semibold text-foreground">
                {t("journal.sessions.title")}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-3">
                {bySession.map((row) => (
                  <div key={row.session}>
                    <p className="text-[11px] text-muted-foreground">
                      {t(`journal.session.${row.session}`)}
                    </p>
                    <Rate wins={row.wins} count={row.count} />
                  </div>
                ))}
              </div>
            </Surface>

            {/* R multiples. */}
            <Surface padding="sm">
              <p className="text-[12px] font-semibold text-foreground">{t("journal.r.title")}</p>
              {rValues.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">{t("journal.no_data")}</p>
              ) : (
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[11px] text-muted-foreground">{t("journal.r.avg")}</p>
                    <p className="text-lg font-bold text-foreground" dir="ltr">
                      {avgR!.toFixed(2)}R
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">{t("journal.r.best")}</p>
                    <p className="text-lg font-bold text-buy" dir="ltr">
                      {Math.max(...rValues).toFixed(2)}R
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">{t("journal.r.worst")}</p>
                    <p className="text-lg font-bold text-sell" dir="ltr">
                      {Math.min(...rValues).toFixed(2)}R
                    </p>
                  </div>
                </div>
              )}
              {rValues.length > 0 && rValues.length < SMALL_SAMPLE ? (
                <SmallSampleWarning n={rValues.length} />
              ) : null}
            </Surface>
          </div>

          {/* Personal observations (server-built, phrased as observations). */}
          {summary.notes.length > 0 ? (
            <Surface padding="sm">
              <p className="text-[12px] font-semibold text-foreground">{t("journal.notes")}</p>
              <ul className="mt-1.5 list-inside list-disc space-y-1 text-[12px] text-muted-foreground">
                {summary.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </Surface>
          ) : null}

          {/* Entry list. */}
          <Surface padding="sm">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[12px] font-semibold text-foreground">
                {t("journal.entries.title")} ({visibleEntries.length}
                {visibleEntries.length !== entries.length ? `/${entries.length}` : ""})
              </p>
              <div
                role="group"
                aria-label={t("journal.filter.label")}
                className="ms-auto flex flex-wrap items-center gap-2"
              >
                <select
                  aria-label={t("trades.col.symbol")}
                  className={selectClass}
                  value={symbolFilter}
                  onChange={(e) => setSymbolFilter(e.target.value)}
                >
                  <option value="all">{t("trades.col.symbol")}: {t("journal.filter.all")}</option>
                  {symbols.map((sym) => (
                    <option key={sym} value={sym}>
                      {sym}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t("journal.outcome")}
                  className={selectClass}
                  value={outcomeFilter}
                  onChange={(e) =>
                    setOutcomeFilter(e.target.value as "all" | "wins" | "losses")
                  }
                >
                  <option value="all">{t("journal.outcome")}: {t("journal.filter.all")}</option>
                  <option value="wins">{t("journal.filter.wins")}</option>
                  <option value="losses">{t("journal.filter.losses")}</option>
                </select>
              </div>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-[12px]">
                <thead>
                  <tr className="border-b border-border text-start text-[11px] text-muted-foreground">
                    <th className="py-1.5 text-start font-medium">{t("stats.group")}</th>
                    <th className="py-1.5 text-start font-medium">{t("rec.detail.plan_type")}</th>
                    <th className="py-1.5 text-start font-medium">{t("journal.followed")}</th>
                    <th className="py-1.5 text-start font-medium">
                      {t("journal.entry.deviation")}
                    </th>
                    <th className="py-1.5 text-start font-medium">{t("journal.r.avg")}</th>
                    <th className="py-1.5 text-start font-medium">{t("journal.outcome")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.slice(0, 50).map((entry) => (
                    <tr key={entry.recommendationId} className="border-b border-border/40">
                      <td className="py-1.5">
                        <span
                          className={cn(
                            "font-semibold",
                            entry.direction === "buy" ? "text-buy" : "text-sell",
                          )}
                        >
                          {t(`decision.${entry.direction}`)}
                        </span>{" "}
                        <span className="font-mono">{entry.symbol}</span>
                      </td>
                      <td className="py-1.5 text-muted-foreground">
                        {entry.planType &&
                        ["immediate", "anticipatory", "conditional"].includes(entry.planType)
                          ? t(`rec.plan_type.${entry.planType}`)
                          : (entry.planType ?? "—")}
                      </td>
                      <td className="py-1.5 text-muted-foreground">
                        {t(`journal.follow.${entry.followState}`)}
                      </td>
                      <td className="py-1.5 font-mono text-muted-foreground" dir="ltr">
                        {entry.entryDeviation != null
                          ? `${(entry.entryDeviation * 100).toFixed(3)}%`
                          : "—"}
                      </td>
                      <td className="py-1.5 font-mono text-muted-foreground" dir="ltr">
                        {entry.rMultiple != null ? `${entry.rMultiple.toFixed(2)}R` : "—"}
                      </td>
                      <td className="py-1.5 text-muted-foreground">
                        {outcomeLabel(entry.outcome)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visibleEntries.length === 0 ? (
              <p className="mt-3 text-center text-[12px] text-muted-foreground">
                {t("journal.filter.none")}
              </p>
            ) : null}
            {entries.length > 50 ? (
              <p className="mt-2 text-[11px] text-muted-foreground" dir="ltr">
                1–50 / {entries.length}
              </p>
            ) : null}
          </Surface>
        </>
      )}
    </div>
  );
}
