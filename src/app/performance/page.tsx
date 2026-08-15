import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { StatisticsSection } from "@/components/performance/StatisticsSection";
import { RecommendationsSection } from "@/components/performance/RecommendationsSection";
import { BacktestSection } from "@/components/performance/BacktestSection";
import { PerformanceSectionNav } from "@/components/performance/PerformanceSectionNav";
import { PerformanceHashScroll } from "@/components/performance/PerformanceHashScroll";

/**
 * The performance story of a recommendations platform: the plans, how they
 * turned out, and the validated strategies behind them.
 *
 * The "executions" half is gone with the execution layer. It rendered open
 * broker trades and pending approval intents from tables nothing writes any
 * more, and its controls — close a trade, approve an intent — posted to four
 * API routes that no longer exist. Every one of those buttons answered 404 in
 * the operator's hands.
 */
export default async function PerformancePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/performance");

  return (
    <main className="page-shell max-w-6xl space-y-8">
      <PerformanceHashScroll />
      <PerformanceSectionNav />
      <RecommendationsSection />
      <StatisticsSection />
      <BacktestSection />
    </main>
  );
}
