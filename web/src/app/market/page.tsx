import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function MarketRedirect() {
  const user = await getCurrentUser();
  redirect(user ? "/console" : "/login");
}
