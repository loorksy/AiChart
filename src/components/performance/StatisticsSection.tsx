"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, BarChart3, RefreshCw } from "lucide-react";
import { Button } from "@/components/squareui/button";
import { useLocale } from "@/hooks/useLocale";
import { RecommendationStatsOverview } from "@/components/recommendations/RecommendationStatsOverview";
import { RecommendationOutcomeBreakdown } from "@/components/recommendations/RecommendationOutcomeBreakdown";
import { RecommendationPerformanceTable } from "@/components/recommendations/RecommendationPerformanceTable";
import type { RecommendationStats, StatsPeriod } from "@/lib/recommendations/recommendationStats";
import { EmptyState, SectionHeader, Surface } from "@/components/foundation";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PERIODS: { id: StatsPeriod; labelKey: string }[] = [
  { id: "today", labelKey: "stats.filter.today" },
  { id: "7d", labelKey: "stats.filter.7d" },
  { id: "30d", labelKey: "stats.filter.30d" },
  { id: "all", labelKey: "stats.filter.all" },
];

/** Statistics block of the unified performance page (was /statistics). */
export function StatisticsSection() {
  const { t } = useLocale();
  const [period, setPeriod] = useState<StatsPeriod>("all");
  const [stats, setStats] = useState<RecommendationStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    // Deliberately not clearing `stats` here: switching period keeps the
    // previous numbers on screen until the new ones land, so the section does
    // not collapse to a skeleton and shove the page around. `failed` is reset
    // by the controls that re-trigger this effect, not in the effect body.
    void (async () => {
      // Without this catch a rejected fetch left the skeleton on screen with
      // no error and no way to retry.
      try {
        const res = await fetch(`/api/recommendations/tracked/stats?period=${period}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (alive) {
            setStats(null);
            setFailed(true);
          }
          return;
        }
        const json = (await res.json()) as { stats?: RecommendationStats };
        if (!alive) return;
        if (json?.stats) {
          setStats(json.stats);
        } else {
          setStats(null);
          setFailed(true);
        }
      } catch {
        if (alive) {
          setStats(null);
          setFailed(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [period, reloadKey]);

  const empty = stats && stats.total === 0;

  return (
    <section id="statistics" className="scroll-mt-24 space-y-4">
      <SectionHeader
        title={t("stats.title")}
        actions={
          <div
            data-testid="stats-period-filters"
            role="group"
            aria-label={t("stats.title")}
            className="inline-flex flex-wrap gap-1 rounded-[var(--radius)] border border-border bg-card p-1"
          >
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setFailed(false);
                  setPeriod(p.id);
                }}
                aria-pressed={period === p.id}
                className={cn(
                  "min-h-10 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8",
                  period === p.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(p.labelKey)}
              </button>
            ))}
          </div>
        }
      />

      {failed && (
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
                onClick={() => {
                  setFailed(false);
                  setReloadKey((k) => k + 1);
                }}
              >
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                {t("rec.page.refresh")}
              </Button>
            }
          />
        </Surface>
      )}

      {!stats && !failed && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-24" />
          ))}
        </div>
      )}

      {empty && (
        <Surface padding="none">
          <EmptyState
            size="sm"
            icon={<BarChart3 aria-hidden="true" />}
            title={t("stats.empty")}
          />
        </Surface>
      )}

      {stats && !empty && (
        <>
          <RecommendationStatsOverview stats={stats} />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="min-w-0 lg:col-span-2">
              <RecommendationOutcomeBreakdown stats={stats} />
            </div>
            {stats.scalp.total > 0 && (
              <div className="min-w-0 lg:col-span-2">
                <RecommendationPerformanceTable
                  titleKey="stats.scalp"
                  groups={[stats.scalp]}
                  renderKey={() => t("stats.scalp")}
                />
              </div>
            )}
            <RecommendationPerformanceTable titleKey="stats.by_symbol" groups={stats.bySymbol} />
            <RecommendationPerformanceTable titleKey="stats.by_timeframe" groups={stats.byTimeframe} />
            <RecommendationPerformanceTable titleKey="stats.by_setup" groups={stats.bySetupType} />
            <RecommendationPerformanceTable
              titleKey="stats.by_direction"
              groups={stats.byDirection}
              renderKey={(k) => (k === "buy" ? t("decision.buy") : t("decision.sell"))}
            />
            {/* Phase B: the platform agent's record and MCP-client records are
                separate claims by separate brains — shown apart because a
                blended win-rate would measure neither. */}
            <RecommendationPerformanceTable
              titleKey="stats.by_decision_source"
              groups={stats.byDecisionSource}
              renderKey={(k) =>
                k === "platform_agent"
                  ? t("rec.source.platform_agent")
                  : k === "mcp_client"
                    ? t("rec.source.mcp_client")
                    : k
              }
            />
          </div>
        </>
      )}
    </section>
  );
}
