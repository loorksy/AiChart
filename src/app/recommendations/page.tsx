import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { RecommendationsSection } from "@/components/performance/RecommendationsSection";

/**
 * The recommendations screen: active plans and their history.
 *
 * This used to redirect into /performance#recommendations, which meant the
 * two side-menu entries (recommendations and performance) landed on the SAME
 * screen with the performance item highlighted — one destination wearing two
 * labels. Each entry now owns its route: plans live here, the statistical
 * record lives on /performance. The /recommendations/[id] detail view is
 * unchanged.
 */
export default async function RecommendationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/recommendations");

  return (
    <main className="page-shell max-w-6xl space-y-8">
      <RecommendationsSection />
    </main>
  );
}
