"use client";

/**
 * `/quant-agent/analysis/history` — every Quant Agent analysis this user has
 * run, newest first.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `src/views/ai-analysis/index.vue:727-813` (the Analysis-History modal).
 *
 * What changed: upstream's history is an 800px-wide desktop modal that no
 * shipped code path can open (its only trigger lives inside `v-if="false"`),
 * and its `/history/all` endpoint is not scoped by user. Here it is a real
 * route, mobile-first, served by a user-scoped, ownership-checked API. The
 * page is a client component only because the list owns its own fetching and
 * delete state; auth and the app shell still come from
 * `quant-agent/layout.tsx`.
 */
import Link from "next/link";
import { History, Radar } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { PageHeader } from "@/components/foundation";
import { buttonVariants } from "@/components/squareui/button";
import { cn } from "@/lib/utils";
import { QuantAnalysisHistoryList } from "@/components/quantAgent/analysis/QuantAnalysisHistoryList";

export default function QuantAgentAnalysisHistoryPage() {
  const { t, dir } = useLocale();

  return (
    <div dir={dir} className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader
        title={t("qa.analysis.history_title")}
        description={t("qa.analysis.history_subtitle")}
        icon={<History aria-hidden="true" />}
        actions={
          // A real navigation, so it stays an anchor — routing `Button`
          // through `render` would strip link semantics for `role="button"`.
          <Link
            href="/quant-agent/analysis"
            className={cn(buttonVariants({ variant: "outline", size: "xl" }), "gap-2")}
          >
            <Radar className="h-3.5 w-3.5" aria-hidden="true" />
            {t("qa.analysis.back_to_analysis")}
          </Link>
        }
      />

      <QuantAnalysisHistoryList />
    </div>
  );
}
