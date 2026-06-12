import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function AgentRedirect() {
  const user = await getCurrentUser();
  redirect(user ? "/console" : "/login");
}
