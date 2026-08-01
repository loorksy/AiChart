"use client";

import Link from "next/link";
import { SmartChartAgentPanel } from "@/components/agent/SmartChartAgentPanel";
import { AICHART_PLAN } from "@/lib/subscription/plan";
import { useLocale } from "@/hooks/useLocale";

export function TrialChatWorkspace({
  trialRemaining,
  trialUsed,
}: {
  trialRemaining: number;
  trialUsed: number;
}) {
  const { locale, dir, t } = useLocale();
  const isAr = locale === "ar";

  return (
    <div dir={dir} className="relative flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {isAr ? "تجربة المحادثة" : "Trial chat"}
          </p>
          <p className="text-xs text-muted-foreground">
            {isAr
              ? `${trialUsed}/${AICHART_PLAN.trialInteractions} تفاعلات مستخدمة · متبقي ${trialRemaining}`
              : `${trialUsed}/${AICHART_PLAN.trialInteractions} used · ${trialRemaining} remaining`}
          </p>
        </div>
        <Link
          href="/subscribe"
          className="inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius)] border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
        >
          {isAr ? "الاشتراك الكامل" : "Full access"}
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        <SmartChartAgentPanel
          symbol="EURUSD"
          interval="15m"
          chatId={undefined}
        />
      </div>
      <p className="sr-only">{t("agent.empty")}</p>
    </div>
  );
}
