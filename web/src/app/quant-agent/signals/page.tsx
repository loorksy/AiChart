"use client";

/**
 * `/quant-agent/signals` — the persistent signal log: every alert this user's
 * scheduled monitors have fired, what it said, and what happened on each
 * notification channel.
 *
 * This route exists because a fired monitor used to leave nothing behind but a
 * Telegram message and one overwritten column. Nothing was queryable and
 * nothing was visible in-product — so a user who missed a notification, or
 * whose Telegram send failed, had no way to find out that anything had
 * happened at all.
 *
 * Client component only because the list owns its own fetching, filter and
 * pagination state; auth, subscription gating and the app shell still come
 * from `quant-agent/layout.tsx` unchanged.
 */
import { Bell } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { PageHeader } from "@/components/foundation";
import { SignalHistoryList } from "@/components/quantAgent/signals/SignalHistoryList";

export default function QuantAgentSignalsPage() {
  const { t, dir } = useLocale();

  return (
    <div dir={dir} className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader
        title={t("qa.signals.title")}
        description={t("qa.signals.subtitle")}
        icon={<Bell aria-hidden="true" />}
      />
      <SignalHistoryList />
    </div>
  );
}
