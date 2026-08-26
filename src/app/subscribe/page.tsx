import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { displayNameForUser } from "@/lib/displayName";
import { AppConsoleShell } from "@/components/shell/AppConsoleShell";
import { SubscribeClient } from "@/components/subscription/SubscribeClient";
import { getEntitlementForUser } from "@/lib/subscription/entitlement";
import { getBillingPlan, getCurrentPlanPrice } from "@/lib/billing/planConfig";
import { initDb } from "@/lib/db";
import { BRAND_NAME } from "@/lib/brand";
import { privateSurfaceMetadata } from "@/lib/seo";

export const metadata: Metadata = privateSurfaceMetadata(
  `الاشتراك — ${BRAND_NAME}`,
);

// Not gated on FEATURE_BILLING: the Free-account subscribe CTA points here
// from the account menu and from spend refusals, and the gate bounced every
// click back to the landing page. The page already degrades to the contact
// CTA when payments are not configured.
export default async function SubscribePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/subscribe");
  await initDb();
  const entitlement = await getEntitlementForUser(user);
  const [planPrice, plan] = await Promise.all([getCurrentPlanPrice(), getBillingPlan()]);
  const planFacts = {
    priceCents: planPrice?.price_cents ?? null,
    signupGrantCredits: plan.signup_grant_credits,
  };
  if (entitlement.isAdmin || entitlement.hasPaidAccess) {
    redirect("/chat");
  }

  return (
    <AppConsoleShell
      role="user"
      displayName={displayNameForUser(user)}
      showConversations={false}
    >
      <SubscribeClient
        mode={entitlement.access === "free" ? "free" : "blocked"}
        plan={planFacts}
      />
    </AppConsoleShell>
  );
}
