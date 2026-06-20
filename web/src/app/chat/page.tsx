import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasPlatformAccess } from "@/lib/platformAccess";
import { needsMcpCredentials } from "@/lib/userCredentials";
import { isLLMConfigured } from "@/lib/llm";
import ChatPageClient from "@/components/ChatPageClient";

export const metadata = {
  title: "AiChart — الدردشة",
  description: "تحدّث مع وكيل التداول — تحليل، صفقات، وإدارة من المنصة مباشرة.",
};

export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/chat");
  if (needsMcpCredentials(user)) redirect("/complete-profile");
  if (user.role !== "admin" && !hasPlatformAccess(user)) {
    redirect("/awaiting-approval");
  }

  return (
    <ChatPageClient
      email={user.email}
      role={user.role}
      agentReady={isLLMConfigured()}
    />
  );
}
