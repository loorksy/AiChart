import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAnthropicConfigured } from "@/lib/anthropic";
import Nav from "@/components/Nav";
import ChatClient from "@/components/ChatClient";

export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <>
      <Nav email={user.email} role={user.role} />
      <ChatClient agentReady={isAnthropicConfigured()} />
    </>
  );
}
