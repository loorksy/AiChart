"use client";

/**
 * Quant Agent signal history — every monitor fire this user has had, with the
 * levels it carried, the rule that let it through, and what happened on each
 * notification channel.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `src/utils/noticeFormat.js` (`renderIndicatorSignal`: the kicker / title /
 * side-coloured chip / metric grid / closed-candle note) and
 * `src/components/NoticeIcon/NoticeIcon.vue` (the notification list).
 *
 * What changed:
 *  - Upstream renders a NOTIFICATION BELL, which is a different thing: it
 *    lists rows that were written because the in-app channel happened to be
 *    enabled, so a Telegram-only alert never appears and a failed send never
 *    appears at all. This lists the FIRES, and the delivery outcome is a
 *    property of the row rather than the reason it exists — which is why the
 *    "Failed" chip below can exist in the first place.
 *  - Upstream's bell injects `payload.message` straight into `v-html` when it
 *    smells like an HTML report (`noticeFormat.js:359-372`), un-sanitized.
 *    Nothing here is ever rendered as HTML; every field is text in a React
 *    node.
 *  - Upstream's side colours are raw hex (`#22c55e` / `#ef4444` / `#f59e0b`).
 *    These are `buy` / `sell` / `muted` tokens, so both themes work.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { EmptyState, Surface } from "@/components/foundation";
import { Button } from "@/components/squareui/button";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatAnalysisPrice } from "@/components/quantAgent/analysis/QuantAnalysisReport";
import type {
  SignalChannel,
  SignalDeliveryStatus,
  SignalEventRecord,
} from "@/lib/quantAgent/signalEventStore";

const PAGE_SIZE = 20;

/** Same three-way tone the decision badges use everywhere in Quant Agent. */
const DECISION_BADGE_CLASS = {
  BUY: "border-buy/45 bg-buy/10 text-buy",
  SELL: "border-sell/45 bg-sell/10 text-sell",
  HOLD: "border-border bg-muted/40 text-muted-foreground",
} as const;

const STATUS_CLASS: Record<SignalDeliveryStatus, string> = {
  delivered: "border-success/45 bg-success/10 text-success",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  skipped: "border-border bg-muted/40 text-muted-foreground",
};

const STATUS_ICON: Record<SignalDeliveryStatus, typeof CheckCircle2> = {
  delivered: CheckCircle2,
  failed: XCircle,
  skipped: MinusCircle,
};

const CHANNELS: readonly SignalChannel[] = ["telegram", "push", "webhook"];

