import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listRecommendations } from "@/lib/store";
import RecommendationsHistoryClient from "@/components/RecommendationsHistoryClient";

export const metadata = {
  title: "سجل التوصيات — Lonora",
  description: "كل توصيات الذكاء الاصطناعي السابقة مع المستويات والثقة.",
};

export default async function RecommendationsHistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/console/recommendations");

  return (
    <RecommendationsHistoryClient
      initial={await listRecommendations(user.id, 100)}
    />
  );
}
