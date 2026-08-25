import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { StatisticsSection } from "@/components/performance/StatisticsSection";

/**
 * The performance story of a recommendations platform: how the plans turned
 * out, in numbers — win rate, outcome breakdown, per-symbol/per-timeframe
 * records.
 *
 * The plans themselves live on /recommendations. Both sections used to render
 * here on one screen while the side menu offered them as two entries — the
 * duplicate-destination complaint. Each menu entry now has its own route.
 */
export default async function PerformancePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/performance");

  return (
    <main className="page-shell max-w-6xl space-y-8">
      <StatisticsSection />
    </main>
  );
}
