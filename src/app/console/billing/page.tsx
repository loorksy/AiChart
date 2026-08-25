import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { BillingClient } from "@/components/billing/BillingClient";

export const metadata = { title: "الفوترة والاستخدام" };

/**
 * V2-A5 (#94): balance, statement, top-up and subscription management.
 *
 * NOT gated on FEATURE_BILLING: the account menu links here unconditionally
 * (the buy-credits CTA and the credit-ledger link), and gating turned both
 * into a redirect back to /chat — a dead link with a friendly label. The
 * user's own balance and ledger are account data they are always entitled to
 * see, and the page itself degrades honestly when checkout is not configured.
 */
export default async function BillingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/console/billing");
  return (
    <main className="page-shell max-w-4xl space-y-6">
      <BillingClient />
    </main>
  );
}
