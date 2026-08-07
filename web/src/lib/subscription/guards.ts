import { redirect } from "next/navigation";
import type { PublicUser } from "@/lib/types";
import {
  getEntitlementForUser,
} from "@/lib/subscription/entitlement";
import type { EntitlementSnapshot } from "@/lib/subscription/plan";

export async function loadEntitlement(
  user: Pick<PublicUser, "id" | "role" | "status">,
): Promise<EntitlementSnapshot> {
  return getEntitlementForUser(user);
}

/** Premium pages (chart workspace extras, stats, trades, connect). */
export async function requirePaidPage(
  user: Pick<PublicUser, "id" | "role" | "status">,
  nextPath: string,
): Promise<EntitlementSnapshot> {
  const ent = await getEntitlementForUser(user);
  if (ent.isAdmin || ent.hasPaidAccess || ent.access === "trial") return ent;
  redirect(`/subscribe?next=${encodeURIComponent(nextPath)}`);
}

export async function requireAdminPage(
  user: Pick<PublicUser, "id" | "role" | "status">,
): Promise<void> {
  if (user.role !== "admin") redirect("/workspace");
}
