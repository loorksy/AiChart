import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasPlatformAccess } from "@/lib/platformAccess";
import { needsMcpCredentials } from "@/lib/userCredentials";
import { isLLMConfigured } from "@/lib/llm";
import ChartPageClient from "@/components/ChartPageClient";

export const metadata = {
  title: "AiChart — الشارت الذكي",
  description: "شارت ذكي كامل الشاشة — تحليل AI، SL/TP، وإدارة الصفقات.",
};

export default async function ChartPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/chart");
  if (needsMcpCredentials(user)) redirect("/complete-profile");
  if (user.role !== "admin" && !hasPlatformAccess(user)) {
    redirect("/awaiting-approval");
  }

  return (
    <ChartPageClient
      email={user.email}
      role={user.role}
      agentReady={isLLMConfigured()}
    />
  );
}
