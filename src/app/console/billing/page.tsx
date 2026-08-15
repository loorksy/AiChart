import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { BillingClient } from "@/components/billing/BillingClient";
import { FEATURES } from "@/lib/agent/featureFlags";

export const metadata = { title: "الفوترة والاستخدام" };

/** V2-A5 (#94): balance, statement, top-up and subscription management. */
export default async function BillingPage() {
  if (!FEATURES.billing()) redirect("/chat");
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/console/billing");
  return (
    <main className="page-shell max-w-4xl space-y-6">
      <BillingClient />
    </main>
  );
}
