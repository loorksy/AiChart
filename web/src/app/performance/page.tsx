import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listIntents, listTrades } from "@/lib/store";
import TradesClient from "@/components/TradesClient";
import { StatisticsSection } from "@/components/performance/StatisticsSection";
import { RecommendationsSection } from "@/components/performance/RecommendationsSection";
import { BacktestSection } from "@/components/performance/BacktestSection";
import { PerformanceSectionNav } from "@/components/performance/PerformanceSectionNav";

/**
 * One page for the whole performance story: the plans (recommendations),
 * the executions (trades), and the numbers (statistics) — replacing the three
 * separate pages that forced the operator to hop between routes.
 */
export default async function PerformancePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/performance");

  const [intents, trades] = await Promise.all([
    listIntents(user.id, undefined, 40),
    listTrades(user.id, 50),
  ]);

  return (
    <main className="page-shell max-w-6xl space-y-8">
      <PerformanceSectionNav />
      <RecommendationsSection />
      <TradesClient initialIntents={intents} initialTrades={trades} embedded />
      <StatisticsSection />
      <BacktestSection />
    </main>
  );
}
