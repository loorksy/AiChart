import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasPlatformAccess } from "@/lib/platformAccess";
import { needsMcpCredentials } from "@/lib/userCredentials";
import { isLLMConfiguredAsync } from "@/lib/llm";
import { getOrCreateChartLayout } from "@/lib/store";
import { initDb } from "@/lib/db";
import ChartPageClient from "@/components/ChartPageClient";

export const metadata = {
  title: "AiChart — الشارت الذكي",
  description: "شارت ذكي كامل الشاشة — تحليل AI، SL/TP، وإدارة الصفقات.",
};

export default async function ChartPage() {
  const user = await getCurrentUser();
  // Public: guests may browse the live chart. Signed-in users get their own
  // TradingView-style layout URL (/chart/<id>) with saved drawings.
  if (user && needsMcpCredentials(user)) redirect("/complete-profile");
  if (user && user.role !== "admin" && !hasPlatformAccess(user)) {
    redirect("/awaiting-approval");
  }

  if (user) {
    await initDb();
    const layout = await getOrCreateChartLayout(user.id);
    redirect(`/chart/${layout.id}?symbol=${encodeURIComponent(layout.symbol)}`);
  }

  return (
    <ChartPageClient
      email={null}
      role="user"
      agentReady={await isLLMConfiguredAsync()}
      guest
    />
  );
}