const FILTERS = [
  { key: "all", labelKey: "qa.signals.filter.all", decision: null },
  { key: "BUY", labelKey: "qa.signals.filter.buy", decision: "BUY" },
  { key: "SELL", labelKey: "qa.signals.filter.sell", decision: "SELL" },
  { key: "HOLD", labelKey: "qa.signals.filter.hold", decision: "HOLD" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

/** Truncated for the row; the whole thing is never hidden behind a click. */
function truncateRationale(value: string | null): string {
  if (!value) return "";
  const text = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

export function SignalHistoryList() {
  const { t, dir, locale } = useLocale();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [items, setItems] = useState<SignalEventRecord[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (cursor: string | null, decision: string | null) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor) params.set("cursor", cursor);
      if (decision) params.set("decision", decision);
      const res = await fetch(`/api/quant-agent/signals?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("load failed");
      return (await res.json()) as { signals?: SignalEventRecord[]; nextCursor?: string | null };
    },
    [],
  );

  const activeDecision = FILTERS.find((entry) => entry.key === filter)?.decision ?? null;

  // No synchronous setState here: the skeleton is re-armed by the filter
  // handler (a user event), so this effect only ever writes state after an
  // await and cannot trigger a cascading render.
  const reload = useCallback(async () => {
    try {
      const json = await load(null, activeDecision);
      setItems(json.signals ?? []);
      setNextCursor(json.nextCursor ?? null);
      setError(false);
    } catch {
      setError(true);
      setItems([]);
    }
  }, [load, activeDecision]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const json = await load(nextCursor, activeDecision);
      setItems((prev) => [...(prev ?? []), ...(json.signals ?? [])]);
      setNextCursor(json.nextCursor ?? null);
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  const filterBar = (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("qa.signals.title")}>
      {FILTERS.map((entry) => {
        const active = entry.key === filter;
        return (
          <button
            key={entry.key}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (active) return;
              setItems(null);
              setNextCursor(null);
              setFilter(entry.key);
            }}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(entry.labelKey)}
          </button>
        );
      })}
    </div>
  );

  if (items == null) {
    return (
      <div dir={dir} className="space-y-3" aria-busy="true">
        {filterBar}
        <span className="sr-only">{t("qa.signals.loading")}</span>
        {Array.from({ length: 3 }).map((_, index) => (
          <SkeletonBlock key={index} className="h-28" />
        ))}
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div dir={dir} className="space-y-3">
        {filterBar}
        <Surface padding="none">
          <EmptyState
            announce
            tone="danger"
            icon={<AlertTriangle aria-hidden="true" />}
            title={t("qa.signals.error")}
            action={
              <Button variant="outline" size="xl" onClick={() => void reload()}>
                {t("qa.signals.retry")}
              </Button>
            }
          />
        </Surface>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div dir={dir} className="space-y-3">
        {filterBar}
        <Surface padding="none">
          <EmptyState
            icon={<Bell aria-hidden="true" />}
            title={t("qa.signals.empty.title")}
            description={t("qa.signals.empty.description")}
            action={
              <Link
                href="/quant-agent/chat"
                className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
              >
                {t("qa.signals.empty.cta")}
              </Link>
            }
          />
        </Surface>
      </div>
    );
  }

  return (
    <div dir={dir} className="space-y-3">
      {filterBar}

      <ul className="space-y-2">
        {items.map((item) => {
          const created = new Date(item.createdAt);
          const timestamp = Number.isNaN(created.getTime())
            ? "—"
            : created.toLocaleString(locale === "ar" ? "ar" : "en", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });
          const rationale = truncateRationale(item.rationale);
          const anyDelivered = CHANNELS.some(
            (channel) => item.delivery[channel]?.status === "delivered",
          );
          const ruleLabel =
            item.fireRule === "on_change"
              ? item.previousDecision
                ? t("qa.signals.rule.on_change_from", {
                    previous: t(`qa.signals.decision.${item.previousDecision}`),
                  })
                : t("qa.signals.rule.on_change")
              : t("qa.signals.rule.always");

          return (
            <Surface as="li" key={item.id} padding="sm" className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span dir="ltr" className="font-mono text-sm font-semibold text-foreground">
                  {item.symbol}
                </span>
                <span
                  dir="ltr"
                  className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  {item.interval}
                </span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    DECISION_BADGE_CLASS[item.decision],
                  )}
                >
                  {t(`qa.signals.decision.${item.decision}`)}
                </span>
                {item.confidence == null ? null : (
                  <span className="text-[11px] text-muted-foreground">
                    {t("qa.signals.confidence")}:{" "}
                    <span dir="ltr" className="font-mono text-foreground">
                      {Math.round(item.confidence)}%
                    </span>
                  </span>
                )}
                <span className="ms-auto font-mono text-[11px] text-muted-foreground">
                  {timestamp}
                </span>
              </div>

              {/* Levels. A level the engine never produced renders as an em
                  dash — never as 0, which would read as a real price. */}
              <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2">
                {(
                  [
                    ["qa.signals.level.entry", item.entryPrice, "text-foreground"],
                    ["qa.signals.level.stop", item.stopLoss, "text-sell"],
                    ["qa.signals.level.target", item.takeProfit, "text-buy"],
                  ] as const
                ).map(([labelKey, value, tone]) => (
                  <div key={labelKey} className="min-w-0">
                    <dt className="truncate text-[10px] uppercase text-muted-foreground">
                      {t(labelKey)}
                    </dt>
                    <dd dir="ltr" className={cn("truncate font-mono text-[12px]", tone)}>
                      {formatAnalysisPrice(value)}
                    </dd>
                  </div>
                ))}
              </dl>

              {rationale ? (
                <p className="break-words text-[12px] text-muted-foreground">
                  <span className="text-foreground">{t("qa.signals.rationale")}: </span>
                  {rationale}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>
                  {item.monitorId == null
                    ? t("qa.signals.monitor_removed")
                    : t("qa.signals.monitor", { id: String(item.monitorId) })}
                </span>
                <span>
                  {t("qa.signals.rule")}: {ruleLabel}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">
                  {t("qa.signals.delivery")}:
                </span>
                {CHANNELS.map((channel) => {
                  const entry = item.delivery[channel] ?? { status: "skipped" as const };
                  const Icon = STATUS_ICON[entry.status];
                  return (
                    <span
                      key={channel}
                      // The failure reason is the tooltip rather than a fourth
                      // line: it matters when it matters and is noise otherwise.
                      title={entry.error ?? undefined}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]",
                        STATUS_CLASS[entry.status],
                      )}
                    >
                      <Icon className="h-2.5 w-2.5" aria-hidden="true" />
                      {t(`qa.signals.channel.${channel}`)}
                      <span className="opacity-70">· {t(`qa.signals.status.${entry.status}`)}</span>
                    </span>
                  );
                })}
                {anyDelivered ? null : (
                  <span className="text-[10px] text-muted-foreground">
                    {t("qa.signals.delivery.none")}
                  </span>
                )}
              </div>
            </Surface>
          );
        })}
      </ul>

      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="xl"
            disabled={loadingMore}
            onClick={() => void handleLoadMore()}
          >
            {loadingMore ? t("qa.signals.loading") : t("qa.signals.load_more")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
