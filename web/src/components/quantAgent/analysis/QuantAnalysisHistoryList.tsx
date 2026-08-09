"use client";

/**
 * Quant Agent analysis history — the caller's own past analyses, newest first.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `src/views/ai-analysis/index.vue:727-813` (the Analysis-History modal:
 * market tag, symbol, verdict tag, status tag, confidence, price + 80-char
 * summary, timestamp, "View Result" and a delete pop-confirm). The 80-char
 * truncation is upstream's exact rule (`index.vue:1865-1868`).
 *
 * What changed:
 *  - Upstream's list is a desktop `a-modal` reached from dead code
 *    (`v-if="false"`); this is a real, mobile-first route.
 *  - Page-number pagination with a 10/20/50 size changer becomes the keyset
 *    "load more" the store actually exposes — the API is cursor-paginated, so
 *    a page number would be a lie.
 *  - "View Result" links to the analysis page instead of reconstructing a
 *    report client-side: upstream synthesises ±5% stop/target from the row's
 *    price when `full_result` is absent (`index.vue:2006-2053`), which invents
 *    two trade levels the engine never produced. Our rows are complete
 *    records, so there is nothing to invent.
 *  - Delete is an in-row two-step confirm (no popconfirm primitive here), and
 *    the API it calls is ownership-checked server-side.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Eye, History, Trash2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { EmptyState, Surface } from "@/components/foundation";
import { Button } from "@/components/squareui/button";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { QuantAnalysisRecord } from "@/lib/quantAgent/types";
import { decisionLabelKey, decisionTone, formatAnalysisPrice } from "./QuantAnalysisReport";

const PAGE_SIZE = 20;

/** QuantDinger `formatHistorySummary` — 80 characters, then an ellipsis. */
function truncateSummary(summary: string | null): string {
  if (!summary) return "";
  const text = summary.trim();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

const VERDICT_BADGE_CLASS = {
  buy: "border-buy/45 bg-buy/10 text-buy",
  sell: "border-sell/45 bg-sell/10 text-sell",
  neutral: "border-border bg-muted/40 text-muted-foreground",
} as const;

const STATUS_BADGE_CLASS: Record<QuantAnalysisRecord["status"], string> = {
  completed: "border-success/45 bg-success/10 text-success",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function QuantAnalysisHistoryList() {
  const { t, dir, locale } = useLocale();
  const [items, setItems] = useState<QuantAnalysisRecord[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState(false);

  const load = useCallback(async (cursor: string | null) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`/api/quant-agent/analysis?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("load failed");
    return (await res.json()) as { analyses?: QuantAnalysisRecord[]; nextCursor?: string | null };
  }, []);

  const reload = useCallback(async () => {
    try {
      const json = await load(null);
      setItems(json.analyses ?? []);
      setNextCursor(json.nextCursor ?? null);
      setError(false);
    } catch {
      setError(true);
      setItems((prev) => prev ?? []);
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const json = await load(nextCursor);
      setItems((prev) => [...(prev ?? []), ...(json.analyses ?? [])]);
      setNextCursor(json.nextCursor ?? null);
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    setDeleteError(false);
    try {
      const res = await fetch(`/api/quant-agent/analysis/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setItems((prev) => (prev ?? []).filter((item) => item.id !== id));
      setConfirmId(null);
    } catch {
      setDeleteError(true);
    } finally {
      setBusyId(null);
    }
  }

  if (items == null) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">{t("qa.analysis.history.loading")}</span>
        {Array.from({ length: 3 }).map((_, index) => (
          <SkeletonBlock key={index} className="h-24" />
        ))}
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <Surface padding="none">
        <EmptyState
          announce
          tone="danger"
          icon={<AlertTriangle aria-hidden="true" />}
          title={t("qa.analysis.history.error")}
          action={
            <Button variant="outline" size="xl" onClick={() => void reload()}>
              {t("qa.analysis.retry")}
            </Button>
          }
        />
      </Surface>
    );
  }

  if (items.length === 0) {
    return (
      <Surface padding="none">
        <EmptyState
          icon={<History aria-hidden="true" />}
          title={t("qa.analysis.history.empty")}
          description={t("qa.analysis.history.empty_description")}
        />
      </Surface>
    );
  }

  return (
    <div dir={dir} className="space-y-3">
      <ul className="space-y-2">
        {items.map((item) => {
          const tone = decisionTone(item.decision);
          const created = new Date(item.createdAt);
          const timestamp = Number.isNaN(created.getTime())
            ? "—"
            : created.toLocaleString(locale === "ar" ? "ar" : "en", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });
          const marketKey = `qa.analysis.market.${item.market.toLowerCase()}`;
          const marketLabel = t(marketKey) === marketKey ? item.market : t(marketKey);
          const summary = truncateSummary(item.summary);

          return (
            <Surface as="li" key={item.id} padding="sm" className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                  {marketLabel}
                </span>
                <span dir="ltr" className="font-mono text-sm font-semibold text-foreground">
                  {item.symbol}
                </span>
                <span
                  dir="ltr"
                  className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  {item.interval}
                </span>
                {item.decision ? (
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      VERDICT_BADGE_CLASS[tone],
                    )}
                  >
                    {t(decisionLabelKey(item.decision))}
                  </span>
                ) : null}
                <span
                  className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_BADGE_CLASS[item.status])}
                >
                  {t(`qa.analysis.status.${item.status}`)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {t("qa.analysis.confidence")}:{" "}
                  <span className="font-mono text-foreground">
                    {item.confidence == null ? "—" : `${Math.round(item.confidence)}%`}
                  </span>
                </span>
              </div>

              <p className="break-words text-[12px] text-muted-foreground">
                <span dir="ltr" className="font-mono text-foreground">
                  {formatAnalysisPrice(item.currentPrice)}
                </span>
                {summary ? <span className="ms-2">{summary}</span> : null}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">{timestamp}</span>
                <span className="ms-auto flex flex-wrap items-center gap-2">
                  <Link
                    href={`/quant-agent/analysis?id=${encodeURIComponent(item.id)}`}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-info hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("qa.analysis.history.view")}
                  </Link>
                  {confirmId === item.id ? (
                    <>
                      <span className="text-[11px] text-muted-foreground">
                        {t("qa.analysis.history.delete_confirm")}
                      </span>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busyId === item.id}
                        onClick={() => void handleDelete(item.id)}
                      >
                        {t("qa.analysis.history.delete_confirm_cta")}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setConfirmId(null)}>
                        {t("qa.analysis.history.delete_cancel")}
                      </Button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(false);
                        setConfirmId(item.id);
                      }}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("qa.analysis.history.delete")}
                    </button>
                  )}
                </span>
              </div>

              {deleteError && confirmId === item.id ? (
                <p className="text-[11px] text-destructive">{t("qa.analysis.history.delete_error")}</p>
              ) : null}
            </Surface>
          );
        })}
      </ul>

      {nextCursor ? (
        <div className="flex justify-center">
          <Button variant="outline" size="xl" disabled={loadingMore} onClick={() => void handleLoadMore()}>
            {loadingMore ? t("qa.analysis.history.loading") : t("qa.analysis.history.load_more")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
