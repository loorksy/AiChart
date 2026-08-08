import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

/** `/console` index — admins land on the platform console; everyone else on workspace. */
export default async function ConsoleIndexPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/console");

  if (user.role === "admin") redirect("/console/platform");
  redirect("/workspace");
}
