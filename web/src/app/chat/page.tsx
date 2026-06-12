import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isOnboardingDone } from "@/lib/store";
import { isLLMConfigured } from "@/lib/llm";
import ChatPageClient from "@/components/ChatPageClient";

export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin" && !(await isOnboardingDone(user.id))) {
    redirect("/onboarding");
  }

  return (
    <ChatPageClient
      email={user.email}
      role={user.role}
      agentReady={isLLMConfigured()}
    />
  );
}
