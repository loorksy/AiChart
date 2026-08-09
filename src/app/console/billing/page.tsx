import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { BillingClient } from "@/components/billing/BillingClient";

export const metadata = { title: "الفوترة والاستخدام" };

/** V2-A5 (#94): balance, statement, top-up and subscription management. */
export default async function BillingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/console/billing");
  return (
    <main className="page-shell max-w-4xl space-y-6">
      <BillingClient />
    </main>
  );
}
