import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function CommandRedirect() {
  const user = await getCurrentUser();
  redirect(user ? "/workspace" : "/login");
}
